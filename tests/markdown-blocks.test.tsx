import { expect, test } from 'claude-code/testing'

import { CHECKBOX, exampleMask } from '../hooks/markdown-blocks'
import { COMMONMARK_HTML_QUOTES } from './fixtures/commonmark-html-quotes'
import { COMMONMARK_ITEMS } from './fixtures/commonmark-items'

/** The lines of `lines` the mod reads as checkbox items: not an example, and a checkbox line. */
const itemLines = (lines: readonly string[]): boolean[] => {
  const mask = exampleMask(lines)

  return lines.map((line, at) => !mask[at] && CHECKBOX.test(line))
}

// ---------------------------------------------------------------- UCR-203, UCR-204, UCR-205 (batch L2)

/**
 * Property (UCR-203): indented code starts where CommonMark starts it, after any block that is not a paragraph
 * (a heading, an HTML block, a closed fence, a thematic break) and on the first line, so a checkbox line in it
 * is an example, never a ticket. The reviewer's c198 and p198first states.
 */
test('UCR-203 indented code right after a heading, an HTML block, a closed fence, or on line 1 is an example', () => {
  // The reviewer's states: after a heading, after an HTML block, after a closed fence, on line 1.
  expect(exampleMask(['## Form', '    - [ ] #T0001 example', '', '- [ ] #T0001 Fix the parser'])).toEqual([false, true, false, false])
  expect(exampleMask(['<!-- note -->', '    - [ ] example'])).toEqual([true, true])
  expect(exampleMask(['<!--', 'a', '-->', '    - [ ] example'])).toEqual([true, true, true, true])
  expect(exampleMask(['```', 'a', '```', '    - [ ] example'])).toEqual([true, true, true, true])
  expect(exampleMask(['    - [ ] #T0001 example of the form', '', '- [ ] #T0001 Fix the parser'])).toEqual([true, false, false])
  // Behind a valid first case: a real ticket, then a heading and code; a setext heading and a thematic break end blocks too.
  expect(itemLines(['- [ ] #T0001 a', '## Examples of the format', '    - [ ] example line'])).toEqual([true, false, false])
  expect(itemLines(['Title', '=====', '    - [ ] example'])).toEqual([false, false, false])
  expect(itemLines(['---', '    - [ ] example'])).toEqual([false, false])
  // At the limit: the code as the file's last line, a tab as the 4 columns, and 3 spaces (no code: a ticket).
  expect(exampleMask(['## H', '\t- [ ] example'])).toEqual([false, true])
  expect(itemLines(['## H', '   - [ ] #T0002 real'])).toEqual([false, true])
  // In a list item: a heading in the item, then code 4 past its content column.
  expect(exampleMask(['- [ ] #T0001 a', '  ## Example', '      - [ ] example'])).toEqual([false, false, true])
  // The excluded population: right under a paragraph line it is no code (CommonMark: paragraph text; the mod reads an
  // over-indented checkbox there as an item, the deliberate exception), and a blank line then 4 spaces under an item is a child.
  expect(exampleMask(['para', '    - [ ] #T0005 lazy'])).toEqual([false, false])
  expect(exampleMask(['- [ ] #T0001 a', '    - [ ] #T0002 b'])).toEqual([false, false])
  expect(exampleMask(['- [ ] #T0001 a', '', '    - [ ] #T0002 b'])).toEqual([false, false, false])
})

/**
 * Property (UCR-204): a lazy line (a wrapped line at a lower indent under a ticket) goes on the ticket's paragraph and
 * ends no list item, so a child ticket after it and a blank line, 4 spaces in, stays a ticket. The reviewer's
 * hidden.ts states U2 and U2b, with its control.
 */
test('UCR-204 a lazy continuation line keeps the item open: a child ticket after a blank line stays a ticket', () => {
  // The reviewer's control (no lazy line) and U2: both are tickets.
  expect(itemLines(['- [ ] #T0001 parent', '  wrapped line', '', '    - [ ] #T0002 child'])).toEqual([true, false, false, true])
  expect(itemLines(['- [ ] #T0001 parent with a long', 'wrapped line', '', '    - [ ] #T0002 child'])).toEqual([true, false, false, true])
  // U2b: a label line under the item, then two children; behind a valid first item.
  expect(itemLines(['- [ ] #T0009 first', '- [ ] #T0001 parent', 'Notes:', '', '    - [ ] #T0002 child', '    - [ ] #T0003 child2'])).toEqual([true, true, false, false, true, true])
  // At the limit: a lazy line under a nested item, then a grandchild 2 past the nested item's content column, as the last line.
  expect(itemLines(['- [ ] a', '  - [ ] b', 'wrapped', '', '      - [ ] c'])).toEqual([true, true, false, false, true])
  // After a lazy line the item is still open: `    <!--` is 2 past its content column, a comment in the item (it ends with the item).
  expect(exampleMask(['- [ ] a', 'wrapped', '    <!--', '- [ ] b'])).toEqual([false, false, true, false])
  // The excluded population: a line at column 0 that starts a block (a heading, a fence, an item) is no lazy line:
  // it ends the item, and code 4 spaces in after it and a blank line is an example.
  expect(itemLines(['- [ ] a', '## H', '', '    - [ ] x'])).toEqual([true, false, false, false])
  expect(itemLines(['- [ ] a', '- [ ] b', '', '    - [ ] child of b'])).toEqual([true, true, false, true])
  expect(exampleMask(['- [ ] a', '```', '- [ ] in code', '```'])).toEqual([false, true, true, true])
})

/**
 * Property (UCR-205): an HTML comment opened in a list item ends when the item ends (CommonMark), as a fence does, so
 * an unclosed `<!--` in an item never hides the tickets after the item. The reviewer's hidden.ts states U1 and U1b.
 */
test('UCR-205 an unclosed comment in a list item ends with the item; the tickets after it stay tickets', () => {
  // U1, and U1b (tab-indented, a blank line in the comment).
  expect(itemLines(['- [ ] #T0001 parent', '  <!-- note', '- [ ] #T0002 next', '- [ ] #T0003 last'])).toEqual([true, false, true, true])
  expect(exampleMask(['- [ ] #T0001 parent', '\t<!-- draft', '', '- [ ] #T0002 next'])).toEqual([false, true, true, false])
  // Behind a valid first case: a closed comment in the first item, the unclosed one in a nested item.
  expect(itemLines(['- [ ] a', '  <!-- x -->', '  - [ ] b', '    <!--', '  - [ ] c'])).toEqual([true, false, true, false, true])
  // At the limit: the comment start as the last line of the item, the next item the last line of the file.
  expect(itemLines(['- [ ] a', '  <!--', '- [ ] z'])).toEqual([true, false, true])
  // A line at column 0 that is no item still ends the comment with the item (no lazy line in an HTML block).
  expect(exampleMask(['- [ ] a', '  <!--', 'text', '- [ ] y'])).toEqual([false, true, false, false])
  // The excluded population: a top-level comment still runs to its `-->` or the end of the file, and a comment
  // that closes inside its item hides only its lines.
  expect(itemLines(['<!--', '- [ ] x', '- [ ] y'])).toEqual([false, false, false])
  expect(itemLines(['- [ ] a', '  <!--', '  - [ ] x', '  -->', '- [ ] y'])).toEqual([true, false, false, false, true])
  expect(itemLines(['- [ ] a', '  <!--', '  - [ ] x'])).toEqual([true, false, false])
})

/**
 * Property (UCR-203 to UCR-205): the mod's checkbox items are CommonMark's, on the reviewer's random documents
 * (fixture: commonmark.py, a port of the spec's reference parser), but for the stated deliberate exception: an
 * over-indented checkbox line right under a paragraph line is an item (CommonMark: paragraph text), and the lines
 * under it read as under an item.
 */
test('UCR-203 the item lines match CommonMark on 400 random documents, but for the deliberate exception', () => {
  const misses: string[] = []
  let exceptions = 0
  for (const doc of COMMONMARK_ITEMS) {
    const mine = itemLines(doc.lines)
    let isAfterException = false
    doc.lines.forEach((line, at) => {
      if (mine[at] === doc.items[at]) {
        return
      }
      // The deliberate exception: the mod reads an item where CommonMark reads paragraph text; or a line under such an item.
      if (mine[at] === true && (doc.kinds[at] === 'paragraph' || isAfterException)) {
        exceptions += 1
        isAfterException = true

        return
      }
      misses.push(`${JSON.stringify(doc.lines)} line ${at}: mod ${String(mine[at])}, CommonMark ${String(doc.items[at])} (${doc.kinds[at]})`)
    })
  }
  expect(misses).toEqual([])
  // The fixture holds the exception (so the test is not vacuous), and many real items.
  expect(exceptions).toBeGreaterThan(0)
  expect(COMMONMARK_ITEMS.flatMap(doc => doc.items).filter(Boolean).length).toBeGreaterThan(200)
})

// ---------------------------------------------------------------- UCR-203 HTML blocks and block quotes (batch M)

/**
 * Property (UCR-203): a checkbox line inside an HTML block (any of the 7 CommonMark types) or a block quote (a
 * lazy line under its paragraph included) is an example, never an item, so it never takes a real ticket's ID.
 * The verifier's V203 states, then the three false states.
 */
test('UCR-203 V203 an example in an HTML block or a block quote is no item; the real ticket below stays one', () => {
  const real = ['', '## Work', '- [ ] #T0001 Fix the parser', '- [ ] #T0002 other']
  // V203: a <div> block, a block quote then a lazy example line, a <details> block with the example at column 0.
  expect(itemLines(['<div>', '</div>', '    - [ ] #T0001 Fix the parser', ...real])).toEqual([false, false, false, false, false, true, true])
  expect(itemLines(['> The format of a ticket:', '    - [ ] #T0001 Fix the parser', ...real])).toEqual([false, false, false, false, true, true])
  expect(itemLines(['<details>', '- [ ] #T0001 Fix the parser', '</details>', ...real])).toEqual([false, false, false, false, false, true, true])
  // Behind a valid first case: a real ticket, then an HTML block and a quote holding examples.
  expect(itemLines(['- [ ] #T0009 first', '', '<details>', '- [ ] #T0001 example', '</details>', '', '> - [ ] #T0001 quoted'])).toEqual([true, false, false, false, false, false, false])
  // At the limit: the block's start and the example as the file's last lines; a quote's lazy line as the last line.
  expect(itemLines(['- [ ] #T0009 first', '<div>', '- [ ] #T0001 example'])).toEqual([true, false, false])
  expect(itemLines(['- [ ] #T0009 first', '', '> note', '- [ ] #T0001 a new item', '> note', '      - [ ] #T0002 lazy'])).toEqual([true, false, false, true, false, false])
  // The excluded population: a blank line ends a type 6 or 7 block and a quote; a lone tag never ends a paragraph;
  // a tag in the middle of a line opens nothing; a closed type 1 to 5 block hides only its lines.
  expect(itemLines(['<div>', '- [ ] x', '', '- [ ] #T0001 real'])).toEqual([false, false, false, true])
  expect(itemLines(['> quote', '', '- [ ] #T0001 real'])).toEqual([false, false, true])
  expect(itemLines(['Some text', '<span>', '- [ ] #T0001 real'])).toEqual([false, false, true])
  expect(itemLines(['- [ ] #T0001 Read <div> here', '- [ ] #T0002 b'])).toEqual([true, true])
  expect(itemLines(['<pre>', '- [ ] x', '</pre>', '- [ ] #T0001 real'])).toEqual([false, false, false, true])
  // The stated exception stays: an over-indented checkbox item right under a paragraph line (not a quote's) is an item.
  expect(itemLines(['The format of a ticket:', '    - [ ] #T0001 Fix the parser'])).toEqual([false, true])
})

/** Property (UCR-203): every HTML block type and a block quote in a list item end with the item, as a fence does (UCR-205). */
test('UCR-203 an HTML block or a quote in a list item ends with the item; the tickets after it stay tickets', () => {
  // Behind a valid first case: a <details> block in the first item, then the next item.
  expect(itemLines(['- [ ] #T0001 a', '  <details>', '  - [ ] x', '- [ ] #T0002 b'])).toEqual([true, false, false, true])
  expect(itemLines(['- [ ] #T0001 a', '  > - [ ] x', '- [ ] #T0002 b'])).toEqual([true, false, true])
  // At the limit: a type 1 block that never closes, in the last item but one.
  expect(itemLines(['- [ ] #T0001 a', '  <script>', '- [ ] #T0002 b'])).toEqual([true, false, true])
  // The excluded population: a quote in a quote is in it; a quote line 4 in under a paragraph is paragraph text.
  expect(itemLines(['> > - [ ] x', '> - [ ] y', '- [ ] #T0002 b'])).toEqual([false, false, true])
  expect(exampleMask(['para', '    > x'])).toEqual([false, false])
})

/**
 * Property (UCR-203): on 500 random documents of list items, fences, comments, HTML blocks of all 7 types and block
 * quotes (fixture: commonmark.js 0.31.2, the spec's reference parser), the mod's items are CommonMark's exactly. The
 * fixture leaves out the documents where the deliberate exception applies (a checkbox line that CommonMark reads as
 * paragraph text); a list item inside a block quote counts as no item (the stated design).
 */
test('UCR-203 the item lines match commonmark.js on 500 random documents with HTML blocks and block quotes', () => {
  const misses: string[] = []
  for (const doc of COMMONMARK_HTML_QUOTES) {
    const mine = itemLines(doc.lines)
    doc.lines.forEach((_, at) => {
      if (mine[at] !== doc.items[at]) {
        misses.push(`${JSON.stringify(doc.lines)} line ${at}: mod ${String(mine[at])}, CommonMark ${String(doc.items[at])} (${doc.kinds[at]})`)
      }
    })
  }
  expect(misses).toEqual([])
  // Not vacuous: the fixture has every kind of block, and real items.
  const kinds = new Set(COMMONMARK_HTML_QUOTES.flatMap(doc => doc.kinds))
  expect(['html_block', 'block_quote', 'code_block', 'paragraph'].every(kind => kinds.has(kind))).toBe(true)
  expect(COMMONMARK_HTML_QUOTES.flatMap(doc => doc.items).filter(Boolean).length).toBeGreaterThan(100)
})

test('UCR-250 a line of NBSP, U+3000 or U+FEFF is content, not a blank line: the HTML block goes on, and the example ticket in it stays an example', () => {
  for (const space of [' ', '　', '﻿']) {
    // An HTML block of type 6 ends only at a blank line.
    const html = ['<div>', space, '- [ ] #T0001 an example in the block', '</div>', '', '- [ ] #T0002 a real ticket']
    expect(itemLines(html)).toEqual([false, false, false, false, false, true])
  }
  // A control: a line of spaces and tabs is blank and ends the HTML block.
  expect(itemLines(['<div>', ' \t ', '- [ ] #T0005 a real ticket'])).toEqual([false, false, true])
})
