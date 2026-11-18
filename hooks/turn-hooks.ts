/** The turn.step and turn.complete hooks: the token count of each model request, and the end of a turn. */

import type { EngineInterface, Next, StreamNext, TurnStepInput, TurnStepResult, TurnCompleteInput, TurnCompleteResult } from 'claude-code'
import { isEnded } from './agent-ends'
import { clock } from './card-format'
import { stepUsage, turnKey as turnKeyOf, turnTokens } from './token-usage'
import type { StepUsage } from './token-usage'
import { refreshAgents, wake } from './agent-refresh'
import { setRows } from './agent-rows'
import { redraw } from './pane-redraw'
import { SAID_CHARS, noteDeferred } from './queued-notes'
import { S, pendingTokens, seenTurns, stepModels } from './state'
import { burnInOrder, unlessStoreWaits } from './token-burn'

/**
 * Each model request, the main loop's and every agent's: its tokens, from the step's result, else
 * from its stop chunk, are the one source of the session total and both token traces, counted at
 * the step that used them (never a whole run at its end), and an agent's also go on its card.
 * The count is awaited before the step returns, so it is drawn and stored in order, except while
 * the store is stalled (unlessStoreWaits): a store that never answers must not hold the
 * model request. burnInOrder keeps each step's count in order either way.
 */
export async function* onTurnStep($: EngineInterface, e: TurnStepInput, next: StreamNext<'turn.step', TurnStepInput, TurnStepResult, { 'turn.step': TurnStepInput }>) {
  const agentId = e.agentId
  if (agentId !== undefined) {
    stepModels.set(agentId, e.model)
    wake(agentId)
  }
  // A turn first seen past its first step began before this load: its steps from now are counted.
  const turnKey = turnKeyOf(agentId, e.turnId)
  if (!seenTurns.has(turnKey)) {
    seenTurns.set(turnKey, e.index > 0 ? 0 : undefined)
  }
  const stream = next(e)
  // The main conversation's text, read for tickets it puts off until later (deferredIds).
  let said = ''
  let stopUsage: StepUsage | undefined
  const count = async (used: StepUsage | undefined) => {
    if (used) {
      const n = turnTokens(used)
      const late = seenTurns.get(turnKey)
      if (late !== undefined) {
        seenTurns.set(turnKey, late + n)
      }
      if (agentId !== undefined) {
        pendingTokens.set(agentId, (pendingTokens.get(agentId) ?? 0) + n)
      }
      await unlessStoreWaits(burnInOrder($, n))
    }
  }
  // Counted once on every way out: done, a throw, or a consumer that stops reading
  // (return() at the yield, an interrupt), which runs only the finally.
  let isCounted = false
  // Whether the upstream stream ended on its own (returned or threw): if not, the consumer stopped
  // it, and the stream is owed a return() so its own cleanup runs.
  let isDone = false
  try {
    for (;;) {
      let read: Awaited<ReturnType<typeof stream.next>>
      try {
        read = await stream.next()
      } catch (error) {
        // A stream that breaks after its stop chunk still used the tokens the chunk reports.
        isDone = true
        isCounted = true
        await count(stopUsage)
        throw error
      }
      if (read.done) {
        isDone = true
        isCounted = true
        await count(stepUsage(read.value?.usage, stopUsage))
        if (agentId === undefined) {
          noteDeferred(said)
        }

        return read.value
      }
      if (read.value.kind === 'stop' && read.value.usage) {
        stopUsage = read.value.usage
      }
      if (agentId === undefined && read.value.kind === 'text' && said.length < SAID_CHARS) {
        said += read.value.text
      }
      yield read.value
    }
  } finally {
    try {
      if (!isCounted) {
        isCounted = true
        await count(stopUsage)
      }
    } finally {
      if (!isDone) {
        // A consumer that stops reading must end the stream it took; a failing return() never hides the stop.
        await Promise.resolve(stream.return?.(undefined as never)).catch(() => undefined)
      }
    }
  }
}

/**
 * A turn's usage is not counted here: its requests were counted at each turn.step, and the sum
 * of a whole run at its end would put an agent's tokens at the wrong time (before a compaction).
 * The one exception is a turn that began before this load: its steps before the load
 * were never counted, so its usage less the steps counted since goes in at its end.
 */
export async function onTurnComplete($: EngineInterface, e: TurnCompleteInput, next: Next<'turn.complete', TurnCompleteInput, TurnCompleteResult, { 'turn.complete': TurnCompleteInput }>) {
  const turnKey = turnKeyOf(e.agentId, e.turnId)
  const late = seenTurns.get(turnKey)
  seenTurns.delete(turnKey)
  if (late !== undefined && e.usage !== undefined) {
    const missed = turnTokens(e.usage) - late
    if (missed > 0) {
      if (e.agentId !== undefined) {
        pendingTokens.set(e.agentId, (pendingTokens.get(e.agentId) ?? 0) + missed)
      }
      await unlessStoreWaits(burnInOrder($, missed))
    }
  }
  if (e.agentId !== undefined) {
    // A turn that ends with nothing after it leaves the agent finished but open, until a stop.
    const id = e.agentId
    const time = await $.clock.now()
    setRows(S.agentRows.map(row => (row.id === id && !isEnded(row.status) ? { ...row, idleSince: time } : row)))
    // The end of an agent's turn folds in its last tokens at once, not on the next clock step; not awaited while the store is stalled, so a store that never answers does not hold the turn.
    await unlessStoreWaits(refreshAgents($, true))
  } else {
    S.orchestrator = { ...S.orchestrator, isActive: false }
    redraw($)
  }

  return next(e)
}
