/** The refresh of the agent rows from the engine agent list, and the Stop of an agent. */

import type { EngineInterface } from 'claude-code'
import type { AgentRow, AgentRowStatus } from '../types'
import { isEnded, unlistedEnds } from './agent-ends'
import { colorSlots } from './agent-colors'
import { AGENT_COLORS, agentLabel, setColorSlots } from './agent-identity'
import { clock, tokens } from './card-format'
import { elapsedSince } from './clock-elapsed'
import { pruneTo } from './key-prune'
import { cutReturnSlots, forgottenCut } from './kept-records'
import { normalize } from './normalize'
import { sameRows } from './row-equality'
import { hideSecretLines } from './secrets'
import { ticketSummary } from './ticket-prompts'
import { isTurnKept } from './token-usage'
import { failAfter, RUN_LIMIT_MS } from './time-limit'
import { matchAgent } from './agent-matching'
import { setRows } from './agent-rows'
import { bookKeep } from './category-sort'
import { loadAgents } from './kept-store'
import { CLOCK_MS } from './pane-constants'
import { redraw } from './pane-redraw'
import { noteEnds } from './pending-notes'
import { S, claimCheckedAt, cutRowIds, endedHere, loadedGroups, matchFailures, matchedAgents, namedAt, nudgedAgents, orchTickets, pendingTokens, pendingTools, seenTurns, sortTries, stepModels } from './state'
import { showToast } from './toasts'
import { readUsage } from './token-burn'

/**
 * The kill switch on a live agent's card: stops the agent at once through TaskStop, which aborts
 * its loop. The agent gets no turn to wind down or sum up.
 */
export async function stopAgent($: EngineInterface, id: string): Promise<void> {
  // By ID, not by place: the rows shift when old ones are cut or a store merges, and a press on a tree drawn before the shift must stop the agent on its card.
  const index = S.agentRows.findIndex(one => one.id === id)
  const row = S.agentRows[index]
  if (row === undefined || isEnded(row.status)) {
    return
  }
  // Only the stop call is in the try: a throw after a stop that worked (the success toast) never reads as "Could not stop".
  let isStopped = false
  try {
    const stopped = (await $.tool.call({ tool: 'TaskStop', task_id: row.id } as never)) as { deny?: string; isError?: boolean; text?: string }
    if (stopped.deny !== undefined || stopped.isError === true) {
      throw new Error(stopped.deny ?? stopped.text ?? 'TaskStop failed')
    }
    isStopped = true
  } catch (error) {
    showToast($, `Could not stop ${agentLabel(index)}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (isStopped) {
    const old = S.agentRows
    setRows(S.agentRows.map(one => (one.id === row.id ? { ...one, status: 'killed', endedAt: one.endedAt ?? S.clockMs } : one)))
    endedHere.add(row.id)
    noteEnds(old, S.agentRows)
    try {
      // Every stored description is already hidden; the toast checks again, so no path can show one.
      showToast($, `Stopped ${agentLabel(index)}: ${ticketSummary(hideSecretLines(row.description), 60)}`)
    } catch {
      // A toast that fails has nowhere left to tell; the stop itself worked.
    }
  }
  await refreshAgents($, true).catch(() => undefined)
}

/** The color slot each agent was first drawn with, by agent ID: a woken agent's replayed slot never moves another agent's color. */
const slotPins = new Map<string, number>()

/** Counts the refreshes started: the one that started last sets the view time. */
let refreshSeq = 0

/** When each live row was first missing from the agent list, by agent ID: the start of its grace. */
let missingSince = new Map<string, number>()

/**
 * Merges the agent list and the pending tool calls and tokens into the rows, and redraws only on a
 * change of status, once every 5 s (STG-PERF-1), or when forced at the end of an agent's turn; the
 * CSS motion runs on between redraws.
 */
export async function refreshAgents($: EngineInterface, isForced = false): Promise<void> {
  refreshSeq += 1
  const seq = refreshSeq
  const time = await $.clock.now()
  S.wallMs = time
  await loadAgents($).catch(() => undefined)
  // The kept token count too: a load that no session.start follows (a plugin reload) still seeds the trace from it.
  await readUsage($).catch(() => undefined)
  // Bounded (-015): an agent list that never answers fails this refresh, which its caller counts, instead of holding every later tick.
  const listed = await failAfter($.agent.list(), RUN_LIMIT_MS, (ms, fire) => $.clock.after(ms, fire))
  const rows = S.agentRows
  const known = new Map(rows.map(row => [row.id, row]))
  // The agents new in this refresh take places before a cut row returns, so a return never pushes out a live row.
  // An ended agent listed before every cut ID kept is a cut row whose ID fell off KEPT_CUT: it stays cut, so it never comes back as a new row with every refresh.
  const forgotten = loadedGroups.has('rows') && cutRowIds.size > 0 ? forgottenCut(listed, one => cutRowIds.has(one)) : new Set<string>()
  const freshIds = new Set(listed.filter(info => !known.has(info.id) && !cutRowIds.has(info.id) && !forgotten.has(info.id)).map(info => info.id))
  let returnSlots = cutReturnSlots(rows, freshIds.size)
  for (const info of listed) {
    const row = known.get(info.id)
    if (row === undefined && forgotten.has(info.id)) {
      continue
    }
    // A row cut from the kept window stays cut: added back it would be a new row with no data, every refresh.
    // A live one comes back while a place is free or an ended row goes for it: its agent is still at work.
    if (row === undefined && cutRowIds.has(info.id)) {
      if (isEnded(info.status as AgentRowStatus) || returnSlots === 0) {
        continue
      }
      returnSlots -= 1
      cutRowIds.delete(info.id)
      S.cutRowVersion += 1
    }
    const listedState = info.status as AgentRowStatus
    // A row this session ended (a Stop, a notification) keeps its end over a list that still says live; an ended status from the list is taken.
    const state = row !== undefined && endedHere.has(info.id) && isEnded(row.status) && !isEnded(listedState) ? row.status : listedState
    // The description is drawn as the card title, stored and toasted: its secrets are hidden first.
    const description = hideSecretLines(info.description || row?.description || info.name || info.id)
    known.set(info.id, {
      id: info.id,
      description,
      type: info.type,
      model: row?.model ?? stepModels.get(info.id),
      status: state,
      startedAt: row?.startedAt ?? time,
      endedAt: isEnded(state) ? (row?.endedAt ?? time) : undefined,
      toolCalls: row?.toolCalls ?? 0,
      ...(row?.tokens === undefined ? {} : { tokens: row.tokens }),
      ...(row?.idleSince === undefined ? {} : { idleSince: row.idleSince }),
      doing: row?.doing,
      brief: row?.brief ?? normalize(hideSecretLines(description)),
      ...(row?.progress === undefined ? {} : { progress: row.progress }),
      ...(row?.claims === undefined ? {} : { claims: row.claims }),
      ...(row?.autoClaims === undefined ? {} : { autoClaims: row.autoClaims }),
      // The name is drawn and stored: its secrets are hidden as the description's are.
      ...(info.name === undefined ? {} : { name: hideSecretLines(info.name) }),
    })
  }
  // An agent the engine no longer lists has ended, though nothing said how: without this its row
  // stays live for good. A new agent gets a grace period, since its spawn starts the row before
  // the list has it.
  // The grace counts from the first refresh that missed the agent, not from its start.
  const listedIds = new Set(listed.map(info => info.id))
  const unlisted = unlistedEnds([...known.values()], listedIds, missingSince, time)
  missingSince = unlisted.missing
  for (const id of unlisted.ended) {
    const row = known.get(id)!
    known.set(id, { ...row, status: 'ended', endedAt: time })
  }
  const listedRows = [...known.values()]
  // A start, an end or a new agent redraws at once; tool-call counts and the current call ride
  // along with the next clock step, so a busy agent redraws the pane every 5 s, not every second.
  const isStatusChanged = !sameRows(listedRows, rows)
  matchNewAgents($, listedRows)
  // Timed with elapsedSince: after a clock set back, the 5 s redraws go on.
  const sinceClock = elapsedSince(S.lastClock, time)
  S.lastClock = sinceClock.from
  if (!isForced && !isStatusChanged && sinceClock.ms < CLOCK_MS) {
    return
  }
  for (const [id, seen] of pendingTools) {
    const row = known.get(id)
    if (row !== undefined) {
      known.set(id, { ...row, toolCalls: row.toolCalls + seen.calls, doing: seen.doing })
    }
  }
  pendingTools.clear()
  for (const [id, used] of pendingTokens) {
    const row = known.get(id)
    if (row !== undefined) {
      known.set(id, { ...row, tokens: (row.tokens ?? 0) + used })
      pendingTokens.delete(id)
    }
  }
  const next = [...known.values()]
  noteEnds(rows, next)
  setRows(next)
  S.lastClock = time
  // Only the latest refresh to start sets the view time: one that read its time earlier can finish after a later one, and must not step the time back.
  // A clock set back still moves it, as the latest refresh read it.
  if (seq === refreshSeq) {
    S.clockMs = time
  }
  pruneAgentState()
  redraw($)
}

/**
 * Drops the per-agent and per-item state of agents and items gone, so none of it grows
 * over a long session: by agent ID, to the rows kept plus the cut IDs; the times tickets were named,
 * to the orchestrator's tickets; the sort tries, to the items the scan read, and only when every
 * place read (an item in a place that did not read is not known to be gone).
 */
function pruneAgentState(): void {
  const rowIds = new Set(S.agentRows.map(row => row.id))
  const isAgent = (id: string) => rowIds.has(id) || cutRowIds.has(id)
  for (const held of [claimCheckedAt, matchedAgents, matchFailures, stepModels, nudgedAgents, pendingTokens, endedHere, slotPins]) {
    pruneTo(held, isAgent)
  }
  pruneTo(seenTurns, key => isTurnKept(key, isAgent))
  pruneTo(namedAt, key => orchTickets.has(key))
  pruneTo(sortTries, bookKeep())
}

/** Starts the one model match for each live agent that has not had it. */
export function matchNewAgents($: EngineInterface, rows: readonly AgentRow[]): void {
  for (const row of rows) {
    if (!isEnded(row.status)) {
      void matchAgent($, row.id, row.brief).catch(() => undefined)
    }
  }
}

/** Gives every row its color slot, keeping the slot each agent was first drawn with (the cards read it through agentColor). */
export function pinColorSlots(rows: readonly AgentRow[]): void {
  const slots = colorSlots(
    rows.map(row => ({ startedAt: row.startedAt, endedAt: row.endedAt, idleSince: row.idleSince, isEnded: isEnded(row.status), ...(slotPins.has(row.id) ? { pinned: slotPins.get(row.id)! } : {}) })),
    AGENT_COLORS.length,
  )
  rows.forEach((row, i) => slotPins.set(row.id, slots[i]!))
  setColorSlots(slots)
}

/** Marks an agent at work again: its tool call or model request ends its idle time. */
export function wake(id: string): void {
  if (S.agentRows.some(row => row.id === id && row.idleSince !== undefined)) {
    setRows(
      S.agentRows.map(row => {
        if (row.id !== id) {
          return row
        }
        const { idleSince: _, ...awake } = row

        return awake
      }),
    )
  }
}
