import { expect, test } from 'claude-code/testing'

import { mergeMarks, readKeptMarks, retryStep } from '../hooks/consolidate-marks'
import type { CopyMark } from '../hooks/consolidate-marks'

const HEADING = 'mods/y/.claude_todo/TODO.md'
const mark = (over: Partial<CopyMark> = {}): CopyMark => ({ heading: HEADING, lines: ['- [ ] #T7 Tune the cache'], sectionsBefore: 0, told: [], isTold: false, ...over })
const copied = (body: string) => `- [ ] #T1 Fix the parser\n\n## From ${HEADING}\n\n${body}\n`

test('UCR-014 a source copied before is never copied again: emptied when it is as copied, left when it changed', () => {
  // No mark, or a mark of another heading, and a section that is the lines up to the IDs (UCR-014, batch H2 changed
  // this from copy): it may be the copy renumbered, so it is left, never copied a second time.
  expect(retryStep(undefined, HEADING, ['- [ ] #T7 Tune the cache'], copied('- [ ] #T0008 Tune the cache'))).toBe('changed')
  expect(retryStep(mark({ heading: 'other' }), HEADING, ['- [ ] #T7 Tune the cache'], copied('- [ ] #T0008 Tune the cache'))).toBe('changed')
  // No mark and no such section: copy.
  expect(retryStep(undefined, HEADING, ['- [ ] #T7 Tune the cache'], copied('- [ ] #T0008 Other work'))).toBe('copy')
  // The copy is there (renumbered): only empty.
  expect(retryStep(mark(), HEADING, ['- [ ] #T7 Tune the cache'], copied('- [ ] #T0008 Tune the cache'))).toBe('empty')
  // State C: the copied section was edited in the target; still only empty.
  expect(retryStep(mark(), HEADING, ['- [ ] #T7 Tune the cache'], copied('- [~] #T0008 Tune the cache, half done'))).toBe('empty')
  // State A: the source changed after the copy: left, never copied twice.
  expect(retryStep(mark(), HEADING, ['- [ ] #T7 Tune the cache', '- [ ] #T9 New line'], copied('- [ ] #T0008 Tune the cache'))).toBe('changed')
  // Numbering added an ID to the source since: the same lines, IDs aside.
  expect(retryStep(mark({ lines: ['- [ ] Tune the cache'] }), HEADING, ['- [ ] #T0009 Tune the cache'], copied('- [ ] Tune the cache'))).toBe('empty')
  // The copy never landed, or was taken out: copy again. The limit: as many sections as before, none holding a line of the copy, is not a copy.
  // (Batch H2: a section of as many as before that holds the copy's lines is the copy, as when an older section was taken out: only empty.)
  expect(retryStep(mark({ sectionsBefore: 1 }), HEADING, ['- [ ] #T7 Tune the cache'], copied('- [ ] #T7 Other work'))).toBe('copy')
  expect(retryStep(mark({ sectionsBefore: 1 }), HEADING, ['- [ ] #T7 Tune the cache'], copied('- [ ] #T7 Tune the cache'))).toBe('empty')
  expect(retryStep(mark(), HEADING, ['- [ ] #T7 Tune the cache'], '- [ ] #T1 Fix the parser\n')).toBe('copy')
})

test('UCR-014 the stored marks read back whole, and a damaged entry is dropped', () => {
  const good = mark({ told: ['- a: #T7 is now #T0008'], isTold: true, sectionsBefore: 2 })
  const read = readKeptMarks({ '/repo/y/TODO.md': good, bad: { heading: 'h', lines: [1] }, worse: null, odd: { ...good, sectionsBefore: 'x' } })
  expect([...read.keys()]).toEqual(['/repo/y/TODO.md'])
  expect(read.get('/repo/y/TODO.md')).toEqual(good)
  expect(readKeptMarks(null).size).toBe(0)
  expect(readKeptMarks([good]).size).toBe(0)
})

// ---------------------------------------------------------------- batch H2: UCR-014 remainder, UCR-107

/** Property (UCR-014, case 1): with no stored record, a source whose copy the target already holds is never copied a second time. */
test('UCR-014 no record: a section that is the source exactly is only emptied, one equal up to IDs is left', () => {
  const lines = ['- [ ] #T7 Tune the cache']
  // The verifier's X014-B state: the copy is there, word for word, behind the target's own ticket.
  expect(retryStep(undefined, HEADING, lines, copied('- [ ] #T7 Tune the cache'))).toBe('empty')
  // At the limit: the copy is the last section of the file, after an older section of another source, with CRLF.
  const crlf = `- [ ] #T1 x\r\n\r\n## From other/TODO.md\r\n\r\n- [ ] #T3 y\r\n\r\n## From ${HEADING}\r\n\r\n- [ ] #T0008 Tune the cache\r\n`
  expect(retryStep(undefined, HEADING, lines, crlf)).toBe('changed')
  // The excluded population: a section of another heading, or one with other lines, is no copy.
  expect(retryStep(undefined, HEADING, lines, `- [ ] #T1 x\n\n## From other/TODO.md\n\n- [ ] #T7 Tune the cache\n`)).toBe('copy')
  expect(retryStep(undefined, HEADING, lines, copied('- [ ] #T7 Tune the cache\n- [ ] #T8 more'))).toBe('copy')
})

/** Property (UCR-014, case 2): taking an older section of the same heading out never makes the copy look gone. */
test('UCR-014 an older same-heading section taken out between the presses: the copy is still seen, and only emptied', () => {
  // Batch I2: the marks carry the renumbering note a renumbered copy always has (`told`), since a copy is now found by
  // its IDs as written (UCR-014 remainder); with no note the copy would be `#T7` in the target.
  const older = mark({ lines: ['- [ ] #T7 Tune, see #T5'], sectionsBefore: 1, told: [`- ${HEADING}: #T7 is now #T0009`] })
  // The verifier's state: two sections before the press; the older one was taken out, the copy (renumbered) stays.
  expect(retryStep(older, HEADING, older.lines, copied('- [ ] #T0009 Tune, see #T5'))).toBe('empty')
  // At the limit: the copy's only line still there is the last, with its box ticked by Claude.
  expect(retryStep(mark({ lines: ['- [ ] #T7 A', '- [ ] #T8 B'], sectionsBefore: 2, told: [`- ${HEADING}: #T8 is now #T0009`] }), HEADING, ['- [ ] #T7 A', '- [ ] #T8 B'], copied('- [x] #T0009 B'))).toBe('empty')
  // The excluded population: a section left of the same heading that holds no line of the copy (the copy was taken out).
  expect(retryStep(older, HEADING, older.lines, copied('- [x] #T3 old'))).toBe('copy')
})

/** Property (UCR-014, case 3): an edit of the source after its copy, an edit of one ID only included, is never lost. */
test('UCR-014 an edit that changes only an ID in the source leaves it, never empties it', () => {
  const ref = mark({ lines: ['- [ ] #T7 Tune the cache, after #T1'] })
  const target = copied('- [ ] #T7 Tune the cache, after #T1')
  // The verifier's state: `after #T1` became `after #T8`.
  expect(retryStep(ref, HEADING, ['- [ ] #T7 Tune the cache, after #T8'], target)).toBe('changed')
  // At the limit: the last line's own leading ID changed, behind an unchanged first line.
  expect(retryStep(mark({ lines: ['- [ ] #T6 a', '- [ ] #T7 b'] }), HEADING, ['- [ ] #T6 a', '- [ ] #T9 b'], copied('- [ ] #T6 a\n- [ ] #T7 b'))).toBe('changed')
  // The excluded population: an ID numbering put in front of a line (one with none, or one that repeated an ID) is no edit.
  expect(retryStep(mark({ lines: ['- [ ] Tune'] }), HEADING, ['- [ ] #T0009 Tune'], copied('- [ ] Tune'))).toBe('empty')
  expect(retryStep(mark({ lines: ['- [ ] #T5 Tune'] }), HEADING, ['- [ ] #T0009 #T5 Tune'], copied('- [ ] #T5 Tune'))).toBe('empty')
})

/** Property (UCR-107): a store read never puts an older stored copy of the marks over the marks in memory. */
test('UCR-107 mergeMarks keeps the memory marks, adds the stored ones, and never brings back a dropped one', () => {
  const mine = mark({ lines: ['- [ ] #T7 mine'] })
  const theirs = mark({ lines: ['- [ ] #T8 theirs'] })
  // The verifier's state: a save failed, so the store has no mark for the source; memory keeps it.
  expect([...mergeMarks(new Map([['/y', mine]]), new Map(), new Set()).entries()]).toEqual([['/y', mine]])
  // The same source in both: memory wins; another session's mark of another source is added (the last entry).
  expect([...mergeMarks(new Map([['/y', mine]]), new Map([['/y', theirs], ['/z', theirs]]), new Set()).entries()]).toEqual([['/y', mine], ['/z', theirs]])
  // The excluded population: a stored mark this session was done with is not brought back.
  expect(mergeMarks(new Map(), new Map([['/y', theirs]]), new Set(['/y'])).size).toBe(0)
})

// ---------------------------------------------------------------- batch I2: UCR-014 remainder

/**
 * Property: with a mark, the copy is seen only where a section of the heading is the copied lines as
 * written (IDs as renumbered, a box set, an ID numbering added, ticket blocks archived out); a line of
 * an older section that only looks like one of the copy never stands in for it, so the source is never
 * emptied with no copy of it in the target.
 */
test('UCR-014 a loose match in an older same-heading section is no copy: the source is copied again, never lost', () => {
  const copy = mark({ lines: ['- [ ] #T7 Run the tests', '- [ ] #T8 Ship it'], sectionsBefore: 1 })
  // The verifier's P014 state: the user took the new copy out; the older section holds "Run the tests" under another ID.
  expect(retryStep(copy, HEADING, copy.lines, copied('- [x] #T3 Run the tests'))).toBe('copy')
  // At the limit: the older section is the last one and holds both lines, but with other IDs.
  expect(retryStep({ ...copy, sectionsBefore: 2 }, HEADING, copy.lines, `${copied('- [ ] #T0001 old')}\n## From ${HEADING}\n\n- [ ] #T3 Run the tests\n- [ ] #T4 Ship it\n`)).toBe('copy')
  // An edited line in the section: no exact copy, so not taken as one.
  expect(retryStep(copy, HEADING, copy.lines, copied('- [ ] #T7 Run the tests twice\n- [ ] #T8 Ship it'))).toBe('copy')
  // The excluded population: the copy as written, renumbered (the note says so), a box set, and one block archived out.
  const renumbered = mark({ lines: copy.lines, sectionsBefore: 1, told: [`- ${HEADING}: #T7 is now #T0009`] })
  expect(retryStep(renumbered, HEADING, copy.lines, copied('- [x] #T0009 Run the tests\n- [ ] #T8 Ship it'))).toBe('empty')
  expect(retryStep(renumbered, HEADING, copy.lines, copied('- [~] #T8 Ship it'))).toBe('empty')
  // A mark that holds the lines as written (`copied`) is read by them, cross-file renames included.
  const written = mark({ lines: ['- [ ] #T7 Run, after #T2'], sectionsBefore: 1, copied: ['- [ ] #T7 Run, after #T0010'] })
  expect(retryStep(written, HEADING, written.lines, copied('- [ ] #T7 Run, after #T0010'))).toBe('empty')
  expect(retryStep(written, HEADING, written.lines, copied('- [ ] #T7 Run, after #T2'))).toBe('copy')
})

/** Property: with no record, a copy the archive step shortened, or whose box changed, is never copied a second time. */
test('UCR-014 no record: a copy shortened by the archive step or with a changed box is not copied again', () => {
  const lines = ['- [ ] #T7 Run the tests', '  - note under it', '- [ ] #T8 Ship it']
  // The verifier's states: one copied ticket archived out of the section, and a box checked in the copy.
  expect(retryStep(undefined, HEADING, lines, copied('- [ ] #T8 Ship it'))).toBe('changed')
  expect(retryStep(undefined, HEADING, lines, copied('- [x] #T7 Run the tests\n  - note under it\n- [ ] #T8 Ship it'))).toBe('empty')
  // At the limit: the last ticket archived, and a box changed with an ID numbering put in front of a line.
  expect(retryStep(undefined, HEADING, lines, copied('- [ ] #T7 Run the tests\n  - note under it'))).toBe('changed')
  expect(retryStep(undefined, HEADING, ['- [ ] Run the tests'], copied('- [~] #T0009 Run the tests'))).toBe('empty')
  // Renumbered and shortened: left, never copied.
  expect(retryStep(undefined, HEADING, lines, copied('- [ ] #T0012 Ship it'))).toBe('changed')
  // The excluded population: a section with a line the source lacks, or with its ticket's text changed, is no copy.
  expect(retryStep(undefined, HEADING, lines, copied('- [ ] #T8 Ship it\n- [ ] #T9 more'))).toBe('copy')
  expect(retryStep(undefined, HEADING, ['- [ ] #T7 Run'], copied('- [ ] #T7 Walk'))).toBe('copy')
})
