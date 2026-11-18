/** The git listing of the todo folders of a checkout. */

import type { EngineInterface } from 'claude-code'
import { DIR, todoFoldersIn } from './repo-folders'
import { RUN_LIMIT_MS, TIMED_OUT } from './time-limit'
import { noteTimedOut, runInTime } from './fs-bounds'
import { S } from './state'
import { showToast } from './toasts'

/**
 * The pathspecs that limit `git ls-files` to todo folders: every path inside a `.claude_todo`
 * folder at any depth, and the folder itself for the ignored listing, where git gives an ignored
 * folder as one collapsed entry. `icase` keeps the case-only spellings `todoFoldersIn` reads
 *. On a real index of 90,002 entries the whole listing is 4,950,053 bytes, past the
 * engine's 4 MiB stdout cap; with these it is the todo entries only (53 bytes).
 */
const TODO_PATHSPECS = [`:(icase,glob)**/${DIR}/**`, `:(icase,glob)**/${DIR}`]

/** A `git ls-files` that failed, threw, did not return in time or was cut at the engine's stdout cap: the folder list is unknown, never empty. */
export class FolderListError extends Error {}

/**
 * The `.claude_todo/` folders of a checkout, tracked, untracked and ignored, through git. Each call is
 * bounded (`runInTime`). A call that throws, exits non-zero, times out, or whose output the
 * engine cut at its stdout cap (it keeps the first 4 MiB and still gives exit 0) throws
 * `FolderListError`: no list is not an empty list.
 */
export async function listFolders($: EngineInterface, root: string): Promise<{ path: string; rel: string }[]> {
  const run = async (argv: string[]) => {
    const done = await runInTime($, argv, { cwd: root })
    if (done === TIMED_OUT) {
      noteTimedOut($, argv)
      throw new FolderListError(`git ls-files did not return within ${RUN_LIMIT_MS / 1000} s`)
    }
    if (done === undefined || done.exitCode !== 0) {
      const said = typeof done?.stderr === 'string' ? done.stderr.trim().split('\n')[0] ?? '' : ''
      throw new FolderListError(done === undefined ? 'git ls-files did not start' : `git ls-files exited ${done.exitCode}${said === '' ? '' : `: ${said}`}`)
    }
    if ((done as { isStdoutTruncated?: boolean }).isStdoutTruncated === true) {
      throw new FolderListError('git ls-files output was cut at the size limit')
    }

    return done.stdout
  }
  const tracked = await run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...TODO_PATHSPECS])
  const ignored = await run(['git', 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--', ...TODO_PATHSPECS])

  return todoFoldersIn(`${tracked}\0${ignored}`, root)
}

/** Tells once that git could not list the todo folders, and what the board does instead. */
export function noteListFailed($: EngineInterface, error: FolderListError, isKept: boolean): void {
  if (!S.listFailToasted) {
    S.listFailToasted = true
    showToast($, `Claudeopticon could not list the todo folders (${error.message}). ${isKept ? 'The board keeps the folders it had' : 'The board shows the nearest todo folder only'} until a later search works: press Consolidate todos or reload the mod to search again.`)
  }
}
