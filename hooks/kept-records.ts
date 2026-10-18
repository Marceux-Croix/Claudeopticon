/** What the store keeps per session (and per archive file): the limits, and the readers that check each stored value. */

import type { AgentRow, AgentRowStatus, Progress } from '../types'
import { isEnded } from './agent-ends'
import { elapsedSince } from './clock-elapsed'
import { readClaims, readProgress } from './progress-report'
import { hideNormalizedSecretLines, hideSecretLines } from './secrets'
import type { Reservation } from './ticket-ids'
import { hideDoing } from './tool-calls'

/** The agent rows kept in the store per session, so a plugin reload keeps each agent's data. */
export const KEPT_AGENTS = 200

/** Reads the stored reservations back: `[id, until, offeredTo, by]` entries with a string ID and a finite expiry (`by` is absent in older entries). */
export function readKeptReserved(stored: unknown): [string, Reservation][] {
  if (!Array.isArray(stored)) {
    return []
  }
  const out: [string, Reservation][] = []
  for (const one of stored as unknown[]) {
    if (Array.isArray(one) && typeof one[0] === 'string' && typeof one[1] === 'number' && Number.isFinite(one[1])) {
      out.push([one[0].toLowerCase(), { until: one[1], ...(typeof one[2] === 'string' ? { offeredTo: one[2] } : {}), ...(typeof one[3] === 'string' ? { by: one[3] } : {}) }])
    }
  }

  return out
}

/** Reads the stored ticket claims back, keeping only well-formed pairs. */
export function readKeptTickets(stored: unknown): [string, boolean][] {
  if (!Array.isArray(stored)) {
    return []
  }

  return stored.filter((pair): pair is [string, boolean] => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'boolean')
}

const STATUSES: readonly AgentRowStatus[] = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed', 'ended']
const isFinite0 = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const stringList = (list: unknown): string[] | undefined => (Array.isArray(list) ? list.filter((one): one is string => typeof one === 'string') : undefined)

/**
 * Reads a stored list back into rows. A row without a usable core (ID, text fields, start time) is
 * dropped. A bad optional field is dropped from the row, a bad count is repaired to 0, an unknown
 * status becomes `ended`: a stored row never crashes the pane, however it was damaged.
 */
export function readKeptAgents(stored: unknown): AgentRow[] {
  if (!Array.isArray(stored)) {
    return []
  }
  const out: AgentRow[] = []
  // One row per ID: a repeated ID keeps its first place, so the labels after it stay as stored.
  const ids = new Set<string>()
  for (const raw of stored as unknown[]) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || r.id === '' || ids.has(r.id) || typeof r.description !== 'string' || typeof r.type !== 'string' || typeof r.status !== 'string' || typeof r.brief !== 'string' || !isFinite0(r.startedAt)) {
      continue
    }
    ids.add(r.id)
    // A step and claims stored by an older version were never checked for secrets.
    // They are read with the write's own readers: the same limits hold for a stored row
    // as for a report (at least one step planned, never more done than planned, a step of at most
    // 120 characters, at most 20 claims), so a damaged store never draws 300% or NaN%.
    const claims = Array.isArray(r.claims) ? readClaims({ items: r.claims }) : undefined
    const autoClaims = stringList(r.autoClaims)
    const p = r.progress as Record<string, unknown> | null | undefined
    const progress: Progress | undefined =
      typeof p === 'object' && p !== null && isFinite0(p.done) && isFinite0(p.total) && p.done >= 0 && p.total >= 0
        ? readProgress({ done: p.done, total: p.total, step: p.step })
        : undefined
    out.push({
      id: r.id,
      // A row stored by an older version was never checked for secrets: its text is checked on load.
      description: hideSecretLines(r.description),
      type: r.type,
      status: STATUSES.includes(r.status as AgentRowStatus) ? (r.status as AgentRowStatus) : 'ended',
      startedAt: r.startedAt,
      toolCalls: isFinite0(r.toolCalls) && r.toolCalls >= 0 ? r.toolCalls : 0,
      brief: storedBrief(r.brief),
      ...(typeof r.model === 'string' ? { model: r.model } : {}),
      ...(isFinite0(r.endedAt) ? { endedAt: r.endedAt } : {}),
      ...(isFinite0(r.tokens) && r.tokens >= 0 ? { tokens: r.tokens } : {}),
      ...(typeof r.doing === 'string' ? { doing: hideDoing(r.doing) } : {}),
      // The name comes from the engine and is drawn: checked as the description is.
      ...(typeof r.name === 'string' ? { name: hideSecretLines(r.name) } : {}),
      ...(isFinite0(r.idleSince) ? { idleSince: r.idleSince } : {}),
      ...(progress === undefined ? {} : { progress }),
      ...(claims === undefined ? {} : { claims }),
      ...(autoClaims === undefined ? {} : { autoClaims }),
    })
  }

  return out
}

/** The largest label base kept: a label is A and at most 6 digits, which is what a prompt's label is read as. */
export const MAX_BASE = 999_000

/** Reads the stored label base back: a whole number from 0 to MAX_BASE, else 0. */
export function readKeptBase(stored: unknown): number {
  return typeof stored === 'number' && Number.isSafeInteger(stored) && stored >= 0 && stored <= MAX_BASE ? stored : 0
}

/** The most IDs of cut rows kept per session; the oldest go first. */
export const KEPT_CUT = 5000

/**
 * How many cut rows that the agent list shows live may come back into the window now: the
 * free places, plus the ended rows at its old end, which the next cut takes first. The cut is for
 * ended rows that would come back empty with every refresh; a live agent is still work on the board,
 * so it comes back (as a new row, with a new label), but never by pushing out another live row,
 * which would then come back in its turn with every refresh. `newAgents` counts the agents of this
 * refresh that have no row and are not cut: they take the places first.
 */
export function cutReturnSlots(rows: readonly { status: AgentRowStatus }[], newAgents = 0): number {
  let lead = 0
  while (lead < rows.length && isEnded(rows[lead]!.status)) {
    lead += 1
  }

  // Each agent new in this refresh takes a place first: a returning row must not push out a live row for it.
  return Math.max(0, KEPT_AGENTS - rows.length + lead - Math.max(0, newAgents))
}

/**
 * The ended agents of the engine's list that are older than every cut ID this session keeps
 * (`isCut`): a high-water mark by list place, which is start order. The cut IDs are
 * dropped oldest first, so such an agent was cut and its ID fell off the KEPT_CUT cap; without the
 * mark it would come back as a new row with every refresh and push the labels on. The mark is the
 * oldest cut ID, not the oldest row: a live agent from the old part of the list that came back has
 * a row there, and would move the mark. A live agent is never in the set: it comes back as
 * cutReturnSlots allows. Empty when the list holds no cut ID, since then there is no mark.
 */
export function forgottenCut(listed: readonly { id: string; status: string }[], isCut: (id: string) => boolean): Set<string> {
  const mark = listed.findIndex(info => isCut(info.id))
  const out = new Set<string>()
  for (let at = 0; at < mark; at += 1) {
    const info = listed[at]!
    if (isEnded(info.status as AgentRowStatus)) {
      out.add(info.id)
    }
  }

  return out
}

/** Reads the stored IDs of the rows cut from the kept window back: strings only, at most KEPT_CUT, the newest kept. */
export function readKeptCut(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((one): one is string => typeof one === 'string' && one !== '').slice(-KEPT_CUT) : []
}

/** Reads one archive file's stored record back: the blocks written last, as lines; null or a bad value is none. */
export function readKeptBlocks(stored: unknown): string[][] {
  return Array.isArray(stored) ? stored.filter((one): one is string[] => Array.isArray(one) && one.every(line => typeof line === 'string')) : []
}

/** Reads the stored archive-write record back: file path to the blocks written last, keeping well-formed entries. The per-session form of 0.7, read only where an archive file has no record of its own. */
export function readKeptWrote(stored: unknown): Map<string, string[][]> {
  const out = new Map<string, string[][]>()
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return out
  }
  for (const [path, blocks] of Object.entries(stored as Record<string, unknown>)) {
    if (Array.isArray(blocks)) {
      out.set(path, blocks.filter((one): one is string[] => Array.isArray(one) && one.every(line => typeof line === 'string')))
    }
  }

  return out
}

/** How many sessions keep their data in the store; the per-session keys of older ones are cleared. */
export const KEPT_SESSIONS = 20
/** The per-session store keys pruning removes. `archived` is no longer written (the board has no Done column); old keys of it are still pruned. `reserved`: the reservation key of a session with neither a repo nor a todo folder. */
export const SESSION_PREFIXES = ['agents', 'agents-base', 'archived', 'series', 'orchestrator', 'orchestrator-title', 'tokens', 'archive-wrote', 'reserved', 'agents-cut'] as const

/** How often a running session notes itself in the session list again, and how long a note keeps a session from pruning. */
export const SESSION_TOUCH_MS = 10 * 60_000
export const SESSION_LIVE_MS = 6 * SESSION_TOUCH_MS
/** How soon a note that failed is tried again: well inside SESSION_LIVE_MS, and not with every redraw. */
export const SESSION_RETRY_MS = 60_000

/** One entry of the stored session list: a session ID and the last time it noted itself, clock ms. */
export type SessionEntry = [string, number]

/** True when the stored list holds a plain ID: the older form, whose times are in the old `sessions-seen` key. */
export function isOldSessionList(stored: unknown): boolean {
  return Array.isArray(stored) && stored.some(one => typeof one === 'string')
}

/**
 * The session list after `me` notes itself at `time`: `me` last, then the sessions that
 * fall off. Each entry holds its own time, so one write stores the list and the times together: no
 * race between two keys, and no failed second write, leaves a session with no time. A session falls
 * off when it is older than the last KEPT_SESSIONS and has not noted itself in the last
 * SESSION_LIVE_MS, so a session that runs for days is never pruned while it runs: its save notes it
 * every SESSION_TOUCH_MS, timed with `elapsedSince`, so a clock set back does not stop the notes (,
 * ). A session that runs while its process is stopped (no saves) can still fall off. The older form
 * (plain IDs, their times in `seenStored`) is read for migration: a plain ID with no time falls off
 * only when it is past the last KEPT_SESSIONS; inside them it takes `time`, so it stays for
 * SESSION_LIVE_MS more and has time to note itself.
 */
export function nextSessions(stored: unknown, seenStored: unknown, me: string, time: number): { list: SessionEntry[]; dropped: string[]; untimed: string[]; isListed: boolean } {
  const seenIn = typeof seenStored === 'object' && seenStored !== null && !Array.isArray(seenStored) ? (seenStored as Record<string, unknown>) : {}
  const finite = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n : undefined)
  // The last entry of a repeated ID wins, at the place of its last entry: it is the newest note.
  const times = new Map<string, number | undefined>()
  let isListed = false
  for (const one of Array.isArray(stored) ? (stored as unknown[]) : []) {
    const id = typeof one === 'string' ? one : Array.isArray(one) && typeof one[0] === 'string' ? one[0] : undefined
    isListed ||= id === me
    if (id === undefined || id === '' || id === me) {
      continue
    }
    times.delete(id)
    times.set(id, typeof one === 'string' ? finite(seenIn[id]) : finite((one as unknown[])[1]))
  }
  // A time in the future (a clock set back, a bad write) counts as now: it ages out like any other note and never stays for good.
  for (const [id, one] of times) {
    if (one !== undefined && one > time) {
      times.set(id, time)
    }
  }
  const all = [...times.keys(), me]
  const over = all.slice(0, Math.max(0, all.length - KEPT_SESSIONS))
  const dropped = over.filter(id => !(time - (times.get(id) ?? -Infinity) < SESSION_LIVE_MS))
  const gone = new Set(dropped)
  const list = all.filter(id => !gone.has(id)).map((id): SessionEntry => [id, id === me ? time : (times.get(id) ?? time)])

  // `untimed`: the dropped IDs with no time at all (a list of an older version), which no running version notes.
  return { list, dropped, untimed: dropped.filter(id => times.get(id) === undefined), isListed }
}

/**
 * How long a session found droppable waits before its keys are cleared: longer than a
 * running session takes to note itself again (SESSION_TOUCH_MS, plus a redraw), so a live session
 * whose note was lost in a race (another session read the list before the note and wrote after it)
 * notes itself again first.
 */
export const SESSION_DROP_CONFIRM_MS = 2 * SESSION_TOUCH_MS
/** The most sessions waiting for their keys to be cleared that the store keeps. */
const KEPT_DROPPING = 200

/** Reads the stored sessions waiting to be cleared back: `[id, first found droppable]` entries, the newest KEPT_DROPPING. */
export function readDropping(stored: unknown): Map<string, number> {
  const out = new Map<string, number>()
  for (const one of Array.isArray(stored) ? (stored as unknown[]).slice(-KEPT_DROPPING) : []) {
    if (Array.isArray(one) && typeof one[0] === 'string' && one[0] !== '' && typeof one[1] === 'number' && Number.isFinite(one[1])) {
      out.set(one[0], one[1])
    }
  }

  return out
}

/**
 * The two-step clear of dropped sessions. A session that falls off the list (`found`) is
 * not cleared at once: it waits in `pending`, and its keys are cleared (`confirmed`) only by a note
 * made at least SESSION_DROP_CONFIRM_MS after it was first found, in which a read of the list still
 * does not show it live (`live`). A session that noted itself meanwhile leaves `pending`. Any session
 * may make the second step, since `pending` is stored. A clock set back restarts the wait.
 */
export function nextDropping(pending: ReadonlyMap<string, number>, found: readonly string[], live: ReadonlySet<string>, time: number): { pending: Map<string, number>; confirmed: string[] } {
  const next = new Map<string, number>()
  const confirmed: string[] = []
  for (const [id, since] of pending) {
    if (live.has(id)) {
      continue
    }
    const { ms, from } = elapsedSince(since, time)
    if (ms >= SESSION_DROP_CONFIRM_MS) {
      confirmed.push(id)
    } else {
      next.set(id, from)
    }
  }
  for (const id of found) {
    if (!live.has(id) && !next.has(id) && !confirmed.includes(id)) {
      next.set(id, time)
    }
  }

  return { pending: new Map([...next].slice(-KEPT_DROPPING)), confirmed }
}

/**
 * The IDs the stored session list shows live at `time`: a note newer than SESSION_LIVE_MS.
 * Read again just before the keys of dropped sessions are cleared, so a session that woke and noted
 * itself meanwhile, while this call worked from a stale list, keeps its keys.
 */
export function liveSessionIds(stored: unknown, time: number): Set<string> {
  const live = new Set<string>()
  for (const one of Array.isArray(stored) ? (stored as unknown[]) : []) {
    if (Array.isArray(one) && typeof one[0] === 'string' && typeof one[1] === 'number' && Number.isFinite(one[1]) && time - Math.min(one[1], time) < SESSION_LIVE_MS) {
      live.add(one[0])
    }
  }

  return live
}

/** Longest brief kept in the store, IDs included: enough to find a #ID or a quoted item; the full text stays in memory. */
export const STORED_BRIEF = 600

/** The longest ID kept from the cut-off part; a longer `#word` is not a ticket ID. */
const STORED_ID_MAX = 16

/**
 * The brief as stored: a line that looks like it holds a secret is hidden (its #IDs kept), checked
 * in the form normalize gives it (a stored brief is normalized: one line, no `_`), then the
 * head, plus the ticket IDs the cut-off part names, so linking by ID survives a reload. The result
 * never passes STORED_BRIEF characters: the IDs take at most half of it, and the head
 * gives way to them. A cut never splits a surrogate pair.
 */
export function storedBrief(brief: string): string {
  const known = storedBriefs.get(brief)
  if (known !== undefined) {
    return known
  }
  const stored = cutBrief(hideNormalizedSecretLines(brief))
  // A small cache, cleared when full: a brief rarely changes, and every save of the rows asks again.
  // Measured: 200 rows of 4,000-character briefs take about 22 ms per save without it.
  if (storedBriefs.size >= KEPT_AGENTS * 2) {
    storedBriefs.clear()
  }
  storedBriefs.set(brief, stored)

  return stored
}

/** The stored form of each brief seen, by its full text. */
const storedBriefs = new Map<string, string>()

/** The head and the cut-off IDs of a brief whose secrets are already hidden, at most STORED_BRIEF characters. */
function cutBrief(text: string): string {
  if (text.length <= STORED_BRIEF) {
    return text
  }
  const tokens = [...text.matchAll(/#t[0-9a-z]+/g)].map(match => ({ id: match[0], at: match.index }))
  // The head shrinks as IDs are added, and an ID it drops then joins the kept ones: repeat until it fits.
  let headLength = STORED_BRIEF
  for (;;) {
    // An ID across the cut moves the cut to its start, so no part of it stays in the head.
    const cutAt = tokens.find(one => one.at < headLength && one.at + one.id.length > headLength)?.at ?? headLength
    const ids = [...new Set(tokens.filter(one => one.at >= cutAt && one.id.length <= STORED_ID_MAX).map(one => one.id))]
    let suffix = ''
    for (const id of ids) {
      if (suffix.length + 1 + id.length > STORED_BRIEF / 2) {
        break
      }
      suffix += ` ${id}`
    }
    if (headLength + suffix.length <= STORED_BRIEF) {
      const head = text.slice(0, cutAt).trimEnd()

      return `${/[\ud800-\udbff]$/.test(head) ? head.slice(0, -1) : head}${suffix}`
    }
    headLength = STORED_BRIEF - suffix.length
  }
}
