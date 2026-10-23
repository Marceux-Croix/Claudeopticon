/**
 * Peer sessions: which tickets other Claude Code sessions on the same repo hold. Each session keeps a
 * presence record in the shared store (`presence:<session id>`); every session reads its peers' records
 * and marks their tickets "Peer owned", with "<name> owns this" in the hover tip on its board. Pure logic only: the store calls live in register.tsx.
 */

import type { AgentRow, TodoFile } from '../types'
import { cutText } from './card-text'
import { isEnded } from './agent-ends'
import { fileId, itemKey, keptKey, storedKey } from './item-keys'
import { linkAgents } from './links'

/** A session refreshes its record at most this often while it runs, and at once when its holdings change. */
export const PRESENCE_EVERY_MS = 5000
/** A session reads its peers' records this often. */
export const PEERS_EVERY_MS = 5000
/** A record not refreshed for this long is shown dimmed, with its inactive time in the tip: the session is probably idle or gone. Its claims still count. */
export const PEER_DIM_MS = 120_000
/** A record not refreshed for this long is ignored: the session is gone. The box ends a claim; this only drops a record nothing refreshes. */
export const PEER_IGNORE_MS = 24 * 60 * 60_000
/** Caps on what a peer's record may carry, so a bad record cannot flood the board. */
export const MAX_PRESENCE_TICKETS = 200
const MAX_TICKET_CHARS = 600
const MAX_ROOT_CHARS = 1000
const MAX_ID_CHARS = 200
const MAX_PEERS = 50
export const MAX_NAME = 60

export type Presence = {
  v: 1
  sessionId: string
  name?: string
  /** The main checkout's root: worktrees of one repo share it. */
  root: string
  /** Tickets the session's main conversation holds, by `ticketId`. */
  tickets: string[]
  /** Tickets its live helper agents hold. */
  agentTickets: string[]
  /** Tickets its main conversation queued (`- [>]`) to work next. A record without it reads as empty. */
  planned: string[]
  seenAt: number
}

export const presenceKey = (sessionId: string): string => `presence:${sessionId}`

/** The store key of a session's own planned set, beside `orchestrator:<session id>`. */
export const plannedKey = (sessionId: string): string => `planned:${sessionId}`

/**
 * A ticket's identity across sessions, whatever their cwd: the todo folder's absolute path, the file
 * name, and the stored item key (the item's own key, not the folder-qualified display key, which
 * differs by session: a folder outside the primary one adds its place to the display key).
 */
export function ticketId(file: { folder: string; name: string }, item: { text: string; id?: string; nth?: number }): string {
  return `${fileId(file)}\t${storedKey(itemKey(item))}`
}

/**
 * A session name made safe to store and draw: control characters and markup characters removed,
 * a trailing " [ref]" (ListAgents writes the name with its ref) cut, at most MAX_NAME characters.
 * Undefined when nothing is left.
 */
export function sanitizeSessionName(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined
  }
  const text = input
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/[<>&`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = cutText(text, MAX_NAME).trim()

  return cut === '' ? undefined : cut
}

/** Whether a box is one a claim lives in: in progress or queued. Open and done end a claim. */
const isClaimBox = (status: string): boolean => status === 'in_progress' || status === 'queued'

/**
 * The tickets this session claims, by `ticketId`: `tickets` for its main conversation (the claims in
 * `orchKeys`, stored keys), `agentTickets` for its live agents' links, `planned` for the tickets its main
 * conversation queued (`plannedIds`, ticket IDs). Work in hand (`tickets`, `agentTickets`) counts on any box
 * but done, as this session's own board shows it in In progress; a planned claim only while the box
 * is `[~]` or `[>]`. Archived files hold nothing.
 */
export function holdings(list: readonly TodoFile[], rows: readonly AgentRow[], orchKeys: ReadonlySet<string>, plannedIds: ReadonlySet<string> = new Set()): { tickets: string[]; agentTickets: string[]; planned: string[] } {
  const live = new Set(rows.filter(row => !isEnded(row.status) && row.idleSince === undefined).map(row => row.id))
  const files = list.filter(file => file.isArchived !== true)
  const byId = new Map(files.map(file => [fileId(file), file]))
  const tickets = new Set<string>()
  const planned = new Set<string>()
  for (const file of files) {
    for (const item of file.items) {
      if (item.status !== 'completed' && orchKeys.has(keptKey(file, item))) {
        tickets.add(ticketId(file, item))
      }
      if (isClaimBox(item.status) && plannedIds.has(ticketId(file, item))) {
        planned.add(ticketId(file, item))
      }
    }
  }
  const agentTickets = new Set<string>()
  if (live.size > 0) {
    // Called as buildView calls it, with the whole list and every row: the link index is cached by the list's identity, and a different list would rebuild it at each call.
    for (const [agent, links] of linkAgents(list, rows)) {
      for (const link of live.has(agent) ? links : []) {
        const file = byId.get(link.file)
        if (file !== undefined && link.item.status !== 'completed') {
          agentTickets.add(ticketId(file, link.item))
        }
      }
    }
  }

  return { tickets: [...tickets].slice(0, MAX_PRESENCE_TICKETS), agentTickets: [...agentTickets].slice(0, MAX_PRESENCE_TICKETS), planned: [...planned].slice(0, MAX_PRESENCE_TICKETS) }
}

/** The ticket IDs in `list` whose box is `[~]` or `[>]` in a loaded, live file: what a planned set keeps. A planned ID whose file is not in the list stays (the folder may be unread). */
export function prunePlanned(planned: ReadonlySet<string>, list: readonly TodoFile[]): Set<string> {
  const files = list.filter(file => file.isArchived !== true)
  const loaded = new Set(files.map(fileId))
  const alive = new Set<string>()
  for (const file of files) {
    for (const item of file.items) {
      if (isClaimBox(item.status)) {
        alive.add(ticketId(file, item))
      }
    }
  }
  const kept = [...planned].filter(id => alive.has(id) || !loaded.has(id.split('\t')[0] ?? ''))

  return new Set(kept.slice(-MAX_PRESENCE_TICKETS))
}

/** The keys that are queued after an edit and were not before it: what the main conversation planned. */
export function newlyQueued(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...after].filter(([key, status]) => status === 'queued' && before.get(key) !== 'queued').map(([key]) => key)
}

/** A stored planned set, held to its shape. */
export function readPlanned(stored: unknown): string[] {
  return strings(stored) ?? []
}

/** Local 24-hour HH:MM of a clock time, for the "inactive since" tip. */
export function clockText(ms: number): string {
  const at = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(at.getHours())}:${two(at.getMinutes())}`
}

export function buildPresence(sessionId: string, name: string | undefined, root: string, held: { tickets: string[]; agentTickets: string[]; planned: string[] }, seenAt: number): Presence {
  return { v: 1, sessionId, ...(name === undefined ? {} : { name }), root, tickets: held.tickets, agentTickets: held.agentTickets, planned: held.planned, seenAt }
}

/** Whether two records say the same, the time apart: a refresh within PRESENCE_EVERY_MS is only due when this is false. */
export function samePresence(a: Presence | undefined, b: Presence): boolean {
  return a !== undefined && a.name === b.name && a.root === b.root && a.sessionId === b.sessionId && JSON.stringify([a.tickets, a.agentTickets, a.planned]) === JSON.stringify([b.tickets, b.agentTickets, b.planned])
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one !== '' && one.length <= MAX_TICKET_CHARS).slice(0, MAX_PRESENCE_TICKETS) : undefined

/** A stored record held to its shape, lists and strings capped; undefined for anything else. */
export function readPresence(value: unknown): Presence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const one = value as Record<string, unknown>
  const tickets = strings(one.tickets)
  const agentTickets = strings(one.agentTickets)
  // A record from 0.9.16 has no planned list: it reads as empty. A planned that is not a list is a bad record.
  const planned = one.planned === undefined ? [] : strings(one.planned)
  if (
    one.v !== 1 ||
    typeof one.sessionId !== 'string' ||
    one.sessionId === '' ||
    one.sessionId.length > MAX_ID_CHARS ||
    typeof one.root !== 'string' ||
    one.root === '' ||
    one.root.length > MAX_ROOT_CHARS ||
    tickets === undefined ||
    agentTickets === undefined ||
    planned === undefined ||
    typeof one.seenAt !== 'number' ||
    !Number.isFinite(one.seenAt)
  ) {
    return undefined
  }
  const name = sanitizeSessionName(one.name)

  return { v: 1, sessionId: one.sessionId, ...(name === undefined ? {} : { name }), root: one.root, tickets, agentTickets, planned, seenAt: one.seenAt }
}

/** The IDs of the sessions the store's session list names, but this one, newest last; at most MAX_PEERS. */
export function peerIds(sessionList: unknown, me: string): string[] {
  const ids: string[] = []
  for (const one of Array.isArray(sessionList) ? (sessionList as unknown[]) : []) {
    const id = typeof one === 'string' ? one : Array.isArray(one) && typeof one[0] === 'string' ? one[0] : undefined
    if (id !== undefined && id !== '' && id !== me && id.length <= MAX_ID_CHARS && !ids.includes(id)) {
      ids.push(id)
    }
  }

  return ids.slice(-MAX_PEERS)
}

/** What a peer's claim on a ticket carries to the board: the holder's name and when its record was last refreshed. */
/** `isPlanned`: only the peer's planned list names the ticket; a ticket it or its agents hold is not planned. */
export type PeerClaim = { name?: string; seenAt: number; isPlanned?: true }

/**
 * The tickets peers claim (held, run by an agent, or planned), by `ticketId`. A record counts when it is
 * well formed, names its own key's session, is of another session than `me`, has the same repo root, and
 * was seen within PEER_IGNORE_MS (a time in the future counts as now). A record silent past PEER_DIM_MS
 * still counts; the board dims it. A ticket in `own` is not counted: this session's claim wins. Of two
 * peers on one ticket, the one seen last names it; a ticket one peer works on is held though another plans it, and
 * `isPlanned` marks a ticket only a planned list names. Whether the box still lets the claim stand is the view's call.
 */
export function peerHolds(records: readonly { id: string; value: unknown }[], me: string, root: string, now: number, own: ReadonlySet<string>): Map<string, PeerClaim> {
  const live = records
    .map(one => ({ id: one.id, presence: readPresence(one.value) }))
    .filter((one): one is { id: string; presence: Presence } => one.presence !== undefined && one.id !== me && one.presence.sessionId === one.id && one.presence.root === root && Math.abs(now - one.presence.seenAt) < PEER_IGNORE_MS)
    .sort((a, b) => b.presence.seenAt - a.presence.seenAt)
  const held = new Map<string, PeerClaim>()
  // Held first, from every peer, then planned: a ticket one peer works on is held, though another plans it.
  for (const isPlanned of [false, true]) {
    for (const { presence } of live) {
      for (const ticket of isPlanned ? presence.planned : [...presence.tickets, ...presence.agentTickets]) {
        if (!own.has(ticket) && !held.has(ticket)) {
          held.set(ticket, { ...(presence.name === undefined ? {} : { name: presence.name }), seenAt: presence.seenAt, ...(isPlanned ? { isPlanned: true as const } : {}) })
        }
      }
    }
  }

  return held
}

/** The owner in the tag's hover tip on a ticket a peer holds: its session name, or "An unnamed peer session" when it sent none. */
export const holderName = (name: string | undefined): string => name ?? 'An unnamed peer session'

/**
 * The hover tip of the "Peer owned" tag: "<name> owns this" on a ticket in progress, "<name> plans to work this"
 * on a queued one; a peer silent past PEER_DIM_MS adds " (inactive since HH:MM)" in local 24-hour time.
 */
export function peerTip(peer: { name?: string; isPlanned?: true; silentSince?: number }): string {
  const base = `${holderName(peer.name)} ${peer.isPlanned === true ? 'plans to work this' : 'owns this'}`

  return peer.silentSince === undefined ? base : `${base} (inactive since ${clockText(peer.silentSince)})`
}
