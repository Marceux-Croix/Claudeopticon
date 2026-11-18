/** The top card trace: the live-agent count series and its store key. */

import type { EngineInterface } from 'claude-code'
import { isEnded } from './agent-ends'
import { addAgents, seedSeries } from './series'
import { nowSync } from './pane-clock'
import { S, loadedGroups } from './state'

/** Records the live-agent count when it changed. Waits until the kept series is loaded, so a reload cannot overwrite it. */
export function noteLive(): void {
  if (!loadedGroups.has('series')) {
    return
  }
  const count = S.agentRows.filter(row => !isEnded(row.status) && row.idleSince === undefined).length
  S.series = addAgents(S.series, nowSync(), count)
}

export async function seriesKey($: EngineInterface): Promise<string> {
  return `series:${await $.session.id()}`
}

/**
 * After both the kept count and the kept series are loaded: a series with no token point, or one
 * that lags the kept count (seedSeries), is brought to the kept count, so the trace ends at the
 * value the mod holds (and the compaction is marked when it is inside the window) from the first
 * draw, not from the next model request.
 */
export function seedTrace(): void {
  if (loadedGroups.has('series') && S.isBurnLoaded) {
    S.series = seedSeries(S.series, S.usage, nowSync())
  }
}
