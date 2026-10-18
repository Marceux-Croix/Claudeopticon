/** Elapsed wall-clock time that survives a clock set back (UCR-130). */

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
