import { expect, test } from 'claude-code/testing'

import { elapsedSince, isDeadlinePast } from '../hooks/clock-elapsed'

test('a note deadline passes at its time, and at once when a clock set back leaves it further ahead than it was set', () => {
  const span = 4000
  // Inside its span: not past. At its time: past.
  expect(isDeadlinePast(1000 + span, 1000, span)).toBe(false)
  expect(isDeadlinePast(1000 + span, 1000 + span, span)).toBe(true)
  // The clock went back one hour after the deadline was set: past now, not an hour later.
  expect(isDeadlinePast(1000 + span, 1000 - 3_600_000, span)).toBe(true)
  // One millisecond further ahead than the span is still a set-back.
  expect(isDeadlinePast(1000 + span + 1, 1000, span)).toBe(true)
})

// ---------------------------------------------------------------- 

/** Property: time passed is never negative, and a clock set back restarts the wait from the new time. */
test('elapsedSince counts forward time and restarts from a clock set back, in three states', () => {
  // Behind a valid first case: forward time counts as it is; a forward jump (sleep and wake) too.
  expect(elapsedSince(1000, 1500)).toEqual({ ms: 500, from: 1000 })
  expect(elapsedSince(1000, 1000 + 3_600_000)).toEqual({ ms: 3_600_000, from: 1000 })
  // At the limit: the same time is 0 passed, the reference kept.
  expect(elapsedSince(1000, 1000)).toEqual({ ms: 0, from: 1000 })
  // Inside the excluded population: a time before the reference (a set-back of 1 ms or 2 h) is 0 passed, the reference reset.
  expect(elapsedSince(1000, 999)).toEqual({ ms: 0, from: 999 })
  expect(elapsedSince(10_000_000, 10_000_000 - 7_200_000)).toEqual({ ms: 0, from: 10_000_000 - 7_200_000 })
})
