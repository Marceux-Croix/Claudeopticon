/** The global todo folders (home and config) that the board never reads. */

import type { EngineInterface } from 'claude-code'
import { envDirs, isWinPath, resolveAgainst } from './path-forms'
import { DIR, findTodoDirWith, replaceGlobals } from './repo-folders'
import { TIMED_OUT } from './time-limit'
import { fsBounded, noteTimedOut, realOf, runInTime } from './fs-bounds'
import { sessionHome } from './session-places'
import { S } from './state'

/**
 * Finds the project's own todo folder: `.claude_todo/` at the root of the repo the session works
 * in, or of its main checkout from a git worktree (whose `.git` file names it; `.claude_todo/` may
 * be gitignored, so a worktree may have none). Outside a repo, only the session folder's own. Never
 * the `.claude_todo/` in the home `.claude` folder, which belongs to no project. The walk starts at
 * the session's project root, not at `.`, which a shell `cd` moves; a relative answer is
 * relative to that root (`atHome`).
 */
export async function findTodoDir($: EngineInterface): Promise<string | undefined> {
  const at = atHome(await sessionHome($))

  return findTodoDirWith({
    exists: path => fsBounded($, () => $.fs.exists(at(path))),
    kind: path => fsBounded($, () => $.fs.stat(at(path))).then(stat => stat.kind).catch(() => undefined),
    realPath: path => realOf($, at(path)),
    read: path => $.fs.read(at(path)).then(text => (typeof text === 'string' ? text : '')).catch(() => ''),
  })
}

/** A path relative to the session's project root `home` made absolute against it; as it is when there is no home. */
export const atHome = (home: string | undefined) => (path: string): string => (home === undefined ? path : resolveAgainst(home, path))

/**
 * Reads one environment variable as the forms of an absolute folder (`envDirs`): through `printenv`
 * (no shell), and where `printenv` cannot start (Windows has none) through PowerShell with the name
 * as a fixed literal. Empty when unset, failed, timed out, or not an absolute path.
 */
async function envPath($: EngineInterface, name: 'HOME' | 'USERPROFILE' | 'CLAUDE_CONFIG_DIR'): Promise<string[]> {
  // Bounded: a call that does not return is a failure, told once, and the mod fails closed as for no home.
  const ask = async (argv: string[]) => {
    const ran = await runInTime($, argv)
    if (ran === TIMED_OUT) {
      noteTimedOut($, argv)

      return { timedOut: true } as const
    }

    return ran
  }
  let done = await ask(['printenv', name])
  // Not started (a throw) or not found (exit 127, as the trash code reads it): where there is no printenv, ask PowerShell.
  if (done === undefined || ('exitCode' in done && done.exitCode === 127)) {
    done = await ask(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `[Environment]::GetEnvironmentVariable('${name}')`])
  }

  return envDirs(done !== undefined && 'exitCode' in done && done.exitCode === 0 ? done.stdout.split('\n')[0] : undefined)
}

/**
 * Finds the global todo folders of this machine, once per load: under HOME (USERPROFILE, a Windows
 * home, when HOME is not set) and CLAUDE_CONFIG_DIR. Without a readable home the mod fails closed.
 */
export async function loadGlobals($: EngineInterface): Promise<void> {
  // Built aside, swapped in with no await between (`replaceGlobals`): a write check during the load sees the folders of the last load, never none.
  const dirs = new Set<string>()
  const parentSet = new Set<string>()
  let homes = await envPath($, 'HOME')
  if (homes.length === 0) {
    homes = (await envPath($, 'USERPROFILE')).filter(isWinPath)
  }
  const configs = await envPath($, 'CLAUDE_CONFIG_DIR')
  const home = homes[0]
  const parents = [...homes.map(one => `${one.replace(/\/$/, '')}/.claude`), ...configs.map(one => one.replace(/\/$/, ''))]
  for (const parent of parents) {
    parentSet.add(parent)
    const dir = `${parent}/${DIR}`
    dirs.add(dir)
    const real = await realOf($, dir)
    if (real !== undefined) {
      dirs.add(real.replace(/\/+$/, ''))
    }
    // The parent exists at load even when `.claude_todo` does not yet: a symlinked `~/.claude`,
    // HOME or CLAUDE_CONFIG_DIR (stow, chezmoi) gives the real path a folder made later will have.
    const realParent = await realOf($, parent)
    if (realParent !== undefined) {
      dirs.add(`${realParent.replace(/[\\/]+$/, '')}/${DIR}`)
    }
  }
  replaceGlobals(dirs, parentSet)
  S.globalsKnown = home !== undefined
}
