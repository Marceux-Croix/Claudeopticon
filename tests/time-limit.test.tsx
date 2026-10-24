import { expect, test } from 'claude-code/testing'

import { failAfter, inTime, STORE_LIMIT_MS, TIMED_OUT } from '../hooks/time-limit'

/** A fake timer: `fire()` runs every timer set so far. */
function fakeAfter() {
  const timers: (() => void)[] = []

  return { after: (_ms: number, fire: () => void) => timers.push(fire), fire: () => timers.forEach(one => one()) }
}

/** Property: a call that never returns gives `TIMED_OUT` once the limit passes; one that returns in time gives its value or its error. */
test('inTime gives up on a call that never returns, and passes one that does', async () => {
  const never = fakeAfter()
  const hung = inTime(new Promise<number>(() => undefined), 10, never.after)
  never.fire()
  expect(await hung).toBe(TIMED_OUT)
  // In time: the value and the error pass through, and a late timer changes nothing.
  const quick = fakeAfter()
  expect(await inTime(Promise.resolve(7), 10, quick.after)).toBe(7)
  quick.fire()
  const failing = fakeAfter()
  await expect(inTime(Promise.reject(new Error('boom')), 10, failing.after)).rejects.toThrow('boom')
  // A value that comes after the limit is dropped.
  const late = fakeAfter()
  let settle: (value: number) => void = () => undefined
  const slow = inTime(new Promise<number>(resolve => { settle = resolve }), 10, late.after)
  late.fire()
  settle(3)
  expect(await slow).toBe(TIMED_OUT)
})

/**
 * Property: a store call that never answers fails once the limit passes; one that answers
 * in time passes its value or its error; a timer the engine refuses fails the call and never leaves
 * the call's own rejection unhandled.
 */
test('failAfter fails a call that never answers, passes one that does, and fails on a refused timer', async () => {
  expect(STORE_LIMIT_MS).toBeGreaterThan(0)
  const never = fakeAfter()
  const hung = failAfter(new Promise<number>(() => undefined), 10, never.after)
  never.fire()
  await expect(hung).rejects.toThrow('no answer')
  const quick = fakeAfter()
  expect(await failAfter(Promise.resolve(7), 10, quick.after)).toBe(7)
  quick.fire()
  await expect(failAfter(Promise.reject(new Error('boom')), 10, fakeAfter().after)).rejects.toThrow('boom')
  // A timer that throws, and one that answers with a rejection: the call fails.
  const refused = () => {
    throw new Error('refused')
  }
  await expect(failAfter(Promise.reject(new Error('late')), 10, refused)).rejects.toThrow()
  await expect(failAfter(new Promise<number>(() => undefined), 10, () => Promise.reject(new Error('refused')))).rejects.toThrow('refused')
})

/** Property: a timer the engine refuses leaves the call unbounded, and the work's own value or error still reaches the caller. */
test('inTime with a timer that throws or rejects still gives the work its own value and error', async () => {
  const refuses = () => { throw new Error('session ended') }
  expect(await inTime(Promise.resolve(5), 10, refuses)).toBe(5)
  await expect(inTime(Promise.reject(new Error('boom')), 10, refuses)).rejects.toThrow('boom')
  // A timer call that answers with a rejected promise is not an unhandled rejection and does not change the result.
  expect(await inTime(Promise.resolve(6), 10, () => Promise.reject(new Error('refused')))).toBe(6)
})
