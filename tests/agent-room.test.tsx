import { expect, test } from 'claude-code/testing'

import { AGENT_CARD_MIN_PX, timelineHeight } from '../hooks/agent-cards'
import { blankCard, HELD_AGENTS, HELD_FLOOR_PX, HELD_SLOTS, holdRoom, NO_ROOM, ROOM_SLOTS } from '../hooks/agent-room'

const sum = (list: readonly number[]) => list.reduce((total, px) => total + px, 0)

test('the held room is three agent cards, and its floor is a three-strip timeline, four of the smallest cards and the trailing blank', () => {
  expect(HELD_AGENTS).toBe(3)
  expect(HELD_SLOTS).toBe(5)
  expect(ROOM_SLOTS).toBe(6)
  // And the 1 px of the trailing blank (#T004W), so three of the smallest agent cards do not grow the area.
  expect(HELD_FLOOR_PX).toBe(timelineHeight(3) + 4 * AGENT_CARD_MIN_PX + 1)
})

test('with no agent card, blanks fill every slot to the floor height', () => {
  const held = holdRoom(NO_ROOM, [], 0)
  expect(held.blanks).toHaveLength(ROOM_SLOTS)
  expect(sum(held.blanks)).toBe(HELD_FLOOR_PX)
  expect(held.room.tallestPx).toBe(HELD_FLOOR_PX)
})

test('cards plus blanks keep the slot count and the height steady as agents come, up to three', () => {
  let room = NO_ROOM
  for (let agents = 0; agents <= HELD_AGENTS; agents += 1) {
    const cards = agents === 0 ? [] : [timelineHeight(agents), AGENT_CARD_MIN_PX, ...Array.from({ length: agents }, () => AGENT_CARD_MIN_PX)]
    const held = holdRoom(room, cards, agents)
    room = held.room
    expect(cards.length + held.blanks.length).toBe(ROOM_SLOTS)
    expect(sum(cards) + sum(held.blanks)).toBe(HELD_FLOOR_PX)
  }
})

test('the area keeps the tallest height it was drawn at: a card that shrinks leaves its room as a blank', () => {
  const tall = holdRoom(NO_ROOM, [timelineHeight(1), AGENT_CARD_MIN_PX, HELD_FLOOR_PX], 1)
  expect(tall.blanks.every(px => px >= 1)).toBe(true)
  const tallest = tall.room.tallestPx
  const shrunk = holdRoom(tall.room, [timelineHeight(1), AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX], 1)
  expect(shrunk.room.tallestPx).toBe(tallest)
  expect(AGENT_CARD_MIN_PX * 2 + timelineHeight(1) + sum(shrunk.blanks)).toBe(tallest)
})

test('past three agent cards nothing is held and the room does not grow, so the area goes back to its held height after', () => {
  const room = holdRoom(NO_ROOM, [], 0).room
  const many = Array.from({ length: HELD_AGENTS + 3 }, () => AGENT_CARD_MIN_PX * 3)
  const past = holdRoom(room, [timelineHeight(6), AGENT_CARD_MIN_PX, ...many], HELD_AGENTS + 3)
  expect(past.blanks).toEqual([])
  expect(past.room).toBe(room)
})

test('a full area shorter than the tallest gets one blank for the rest', () => {
  const room = { tallestPx: HELD_FLOOR_PX + 100 }
  const cards = [timelineHeight(3), AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX]
  expect(holdRoom(room, cards, 3).blanks).toEqual([room.tallestPx - sum(cards)])
})

test('#T004W a full area keeps its trailing blank when the cards fill the tallest height, so no row gap comes or goes', () => {
  const cards = [timelineHeight(3), AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX]
  // Before #T004W a full area that met the tallest height drew no blank, and one more child (and row gap) once a card shrank.
  const full = holdRoom({ tallestPx: 0 }, cards, 3)
  expect(full.blanks).toHaveLength(1)
  expect(full.blanks[0]).toBeGreaterThanOrEqual(1)
  const tallest = full.room.tallestPx
  expect(sum(cards) + sum(full.blanks)).toBe(tallest)
  // A card shrinks, then grows back: the child count and the total height stay the same throughout.
  const shrunk = holdRoom(full.room, [cards[0]!, AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX - 20, AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX], 3)
  expect(5 + shrunk.blanks.length).toBe(ROOM_SLOTS)
  expect(sum(cards) - 20 + sum(shrunk.blanks)).toBe(tallest)
  const back = holdRoom(shrunk.room, cards, 3)
  expect(5 + back.blanks.length).toBe(ROOM_SLOTS)
  expect(sum(cards) + sum(back.blanks)).toBe(tallest)
})

test('#T004W blanks never draw past the tallest height: each is at least 1 px and they sum to exactly what the cards leave short', () => {
  let room = NO_ROOM
  const steps: number[][] = [[], [timelineHeight(1)], [timelineHeight(1), AGENT_CARD_MIN_PX], [timelineHeight(2), AGENT_CARD_MIN_PX, AGENT_CARD_MIN_PX], [timelineHeight(1), AGENT_CARD_MIN_PX, HELD_FLOOR_PX]]
  for (const cards of steps) {
    const held = holdRoom(room, cards, Math.max(0, cards.length - 2))
    room = held.room
    expect(held.blanks.every(px => px >= 1)).toBe(true)
    expect(cards.length + held.blanks.length).toBe(ROOM_SLOTS)
    expect(sum(cards) + sum(held.blanks)).toBe(room.tallestPx)
  }
})

test('an empty slot is a gray card box at the asked height, with nothing drawn in it', () => {
  const blank = blankCard(42)
  expect(blank.height).toBe(42)
  expect(blank.source).toContain('height="42"')
  expect(blank.source).toContain('<rect')
  expect(blank.source).not.toContain('<text')
  expect(blank.alt).toBe('Empty agent slot')
})
