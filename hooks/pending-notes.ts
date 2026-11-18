/** The notes held for Claude: moves, renames, numbered tickets, removed tickets and ended agents. */

import type { AgentRow } from '../types'
import { isEnded } from './agent-ends'
import { agentLabel } from './agent-identity'
import type { PendingNotes } from './claude-notes'
import { claimNotes, deferredNote, endedNote, movesNote, numberedNote, removedNote, renameNote, stoppedNote, withoutTold } from './claude-notes'
import { linkOne } from './links'
import { S, nudgedAgents } from './state'

/** The lists of note lines waiting for Claude, as they are now: what queuedNotes builds from them now. */
export function pendingNotes(): PendingNotes {
  return { moves: S.pendingMoves, renames: S.pendingRenames, numbered: S.pendingNumbered, removed: S.pendingRemoved, ended: pendingEnded, stopped: S.pendingStopped, deferred: S.pendingDeferred, claimed: S.pendingClaimed }
}

/**
 * Takes out of the waiting lists the lines `told` held, once their note reached Claude.
 * A line queued while the prompt or tool call ran stays for the next one.
 */
export function forgetTold(told: PendingNotes): void {
  S.pendingMoves = withoutTold(S.pendingMoves, told.moves)
  S.pendingRenames = withoutTold(S.pendingRenames, told.renames)
  S.pendingNumbered = withoutTold(S.pendingNumbered, told.numbered)
  S.pendingRemoved = withoutTold(S.pendingRemoved, told.removed)
  pendingEnded = withoutTold(pendingEnded, told.ended)
  S.pendingStopped = withoutTold(S.pendingStopped, told.stopped)
  S.pendingDeferred = withoutTold(S.pendingDeferred, told.deferred)
  S.pendingClaimed = withoutTold(S.pendingClaimed, told.claimed)
}

/** Puts the lines `told` held back in front of the waiting lists: their note never reached Claude. */
export function restoreTold(told: PendingNotes): void {
  S.pendingMoves = [...told.moves, ...S.pendingMoves]
  S.pendingRenames = [...told.renames, ...S.pendingRenames]
  S.pendingNumbered = [...told.numbered, ...S.pendingNumbered]
  S.pendingRemoved = [...told.removed, ...S.pendingRemoved]
  pendingEnded = [...told.ended, ...pendingEnded]
  S.pendingStopped = [...told.stopped, ...S.pendingStopped]
  S.pendingDeferred = [...told.deferred, ...S.pendingDeferred]
  S.pendingClaimed = [...told.claimed, ...S.pendingClaimed]
}

/** The notes waiting for Claude: the moves made by hand, the IDs a consolidation renumbered, and the agents that ended with tickets left open. */
export function queuedNotes(): string[] {
  return [movesNote(S.pendingMoves), stoppedNote(S.pendingStopped), deferredNote(S.pendingDeferred), renameNote(S.pendingRenames), removedNote(S.pendingRemoved), numberedNote(S.pendingNumbered), ...claimNotes(S.pendingClaimed), ...pendingEnded].filter((note): note is string => note !== undefined)
}

/** Notes about ended agents, waiting for Claude. Cleared with the other pending notes. */
let pendingEnded: string[] = []

/**
 * Queues one note for each agent that went from live to ended between `before` and `after`, when
 * tickets it worked on are still open or in progress. The links are read as for a live agent, since
 * an ended agent links to nothing. The mod never changes a box itself: Claude closes the work done.
 */
export function noteEnds(before: readonly AgentRow[], after: readonly AgentRow[]): void {
  const live = new Set(before.filter(row => !isEnded(row.status)).map(row => row.id))
  after.forEach((row, index) => {
    if (!live.has(row.id) || !isEnded(row.status) || nudgedAgents.has(row.id)) {
      return
    }
    nudgedAgents.add(row.id)
    const found = linkOne(S.todoFiles, { ...row, status: 'running' })
    if (found.length > 0) {
      const how = row.status === 'completed' ? 'finished' : `ended (${row.status})`
      pendingEnded = [...pendingEnded, endedNote(agentLabel(index), how, found.map(link => link.item))]
    }
  })
}
