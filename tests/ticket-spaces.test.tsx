import { expect, test } from 'claude-code/testing'

import { beginRender, clearSpaces, columnSlots, expireSpaces, MAX_SPACES, newLayout, pressKeepsSpaces, SPACE_MS } from '../hooks/ticket-spaces'

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

// ---------------------------------------------------------------- more cases

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

test('a press that changes nothing on the list keeps the spaces; a press that changes the view clears them', () => {
  // The presses that change nothing on the board.
  for (const key of ['room-toggle', 'orchestrator-newer', 'orchestrator-older', 'orchestrator-latest', 'agents-toggle', 'todo-show-completed', 'agent-stop-a41802afbc61e3ed6']) {
    expect(pressKeepsSpaces(key)).toBe(true)
  }
  // The presses that change the board: a filter, a view switch, a sort, Show all, a cleared search.
  for (const key of ['todo-tickets', 'todo-order', 'todo-sort', 'category-toggle-Docs', 'search-clear', 'file-toggle-TODO.md', 'file-text-TODO.md', 'todo-recategorize', 'todo-consolidate']) {
    expect(pressKeepsSpaces(key)).toBe(false)
  }
  // No key: the view may change, so it reflows.
  expect(pressKeepsSpaces(undefined)).toBe(false)
  // A key that only starts like a kept one is not kept.
  expect(pressKeepsSpaces('room-toggle-x')).toBe(false)
  expect(pressKeepsSpaces('agent-sto')).toBe(false)
})

test('a second press that changes nothing keeps the first row\'s space, so the rows below it do not move up at the press', () => {
  const layout = newLayout()
  const all = [{ id: 'a', h: 100 }, { id: 'b', h: 140 }, { id: 'c', h: 100 }, { id: 'd', h: 90 }]
  const height = (slots: readonly { h: number }[]) => slots.reduce((sum, slot) => sum + slot.h, 0)
  columnSlots(layout, 'open', 'w', all, 0)
  // a is started: its space holds its place.
  expect(ids(columnSlots(layout, 'open', 'w', all.slice(1), 1000))).toEqual(['space', 'b', 'c', 'd'])
  // c leaves 10 s later, after a press that keeps a's space (no clearSpaces call), so b, c and d stay where they were.
  expect(pressKeepsSpaces('room-toggle')).toBe(true)
  const after = columnSlots(layout, 'open', 'w', [all[1]!, all[3]!], 11_000)
  expect(ids(after)).toEqual(['space', 'b', 'space', 'd'])
  expect(height(after)).toBe(height(all))
  // Each space still goes SPACE_MS after its own ticket left.
  expect(expireSpaces(layout, 1000 + SPACE_MS)).toBe(true)
  expect(ids(columnSlots(layout, 'open', 'w', [all[1]!, all[3]!], 1000 + SPACE_MS))).toEqual(['b', 'space', 'd'])
})

test('the layout of a list that is no longer drawn is dropped, and that of a list drawn at every render is kept', () => {
  const layout = newLayout()
  const rows = [{ id: 'a', h: 100 }, { id: 'b', h: 100 }]
  const draw = (col: string, items = rows) => columnSlots(layout, col, 'w', items, 0)
  beginRender(layout)
  draw('list:kept')
  draw('list:gone')
  // A row leaves the list that stays: its space is held.
  beginRender(layout)
  draw('list:kept', rows.slice(1))
  expect(layout.spaces.length).toBe(1)
  expect([...layout.drawn.keys()].sort()).toEqual(['list:gone', 'list:kept'])
  // list:gone was not drawn in the previous render: dropped. list:kept, drawn at every render, stays with its space.
  beginRender(layout)
  draw('list:kept', rows.slice(1))
  expect([...layout.drawn.keys()]).toEqual(['list:kept'])
  expect(layout.spaces.map(space => space.col)).toEqual(['list:kept'])
})

test('the space of a row in a list that is no longer drawn goes with the list', () => {
  const layout = newLayout()
  const rows = [{ id: 'a', h: 100 }, { id: 'b', h: 100 }]
  beginRender(layout)
  columnSlots(layout, 'list:gone', 'w', rows, 0)
  beginRender(layout)
  columnSlots(layout, 'list:gone', 'w', rows.slice(1), 1)
  expect(layout.spaces.length).toBe(1)
  beginRender(layout)
  beginRender(layout)
  expect(layout.spaces.length).toBe(0)
  expect(layout.drawn.size).toBe(0)
})
