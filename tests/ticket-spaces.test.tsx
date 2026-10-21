import { expect, test } from 'claude-code/testing'

import { clearSpaces, columnSlots, expireSpaces, MAX_SPACES, newLayout, pressKeepsSpaces, SPACE_MS } from '../hooks/ticket-spaces'

// ---------------------------------------------------------------- stable layout when a ticket leaves

const ids = (slots: readonly { id: string; isSpace?: true }[]) => slots.map(slot => (slot.isSpace === true ? 'space' : slot.id))
const entries3 = [{ id: 'a', h: 100 }, { id: 'b', h: 140 }, { id: 'c', h: 100 }]

test('a ticket that leaves a column keeps an empty space of its height in its place', async () => {
  const layout = newLayout()
  expect(ids(columnSlots(layout, 'progress', 'w', entries3, 0))).toEqual(['a', 'b', 'c'])
  const slots = columnSlots(layout, 'progress', 'w', [entries3[0]!, entries3[2]!], 1000)
  expect(ids(slots)).toEqual(['a', 'space', 'c'])
  expect(slots[1]?.h).toBe(140)
  // The same data drawn again changes nothing, and makes no second space.
  expect(ids(columnSlots(layout, 'progress', 'w', [entries3[0]!, entries3[2]!], 2000))).toEqual(['a', 'space', 'c'])
  expect(layout.spaces.length).toBe(1)
  // A second ticket leaves: its space joins the first.
  expect(ids(columnSlots(layout, 'progress', 'w', [entries3[0]!], 3000))).toEqual(['a', 'space', 'space'])
  // Another column is untouched, and a new width forgets the spaces of a column.
  expect(ids(columnSlots(layout, 'open', 'w', [{ id: 'x', h: 90 }], 3000))).toEqual(['x'])
  expect(ids(columnSlots(layout, 'progress', 'narrow', [entries3[0]!], 4000))).toEqual(['a'])
})

test('the next press of any control clears the spaces; a ticket button keeps what was drawn so the ticket it moves leaves one', async () => {
  const layout = newLayout()
  columnSlots(layout, 'progress', 'w', entries3, 0)
  columnSlots(layout, 'progress', 'w', [entries3[0]!, entries3[2]!], 10)
  expect(clearSpaces(layout, false)).toBe(true)
  expect(layout.spaces.length).toBe(0)
  expect(ids(columnSlots(layout, 'progress', 'w', [entries3[0]!, entries3[2]!], 20))).toEqual(['a', 'c'])
  expect(clearSpaces(layout, false)).toBe(false)
  columnSlots(layout, 'progress', 'w', [entries3[0]!, entries3[2]!], 25)
  // A ticket button: spaces go, the drawn list stays, so the move it makes leaves a space.
  clearSpaces(layout, true)
  expect(ids(columnSlots(layout, 'progress', 'w', [entries3[0]!], 30))).toEqual(['a', 'space'])
})

test('a space goes 60 seconds after its ticket left', async () => {
  const layout = newLayout()
  columnSlots(layout, 'progress', 'w', entries3, 0)
  columnSlots(layout, 'progress', 'w', [entries3[0]!, entries3[2]!], 5000)
  expect(SPACE_MS).toBe(60_000)
  expect(expireSpaces(layout, 5000 + SPACE_MS - 1)).toBe(false)
  expect(layout.spaces.length).toBe(1)
  expect(expireSpaces(layout, 5000 + SPACE_MS)).toBe(true)
  expect(ids(columnSlots(layout, 'progress', 'w', [entries3[0]!, entries3[2]!], 66_000))).toEqual(['a', 'c'])
})

test('never more than 10 spaces: the oldest go first, and the rest keep their places', async () => {
  const layout = newLayout()
  const all = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, h: 100 + i }))
  columnSlots(layout, 'progress', 'w', all, 0)
  let left = all
  // The tickets leave one by one, from the front: t0 first.
  for (let k = 0; k < 12; k += 1) {
    left = left.slice(1)
    columnSlots(layout, 'progress', 'w', left, 1000 + k)
  }
  expect(MAX_SPACES).toBe(10)
  expect(layout.spaces.length).toBe(10)
  const slots = columnSlots(layout, 'progress', 'w', left, 2000)
  expect(slots.filter(slot => slot.isSpace === true).length).toBe(10)
  // The two oldest (t0, t1) are gone: the spaces held are those of t2 to t11, in their order.
  expect(slots.filter(slot => slot.isSpace === true).map(slot => slot.h)).toEqual(Array.from({ length: 10 }, (_, i) => 102 + i))
  expect(ids(slots).slice(10)).toEqual(['t12', 't13'])
  // Across columns the cap is shared.
  columnSlots(layout, 'open', 'w', [{ id: 'p', h: 50 }, { id: 'q', h: 50 }], 3000)
  columnSlots(layout, 'open', 'w', [], 3001)
  expect(layout.spaces.length).toBe(10)
})

// ---------------------------------------------------------------- loop 2, batch J5

test('a ticket that comes back within SPACE_MS takes its place again: its space goes', () => {
  const entries = [{ id: 'a', h: 100 }, { id: 'b', h: 140 }, { id: 'c', h: 100 }]
  // State 1 (the defect behind a valid first case): b leaves in the middle and returns at once.
  const layout = newLayout()
  columnSlots(layout, 'open', 'w', entries, 0)
  expect(ids(columnSlots(layout, 'open', 'w', [entries[0]!, entries[2]!], 1000))).toEqual(['a', 'space', 'c'])
  expect(ids(columnSlots(layout, 'open', 'w', entries, 2000))).toEqual(['a', 'b', 'c'])
  expect(layout.spaces.length).toBe(0)
  // State 2 (the limit): it returns at the last ms before the space would expire.
  columnSlots(layout, 'open', 'w', [entries[0]!, entries[2]!], 3000)
  expect(ids(columnSlots(layout, 'open', 'w', entries, 3000 + SPACE_MS - 1))).toEqual(['a', 'b', 'c'])
  expect(layout.spaces.length).toBe(0)
  // State 3 (the population the fix excludes): a flip every 2 s holds no more than the one space, and ends with none.
  const flip = newLayout()
  columnSlots(flip, 'open', 'w', entries, 0)
  for (let k = 1; k <= 12; k += 1) {
    const slots = columnSlots(flip, 'open', 'w', k % 2 === 1 ? [entries[0]!, entries[2]!] : entries, k * 2000)
    expect(slots.reduce((sum, slot) => sum + slot.h, 0)).toBe(340)
    expect(flip.spaces.length).toBe(k % 2 === 1 ? 1 : 0)
  }
  // A ticket that stays away keeps its space, and another column's space is not touched by a ticket of the same ID.
  const apart = newLayout()
  columnSlots(apart, 'open', 'w', entries, 0)
  columnSlots(apart, 'progress', 'w', entries, 0)
  columnSlots(apart, 'open', 'w', [entries[0]!, entries[2]!], 10)
  columnSlots(apart, 'progress', 'w', [entries[0]!, entries[2]!], 10)
  expect(ids(columnSlots(apart, 'open', 'w', entries, 20))).toEqual(['a', 'b', 'c'])
  expect(apart.spaces.length).toBe(1)
  expect(apart.spaces[0]?.col).toBe('progress')
})

// ---------------------------------------------------------------- no press moves the cards under the reader

const GLYPHS: ReadonlySet<string> = new Set(['◐', '✓', '⋙'])

test('a ticket button and a press that changes nothing on the board keep the spaces; a press that changes the board clears them', () => {
  // A ticket's own button, by its glyph, whatever its key.
  expect(pressKeepsSpaces('ticket-start-TODO.md-#T1', '◐', GLYPHS)).toBe(true)
  expect(pressKeepsSpaces(undefined, '✓', GLYPHS)).toBe(true)
  // The presses that change nothing on the board.
  for (const key of ['room-toggle', 'orchestrator-newer', 'orchestrator-older', 'orchestrator-latest', 'agents-toggle', 'todo-show-completed', 'agent-stop-a41802afbc61e3ed6']) {
    expect(pressKeepsSpaces(key, 'any label', GLYPHS)).toBe(true)
  }
  // The presses that change the board: a filter, a view switch, a sort, Show all, a cleared search.
  for (const key of ['todo-tickets', 'todo-order', 'todo-sort', 'category-toggle-Docs', 'search-clear', 'file-toggle-TODO.md', 'file-text-TODO.md', 'todo-recategorize', 'todo-consolidate']) {
    expect(pressKeepsSpaces(key, 'Show as tickets', GLYPHS)).toBe(false)
  }
  // No key and no glyph: the board may change, so it reflows.
  expect(pressKeepsSpaces(undefined, 'Show as list', GLYPHS)).toBe(false)
  // A key that only starts like a kept one is not kept.
  expect(pressKeepsSpaces('room-toggle-x', 'x', GLYPHS)).toBe(false)
  expect(pressKeepsSpaces('agent-sto', 'x', GLYPHS)).toBe(false)
})

test('a second ticket press keeps the first ticket\'s space, so the cards below it do not move up at the press', () => {
  const layout = newLayout()
  const all = [{ id: 'a', h: 100 }, { id: 'b', h: 140 }, { id: 'c', h: 100 }, { id: 'd', h: 90 }]
  const height = (slots: readonly { h: number }[]) => slots.reduce((sum, slot) => sum + slot.h, 0)
  columnSlots(layout, 'open', 'w', all, 0)
  // a is started: its space holds its place.
  expect(ids(columnSlots(layout, 'open', 'w', all.slice(1), 1000))).toEqual(['space', 'b', 'c', 'd'])
  // c is started 10 s later: the press keeps a's space (no clearSpaces call), so b, c and d stay where they were.
  expect(pressKeepsSpaces('ticket-start-TODO.md-c', '◐', GLYPHS)).toBe(true)
  const after = columnSlots(layout, 'open', 'w', [all[1]!, all[3]!], 11_000)
  expect(ids(after)).toEqual(['space', 'b', 'space', 'd'])
  expect(height(after)).toBe(height(all))
  // Each space still goes SPACE_MS after its own ticket left.
  expect(expireSpaces(layout, 1000 + SPACE_MS)).toBe(true)
  expect(ids(columnSlots(layout, 'open', 'w', [all[1]!, all[3]!], 1000 + SPACE_MS))).toEqual(['b', 'space', 'd'])
})

test('a ticket that went up to a column drawn above leaves no space, so the cards from its place down stay put', () => {
  const layout = newLayout()
  const open = [{ id: 'a', h: 100 }, { id: 'b', h: 140 }, { id: 'c', h: 100 }, { id: 'd', h: 100 }]
  columnSlots(layout, 'open', 'w', open, 0)
  // 'a' left for another column, as before: it keeps its space.
  expect(ids(columnSlots(layout, 'open', 'w', open.slice(1), 10))).toEqual(['space', 'b', 'c', 'd'])
  // 'c' went up to In progress, drawn above: no space for it, and the held space of 'a' keeps its place.
  const slots = columnSlots(layout, 'open', 'w', [open[1]!, open[3]!], 20, new Set(['c']))
  expect(ids(slots)).toEqual(['space', 'b', 'd'])
  expect(layout.spaces.length).toBe(1)
})

test('a held space after the ticket that went up moves up one place with the cards', () => {
  const layout = newLayout()
  const open = [{ id: 'a', h: 100 }, { id: 'b', h: 140 }, { id: 'c', h: 100 }]
  columnSlots(layout, 'open', 'w', open, 0)
  expect(ids(columnSlots(layout, 'open', 'w', [open[0]!, open[1]!], 10))).toEqual(['a', 'b', 'space'])
  expect(ids(columnSlots(layout, 'open', 'w', [open[1]!], 20, new Set(['a'])))).toEqual(['b', 'space'])
})
