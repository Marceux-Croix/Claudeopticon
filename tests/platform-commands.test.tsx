import { expect, test } from 'claude-code/testing'

import { archiveName } from '../hooks/archive-blocks'
import { MAC_SIGNS, openCommand, platformFrom, trashReason } from '../hooks/platform-commands'

test('openCommand picks the opener per platform, with no shell, and archiveName picks the file', () => {
  expect(openCommand('/repo/.claude_todo/archive/TODO.md', 'Darwin')).toEqual(['open', '/repo/.claude_todo/archive/TODO.md'])
  expect(openCommand('/home/a/my repo/a.md', 'Linux')).toEqual(['xdg-open', '/home/a/my repo/a.md'])
  expect(openCommand('/home/a/a.md', '')).toEqual(['xdg-open', '/home/a/a.md'])
  expect(openCommand('C:/repo x/.claude_todo/archive/TODO.md', 'Linux')).toEqual(['explorer.exe', 'C:\\repo x\\.claude_todo\\archive\\TODO.md'])
  const file = (name: string, folder = '/r', isArchived?: true) => ({ name, folder, ...(isArchived ? { isArchived } : {}) })
  expect(archiveName([file('A.md'), file('todo.md')], '/r')).toBe('todo.md')
  expect(archiveName([file('A.md'), file('archive/TODO.md', '/r', true)], '/r')).toBe('TODO.md')
  expect(archiveName([file('NOTES.md')], '/r')).toBe('NOTES.md')
  expect(archiveName([file('A.md'), file('B.md')], '/r')).toBe('TODO.md')
  expect(archiveName([file('archive/OLD.md', '/r', true)], '/r')).toBe('OLD.md')
  expect(archiveName([file('A.md', '/other')], '/r')).toBe('TODO.md')
})

test('trashReason lists each command, and says nothing was tried when none was', () => {
  expect(trashReason([], false, 'Linux')).toBe('no trash command was tried')
  expect(trashReason(['gio: exited 1'], false, 'Linux')).toBe('gio: exited 1')
  expect(trashReason(['gio: not found'], false, 'Linux')).toBe('gio: not found; install gio or trash-cli')
  expect(trashReason(['powershell.exe: exited 3'], true, 'Linux')).toContain('powershell.exe: exited 3')
})

// ---------------------------------------------------------------- (G1)
// Property: with no uname answer, a Mac is told by a file every macOS has, not only by /usr/bin/trash.

test('platformFrom keeps the uname answer, else takes Darwin only from a macOS sign', () => {
  expect(platformFrom('Linux', true)).toBe('Linux')
  expect(platformFrom('Darwin', false)).toBe('Darwin')
  expect(platformFrom('', true)).toBe('Darwin')
  expect(platformFrom('', false)).toBe('')
  // Files every macOS ships. (H3: /usr/bin/trash is no longer a sign; trash-cli installs it on Linux.)
  expect(MAC_SIGNS).toEqual(['/usr/bin/sw_vers', '/usr/bin/osascript'])
})

// ---------------------------------------------------------------- (H3)
// Property: a file that trash-cli installs on Linux is no sign of macOS.

test('MAC_SIGNS holds only files macOS ships, never /usr/bin/trash (trash-cli puts it on Linux)', () => {
  expect(MAC_SIGNS).toEqual(['/usr/bin/sw_vers', '/usr/bin/osascript'])
  expect(MAC_SIGNS).not.toContain('/usr/bin/trash')
})
