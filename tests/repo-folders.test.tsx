import { expect, test } from 'claude-code/testing'

import { diskSpelling, findTodoDirWith, gitCommonDir, globalDirs, globalParents, isGlobalTodo, isInsideRoots, isMisspelledTodo, isSameTodo, isTodoOf, MAX_FOLDERS, MAX_UP_NO_REAL, pickFolders, repoRoots, replaceGlobals, revParseLines, sessionFolder, todoFoldersIn } from '../hooks/repo-folders'

test('the todo folder is the repo root one, the main checkout one from a worktree, and never the global one', async () => {
  const fake = (layout: Record<string, 'dir' | 'file'>, real: Record<string, string> = {}) => ({
    exists: async (path: string) => layout[path] !== undefined,
    kind: async (path: string) => layout[path],
    realPath: async (path: string) => real[path],
    // A linked worktree's git dir holds `commondir`, as git writes it (the common dir is read from it, never from the text `/worktrees/`).
    read: async (path: string) => (path === '/repo/.git/worktrees/x/commondir' ? '../..\n' : 'gitdir: /repo/.git/worktrees/x\n'),
  })
  // The nearest todo wins, up to the repo root: a subfolder's own, else the root's.
  expect(await findTodoDirWith(fake({ '../../.git': 'dir', '../../.claude_todo': 'dir', '.claude_todo': 'dir' }))).toBe('.claude_todo')
  expect(await findTodoDirWith(fake({ '../../.git': 'dir', '../.claude_todo': 'dir' }))).toBe('../.claude_todo')
  expect(await findTodoDirWith(fake({ '../../.git': 'dir', '../../.claude_todo': 'dir' }))).toBe('../../.claude_todo')
  // Above the repo root, nothing counts.
  expect(await findTodoDirWith(fake({ '.git': 'dir', '../.claude_todo': 'dir' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.git': 'file', '/repo/.claude_todo': 'dir' }))).toBe('/repo/.claude_todo')
  expect(await findTodoDirWith(fake({ '.git': 'dir' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.claude_todo': 'dir' }, { '.claude_todo': '/home/someone/.claude/.claude_todo' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.git': 'dir', '.claude_todo': 'dir' }, { '.claude_todo': '/home/someone/.claude/.claude_todo' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '../.claude_todo': 'dir' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.claude_todo': 'dir' }))).toBe('.claude_todo')
  expect(isGlobalTodo('/home/a/.claude/.claude_todo')).toBe(true)
  expect(isGlobalTodo('/home/a/project/.claude_todo')).toBe(false)
  expect(isGlobalTodo('/home/a/.claude/.claude_todo/')).toBe(true)
  expect(isGlobalTodo('/root/.claude/.claude_todo')).toBe(true)
  // A project's own .claude/.claude_todo is not the global folder.
  expect(isGlobalTodo('/home/a/project/.claude/.claude_todo')).toBe(false)
  expect(isGlobalTodo('/repo/.claude/.claude_todo')).toBe(false)
  expect(await findTodoDirWith(fake({ '.git': 'dir', '.claude_todo': 'dir' }, { '.claude_todo': '/home/a/proj/.claude/.claude_todo' }))).toBe('.claude_todo')
})

// ---------------------------------------------------------------- many todo folders

test('git output gives the todo folders: nested ones, an ignored folder entry, the roots of a worktree', async () => {
  const listing = ['a.txt', '.claude_todo/TODO.md', '.claude_todo/archive/OLD.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/src/b.ts', 'deep/er/.claude_todo/', 'x.claude_todo/f.md', ''].join('\0')
  expect(todoFoldersIn(listing, '/repo')).toEqual([
    { path: '/repo/.claude_todo', rel: '.claude_todo' },
    { path: '/repo/deep/er/.claude_todo', rel: 'deep/er/.claude_todo' },
    { path: '/repo/mods/x/.claude_todo', rel: 'mods/x/.claude_todo' },
  ])
  expect(todoFoldersIn('', '/repo')).toEqual([])
  expect(repoRoots('/repo\n/repo/.git\n')).toEqual({ root: '/repo' })
  expect(repoRoots('/work/tree\n/repo/.git\n')).toEqual({ root: '/work/tree', main: '/repo' })
  expect(repoRoots('fatal: not a git repository')).toBeUndefined()
})

test('the folders are the primary first then by path, the global one dropped, one place once, at most 20', async () => {
  const at = (rel: string) => ({ path: `/r/${rel}`, rel })
  const found = [at('z/.claude_todo'), at('.claude_todo'), at('a/.claude_todo'), at('g/.claude_todo'), { path: '/main/a/.claude_todo', rel: 'a/.claude_todo' }]
  const picked = pickFolders(found, '/r/z/.claude_todo', new Set(['/r/g/.claude_todo']))
  expect(picked.map(one => one.rel)).toEqual(['z/.claude_todo', '.claude_todo', 'a/.claude_todo'])
  expect(picked.map(one => one.isOther)).toEqual([false, true, true])
  expect(picked[2]?.path).toBe('/r/a/.claude_todo')
  const many = Array.from({ length: 30 }, (_, i) => at(`d${String(i).padStart(2, '0')}/.claude_todo`))
  const capped = pickFolders(many, '/r/d29/.claude_todo', new Set())
  expect(capped.length).toBe(MAX_FOLDERS)
  expect(capped[0]?.rel).toBe('d29/.claude_todo')
  expect(capped[1]?.rel).toBe('d00/.claude_todo')
  expect(pickFolders(many, undefined, new Set()).every(one => one.isOther)).toBe(true)
  // The same place listed twice (a worktree and its main checkout): the primary's entry stays.
  const twice = pickFolders([{ path: '/main/a/.claude_todo', rel: 'a/.claude_todo' }, { path: '/wt/a/.claude_todo', rel: 'a/.claude_todo' }], '/wt/a/.claude_todo', new Set())
  expect(twice).toEqual([{ path: '/wt/a/.claude_todo', rel: 'a/.claude_todo', isOther: false }])
})

test('isGlobalTodo matches a Windows home too, in any case', () => {
  expect(isGlobalTodo('C:/Accounts/Me/.claude/.claude_todo')).toBe(true)
  expect(isGlobalTodo('c:\\accounts\\Me\\.claude\\.claude_todo\\')).toBe(true)
  expect(isGlobalTodo('C:/repo/.claude_todo')).toBe(false)
  // A profile outside C:/Users still counts: on Windows every .claude/.claude_todo is global.
  expect(isGlobalTodo('D:/Profiles/me/.claude/.claude_todo')).toBe(true)
})

// ---------------------------------------------------------------- and 
// Property: a linked worktree is told by its git dir differing from the common dir, whatever the
// shape of the common dir, with git of any age; its main checkout is the first worktree listed.

const LIST = 'worktree /main\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt\nHEAD def\n'

test('repoRoots finds the main checkout of a linked worktree whose common dir does not end in /.git', () => {
  // A separate git dir.
  expect(repoRoots('/wt\n/sep/main.git/worktrees/wt\n/sep/main.git\n', LIST)).toEqual({ root: '/wt', main: '/main' })
  // A submodule's worktree: the common dir is inside the super-project.
  expect(repoRoots('/wt\n/super/.git/modules/sub/worktrees/wt\n/super/.git/modules/sub\n', LIST)).toEqual({ root: '/wt', main: '/main' })
  // The limit: a relative common dir at the top folder.
  expect(repoRoots('/wt\n../sep/main.git/worktrees/wt\n../sep/main.git\n', LIST)).toEqual({ root: '/wt', main: '/main' })
  // Linked, with no list: the main is not known, but the worktree is still told.
  expect(repoRoots('/wt\n/sep/main.git/worktrees/wt\n/sep/main.git\n')).toEqual({ root: '/wt', isLinked: true })
  // Not linked: a separate git dir of the main checkout itself.
  expect(repoRoots('/main\n/sep/main.git\n/sep/main.git\n', LIST)).toEqual({ root: '/main' })
  expect(repoRoots('/repo\n.git\n.git\n')).toEqual({ root: '/repo' })
})

test('findTodoDirWith follows a separate git dir to the main checkout through core.worktree', async () => {
  const layout: Record<string, 'dir' | 'file'> = { '.git': 'file', '/main/.claude_todo': 'dir' }
  const texts: Record<string, string> = { '.git': 'gitdir: /sep/main.git/worktrees/wt\n', '/sep/main.git/worktrees/wt/commondir': '../..\n', '/sep/main.git/config': '[core]\n\tworktree = /main\n' }
  const fake = (extra: Record<string, string> = {}) => ({
    exists: async (path: string) => layout[path] !== undefined,
    kind: async (path: string) => layout[path],
    realPath: async (path: string) => path,
    read: async (path: string) => ({ ...texts, ...extra })[path] ?? '',
  })
  expect(await findTodoDirWith(fake())).toBe('/main/.claude_todo')
  // A relative core.worktree reads against the common dir.
  layout['/sep/main/.claude_todo'] = 'dir'
  expect(await findTodoDirWith(fake({ '/sep/main.git/config': '[core]\n\tworktree = ../main\n' }))).toBe('/sep/main/.claude_todo')
  // No core.worktree: the main checkout is not known, so no folder.
  expect(await findTodoDirWith(fake({ '/sep/main.git/config': '[core]\n' }))).toBeUndefined()
})

// ---------------------------------------------------------------- (G1)
// Property: the main checkout is never an ancestor folder made up from a misread relative dir. Git
// prints a relative dir against the session folder (git 2.54 from `sub/deep`: `../../.git`), so it is
// read against the top plus `--show-prefix`. The shapes below are real git output.

const PLAIN_LIST = (top: string) => `worktree ${top}\nHEAD a\nbranch refs/heads/main\n`
const SUB_STATES: [string, string, string][] = [
  ['the session one folder down', '/w/repo\n/w/repo/.git\n../.git\nsub/\n', '/w/repo'],
  ['the session two folders down', '/a/b/repo\n/a/b/repo/.git\n../../.git\nsub/deep/\n', '/a/b/repo'],
  ['a repo nested in another repo, the session in its subfolder', '/outer/inner\n/outer/inner/.git\n../.git\nsub/\n', '/outer/inner'],
]
for (const [name, rev, top] of SUB_STATES) {
  test(`repoRoots, ${name}: the repo is plain, with no main checkout above it`, () => {
    expect(repoRoots(rev)).toEqual({ root: top })
    expect(repoRoots(rev, PLAIN_LIST(top))).toEqual({ root: top })
    expect(sessionFolder(rev)).toBe(`${top}/${rev.split('\n')[3]!.replace(/\/$/, '')}`)
  })
}

test('repoRoots without the prefix line: a relative common dir that does not hold the git dir gives no main', () => {
  // The three-line output from a subfolder, read against the top, names /w/.git: no ancestor is taken.
  expect(repoRoots('/w/repo\n/w/repo/.git\n../.git\n')).toEqual({ root: '/w/repo', isLinked: true })
  expect(repoRoots('/w/repo\n/w/repo/.git\n../.git\n', '')).toEqual({ root: '/w/repo', isLinked: true })
  expect(sessionFolder('/w/repo\n.git\n.git\n\n')).toBe('/w/repo')
  expect(sessionFolder('fatal: not a git repository')).toBeUndefined()
})

test('a linked worktree is still told from a subfolder, with its main from the list', () => {
  const list = 'worktree /main\nHEAD a\nbranch refs/heads/main\n\nworktree /wt\nHEAD b\n'
  expect(repoRoots('/wt\n/main/.git/worktrees/wt\n/main/.git\nsrc/\n', list)).toEqual({ root: '/wt', main: '/main' })
  // A relative common dir from the subfolder reads against it, not the top.
  expect(repoRoots('/wt\n/main/.git/worktrees/wt\n../../main/.git\nsrc/\n', list)).toEqual({ root: '/wt', main: '/main' })
  // With no list, the folder holding the .git common dir.
  expect(repoRoots('/wt\n/main/.git/worktrees/wt\n../../main/.git\nsrc/\n')).toEqual({ root: '/wt', main: '/main' })
})

// ---------------------------------------------------------------- (G1)
// Property: the first worktree listed is the main checkout only when it is a checkout, not the git dir
// that git lists for a separate git dir; else the worktree is linked with no main, and its own folder
// stays its trust root.

const SEP_STATES: [string, string, string][] = [
  ['the git dir itself, as git 2.54 lists a separate git dir', '/sepwt\n/sep.git/worktrees/sepwt\n/sep.git\n', 'worktree /sep.git\nHEAD a\nbranch refs/heads/master\n\nworktree /sepwt\nHEAD a\nbranch refs/heads/sepwt\n'],
  ['a folder inside the git dir', '/sepwt\n/sep.git/worktrees/sepwt\n/sep.git\n', 'worktree /sep.git/worktrees\nHEAD a\n\nworktree /sepwt\nHEAD a\n'],
  ['an entry marked bare', '/wt\n/srv/r.git/worktrees/wt\n/srv/r.git\n', 'worktree /srv/r\nbare\n\nworktree /wt\nHEAD a\n'],
]
for (const [name, rev, list] of SEP_STATES) {
  test(`repoRoots takes no main when the first worktree listed is ${name}`, () => {
    const root = rev.split('\n')[0]!
    expect(repoRoots(rev, list)).toEqual({ root, isLinked: true })
  })
}

// ---------------------------------------------------------------- (G1)
// Property: a global folder known from the environment is told in any spelling, Windows included.

test('isGlobalTodo matches a CLAUDE_CONFIG_DIR folder on Windows in any case and slash', () => {
  globalDirs.add('D:/cfg/.claude_todo')
  try {
    expect(isGlobalTodo('D:/cfg/.claude_todo')).toBe(true)
    expect(isGlobalTodo('d:\\Cfg\\.claude_todo\\')).toBe(true)
    expect(isGlobalTodo('D:/cfg/repo/.claude_todo')).toBe(false)
    expect(isGlobalTodo('/cfg/.claude_todo')).toBe(false)
  } finally {
    globalDirs.clear()
  }
})

// ---------------------------------------------------------------- (H3)
// Property 099: a repo whose .git is a symlink is the same repo from a subfolder as from the top (not linked).
// Property 100: a repo folder name keeps its trailing space; only the line break is cut from the output.

const LINK_STATES: [string, string][] = [
  ['one folder down', '/r\n/store/r.git\n../.git\nsub/\n'],
  ['at the limit of the scan, eight folders down', `/r\n/store/r.git\n${'../'.repeat(8)}.git\n${'d/'.repeat(8)}\n`],
  ['with a worktree list that names the repo', '/r\n/store/r.git\n../.git\nsub/\n'],
]
for (const [name, rev] of LINK_STATES) {
  test(`repoRoots with a symlinked .git, ${name}: a plain repo, not a linked worktree`, () => {
    expect(repoRoots(rev, 'worktree /r\nHEAD a\nbranch refs/heads/main\n')).toEqual({ root: '/r' })
    expect(repoRoots(rev)).toEqual({ root: '/r' })
  })
}

test('a real linked worktree, a separate git dir and a foreign common dir stay linked', () => {
  expect(repoRoots('/wt\n/main/.git/worktrees/wt\n../../main/.git\nsrc/\n')).toEqual({ root: '/wt', main: '/main' })
  expect(repoRoots('/sepwt\n/sep.git/worktrees/sepwt\n/sep.git\n\n')).toEqual({ root: '/sepwt', isLinked: true })
  expect(repoRoots('/r\n/store/r.git\n/other/.git\n\n')).toEqual({ root: '/r', isLinked: true })
})

const SPACE_STATES: [string, string][] = [
  ['at the top', '/tmp/tr \n.git\n.git\n\n'],
  ['from a subfolder', '/tmp/tr \n/tmp/tr /.git\n../.git\nsub/\n'],
  ['from a Windows tool (CRLF)', '/tmp/tr \r\n.git\r\n.git\r\n\r\n'],
]
for (const [name, rev] of SPACE_STATES) {
  test(`repoRoots and sessionFolder keep the trailing space of the repo folder name ${name}`, () => {
    expect(repoRoots(rev)).toEqual({ root: '/tmp/tr ' })
    expect(sessionFolder(rev)?.startsWith('/tmp/tr ')).toBe(true)
  })
}

test('a main checkout named with a trailing space is found from the worktree list', () => {
  expect(repoRoots('/wt\n/m /.git/worktrees/wt\n/m /.git\n\n', 'worktree /m \nHEAD a\n\nworktree /wt\nHEAD b\n')).toEqual({ root: '/wt', main: '/m ' })
})

// ---------------------------------------------------------------- remainder

/**
 * Property: the claim folder's base is the git common dir as an absolute path in every git layout, the
 * same for every session of the repo wherever its working folder is; never a folder beside the nearest todo.
 */
test('gitCommonDir: the common dir, absolute, for a .git folder, a .git file and a worktree, from any subfolder', () => {
  // A plain repo, from the top and from a subfolder (git prints the dir against the folder it runs in).
  expect(gitCommonDir('/repo\n.git\n.git\n\n')).toBe('/repo/.git')
  expect(gitCommonDir('/repo\n/repo/.git\n../../.git\nmods/y/\n')).toBe('/repo/.git')
  // The state: `.git` is a file (`--separate-git-dir`); sessions at the root and in `mods/y` name one dir.
  expect(gitCommonDir('/repo\n/store/repo.git\n/store/repo.git\n\n')).toBe('/store/repo.git')
  expect(gitCommonDir('/repo\n/store/repo.git\n/store/repo.git\nmods/y/\n')).toBe('/store/repo.git')
  // A submodule, and a linked worktree (the main checkout's common dir).
  expect(gitCommonDir('/super/sub\n/super/.git/modules/sub\n/super/.git/modules/sub\n\n')).toBe('/super/.git/modules/sub')
  expect(gitCommonDir('/wt\n/repo/.git/worktrees/wt\n/repo/.git\n\n')).toBe('/repo/.git')
  // At the limit: the old two-line output (top, common), as the H2 fakes answer.
  expect(gitCommonDir('/repo\n/repo/.git\n')).toBe('/repo/.git')
  // The excluded population: output with no top folder, or no dir, names none.
  expect(gitCommonDir('')).toBeUndefined()
  expect(gitCommonDir('/repo\n')).toBeUndefined()
})

// ---------------------------------------------------------------- (J1)

test('isTodoOf: the .claude_todo of a global parent, in any spelling of that parent', () => {
  // The defect states: a symlinked ~/.claude's real folder, a CLAUDE_CONFIG_DIR with a trailing slash, a Windows real path with backslashes.
  expect(isTodoOf('/home/a/dotfiles/claude/.claude_todo', ['/home/a/dotfiles/claude'])).toBe(true)
  expect(isTodoOf('/data/cfg/.claude_todo', ['/srv/x', '/data/cfg/'])).toBe(true)
  expect(isTodoOf('C:/Users/0Me/dot/.claude_todo', ['c:\\users\\0me\\dot'])).toBe(true)
  // The excluded population: a project folder below a global parent, and one beside it.
  expect(isTodoOf('/home/a/dotfiles/claude/proj/.claude_todo', ['/home/a/dotfiles/claude'])).toBe(false)
  expect(isTodoOf('/home/a/dotfiles/claude2/.claude_todo', ['/home/a/dotfiles/claude'])).toBe(false)
  expect(isTodoOf('/home/a/dotfiles/claude/.claude_todo', [])).toBe(false)
})

// The first state is the exact output real git 2.54 printed for the repo `nl<LF>x` (probe roots.ts, layouts.sh): the line break moves every line.
const NL_STATES: [string, string][] = [
  ['a line break inside the repo folder name', '/w/nl\nx\n.git\n.git\n\n'],
  ['a line break at the end of the repo folder name', '/w/nl\n\n.git\n.git\n\n'],
  ['a line break in the --show-prefix line of a subfolder', '/w/a\n/w/a/.git\n../.git\nnl\nx/\n'],
  ['a line break in the git dir of a linked worktree', '/w/wt\n/w/m\nx/.git/worktrees/wt\n/w/m\nx/.git\n\n'],
]
for (const [name, out] of NL_STATES) {
  test(`REV_PARSE output with ${name} names no repo and no session folder`, () => {
    expect(revParseLines(out)).toBeUndefined()
    expect(sessionFolder(out)).toBeUndefined()
    expect(repoRoots(out)).toBeUndefined()
    expect(gitCommonDir(out)).toBeUndefined()
  })
}

test('a CR at the end of a POSIX folder name stays in the path: the repo is that folder, not the one without the CR', () => {
  // At the top, in the prefix line, and in the common dir of a linked worktree.
  expect(repoRoots('/w/nl\r\n.git\n.git\n\n')).toEqual({ root: '/w/nl\r' })
  expect(sessionFolder('/w/a\n/w/a/.git\n../.git\nnl\r/\n')).toBe('/w/a/nl\r')
  expect(gitCommonDir('/w/wt\n/w/m\r/.git/worktrees/wt\n/w/m\r/.git\n\n')).toBe('/w/m\r/.git')
  // The excluded population: a Windows git, every line break CRLF, loses each CR with its line break.
  expect(repoRoots('C:/repo\r\n.git\r\n.git\r\n\r\n')).toEqual({ root: 'C:/repo' })
})

test('control: the real outputs of the plain, subfolder, worktree and old two-line shapes still read', () => {
  expect(revParseLines('/w/plain\n.git\n.git\n\n')).toEqual(['/w/plain', '.git', '.git', '', ''])
  expect(sessionFolder('/w/plain\n/w/plain/.git\n../../.git\nsub/deep/\n')).toBe('/w/plain/sub/deep')
  expect(repoRoots('/w/wt\n/w/plain/.git/worktrees/wt\n/w/plain/.git\n\n')).toEqual({ root: '/w/wt', main: '/w/plain' })
  expect(repoRoots('/repo\n/repo/.git\n')).toEqual({ root: '/repo' })
  // CRLF lines from a Windows git count as one line each.
  expect(sessionFolder('C:/repo\r\n.git\r\n.git\r\nsub/\r\n')).toBe('C:/repo/sub')
})

test('diskSpelling: a listed folder whose real path differs only by case takes the real path', () => {
  // The defect states: one segment, two segments, and a Windows real path with backslashes.
  expect(diskSpelling({ path: '/repo/Docs/.claude_todo', rel: 'Docs/.claude_todo' }, '/repo/docs/.claude_todo', ['/repo'])).toEqual({ path: '/repo/docs/.claude_todo', rel: 'docs/.claude_todo' })
  expect(diskSpelling({ path: '/main/Mods/A/.claude_todo', rel: 'Mods/A/.claude_todo' }, '/main/mods/a/.claude_todo', ['/wt', '/main'])).toEqual({ path: '/main/mods/a/.claude_todo', rel: 'mods/a/.claude_todo' })
  expect(diskSpelling({ path: 'C:/repo/Docs/.claude_todo', rel: 'Docs/.claude_todo' }, 'C:\\repo\\docs\\.claude_todo', ['C:/repo'])).toEqual({ path: 'C:/repo/docs/.claude_todo', rel: 'docs/.claude_todo' })
  // The excluded population: a symlink elsewhere, an NFD real path, no real path, and the same spelling are left as listed.
  const one = { path: '/repo/Docs/.claude_todo', rel: 'Docs/.claude_todo' }
  expect(diskSpelling(one, '/elsewhere/docs/.claude_todo', ['/repo'])).toBe(one)
  expect(diskSpelling({ path: '/repo/caf\u00e9/.claude_todo', rel: 'caf\u00e9/.claude_todo' }, '/repo/cafe\u0301/.claude_todo', ['/repo']).path).toBe('/repo/caf\u00e9/.claude_todo')
  expect(diskSpelling(one, undefined, ['/repo'])).toBe(one)
  expect(diskSpelling(one, '/repo/Docs/.claude_todo', ['/repo'])).toBe(one)
})

// ---------------------------------------------------------------- more cases

/** Property: a project folder that the global `.claude_todo` resolves to at write time is the global folder. */
test('isSameTodo: the real path of a global .claude_todo, read at write time, names the folder global', () => {
  // The V148 state: `~/.claude/.claude_todo` made a symlink to `/repo/.claude_todo` after the load.
  expect(isSameTodo('/repo/.claude_todo', '/repo/.claude_todo')).toBe(true)
  // Behind a valid first case and at the limit of the compare: a trailing slash, NFD, and a Windows path in any case.
  expect(isSameTodo('/repo/.claude_todo', '/repo/.claude_todo/')).toBe(true)
  expect(isSameTodo('/w/caf\u00e9/.claude_todo', '/w/cafe\u0301/.claude_todo')).toBe(true)
  expect(isSameTodo('C:/Work/.claude_todo', 'c:\\work\\.claude_todo')).toBe(true)
  // The excluded population: no global folder (it does not resolve), and another folder.
  expect(isSameTodo('/repo/.claude_todo', undefined)).toBe(false)
  expect(isSameTodo('/repo/.claude_todo', '/home/a/.claude/.claude_todo')).toBe(false)
  expect(isSameTodo('/repo/sub/.claude_todo', '/repo/.claude_todo')).toBe(false)
})

/** Property: a `.claude_todo` folder git lists in another letter case is found, and one the disk spells so is named, never skipped silently. */
test('todoFoldersIn matches the .claude_todo segment in any case, and isMisspelledTodo names a folder not spelled .claude_todo', () => {
  // The V151 state: the index keeps `.Claude_todo` after a case-only rename of the folder itself.
  expect(todoFoldersIn('.claude_todo/TODO.md\0docs/.Claude_todo/TODO.md', '/repo').map(one => one.rel)).toEqual(['.claude_todo', 'docs/.Claude_todo'])
  expect(diskSpelling({ path: '/repo/docs/.Claude_todo', rel: 'docs/.Claude_todo' }, '/repo/docs/.claude_todo', ['/repo'])).toEqual({ path: '/repo/docs/.claude_todo', rel: 'docs/.claude_todo' })
  // At the limit: every letter in another case, and a collapsed ignored entry.
  expect(todoFoldersIn('x/.CLAUDE_TODO/', '/repo').map(one => one.rel)).toEqual(['x/.CLAUDE_TODO'])
  // The disk's own spelling is not `.claude_todo`: named, so discovery leaves it out with one toast.
  expect(isMisspelledTodo('/repo/docs/.Claude_todo')).toBe(true)
  expect(isMisspelledTodo('/repo/.CLAUDE_TODO/')).toBe(true)
  // The excluded population: the right spelling, and other names that only contain the word.
  expect(isMisspelledTodo('/repo/docs/.claude_todo')).toBe(false)
  expect(isMisspelledTodo('/repo/.claude_todo_old')).toBe(false)
  expect(todoFoldersIn('a/.claude_todo_old/x.md\0b/claude_todo/x.md', '/repo')).toEqual([])
})

// ---------------------------------------------------------------- L1

/** A fake disk for the nearest-folder walk: `layout` by relative path, file texts by path, and the real path of `.`. */
function walkFs(layout: Record<string, 'dir' | 'file'>, texts: Record<string, string>, realDot: string | undefined) {
  return {
    exists: async (path: string) => layout[path] !== undefined,
    kind: async (path: string) => layout[path],
    realPath: async (path: string) => (path === '.' ? realDot : path),
    read: async (path: string) => {
      const text = texts[path]
      if (text === undefined) {
        throw new Error(`ENOENT ${path}`)
      }

      return text
    },
  }
}
const up = (n: number) => '../'.repeat(n)
const deep = (root: string, n: number) => `${root}${root.endsWith('/') ? '' : '/'}${'abcdefghijklmnopqrstuvwxyz'.slice(0, n).split('').join('/')}`.replace(/\/$/, '')

/** Property: in a repo, the nearest-folder walk reaches the repo root's folder at any depth; only with no readable real path is it bounded, by MAX_UP_NO_REAL. */
test('the nearest-folder walk finds the repo root folder at any depth below it', async () => {
  // The valid first cases: the old limit, 8 folders down, and the root itself.
  for (const n of [0, 2, 8]) {
    expect(await findTodoDirWith(walkFs({ [`${up(n)}.git`]: 'dir', [`${up(n)}.claude_todo`]: 'dir' }, {}, deep('/repo', n)))).toBe(`${up(n)}.claude_todo`)
  }
  // False state 1, behind the valid first case: 9 and 12 folders down (the old walk stopped at 8).
  for (const n of [9, 12]) {
    expect(await findTodoDirWith(walkFs({ [`${up(n)}.git`]: 'dir', [`${up(n)}.claude_todo`]: 'dir' }, {}, deep('/repo', n)))).toBe(`${up(n)}.claude_todo`)
  }
  // False state 2, at the limit of the scanned range: a repo at the file system root, 10 folders up, the last level the walk reaches.
  expect(await findTodoDirWith(walkFs({ [`${up(10)}.git`]: 'dir', [`${up(10)}.claude_todo`]: 'dir' }, {}, deep('/', 10)))).toBe(`${up(10)}.claude_todo`)
  // A todo folder 9 down whose .git is 3 levels higher still: the inner walk has no count limit either.
  expect(await findTodoDirWith(walkFs({ [`${up(12)}.git`]: 'dir', [`${up(9)}.claude_todo`]: 'dir' }, {}, deep('/repo', 12)))).toBe(`${up(9)}.claude_todo`)
  // A worktree 10 down finds its main checkout's folder through its .git file.
  expect(await findTodoDirWith(walkFs({ [`${up(10)}.git`]: 'file', '/main/.claude_todo': 'dir' }, { [`${up(10)}.git`]: 'gitdir: /main/.git/worktrees/wt\n', '/main/.git/worktrees/wt/commondir': '../..\n' }, deep('/wt', 10)))).toBe('/main/.claude_todo')
  // False state 3, inside the excluded population: the real path of `.` does not read. The stated bound holds, and no more.
  expect(await findTodoDirWith(walkFs({ [`${up(MAX_UP_NO_REAL)}.git`]: 'dir', [`${up(MAX_UP_NO_REAL)}.claude_todo`]: 'dir' }, {}, undefined))).toBe(`${up(MAX_UP_NO_REAL)}.claude_todo`)
  expect(await findTodoDirWith(walkFs({ [`${up(MAX_UP_NO_REAL + 1)}.git`]: 'dir', [`${up(MAX_UP_NO_REAL + 1)}.claude_todo`]: 'dir' }, {}, undefined))).toBeUndefined()
  // Outside a repo nothing above the session folder counts, at any depth, and the walk ends at the root.
  expect(await findTodoDirWith(walkFs({ [`${up(9)}.claude_todo`]: 'dir' }, {}, deep('/x', 12)))).toBeUndefined()
  expect(await findTodoDirWith(walkFs({ '.claude_todo': 'dir' }, {}, deep('/x', 12)))).toBe('.claude_todo')
  // A Windows real path in backslashes counts its levels the same way.
  expect(await findTodoDirWith(walkFs({ [`${up(9)}.git`]: 'dir', [`${up(9)}.claude_todo`]: 'dir' }, {}, deep('C:/repo', 9).replace(/\//g, '\\')))).toBe(`${up(9)}.claude_todo`)
})

/** Property (mainOf): the main checkout of a `.git` file comes from git's own rule, the `commondir` file of the git dir, never from the text `/worktrees/`. */
test('the main checkout of a .git file is read from commondir, never from a /worktrees/ segment', async () => {
  // The valid first case: a linked worktree, with commondir as git writes it.
  expect(await findTodoDirWith(walkFs({ '.git': 'file', '/main/.claude_todo': 'dir' }, { '.git': 'gitdir: /main/.git/worktrees/wt\n', '/main/.git/worktrees/wt/commondir': '../..\n' }, '/wt'))).toBe('/main/.claude_todo')
  // False state 1: a separate git dir under a folder named `worktrees` (no commondir: it is no linked worktree), whose
  // parent holds a `config` naming another folder. The old rule read `/home/a/config` and took `/evil` for the main checkout.
  const sep = { '.git': 'gitdir: /home/a/worktrees/x.git\n', '/home/a/config': '[core]\n\tworktree = /evil\n' }
  expect(await findTodoDirWith(walkFs({ '.git': 'file', '/evil/.claude_todo': 'dir' }, sep, '/home/a/code/x'))).toBeUndefined()
  // False state 2: a submodule at `worktrees/foo`, whose git dir is `<super>/.git/modules/worktrees/foo` (no commondir).
  const sub = { '.git': 'gitdir: /super/.git/modules/worktrees/foo\n', '/super/.git/modules/config': '[core]\n\tworktree = /evil\n' }
  expect(await findTodoDirWith(walkFs({ '.git': 'file', '/evil/.claude_todo': 'dir' }, sub, '/super/worktrees/foo'))).toBeUndefined()
  // False state 3, at the edge of the forms: a relative gitdir (git 2.48 worktree.useRelativePaths) in a .git one folder up.
  // It reads against that folder: the old rule read it against the session folder and named `../main`, a folder inside the worktree.
  const rel = { '../.git': 'gitdir: ../main/.git/worktrees/wt\n', '../../main/.git/worktrees/wt/commondir': '../..\n' }
  expect(await findTodoDirWith(walkFs({ '../.git': 'file', '../../main/.claude_todo': 'dir', '../main/.claude_todo': 'dir' }, rel, '/w/wt/sub'))).toBe('../../main/.claude_todo')
  // A commondir with an absolute path, and a separate common dir that names its main checkout by core.worktree.
  expect(await findTodoDirWith(walkFs({ '.git': 'file', '/m/.claude_todo': 'dir' }, { '.git': 'gitdir: /x/wt\n', '/x/wt/commondir': '/m/.git\n' }, '/wt'))).toBe('/m/.claude_todo')
  expect(await findTodoDirWith(walkFs({ '.git': 'file', '/main/.claude_todo': 'dir' }, { '.git': 'gitdir: /worktrees/r.git/worktrees/wt\r\n', '/worktrees/r.git/worktrees/wt/commondir': '../..\r\n', '/worktrees/r.git/config': '[core]\n\tworktree = /main\n' }, '/wt'))).toBe('/main/.claude_todo')
})

/** Property: a todo folder that resolves outside the checkouts the mod reads is refused, whatever else stands beside it. */
test('isInsideRoots accepts a folder inside a checkout and refuses the one that resolves outside', () => {
  const roots = ['/repo', '/main']
  // The folders in the checkouts, a linked worktree's main checkout included.
  expect(isInsideRoots('/repo/.claude_todo', roots)).toBe(true)
  expect(isInsideRoots('/main/mods/x/.claude_todo', roots)).toBe(true)
  // Behind a valid first case: a link out of the repo.
  expect(isInsideRoots('/outside/notes/.claude_todo', roots)).toBe(false)
  // At the limit: a sibling that shares the root's text as a prefix, and the root itself.
  expect(isInsideRoots('/repo2/.claude_todo', roots)).toBe(false)
  expect(isInsideRoots('/repo', roots)).toBe(false)
  // The excluded population: a path in another letter case on a POSIX disk is another folder; a Windows path compares without case.
  expect(isInsideRoots('/REPO/.claude_todo', roots)).toBe(false)
  expect(isInsideRoots('C:/Proj/.claude_todo', ['c:/proj'])).toBe(true)
  expect(isInsideRoots('C:/Other/.claude_todo', ['c:/proj'])).toBe(false)
})

/** Property: the global folders are replaced in one step, so a check between two loads never sees an empty set. */
test('replaceGlobals swaps the global folders and parents in one step and keeps nothing of the last load', () => {
  replaceGlobals(['/cfg/.claude_todo'], ['/cfg'])
  expect(isGlobalTodo('/cfg/.claude_todo')).toBe(true)
  expect([...globalParents]).toEqual(['/cfg'])
  const next = ['/other/.claude_todo']
  replaceGlobals(next, ['/other'])
  expect(isGlobalTodo('/cfg/.claude_todo')).toBe(false)
  expect(isGlobalTodo('/other/.claude_todo')).toBe(true)
  expect([...globalParents]).toEqual(['/other'])
  // A set built from the live one is read before it is cleared.
  replaceGlobals(globalDirs, globalParents)
  expect(isGlobalTodo('/other/.claude_todo')).toBe(true)
  replaceGlobals([], [])
})

test('todoFoldersIn finds a folder that is itself ignored, and none under an ignored directory (git lists that directory as one entry)', () => {
  expect(todoFoldersIn('x/.claude_todo/\0', '/repo')).toEqual([{ path: '/repo/x/.claude_todo', rel: 'x/.claude_todo' }])
  expect(todoFoldersIn('ign/\0', '/repo')).toEqual([])
})
