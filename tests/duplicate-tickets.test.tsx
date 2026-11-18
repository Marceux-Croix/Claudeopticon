import { expect, test } from 'claude-code/testing'

import { applyRefRenames } from '../hooks/consolidate-text'
import { foldParts, removeDuplicateTickets, renameRefs } from '../hooks/duplicate-tickets'

test('a subtask or a ticket with lines under it is never a duplicate, and a leading ID is never renamed', () => {
  const tree = removeDuplicateTickets(['- [ ] #T1 Parser', '  - [ ] #T2 Write tests', '- [ ] #T3 Lexer', '  - [ ] #T4 Write tests', 'See #T4'].join('\n'))
  expect(tree.removed).toEqual([])
  const parent = removeDuplicateTickets(['- [ ] #T1 Fix X', '- [ ] #T2 Fix X', '  - [ ] #T3 Child'].join('\n'))
  expect(parent.removed).toEqual([])
  // A subtask that owns the ID keeps it: the ID is not remapped.
  const clash = removeDuplicateTickets(['- [ ] #T1 Fix X', '- [ ] #T5 Fix X', '- [ ] #T6 Other', '  - [ ] #T5 Sub'].join('\n'))
  expect(clash.removed).toEqual([{ id: 'T5', kept: 'T1' }])
  expect(clash.map).toEqual({})
  // In an archive file, a ticket's own ID stays and only its references follow.
  expect(applyRefRenames('- [x] #T5 Ship Y, after #T5', { t5: 'T1' })).toBe('- [x] #T5 Ship Y, after #T1')
  expect(applyRefRenames('see #T5', { t5: 'T1' })).toBe('see #T1')
})

// ---------------------------------------------------------------- 

test('a fenced example is never the kept copy, and the live ticket is not removed', () => {
  // Valid first case: a fenced example above the live ticket.
  const fenced = removeDuplicateTickets(['```', '- [ ] #T1 Fix the parser', '```', '- [ ] #T2 Fix the parser', 'see #T2'].join('\n'))
  expect(fenced.removed).toEqual([])
  expect(fenced.text).toBe(['```', '- [ ] #T1 Fix the parser', '```', '- [ ] #T2 Fix the parser', 'see #T2'].join('\n'))
  // At the limit of the range: the fence is the last block and is never closed.
  const open = removeDuplicateTickets(['- [ ] #T2 Fix the parser', '- [ ] #T3 Fix the parser', '```', '- [ ] #T4 Fix the parser', 'see #T3 in the example'].join('\n'))
  expect(open.removed).toEqual([{ id: 'T3', kept: 'T2' }])
  // Inside the excluded population: two identical tickets that are both inside a fence, and a reference in it.
  const inside = removeDuplicateTickets(['~~~md', '- [ ] #T1 Same', '- [ ] #T2 Same', 'see #T2', '~~~'].join('\n'))
  expect(inside.removed).toEqual([])
  expect(inside.map).toEqual({})
  // A real duplicate next to a fence: the references outside the fence follow, the ones inside stay.
  const refs = removeDuplicateTickets(['- [ ] #T1 Same', '- [ ] #T2 Same', 'see #T2', '```', 'see #T2', '```'].join('\n'))
  expect(refs.text).toBe(['- [ ] #T1 Same', 'see #T1', '```', 'see #T2', '```'].join('\n'))
})

test('a ticket with a subtask after a blank line is never a duplicate', () => {
  const blank = removeDuplicateTickets(['- [ ] #T1 Fix X', '', '  - [ ] #T9 Child', '- [ ] #T2 Fix X'].join('\n'))
  expect(blank.removed).toEqual([])
  // Several blank lines.
  const many = removeDuplicateTickets(['- [ ] #T1 Fix X', '- [ ] #T2 Fix X', '', '', '  - [ ] #T9 Child'].join('\n'))
  expect(many.removed).toEqual([])
  // A tab-indented line under it.
  const tab = removeDuplicateTickets(['- [ ] #T1 Fix X', '- [ ] #T2 Fix X', '', '\tnote'].join('\n'))
  expect(tab.removed).toEqual([])
  // A blank line then a top-level line is no child: the duplicate goes.
  expect(removeDuplicateTickets(['- [ ] #T1 Fix X', '- [ ] #T2 Fix X', '', '- [ ] #T3 Other'].join('\n')).removed).toEqual([{ id: 'T2', kept: 'T1' }])
})

// ---------------------------------------------------------------- , HTML comments

test('an example in an HTML comment is never the kept copy, and the live ticket is not removed', () => {
  // Valid first case: a commented example above the live ticket (the 5b probe).
  const above = removeDuplicateTickets(['<!--', '- [ ] #T0001 Fix the parser', '-->', '- [ ] #T0002 Fix the parser'].join('\n'))
  expect(above.removed).toEqual([])
  expect(above.map).toEqual({})
  expect(above.text).toBe(['<!--', '- [ ] #T0001 Fix the parser', '-->', '- [ ] #T0002 Fix the parser'].join('\n'))
  // At the limit of the range: a comment opened on the last lines and never closed.
  const open = removeDuplicateTickets(['- [ ] #T2 Fix the parser', '- [ ] #T3 Fix the parser', '<!--', '- [ ] #T4 Fix the parser'].join('\n'))
  expect(open.removed).toEqual([{ id: 'T3', kept: 'T2' }])
  // Inside the excluded population: two identical one-line comments, and a reference in a comment, stay as they are.
  const inside = removeDuplicateTickets(['- [ ] #T1 Same', '- [ ] #T2 Same', '<!-- - [ ] #T5 Same -->', '<!-- see #T2 -->', 'see #T2'].join('\n'))
  expect(inside.removed).toEqual([{ id: 'T2', kept: 'T1' }])
  expect(inside.text).toBe(['- [ ] #T1 Same', '<!-- - [ ] #T5 Same -->', '<!-- see #T2 -->', 'see #T1'].join('\n'))
})

// ---------------------------------------------------------------- 

/**
 * Property: a copy that numbering gave its own ID in front of the repeated one is still a duplicate of
 * the line that leads with that ID, so Delete duplicate tickets removes it and points its ID at the kept one.
 */
test('a numbered copy ( Fix) is a duplicate of Fix', () => {
  // The state, behind a valid first pair that folds the old way.
  const text = ['- [ ] #T1 Other', '- [ ] #T2 Other', '- [ ] #T0005 Fix the parser', '- [ ] #T0007 #T0005 Fix the parser', '- [ ] see #T0007'].join('\n')
  const out = removeDuplicateTickets(text)
  expect(out.removed).toEqual([{ id: 'T2', kept: 'T1' }, { id: 'T0007', kept: 'T0005' }])
  expect(out.map).toEqual({ t2: 'T1', t0007: 'T0005' })
  expect(out.text).toBe(['- [ ] #T1 Other', '- [ ] #T0005 Fix the parser', '- [ ] see #T0005'].join('\n'))
  // At the limit: the numbered copy is the last line, with a trailing CR.
  expect(removeDuplicateTickets('- [ ] #T0005 Fix\r\n- [ ] #T0007 #T0005 Fix\r').removed).toEqual([{ id: 'T0007', kept: 'T0005' }])
  // The excluded population: the second ID is not the kept line's own, the box differs, or the copy comes first.
  expect(removeDuplicateTickets('- [ ] #T0005 Fix\n- [ ] #T0007 #T0006 Fix').removed).toEqual([])
  expect(removeDuplicateTickets('- [ ] #T0005 Fix\n- [x] #T0007 #T0005 Fix').removed).toEqual([])
  expect(removeDuplicateTickets('- [ ] #T0007 #T0005 Fix\n- [ ] #T0005 Fix').removed).toEqual([])
})

test('equal ticket text under two `## From` sections is two tickets, never folded', () => {
  const two = removeDuplicateTickets('## From a\n\n- [ ] #T1 Fix the parser\n\n## From b\n\n- [ ] #T2 Fix the parser\n')
  expect(two.removed).toEqual([])
  expect(two.map).toEqual({})
  // At the limit: the repeat is within one section, after another section's equal ticket.
  const within = removeDuplicateTickets('## From a\n\n- [ ] #T1 Fix the parser\n\n## From b\n\n- [ ] #T2 Fix the parser\n- [ ] #T3 Fix the parser\n')
  expect(within.removed).toEqual([{ id: 'T3', kept: 'T2' }])
  // The excluded population: no sections at all still folds.
  expect(removeDuplicateTickets('- [ ] #T1 Fix\n- [ ] #T2 Fix\n').removed).toEqual([{ id: 'T2', kept: 'T1' }])
})

// ----------------------------------------------------------------
// Property: Delete duplicate tickets folds identical HTML items (tag, text and tail letter for letter, past the ID) in
// a .html file, and only top-level ones without subtasks; a .md file never folds an HTML line.

test('removeDuplicateTickets folds an indented HTML twin and points references at the kept one', () => {
  const text = ['<ul>', '  <li><input type="checkbox"> #T0001 Fix</li>', '  <li><input type="checkbox"> #T0002 Fix</li>', '  <li><input type="checkbox" checked> #T0003 Fix</li>', '  <li><input type="checkbox"> #T0004 see #T0002</li>', '</ul>'].join('\n')
  const out = removeDuplicateTickets(text, 'html')
  expect(out.removed).toEqual([{ id: 'T0002', kept: 'T0001' }])
  expect(out.text).toBe(['<ul>', '  <li><input type="checkbox"> #T0001 Fix</li>', '  <li><input type="checkbox" checked> #T0003 Fix</li>', '  <li><input type="checkbox"> #T0004 see #T0001</li>', '</ul>'].join('\n'))
  expect(removeDuplicateTickets(text, 'md').removed).toEqual([])
})

test('an HTML ticket with a subtask, or a subtask, is never folded; a numbered copy is', () => {
  const parent = ['<li><input type="checkbox"> #T0001 Fix</li>', '  <li><input type="checkbox"> #T0005 sub</li>', '<li><input type="checkbox"> #T0002 Fix</li>', '  <li><input type="checkbox"> #T0006 sub</li>'].join('\n')
  expect(removeDuplicateTickets(parent, 'html').removed).toEqual([])
  const numbered = ['<li><input type="checkbox"> #T0005 Fix the parser</li>', '<li><input type="checkbox"> #T0007 #T0005 Fix the parser</li>'].join('\n')
  expect(removeDuplicateTickets(numbered, 'html').removed).toEqual([{ id: 'T0007', kept: 'T0005' }])
  expect(foldParts('<li><input type="checkbox"> #T0005 Fix</li>  ', 'html')).toEqual({ key: '<li><input type="checkbox"> # Fix</li>', id: 'T0005' })
})

// ----------------------------------------------------------------
// Property: renameRefs in a .html file leaves an ID in a comment closed on its line, as a .md file does; a ticket
// keeps its own leading ID.

test('renameRefs leaves an ID in a comment of a .html line, and renames the one outside it', () => {
  const text = ['- [ ] #T0001 a', '<!-- e.g. - [ ] #T0001 example -->', ''].join('\n')
  for (const kind of ['md', 'html'] as const) {
    expect([kind, renameRefs(text, { t0001: 'T0009' }, kind)]).toEqual([kind, text])
  }
  // The Markdown line follows a blank line: right under the `<li>` line it would be in that line's HTML block.
  const html = ['<li><input type="checkbox"> #T0002 see #T0001 <!-- #T0001 --></li>', '', '- [ ] #T0003 after #T0001 <pre>#T0001</pre>'].join('\n')
  expect(renameRefs(html, { t0001: 'T0009' }, 'html')).toBe(['<li><input type="checkbox"> #T0002 see #T0009 <!-- #T0001 --></li>', '', '- [ ] #T0003 after #T0009 <pre>#T0001</pre>'].join('\n'))
  expect(applyRefRenames('<li><input type="checkbox"> #T0001 a #T0001</li>\r', { t0001: 'T0009' }, 'html', [])).toBe('<li><input type="checkbox"> #T0001 a #T0009</li>\r')
})

// ----------------------------------------------------------------
// Property: an HTML ticket whose block holds a child in a `<ul>` at its own indent is never folded as a duplicate.

test('removeDuplicateTickets keeps an HTML twin whose nested list holds a child', () => {
  const box = '<input type="checkbox">'
  const text = ['<ul>', `  <li>${box} #T0005 Fix</li>`, `  <li>${box} #T0006 Fix</li>`, '  <ul>', `    <li>${box} #T0007 child</li>`, '  </ul>', '</ul>'].join('\n')
  expect(removeDuplicateTickets(text, 'html').removed).toEqual([])
  // With no nested list, the twin goes.
  const flat = ['<ul>', `  <li>${box} #T0005 Fix</li>`, `  <li>${box} #T0006 Fix</li>`, '</ul>'].join('\n')
  expect(removeDuplicateTickets(flat, 'html').removed).toEqual([{ id: 'T0006', kept: 'T0005' }])
})
