import { expect, test } from 'claude-code/testing'

import { addToArchive, blocksLeft, blocksStandAsItems, closedBlocks, removeBlocks } from '../hooks/archive-blocks'
import { parseTodo } from '../hooks/todo-markdown'

// ---------------------------------------------------------------- archiving closed tickets

const PLAN_TEXT = ['# Plan', '', '## Core', '- [x] #T1 Done parser', '  note under it', '- [ ] #T2 Open lexer', '- [x] #T3 Done with open child', '  - [ ] #T4 child open', '', '## Docs', '- [x] #T5 Done docs', '', 'prose stays'].join('\n')

test('closedBlocks finds a top-level done ticket with its indented lines, only when every box in the block is done', () => {
  const blocks = closedBlocks(PLAN_TEXT)
  expect(blocks.map(block => block.lines)).toEqual([['- [x] #T1 Done parser', '  note under it'], ['- [x] #T5 Done docs']])
  expect(blocks.map(block => block.heading)).toEqual(['## Core', '## Docs'])
  expect(blocks.map(block => [block.from, block.to])).toEqual([[3, 5], [10, 11]])
  // A done subtask under an open ticket stays; a done child under a done ticket goes with it.
  expect(closedBlocks('- [ ] #T1 Open\n  - [x] done child')).toEqual([])
  expect(closedBlocks('- [x] #T1 Done\n  - [x] done child\n    - [X] deeper')[0]?.lines.length).toBe(3)
  expect(closedBlocks('- [x] #T1 Done\n  - [~] child going')).toEqual([])
  // Only an unindented ticket line starts a block; the bullet and the box case can differ.
  expect(closedBlocks('  - [x] indented only')).toEqual([])
  expect(closedBlocks('* [X] Star bullet')[0]?.lines).toEqual(['* [X] Star bullet'])
  // A block runs past blank lines while the next non-blank line is indented; the blanks after its last line are not taken.
  expect(closedBlocks('- [x] A\n\n  later indent\n\n- [x] B').map(block => [block.lines, block.from, block.to])).toEqual([[['- [x] A', '', '  later indent'], 0, 3], [['- [x] B'], 4, 5]])
  // An open or in-progress subtask after a blank line keeps the whole block: it never joins the item above.
  expect(closedBlocks('- [x] A\n  - [x] done\n\n  - [ ] open after a blank')).toEqual([])
  expect(closedBlocks('- [x] A\n\n\n    - [~] going')).toEqual([])
  // Prose, a table and a code fence are never moved.
  expect(closedBlocks('| a | b |\n|---|---|\n```\n- [x] in a fence\n```').length).toBe(0)
  // A block with no heading above it has none.
  expect(closedBlocks('- [x] Top')[0]?.heading).toBeUndefined()
  // Removing the blocks leaves everything else exactly.
  expect(removeBlocks(PLAN_TEXT, blocks)).toBe(['# Plan', '', '## Core', '- [ ] #T2 Open lexer', '- [x] #T3 Done with open child', '  - [ ] #T4 child open', '', '## Docs', '', 'prose stays'].join('\n'))
})

test('addToArchive groups blocks under their heading, never twice', () => {
  const blocks = closedBlocks(PLAN_TEXT)
  const fresh = addToArchive('', blocks)
  expect(fresh).toBe('## Core\n\n- [x] #T1 Done parser\n  note under it\n\n## Docs\n\n- [x] #T5 Done docs\n')
  // A retry adds nothing: the exact block is there, and it is what this mod wrote last.
  expect(addToArchive(fresh, blocks, blocks.map(block => block.lines))).toBe(fresh)
  // Under an existing heading the block goes at the end of that section; another section is untouched.
  const merged = addToArchive('## Docs\n\n- [x] #T0 Older\n\n## Other\n\n- [x] #T9 x\n', [blocks[1]!])
  expect(merged).toBe('## Docs\n\n- [x] #T0 Older\n- [x] #T5 Done docs\n\n## Other\n\n- [x] #T9 x\n')
  // A new heading goes at the end of the file; a block with no heading goes at the end with none.
  expect(addToArchive('- [x] #T0 Older\n', [blocks[0]!])).toBe('- [x] #T0 Older\n\n## Core\n\n- [x] #T1 Done parser\n  note under it\n')
  expect(addToArchive('## Core\n\n- [x] #T0 Older\n', closedBlocks('- [x] #T7 Loose'))).toBe('## Core\n\n- [x] #T0 Older\n- [x] #T7 Loose\n')
  // A heading with nothing under it takes the block after a blank line.
  expect(addToArchive('## Docs\n', [blocks[1]!])).toBe('## Docs\n\n- [x] #T5 Done docs\n')
})

test('closedBlocks: a fence line in a block keeps it, and the fence state still holds', () => {
  expect(closedBlocks('- [x] A\n  ```\n- [x] fenced\n  ```\n- [x] B').map(block => block.lines)).toEqual([['- [x] B']])
  expect(closedBlocks('- [x] A\n  ~~~\n  code\n  ~~~').length).toBe(0)
})

test('addToArchive does not take a heading inside a code fence for a heading', () => {
  const [block] = closedBlocks('## Core\n- [x] #T1 Done parser\n  note under it')
  expect(addToArchive('## Core\n\n- [x] #T0 Older\n\n## Other\n\n```\n## Core\n```\n', [block!])).toBe('## Core\n\n- [x] #T0 Older\n- [x] #T1 Done parser\n  note under it\n\n## Other\n\n```\n## Core\n```\n')
  expect(addToArchive('## Core\n\n- [x] #T0 Older\n\n```\n# install\n```\n- [x] #T3 After fence\n\n## Other\n', [block!])).toBe('## Core\n\n- [x] #T0 Older\n\n```\n# install\n```\n- [x] #T3 After fence\n- [x] #T1 Done parser\n  note under it\n\n## Other\n')
})

test('addToArchive skips a block only when it stands whole in the archive and this mod wrote it last', () => {
  const one = closedBlocks('- [x] #T1 Done parser')
  const arch = '- [x] #T1 Done parser\n'
  // A new block that equals an old archived line is added.
  expect(addToArchive(arch, one)).toBe('- [x] #T1 Done parser\n- [x] #T1 Done parser\n')
  expect(addToArchive(arch, one, [one[0]!.lines])).toBe(arch)
  // A longer archived block does not count as the run: the next line is indented.
  expect(addToArchive('- [x] #T1 Done parser\n  note\n', one, [one[0]!.lines])).toBe('- [x] #T1 Done parser\n  note\n- [x] #T1 Done parser\n')
})

// ---------------------------------------------------------------- 

/** Property: a done line inside an HTML comment is an example: it never starts or joins a block, so the archive never cuts it out of the comment. */
test('closedBlocks never takes a line of an HTML comment', () => {
  // The R3-D state: the comment example sits behind a valid first case, a real done ticket after it.
  const text = ['# Plan', '<!-- Example of the format:', '- [x] #T0001 Example done item', '-->', '- [x] #T2 Real done', '- [ ] #T3 Open'].join('\n')
  expect(closedBlocks(text).map(block => block.lines)).toEqual([['- [x] #T2 Real done']])
  // At the limit: a comment that opens on the last lines and never closes.
  expect(closedBlocks('- [x] #T1 Real\n<!-- notes\n- [x] #T9 Inside')).toEqual([{ lines: ['- [x] #T1 Real'], from: 0, to: 1 }])
  // Inside a block: a comment line under a done ticket keeps the whole block, as a fence line does.
  expect(closedBlocks('- [x] #T1 Done\n  <!-- hidden\n  - [ ] open in a comment\n  -->')).toEqual([])
  // A heading inside a comment is no heading.
  expect(closedBlocks('## Real\n<!--\n## Fake\n-->\n- [x] #T4 Done')[0]?.heading).toBe('## Real')
  // The excluded population: a closed one-line comment above, and a ticket with `<!--` in its text, still move.
  expect(closedBlocks('<!-- note -->\n- [x] #T5 Done').map(block => block.lines)).toEqual([['- [x] #T5 Done']])
  expect(closedBlocks('- [x] #T6 Strip <!-- markers').map(block => block.lines)).toEqual([['- [x] #T6 Strip <!-- markers']])
})

// ---------------------------------------------------------------- 

/**
 * Property: a moved block lands where it is items: a heading inside an HTML comment or a code
 * fence of the archive is no heading, neither as the place to go nor as the end of a section.
 * Three states.
 */
test('addToArchive never puts a block under a heading inside an HTML comment, and the items check holds', () => {
  const blocks = closedBlocks('## Work\n- [x] #T5 Ship the parser\n- [ ] #T6 Open')
  for (const [label, archive] of [
    // The defect behind a valid first case: a real heading first, then the same heading in a comment after it.
    ['heading in comment after a real one', '## Work\n- [x] #T1 Old\n\n<!--\n## Work\n## Notes\n-->\n'],
    // At the limit: the comment opens on the first line of the file.
    ['heading in comment at the start', '<!--\n## Work\n-->\n## Other\n- [x] #T2 Other old\n'],
    // Inside the population a fence mask leaves out: the heading only in a comment, with a heading after it.
    ['heading only in comment', '- [x] #T3 Loose\n<!--\n## Work\n-->\n## Later\n- [x] #T4 Later old\n'],
  ] as const) {
    const next = addToArchive(archive, blocks, [], '\n')
    expect([label, parseTodo(next).some(item => item.text.includes('Ship the parser'))]).toEqual([label, true])
    expect([label, blocksStandAsItems(next, blocks)]).toEqual([label, true])
  }
  // The check refuses a text where the block stands only inside a comment or a fence.
  expect(blocksStandAsItems('## Work\n<!--\n- [x] #T5 Ship the parser\n-->\n', blocks)).toBe(false)
  expect(blocksStandAsItems('```\n- [x] #T5 Ship the parser\n```\n', blocks)).toBe(false)
  expect(blocksStandAsItems('- [x] #T5 Ship the parser\n', blocks)).toBe(true)
  // A section ends at a real heading, never at one inside a comment: the block goes before `## Next`, after the comment.
  expect(addToArchive('## Work\n- [x] #T1 Old\n<!--\n## Hidden\n-->\n## Next\n- [x] #T9 N\n', blocks)).toBe('## Work\n- [x] #T1 Old\n<!--\n## Hidden\n-->\n- [x] #T5 Ship the parser\n\n## Next\n- [x] #T9 N\n')
})

/**
 * Property: a block counts as gone from the source only when the source lost a line with its
 * key since the read the move worked from; a box set back or a line typed elsewhere leaves it there.
 */
test('blocksLeft names only the blocks whose line left the source', () => {
  const read = '## Core\n- [x] #T1 Done parser\n  note under it\n- [ ] #T2 Open\n- [x] Same text\n- [x] Same text'
  const blocks = closedBlocks(read)
  expect(blocks.map(block => block.lines[0])).toEqual(['- [x] #T1 Done parser', '- [x] Same text', '- [x] Same text'])
  // Another session cut every block.
  expect(blocksLeft(read, '## Core\n- [ ] #T2 Open', blocks)).toEqual(blocks)
  // The user typed a line: nothing left.
  expect(blocksLeft(read, `${read}\n- [ ] #T3 Typed`, blocks)).toEqual([])
  // The box of #T1 set back to open: still there, by its key.
  expect(blocksLeft(read, read.replace('- [x] #T1', '- [ ] #T1'), blocks)).toEqual([])
  // One of two identical no-ID lines went: one block counts as gone, not both.
  expect(blocksLeft(read, read.replace(/\n- \[x\] Same text$/, ''), blocks)).toEqual([blocks[1]])
})

/**
 * Property: a block added after an HTML block of type 6 or 7 (`<details>`, a lone tag) that the archive
 * leaves open gets a blank line before it, which ends that block, so the moved ticket stands as an item; elsewhere
 * the archive keeps its blocks together as before.
 */
test('addToArchive puts a blank line after an open <details> block, so the moved block stands as items', () => {
  const blocks = closedBlocks('## Work\n- [x] #T5 Ship the parser')
  const loose = closedBlocks('- [x] #T6 Loose')
  // Behind a valid first case: the section's last line closes a <details> block; and with no heading, at the end.
  const next = addToArchive('## Work\n- [x] #T1 Old\n\n<details>\n- [x] example\n</details>\n', blocks)
  expect(next).toBe('## Work\n- [x] #T1 Old\n\n<details>\n- [x] example\n</details>\n\n- [x] #T5 Ship the parser\n')
  expect(blocksStandAsItems(next, blocks)).toBe(true)
  // At the limit: a lone tag as the archive's last line.
  const end = addToArchive('- [x] #T1 Old\n\n<span>\n', loose)
  expect(end).toBe('- [x] #T1 Old\n\n<span>\n\n- [x] #T6 Loose\n')
  expect(blocksStandAsItems(end, loose)).toBe(true)
  // The excluded population: no blank line after a ticket, a closed fence, a closed type 1 block or a quote.
  expect(addToArchive('- [x] #T1 Old\n', loose)).toBe('- [x] #T1 Old\n- [x] #T6 Loose\n')
  expect(addToArchive('```\nx\n```\n', loose)).toBe('```\nx\n```\n- [x] #T6 Loose\n')
  expect(addToArchive('<pre>\nx\n</pre>\n', loose)).toBe('<pre>\nx\n</pre>\n- [x] #T6 Loose\n')
  expect(addToArchive('> note\n', loose)).toBe('> note\n- [x] #T6 Loose\n')
})

// ---------------------------------------------------------------- wrapped text, headings, retries and scale

/** Property: a done ticket whose wrapped text is not indented still holds back for an open subtask below the wrap, and moves whole when every subtask is done. */
test('closedBlocks keeps a ticket with an unindented wrap line and an open subtask below it', () => {
  const wrap = '- [x] #T0001 Long ticket text that\nwraps onto an unindented line\n'
  expect(closedBlocks(`${wrap}  - [ ] #T0002 open subtask`)).toEqual([])
  expect(closedBlocks(`${wrap}  - [~] #T0002 going`)).toEqual([])
  const done = closedBlocks(`${wrap}  - [x] #T0002 done subtask`)
  expect(done.map(block => block.lines)).toEqual([['- [x] #T0001 Long ticket text that', 'wraps onto an unindented line', '  - [x] #T0002 done subtask']])
  expect(removeBlocks(`${wrap}  - [x] #T0002 done subtask`, done)).toBe('')
  // Two wrap lines in a row.
  expect(closedBlocks('- [x] #T0001 a\nb\nc\n  - [ ] #T0002 open')).toEqual([])
  // The excluded population: prose after a blank line, a heading, a list item or a thematic break ends the block.
  expect(closedBlocks('- [x] #T0001 a\n\nprose\n  - [ ] #T0002 x').map(block => block.lines)).toEqual([['- [x] #T0001 a']])
  expect(closedBlocks('- [x] #T0001 a\n# Head\n  - [ ] x').map(block => block.lines)).toEqual([['- [x] #T0001 a']])
  expect(closedBlocks('- [x] #T0001 a\n- [x] #T0002 b').map(block => block.lines)).toEqual([['- [x] #T0001 a'], ['- [x] #T0002 b']])
  expect(closedBlocks('- [x] #T0001 a\n  ---\nprose\n  - [ ] x').map(block => block.lines)).toEqual([['- [x] #T0001 a', '  ---']])
})

/** Property: a heading with up to 3 spaces of indent is a heading: the ticket is filed under it, and the archive finds the same section. */
test('closedBlocks and addToArchive file a ticket under an indented heading', () => {
  const blocks = closedBlocks('## Core\n   ## Indented\n- [x] #T0001 Done\n')
  expect(blocks[0]?.heading).toBe('## Indented')
  const next = addToArchive('## Core\n\n- [x] #T0000 old\n\n  ## Indented\n\n- [x] #T0009 older\n', blocks)
  expect(next).toBe('## Core\n\n- [x] #T0000 old\n\n  ## Indented\n\n- [x] #T0009 older\n- [x] #T0001 Done\n')
  // A heading with no text, and a tab after the marks.
  expect(closedBlocks('#\n- [x] #T0002 a')[0]?.heading).toBe('#')
  expect(closedBlocks('##\tTab\n- [x] #T0002 a')[0]?.heading).toBe('##\tTab')
  // The excluded population: 4 spaces is code, and 7 marks or no space after them is text.
  expect(closedBlocks('    ## code\n- [x] #T0002 a')[0]?.heading).toBeUndefined()
  expect(closedBlocks('####### seven\n- [x] #T0002 a')[0]?.heading).toBeUndefined()
  expect(closedBlocks('##nospace\n- [x] #T0002 a')[0]?.heading).toBeUndefined()
})

/**
 * Property: a retry skips a block only when the archive holds it under the block's own heading. A stale
 * record of a block, with an equal older block under another heading, never makes the new block vanish.
 */
test('addToArchive adds a block that equals an older archived one under another heading, though the record names it', () => {
  const blocks = closedBlocks('## Today\n- [x] #T0005 water the plants')
  const archive = '## Last week\n\n- [x] #T0005 water the plants\n'
  const next = addToArchive(archive, blocks, [['- [x] #T0005 water the plants']])
  expect(next).toBe('## Last week\n\n- [x] #T0005 water the plants\n\n## Today\n\n- [x] #T0005 water the plants\n')
  // The same retry with the block under its own heading adds nothing.
  const landed = '## Today\n\n- [x] #T0005 water the plants\n'
  expect(addToArchive(landed, blocks, [['- [x] #T0005 water the plants']])).toBe(landed)
  // At the limit: the heading's section is the last one of its name, and an earlier equal section does not count.
  const twice = '## Today\n\n- [x] #T0005 water the plants\n\n## Other\n\n## Today\n\n- [x] #T0001 other\n'
  expect(addToArchive(twice, blocks, [['- [x] #T0005 water the plants']])).toContain('- [x] #T0001 other\n- [x] #T0005 water the plants\n')
  // A block with no heading is still found anywhere.
  const loose = closedBlocks('- [x] #T0006 loose')
  expect(addToArchive('## A\n\n- [x] #T0006 loose\n', loose, [['- [x] #T0006 loose']])).toBe('## A\n\n- [x] #T0006 loose\n')
})

/** The least time of three runs of `job`, in ms. */
function leastMs(job: () => void): number {
  let least = Infinity
  for (let i = 0; i < 5; i += 1) {
    const from = performance.now()
    job()
    least = Math.min(least, performance.now() - from)
  }

  return least
}

/** A todo text of `n` done tickets under one heading each of 50, and an archive of `lines` lines. */
const doneText = (n: number) => Array.from({ length: n }, (_, i) => `## S${i % 50}\n- [x] #T${String(i).padStart(5, '0')} done ticket ${i}`).join('\n')
const archiveText = (lines: number) => Array.from({ length: lines }, (_, i) => (i % 4 === 0 ? `## Old${i}` : `- [x] #T9${String(i).padStart(4, '0')} old ${i}`)).join('\n')

/** Property: the archive text work grows linearly in blocks and in archive lines; 8 times the blocks and archive lines cost at most 16x (linear is 8x, quadratic 64x). */
test('the archive text work is linear in the number of blocks and archive lines', () => {
  const run = (n: number) => {
    const text = doneText(n)
    const blocks = closedBlocks(text)
    const archive = archiveText(n * 4)
    const wrote = blocks.map(block => block.lines)
    const next = addToArchive(archive, blocks, wrote)
    expect(blocksStandAsItems(next, blocks)).toBe(true)
    expect(removeBlocks(text, blocks)).not.toContain('[x]')
    expect(blocks.length).toBe(n)
  }
  run(30)
  const small = leastMs(() => run(100))
  const large = leastMs(() => run(800))
  expect(large / Math.max(small, 1)).toBeLessThan(16)
})
