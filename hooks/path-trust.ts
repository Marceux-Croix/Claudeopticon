/** The checks that a path is a plain file or a trusted folder. */

import type { EngineInterface } from 'claude-code'
import { normalize } from './normalize'
import { isWinPath, normPath, samePath } from './path-forms'
import { DIR, globalParents, isGlobalTodo, isSameTodo, isTodoOf } from './repo-folders'
import { fsBounded, realOf } from './fs-bounds'
import { S } from './state'

/**
 * Why a path is no regular file that is its own real path (no symlink in the file or the folders
 * above it), or undefined when it is one. The reason tells a check that failed from a symlink
 *: a stat that did not answer is not called a symlink.
 */
export async function plainFileProblem($: EngineInterface, path: string): Promise<string | undefined> {
  const stat = await fsBounded($, () => $.fs.stat(path)).catch(() => undefined)
  if (stat === undefined) {
    return 'it could not be checked (the stat failed)'
  }
  if (stat.kind !== 'file') {
    return 'it is not a plain file'
  }
  const real = await realOf($, path)
  if (real === undefined) {
    return 'its real path could not be read'
  }

  return samePath(real, path) ? undefined : 'a symlink is in its path'
}

/** True for a regular file that is its own real path: no symlink in the file or the folders above it. */
export async function isPlainFile($: EngineInterface, path: string): Promise<boolean> {
  return (await plainFileProblem($, path)) === undefined
}

/** True when anything stands at the path's name in its folder, a dangling symlink included; a folder that will not list counts as yes. */
export async function hasEntry($: EngineInterface, path: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  if (!(await fsBounded($, () => $.fs.exists(dir)).catch(() => true))) {
    return false
  }
  const entries = await fsBounded($, () => $.fs.list(dir)).catch(() => undefined)

  return entries === undefined || entries.some(entry => entry.name === path.slice(dir.length + 1))
}

/**
 * Whether a folder may be changed by the mod: an absolute path with no `..`, ending in
 * `.claude_todo`, that is its own real path (so no symlink is in it), inside the main checkout, and
 * not the global one. Outside a repo there is no checkout: only the session folder's own
 * `.claude_todo` passes, by the same rules.
 */
export async function isTrustedDir($: EngineInterface, path: string): Promise<boolean> {
  return (await trustProblem($, path)) === undefined
}

/**
 * Why a folder may not be changed by the mod (the rule of `isTrustedDir`, above), or undefined when
 * it may. The reason tells a path that could not be read from a symlink and from a folder outside
 * the checkout; the rule is the same.
 */
export async function trustProblem($: EngineInterface, path: string): Promise<string | undefined> {
  if (S.centralRoot === undefined && S.looseRoot !== undefined && !samePath(path, `${S.looseRoot}/${DIR}`)) {
    return 'outside this repo'
  }
  const parts = path.split('/')
  // A `..` is refused by its text (M43). It is defense in depth: the engine folds a `..`
  // before the disk sees it, so the real path differs from the text and the check below refuses it
  // too. This one holds if a real path ever comes back unfolded.
  if (!(path.startsWith('/') || /^[A-Za-z]:\//.test(path)) || parts.includes('..') || parts.filter(part => part !== '').pop() !== DIR) {
    return `not a ${DIR} folder by its path`
  }
  // Without a known HOME the global folder cannot be told from a project one: nothing is trusted (a Windows path is told by its text).
  if (!S.globalsKnown && !isWinPath(path)) {
    return 'the home folder is not known'
  }
  const real = await realOf($, path)
  const base = S.centralRoot ?? S.looseRoot
  const root = base === undefined ? undefined : await realOf($, base)

  if (real === undefined || root === undefined) {
    return real === undefined ? 'its real path could not be read' : "the repo's real path could not be read"
  }
  const [nReal, nRoot] = [normPath(real).normalize('NFC'), normPath(root).normalize('NFC')]

  // The global checks (M02; ): discovery drops a folder whose real path was global at
  // load, and loadGlobals adds the real path of a linked global folder, so the `isGlobalTodo` test below
  // is defense in depth for those. A folder can still reach here global: a symlink at `~/.claude`, HOME,
  // CLAUDE_CONFIG_DIR or `~/.claude/.claude_todo` made after the load, which the loop over
  // `globalParents` below catches. This is the one gate every write passes.
  if (nReal !== normPath(path).normalize('NFC')) {
    return 'a symlink is in its path'
  }
  if (!nReal.startsWith(`${nRoot}/`)) {
    return 'outside this repo'
  }
  if (isGlobalTodo(nReal)) {
    return 'the global todo folder'
  }
  // Each global parent, and its `.claude_todo` itself, is resolved again now: a symlink at
  // `~/.claude`, HOME or CLAUDE_CONFIG_DIR, or at `~/.claude/.claude_todo` pointing at this folder, made
  // after the load still names this folder global. A path that does not resolve cannot be this folder, which exists.
  for (const parent of globalParents) {
    const realParent = await realOf($, parent)
    if (realParent !== undefined && isTodoOf(nReal, [realParent])) {
      return 'the global todo folder'
    }
    if (isSameTodo(nReal, await realOf($, `${parent.replace(/[\\/]+$/, '')}/${DIR}`))) {
      return 'the global todo folder'
    }
  }

  return undefined
}
