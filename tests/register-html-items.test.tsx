// Engine cases for HTML checkbox items in .html todo files.

import { expect, mock, test } from 'claude-code/testing'

import { repoWith, open, sleep, toastsOf, promptOf, clearMtimes } from './fake-repo'

// ----------------------------------------------------------------
// Property: through the engine, a `.html` todo file's HTML checkbox items are on the board, numbered at the start of
// their text, archived to archive/<same name>.html as the same lines under the same <hN> heading, and written by the
// Done button, move_ticket and Delete duplicate tickets only in their input tag; a `.md` file never reads them.

const HTML_FILE = [
  '<h2>Core</h2>',
  '<ul>',
  '  <li><input type="checkbox" checked> #T0001 Done &amp; dusted</li>',
  '  <li><input type="checkbox"> #T0002 Open</li>',
  '  <li><INPUT TYPE="checkbox" data-state="queued"> beta</li>',
  '</ul>',
].join('\n')

test('a .html file: the scan reads its HTML items, numbering gives the unnumbered one an ID, and the done one goes to archive/TODO.html', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const H = '/repo/.claude_todo/TODO.html'
  const files: Record<string, string> = { [H]: HTML_FILE }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.html'] })
  const prompt = promptOf(on)
  await open($)
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(3000)
  }
  await sleep(20)
  expect(files[H]).toBe(['<h2>Core</h2>', '<ul>', '  <li><input type="checkbox"> #T0002 Open</li>', '  <li><INPUT TYPE="checkbox" data-state="queued"> #T0003 beta</li>', '</ul>'].join('\n'))
  expect(files['/repo/.claude_todo/archive/TODO.html']).toBe('<h2>Core</h2>\n\n  <li><input type="checkbox" checked> #T0001 Done &amp; dusted</li>\n')
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0004')
})

test('a .md file with the same HTML lines has no item: nothing is numbered or archived', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const T = '/repo/.claude_todo/TODO.md'
  // The last line is paragraph text to CommonMark, not an HTML block: only the file kind keeps it from being an item.
  const text = `${HTML_FILE}\n\n- [ ] #T0009 markdown\n\nNotes:\n    <li><input type="checkbox" checked> in a paragraph</li>`
  const files: Record<string, string> = { [T]: text }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(3000)
  }
  await sleep(20)
  expect(files[T]).toBe(text)
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBeUndefined()
})

test('the Done button and move_ticket write only the input tag of an HTML item, to the canonical form', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const H = '/repo/.claude_todo/TODO.html'
  const start = ['<ul>', '  <li><input type="checkbox"> #T0002 Open &lt;x&gt;</li>  ', "  <li><input type='checkbox' id='a'/> #T0004 Next</li>", '</ul>'].join('\n')
  const files: Record<string, string> = { [H]: start }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.html'] })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question

    return { result: { questions: [], answers: { [question]: 'Move it' } } } as never
  })
  const ui = await open($)
  await ui.press({ key: 'ticket-done-TODO.html-#t0002' })
  expect(files[H]).toBe(['<ul>', '  <li><input type="checkbox" checked> #T0002 Open &lt;x&gt;</li>  ', "  <li><input type='checkbox' id='a'/> #T0004 Next</li>", '</ul>'].join('\n'))
  const answer = String(((await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T0004', to: 'queued', reason: 'order the work' } as never)) as { result?: unknown }).result)
  expect(answer).toContain('Moved')
  // The tag's own id stays, and so does its `/>` close (): only the box attributes change.
  expect(files[H]).toBe(['<ul>', '  <li><input type="checkbox" checked> #T0002 Open &lt;x&gt;</li>  ', '  <li><input type="checkbox" data-state="queued" id="a"/> #T0004 Next</li>', '</ul>'].join('\n'))
})

test('Delete duplicate tickets folds an HTML twin in a central TODO.html', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const H = '/repo/.claude_todo/TODO.html'
  const files: Record<string, string> = { [H]: ['<ul>', '  <li><input type="checkbox"> #T0001 Fix</li>', '  <li><input type="checkbox"> #T0002 Fix</li>', '</ul>'].join('\n') }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.html'] })
  const ui = await open($)
  await clock.advance(3000)
  await ui.press({ key: 'todo-delete-dup-tickets' })
  await sleep(20)
  expect(files[H]).toBe(['<ul>', '  <li><input type="checkbox"> #T0001 Fix</li>', '</ul>'].join('\n'))
})

test('Consolidate copies HTML items into a central TODO.html, and leaves a .html source a central TODO.md would not read', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const item = '<li><input type="checkbox"> #T0003 Elsewhere</li>'
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.html': '<li><input type="checkbox"> #T0001 Central</li>', '/repo/mods/x/.claude_todo/TODO.html': item }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.html', 'mods/x/.claude_todo/TODO.html'] })
  const ui = await open($)
  await clock.advance(3000)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files['/repo/.claude_todo/TODO.html']).toBe(`<li><input type="checkbox"> #T0001 Central</li>\n\n## From mods/x/TODO.html\n\n${item}\n`)
  expect(files['/repo/mods/x/.claude_todo/TODO.html']).toBe('')
})

test('Consolidate leaves a .html source whose HTML items a central TODO.md would not read, and names it', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const item = '<li><input type="checkbox"> #T0003 Elsewhere</li>'
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 Central', '/repo/mods/x/.claude_todo/TODO.html': item }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.html'] })
  const toasts = toastsOf(on)
  const ui = await open($)
  await clock.advance(3000)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T0001 Central')
  expect(files['/repo/mods/x/.claude_todo/TODO.html']).toBe(item)
  expect(toasts.join('\n')).toContain('a .md file does not read HTML checkbox items')
})
