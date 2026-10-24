/** Elapsed wall-clock time that survives a clock set back. */

/**
 * The time from `from` to `now`, and the reference to keep. The clock is the wall clock, which can
 * go back (a manual set, an NTP step). A `now` before `from` resets the reference to `now`, so the
 * wait starts over from there: without the reset, `now - from` stays negative for the length of the
 * set-back, and every "has X ms passed" test is frozen for that long. A forward jump (a sleep and a
 * wake) counts as time passed, as it is.
 */
export function elapsedSince(from: number, now: number): { ms: number; from: number } {
  return now < from ? { ms: 0, from: now } : { ms: now - from, from }
}

/**
 * Whether a deadline set at most `span` ms ahead has passed at `now`. A deadline further ahead than
 * `span` can only come from a clock set back since it was set, so it has passed: the thing it timed
 * ends at once and not after the length of the set-back.
 */
export function isDeadlinePast(until: number, now: number, span: number): boolean {
  return now >= until || until > now + span
}
