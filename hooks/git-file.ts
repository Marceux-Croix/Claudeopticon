/**
 * The git common dir read from a `.git` entry, with no git (UCR-136): for a session whose `git rev-parse`
 * fails (dubious ownership, another HOME, no git on PATH, a timeout), so it still finds the claim folders
 * every git session of the repo uses. The claim folders come from the common dir alone (`claimDirs`), so
 * the common dir is all this reads.
 */

import { isAbsPath, resolveAgainst } from './path-forms'

/** Where a `.git` entry puts the repo: the common dir, absolute. */
export type GitWhere = { common: string }

/** A `.git` folder at `folder`: the common dir is that folder. */
export const gitDirWhere = (folder: string): GitWhere => ({ common: `${folder}/.git` })

/**
 * The git dir a `.git` file at `folder` names (its text `gitdir: <dir>`), absolute. Undefined for a text with
 * no `gitdir:` line, or one that gives no absolute path.
 */
export function gitFileDir(folder: string, text: string): string | undefined {
  const named = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.replace(/\r$/, '').trim()
  if (named === undefined || named === '') {
    return undefined
  }
  const gitdir = resolveAgainst(folder, named).replace(/\/+$/, '')

  return isAbsPath(gitdir) ? gitdir : undefined
}

/**
 * The common dir of a git dir, by git's own rule (UCR-202, `get_common_dir_noenv` in git's setup.c): when
 * `<gitdir>/commondir` exists (a linked worktree's git dir holds one, `../..`), the common dir is its text,
 * line ends cut, resolved against the git dir; when it does not (`commondir` undefined), the git dir is the
 * common dir. A path segment named `worktrees` says nothing: the old cut at the last `/worktrees/` put a
 * separate git dir under `.../worktrees/proj.git`, and a submodule named `worktrees`, in a folder no git
 * session names.
 */
export function commonDirOf(gitdir: string, commondir: string | undefined): GitWhere {
  if (commondir === undefined) {
    return { common: gitdir }
  }

  return { common: resolveAgainst(gitdir, commondir.replace(/[\r\n]+$/, '')).replace(/\/+$/, '') }
}

/** The folders from `start` up to the file system root, nearest first, at most `max`. */
export function foldersUp(start: string, max: number): string[] {
  const out: string[] = []
  let at = start.replace(/\/+$/, '')
  while (at !== '' && out.length < max) {
    out.push(at)
    const cut = at.lastIndexOf('/')
    at = cut <= 0 ? '' : at.slice(0, cut)
  }

  return out
}

/** The file calls of the `.git` walk, apart from the engine so a probe or a test can run it on a real or a fake disk. A call that fails gives undefined. */
export type GitFs = {
  exists: (path: string) => Promise<boolean | undefined>
  kind: (path: string) => Promise<string | undefined>
  read: (path: string) => Promise<string | undefined>
}

/**
 * The repo's git common dir from the `.git` entry nearest `base` and above it, up to the file system
 * root, as git walks (UCR-136: a limit of 9 folders left a deep todo folder claiming where no git
 * session lists). Undefined when no `.git` shows; `unknown` when a check fails, or a `.git` shows that
 * does not read or name a git dir: then no folder is safe (its git sessions may claim in a folder this
 * session cannot name), and no ID is given.
 */
export async function gitWhereUp(fs: GitFs, base: string): Promise<GitWhere | 'unknown' | undefined> {
  for (const folder of foldersUp(base, Number.POSITIVE_INFINITY)) {
    const path = `${folder}/.git`
    const isThere = await fs.exists(path)
    if (isThere === undefined) {
      return 'unknown'
    }
    if (!isThere) {
      continue
    }
    const kind = await fs.kind(path)
    if (kind === 'dir') {
      return gitDirWhere(folder)
    }
    const text = kind === 'file' ? await fs.read(path) : undefined
    const gitdir = text === undefined ? undefined : gitFileDir(folder, text)
    if (gitdir === undefined) {
      return 'unknown'
    }
    // The `commondir` file decides (UCR-202); a check or a read of it that fails names no folder.
    const commondir = `${gitdir}/commondir`
    const hasCommondir = await fs.exists(commondir)
    if (hasCommondir === undefined) {
      return 'unknown'
    }
    const linked = hasCommondir ? await fs.read(commondir) : undefined
    if (hasCommondir && linked === undefined) {
      return 'unknown'
    }

    return commonDirOf(gitdir, linked)
  }

  return undefined
}
