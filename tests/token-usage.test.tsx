import { expect, test } from 'claude-code/testing'

import { readKeptUsage, stepUsage, turnTokens } from '../hooks/token-usage'

test('turnTokens sums every kind', async () => {
  expect(turnTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 400 })).toBe(433)
  expect(turnTokens({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(0)
})

test('readKeptUsage reads a valid count back, with or without atCompact', async () => {
  expect(readKeptUsage({ tokens: 10, since: 5 })).toEqual({ tokens: 10, since: 5 })
  expect(readKeptUsage({ tokens: 0, since: -1, atCompact: 0 })).toEqual({ tokens: 0, since: -1, atCompact: 0 })
  expect(readKeptUsage({ tokens: 10, since: 5, atCompact: 7, extra: 1 })).toEqual({ tokens: 10, since: 5, atCompact: 7 })
})

test('readKeptUsage drops a bad atCompact but keeps the rest', async () => {
  expect(readKeptUsage({ tokens: 10, since: 5, atCompact: -1 })).toEqual({ tokens: 10, since: 5 })
  expect(readKeptUsage({ tokens: 10, since: 5, atCompact: NaN })).toEqual({ tokens: 10, since: 5 })
  expect(readKeptUsage({ tokens: 10, since: 5, atCompact: '3' })).toEqual({ tokens: 10, since: 5 })
})

test('readKeptUsage is undefined for anything that is not a usage', async () => {
  for (const bad of [undefined, null, 5, 'x', {}, { tokens: -1, since: 1 }, { tokens: NaN, since: 1 }, { tokens: Infinity, since: 1 }, { tokens: 1 }, { tokens: 1, since: Infinity }, { tokens: '1', since: 1 }]) {
    expect(readKeptUsage(bad)).toBeUndefined()
  }
})

test('UCR-110 stepUsage: the result, unless it is missing or counts no token; then the stop chunk', () => {
  const used = (n: number) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: n, cache_creation_input_tokens: 0 })
  // The defect: a result of all zeros hid a stop chunk of 5000.
  expect(stepUsage(used(0), used(5000))).toEqual(used(5000))
  // Missing and null results fall back to the stop chunk.
  expect(stepUsage(undefined, used(3000))).toEqual(used(3000))
  expect(stepUsage(null, used(3000))).toEqual(used(3000))
  // A result with usage wins: one request, counted once.
  expect(stepUsage(used(1200), used(1000))).toEqual(used(1200))
  // Nothing to count: zeros stay zeros, nothing stays nothing.
  expect(stepUsage(used(0), undefined)).toEqual(used(0))
  expect(stepUsage(null, undefined)).toBeUndefined()
})

test('UCR-155 turnTokens reads a missing, null, NaN, infinite or negative field as 0, so a sum is never NaN', () => {
  const bad = (over: Record<string, unknown>) => turnTokens({ input_tokens: 10, output_tokens: 5, ...over } as never)
  // The defect behind a valid first case: the cache fields are left out.
  expect(turnTokens({ input_tokens: 1000, output_tokens: 500 } as never)).toBe(1500)
  // At the limit of the fields: the last field is the bad one.
  expect(bad({ cache_read_input_tokens: 1, cache_creation_input_tokens: NaN })).toBe(16)
  expect(bad({ cache_read_input_tokens: 1, cache_creation_input_tokens: null })).toBe(16)
  // Inside the excluded population: values that are numbers by type but not usable.
  expect(bad({ cache_read_input_tokens: Infinity, cache_creation_input_tokens: -4 })).toBe(15)
  expect(bad({ cache_read_input_tokens: '7', cache_creation_input_tokens: undefined })).toBe(15)
})

test('UCR-155 stepUsage never hands on a usage whose sum is NaN', () => {
  const partial = { input_tokens: 1000, output_tokens: 500 } as never
  const result = stepUsage(partial, undefined)
  expect(Number.isFinite(turnTokens(result!))).toBe(true)
  expect(turnTokens(stepUsage(undefined, partial)!)).toBe(1500)
})

test('UCR-216 readKeptUsage clamps the count at compact to the total, so "since compact" is never negative', () => {
  // The reported state: a stored atCompact above the total (the old code kept it, and drew -4,999,000).
  expect(readKeptUsage({ tokens: 1000, since: 0, atCompact: 5_000_000 })).toEqual({ tokens: 1000, since: 0, atCompact: 1000 })
  // The limit: equal is kept as it is; under the total too.
  expect(readKeptUsage({ tokens: 1000, since: 0, atCompact: 1000 })).toEqual({ tokens: 1000, since: 0, atCompact: 1000 })
  expect(readKeptUsage({ tokens: 1000, since: 0, atCompact: 400 })).toEqual({ tokens: 1000, since: 0, atCompact: 400 })
  // A total of 0 clamps any count at compact to 0.
  expect(readKeptUsage({ tokens: 0, since: 0, atCompact: 7 })).toEqual({ tokens: 0, since: 0, atCompact: 0 })
})
