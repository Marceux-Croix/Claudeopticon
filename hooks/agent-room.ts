// The room the pane holds for the agent area: empty cards that keep its height steady while three agent cards or fewer show.

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

/** The least height the held area takes: a timeline of three strips, and four of the smallest agent cards (the orchestrator's and three). */
export const HELD_FLOOR_PX = timelineHeight(HELD_AGENTS) + (HELD_AGENTS + 1) * AGENT_CARD_MIN_PX

/** The tallest the agent area was drawn this session at the held size or less, in px. */
export type AgentRoom = { tallestPx: number }

export const NO_ROOM: AgentRoom = { tallestPx: 0 }

/**
 * The blank slots that hold the agent area at its height, for the drawn cards' heights in px and
 * the count of agent cards among them. One blank for each slot the cards leave empty, so the count
 * of slots (and of the row gaps between them) stays the same; their heights fill what the cards
 * leave short of the tallest the area was. Past HELD_AGENTS agent cards nothing is held, and the
 * room is not grown, so the area goes back to its held height once the extra cards leave.
 */
export function holdRoom(room: AgentRoom, cardPx: readonly number[], agentCards: number): { room: AgentRoom; blanks: number[] } {
  if (agentCards > HELD_AGENTS) {
    return { room, blanks: [] }
  }
  const drawn = cardPx.reduce((sum, px) => sum + px, 0)
  const tallestPx = Math.max(room.tallestPx, HELD_FLOOR_PX, drawn)
  const fill = tallestPx - drawn
  const empty = Math.max(0, HELD_SLOTS - cardPx.length)
  const next = { tallestPx }
  if (empty === 0) {
    return { room: next, blanks: fill > 0 ? [fill] : [] }
  }
  const each = Math.floor(fill / empty)
  const blanks = Array.from({ length: empty }, (_, i) => Math.max(1, i === empty - 1 ? fill - each * (empty - 1) : each))

  return { room: next, blanks }
}

/** An empty slot of `height` px: the cards' gray box with nothing in it, so the held room reads as room for agents. */
export function blankCard(height: number): Card {
  return stage(height, '', 'Empty agent slot')
}
