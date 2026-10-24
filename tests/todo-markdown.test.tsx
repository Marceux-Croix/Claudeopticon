import { expect, test } from 'claude-code/testing'

import { addToArchive, closedBlocks, removeBlocks } from '../hooks/archive-blocks'
import { itemKey } from '../hooks/item-keys'
import { setBox } from '../hooks/ticket-boxes'
import { CHECKBOX, codeSpansOut, count, exampleMask, expandTabs, lineOwnIds, parseTodo, plainText } from '../hooks/todo-markdown'

const PLAN = ['# Plan', '- [x] Write code', '- [~] #T2 Run the test suite', '- [ ] Ship the release build', 'prose', '  - [X] nested'].join('\n')

test('parseTodo reads states and item IDs', async () => {
  const items = parseTodo(PLAN)
  expect(items.map(item => item.status)).toEqual(['completed', 'in_progress', 'pending', 'completed'])
  expect(items[1]?.id).toBe('T2')
  expect(items[0]?.id).toBeUndefined()
})

test('parseTodo reads [>] as queued, and count counts it neither done nor active', () => {
  const items = parseTodo('- [>] #T1 next\n- [~] #T2 now')
  expect(items.map(item => item.status)).toEqual(['queued', 'in_progress'])
  expect(count(items)).toEqual({ done: 0, active: 1, total: 2 })
})

test('item text drops Markdown bold and strike markers, and keeps the rest', async () => {
  expect(plainText('**Docs pass:** step 6 done, ~~old~~ `code` stays')).toBe('Docs pass: step 6 done, old `code` stays')
  expect(parseTodo('- [~] **Smoke test:** passed')[0]?.text).toBe('Smoke test: passed')
})

test('CRLF: a trailing carriage return never hides a checkbox, and a checkbox-like line that fails the match counts open', () => {
  expect(closedBlocks('- [x] A\r\n  - [ ] open\r\n')).toEqual([])
  expect(closedBlocks('- [x] A\n  - [ ] open\r\n- [x] B\r\n').map(block => block.lines)).toEqual([['- [x] B']])
  expect(closedBlocks('- [x] A\r\n  note\r\n')[0]?.lines).toEqual(['- [x] A', '  note'])
  expect(closedBlocks('- [x] A\n  - [ ]')).toEqual([])
  expect(parseTodo('- [ ] a\r\n- [x] b\r').map(item => [item.text, item.status])).toEqual([['a', 'pending'], ['b', 'completed']])
  // The archive keeps its own line ending, else the source's.
  const [block] = closedBlocks('## Core\r\n- [x] #T1 Done parser\r\n  note under it\r\n')
  expect(addToArchive('## Core\r\n\r\n- [x] #T0 Older\r\n', [block!])).toBe('## Core\r\n\r\n- [x] #T0 Older\r\n- [x] #T1 Done parser\r\n  note under it\r\n')
  expect(addToArchive('', [block!], [], '\r\n')).toBe('## Core\r\n\r\n- [x] #T1 Done parser\r\n  note under it\r\n')
  expect(addToArchive('- [x] #T0 Older\n', [block!], [], '\r\n')).toBe('- [x] #T0 Older\n\n## Core\n\n- [x] #T1 Done parser\n  note under it\n')
})

test('parseTodo skips checkbox lines inside code fences', () => {
  expect(parseTodo('- [ ] a\n```\n- [ ] fenced\n```\n~~~\n- [x] tilde\n~~~\n- [x] b').map(item => item.text)).toEqual(['a', 'b'])
})

test('fences are CommonMark-like: a fence closes only on its own character, at least as long, with nothing else on the line', () => {
  // A tilde line inside a backtick fence does not close it, and nothing in it is parsed.
  expect(parseTodo('```\n~~~\n- [x] in code\n```\n- [ ] #T1 real').map(item => item.text)).toEqual(['#T1 real'])
  const text = '```\n~~~\n- [x] in code\n```\n- [x] #T2 done'
  const [block, ...more] = closedBlocks(text)
  expect(more).toEqual([])
  expect(block?.lines).toEqual(['- [x] #T2 done'])
  // The line in code stays where it is when the block is cut.
  expect(removeBlocks(text, [block!])).toBe('```\n~~~\n- [x] in code\n```')
  // A 4-backtick fence holds a 3-backtick line; a shorter run does not close it.
  const four = '````\n```\n- [x] in code\n```\n````\n- [ ] #T3 real\n- [x] #T4 done'
  expect(parseTodo(four).map(item => item.text)).toEqual(['#T3 real', '#T4 done'])
  expect(closedBlocks(four).map(one => one.lines)).toEqual([['- [x] #T4 done']])
  // A closing line with an info string is content; a longer closing run closes.
  expect(parseTodo('```\n```js\n- [ ] hidden\n````\n- [ ] #T5 real').map(item => item.text)).toEqual(['#T5 real'])
  // A backtick fence's info string may not hold a backtick: no fence opens.
  expect(parseTodo('```a`b\n- [ ] #T6 real').map(item => item.text)).toEqual(['#T6 real'])
  // Four spaces of indent is code by indent, not a fence.
  expect(parseTodo('    ```\n- [ ] #T7 real').map(item => item.text)).toEqual(['#T7 real'])
})

// ---------------------------------------------------------------- 

test('a reference line above its ticket has no ID of its own, and a move writes the ticket line', () => {
  const text = ['- [ ] see #T5 first', '- [ ] #T5 Real work'].join('\n')
  expect(parseTodo(text).map(item => item.id)).toEqual([undefined, 'T5'])
  expect(setBox(text, '#t5', 'in_progress')).toBe(['- [ ] see #T5 first', '- [~] #T5 Real work'].join('\n'))
  // The reference as the last line.
  const last = ['- [ ] #T5 Real work', '- [ ] see #T5 first'].join('\n')
  expect(setBox(last, '#t5', 'completed')).toBe(['- [x] #T5 Real work', '- [ ] see #T5 first'].join('\n'))
  // A fenced copy above the ticket.
  const fenced = ['```', '- [ ] #T5 Example', '```', '- [ ] #T5 Real work'].join('\n')
  expect(parseTodo(fenced).map(item => item.text)).toEqual(['#T5 Real work'])
  expect(setBox(fenced, '#t5', 'completed')).toBe(['```', '- [ ] #T5 Example', '```', '- [x] #T5 Real work'].join('\n'))
  // Only a fenced line has the key: nothing is written.
  expect(setBox(['```', '- [ ] #T6 Example', '```'].join('\n'), '#t6', 'completed')).toBeUndefined()
})

// ---------------------------------------------------------------- (HTML comments), 

test('a line inside an HTML comment is an example: never an item, never an ID', () => {
  // A comment that spans lines, before the live ticket (the defect behind a valid first case).
  const spans = ['<!--', '- [ ] #T0001 Fix the parser', '-->', '- [ ] #T0001 Fix the parser'].join('\n')
  expect(parseTodo(spans).map(item => item.text)).toEqual(['#T0001 Fix the parser'])
  expect(exampleMask(spans.split('\n'))).toEqual([true, true, true, false])
  // One comment line, and a comment as the last line of the file (the limit of the scanned range).
  expect(parseTodo('- [ ] #T2 Live\n<!-- - [ ] #T3 Example -->').map(item => item.id)).toEqual(['T2'])
  expect(parseTodo('- [ ] #T2 Live\n<!--\n- [ ] #T3 Example, never closed').map(item => item.id)).toEqual(['T2'])
  // A comment after a ticket's text leaves it a ticket. A comment opened at the end of a ticket line opens no block
  // (CommonMark; changed this from hiding T5): the next lines stay tickets.
  expect(parseTodo('- [ ] #T4 Fix <!-- note -->\n- [ ] #T5 Next').map(item => item.id)).toEqual(['T4', 'T5'])
  expect(parseTodo('- [ ] #T4 Fix <!-- note\n- [ ] #T5 Hidden\n-->\n- [ ] #T6 Next').map(item => item.id)).toEqual(['T4', 'T5', 'T6'])
  // A fence inside a comment opens nothing; a comment marker inside a fence opens nothing (the excluded population).
  expect(parseTodo('<!--\n```\n-->\n- [ ] #T7 After').map(item => item.id)).toEqual(['T7'])
  expect(parseTodo('```\n<!--\n```\n- [ ] #T8 After').map(item => item.id)).toEqual(['T8'])
  // A commented copy never takes the ID of the live line.
  expect(lineOwnIds(['<!-- - [ ] see #T9 -->', '- [ ] see #T9'])).toEqual([undefined, 'T9'])
})

test('two lines that lead with one ID: the second has no ID of its own, so the two never share a key', () => {
  const text = ['- [ ] #T0005 First', '- [ ] #T0005 Second'].join('\n')
  expect(parseTodo(text).map(item => item.id)).toEqual(['T0005', undefined])
  // The button of the second writes the second (its key is its text), the first's key writes the first.
  const [first, second] = parseTodo(text)
  expect(itemKey(first!)).not.toBe(itemKey(second!))
  expect(setBox(text, itemKey(second!), 'completed')).toBe(['- [ ] #T0005 First', '- [x] #T0005 Second'].join('\n'))
  expect(setBox(text, itemKey(first!), 'completed')).toBe(['- [x] #T0005 First', '- [ ] #T0005 Second'].join('\n'))
  // In any case, and as the last of three lines.
  expect(parseTodo(['- [ ] #T7 a', '- [ ] #T8 b', '- [ ] #t7 c'].join('\n')).map(item => item.id)).toEqual(['T7', 'T8', undefined])
})

test('a leading ID-like word on two lines gives one key only; #T1st and #t2a are no IDs', () => {
  const words = ['- [ ] #h264 Decoder', '- [ ] #h264 encoder crash'].join('\n')
  expect(parseTodo(words).map(item => item.id)).toEqual(['h264', undefined])
  // The button on the second line marks the second, not the first.
  expect(setBox(words, itemKey(parseTodo(words)[1]!), 'in_progress')).toBe(['- [ ] #h264 Decoder', '- [~] #h264 encoder crash'].join('\n'))
  expect(parseTodo('- [ ] #T1st place\n- [ ] #t2a word\n- [ ] see #T1st').map(item => item.id)).toEqual([undefined, undefined, undefined])
  // The ID forms that stay: short digits, short capitals, the 4-character form in any case.
  expect(parseTodo('- [ ] #T12 a\n- [ ] #T3C b\n- [ ] #t002a c\n- [ ] #T10000 d').map(item => item.id)).toEqual(['T12', 'T3C', 't002a', 'T10000'])
})

// ---------------------------------------------------------------- remainder

/**
 * Property: a `<!--` in the middle of a line never hides the lines after it. An HTML comment
 * block starts only at a line start (up to 3 spaces), as CommonMark says, and runs to the line with `-->`.
 */
test('a <!-- in the middle of a line never opens a comment: the rest of the file stays tickets', () => {
  // The state: the opener inside a ticket's text, behind a valid first ticket.
  const inline = ['- [ ] #T0001 Strip `<!--` markers from the export', '- [ ] #T0002 Next ticket', '- [ ] new ticket without id', '- [ ] #T0002 Next ticket'].join('\n')
  expect(exampleMask(inline.split('\n'))).toEqual([false, false, false, false])
  expect(parseTodo(inline).map(item => item.text)).toEqual(['#T0001 Strip `<!--` markers from the export', '#T0002 Next ticket', 'new ticket without id', '#T0002 Next ticket'])
  expect(setBox(inline, '#t0002', 'completed')).toBe(inline.replace('- [ ] #T0002 Next', '- [x] #T0002 Next'))
  // The limit of the scanned range: the opener in the last line, and in the first line of a CRLF file.
  expect(parseTodo('- [ ] #T1 a\n- [ ] #T2 b <!--').map(item => item.id)).toEqual(['T1', 'T2'])
  expect(parseTodo('- [ ] #T1 a <!-- x\r\n- [ ] #T2 b\r\n').map(item => item.id)).toEqual(['T1', 'T2'])
  // The population the rule keeps: a line that starts with `<!--` (up to 3 spaces) opens a block to its `-->`.
  expect(parseTodo('   <!-- note\n- [ ] #T1 hidden\n-->\n- [ ] #T2 b').map(item => item.id)).toEqual(['T2'])
  expect(parseTodo('<!-- one line --> - [ ] #T1 x\n- [ ] #T2 b').map(item => item.id)).toEqual(['T2'])
  expect(parseTodo('<!-->\n- [ ] #T1 a').map(item => item.id)).toEqual(['T1'])
  // Four spaces is indented code, not a comment start: the next line stays a ticket.
  expect(parseTodo('    <!-- x\n- [ ] #T1 a').map(item => item.id)).toEqual(['T1'])
})

/**
 * Property: every checkbox line of a file has its own key, three identical lines
 * included, so a button on the third line writes the third line, before numbering runs or while it skips the file.
 */
test('three identical lines have three keys, and setBox on the third writes the third', () => {
  for (const md of ['- [ ] #T5 X\n- [ ] #T5 X\n- [ ] #T5 X', '- [ ] #h264 two\n- [ ] #h264 two\n- [ ] #h264 two']) {
    const items = parseTodo(md)
    const keys = items.map(itemKey)
    expect(new Set(keys).size).toBe(3)
    expect(setBox(md, keys[2]!, 'completed')).toBe(`${md.slice(0, md.lastIndexOf('- [ ]'))}- [x]${md.slice(md.lastIndexOf('- [ ]') + 5)}`)
    expect(setBox(md, keys[1]!, 'completed')!.split('\n')[1]).toMatch(/^- \[x\]/)
  }
  // Behind a valid first pair (two lines, two keys), the third copy as the last line of a CRLF file: its own key.
  const crlf = '- [ ] #T6 A\r\n- [ ] B\r\n- [ ] B\r\n- [ ] B'
  const keys = parseTodo(crlf).map(itemKey)
  expect(new Set(keys).size).toBe(4)
  expect(setBox(crlf, keys[3]!, 'in_progress')!.split('\r\n')[3]).toBe('- [~] B')
  // The excluded population: a fenced copy is no item and takes no place, so the live line keeps the plain key.
  const fenced = parseTodo('```\n- [ ] B\n```\n- [ ] B')
  expect(fenced.map(itemKey)).toEqual(['b'])
})

// ---------------------------------------------------------------- remainder

/** Property: an HTML comment's indent is measured from the content column of the list item that holds it, as CommonMark does. */
test('a comment nested in a list item hides its lines; indent counts from the item content', () => {
  // The P106 state: `    <!--` under `- [ ] #T1 parent` is a comment, so the subtask in it is no ticket.
  const nested = ['- [ ] #T1 parent', '    <!--', '    - [ ] hidden subtask', '    -->', '- [ ] #T2 after']
  expect(exampleMask(nested)).toEqual([false, true, true, true, false])
  expect(parseTodo(nested.join('\n')).map(item => item.text)).toEqual(['#T1 parent', '#T2 after'])
  // At the limit: 3 spaces past a nested item's content column (column 4) is still a comment; 4 past it is indented code.
  // changed the last two flags from true: `  - [ ] c` leaves item b, which ends the comment in it
  // (CommonMark, commonmark.js gives `<li>[ ] c\n--&gt;</li>`), so c is a ticket and `-->` is its text.
  expect(exampleMask(['- [ ] a', '  - [ ] b', '       <!--', '  - [ ] c', '-->'])).toEqual([false, false, true, false, false])
  expect(exampleMask(['- [ ] a', '  - [ ] b', '        <!--', '  - [ ] c'])).toEqual([false, false, false, false])
  // An ordered item's content column is after its marker and the spaces.
  expect(exampleMask(['1. [ ] step', '   <!--', '   - [ ] hidden', '   -->'])).toEqual([false, true, true, true])
  // The excluded population: at the top level, 4 spaces is indented code, not a comment; a line that leaves the item
  // (indent below its content) measures from the outer level again; a mid-line `<!--` opens nothing.
  // a 4-space first line is indented code (CommonMark), so its flag is now true; `- [ ] x` stays a ticket.
  expect(exampleMask(['    <!--', '- [ ] x'])).toEqual([true, false])
  // `prose` is a lazy line of item a, not a line that leaves it, so `    <!--` is a comment in a
  // (the third flag was false); the comment ends with the item, so `- [ ] x` stays a ticket.
  expect(exampleMask(['- [ ] a', 'prose', '    <!--', '- [ ] x'])).toEqual([false, false, true, false])
  expect(exampleMask(['- [ ] a', 'prose', '<!--', '- [ ] x'])).toEqual([false, false, true, true])
  expect(exampleMask(['- [ ] #T1 Fix <!-- note', '- [ ] #T2 next'])).toEqual([false, false])
})

// ---------------------------------------------------------------- fences in list items, tabs, inline code

/** Property: a code fence inside a list item (indent measured from the item's content column) hides its lines. */
test('a fence inside a list item hides its example lines; indent counts from the item content', () => {
  // The PA state: a 4-space fence under `- [ ] Document the grammar`.
  const text = '- [ ] #T0001 Document the grammar\n    ```md\n    - [ ] example line\n    ```\n- [ ] #T0002 next'
  expect(parseTodo(text).map(item => item.text)).toEqual(['#T0001 Document the grammar', '#T0002 next'])
  // Behind a valid first case: a fence that opens under a later item, and a tilde fence under an ordered item (P1b).
  expect(exampleMask(['- [ ] a', '- [ ] b', '    ~~~', '    - [ ] x', '    ~~~', '- [ ] c'])).toEqual([false, false, true, true, true, false])
  expect(exampleMask(['1. [ ] #T0001 x', '     ~~~md', '     - [ ] example', '     ~~~'])).toEqual([false, true, true, true])
  // At the limit: 3 spaces past a nested item's content column (4) is a fence; 4 past it is indented code, no fence.
  expect(exampleMask(['- [ ] a', '  - [ ] b', '       ```', '       - [ ] x', '       ```'])).toEqual([false, false, true, true, true])
  expect(exampleMask(['- [ ] a', '  - [ ] b', '        ```', '  - [ ] x'])).toEqual([false, false, false, false])
  // A line that leaves the item ends the item, and the fence in it (CommonMark): the next ticket is a ticket.
  expect(exampleMask(['- [ ] a', '    ```', '    - [ ] x', '- [ ] after'])).toEqual([false, true, true, false])
  // The excluded population: at the top level a 4-space fence is indented code; a top-level fence still works.
  // the 4-space first line is indented code (CommonMark), so its flag is now true; x and y stay tickets.
  expect(exampleMask(['    ```', '- [ ] x', '- [ ] y'])).toEqual([true, false, false])
  expect(exampleMask(['```', '- [ ] x', '```', '- [ ] y'])).toEqual([true, true, true, false])
})

/** Property: a tab counts to the next multiple of 4 columns in the indent and column math. */
test('a tab-indented comment or fence under a list item hides its lines', () => {
  // The PB state.
  expect(parseTodo('- [ ] #T0001 parent\n\t<!--\n\t- [ ] commented out\n\t-->\n- [ ] #T0002 after').map(item => item.text)).toEqual(['#T0001 parent', '#T0002 after'])
  // Behind a valid first case: a tab-indented fence under the second item.
  expect(exampleMask(['- [ ] a', '- [ ] b', '\t```', '\t- [ ] x', '\t```'])).toEqual([false, false, true, true, true])
  // At the limit: two spaces then a tab reach column 4, as one tab does; a tab after the marker sets the content column.
  // the last flag was true; `-->` at column 0 leaves the item, which ends the comment in it (CommonMark).
  expect(exampleMask(['- [ ] a', '  \t<!--', '  \t- [ ] x', '-->'])).toEqual([false, true, true, false])
  expect(exampleMask(['-\t[ ] a', '    <!--', '    - [ ] x', '    -->'])).toEqual([false, true, true, true])
  // The excluded population: a top-level tab is 4 columns, indented code: no comment. the first
  // line is indented code (CommonMark), so its flag is now true; `- [ ] x` stays a ticket.
  expect(exampleMask(['\t<!--', '- [ ] x'])).toEqual([true, false])
  expect(expandTabs('a\tb')).toBe('a   b')
  expect(expandTabs('\t\tx')).toBe('        x')
})

/** Property: an ID inside inline code is never a line's own ID. */
test('an ID in inline code is no own ID; the leading ID rule and IDs outside code stay', () => {
  // The state: a documentation line.
  expect(parseTodo('- [ ] Explain the `#T002B` form in the README')[0]!.id).toBeUndefined()
  // Behind a valid first case: inline code first, then a real trailing ID.
  expect(parseTodo('- [ ] Explain `#T002B` for #T0007')[0]!.id).toBe('T0007')
  // At the limit: a double-backtick span with a backtick inside, at the end of the line; an unclosed run is text.
  expect(parseTodo('- [ ] see ``a ` #T0003``')[0]!.id).toBeUndefined()
  expect(parseTodo('- [ ] see ` #T0003')[0]!.id).toBe('T0003')
  // The excluded population: a leading ID stays the line's own, and a run of another length does not close a span.
  expect(parseTodo('- [ ] #T0004 Explain `#T002B`')[0]!.id).toBe('T0004')
  expect(codeSpansOut('a ``b` #T1')).toBe('a ``b` #T1')
  expect(codeSpansOut('x `#T1` y')).toBe(`x ${' '.repeat(5)} y`)
})

// ---------------------------------------------------------------- 

/** Property: a checkbox line in an indented code block (CommonMark) is an example, never a ticket. */
test('exampleMask treats an indented code block as an example, at the top level and in a list item', () => {
  // The states: 4 spaces after a blank line at the top level; 4 past an item's content column after a blank line.
  expect(parseTodo('text\n\n    - [ ] ex\n- [ ] #T0002 real').map(item => item.id)).toEqual(['T0002'])
  expect(parseTodo('- [ ] #T0001 a\n\n      - [ ] ex\n').map(item => item.id)).toEqual(['T0001'])
  // Behind a valid first case: the block goes on through blank lines and ends at a line indented less.
  expect(exampleMask(['- [ ] #T0001 a', '', '      - [ ] x', '', '      - [ ] y', '- [ ] #T0002 b'])).toEqual([false, false, true, false, true, false])
  // At the limit: a tab (4 columns), 3 spaces at the top level (no code), and the first line of a file. (batch
  // L2) changed the first flag from false: CommonMark starts indented code on the first line, with no blank line before it.
  expect(exampleMask(['    - [ ] first', '- [ ] #T0003 x'])).toEqual([true, false])
  expect(exampleMask(['note', '', '\t- [ ] code'])).toEqual([false, false, true])
  expect(parseTodo('note\n\n   - [ ] #T0004 item').map(item => item.id)).toEqual(['T0004'])
  // The excluded population: a nested item after a blank line (2 past the parent's column), and a line straight under a paragraph line.
  expect(parseTodo('- [ ] #T0001 a\n\n    - [ ] #T0002 b').map(item => item.id)).toEqual(['T0001', 'T0002'])
  expect(parseTodo('- [ ] #T0001 a\n  - [ ] #T0002 b\n\n      - [ ] #T0003 c').map(item => item.id)).toEqual(['T0001', 'T0002', 'T0003'])
  expect(parseTodo('para\n    - [ ] #T0005 lazy').map(item => item.id)).toEqual(['T0005'])
})

// ---------------------------------------------------------------- 

/**
 * Property: an example in indented code that repeats a real ticket's ID above the ticket never owns the ID,
 * so numbering never gives the real ticket a new one. The p198first states.
 */
test('an indented-code example above a real ticket with its ID owns no ID; the real ticket keeps it', () => {
  // The states: the example on line 1, and right under a heading (the old reading gave the example the ID).
  expect(lineOwnIds(['    - [ ] #T0001 example of the form', '', '- [ ] #T0001 Fix the parser'])).toEqual([undefined, undefined, 'T0001'])
  expect(lineOwnIds(['## Form', '    - [ ] #T0001 example', '', '- [ ] #T0001 Fix the parser'])).toEqual([undefined, undefined, undefined, 'T0001'])
  // Behind a valid first ticket, and with the real ticket as the last line under a second heading.
  const text = ['- [ ] #T0002 first', '## Format of a ticket', '    - [ ] #T0001 Fix the parser', '', '## Work', '- [ ] #T0001 Fix the parser']
  expect(parseTodo(text.join('\n')).map(item => [item.id, item.nth])).toEqual([['T0002', undefined], ['T0001', undefined]])
  // The excluded population: the blank-line case of holds, and a ticket right under a heading stays a ticket.
  expect(lineOwnIds(['## Form', '', '    - [ ] #T0001 example', '', '- [ ] #T0001 Fix the parser'])).toEqual([undefined, undefined, undefined, undefined, 'T0001'])
  expect(lineOwnIds(['## Work', '- [ ] #T0001 Fix the parser'])).toEqual([undefined, 'T0001'])
})

/** The code-span reading before , as a reference: the new one must read every text the same. */
function oldCodeSpansOut(text: string): string {
  let out = ''
  let at = 0
  while (at < text.length) {
    const open = /`+/g
    open.lastIndex = at
    const run = open.exec(text)
    if (run === null) {
      break
    }
    const close = new RegExp(`(?<!\`)${run[0]}(?!\`)`, 'g')
    close.lastIndex = run.index + run[0].length
    const end = close.exec(text)
    if (end === null) {
      out += text.slice(at, run.index + run[0].length)
      at = run.index + run[0].length
      continue
    }
    out += text.slice(at, run.index) + ' '.repeat(end.index + end[0].length - run.index)
    at = end.index + end[0].length
  }

  return out + text.slice(at)
}

/** A backtick. */
const TICK = String.fromCharCode(96)

/** The adversarial line (spans.ts): runs of lengths 1 to k, each after a letter, none closed. */
const unclosedRuns = (k: number): string => {
  const parts = ['- [ ] x ']
  for (let i = 1; i <= k; i += 1) {
    parts.push(`${TICK.repeat(i)}a`)
  }

  return parts.join('')
}

/** The median time of `runs` calls of `f`, ms. */
function medianMs(f: () => void, runs: number): number {
  const times: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now()
    f()
    times.push(performance.now() - t0)
  }

  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!
}

/**
 * Property: reading code spans is linear in the line, so a crafted line of many unclosed backtick runs of
 * distinct lengths never stalls a parse. A size ratio test: 4 times the line costs about 4 times (linear), where the
 * old scan cost 8 times (k runs times the line, k growing as its square root).
 */
test('codeSpansOut is linear on unclosed backtick runs: a 1 MB adversarial line, by a size ratio', () => {
  const big = unclosedRuns(1414)
  const quarter = unclosedRuns(707)
  expect(big.length).toBeGreaterThan(1_000_000)
  expect(big.length / quarter.length).toBeGreaterThan(3.9)
  // Behind a valid first case: the result is the old one, on the adversarial line and on random texts.
  expect(codeSpansOut(unclosedRuns(60))).toBe(oldCodeSpansOut(unclosedRuns(60)))
  let seed = 7
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  for (let n = 0; n < 2000; n += 1) {
    const text = Array.from({ length: Math.floor(next() * 24) }, () => [TICK, TICK.repeat(2), TICK.repeat(3), 'a', ' ', '#T1'][Math.floor(next() * 6)]).join('')
    expect(codeSpansOut(text)).toBe(oldCodeSpansOut(text))
  }
  // At the limit: the whole 1 MB line, with no span closed, is unchanged; one backtick at its very end closes the first run, so all from it is blanked.
  expect(codeSpansOut(big)).toBe(big)
  expect(codeSpansOut(big + TICK)).toBe(`- [ ] x ${' '.repeat(big.length - 7)}`)
  // The ratio: warm up, then the median of 5 runs each.
  medianMs(() => codeSpansOut(quarter), 3)
  const quarterMs = Math.max(medianMs(() => codeSpansOut(quarter), 5), 0.5)
  const bigMs = medianMs(() => codeSpansOut(big), 5)
  expect(bigMs / quarterMs).toBeLessThan(6)
  // A wide wall-clock bound beside the ratio: the old scan took seconds here.
  expect(bigMs).toBeLessThan(1500)
  // The excluded population: a line with no backtick is returned as it is.
  expect(codeSpansOut('- [ ] #T0001 plain')).toBe('- [ ] #T0001 plain')
})

/**
 * Property: U+2028 and U+2029 are text in a line, never line ends, so a checkbox line that holds one is an
 * item, with the character read as a space. The p201 state.
 */
test('a checkbox line holding U+2028 or U+2029 is an item, the character read as a space', () => {
  const ls = String.fromCharCode(0x2028)
  const ps = String.fromCharCode(0x2029)
  // The state, behind a valid first ticket.
  expect(parseTodo(`- [ ] #T0001 a\n- [ ] Fix${ls}the parser\n- [ ] #T0002 b`).map(item => item.text)).toEqual(['#T0001 a', 'Fix the parser', '#T0002 b'])
  // At the limit: U+2029 as the last character of the last line, and U+2028 right after the box; the ID still leads.
  expect(parseTodo(`- [ ] #T0001 a\n- [x] #T0003 done${ps}`).map(item => [item.id, item.text, item.status])).toEqual([['T0001', '#T0001 a', 'pending'], ['T0003', '#T0003 done', 'completed']])
  expect(CHECKBOX.test(`- [ ] ${ls}x`)).toBe(true)
  // The excluded population: a carriage return is still no text (a CRLF line reads as an LF one), and such a line in a fence is an example.
  expect(CHECKBOX.exec('- [ ] a\r')).toBeNull()
  expect(parseTodo(`- [ ] a\r\n- [ ] b${ls}c\r`).map(item => item.text)).toEqual(['a', 'b c'])
  expect(parseTodo(`\`\`\`\n- [ ] in${ls}code\n\`\`\`\n- [ ] #T0004 real`).map(item => item.id)).toEqual(['T0004'])
})
