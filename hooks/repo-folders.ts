/** Where the todo folders are: the repo lookup, the global folders that never count, and the folder list. */

import { foldPath, isAbsPath, isCaseOnly, isWinPath, normPath, relIn, resolveAgainst } from './path-forms'

export const DIR = '.claude_todo'
/**
 * The most folders the nearest-folder walk goes up when the session's real path cannot be read
 *. With the real path known, the walk goes up to the file system root, as git does: a
 * session at any depth in a repo finds the repo root's folder (no count limit), and outside a repo
 * the walk ends at the root with no `.git` found. 64 is far past any repo depth seen; a deeper
 * session whose real path also fails to read is taken to be outside a repo.
 */
export const MAX_UP_NO_REAL = 64

/** The file system calls the todo lookup makes, apart from `$` so a test can lay out folders. */
export type TodoFs = {
  exists: (path: string) => Promise<boolean>
  kind: (path: string) => Promise<string | undefined>
  realPath: (path: string) => Promise<string | undefined>
  read: (path: string) => Promise<string>
}

export async function findTodoDirWith(fs: TodoFs): Promise<string | undefined> {
  const found = await repoTodoDir(fs)
  if (found === undefined) {
    return undefined
  }
  const real = await fs.realPath(found)

  return real !== undefined && isGlobalTodo(real) ? undefined : found
}

/**
 * The global todo folders as this machine has them: `$HOME/.claude/.claude_todo` and
 * `$CLAUDE_CONFIG_DIR/.claude_todo`, each as written and as its real path. The text rule below only
 * knows the usual home folders (`/Users`, `/home`, `/root`); a home at `/var/home`, `/var/root`,
 * `/export/home` or anywhere else is known only from the environment.
 */
export const globalDirs = new Set<string>()

/**
 * The folders that hold a global todo folder: `$HOME/.claude` and `$CLAUDE_CONFIG_DIR`, as written. The
 * write check resolves each again at the moment of a write, so a `.claude_todo` made under a
 * symlinked one after the load, or a symlink made after the load, is still known as global.
 */
export const globalParents = new Set<string>()

/**
 * Replaces the known global folders and their parents in one synchronous step. A load builds the new
 * sets while it awaits the environment and the disk, then swaps them in here: a write check that runs
 * in between still sees the folders the last load found, never an empty set.
 */
export function replaceGlobals(dirs: Iterable<string>, parents: Iterable<string>): void {
  const nextDirs = [...dirs]
  const nextParents = [...parents]
  globalDirs.clear()
  globalParents.clear()
  for (const dir of nextDirs) {
    globalDirs.add(dir)
  }
  for (const parent of nextParents) {
    globalParents.add(parent)
  }
}

/** One spelling of a folder for the global compare: slashes folded, no trailing slash, NFC, and a Windows path in any letter case. */
function globalKey(path: string): string {
  const flat = normPath(path)
  const bare = (flat.length > 1 ? flat.replace(/\/+$/, '') : flat).normalize('NFC')

  return isWinPath(bare) ? bare.toLowerCase() : bare
}

/** True when `folder` is the `.claude_todo` of one of `parents` (real paths both), in the spelling the global compare uses. */
export function isTodoOf(folder: string, parents: Iterable<string>): boolean {
  const own = globalKey(folder)

  return [...parents].some(parent => globalKey(`${normPath(parent).replace(/\/+$/, '')}/${DIR}`) === own)
}

/**
 * True when `folder` is `globalReal`, the real path of a global `<parent>/.claude_todo` resolved at the
 * moment of a write, in the spelling the global compare uses: a symlink made at
 * `~/.claude/.claude_todo` itself after the load points it at a project folder, which is then global.
 * Undefined (the global folder does not resolve: there is none) is never a match.
 */
export function isSameTodo(folder: string, globalReal: string | undefined): boolean {
  return globalReal !== undefined && globalKey(globalReal) === globalKey(folder)
}

/**
 * True for the global todo folder, `<home>/.claude/.claude_todo`, which the mod never reads. A project's
 * own `<repo>/.claude/.claude_todo` is not it. On Windows the profile can live anywhere, so every
 * `.claude/.claude_todo` counts as global there.
 */
export function isGlobalTodo(realPath: string): boolean {
  const own = globalKey(realPath)
  if ([...globalDirs].some(dir => globalKey(dir) === own)) {
    return true
  }

  return /^\/(Users|home)\/[^/]+\/\.claude\/\.claude_todo\/?$|^\/root\/\.claude\/\.claude_todo\/?$/.test(realPath) || /^[A-Za-z]:[\\/](.*[\\/])?\.claude[\\/]\.claude_todo[\\/]?$/i.test(realPath)
}

/**
 * The main checkout named by a linked worktree's git dir, by git's own rule (; `gitFileWhere`
 * follows it too): a git dir with a `commondir` file is a linked worktree's, and its common dir is that
 * file's path read against the git dir. A git dir with none is the common dir itself: no linked
 * worktree, so no other main checkout. The text `/worktrees/` in a path tells nothing: a separate git
 * dir at `~/worktrees/x.git`, or a submodule at `worktrees/foo`, has it too.
 *
 * A common dir `<main>/.git` gives `<main>`. A separate git dir (`/elsewhere/repo.git`, also a
 * submodule's) has no `.git` folder in the main checkout, so its `core.worktree` setting is read
 * instead. A relative `gitdir` (git 2.48 `worktree.useRelativePaths`) reads against `base`, the
 * folder of the `.git` file as a path from the session folder.
 */
async function mainOf(fs: TodoFs, gitdir: string | undefined, base: string): Promise<string | undefined> {
  if (gitdir === undefined || gitdir === '') {
    return undefined
  }
  const dir = isAbsPath(gitdir) ? foldPath(gitdir) : foldPath(`${base}${gitdir}`)
  const named = (await fs.read(`${dir}/commondir`).catch(() => '')).split('\n')[0]?.replace(/\r$/, '').trim() ?? ''
  if (named === '') {
    return undefined
  }
  const common = foldPath(isAbsPath(named) ? named : `${dir}/${named}`)
  if (common.endsWith('/.git')) {
    // A main checkout at the file system root gives '', which the caller joins as `/.claude_todo`.
    return common.slice(0, -'/.git'.length)
  }
  const set = /^\s*worktree\s*=\s*(.+)$/m.exec(await fs.read(`${common}/config`).catch(() => ''))?.[1]?.trim()

  return set === undefined || set === '' ? undefined : foldPath(isAbsPath(set) ? set : `${common}/${set}`)
}

/**
 * The nearest `.claude_todo/`, from the session folder up to the repo root: a subfolder with a todo
 * of its own keeps it. With none up to the root, a worktree uses its main checkout's. Outside a
 * repo, only the session folder's own counts.
 *
 * Which folder a linked worktree writes is decided in discovery (`centralRoot`); this walk
 * only finds the nearest folder. With no `.claude_todo/` up to the worktree's root, a worktree uses its
 * main checkout's, named by `mainOf`.
 *
 * The walk has no count limit: it goes up to the file system root (the segment count of the
 * session's real path), so a repo's root is found at any depth, as git finds it. Only when that real
 * path cannot be read does MAX_UP_NO_REAL bound it.
 */
async function repoTodoDir(fs: TodoFs): Promise<string | undefined> {
  let maxUp: number | undefined
  // Read once, after the first check: the folders from the session folder up to the file system root.
  const levels = async (): Promise<number> => {
    if (maxUp === undefined) {
      const real = await fs.realPath('.').catch(() => undefined)
      maxUp = real === undefined || !isAbsPath(real) ? MAX_UP_NO_REAL : normPath(real).split('/').filter(part => part !== '').length
    }

    return maxUp
  }
  for (let depth = 0; depth === 0 || depth <= (await levels()); depth += 1) {
    const prefix = '../'.repeat(depth)
    if (await fs.exists(`${prefix}${DIR}`)) {
      // Taken only inside a repo: the walk must reach a .git at or above this folder.
      for (let up = depth; up <= (await levels()); up += 1) {
        if (await fs.exists(`${'../'.repeat(up)}.git`)) {
          return `${prefix}${DIR}`
        }
      }

      return depth === 0 ? DIR : undefined
    }
    const git = `${prefix}.git`
    if (!(await fs.exists(git))) {
      continue
    }
    if ((await fs.kind(git)) === 'file') {
      const gitdir = /^gitdir:\s*(.+)$/m.exec(await fs.read(git))?.[1]?.replace(/\r$/, '').trim()
      const main = await mainOf(fs, gitdir, prefix)

      return main !== undefined && (await fs.exists(`${main}/${DIR}`)) ? `${main}/${DIR}` : undefined
    }

    return undefined
  }

  return undefined
}

/** One `.claude_todo/` folder: `path` as the engine's fs takes it, `rel` from its checkout's root. */
export type TodoFolder = { path: string; rel: string; isOther: boolean; real?: string }

/** Most folders the pane reads: a repo with more is cut, primary folder first, then by path. */
export const MAX_FOLDERS = 20

/**
 * The `.claude_todo/` folders in the output of `git ls-files -z`: every entry with a `.claude_todo`
 * segment is cut to the folder path ending there. An ignored folder lists as a collapsed directory
 * entry (`x/.claude_todo/`), which cuts the same way. Duplicates drop; the order is by path.
 * A folder under an ignored directory is not found: git lists the ignored directory as one entry
 * (`ign/`), with no `.claude_todo` segment, and the mod does not walk an ignored tree (a `node_modules`
 * can hold millions of files). A `.claude_todo` that is itself ignored is found.
 *
 * The segment matches in any letter case: after a case-only rename of the folder itself on a
 * disk that ignores case, git keeps the index spelling (`.Claude_todo`) while the disk has
 * `.claude_todo`. Discovery then reads each folder in the disk's spelling (`diskSpelling`) and keeps only
 * one spelled `.claude_todo` there (`isMisspelledTodo` names the rest once).
 */
export function todoFoldersIn(listing: string, root: string): { path: string; rel: string }[] {
  const rels = new Set<string>()
  for (const entry of listing.split('\0')) {
    const parts = entry.split('/').filter(part => part !== '')
    const at = parts.findIndex(part => part.toLowerCase() === DIR)
    if (at >= 0) {
      rels.add(parts.slice(0, at + 1).join('/'))
    }
  }

  return [...rels].sort().map(rel => ({ path: `${root}/${rel}`, rel }))
}

/**
 * A listed folder in the disk's spelling: when its real path differs from the listed path
 * only by letter case (git keeps the index spelling after a case-only rename), the real path, with
 * `rel` from whichever of `roots` holds it. Any other real path (a symlink, NFD) leaves it as listed,
 * for the trust check to judge.
 */
export function diskSpelling(one: { path: string; rel: string }, real: string | undefined, roots: readonly string[]): { path: string; rel: string } {
  if (real === undefined || !isCaseOnly(one.path, real)) {
    return one
  }
  // A Windows real path may come with backslashes: the path the mod writes keeps forward slashes, as git's does.
  const path = normPath(real)
  const rel = roots.map(root => relIn(path, normPath(root))).find(found => found !== undefined)

  return { path, rel: rel ?? one.rel }
}

/**
 * True for a folder path whose last segment is `.claude_todo` in another letter case only:
 * `.Claude_todo` on the disk, or as git lists it on a disk that keeps case apart. The mod reads and
 * writes only `.claude_todo`, so discovery leaves such a folder out and says so once.
 */
export function isMisspelledTodo(path: string): boolean {
  const last = normPath(path).replace(/\/+$/, '').split('/').pop() ?? ''

  return last !== DIR && last.toLowerCase() === DIR
}

/**
 * One line of git output without its line break only: a folder name may end in a space, so
 * `trim` would give another folder. A CR from a Windows git goes with the line break.
 */
function lineOf(line: string): string {
  return line.replace(/\r$/, '')
}

/** The arguments of the one `git rev-parse` call that `repoRoots` and `sessionFolder` read, in the order git prints them. */
export const REV_PARSE = ['git', 'rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir', '--show-prefix']

/**
 * The lines of the REV_PARSE output, or undefined when there are more than its four values and the
 * last line break give: a line break in a path (a folder named `nl<LF>x`) moves every line,
 * so the first would name another folder. Such output is never read; the caller then takes the
 * outside-a-repo path. Git prints each of the four values on a line of its own, so every line break
 * in a path shows as an extra line. Output of the right shape can still name another folder (GIT_DIR
 * and GIT_WORK_TREE in the environment, a core.worktree set elsewhere): discovery checks the session
 * folder against the real path of `.` for that (`isSameFolder`).
 */
export function revParseLines(stdout: string): string[] | undefined {
  // A CR goes with the line break only when every line break is CRLF (a Windows git): a POSIX folder name may end in a CR, and cut there it names another folder.
  const isCrlf = !/(^|[^\r])\n/.test(stdout)
  const lines = stdout.split('\n').map(line => (isCrlf ? lineOf(line) : line))

  // One line per value REV_PARSE asks for (its arguments past `git rev-parse`), and the empty one after the last line break.
  return lines.length > REV_PARSE.length - 2 + 1 ? undefined : lines
}

/**
 * The session folder as git sees it: the top folder joined with `--show-prefix` (the fourth line of
 * the REV_PARSE output; empty at the top). Undefined when the output has no top folder.
 */
export function sessionFolder(stdout: string): string | undefined {
  const lines = revParseLines(stdout)
  if (lines === undefined) {
    return undefined
  }
  const top = lines[0] ?? ''

  return isAbsPath(top) ? resolveAgainst(top, lines[3] ?? '') : undefined
}

/**
 * The main checkout as the first entry of `git worktree list --porcelain`. Not when that entry is the
 * common dir itself or inside it, or is marked `bare`: for a separate git dir git lists the git dir
 * there, which is no checkout.
 */
function listedMain(worktrees: string, common: string): string | undefined {
  const block = worktrees.split(/\n\s*\n/)[0] ?? ''
  const listed = /^worktree (.+)$/m.exec(block)?.[1]?.replace(/\r$/, '')
  if (listed === undefined || !isAbsPath(listed) || /^bare$/m.test(block)) {
    return undefined
  }
  const main = listed.replace(/\/+$/, '')

  return main === common || main.startsWith(`${common}/`) ? undefined : main
}

/**
 * The git common dir as an absolute path, from the REV_PARSE output (the third line; the second in the
 * old two-line output), read against the session folder as `repoRoots` reads it. In every git layout it
 * is a directory: `<root>/.git`, a separate git dir, a submodule's `.git/modules/<name>`, and the main
 * one for a linked worktree. Undefined when the output names none.
 */
export function gitCommonDir(stdout: string): string | undefined {
  const lines = revParseLines(stdout) ?? []
  const here = sessionFolder(stdout)
  const common = ((lines[2] ?? '') !== '' ? lines[2] : lines[1]) ?? ''

  return here === undefined || common === '' ? undefined : resolveAgainst(here, common)
}

/**
 * The repo root and, from a linked git worktree, its main checkout, from the REV_PARSE output (no
 * `--path-format`, which git before 2.31 does not know). Git prints a relative dir against the
 * folder it runs in, not the top: from `sub/deep` the common dir is `../../.git`. So each
 * relative dir is read against the session folder (top plus the `--show-prefix` line); output with
 * no prefix line is read against the top.
 *
 * A worktree is linked only when its git dir is `<common dir>/worktrees/<name>`, the one place git
 * keeps a linked worktree's git dir. Any other pair of differing dirs gives `isLinked` with no main,
 * so a misread dir can never make an ancestor folder the main checkout. The main checkout is the first
 * entry of `git worktree list --porcelain` (`worktrees`) when that entry is a checkout; without the
 * list, the folder that holds a common dir named `.git`. A linked worktree with no main found is
 * `isLinked`, so the caller can keep the tidy buttons off. The old two-line output (top, common) still reads.
 */
export function repoRoots(stdout: string, worktrees = ''): { root: string; main?: string; isLinked?: true } | undefined {
  const lines = revParseLines(stdout) ?? []
  const top = lines[0]
  const here = sessionFolder(stdout)
  if (top === undefined || here === undefined) {
    return undefined
  }
  const hasDir = (lines[2] ?? '') !== ''
  const common = (hasDir ? lines[2] : lines[1]) ?? ''
  if (common === '') {
    return { root: top }
  }
  const absCommon = resolveAgainst(here, common)
  if (hasDir) {
    const gitDir = resolveAgainst(here, lines[1]!)
    if (gitDir === absCommon) {
      return { root: top }
    }
    if (!gitDir.startsWith(`${absCommon}/worktrees/`)) {
      // The repo's own `.git` entry is a symlink: git prints the git dir as its real path and the common dir as the link. No linked worktree has the top's own `.git` as its common dir.
      return absCommon === `${top}/.git` ? { root: top } : { root: top, isLinked: true }
    }
  } else if (absCommon === `${top}/.git` || !absCommon.endsWith('/.git')) {
    return { root: top }
  }
  const main = listedMain(worktrees, absCommon) ?? (absCommon.endsWith('/.git') ? absCommon.slice(0, -'/.git'.length) : undefined)

  return main === undefined || main === '' || main === top ? { root: top, isLinked: true } : { root: top, main }
}

/**
 * The folders the pane reads from those found: the global ones dropped, a place found twice kept
 * once (the primary's entry when it is one of them, else the first), the primary folder first and
 * the rest by path, cut to MAX_FOLDERS. `primary` is the `path` of the one folder the nearest-up
 * rule picks.
 */
export function pickFolders(found: readonly { path: string; rel: string; real?: string }[], primary: string | undefined, globals: ReadonlySet<string>, limit = MAX_FOLDERS): TodoFolder[] {
  const byRel = new Map<string, { path: string; rel: string; real?: string }>()
  for (const one of found) {
    if (globals.has(one.path)) {
      continue
    }
    const held = byRel.get(one.rel)
    if (held === undefined || (one.path === primary && held.path !== primary)) {
      byRel.set(one.rel, one)
    }
  }
  const kept = [...byRel.values()]
  const first = kept.filter(one => one.path === primary)
  const rest = kept.filter(one => one.path !== primary).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

  return [...first.map(one => ({ ...one, isOther: false })), ...rest.map(one => ({ ...one, isOther: true }))].slice(0, limit)
}

/**
 * True when `real`, the real path of a folder, lies inside one of `roots`, the real paths of the checkouts
 * the mod reads (the repo root, and the main checkout of a linked worktree). A listed folder that resolves
 * elsewhere is a symlink out of the repo (a tracked `.claude_todo -> /other`): its files are not the repo's.
 */
export function isInsideRoots(real: string, roots: readonly string[]): boolean {
  const own = globalKey(real)

  return roots.some(root => own.startsWith(`${globalKey(root).replace(/\/+$/, '')}/`))
}

/** Where a folder sits in its checkout, for the heading in the central file: its path without `.claude_todo`. */
export function placeOf(rel: string): string {
  const place = rel.slice(0, Math.max(0, rel.length - DIR.length)).replace(/\/$/, '')

  return place === '' ? 'the root of another checkout' : place
}

/** A folder's place in its checkout, for telling same-named files apart: its path without `.claude_todo`; empty at the repo root. */
export function folderPlace(rel: string): string {
  return rel.slice(0, Math.max(0, rel.length - DIR.length)).replace(/\/$/, '')
}
