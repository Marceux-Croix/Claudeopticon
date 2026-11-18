import { expect, test } from 'claude-code/testing'

import { lineMask } from '../hooks/item-lines'
import { blockEnd, topLevelItems } from '../hooks/item-tree'

// ----------------------------------------------------------------
// Property: a ticket's block is its line and the lines indented past it (or wrapped text), and an HTML item
// is a top-level ticket at any indent when no ticket block above holds it; a Markdown item keeps indent 0.

const box = (state: string) => `<input type="checkbox"${state}>`
const LIST = ['<h2>Core</h2>', '<ul>', `  <li>${box(' checked')} #T0001 done</li>`, '    <ul>', `      <li>${box(' checked')} #T0002 sub</li>`, '    </ul>', `  <li>${box('')} #T0003 open</li>`, `    <li>${box(' checked')} #T0004 open's sub</li>`, '</ul>']

test('blockEnd: an HTML item holds the lines indented past it, and stops at a sibling or a closing tag', () => {
  expect(blockEnd(LIST, 2, 'html')).toBe(6)
  expect(blockEnd(LIST, 6, 'html')).toBe(8)
  expect(blockEnd(LIST, 4, 'html')).toBe(5)
  // Deep indent is no indented code: a sibling at 6 spaces is not in the block of one at 6.
  expect(blockEnd(['      <li><input type="checkbox"> a</li>', '      <li><input type="checkbox"> b</li>'], 0, 'html')).toBe(1)
  // An HTML item ends at its own `</li>`: prose right under it is not its wrapped text.
  expect(blockEnd(['<li><input type="checkbox"> a</li>', 'more text', '', '<li><input type="checkbox"> b</li>'], 0, 'html')).toBe(1)
})

test('blockEnd keeps the Markdown rule at indent 0', () => {
  const md = ['- [x] A', '', '  later indent', '', '- [x] B']
  expect(blockEnd(md, 0, 'md')).toBe(3)
  expect(blockEnd(md, 0, 'html')).toBe(3)
  expect(blockEnd(['- [ ] p', 'wrapped', '- [ ] q'], 0, 'md')).toBe(2)
})

test('topLevelItems: HTML items at any indent are tickets unless a ticket above holds them', () => {
  const top = topLevelItems(LIST, lineMask(LIST, 'html'), 'html')
  expect(LIST.map((_, at) => top[at])).toEqual([false, false, true, false, false, false, true, false, false])
  // An HTML item indented under a Markdown ticket is its subtask.
  const mixed = ['- [ ] #T1 parent', `  <li>${box(' checked')} child</li>`, `<li>${box('')} next</li>`]
  expect(topLevelItems(mixed, lineMask(mixed, 'html'), 'html')).toEqual([true, false, true])
  // A .md file has no HTML item, and a Markdown item is top-level only at indent 0.
  expect(topLevelItems(LIST, lineMask(LIST, 'md'), 'md').some(one => one)).toBe(false)
  expect(topLevelItems(['- [ ] a', '  - [ ] b'], [false, false], 'md')).toEqual([true, false])
  // An example is no ticket.
  const hidden = ['<!--', `<li>${box('')} a</li>`, '-->']
  expect(topLevelItems(hidden, lineMask(hidden, 'html'), 'html')).toEqual([false, false, false])
})
