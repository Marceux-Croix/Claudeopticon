/** Retry backoff: how long to wait after a run of failures in a row (UCR-126, UCR-128). */

/**
 * The wait before the next try after `failures` failures in a row: `firstMs`, doubled for each
 * failure after the first, never more than `maxMs`. No failure, no wait.
 */
export function backoffMs(failures: number, firstMs: number, maxMs: number): number {
  if (failures <= 0) {
    return 0
  }

  // The exponent is capped, so a long run of failures stays a finite, exact number.
  return Math.min(maxMs, firstMs * 2 ** Math.min(failures - 1, 30))
}

/** The failures in a row of one retried thing, and the earliest time of its next try, clock ms. */
export type Failing = { count: number; retryAt: number }

/** The record after one more failure at `time`: the count goes up by one and the next try waits backoffMs. */
export function addFailure(before: Failing | undefined, time: number, firstMs: number, maxMs: number): Failing {
  const count = (before?.count ?? 0) + 1

  return { count, retryAt: time + backoffMs(count, firstMs, maxMs) }
}

/**
 * True when a thing with record `failing` may be tried at `time`: it never failed, or its wait is
 * over. A `retryAt` more than `maxMs` ahead of `time` can only come from a clock set back (UCR-130):
 * it counts as over, so a set-back never freezes the retries for its length.
 */
export function isRetryDue(failing: Failing | undefined, time: number, maxMs: number): boolean {
  return failing === undefined || time >= failing.retryAt || failing.retryAt - time > maxMs
}
