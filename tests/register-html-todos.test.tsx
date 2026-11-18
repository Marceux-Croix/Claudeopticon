// Engine cases for .html todo files: scan, numbering, archive and the central TODO.html.

import { expect, mock, test } from 'claude-code/testing'

import { repoWith, open, sleep, promptOf, clearMtimes } from './fake-repo'

// ----------------------------------------------------------------
// Property: a `.html` todo file is scanned, numbered and archived the same as a `.md` file, and a central
// TODO.html is the Consolidate target when the central folder has no TODO.md.
test('a .html todo file is on the board: its unnumbered item is numbered and its closed item goes to archive/ under the same name', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const H = '/repo/.claude_todo/TODO.html'
  const files: Record<string, string> = { [H]: '- [x] #T0001 Done\n- [ ] #T0002 Open\n- [ ] beta', '/repo/.claude_todo/categories.json': '{}' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.html', '.claude_todo/categories.json'] })
  const prompt = promptOf(on)
  await open($)
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(3000)
  }
  await sleep(20)
  expect(files[H]).toMatch(/^- \[ \] #T0002 Open\n- \[ \] #T0003 beta$/)
  expect(files['/repo/.claude_todo/archive/TODO.html']).toContain('- [x] #T0001 Done')
  // The JSON file is never read as a todo file, so it is neither numbered nor archived.
  expect(files['/repo/.claude_todo/categories.json']).toBe('{}')
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0004')
})

test('Consolidate merges into a central TODO.html when the central folder has no TODO.md', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.html': '- [ ] #T1 Central', '/repo/.claude_todo/NOTES.md': '- [ ] #T2 Notes', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Elsewhere' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.html', '.claude_todo/NOTES.md', 'mods/x/.claude_todo/TODO.md'] })
  const ui = await open($)
  await clock.advance(3000)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files['/repo/.claude_todo/TODO.html']).toContain('#T3 Elsewhere')
  expect(files['/repo/.claude_todo/TODO.html']).toContain('#T2 Notes')
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('')
  expect(files['/repo/.claude_todo/TODO.md']).toBeUndefined()
})
