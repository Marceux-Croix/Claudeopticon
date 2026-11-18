/** The tickets the main conversation handles itself, the queued ticket notes and the planned tickets. */

import type { EngineInterface } from 'claude-code'
import type { TodoFile, TodoItem } from '../types'
import { clock } from './card-format'
import type { ItemStatus } from './card-types'
import { keepsMissing, MISSING_CLAIM_MS } from './claim-keeping'
import { elapsedSince } from './clock-elapsed'
import { bestMatches } from './claim-score'
import { NUDGE_REPEAT_MS, NUDGE_TICKETS, plannedLine, stillOpenNote } from './claude-notes'
import { filePath, keptKey, storedKey } from './item-keys'
import { prunePlanned, ticketId } from './peer-sessions'
import type { OrchestratorState } from './view-model'
import { nowSync } from './pane-clock'
import { redraw } from './pane-redraw'
import { S, claimMissedAt, loadedGroups, namedAt, orchTickets } from './state'

/** The live files that hold the todo file at `path`. */
export function filesAt(path: string): TodoFile[] {
  return S.todoFiles.filter(file => file.isArchived !== true && (path === `${file.folder}/${file.name}` || path.endsWith(`/${filePath(file)}`)))
}

/** The live tickets of the todo files: item key to status. With `path`, only the file at that path (else all, when none matches). */
export function ticketStatuses(path?: string): Map<string, ItemStatus> {
  const files = S.todoFiles.filter(file => file.isArchived !== true)
  const same = path === undefined ? [] : files.filter(file => path === `${file.folder}/${file.name}` || path.endsWith(`/${filePath(file)}`))
  const statuses = new Map<string, ItemStatus>()
  for (const file of same.length > 0 ? same : files) {
    for (const item of file.items) {
      const key = keptKey(file, item)
      // One key in two files: in progress wins over queued over open over done.
      const rank = (status?: ItemStatus) => (status === 'in_progress' ? 3 : status === 'queued' ? 2 : status === 'pending' ? 1 : 0)
      if (rank(item.status) >= rank(statuses.get(key))) {
        statuses.set(key, item.status)
      }
    }
  }

  return statuses
}

/** Marks tickets as the orchestrator's own; a new claim is stored and drawn at once. */
export function claimTickets($: EngineInterface, keys: readonly string[]): void {
  const statuses = ticketStatuses()
  // Stored keys only: a claim on a later identical line is a claim on their shared key.
  const fresh = [...new Set(keys.map(storedKey))].filter(key => !orchTickets.has(key))
  for (const key of fresh) {
    orchTickets.set(key, statuses.get(key) === 'in_progress')
  }
  if (fresh.length > 0) {
    redraw($)
  }
}

/**
 * Ends the claims on tickets that are done or gone, and on tickets back to open after they were
 * seen in progress. A ticket sent to Claude is open until Claude starts it, so an open ticket never
 * seen in progress stays claimed. While no todo file is known, each claim ends MISSING_CLAIM_MS after
 * it was first found missing.
 */
export function pruneTickets(): boolean {
  for (const key of [...claimMissedAt.keys()]) {
    if (!orchTickets.has(key)) {
      claimMissedAt.delete(key)
    }
  }
  const time = nowSync()
  let isChanged = false
  if (S.todoFiles.length === 0) {
    // No todo file is known: nothing says a claim's ticket is gone, so the claims stay, but only for MISSING_CLAIM_MS.
    // A claim restored before the first scan waits the same bound, so a reload does not end it at once.
    for (const key of orchTickets.keys()) {
      // A clock set back restarts the bound from now.
      const missed = elapsedSince(claimMissedAt.get(key) ?? time, time)
      claimMissedAt.set(key, missed.from)
      if (missed.ms >= MISSING_CLAIM_MS) {
        orchTickets.delete(key)
        claimMissedAt.delete(key)
        isChanged = true
      }
    }
    if (orchTickets.size === 0 && S.orchTitle !== undefined) {
      S.orchTitle = undefined
      isChanged = true
    }

    return isChanged
  }
  const statuses = ticketStatuses()
  for (const [key, seen] of orchTickets) {
    const status = statuses.get(key)
    // A ticket not found while a folder that could hold it did not read may be in it: its claim stays, for at most MISSING_CLAIM_MS.
    // A first miss in the future (a clock set back) counts as missed now.
    const missedAt = status === undefined ? Math.min(claimMissedAt.get(key) ?? time, time) : undefined
    if (missedAt === undefined) {
      claimMissedAt.delete(key)
    } else {
      claimMissedAt.set(key, missedAt)
    }
    if ((missedAt !== undefined && !keepsMissing(key, S.unreadFolders, S.scanFolders, missedAt, time)) || status === 'completed' || ((status === 'pending' || status === 'queued') && seen)) {
      orchTickets.delete(key)
      claimMissedAt.delete(key)
      isChanged = true
    } else if (status === 'in_progress' && !seen) {
      orchTickets.set(key, true)
      isChanged = true
    }
  }
  // A headline belongs to the tickets: with none left, it goes.
  if (orchTickets.size === 0 && S.orchTitle !== undefined) {
    S.orchTitle = undefined
    isChanged = true
  }

  return isChanged
}

/**
 * One line naming the orchestrator's tickets that are still in progress at the start of a prompt,
 * at most NUDGE_TICKETS, none named in the last NUDGE_REPEAT_MS. Undefined when there is none.
 */
export async function stillOpenLine($: EngineInterface): Promise<string | undefined> {
  const time = await $.clock.now()
  const due: { key: string; item: TodoItem }[] = []
  for (const file of S.todoFiles.filter(one => one.isArchived !== true)) {
    for (const item of file.items) {
      const key = keptKey(file, item)
      const last = namedAt.get(key)
      // Timed with elapsedSince: a clock set back restarts the wait from now, so the note comes again NUDGE_REPEAT_MS later, not after the set-back plus that.
      const since = last === undefined ? undefined : elapsedSince(last, time)
      if (since !== undefined && since.from !== last) {
        namedAt.set(key, since.from)
      }
      if (orchTickets.has(key) && item.status === 'in_progress' && (since === undefined || since.ms >= NUDGE_REPEAT_MS) && !due.some(one => one.key === key)) {
        due.push({ key, item })
      }
    }
  }
  const named = due.slice(0, NUDGE_TICKETS)
  for (const one of named) {
    namedAt.set(one.key, time)
  }

  return stillOpenNote(named.map(one => one.item))
}

/** The orchestrator as the view draws it: Running between the prompt and the end of a main-conversation turn. */
export function orchestratorState(): OrchestratorState {
  const last = S.orchestrator.history[S.orchestrator.history.length - 1]

  return { keys: new Set(orchTickets.keys()), isRunning: S.orchestrator.isActive, toolCalls: S.callCount, ...(last === undefined ? {} : { doing: last.line }), ...(S.orchTitle === undefined ? {} : { title: S.orchTitle }) }
}

/** Ends the planned claims whose box is no longer `[~]` or `[>]`; true when the set changed. Only once the plan set is loaded and a todo file is known. */
export function prunePlannedTickets(): boolean {
  if (S.plannedTickets.size === 0 || S.todoFiles.length === 0 || !loadedGroups.has('tickets')) {
    return false
  }
  const kept = prunePlanned(S.plannedTickets, S.todoFiles)
  if (kept.size === S.plannedTickets.size) {
    return false
  }
  S.plannedTickets = kept

  return true
}

/** The todo item a ticket identity names, in the live files. */
export function itemOfTicket(id: string): TodoItem | undefined {
  for (const file of S.todoFiles.filter(one => one.isArchived !== true)) {
    const item = file.items.find(one => ticketId(file, one) === id)
    if (item !== undefined) {
      return item
    }
  }

  return undefined
}

/**
 * Ends this session's claims, orchestrator and planned, on the tickets `refs` name (IDs or quoted text, matched as `items` are): report_progress `release`.
 * Nothing claims them again until a new move to queued or a new claim. True when a claim ended.
 */
export function releaseTickets(refs: readonly string[]): boolean {
  const live = S.todoFiles.filter(file => file.isArchived !== true)
  const open = live.flatMap(file => file.items.map(item => ({ key: keptKey(file, item), item, id: ticketId(file, item) })))
  let isChanged = false
  for (const hit of bestMatches(open, refs)) {
    const one = open.find(entry => entry.key === hit.key)
    const key = storedKey(hit.key)
    if (orchTickets.delete(key)) {
      claimMissedAt.delete(key)
      isChanged = true
    }
    if (one !== undefined && S.plannedTickets.has(one.id)) {
      S.plannedTickets = new Set([...S.plannedTickets].filter(id => id !== one.id))
      isChanged = true
    }
  }
  if (orchTickets.size === 0 && S.orchTitle !== undefined) {
    S.orchTitle = undefined
  }

  return isChanged
}

/** The ticket IDs of the kept keys in the file at `path`. */
export function plannedIdsOf(path: string, keys: readonly string[]): string[] {
  const wanted = new Set(keys)
  const file = filesAt(path)[0]

  return file === undefined ? [] : file.items.filter(item => wanted.has(keptKey(file, item))).map(item => ticketId(file, item))
}

/** Records tickets the main conversation queued as planned, by kept key (an edit) or by item (the mod's own queueing); a new one redraws and is saved. */
export function planTickets($: EngineInterface, ids: readonly string[]): void {
  const fresh = ids.filter(id => !S.plannedTickets.has(id))
  if (fresh.length > 0) {
    S.plannedTickets = new Set([...S.plannedTickets, ...fresh])
    // A strong hint, not proof: the session may be triaging for others, so Claude is told how to release.
    for (const id of fresh) {
      const item = itemOfTicket(id)
      if (item !== undefined) {
        S.pendingClaimed = [...S.pendingClaimed, plannedLine(item.text, item.id)]
      }
    }
    redraw($)
  }
}
