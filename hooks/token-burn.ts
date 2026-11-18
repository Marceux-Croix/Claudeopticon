/** The token usage and the burn trace of the top card. */

import type { EngineInterface } from 'claude-code'
import { clock, tokens } from './card-format'
import { elapsedSince } from './clock-elapsed'
import { addCompact, addTokens } from './series'
import { readKeptUsage } from './token-usage'
import { loadAgents } from './kept-store'
import { CLOCK_MS } from './pane-constants'
import { redraw } from './pane-redraw'
import { seedTrace } from './series-trace'
import { S, stalledKeys } from './state'
import { storeSet, tryGet } from './store-access'

async function burnKey($: EngineInterface): Promise<string> {
  return `tokens:${await $.session.id()}`
}

let burnLoading: Promise<void> | undefined

/**
 * Loads the count once per load of the mod; the count starts the first time the mod sees the
 * session. Every caller awaits the same promise. `isBurnLoaded` turns true only after the read
 * worked; a failed read leaves it false, so the next caller tries again and nothing is stored in
 * the meantime. What was counted before the read worked is added to the stored count.
 */
export function readUsage($: EngineInterface): Promise<void> {
  if (S.isBurnLoaded) {
    return Promise.resolve()
  }
  burnLoading ??= (async () => {
    const got = await tryGet($, await burnKey($))
    if (!got.ok) {
      throw new Error('store read failed')
    }
    const stored = readKeptUsage(got.value)
    if (stored !== undefined) {
      const early = S.usage
      S.usage = {
        tokens: stored.tokens + (early?.tokens ?? 0),
        since: stored.since,
        ...(early?.atCompact !== undefined
          ? { atCompact: stored.tokens + early.atCompact, ...(early.compactAt === undefined ? {} : { compactAt: early.compactAt }) }
          : stored.atCompact === undefined
            ? {}
            : { atCompact: stored.atCompact, ...(stored.compactAt === undefined ? {} : { compactAt: stored.compactAt }) }),
      }
    }
    S.isBurnLoaded = true
    seedTrace()
    if (stored !== undefined) {
      redraw($)
    }
  })().finally(() => {
    burnLoading = undefined
  })

  return burnLoading
}

/**
 * Adds the tokens of one model request (turn.step, main loop and agents alike: the one source of
 * the total and both token traces), or records a compaction.
 */
async function addBurn($: EngineInterface, used: number, isCompact = false): Promise<void> {
  // The clock first: the load below bounds the kept series by it.
  const time = await $.clock.now()
  S.wallMs = time
  await readUsage($).catch(() => undefined)
  await loadAgents($).catch(() => undefined)
  const base = S.usage ?? { tokens: 0, since: time }
  // A count that is not a finite number adds nothing: a NaN would stay in the total and be lost at reload.
  const add = Number.isFinite(used) && used > 0 ? used : 0
  S.usage = isCompact ? { ...base, atCompact: base.tokens, compactAt: time } : { ...base, tokens: base.tokens + add }
  // The plot: the count since the last compaction, a point per request (coalesced per QUANT_MS step); a compaction is a marker and a fall to zero.
  // Series-level: the compactions and seeds are re-timed with the token points.
  S.series = isCompact ? addCompact(S.series, time) : addTokens(S.series, time, S.usage.tokens - (S.usage.atCompact ?? 0), add)
  // Not stored while the stored count is unread: the next report, after a read that worked, adds this one to it.
  if (S.isBurnLoaded) {
    await storeSet($, await burnKey($), S.usage).catch(() => undefined)
  }
  // Redraw at most every CLOCK_MS; the tick draws a report that came sooner. Timed with elapsedSince: a clock set back never stops the redraws for its length.
  const sinceDraw = elapsedSince(S.lastBurnDraw, time)
  S.lastBurnDraw = sinceDraw.from
  if (isCompact || sinceDraw.ms >= CLOCK_MS) {
    S.lastBurnDraw = time
    S.isBurnDirty = false
    redraw($)
  } else {
    S.isBurnDirty = true
  }
}

/**
 * Runs `work` (a count or a refresh) and waits for it unless the store is stalled: while
 * the store answers, the hook returns with its result drawn and stored, as before; once a store key
 * has gone unanswered for STORE_LIMIT_MS, hooks stop waiting on store work until that key answers
 * again (`stalledKeys`). The call that finds the stall waits for its time limit once; no hook waits for good.
 */
export async function unlessStoreWaits(work: Promise<unknown>): Promise<void> {
  const settled = work.then(
    () => undefined,
    () => undefined,
  )
  if (stalledKeys.size === 0) {
    await settled
  }
}

/** The last count queued by burnInOrder; settles when every count before it is added. */
let burnChain: Promise<void> = Promise.resolve()

/**
 * Adds one count after every count queued before it: the hooks no longer wait on the
 * count, so two steps that end close together would otherwise add in the order their store reads
 * answer, and a compaction could land between the wrong steps. Each count is bounded by the store
 * time limit, so one store call that never answers holds the chain for a few STORE_LIMIT_MS, never for good.
 */
export function burnInOrder($: EngineInterface, used: number, isCompact = false): Promise<void> {
  const run = burnChain.then(() => addBurn($, used, isCompact)).catch(() => undefined)
  burnChain = run

  return run
}
