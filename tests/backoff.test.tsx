import { expect, test } from 'claude-code/testing'

import { addFailure, backoffMs, isRetryDue } from '../hooks/backoff'

// ---------------------------------------------------------------- UCR-126 and UCR-128

/** Property: each failure in a row doubles the wait from the first, never past the cap. */
test('UCR-128 backoffMs doubles from the first wait up to the cap', () => {
  expect(backoffMs(0, 1000, 300_000)).toBe(0)
  expect([1, 2, 3, 4, 5].map(n => backoffMs(n, 1000, 300_000))).toEqual([1000, 2000, 4000, 8000, 16_000])
  // At the cap: 2 ** 9 s is past 300 s, so it is 300 s; a very long run stays finite at the cap.
  expect(backoffMs(10, 1000, 300_000)).toBe(300_000)
  expect(backoffMs(10_000, 1000, 300_000)).toBe(300_000)
})

/** Property: a thing that failed is tried again only once its wait is over, and a clock set back never freezes it. */
test('UCR-128 isRetryDue holds a failed thing back for its wait, in three states', () => {
  const failing = addFailure(addFailure(undefined, 0, 1000, 300_000), 1000, 1000, 300_000)
  expect(failing).toEqual({ count: 2, retryAt: 3000 })
  // Behind a valid first case: a thing that never failed is due.
  expect(isRetryDue(undefined, 0, 300_000)).toBe(true)
  // At the limit: 1 ms before the retry it is held; at the retry time it is due.
  expect(isRetryDue(failing, 2999, 300_000)).toBe(false)
  expect(isRetryDue(failing, 3000, 300_000)).toBe(true)
  // The excluded population: a retry more than the cap ahead can only come from a clock set back, so it is due.
  expect(isRetryDue(failing, 3000 - 300_001, 300_000)).toBe(true)
  expect(isRetryDue(failing, 3000 - 300_000, 300_000)).toBe(false)
})
