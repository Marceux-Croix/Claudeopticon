/** The time limit of an outside call or a job: how long the mod waits before it takes it as failed. */

/**
 * How long the mod waits for one outside call (a trash command, osascript, rmdir, mkdir, git, printenv,
 * open) or one job under the writer lock before it takes it as failed (UCR-176, UCR-230).
 */
export const RUN_LIMIT_MS = 20_000

/** The result of a call that ran out of time. */
export const TIMED_OUT = Symbol('timed out')

/**
 * The value of `work`, or `TIMED_OUT` when it has not settled after `ms` (UCR-176). `after` is the
 * engine's timer (`$.clock.after`), so a test clock drives it. A call that never returns then no
 * longer holds the writer lock: the job goes on and the lock is freed. The call itself is not
 * stopped (the engine gives no way to); its late result is dropped.
 */
export function inTime<T>(work: Promise<T>, ms: number, after: (ms: number, fire: () => void) => unknown): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    let isDone = false
    const settle = (finish: () => void) => {
      if (!isDone) {
        isDone = true
        finish()
      }
    }
    // The work is watched before the timer is set, and a refused timer is caught, so neither leaves a
    // rejection unhandled (the same order as failAfter; an unhandled one ends the test process).
    work.then(
      value => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    )
    try {
      const timer = after(ms, () => settle(() => resolve(TIMED_OUT)))
      if (typeof (timer as { then?: unknown } | null)?.then === 'function') {
        void (timer as Promise<unknown>).then(undefined, () => undefined)
      }
    } catch {
      // A timer that cannot be set leaves the call unbounded; the work still settles the result.
    }
  })
}

/**
 * How long one store call (`$.store.get` or `$.store.set`) may take before it counts as failed
 * (UCR-219). A store call is local and takes milliseconds; the limit is for one that never returns,
 * which would otherwise hold every hook that waits on the load, for the whole session.
 */
export const STORE_LIMIT_MS = 5000

/** The failure of a call that gave no answer within its time limit (failAfter). */
export class NoAnswer extends Error {}

/**
 * The value of `work`, or a rejection when it has not settled after `ms` (UCR-219): a store call
 * that never returns is a failed call, which every caller already handles (a failed read is not an
 * absent key, a failed write is tried again). The call itself is not stopped; a late result is
 * dropped. The work is watched before the timer is set, so a timer that cannot be set (the engine
 * refuses it as the session ends) rejects this call and never leaves the work's own failure
 * unhandled.
 */
export function failAfter<T>(work: Promise<T>, ms: number, after: (ms: number, fire: () => void) => unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    let isDone = false
    const settle = (finish: () => void) => {
      if (!isDone) {
        isDone = true
        finish()
      }
    }
    work.then(
      value => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    )
    try {
      const timer = after(ms, () => settle(() => reject(new NoAnswer(`no answer within ${ms / 1000} s`))))
      // An engine call answers with a promise: a refused timer rejects it, and that is this call's failure.
      if (typeof (timer as { then?: unknown } | null)?.then === 'function') {
        void (timer as Promise<unknown>).then(undefined, (error: unknown) => settle(() => reject(error)))
      }
    } catch (error) {
      settle(() => reject(error))
    }
  })
}
