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

/**
 * The least wall time of `runs` runs of each job, in ms, the two jobs run in turn. Process CPU time is not
 * available in the test sandbox. The least of many runs drops the runs that a busy machine slowed, and the
 * turns spread a load spike over both jobs (the least of 5 runs of each, one after the other, measured
 * a ratio of 19.6 under a load average of 7 to 21).
 */
function leastMs(small: () => void, large: () => void, runs: number): [number, number] {
  const least: [number, number] = [Infinity, Infinity]
  for (let i = 0; i < runs; i += 1) {
    for (const [at, job] of [small, large].entries()) {
      const from = performance.now()
      job()
      least[at] = Math.min(least[at]!, performance.now() - from)
    }
  }

  return least
}

/** A todo text of `n` done tickets under one heading each of 50, and an archive of `lines` lines. */
const doneText = (n: number) => Array.from({ length: n }, (_, i) => `## S${i % 50}\n- [x] #T${String(i).padStart(5, '0')} done ticket ${i}`).join('\n')
const archiveText = (lines: number) => Array.from({ length: lines }, (_, i) => (i % 4 === 0 ? `## Old${i}` : `- [x] #T9${String(i).padStart(4, '0')} old ${i}`)).join('\n')

/** Property: the archive text work grows linearly in blocks and in archive lines; 8 times the blocks and archive lines cost at most 16x (linear is 8x, quadratic 64x). */
test('the archive text work is linear in the number of blocks and archive lines', { timeoutMs: 120_000 }, () => {
  /** The inputs of the archive step for n closed blocks, built before any timing. */
  const inputs = (n: number) => {
    const text = doneText(n)
    const blocks = closedBlocks(text)
    const archive = archiveText(n * 4)
    const wrote = blocks.map(block => block.lines)
    const next = addToArchive(archive, blocks, wrote)
    // The work is right before it is timed.
    expect(blocks.length).toBe(n)
    expect(blocksStandAsItems(next, blocks)).toBe(true)
    expect(removeBlocks(text, blocks)).not.toContain('[x]')

    return { text, blocks, archive, wrote, next }
  }
  const SMALL = 200
  const LARGE = 1600
  const [a, b] = [inputs(SMALL), inputs(LARGE)]
  // Each function is timed alone, so a quadratic term in one is not hidden by the others. Each job runs
  // `reps` times per sample, so a sample of the small input takes a few ms, well above the timer's grain.
  const jobs: [string, number, (x: typeof a) => unknown][] = [
    ['closedBlocks', 3, x => closedBlocks(x.text)],
    ['removeBlocks', 40, x => removeBlocks(x.text, x.blocks)],
    ['addToArchive', 1, x => addToArchive(x.archive, x.blocks, x.wrote)],
    ['blocksStandAsItems', 1, x => blocksStandAsItems(x.next, x.blocks)],
  ]
  const repeated = (reps: number, job: () => unknown) => () => {
    for (let k = 0; k < reps; k += 1) {
      job()
    }
  }
  for (const [name, reps, job] of jobs) {
    // 8 times the input: linear is about 8, quadratic about 64. Load from other processes only makes a ratio
    // larger, never smaller, so the best of up to 3 measurements is the cost.
    let ratio = Infinity
    for (let attempt = 0; attempt < 3 && ratio >= 20; attempt += 1) {
      const [small, large] = leastMs(repeated(reps, () => job(a)), repeated(reps, () => job(b)), 5)
      ratio = Math.min(ratio, large / Math.max(small, 0.5))
    }
    expect([name, ratio < 20]).toEqual([name, true])
  }
})

// ----------------------------------------------------------------
// Property: a done top-level HTML item leaves a .html file with its subtasks, lands under the same <hN> heading in the
// archive as the same lines, and an open subtask holds it back; a .md file never archives an HTML line.

const tag = (state: string) => `<input type="checkbox"${state}>`
const HTML_PLAN = [
  '<h1>Plan</h1>',
  '<h2>Core</h2>',
  '<ul>',
  `  <li>${tag(' checked')} #T0001 done parser</li>`,
  '    <ul>',
  `      <li>${tag(' checked')} #T0002 done child</li>`,
  '    </ul>',
  `  <li>${tag(' checked')} #T0003 done with open child</li>`,
  `    <li>${tag(' data-state="queued"')} #T0004 open child</li>`,
  `  <li>${tag('')} #T0005 open</li>`,
  `    <li>${tag(' checked')} #T0006 done under open</li>`,
  '</ul>',
].join('\n')

test('closedBlocks takes a done HTML item with the lines indented past it, under its <hN> heading', () => {
  const blocks = closedBlocks(HTML_PLAN, 'html')
  expect(blocks.map(block => [block.heading, block.from, block.to, block.lines.length])).toEqual([['<h2>Core</h2>', 3, 7, 4]])
  expect(blocks[0]!.lines[0]).toBe(`  <li>${tag(' checked')} #T0001 done parser</li>`)
  expect(closedBlocks(HTML_PLAN, 'md')).toEqual([])
  // A done HTML item inside a comment is an example: it never leaves.
  expect(closedBlocks(`<!--\n<li>${tag(' checked')} a</li>\n-->`, 'html')).toEqual([])
  // A tag that fails the grammar but holds a checkbox counts as open: it holds the block back.
  expect(closedBlocks(`<li>${tag(' checked')} a</li>\n  <li><input type="checkbox" checked="no"> b</li>`, 'html')).toEqual([])
})

test('an archived HTML item lands under the same <hN> heading as the same lines, and stands as items there', () => {
  const blocks = closedBlocks(HTML_PLAN, 'html')
  const archive = addToArchive('<h2>Core</h2>\n\n<li><input type="checkbox" checked> #T0009 old</li>\n\n<h2>Docs</h2>\n', blocks, [], '\n', 'html')
  expect(archive).toBe(['<h2>Core</h2>', '', '<li><input type="checkbox" checked> #T0009 old</li>', ...blocks[0]!.lines, '', '<h2>Docs</h2>', ''].join('\n'))
  expect(blocksStandAsItems(archive, blocks, 'html')).toBe(true)
  // A new archive gets the heading, then the block.
  expect(addToArchive('', blocks, [], '\n', 'html')).toBe(['<h2>Core</h2>', '', ...blocks[0]!.lines, ''].join('\n'))
  // An archive that ends in an open comment would hide the block: it does not stand as items.
  const hidden = addToArchive('<!--', blocks, [], '\n', 'html')
  expect(blocksStandAsItems(hidden, blocks, 'html')).toBe(false)
  // The cut source keeps every other line.
  expect(removeBlocks(HTML_PLAN, blocks).split('\n')).toEqual(HTML_PLAN.split('\n').filter((_, at) => at < 3 || at >= 7))
})

test('blocksLeft reads HTML items by key in a .html file', () => {
  const blocks = closedBlocks(HTML_PLAN, 'html')
  expect(blocksLeft(HTML_PLAN, removeBlocks(HTML_PLAN, blocks), blocks, 'html')).toEqual(blocks)
  expect(blocksLeft(HTML_PLAN, HTML_PLAN, blocks, 'html')).toEqual([])
})

// ---------------------------------------------------------------- 
// Property: in a .html file a done top-level HTML item leaves only with lines that are its own (indented past it, or
// list tags of its nesting), and every line that may be a box it cannot read holds it back.

test('a line with two list items is no ticket, and a done first box never archives the open second one', () => {
  const src = ['<ul>', `<li>${tag(' checked')} #T0001 a</li><li>${tag('')} #T0002 still open</li>`, '</ul>', ''].join('\n')
  expect(closedBlocks(src, 'html')).toEqual([])
  // Under a done item, such a line counts open: it holds the item back.
  const under = ['<ul>', `<li>${tag(' checked')} #T0003 parent</li>`, `  <li>${tag(' checked')} #T0004 a</li><li>${tag('')} #T0005 open</li>`, '</ul>'].join('\n')
  expect(closedBlocks(under, 'html')).toEqual([])
})

test('an open subtask whose input tag is split over lines holds back its done parent', () => {
  const split = ['<ul>', `<li>${tag(' checked')} #T0001 parent</li>`, '    <li><input', '        type="checkbox"> #T0002 open sub</li>', '</ul>'].join('\n')
  expect(closedBlocks(split, 'html')).toEqual([])
  const single = ['<ul>', `<li>${tag(' checked')} #T0001 parent</li>`, '    <li><INPUT', "        TYPE='checkbox' checked> #T0002 done sub, but not readable</li>", '</ul>'].join('\n')
  expect(closedBlocks(single, 'html')).toEqual([])
})

test('a prose line right under a done HTML item stays in the file', () => {
  const src = ['<h2>Work</h2>', '<ul>', `<li>${tag(' checked')} #T0001 Ship it</li>`, 'Remember to email Bob before Friday.', '</ul>', ''].join('\n')
  const blocks = closedBlocks(src, 'html')
  expect(blocks).toEqual([{ heading: '<h2>Work</h2>', lines: [`<li>${tag(' checked')} #T0001 Ship it</li>`], from: 2, to: 3 }])
  expect(removeBlocks(src, blocks)).toContain('Remember to email Bob before Friday.')
})

test('a child in a <ul> at the parent indent holds back a done parent, and moves with it when done', () => {
  const nest = (child: string) => ['<ul>', `  <li>${tag(' checked')} #T0001 Parent</li>`, '  <ul class="sub">', `    <li>${tag(child)} #T0002 child</li>`, '  </ul>', `  <li>${tag('')} #T0003 next</li>`, '</ul>'].join('\n')
  expect(closedBlocks(nest(''), 'html')).toEqual([])
  const done = closedBlocks(nest(' checked'), 'html')
  expect(done.map(block => [block.from, block.to])).toEqual([[1, 5]])
  expect(removeBlocks(nest(' checked'), done).split('\n')).toEqual(['<ul>', `  <li>${tag('')} #T0003 next</li>`, '</ul>'])
  // An <ol> after a blank line, in upper case, counts the same; a list tag followed by a sibling is no part of the block.
  const ol = ['<li><input type="checkbox" checked> #T0004 p</li>', '', '<OL>', `  <li>${tag('')} #T0005 c</li>`, '</OL>'].join('\n')
  expect(closedBlocks(ol, 'html')).toEqual([])
  const sibling = ['<ul>', `<li>${tag(' checked')} #T0006 a</li>`, '</ul>', '<ul>', `<li>${tag('')} #T0007 b</li>`, '</ul>'].join('\n')
  expect(closedBlocks(sibling, 'html').map(block => [block.from, block.to])).toEqual([[1, 2]])
})

// ----------------------------------------------------------------
// Property: addToArchive grows linearly in headings: the archive's example mask is read a fixed number of times per
// call, not once per heading group. 8 times the headings and archive lines cost at most 20x (linear 8x, quadratic 64x).

/** A todo text of `n` done tickets, each under its own heading, and an archive that has every second heading. */
const manyHeadings = (n: number, kind: 'md' | 'html') => {
  const head = (i: number) => (kind === 'md' ? `## H${i}` : `<h2>H${i}</h2>`)
  const item = (id: string, text: string) => (kind === 'md' ? `- [x] #${id} ${text}` : `<li><input type="checkbox" checked> #${id} ${text}</li>`)
  const text = Array.from({ length: n }, (_, i) => `${head(i)}\n${item(`T${String(i).padStart(5, '0')}`, `done ${i}`)}`).join('\n')
  const archive = Array.from({ length: n / 2 }, (_, i) => `${head(i * 2)}\n\n${item(`T9${String(i).padStart(4, '0')}`, `old ${i}`)}\n`).join('\n')

  return { text, archive }
}

test('addToArchive is linear in the number of headings, new and found, with and without a retry record', { timeoutMs: 120_000 }, () => {
  for (const kind of ['md', 'html'] as const) {
    const inputs = (n: number) => {
      const { text, archive } = manyHeadings(n, kind)
      const blocks = closedBlocks(text, kind)
      const wrote = blocks.slice(0, 3).map(block => block.lines)
      const next = addToArchive(archive, blocks, wrote, '\n', kind)
      // The work is right before it is timed: every block lands as items, and each heading stands once.
      expect(blocks.length).toBe(n)
      expect(blocksStandAsItems(next, blocks, kind)).toBe(true)
      expect(next.split('\n').filter(line => line === (kind === 'md' ? '## H7' : '<h2>H7</h2>')).length).toBe(1)

      return { archive, blocks, wrote }
    }
    const [a, b] = [inputs(250), inputs(2000)]
    // Each function is timed alone; load only makes a ratio larger, so the best of up to 3 is the cost.
    const jobs: [string, (x: typeof a) => unknown][] = [
      ['addToArchive', x => addToArchive(x.archive, x.blocks, [], '\n', kind)],
      ['addToArchive retry', x => addToArchive(x.archive, x.blocks, x.wrote, '\n', kind)],
    ]
    for (const [name, job] of jobs) {
      let ratio = Infinity
      for (let attempt = 0; attempt < 3 && ratio >= 20; attempt += 1) {
        const [small, large] = leastMs(() => job(a), () => job(b), 3)
        ratio = Math.min(ratio, large / Math.max(small, 0.5))
      }
      expect([kind, name, ratio < 20]).toEqual([kind, name, true])
    }
  }
})

test('addToArchive puts each heading group where the per-group code put it', () => {
  const one = (heading: string | undefined, line: string) => ({ ...(heading === undefined ? {} : { heading }), lines: [line], from: 0, to: 1 })
  const md = ['## A', '', '- [x] #T1 old a', '', '## B', '- [x] #T2 old b'].join('\n')
  const blocks = [one(undefined, '- [x] #T5 loose'), one('## B', '- [x] #T3 b'), one('## C', '- [x] #T4 c'), one('## A', '- [x] #T6 a')]
  // The loose block goes at the end, in the last section; B's block after it, before the new heading C.
  expect(addToArchive(md, blocks)).toBe('## A\n\n- [x] #T1 old a\n- [x] #T6 a\n\n## B\n- [x] #T2 old b\n- [x] #T5 loose\n- [x] #T3 b\n\n## C\n\n- [x] #T4 c\n')
  // A section that ends in an open `<div>` HTML block gets a blank line first, so the block is no part of it.
  expect(addToArchive('## A\n<div>\nx\n\n## B\n', [one('## A', '- [x] #T7 a')])).toBe('## A\n<div>\nx\n\n- [x] #T7 a\n\n## B\n')
  expect(addToArchive('## A\n<div>\nx\n## B\n', [one('## A', '- [x] #T7 a')])).toBe('## A\n<div>\nx\n## B\n\n- [x] #T7 a\n')
  expect(addToArchive('## A\n<div>', [one('## A', '- [x] #T7 a')])).toBe('## A\n<div>\n\n- [x] #T7 a\n')
  expect(addToArchive('<div>', [one(undefined, '- [x] #T9 a')])).toBe('<div>\n\n- [x] #T9 a\n')
  // An empty section gets a blank line after its heading, and one before the next heading.
  expect(addToArchive('## A\n## B\n', [one('## A', '- [x] #T8 a')])).toBe('## A\n\n- [x] #T8 a\n\n## B\n')
  // A found last section takes its block before a heading an earlier group added at the end.
  expect(addToArchive('## B\nx', [one('## C', '- [x] #T4 c'), one('## B', '- [x] #T3 b')])).toBe('## B\nx\n- [x] #T3 b\n\n## C\n\n- [x] #T4 c\n')
})
