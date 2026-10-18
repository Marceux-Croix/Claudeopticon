/** The row of an agent spawned again under an ID that already has a row (a resumed agent). */

import type { AgentRow } from '../types'

/**
 * The row of a known agent ID that spawns again: the new spawn's row (its task, brief,
 * model, start and status), with the counts of the old row kept: its tool calls and its tokens. The
 * caller keeps the row's place, so its label and the labels after it stay. What belonged to the old
 * task goes: its end, idle time, progress, claims and the model match of the old brief.
 */
export function respawnedRow(known: AgentRow, fresh: AgentRow): AgentRow {
  return {
    ...fresh,
    toolCalls: known.toolCalls,
    ...(known.tokens === undefined ? {} : { tokens: known.tokens }),
  }
}
