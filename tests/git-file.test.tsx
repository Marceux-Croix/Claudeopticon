import { expect, test } from 'claude-code/testing'

import { claimDirs } from '../hooks/id-blocks'
import { commonDirOf, foldersUp, gitDirWhere, gitFileDir, gitWhereUp } from '../hooks/git-file'
import type { GitFs } from '../hooks/git-file'

/**
 * Property (UCR-136): a session whose git call fails reads the same common dir from the `.git` entry that
 * `git rev-parse` gives a git session, so both list the same claim folders. UCR-136 (batch K1) dropped the root
 * from these answers: the claim folders come from the common dir alone, so the expectations name it only.
 */
/**
 * UCR-202 changed how a `.git` file gives the common dir: from the git dir's `commondir` file, as git reads it, not
 * from a cut at `/worktrees/`. The linked-worktree cases here now give the `commondir` text (`../..`, what
 * `git worktree add` writes) to `commonDirOf`; the expectations are those of UCR-136, unchanged.
 */
test('UCR-136 a .git entry read with no git gives the common dir git names, in each layout', () => {
  const where = (folder: string, text: string, commondir?: string) => {
    const gitdir = gitFileDir(folder, text)

    return gitdir === undefined ? undefined : commonDirOf(gitdir, commondir)
  }
  // A `.git` folder: the claim folders of a git session of `/repo` (common `/repo/.git`).
  expect(claimDirs(gitDirWhere('/repo'))).toEqual(claimDirs({ common: '/repo/.git' }))
  // Behind a valid first case: a linked worktree's `.git` file names `<common>/worktrees/<name>`, which holds `commondir`.
  expect(where('/wt/feature', 'gitdir: /repo/.git/worktrees/feature\n', '../..\n')).toEqual({ common: '/repo/.git' })
  // A separate git dir and a submodule (a relative gitdir): no `commondir`, so the git dir is the common dir.
  expect(where('/repo', 'gitdir: /store/repo.git')).toEqual({ common: '/store/repo.git' })
  expect(where('/super/sub', 'gitdir: ../.git/modules/sub\r\n')).toEqual({ common: '/super/.git/modules/sub' })
  // At the limit: a linked worktree of a separate git dir, and of a bare repo: the common dir only, the one every worktree names.
  expect(where('/wt/x', 'gitdir: /store/repo.git/worktrees/x', '../..')).toEqual({ common: '/store/repo.git' })
  expect(claimDirs(where('/wt/one', 'gitdir: /srv/bare.git/worktrees/one', '../..\n')!)).toEqual(claimDirs(where('/wt/two', 'gitdir: /srv/bare.git/worktrees/two', '../..\r\n')!))
  // The excluded population: a text with no gitdir line, or an empty one, gives nothing.
  expect(gitFileDir('/repo', 'not a git file')).toBeUndefined()
  expect(gitFileDir('/repo', 'gitdir:   ')).toBeUndefined()
})

/**
 * Property (UCR-202): a session whose git fails takes the common dir from the `commondir` file of the git dir its
 * `.git` file names, as git does, so it names the claim folders a git session names, whatever the path segments
 * are called. The reviewer's s6 (a separate git dir under `.../worktrees/proj.git`) and s7 (a submodule named
 * `worktrees`, with a nested submodule `inner`) layouts, as `git` makes them (`S/lay`).
 */
test('UCR-202 the common dir comes from the commondir file, never from a path segment named worktrees', async () => {
  // Behind a valid first case: a linked worktree, whose git dir holds `commondir` (`../..`).
  expect(await gitWhereUp(walkFs({ '/wt/.git': 'gitdir: /repo/.git/worktrees/wt\n', '/repo/.git/worktrees/wt/commondir': '../..\n' }), '/wt')).toEqual({ common: '/repo/.git' })
  // s6: `git init --separate-git-dir=/store/worktrees/proj.git /wproj`; the old cut gave `/store`, outside the repo.
  expect(await gitWhereUp(walkFs({ '/wproj/.git': 'gitdir: /store/worktrees/proj.git\n' }), '/wproj')).toEqual({ common: '/store/worktrees/proj.git' })
  // s7: the nested submodule's git dir is `/super/.git/modules/worktrees/modules/inner`; the old cut gave `/super/.git/modules`.
  expect(await gitWhereUp(walkFs({ '/super/worktrees/inner/.git': 'gitdir: ../../.git/modules/worktrees/modules/inner\n' }), '/super/worktrees/inner')).toEqual({ common: '/super/.git/modules/worktrees/modules/inner' })
  // At the limit: the `worktrees` segment last, and a linked worktree of the s6 git dir (both segments; commondir decides).
  expect(await gitWhereUp(walkFs({ '/p/.git': 'gitdir: /x/worktrees\n' }), '/p')).toEqual({ common: '/x/worktrees' })
  expect(await gitWhereUp(walkFs({ '/w2/.git': 'gitdir: /store/worktrees/proj.git/worktrees/w2\n', '/store/worktrees/proj.git/worktrees/w2/commondir': '../..\n' }), '/w2')).toEqual({ common: '/store/worktrees/proj.git' })
  // An absolute `commondir` text, as git also reads.
  expect(await gitWhereUp(walkFs({ '/w3/.git': 'gitdir: /g/worktrees/w3\n', '/g/worktrees/w3/commondir': '/elsewhere/c.git\n' }), '/w3')).toEqual({ common: '/elsewhere/c.git' })
  // The excluded population: a `commondir` whose check fails, or that does not read, names no folder.
  expect(await gitWhereUp(walkFs({ '/w4/.git': 'gitdir: /g/worktrees/w4\n' }, ['/g/worktrees/w4/commondir']), '/w4')).toBe('unknown')
  expect(await gitWhereUp(walkFs({ '/w5/.git': 'gitdir: /g/worktrees/w5\n', '/g/worktrees/w5/commondir': 'unreadable' }), '/w5')).toBe('unknown')
  // The two views of s6 and s7 agree: the git session's common dir is the git dir itself (`git rev-parse --git-common-dir`).
  const s6 = await gitWhereUp(walkFs({ '/wproj/.git': 'gitdir: /store/worktrees/proj.git\n' }), '/wproj')
  expect(typeof s6 === 'object' ? claimDirs(s6) : s6).toEqual(claimDirs({ common: '/store/worktrees/proj.git' }))
})

test('foldersUp walks from a folder to the root, nearest first, at most max', () => {
  expect(foldersUp('/repo/mods/y', 9)).toEqual(['/repo/mods/y', '/repo/mods', '/repo'])
  expect(foldersUp('/a/b/c/d', 2)).toEqual(['/a/b/c/d', '/a/b/c'])
  expect(foldersUp('/repo/', 9)).toEqual(['/repo'])
})

/** A fake disk for the `.git` walk: `entries` maps a path to a folder (`dir`) or a file's text; `failing` paths fail the presence check. */
function walkFs(entries: Record<string, string>, failing: string[] = []): GitFs {
  return {
    exists: async path => (failing.includes(path) ? undefined : path in entries),
    kind: async path => (entries[path] === undefined ? undefined : entries[path] === 'dir' ? 'dir' : 'file'),
    read: async path => (entries[path] === undefined || entries[path] === 'dir' || entries[path] === 'unreadable' ? undefined : entries[path]),
  }
}

/**
 * Property (UCR-136): a session whose git fails finds the repo's `.git` however deep its todo folder is, as git
 * walks up with no folder limit, so it claims where the git sessions do; a `.git` it cannot tell names no folder.
 */
test('UCR-136 gitWhereUp walks up with no folder limit, and a .git it cannot read is unknown', async () => {
  // The verifier's edge case 2: a primary todo folder 12 folders below the repo root; the old walk stopped at 9.
  const deep = `/repo/${Array.from({ length: 12 }, (_, i) => `d${i}`).join('/')}`
  expect(await gitWhereUp(walkFs({ '/repo/.git': 'dir' }), deep)).toEqual({ common: '/repo/.git' })
  // Behind a valid first case: a bare repo's worktree `.git` file names the common dir every worktree names.
  expect(await gitWhereUp(walkFs({ '/wt/one/.git': 'gitdir: /srv/bare.git/worktrees/one\n', '/srv/bare.git/worktrees/one/commondir': '../..\n' }), '/wt/one')).toEqual({ common: '/srv/bare.git' })
  // At the limit: a `.git` in the topmost folder of the path; and none anywhere, which is no repo.
  expect(await gitWhereUp(walkFs({ '/a/.git': 'dir' }), '/a/b/c')).toEqual({ common: '/a/.git' })
  expect(await gitWhereUp(walkFs({}), '/a/b')).toBeUndefined()
  // The excluded population: a presence check that fails, a `.git` file that does not read, one with no gitdir line.
  expect(await gitWhereUp(walkFs({ '/repo/.git': 'dir' }, ['/repo/a/.git']), '/repo/a')).toBe('unknown')
  expect(await gitWhereUp(walkFs({ '/repo/.git': 'unreadable' }), '/repo')).toBe('unknown')
  expect(await gitWhereUp(walkFs({ '/repo/.git': 'not a git file' }), '/repo')).toBe('unknown')
})
