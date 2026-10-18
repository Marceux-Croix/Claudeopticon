import { expect, test } from 'claude-code/testing'

import { applyRefRenames } from '../hooks/consolidate-text'
import { removeDuplicateTickets } from '../hooks/duplicate-tickets'

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

// ---------------------------------------------------------------- UCR-024

test('UCR-024 a fenced example is never the kept copy, and the live ticket is not removed', () => {
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

test('UCR-024 a ticket with a subtask after a blank line is never a duplicate', () => {
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

// ---------------------------------------------------------------- UCR-024, HTML comments (batch G2)

test('UCR-024 an example in an HTML comment is never the kept copy, and the live ticket is not removed', () => {
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

// ---------------------------------------------------------------- UCR-105 (batch H2)

/**
 * Property: a copy that numbering gave its own ID in front of the repeated one is still a duplicate of
 * the line that leads with that ID, so Delete duplicate tickets removes it and points its ID at the kept one.
 */
test('UCR-105 a numbered copy (#T0007 #T0005 Fix) is a duplicate of #T0005 Fix', () => {
  // The verifier's state, behind a valid first pair that folds the old way.
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
