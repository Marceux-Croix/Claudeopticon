import { expect, test } from 'claude-code/testing'

import { isSkipped, nextStreak, SKIP_AFTER } from '../hooks/unread-files'

// ---------------------------------------------------------------- (batch H2)

/** Property: a file is skipped only after it failed in SKIP_AFTER passes in a row. */
test('the streak counts passes, not calls', () => {
  let streak = nextStreak(undefined, 'EACCES', 1)
  expect(streak.count).toBe(1)
  // A second failure in the same pass is the same pass.
  streak = nextStreak(streak, 'EACCES', 1)
  expect(streak.count).toBe(1)
  streak = nextStreak(streak, 'EACCES', 2)
  expect(isSkipped(streak)).toBe(false)
  // At the limit: the SKIP_AFTER-th pass skips it.
  streak = nextStreak(streak, 'EACCES', 3)
  expect(SKIP_AFTER).toBe(3)
  expect(isSkipped(streak)).toBe(true)
  // Batch I2 changed this from a new streak of 1: another reason goes on with the streak, with the newest reason (remainder).
  expect(nextStreak(streak, 'EIO', 4)).toEqual({ reason: 'EIO', count: 4, pass: 4 })
})

// ---------------------------------------------------------------- remainder (batch I2)

/** Property: the failures of one file count by file, not by reason: a file that fails every pass is skipped after SKIP_AFTER passes, whatever its reasons. */
test('a streak goes on when the reason changes: alternating reasons still skip the file', () => {
  const run = (reasons: readonly string[]) => reasons.reduce<ReturnType<typeof nextStreak> | undefined>((was, reason, at) => nextStreak(was, reason, at + 1), undefined)!
  // The verifier's state: EIO and ETIMEDOUT taking turns, 10 passes.
  const ten = run(Array.from({ length: 10 }, (_, at) => (at % 2 === 0 ? 'EIO: i/o error' : 'ETIMEDOUT: timed out')))
  expect(ten.count).toBe(10)
  expect(isSkipped(ten)).toBe(true)
  // At the limit: the reason changes on the SKIP_AFTER-th pass itself, and the newest reason is kept for the toast.
  const last = run(['EIO', 'EIO', 'EACCES'])
  expect(isSkipped(last)).toBe(true)
  expect(last.reason).toBe('EACCES')
  // A new reason inside one pass is still that one pass.
  expect(nextStreak(nextStreak(undefined, 'EIO', 1), 'EACCES', 1).count).toBe(1)
  // The excluded population: fewer than SKIP_AFTER passes is never skipped, whatever the reasons.
  expect(isSkipped(run(['EIO', 'ETIMEDOUT']))).toBe(false)
})
