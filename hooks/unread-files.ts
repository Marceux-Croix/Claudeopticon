/**
 * The streak of a todo file that keeps failing to read when new IDs are chosen: how many
 * passes in a row it failed (for any reason), and when it is skipped.
 */

/** Passes in a row a file must fail, for any reason, before new IDs are chosen without it. */
export const SKIP_AFTER = 3

/** One file's streak: the reason of its last failure, in how many passes in a row it failed, and the last of those passes. */
export type UnreadStreak = { reason: string; count: number; pass: number }

/**
 * The streak after a failure in pass `pass`: one more for a new pass, as it was for a second failure
 * in the same pass. The failures count by file, not by reason: a file whose reason changes
 * from pass to pass (`EIO`, then `ETIMEDOUT`) fails as surely as one that fails the same way, so the
 * streak goes on, with the newest reason. Only a good read ends it (the caller deletes it).
 */
export function nextStreak(was: UnreadStreak | undefined, reason: string, pass: number): UnreadStreak {
  if (was === undefined) {
    return { reason, count: 1, pass }
  }

  return was.pass === pass ? { ...was, reason } : { reason, count: was.count + 1, pass }
}

/** True when the file is skipped: it failed SKIP_AFTER passes in a row. */
export const isSkipped = (streak: UnreadStreak): boolean => streak.count >= SKIP_AFTER
