import { expect, test } from 'claude-code/testing'

import { removedNote, renameNote } from '../hooks/claude-notes'
import { appendSections, applyRefRenames, applyRenames, copyLines, isUnsafeHeadingName, itemLines, keepsEveryItem, renameLines, renumberLines, sectionCount, sectionText } from '../hooks/consolidate-text'
import { foldParts, removeDuplicateTickets, renameRefs } from '../hooks/duplicate-tickets'

test('helpers: renumbering, sections, references and the exact-duplicate rule', async () => {
  const used = new Set(['t1', 't2'])
  // A new ID skips the reserved IDs of the files still to come.
  expect(renumberLines(['- [ ] #T1 A'], new Set(['t1']), new Set(['t2', 't3'])).pairs).toEqual([{ from: 'T1', to: 'T0004' }])
  const out = renumberLines(['- [ ] #T1 Docs', '- [x] #T7 Kept', '- [~] No id', '- note, see #T1 and #T7'], used)
  expect(out.lines).toEqual(['- [ ] #T0008 Docs', '- [x] #T7 Kept', '- [~] No id', '- note, see #T0008 and #T7'])
  expect(applyRenames('#T1 and #T10 and #T3', { t1: 'T3', t3: 'T4' })).toBe('#T3 and #T10 and #T4')
  expect(appendSections('', [{ place: 'mods/x', lines: ['- [ ] a'] }])).toBe('## From mods/x\n\n- [ ] a\n')
  expect(appendSections('- [ ] top\n', [{ place: 'a', lines: ['- [ ] b'] }])).toBe('- [ ] top\n\n## From a\n\n- [ ] b\n')
  // moved text is kept as written; only the blank lines at both ends are cut.
  expect(copyLines('\n# A\n\n  note  \n   \n- [ ] x\n\n')).toEqual(['# A', '', '  note  ', '   ', '- [ ] x'])
  expect(itemLines('# T\nprose\n- [ ] one\n  - [x] two')).toEqual(['- [ ] one', '  - [x] two'])
  expect(renameNote([])).toBeUndefined()
  expect(removedNote([])).toBeUndefined()
  expect(foldParts('- [ ] #T1 Fix')?.key).toBe(foldParts('- [ ] #T9 Fix')?.key)
  expect(foldParts('- [ ] see #T1')).toBeUndefined()
  const dup = removeDuplicateTickets(['- [ ] #T1 Fix it', '- [ ] #T2 Fix it', '- [ ] #T3 fix it', '- [x] #T4 Fix it', '- [ ] #T5 Fix  it', '- [ ] #T6 Fix it.', 'after #T2 and #T1'].join('\n'))
  expect(dup.removed).toEqual([{ id: 'T2', kept: 'T1' }])
  expect(dup.map).toEqual({ t2: 'T1' })
  expect(dup.text).toBe(['- [ ] #T1 Fix it', '- [ ] #T3 fix it', '- [x] #T4 Fix it', '- [ ] #T5 Fix  it', '- [ ] #T6 Fix it.', 'after #T1 and #T1'].join('\n'))
  // An ID that a kept ticket owns is never remapped.
  const owned = removeDuplicateTickets('- [ ] #T1 A\n- [ ] #T2 A\n- [ ] #T2 B')
  expect(owned.map).toEqual({})
})

// ---------------------------------------------------------------- (batch G2)

test('a CRLF line keeps its own leading ID: only its references are renamed', () => {
  expect(applyRefRenames('- [x] #T2 Old one, see #T2\r', { t2: 'T1' })).toBe('- [x] #T2 Old one, see #T1\r')
  expect(renameRefs('- [x] #T2 Old one, see #T2\r\nsee #T2\r\n', { t2: 'T1' })).toBe('- [x] #T2 Old one, see #T1\r\nsee #T1\r\n')
  // An LF line as before, and a line that is no ticket.
  expect(applyRefRenames('- [x] #T2 Old one, see #T2', { t2: 'T1' })).toBe('- [x] #T2 Old one, see #T1')
  expect(applyRefRenames('note #T2\r', { t2: 'T1' })).toBe('note #T1\r')
})

test('Consolidate renaming leaves IDs in code fences and HTML comments as they are', () => {
  const lines = ['- [ ] #T1 Docs', '```sh', 'git log --grep "#T1"', '```', '<!-- see #T1 -->', 'see #T1']
  const out = renumberLines(lines, new Set(['t1']))
  expect(out.pairs).toEqual([{ from: 'T1', to: 'T0002' }])
  expect(out.lines).toEqual(['- [ ] #T0002 Docs', '```sh', 'git log --grep "#T1"', '```', '<!-- see #T1 -->', 'see #T0002'])
  // The cross-file map of a folder goes through the same rule; a fence as the last lines, never closed.
  expect(renameLines(['see #T1', '~~~', '#T1'], { t1: 'T0002' })).toEqual(['see #T0002', '~~~', '#T1'])
  expect(renameLines(['see #T1'], {})).toEqual(['see #T1'])
  expect(sectionCount('## From a\n- x\r\n## From a\r\n## From ab', 'a')).toBe(2)
})

// ---------------------------------------------------------------- batch I2: 

/** Property: with a source of claimed IDs, every new `T` ID of the renumbering comes from it, and none is picked outside it. */
test('renumberLines takes each new T ID from the claimed source, never the next one above all IDs', () => {
  const claimed = ['T0040', 'T0041']
  const take = () => claimed.shift()
  // The verifier's state: a clash renames `#T1` to a claimed ID, not to T0002 (one past the highest).
  const out = renumberLines(['- [ ] #T1 Tune the cache', '- see #T1'], new Set(['t1']), new Set(), take)
  expect(out.lines).toEqual(['- [ ] #T0040 Tune the cache', '- see #T0040'])
  // At the limit: the second clash takes the last claimed ID; other letters keep their own rule and take none.
  const two = renumberLines(['- [ ] #T2 a', '- [ ] #PROJ1 b'], new Set(['t2', 'proj1']), new Set(), take)
  expect(two.pairs).toEqual([{ from: 'T2', to: 'T0041' }, { from: 'PROJ1', to: 'PROJ2' }])
  // The excluded population: a source that runs dry throws, never falls back to an unclaimed pick.
  expect(() => renumberLines(['- [ ] #T3 c'], new Set(['t3']), new Set(), take)).toThrow('no claimed ticket ID left')
  // Without a source (the count of a dry run), the old rule: one past the highest.
  expect(renumberLines(['- [ ] #T3 c'], new Set(['t3'])).pairs).toEqual([{ from: 'T3', to: 'T0004' }])
})

// ---------------------------------------------------------------- batch K3: remainder (names in headings, the item check)

/** Property: a name that would break its `## From` heading over lines is told apart from every name that cannot. */
test('VJ-170N isUnsafeHeadingName refuses line breaks and control characters, and sectionText never writes one', () => {
  // The verifier's names, a carriage return, Unicode line and paragraph separators, NEL, a NUL at the end of the name.
  for (const name of ['mods/x/a\n- [ ] #T5 Ghost\n<!--.md', 'mods/y\n- [ ] #T5 Ghost\n<!--/TODO.md', 'a\r- [ ] #T5.md', 'a b.md', 'a b.md', 'a\u0085b.md', 'TODO.md\u0000']) {
    expect(isUnsafeHeadingName(name)).toBe(true)
    expect(() => sectionText(name, ['- [ ] #T1 x'], '\n')).toThrow()
  }
  // The excluded population: names with spaces, Unicode letters, a comment marker on the one line, are fine.
  for (const name of ['mods/x/My File.md', 'mods/été/TODO.md', 'a <!-- b.md', 'the root of another checkout/TODO.md']) {
    expect(isUnsafeHeadingName(name)).toBe(false)
  }
  expect(sectionText('mods/x/TODO.md', ['- [ ] #T1 x'], '\n')).toBe('## From mods/x/TODO.md\n\n- [ ] #T1 x\n')
})

/** Property: the end check passes only a result whose items are the target's and then every section's, in order, by text and box. */
test('keepsEveryItem refuses a lost item that an added one hides from the count', () => {
  const now = '- [ ] #T1 Fix'
  const sections = [{ place: 'mods/x/TODO.md', lines: ['- [ ] #T2 Docs'] }]
  expect(keepsEveryItem(now, appendSections(now, sections), sections)).toBe(true)
  // Behind a valid first item: the verifier's state, the count is right (2 = 1 + 1) but #T2 is lost and a ghost added.
  expect(keepsEveryItem(now, '- [ ] #T1 Fix\n\n## From mods/x/a\n- [ ] #T5 Ghost\n<!--.md\n\n- [ ] #T2 Docs\n', sections)).toBe(false)
  // At the limit: the last item of the last section with another box.
  const two = [...sections, { place: 'mods/y/TODO.md', lines: ['- [ ] #T3 Tests'] }]
  expect(keepsEveryItem(now, appendSections(now, two).replace('- [ ] #T3', '- [x] #T3'), two)).toBe(false)
  // Inside the target: one of its own items changed, the sections all there.
  expect(keepsEveryItem(now, appendSections('- [ ] #T1 Fixed', sections), sections)).toBe(false)
  // A CRLF target keeps every item.
  expect(keepsEveryItem('- [ ] #T1 Fix\r\n', appendSections('- [ ] #T1 Fix\r\n', sections), sections)).toBe(true)
})

// ---------------------------------------------------------------- batch L3: (format characters)

/** Property: a name with a Unicode format character (a bidi override, a zero-width joiner) never stands in a `## From` heading. */
test('L3R3-170X isUnsafeHeadingName refuses format characters', () => {
  // The probe's name (U+202E and U+200D); a format character at the start (U+FEFF); one at the end (U+2066).
  for (const name of ['mods/x/a‮evil‍.md', '﻿TODO.md', 'TODO.md⁦']) {
    expect(isUnsafeHeadingName(name)).toBe(true)
    expect(() => sectionText(name, ['- [ ] #T1 x'], '\n')).toThrow()
  }
  // The excluded population: letters of other scripts, combining marks and emoji-free symbols stay fine.
  for (const name of ['mods/عربي/TODO.md', 'mods/éte/TODO.md', 'mods/x/a-b_c (1).md']) {
    expect(isUnsafeHeadingName(name)).toBe(false)
  }
})
