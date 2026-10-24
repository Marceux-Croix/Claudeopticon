import { expect, test } from 'claude-code/testing'

import { movesNote } from '../hooks/claude-notes'
import { itemKey } from '../hooks/item-keys'
import { drawnPlaces, isDrawnLine, linePlaces, setBox, statusNamed, textSum } from '../hooks/ticket-boxes'
import { parseTodo } from '../hooks/todo-markdown'

test('setBox sets one item\'s box by its key, and leaves the rest of the file as it was', async () => {
  const file = '# Plan\n\n- [ ] #T1 First\n- [ ] **Second** thing\nprose\n- [~] #T3 Third'
  expect(setBox(file, '#t1', 'in_progress')).toBe('# Plan\n\n- [~] #T1 First\n- [ ] **Second** thing\nprose\n- [~] #T3 Third')
  expect(setBox(file, itemKey({ text: 'Second thing' }), 'completed')).toContain('- [x] **Second** thing')
  expect(setBox(file, '#t3', 'pending')).toContain('- [ ] #T3 Third')
  expect(setBox(file, '#t3', 'in_progress')).toBeUndefined()
  expect(setBox(file, '#t9', 'completed')).toBeUndefined()
  expect(movesNote([])).toBeUndefined()
  expect(movesNote(['- "First": open -> in progress'])).toContain('Do not act on it')
})

// ---------------------------------------------------------------- remainder

/**
 * Property: a press writes only the line the board drew: the line its key names must still have the
 * text and box the board drew, so a press from an out-of-date board never writes the neighbor line.
 */
test('a press from an out-of-date board is refused: the keyed line must have the drawn text and box', () => {
  const before = '- [ ] Fix it\n- [~] Fix it\n- [ ] Fix it'
  const after = '- [~] Fix it\n- [ ] Fix it'
  const drawn = parseTodo(before)
  const second = { key: itemKey(drawn[1]!), drawn: { text: drawn[1]!.text, status: drawn[1]!.status } }
  // The P025 state: the first line went, the board still shows the old second line (`[~]`).
  expect(isDrawnLine(after, second.key, second.drawn)).toBe(false)
  expect(setBox(after, second.key, 'completed', second.drawn)).toBeUndefined()
  // At the limit: the last line of the drawn board, after a line was added above every identical one.
  const third = { key: itemKey(drawn[2]!), drawn: { text: drawn[2]!.text, status: drawn[2]!.status } }
  const grown = `- [x] Fix it\n${before}`
  expect(isDrawnLine(grown, third.key, third.drawn)).toBe(false)
  // A changed text under an ID key is refused too.
  expect(isDrawnLine('- [ ] #T5 Fix it now', '#t5', { text: '#T5 Fix it', status: 'pending' })).toBe(false)
  // The excluded population: the board is current, so the press writes the line it drew.
  expect(isDrawnLine(before, second.key, second.drawn)).toBe(true)
  expect(setBox(before, second.key, 'completed', second.drawn)).toBe('- [ ] Fix it\n- [x] Fix it\n- [ ] Fix it')
  // A key no line has is no drawn line.
  expect(isDrawnLine(after, 'gone', { text: 'gone', status: 'pending' })).toBe(false)
})

// ---------------------------------------------------------------- remainder (sections)

/**
 * Property: identical lines with the same box in two sections are told apart by their place (the
 * heading above and the rank under it), so a press from an out-of-date board never writes the line
 * of another section.
 */
test('a stale press on identical lines in two sections is refused by the line place', () => {
  const before = '- [ ] Write tests\n## Frontend\n- [ ] Write tests\n  - note: jest\n## Backend\n- [ ] Write tests\n  - note: pytest'
  const drawn = parseTodo(before)
  const places = linePlaces(before)
  const frontend = { key: itemKey(drawn[1]!), drawn: { text: drawn[1]!.text, status: drawn[1]!.status, place: places.get(itemKey(drawn[1]!))! } }
  // The HI-025 state, behind a valid first line: the top line went, the stale key now names the Backend line.
  const after = before.split('\n').slice(1).join('\n')
  expect(isDrawnLine(after, frontend.key, frontend.drawn)).toBe(false)
  expect(setBox(after, frontend.key, 'completed', frontend.drawn)).toBeUndefined()
  // At the limit: the last line of the file, after a line was added above every identical one.
  const backend = { key: itemKey(drawn[2]!), drawn: { text: drawn[2]!.text, status: drawn[2]!.status, place: places.get(itemKey(drawn[2]!))! } }
  expect(isDrawnLine(`- [ ] Write tests\n${before}`, backend.key, backend.drawn)).toBe(false)
  // Inside one section: the key of the second of two identical lines now names a line under another heading.
  const one = '## Core\n- [ ] Fix it\n- [ ] Fix it'
  const second = parseTodo(one)[1]!
  const sameSection = { text: second.text, status: second.status, place: linePlaces(one).get(itemKey(second))! }
  expect(isDrawnLine('## Core\n- [ ] Fix it\n## Other\n- [ ] Fix it', itemKey(second), sameSection)).toBe(false)
  // The excluded population: a current board writes the drawn line; a heading in a code fence or comment is no heading.
  expect(setBox(before, frontend.key, 'completed', frontend.drawn)).toBe(before.replace('## Frontend\n- [ ]', '## Frontend\n- [x]'))
  // Compared with the place under `## A` alone: the place's form changed later (heading path, occurrence, count).
  expect(linePlaces('## A\n```\n## B\n```\n- [ ] Fix').get('fix')).toBe(linePlaces('## A\n- [ ] Fix').get('fix'))
  expect(linePlaces('## A\n<!--\n## B\n-->\n- [ ] Fix').get('fix')).toBe(linePlaces('## A\n- [ ] Fix').get('fix'))
  // A board with no place (no scan read of the file) checks text and box alone, as before.
  expect(isDrawnLine(after, frontend.key, { text: frontend.drawn.text, status: frontend.drawn.status })).toBe(true)
})

test('statusNamed takes only open, queued, in_progress and done, never an Object prototype key', () => {
  expect([statusNamed('open'), statusNamed('queued'), statusNamed('in_progress'), statusNamed('done')]).toEqual(['pending', 'queued', 'in_progress', 'completed'])
  // State 1: the keys every plain object inherits.
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
    expect([key, statusNamed(key)]).toEqual([key, undefined])
  }
  // State 2: at the edge of a real name: case, padding and a status word of the file.
  for (const key of ['Open', ' done', 'done ', 'completed', 'pending', '']) {
    expect([key, statusNamed(key)]).toEqual([key, undefined])
  }
  // State 3: no string at all.
  for (const key of [undefined, null, 1, {}, ['done']]) {
    expect(statusNamed(key)).toBeUndefined()
  }
})

test('setBox writes the queued box [>], and from it any other box', () => {
  const text = '- [ ] #T1 a\n- [~] #T2 b'
  const queued = setBox(text, '#t1', 'queued')
  expect(queued).toBe('- [>] #T1 a\n- [~] #T2 b')
  expect(parseTodo(queued!)[0]?.status).toBe('queued')
  expect(setBox(queued!, '#t1', 'queued')).toBeUndefined()
  expect(setBox(queued!, '#t1', 'in_progress')).toBe('- [~] #T1 a\n- [~] #T2 b')
  expect(setBox(setBox(text, '#t2', 'queued')!, '#t2', 'pending')).toBe('- [ ] #T1 a\n- [ ] #T2 b')
})

// ---------------------------------------------------------------- remainder (same heading text, prose labels)

/** The key and the drawn state of item `n` of `text`, as the board keeps them after a scan. */
const drawnOf = (text: string, n: number) => {
  const item = parseTodo(text)[n]!

  return { key: itemKey(item), drawn: { text: item.text, status: item.status, place: linePlaces(text).get(itemKey(item))! } }
}

/**
 * Property: a press from an out-of-date board never writes another section's identical line, also
 * when the two sections have the same heading text or are marked only by prose lines.
 */
test('VJ-025a two sections with the same heading text: a stale press is refused', () => {
  const before = '## Tasks\n- [ ] Write tests\n  - note: jest\n## Tasks\n- [ ] Write tests\n  - note: pytest'
  const first = drawnOf(before, 0)
  const after = '## Tasks\n## Tasks\n- [ ] Write tests\n  - note: pytest'
  expect(isDrawnLine(after, first.key, first.drawn)).toBe(false)
  expect(setBox(after, first.key, 'in_progress', first.drawn)).toBeUndefined()
  // At the limit: the same heading text under two parents of a nested path, the last line of the file.
  const nested = '# A\n## Tasks\n- [ ] Write tests\n# B\n## Tasks\n- [ ] Write tests'
  const nestedFirst = drawnOf(nested, 0)
  expect(isDrawnLine('# A\n## Tasks\n# B\n## Tasks\n- [ ] Write tests', nestedFirst.key, nestedFirst.drawn)).toBe(false)
  // Three sections of one name, the middle line gone: the key of the second now names the third's line.
  const three = '## T\n- [ ] X\n## T\n- [ ] X\n## T\n- [ ] X'
  const second = drawnOf(three, 1)
  expect(isDrawnLine('## T\n- [ ] X\n## T\n## T\n- [ ] X', second.key, second.drawn)).toBe(false)
  // The excluded population: a current board writes the drawn line.
  expect(setBox(before, first.key, 'in_progress', first.drawn)).toBe(before.replace('- [ ] Write tests', '- [~] Write tests'))
})

test('VJ-025b sections marked by prose lines: a stale press is refused when the count of identical lines changed', () => {
  const before = 'Frontend:\n- [ ] Write tests\nBackend:\n- [ ] Write tests'
  const first = drawnOf(before, 0)
  // The first line went: the stale key names the Backend line.
  expect(isDrawnLine('Frontend:\nBackend:\n- [ ] Write tests', first.key, first.drawn)).toBe(false)
  expect(setBox('Frontend:\nBackend:\n- [ ] Write tests', first.key, 'in_progress', first.drawn)).toBeUndefined()
  // At the limit: an identical line added at the top of the file, above a line that was unique.
  const unique = drawnOf('Backend:\n- [ ] Write tests', 0)
  expect(isDrawnLine('- [ ] Write tests\nBackend:\n- [ ] Write tests', unique.key, unique.drawn)).toBe(false)
  // Identical lines with different boxes: the first gone, the key now names a line with the drawn box again.
  const mixed = drawnOf('A:\n- [ ] Fix\nB:\n- [x] Fix\nC:\n- [ ] Fix', 0)
  expect(isDrawnLine('A:\nB:\n- [ ] Fix\nC:\n- [x] Fix', mixed.key, mixed.drawn)).toBe(false)
  // The excluded population: a unique line keeps its place through an edit elsewhere, and a box set on one of two
  // identical lines leaves the other pressable.
  expect(isDrawnLine('Backend:\n- [ ] Other\n- [ ] Write tests', unique.key, unique.drawn)).toBe(true)
  const second = drawnOf(before, 1)
  expect(setBox(before.replace('- [ ] Write tests', '- [~] Write tests'), second.key, 'in_progress', second.drawn)).toBe('Frontend:\n- [~] Write tests\nBackend:\n- [~] Write tests')
})

// ---------------------------------------------------------------- 

/** What the board keeps for the nth item of a text: its key, and the drawn item with the place and hash of `drawnPlaces`. */
const keptOf = (text: string, n: number) => {
  const item = parseTodo(text)[n]!

  return { key: itemKey(item), drawn: { text: item.text, status: item.status, ...drawnPlaces(text).get(itemKey(item))! } }
}

/**
 * Property: a press on a line with no ID that shares its key is refused when the text the
 * board read changed, also when the count and the rank of the identical lines stayed the same.
 */
test('L3R3-025m one identical line moved under prose labels, count unchanged: the stale press is refused', () => {
  // The defect behind a valid first case (prose labels, the first moved to the end).
  const before = 'Frontend:\n- [ ] Write tests\nBackend:\n- [ ] Write tests'
  const first = keptOf(before, 0)
  expect(first.drawn.sum).toBe(textSum(before))
  const moved = 'Frontend:\nBackend:\n- [ ] Write tests\nInfra:\n- [ ] Write tests'
  expect(isDrawnLine(moved, first.key, first.drawn)).toBe(false)
  expect(setBox(moved, first.key, 'in_progress', first.drawn)).toBeUndefined()
  // The place alone cannot tell (the count, the rank and the neighbors stay): the first of twins between the same
  // labels deleted, and a copy added at the end. Only the hash of the text refuses the stale press.
  const twins = 'A:\n- [ ] W\nB:\nA:\n- [ ] W\nB:'
  const top = keptOf(twins, 0)
  const shifted = 'A:\nB:\nA:\n- [ ] W\nB:\nA:\n- [ ] W\nB:'
  expect(linePlaces(shifted).get(top.key)).toBe(top.drawn.place)
  expect(isDrawnLine(shifted, top.key, top.drawn)).toBe(false)
  // Same heading text, one moved down: the count and the rank are the same, the text is not.
  const same = keptOf('## Tasks\n- [ ] Write tests\n## Tasks\n- [ ] Write tests', 0)
  expect(isDrawnLine('## Tasks\n## Tasks\n- [ ] Write tests\n- [ ] Write tests', same.key, same.drawn)).toBe(false)
  // At the limit: one character changed at the end of the file.
  expect(isDrawnLine(`${before}.`, first.key, first.drawn)).toBe(false)
  // The excluded population: no hash for a line with an ID or a unique line, so an edit elsewhere does not refuse
  // them; and a box set on one of two identical lines leaves the other pressable (the hash reads every box as open).
  expect(keptOf('- [ ] #T1 Fix\n- [ ] Docs', 0).drawn.sum).toBeUndefined()
  expect(keptOf('- [ ] #T1 Fix\n- [ ] Docs', 1).drawn.sum).toBeUndefined()
  const second = keptOf(before, 1)
  expect(setBox(before.replace('- [ ] Write tests', '- [~] Write tests'), second.key, 'in_progress', second.drawn)).toBe('Frontend:\n- [~] Write tests\nBackend:\n- [~] Write tests')
  expect(isDrawnLine(before, first.key, first.drawn)).toBe(true)
})

/**
 * Property: a key unique in the file, when drawn and now, needs no place: a parent heading
 * added above it never refuses the press. A key that was or is shared still does.
 */
test('L3R3-8b a parent heading added above a unique ticket does not refuse its press', () => {
  const two = keptOf('## Work\n- [ ] #T1 Fix\n- [ ] #T2 Docs', 1)
  expect(isDrawnLine('# Project\n## Work\n- [ ] #T1 Fix\n- [ ] #T2 Docs', two.key, two.drawn)).toBe(true)
  expect(setBox('# Project\n## Work\n- [ ] #T1 Fix\n- [ ] #T2 Docs', two.key, 'in_progress', two.drawn)).toBe('# Project\n## Work\n- [ ] #T1 Fix\n- [~] #T2 Docs')
  // A key that is no longer unique (an identical line added above) still checks the place.
  const lone = keptOf('Backend:\n- [ ] Write tests', 0)
  expect(isDrawnLine('- [ ] Write tests\nBackend:\n- [ ] Write tests', lone.key, lone.drawn)).toBe(false)
  // A key that was shared and is unique now still checks the place (VJ-025a: one of two lines went).
  const shared = keptOf('## Tasks\n- [ ] Write tests\n  - note: jest\n## Tasks\n- [ ] Write tests\n  - note: pytest', 0)
  expect(isDrawnLine('## Tasks\n## Tasks\n- [ ] Write tests\n  - note: pytest', shared.key, shared.drawn)).toBe(false)
})

// ---------------------------------------------------------------- remainder (identical lines reordered)

/**
 * Property: a press from an out-of-date board never writes another of identical lines, also when they were
 * reordered with the same count (two blocks swapped, or one deleted and a copy added): a line with identical twins
 * is pressed only while the lines drawn around it (the previous and next non-blank lines) still match. The
 * p025 states.
 */
test('identical lines reordered with the same count: a stale press is refused by the drawn neighbors', () => {
  const labels = 'Frontend:\n- [ ] Write tests\n  - note: jest\nBackend:\n- [ ] Write tests\n  - note: pytest'
  const first = drawnOf(labels, 0)
  // The states: prose labels with the two blocks swapped; one heading with the two blocks swapped.
  const swapped = 'Backend:\n- [ ] Write tests\n  - note: pytest\nFrontend:\n- [ ] Write tests\n  - note: jest'
  expect(isDrawnLine(swapped, first.key, first.drawn)).toBe(false)
  expect(setBox(swapped, first.key, 'in_progress', first.drawn)).toBeUndefined()
  const tasks = '## Tasks\n- [ ] Write tests\n  - note: jest\n- [ ] Write tests\n  - note: pytest'
  const firstTask = drawnOf(tasks, 0)
  expect(setBox('## Tasks\n- [ ] Write tests\n  - note: pytest\n- [ ] Write tests\n  - note: jest', firstTask.key, 'in_progress', firstTask.drawn)).toBeUndefined()
  // Behind a valid first case: the first block deleted and a copy added at the end (the count stays 2).
  const copied = 'Backend:\n- [ ] Write tests\n  - note: pytest\nQA:\n- [ ] Write tests\n  - note: e2e'
  expect(setBox(copied, first.key, 'in_progress', first.drawn)).toBeUndefined()
  // At the limit: the twins as the first and the last line of the file, swapped with their only neighbors.
  const ends = '- [ ] X\nA\nB\n- [ ] X'
  const last = drawnOf(ends, 1)
  expect(isDrawnLine('- [ ] X\nB\nA\n- [ ] X', last.key, last.drawn)).toBe(false)
  // The excluded population: a current board writes the drawn line; blank lines and the twin's own box around a line
  // are no change; a unique line has no neighbors in its place, so an edit next to it never refuses it.
  expect(setBox(labels, first.key, 'in_progress', first.drawn)).toBe(labels.replace('- [ ] Write tests', '- [~] Write tests'))
  expect(isDrawnLine(labels.replace('Backend:', '\nBackend:'), drawnOf(labels, 1).key, drawnOf(labels, 1).drawn)).toBe(true)
  const pair = '- [ ] Y\n- [ ] Y'
  const top = drawnOf(pair, 0)
  expect(setBox('- [ ] Y\n- [x] Y', top.key, 'in_progress', top.drawn)).toBe('- [~] Y\n- [x] Y')
  const unique = drawnOf('Backend:\n- [ ] Only once\n  - note', 0)
  expect(isDrawnLine('Changed label:\n- [ ] Only once\n  - other note', unique.key, unique.drawn)).toBe(true)
})

/** Property: a heading with up to 3 spaces of indent is a heading for the place of a line, and one with 4 is code; the archive reads the same headings. */
test('linePlaces reads an indented heading as a section, and a 4-space line as code', () => {
  const indented = linePlaces('## A\n   ## B\n- [ ] Fix').get('fix')!
  expect(indented).toContain('## B')
  expect(indented).not.toBe(linePlaces('## A\n- [ ] Fix').get('fix'))
  expect(linePlaces('## A\n    ## B\n- [ ] Fix').get('fix')).toBe(linePlaces('## A\n- [ ] Fix').get('fix'))
  expect(linePlaces('## A\n####### seven\n- [ ] Fix').get('fix')).toBe(linePlaces('## A\n- [ ] Fix').get('fix'))
  // A heading with no text counts.
  expect(linePlaces('#\n- [ ] Fix').get('fix')).not.toBe(linePlaces('- [ ] Fix').get('fix'))
})
