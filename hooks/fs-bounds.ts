/** Time limits on file system reads and process runs, and the real path of a file. */

import type { EngineInterface } from 'claude-code'
import { clock } from './card-format'
import { normPath } from './path-forms'
import { inTime, NoAnswer, RUN_LIMIT_MS, TIMED_OUT } from './time-limit'
import { timedOutTold } from './state'
import { showToast } from './toasts'

/**
 * One fs read under the time limit of an outside call (RUN_LIMIT_MS, at most; calls started in one bucket share a timer). The engine's fs gives no time limit of its
 * own, and the files may sit on a network mount or a stuck volume; a read that never answers would hold the
 * scan, and with it every later scan, for the whole session. An unanswered read rejects with NoAnswer, so it is
 * a failed read: never a missing file, an empty file or an empty folder. Use it only where a rejection already
 * means "could not be read". The call itself is not stopped; its late result is dropped. Writes are not bounded:
 * a write that gave no answer may still land, and a retry would not know.
 */
export function fsBounded<T>($: EngineInterface, call: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const bucket = fsBucketFor($)
    const giveUp = () => reject(new NoAnswer(`no answer within ${RUN_LIMIT_MS / 1000} s`))
    bucket.add(giveUp)
    Promise.resolve()
      .then(call)
      .then(
        value => {
          bucket.delete(giveUp)
          resolve(value)
        },
        (error: unknown) => {
          bucket.delete(giveUp)
          reject(error)
        },
      )
  })
}

/** How long one bucket of fs calls takes new calls: a call waits between RUN_LIMIT_MS minus this and RUN_LIMIT_MS. */
const FS_BUCKET_MS = 5000

/** The calls started since the open bucket began: one timer gives them all up, so a scan of many files holds two timers, not one per call. */
let fsBucket: Set<() => void> | undefined

/** The bucket that a new fs call joins; the first call after the last bucket closed opens the next, with its two timers. */
function fsBucketFor($: EngineInterface): Set<() => void> {
  if (fsBucket !== undefined) {
    return fsBucket
  }
  const bucket = new Set<() => void>()
  fsBucket = bucket
  // A timer the engine refuses leaves the calls of this bucket unbounded, as for a store call; they still settle by their own answer.
  const arm = (ms: number, fire: () => void) => {
    try {
      const timer: unknown = $.clock.after(ms, fire)
      if (typeof (timer as { then?: unknown } | null)?.then === 'function') {
        void (timer as Promise<unknown>).then(undefined, () => undefined)
      }
    } catch {
      // Nothing to do: the bucket stays open and its calls are not timed.
    }
  }
  arm(FS_BUCKET_MS, () => {
    if (fsBucket === bucket) {
      fsBucket = undefined
    }
  })
  arm(RUN_LIMIT_MS, () => {
    for (const giveUp of [...bucket]) {
      giveUp()
    }
    bucket.clear()
    if (fsBucket === bucket) {
      fsBucket = undefined
    }
  })

  return bucket
}

/**
 * The real path of a folder in the one spelling the mod uses (`normPath`), or undefined when it cannot
 * be resolved. The engine's realpath gives backslashes on Windows: kept raw, the session
 * folder became `C:\proj`, its todo `C:\proj/.claude_todo`, which the trust check refuses, and the
 * claim folder was cut at a `/` it does not have. A POSIX path is returned as it is.
 */
export function realOf($: EngineInterface, path: string): Promise<string | undefined> {
  return fsBounded($, () => $.fs.stat(path, { resolve: true })).then(stat => (typeof stat.realPath === 'string' ? normPath(stat.realPath) : stat.realPath)).catch(() => undefined)
}

/**
 * Runs an outside command with a time limit: undefined when it fails to start, and
 * `TIMED_OUT` when it does not return within `RUN_LIMIT_MS`, so a call that hangs (a Finder
 * permission dialog, a stuck git) never holds the writer lock for good.
 */
export function runInTime($: EngineInterface, argv: string[], options?: { cwd?: string }): Promise<Awaited<ReturnType<EngineInterface['process']['run']>> | undefined | typeof TIMED_OUT> {
  const work = Promise.resolve()
    .then(() => (options === undefined ? $.process.run(argv) : $.process.run(argv, options)))
    .catch(() => undefined)

  return inTime(work, RUN_LIMIT_MS, (ms, fire) => $.clock.after(ms, fire))
}

/** The name a time-out toast gives a command: the program, and for git its subcommand. */
export const commandName = (argv: readonly string[]): string => argv.slice(0, argv[0] === 'git' ? 2 : 1).join(' ')

/** Tells once that `argv` did not return within `RUN_LIMIT_MS` and was taken as a failure. */
export function noteTimedOut($: EngineInterface, argv: readonly string[]): void {
  const name = commandName(argv)
  if (!timedOutTold.has(name)) {
    timedOutTold.add(name)
    showToast($, `Claudeopticon stopped waiting for \`${name}\` after ${RUN_LIMIT_MS / 1000} s and took it as failed, so a stuck command does not stop the todo writes.`)
  }
}

/**
 * A job under the writer lock, bounded by `RUN_LIMIT_MS`: after the limit the caller goes on and the
 * lock is freed. The job itself is not stopped: it runs on without the lock, and anything that waits on it waits
 * still. So every outside call a job makes is bounded on its own (`runInTime`), and every job ends.
 */
export function boundedJob<T>($: EngineInterface, job: Promise<T>): Promise<T | typeof TIMED_OUT> {
  return inTime(job, RUN_LIMIT_MS, (ms, fire) => $.clock.after(ms, fire))
}
