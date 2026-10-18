import { expect, test } from 'claude-code/testing'

import { elapsedSince } from '../hooks/clock-elapsed'

// ---------------------------------------------------------------- UCR-130

/** Property: time passed is never negative, and a clock set back restarts the wait from the new time. */
test('UCR-130 elapsedSince counts forward time and restarts from a clock set back, in three states', () => {
  // Behind a valid first case: forward time counts as it is; a forward jump (sleep and wake) too.
  expect(elapsedSince(1000, 1500)).toEqual({ ms: 500, from: 1000 })
  expect(elapsedSince(1000, 1000 + 3_600_000)).toEqual({ ms: 3_600_000, from: 1000 })
  // At the limit: the same time is 0 passed, the reference kept.
  expect(elapsedSince(1000, 1000)).toEqual({ ms: 0, from: 1000 })
  // Inside the excluded population: a time before the reference (a set-back of 1 ms or 2 h) is 0 passed, the reference reset.
  expect(elapsedSince(1000, 999)).toEqual({ ms: 0, from: 999 })
  expect(elapsedSince(10_000_000, 10_000_000 - 7_200_000)).toEqual({ ms: 0, from: 10_000_000 - 7_200_000 })
})
