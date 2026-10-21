// The room the pane holds for the agent area (#T004L): empty cards that keep its height steady while three agent cards or fewer show.

import { AGENT_CARD_MIN_PX, timelineHeight } from './agent-cards'
import type { Card } from './card-types'
import { stage } from './card-stage'

/**
 * The agent cards the held room covers. The desktop pane scrolls by pixels and tells the mod
 * nothing of it, so an agent area that grows or shrinks moves the board below it under the reader.
 * Up to this many cards the area keeps its height; past it, each card more moves the board.
 */
export const HELD_AGENTS = 3

/** The slots of the agent area at the held size: the timeline, the orchestrator card and three agent cards. */
export const HELD_SLOTS = HELD_AGENTS + 2

/**
 * The children the held area draws, cards and blanks: the held slots and one more blank, always
 * there, that takes what a full area of cards leaves short (#T004W). With a count that never
 * changes, the row gaps between them never change, so a blank that comes or goes moves nothing.
 */
export const ROOM_SLOTS = HELD_SLOTS + 1

/**
 * The least height the held area takes: a timeline of three strips, four of the smallest agent
 * cards (the orchestrator's and three), and the 1 px the trailing blank keeps when they fill the area.
 */
export const HELD_FLOOR_PX = timelineHeight(HELD_AGENTS) + (HELD_AGENTS + 1) * AGENT_CARD_MIN_PX + 1

/** The tallest the agent area was drawn this session at the held size or less, in px. */
export type AgentRoom = { tallestPx: number }

export const NO_ROOM: AgentRoom = { tallestPx: 0 }

/**
 * The blank slots that hold the agent area at its height, for the drawn cards' heights in px and
 * the count of agent cards among them. One blank for each of the ROOM_SLOTS the cards leave, so
 * the count of children (and of the row gaps between them) stays the same, a full area of cards
 * included (#T004W); their heights fill what the cards leave short of the tallest the area was.
 * Each blank is at least 1 px, and the tallest height counts that px, so the blanks always sum to
 * exactly what the cards leave short. Past HELD_AGENTS agent cards nothing is held, and the room
 * is not grown, so the area goes back to its held height once the extra cards leave.
 */
export function holdRoom(room: AgentRoom, cardPx: readonly number[], agentCards: number): { room: AgentRoom; blanks: number[] } {
  if (agentCards > HELD_AGENTS) {
    return { room, blanks: [] }
  }
  const drawn = cardPx.reduce((sum, px) => sum + px, 0)
  const empty = Math.max(1, ROOM_SLOTS - cardPx.length)
  const tallestPx = Math.max(room.tallestPx, HELD_FLOOR_PX, drawn + empty)
  const fill = tallestPx - drawn
  const each = Math.floor(fill / empty)
  const blanks = Array.from({ length: empty }, (_, i) => (i === empty - 1 ? fill - each * (empty - 1) : each))

  return { room: { tallestPx }, blanks }
}

/** An empty slot of `height` px: the cards' gray box with nothing in it, so the held room reads as room for agents. */
export function blankCard(height: number): Card {
  return stage(height, '', 'Empty agent slot')
}
