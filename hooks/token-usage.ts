/** Token usage: the tokens of one turn, and the stored session total read back. */

import type { Usage } from './card-types'

/** Reads a stored count back: finite, non-negative numbers only, the count at compact no more than the total; undefined when it is not one. */
export function readKeptUsage(stored: unknown): Usage | undefined {
  const raw = stored as Partial<Record<keyof Usage, unknown>> | null | undefined
  if (typeof raw !== 'object' || raw === null) {
    return undefined
  }
  const { tokens, since, atCompact, compactAt } = raw
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0 || typeof since !== 'number' || !Number.isFinite(since)) {
    return undefined
  }

  return {
    tokens,
    since,
    // The count at the last compaction is part of the total: clamped to it (UCR-216), so "since compact" is never negative.
    ...(typeof atCompact === 'number' && Number.isFinite(atCompact) && atCompact >= 0 ? { atCompact: Math.min(atCompact, tokens) } : {}),
    ...(typeof compactAt === 'number' && Number.isFinite(compactAt) ? { compactAt } : {}),
  }
}

/** The tokens one model request (or turn) used, every kind summed. */
export function turnTokens(used: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number {
  // A field the engine leaves out (or sets to null or a non-number) counts 0, so the sum is never NaN (UCR-155).
  const part = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

  return part(used.input_tokens) + part(used.output_tokens) + part(used.cache_read_input_tokens) + part(used.cache_creation_input_tokens)
}

/** One model request's usage as the engine reports it, in a step's result or its stop chunk. */
export type StepUsage = Parameters<typeof turnTokens>[0]

/**
 * The usage one model request is counted by: the step result's, unless it is missing (or null) or counts no
 * token, then the stop chunk's (UCR-110: a result of all zeros hid a stop chunk with usage). The
 * two are one report of one request, so the count never adds both.
 */
export function stepUsage(result: StepUsage | null | undefined, stop: StepUsage | undefined): StepUsage | undefined {
  return result != null && turnTokens(result) > 0 ? result : (stop ?? result ?? undefined)
}
