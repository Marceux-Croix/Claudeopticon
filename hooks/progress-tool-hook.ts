/** The tool.call hook of report_progress: an agent's progress and claims, the main conversation's title, name, claims and releases. */

import type { EngineInterface, ToolCallInput } from 'claude-code'
import { clock } from './card-format'
import { elapsedSince } from './clock-elapsed'
import { bestMatches } from './claim-score'
import { keptKey } from './item-keys'
import { CLAIM_CHECK_MS, progressReply, readClaims, readProgress, readTitle } from './progress-report'
import { sanitizeSessionName } from './peer-sessions'
import { hideTitle } from './secrets'
import { setRows } from './agent-rows'
import { claimTickets, releaseTickets } from './orchestrator-tickets'
import { redraw } from './pane-redraw'
import { S, claimCheckedAt, orchTickets } from './state'
import { scan } from './todo-scan'

export async function onProgressCall($: EngineInterface, e: ToolCallInput) {
  const id = e.agentId
  const input = e as unknown as Record<string, unknown>
  const progress = readProgress(input)
  const claims = readClaims(input)
  const title = id === undefined ? hideTitle(readTitle(input.title)) : undefined
  // The main conversation names its session; the last name wins, and the next presence step stores it.
  const named = id === undefined ? sanitizeSessionName(input.session) : undefined
  if (named !== undefined) {
    S.sessionName = named
  }
  if (id !== undefined && (progress !== undefined || claims !== undefined)) {
    setRows(S.agentRows.map(row => (row.id !== id ? row : { ...row, ...(progress === undefined ? {} : { progress }), ...(claims === undefined ? {} : { claims }) })))
    redraw($)
  }
  // The main conversation gives up claims it holds: tickets it queued for another session, or only to order the work.
  const released = id === undefined ? readClaims({ items: input.release }) : undefined
  if (released !== undefined) {
    await scan($).catch(() => undefined)
    if (releaseTickets(released)) {
      redraw($)
    }
  }
  if (id === undefined && claims !== undefined) {
    // The main conversation names tickets: they are its own. A helper's claim never is.
    await scan($).catch(() => undefined)
    const open = [...S.todoFiles.filter(file => file.isArchived !== true).flatMap(file => file.items.map(item => ({ key: keptKey(file, item), item })))].filter(one => one.item.status !== 'completed')
    claimTickets($, bestMatches(open, claims).map(one => one.key))
  }
  // Only the main conversation titles its own assignment; a helper's title is ignored. It is
  // kept only while the orchestrator owns a ticket.
  if (title !== undefined && orchTickets.size > 0 && title !== S.orchTitle) {
    S.orchTitle = title
    redraw($)
  }
  let reply = 'Noted.'
  if (id !== undefined) {
    const time = await $.clock.now()
    // Timed with elapsedSince: a clock set back restarts the wait, it never stops the check for its length.
    const checked = claimCheckedAt.get(id)
    const since = checked === undefined ? undefined : elapsedSince(checked, time)
    const isDue = claims === undefined && since !== undefined && since.ms >= CLAIM_CHECK_MS
    claimCheckedAt.set(id, claims !== undefined || since === undefined || isDue ? time : since.from)
    reply = progressReply(S.agentRows.find(row => row.id === id)?.claims, isDue)
  }

  return { result: reply }
}
