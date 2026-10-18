/** The write lock: todo file writes of this session run one after another. */

/**
 * The one writer lock of the todo files: a promise chain, so a user action waits its turn, and a
 * count of the jobs queued or running, so a scan writer sees the lock held at once (no gap between
 * two chained jobs). Two writers never overlap, which keeps one from writing over the other's change.
 */
let writeChain: Promise<unknown> = Promise.resolve()
let writeJobs = 0

/** Runs `job` once every earlier writer is done. A failed job does not break the chain. */
export function withWriteLock<T>(job: () => Promise<T>): Promise<T> {
  writeJobs += 1
  const run = writeChain.then(job)
  writeChain = run.then(() => undefined, () => undefined).finally(() => {
    writeJobs -= 1
  })

  return run
}

/** For a scan writer: runs `job` if no writer holds the lock, else skips this scan (undefined). */
export async function tryWriteLock<T>(job: () => Promise<T>): Promise<T | undefined> {
  return writeJobs > 0 ? undefined : withWriteLock(job)
}
