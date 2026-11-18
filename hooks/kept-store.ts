/** The store keys of the kept records, and the load and save of the kept agent rows, tickets, title and series. */

import type { EngineInterface } from 'claude-code'
import { setLabelBase } from './agent-identity'
import { addFailure, isRetryDue } from './backoff'
import type { Failing } from './backoff'
import { clock, tokens } from './card-format'
import { elapsedSince } from './clock-elapsed'
import { storedKey } from './item-keys'
import { MAX_BASE, readKeptAgents, readKeptBase, readKeptCut, readKeptTickets, SESSION_RETRY_MS, SESSION_TOUCH_MS, storedBrief } from './kept-records'
import { readTitle } from './progress-report'
import { plannedKey, readPlanned } from './peer-sessions'
import { hideTitle } from './secrets'
import { readKeptSeries } from './series'
import { cutKey, setRows } from './agent-rows'
import { nowSync } from './pane-clock'
import { SAVE_FAILS_TOAST } from './pane-constants'
import { seedTrace, seriesKey } from './series-trace'
import { pruneSessions } from './session-roster'
import { S, cutRowIds, loadedGroups, matchedAgents, orchTickets, saved } from './state'
import { storeSet, tryGet } from './store-access'
import { showToast } from './toasts'

async function agentsKey($: EngineInterface): Promise<string> {
  return `agents:${await $.session.id()}`
}

/** The store key of the label base: how many agents came before the first kept row. */
async function baseKey($: EngineInterface): Promise<string> {
  return `agents-base:${await $.session.id()}`
}

/** The orchestrator's tickets are kept beside the agent rows, per session, so a reload keeps them. */
async function orchKey($: EngineInterface): Promise<string> {
  return `orchestrator:${await $.session.id()}`
}

async function plannedStoreKey($: EngineInterface): Promise<string> {
  return plannedKey(await $.session.id())
}

async function orchTitleKey($: EngineInterface): Promise<string> {
  return `orchestrator-title:${await $.session.id()}`
}

/** The groups of per-session keys, loaded each on its own: the save names of each group. The rows, their label base and their cut IDs belong together, since the base counts rows. */
export type StoreGroup = 'rows' | 'tickets' | 'title' | 'series'

const GROUP_NAMES: Record<StoreGroup, readonly string[]> = { rows: ['agents', 'base', 'cut'], tickets: ['tickets', 'planned'], title: ['title'], series: ['series'] }

/**
 * The load of what this session kept in the store. Every caller awaits the same promise, so nothing
 * merges twice. Each group loads on its own: a group whose read worked is merged and saved
 * from then on; one whose read failed stays unsaved, and the next caller reads it again.
 * `isAgentsLoaded` turns true once every group is loaded.
 */
let loading: Promise<void> | undefined

export function loadAgents($: EngineInterface): Promise<void> {
  if (S.isAgentsLoaded) {
    return Promise.resolve()
  }
  loading ??= readStores($).finally(() => {
    loading = undefined
  })

  return loading
}

/**
 * Reads each group not loaded yet and merges the ones that read, under what was seen since the
 * load: a row seen since the load wins. An agent whose ticket match already ran is not matched
 * again. Rejects when any group failed, so a caller knows the load is not whole.
 */
async function readStores($: EngineInterface): Promise<void> {
  const want = (['rows', 'tickets', 'title', 'series'] as const).filter(group => !loadedGroups.has(group))
  const keyOf: Record<StoreGroup, () => Promise<string[]>> = {
    rows: () => Promise.all([agentsKey($), baseKey($), cutKey($)]),
    tickets: async () => [await orchKey($), await plannedStoreKey($)],
    title: async () => [await orchTitleKey($)],
    series: async () => [await seriesKey($)],
  }
  const reads = await Promise.all(want.map(async group => ({ group, got: await Promise.all((await keyOf[group]()).map(key => tryGet($, key))) })))
  // The clock is read before any merge: the series read bounds kept points by it, and a clock nothing has read yet is 0, which would drop every kept point as future.
  S.wallMs = Math.max(S.wallMs, await $.clock.now())
  // From here to the end there is no await: each merge is one step, and its group turns loaded with it.
  let isWhole = true
  for (const { group, got } of reads) {
    if (!got.every(one => one.ok)) {
      isWhole = false
      continue
    }
    const values = got.map(one => (one.ok ? one.value : undefined))
    mergeGroup(group, values)
    loadedGroups.add(group)
    // The first save after a load rewrites the group's keys (the title only when there is one).
    for (const name of GROUP_NAMES[group]) {
      saved.delete(name)
    }
    if (group === 'title') {
      saved.set('title', undefined)
    }
  }
  seedTrace()
  if (loadedGroups.size === Object.keys(GROUP_NAMES).length) {
    S.isAgentsLoaded = true
  }
  if (!isWhole) {
    throw new Error('store read failed')
  }
}

/** Merges one group's stored values into the session state. */
function mergeGroup(group: StoreGroup, values: readonly unknown[]): void {
  if (group === 'rows') {
    const [agentsRaw, base, cutRaw] = values
    for (const id of readKeptCut(cutRaw)) {
      cutRowIds.add(id)
    }
    const kept = readKeptAgents(agentsRaw).filter(row => !cutRowIds.has(row.id))
    const keptBase = readKeptBase(base)
    // Never lowered: cuts made while the group did not load moved the base on, and a label once shown keeps its number.
    if (kept.length > 0 && keptBase > S.agentBase) {
      S.agentBase = keptBase
      setLabelBase(S.agentBase)
    }
    // A row the list added back before the cut IDs were read goes again.
    const live = S.agentRows.filter(row => !cutRowIds.has(row.id))
    const seen = new Set(live.map(row => row.id))
    setRows([...kept.filter(row => !seen.has(row.id)), ...live])
    for (const row of kept) {
      if (row.autoClaims !== undefined) {
        matchedAgents.add(row.id)
      }
    }
  } else if (group === 'tickets') {
    for (const [kept, seen] of readKeptTickets(values[0])) {
      // A key stored with a place number is read as its first-place key: never a place.
      const key = storedKey(kept)
      if (!orchTickets.has(key)) {
        orchTickets.set(key, seen)
      }
    }
    // What this load added to the planned set since the read stays; a stored ticket joins it.
    S.plannedTickets = new Set([...readPlanned(values[1]), ...S.plannedTickets])
  } else if (group === 'title') {
    // A title kept by an older version is checked again, as a new one is.
    S.orchTitle ??= hideTitle(readTitle(values[0]))
  } else {
    // A clock still unknown (0) sets no future bound.
    const keptSeries = readKeptSeries(values[0], nowSync() > 0 ? nowSync() : Infinity)
    const after = (points: readonly (readonly [number, number])[], from: readonly (readonly [number, number])[]) => [...from, ...points.filter(point => point[0] > (from[from.length - 1]?.[0] ?? -Infinity))]
    S.series = {
      agents: after(S.series.agents, keptSeries.agents),
      tokens: after(S.series.tokens, keptSeries.tokens),
      compacts: [...keptSeries.compacts, ...S.series.compacts.filter(one => one > (keptSeries.compacts[keptSeries.compacts.length - 1] ?? -Infinity))],
      // The times of seeded points, kept and new, so a reload never counts a seed's rise as usage.
      ...(keptSeries.seeds === undefined && S.series.seeds === undefined ? {} : { seeds: [...new Set([...(keptSeries.seeds ?? []), ...(S.series.seeds ?? [])])] }),
    }
  }
}

/** The stamp of a write still out, so a redraw does not start the same write twice. */
const writing = new Map<string, unknown>()

/** The failed writes in a row of each save name, and when it is tried next. */
const saveFailures = new Map<string, Failing>()

/** The first wait after a failed write, and the longest: 1 s doubling to 5 min. */
const SAVE_RETRY_MS = 1000

const SAVE_RETRY_MAX_MS = 5 * 60_000

/** True once the store toast is shown; shown again only after every key was stored once more. */
let isSaveToastShown = false

/** True once the label-base toast is shown. */
let isBaseToastShown = false

/**
 * Stores `value` under `name`'s key unless `stamp` is what was stored last (or is being stored now).
 * The marker is set when the write resolves, and cleared when it fails. A failed write is tried
 * again with a later redraw, after a wait per key: 1 s, doubled for each failure in a row,
 * up to 5 min, so a store that rejects every write does not get every key again with every redraw.
 * After SAVE_FAILS_TOAST failures in a row, one toast says so.
 */
function saveKey($: EngineInterface, name: string, prefix: string, stamp: unknown, value: unknown): void {
  if ((saved.has(name) && Object.is(saved.get(name), stamp)) || (writing.has(name) && Object.is(writing.get(name), stamp))) {
    return
  }
  if (!isRetryDue(saveFailures.get(name), nowSync(), SAVE_RETRY_MAX_MS)) {
    return
  }
  writing.set(name, stamp)
  void $.session.id()
    .then(id => storeSet($, `${prefix}:${id}`, value))
    .then(
      () => {
        saved.set(name, stamp)
        saveFailures.delete(name)
        if (saveFailures.size === 0) {
          isSaveToastShown = false
        }
      },
      () => {
        saved.delete(name)
        const failing = addFailure(saveFailures.get(name), nowSync(), SAVE_RETRY_MS, SAVE_RETRY_MAX_MS)
        saveFailures.set(name, failing)
        if (failing.count >= SAVE_FAILS_TOAST && !isSaveToastShown) {
          isSaveToastShown = true
          try {
            showToast($, `Claudeopticon cannot save to the store: ${failing.count} writes in a row failed. The pane works, but a reload loses what this session saw.`)
          } catch {
            // A toast that fails must not turn a failed write into an unhandled rejection.
          }
        }
      },
    )
    .finally(() => {
      if (Object.is(writing.get(name), stamp)) {
        writing.delete(name)
      }
    })
}

/**
 * Stores what changed since the last store, for each group whose stored value was loaded:
 * a group that did not read is never written over. Every SESSION_TOUCH_MS it notes the session in
 * the session list again.
 */
export function saveAgents($: EngineInterface): void {
  const time = nowSync()
  // A load with no session start (a hot reload) counts the interval from its first save.
  // A note that failed is not a note: it is tried again SESSION_RETRY_MS after it.
  S.lastTouch ??= time > 0 && S.touchFailedAt === undefined ? time : undefined
  // Timed with elapsedSince: a clock set back restarts the wait from now, so the notes go on and no other session prunes this one.
  const touch = S.lastTouch === undefined ? undefined : elapsedSince(S.lastTouch, time)
  const retry = S.touchFailedAt === undefined ? undefined : elapsedSince(S.touchFailedAt, time)
  S.lastTouch = touch?.from
  S.touchFailedAt = retry?.from
  // After a failed note the retry time is the due time: lastTouch stays old then, so the touch
  // interval alone would make every redraw a try.
  const isDue = retry !== undefined ? retry.ms >= SESSION_RETRY_MS : touch !== undefined && touch.ms >= SESSION_TOUCH_MS
  if (S.agentBase >= MAX_BASE && !isBaseToastShown) {
    isBaseToastShown = true
    showToast($, `Agent labels reached A${MAX_BASE}: from here on, a label may name another agent than it did before.`)
  }
  if (!S.isTouching && isDue) {
    S.isTouching = true
    void pruneSessions($)
      .catch(() => undefined)
      .finally(() => {
        S.isTouching = false
      })
  }
  // Small values compare by text; the archive by identity (it is replaced, never edited); the rows by version.
  if (loadedGroups.has('tickets')) {
    const tickets = JSON.stringify([...orchTickets])
    saveKey($, 'tickets', 'orchestrator', tickets, [...orchTickets])
    saveKey($, 'planned', 'planned', JSON.stringify([...S.plannedTickets]), [...S.plannedTickets])
  }
  if (loadedGroups.has('title')) {
    saveKey($, 'title', 'orchestrator-title', S.orchTitle, S.orchTitle ?? '')
  }
  if (loadedGroups.has('series')) {
    saveKey($, 'series', 'series', JSON.stringify(S.series), S.series)
  }
  if (!loadedGroups.has('rows')) {
    return
  }
  saveKey($, 'base', 'agents-base', S.agentBase, S.agentBase)
  saveKey($, 'cut', 'agents-cut', S.cutRowVersion, [...cutRowIds])
  if (!(saved.has('agents') && saved.get('agents') === S.rowsVersion) && !(writing.has('agents') && writing.get('agents') === S.rowsVersion)) {
    // Every stored brief goes through storedBrief: its secrets hidden and its length capped.
    saveKey(
      $,
      'agents',
      'agents',
      S.rowsVersion,
      S.agentRows.map(row => {
        const brief = storedBrief(row.brief)

        return brief === row.brief ? row : { ...row, brief }
      }),
    )
  }
}
