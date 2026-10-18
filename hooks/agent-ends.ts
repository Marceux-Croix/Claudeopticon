/** When an agent has ended: the ended states, the unlisted timeout and its clock, and a task notification's end. */

import type { AgentRowStatus } from '../types'
import { elapsedSince } from './clock-elapsed'

const ENDED: readonly AgentRowStatus[] = ['completed', 'failed', 'killed', 'ended']

export function isEnded(state: AgentRowStatus): boolean {
  return ENDED.includes(state)
}
/** How long a live agent may be missing from the engine's agent list before its row ends. */
export const UNLISTED_MS = 15_000

/**
 * The live rows the engine's list has left for longer than UNLISTED_MS, counted from the
 * first refresh that missed each one, not from its start: a long-running agent that drops out of one
 * list is not ended at once. Returns the IDs to end and the new missing-since map, which holds only
 * the live rows still missing (a row listed again starts over). A clock set back restarts the grace
 * from `time`, so a set-back never keeps a gone agent live for its length.
 */
export function unlistedEnds(rows: readonly { id: string; status: AgentRowStatus }[], listed: ReadonlySet<string>, missing: ReadonlyMap<string, number>, time: number): { ended: Set<string>; missing: Map<string, number> } {
  const ended = new Set<string>()
  const next = new Map<string, number>()
  for (const row of rows) {
    if (listed.has(row.id) || isEnded(row.status)) {
      continue
    }
    const { ms, from } = elapsedSince(missing.get(row.id) ?? time, time)
    if (ms > UNLISTED_MS) {
      ended.add(row.id)
    } else {
      next.set(row.id, from)
    }
  }

  return { ended, missing: next }
}

const NOTIFIED_ENDS: Record<string, AgentRowStatus> = { completed: 'completed', failed: 'failed', killed: 'killed', stopped: 'killed', timeout: 'failed', timed_out: 'failed' }

/** The task ID and end status a task notification reports; none when it reports no end. A background agent's task ID is its agent ID. */
export function notifiedEnd(text: string): { id: string; status: AgentRowStatus } | undefined {
  const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)?.[1]
  const word = (/<status>\s*([^<\s]+)\s*<\/status>/.exec(text)?.[1] ?? '').toLowerCase()
  // An own key only: `constructor` or `__proto__` in the text would give the row a function as its status.
  const status = Object.hasOwn(NOTIFIED_ENDS, word) ? NOTIFIED_ENDS[word] : undefined

  return id === undefined || status === undefined ? undefined : { id, status }
}
