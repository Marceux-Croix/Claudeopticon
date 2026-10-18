import { expect, test } from 'claude-code/testing'

import { insertIds, lineHolding, lineIds, NUMBER_AFTER_MS, NUMBER_MAX, textIds } from '../hooks/numbering'
import { BLOCK_SIZE, CLAIM_SCAN } from '../hooks/id-blocks'
import { nextTicketIds } from '../hooks/ticket-ids'

test('lineIds reads the ID a checkbox line carries', async () => {
  expect(lineIds('- [ ] #T002B Fix the parser')).toEqual(['T002B'])
  expect(lineIds('  * [x] **#T12** done')).toEqual(['T12'])
  expect(lineIds('- [~] PROJ7 old #PROJ7 form')).toEqual(['PROJ7'])
  expect(lineIds('- [>] Fix x #t0001')).toEqual(['t0001'])
})

test('lineIds is empty for lines with no ID, no box, or a non-ID tag', async () => {
  expect(lineIds('- [ ] Fix the parser')).toEqual([])
  expect(lineIds('#T002B alone')).toEqual([])
  expect(lineIds('- [ ] #TODO later')).toEqual([])
  expect(lineIds('')).toEqual([])
  expect(lineIds('- [ ]')).toEqual([])
})

/** Property: every `T` ID word of a checkbox line counts as taken, not only the first ID word. */
test('every T ID of a line counts, after another ID word, at the end of the line, and in an example', async () => {
  // Behind a valid first case: `#h264` comes first.
  expect(lineIds('- [ ] see #h264 and #T0099')).toEqual(['h264', 'T0099'])
  // At the limit: the last word of the line, and two T IDs.
  expect(lineIds('- [ ] #T0001 split from #T0002')).toEqual(['T0001', 'T0002'])
  // The excluded population: a line inside a fenced example still counts, examples included.
  expect(textIds('```\n- [ ] see #h264 and #T0099\n```')).toContain('t0099')
})

/** Property: a pass numbers no more lines of a file than one pick of IDs can give. */
test('NUMBER_MAX fits in one pick, with room for blocks other sessions hold', async () => {
  expect(NUMBER_MAX).toBeGreaterThan(0)
  expect(NUMBER_MAX * 4).toBeLessThanOrEqual(CLAIM_SCAN * BLOCK_SIZE)
})

test('insertIds writes each ID after the box of its line, in order, and keeps other lines', async () => {
  const text = '# Head\n- [ ] Fix x\n\n  * [x] Done y\n- [~] Mid z'
  expect(insertIds(text, [1, 3, 4], ['T0001', 'T0002', 'T0003'])).toBe('# Head\n- [ ] #T0001 Fix x\n\n  * [x] #T0002 Done y\n- [~] #T0003 Mid z')
  expect(insertIds(text, [], [])).toBe(text)
})

test('insertIds leaves a line that is no checkbox alone, keeps CRLF, and the delay is 5 seconds', async () => {
  expect(insertIds('plain\n- [ ] a', [0], ['T0001'])).toBe('plain\n- [ ] a')
  expect(insertIds('- [ ] a\r\n- [ ] b\r\n', [1], ['T0009'])).toBe('- [ ] a\r\n- [ ] #T0009 b\r\n')
  expect(NUMBER_AFTER_MS).toBe(5000)
})

// ---------------------------------------------------------------- (batch K1)

/** Property: a stray tag in an example never moves the number line, and the toast for a full line can name its line. */
test('an example tag past the end of the line is no taken value, and lineHolding finds the line of an ID', async () => {
  // The verifier's states: `0` and `Z` in a fenced example; their IDs are read but carry no value.
  const fenced = (tag: string) => `- [ ] #T0001 a\n\`\`\`\n- [ ] ci ${tag}\n\`\`\`\n- [ ] new`
  for (const tag of ['#T202410', '#T9ZZZZZ']) {
    const ids = textIds(fenced(tag))
    expect(ids).toContain(tag.slice(1).toLowerCase())
    expect(nextTicketIds(ids, 1)).toEqual(['T0002'])
  }
  // At the limit: the last value counts and fills the line; lineHolding gives its line, trimmed, in any case.
  expect(nextTicketIds(textIds('- [ ] #T0001 a\n```\n- [ ] #T1ZZZZ x\n```'), 1)).toEqual([])
  expect(lineHolding('- [ ] #T0001 a\n```\n  - [ ] #T1ZZZZ x\r\n```', 't1zzzz')).toBe('- [ ] #T1ZZZZ x')
  // The excluded population: an ID only inside a longer word, and no such ID.
  expect(lineHolding('see #T1ZZZZZ here', 'T1ZZZZ')).toBeUndefined()
  expect(lineHolding('- [ ] #T0001 a', 'T1ZZZZ')).toBeUndefined()
})

/**
 * Property: the toast of a used-up number line names the checkbox line that holds the ID, the line whose ID
 * counts, never a prose line that only names it. The reviewer's p197line state.
 */
test('lineHolding names only a checkbox line that holds the ID, never a prose line', () => {
  // The reviewer's state: a prose line names the ID first; the checkbox line below it is the cause.
  expect(lineHolding('The highest form is #T1ZZZZ.\n- [ ] #T0001 a\n- [ ] #T1ZZZZ last', 'T1ZZZZ')).toBe('- [ ] #T1ZZZZ last')
  // Behind a valid first case: a heading and a table row that name it, then the checkbox line as the last line of a CRLF file.
  expect(lineHolding('## About #T1ZZZZ\r\n| #T1ZZZZ | x |\r\n  - [x] see #t1zzzz\r\n', 'T1ZZZZ')).toBe('- [x] see #t1zzzz')
  // The excluded population: prose alone, and a list line with no box, name no line.
  expect(lineHolding('The highest form is #T1ZZZZ.', 'T1ZZZZ')).toBeUndefined()
  expect(lineHolding('- #T1ZZZZ is the end', 'T1ZZZZ')).toBeUndefined()
})
