import { expect, test } from 'claude-code/testing'

import { envDirs, foldPath, isCaseOnly, isSameFolder, listedName, psPath } from '../hooks/path-forms'

// ---------------------------------------------------------------- 
// Property: psPath gives UTF-16 code units, the values [char] takes: none above 0xFFFF.

const unitsOf = (script: string) => /\(([\d,]+)\)/.exec(script)![1]!.split(',').map(Number)
const PS_STATES = ['C:/repo/\u{1D4E7}name/.claude_todo/a.md', 'C:/repo/.claude_todo/a\u{1F600}', 'C:/repo/\u{1D4E7}\u{1D4E8}/mid\u{1F600}dle/.claude_todo/\u2019x.md']
for (const path of PS_STATES) {
  test(`psPath gives UTF-16 units for ${JSON.stringify(path)}`, () => {
    const units = unitsOf(psPath(path))
    expect(units.every(unit => unit <= 0xffff)).toBe(true)
    expect(String.fromCharCode(...units)).toBe(path.replace(/\//g, '\\'))
  })
}

// ---------------------------------------------------------------- (G1)
// Property: a folder named by an environment variable is read in every form the machine writes it,
// Windows included, so the global folder it names is known.

test('envDirs reads POSIX, Windows and MSYS folders, with no trailing slash', () => {
  expect(envDirs('/home/a/')).toEqual(['/home/a'])
  expect(envDirs('/var/home/u//')).toEqual(['/var/home/u'])
  // Windows: backslashes, a trailing one, and a lower-case drive.
  expect(envDirs('d:\\cfg\\')).toEqual(['D:/cfg'])
  expect(envDirs('C:\\Users\\0Me')).toEqual(['C:/Users/0Me'])
  // The limit: a drive root keeps its slash.
  expect(envDirs('D:\\')).toEqual(['D:/'])
  // Git for Windows tools print /c/Users/0me: the Windows form is added.
  expect(envDirs('/c/Users/0me')).toEqual(['/c/Users/0me', 'C:/Users/0me'])
  // Not absolute, or nothing: no folder.
  expect(envDirs('home/a')).toEqual([])
  expect(envDirs('')).toEqual([])
  expect(envDirs(undefined)).toEqual([])
})

// ---------------------------------------------------------------- (J1)
// Property: a path or name that differs from the disk's only by letter case is told apart from one
// that differs in anything else, so the disk's spelling can be taken for it and nothing else can.

test('isCaseOnly: true only when two paths differ by letter case alone', () => {
  // The defect states: one segment, two segments, and the last letter of the path.
  expect(isCaseOnly('/repo/Docs/.claude_todo', '/repo/docs/.claude_todo')).toBe(true)
  expect(isCaseOnly('/repo/Mods/Alpha/.claude_todo', '/repo/mods/alpha/.claude_todo')).toBe(true)
  expect(isCaseOnly('/repo/mods/X', '/repo/mods/x')).toBe(true)
  expect(isCaseOnly('C:/Repo/Docs/.claude_todo', 'c:\\repo\\docs\\.claude_todo')).toBe(true)
  // The excluded population: the same path in another form, and a path elsewhere.
  expect(isCaseOnly('/repo/docs/.claude_todo', '/repo/docs/.claude_todo')).toBe(false)
  expect(isCaseOnly('C:/repo/docs/.claude_todo', 'C:\\repo\\docs\\.claude_todo')).toBe(false)
  expect(isCaseOnly('/repo/caf\u00e9', '/repo/cafe\u0301')).toBe(false)
  expect(isCaseOnly('/repo/Docs/.claude_todo', '/elsewhere/docs/.claude_todo')).toBe(false)
})

test('listedName: the one listed entry that matches without case, else the name', () => {
  // The defect states: lower case, mixed case at the extension, and the match last in the list.
  expect(listedName(['todo.md'], 'TODO.md')).toBe('todo.md')
  expect(listedName(['notes.md', 'Todo.MD'], 'TODO.md')).toBe('Todo.MD')
  expect(listedName(['a.md', 'b.md', 'todo.md'], 'TODO.md')).toBe('todo.md')
  // The excluded population: an exact entry wins, two matches (a disk that keeps case apart) give the name, no match gives the name.
  expect(listedName(['todo.md', 'TODO.md'], 'TODO.md')).toBe('TODO.md')
  expect(listedName(['todo.md', 'Todo.md'], 'TODO.md')).toBe('TODO.md')
  expect(listedName(['other.md'], 'TODO.md')).toBe('TODO.md')
  expect(listedName([], 'TODO.md')).toBe('TODO.md')
})

// ---------------------------------------------------------------- (batch K1)

/** Property: git's output counts only when the session folder it names is the session's own folder, the real path of `.`. */
test('isSameFolder: git names the session folder, else the output names another folder', () => {
  // A valid first case: the same folder; a trailing slash and NFD on one side; a Windows drive and slashes in either form.
  expect(isSameFolder('/w/proj', '/w/proj')).toBe(true)
  expect(isSameFolder('/w/caf\u00e9', '/w/cafe\u0301/')).toBe(true)
  expect(isSameFolder('C:/Work/Proj', 'c:\\work\\proj')).toBe(true)
  // The verifier's shapes: GIT_DIR and GIT_WORK_TREE (vcsh) name /w/plain, core.worktree names /w/other; the session is in /w/proj.
  expect(isSameFolder('/w/plain', '/w/proj')).toBe(false)
  expect(isSameFolder('/w/other', '/w/proj')).toBe(false)
  // At the limit: a parent or a child of the session folder is another folder; a POSIX path in another case is another folder.
  expect(isSameFolder('/w', '/w/proj')).toBe(false)
  expect(isSameFolder('/w/proj/sub', '/w/proj')).toBe(false)
  expect(isSameFolder('/w/Proj', '/w/proj')).toBe(false)
  // The excluded population: a side that is not known is never the same folder.
  expect(isSameFolder(undefined, '/w/proj')).toBe(false)
  expect(isSameFolder('/w/proj', undefined)).toBe(false)
})

/** Property: foldPath folds `.` and `..` in absolute and relative paths, keeping the `..` that lead out of a relative start. */
test('foldPath folds a git dir path, absolute or relative', () => {
  expect(foldPath('/main/.git/worktrees/wt/../..')).toBe('/main/.git')
  expect(foldPath('../main/.git/worktrees/wt/../..')).toBe('../main/.git')
  expect(foldPath('../../x/./y/')).toBe('../../x/y')
  expect(foldPath('a/..')).toBe('.')
  expect(foldPath('/a/../..')).toBe('/')
  expect(foldPath('c:\\r\\.git\\worktrees\\w\\..\\..')).toBe('C:/r/.git')
})
