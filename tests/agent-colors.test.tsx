import { expect, test } from 'claude-code/testing'

import { colorSlots } from '../hooks/agent-colors'
import { agentColor, AGENT_COLORS, setColorSlots } from '../hooks/agent-identity'

const live = (startedAt: number) => ({ startedAt, isEnded: false })
const ended = (startedAt: number, endedAt: number) => ({ startedAt, endedAt, isEnded: true })

test('an agent takes the lowest free color, and a finished agent frees its color for the next', () => {
  // A1 ends at 5, so A3 (started at 6) takes its blue; A2 still holds orange.
  expect(colorSlots([ended(1, 5), live(2), live(6)], 6)).toEqual([0, 1, 0])
  // An idle agent frees its color from the time it went idle.
  expect(colorSlots([{ startedAt: 1, idleSince: 3, isEnded: false }, live(4)], 6)).toEqual([0, 0])
})

test('the seventh agent of a long session still has a color', () => {
  const agents = Array.from({ length: 67 }, (_, i) => ended(i * 10, i * 10 + 5))
  agents[66] = live(660)
  const slots = colorSlots(agents, 6)
  expect(slots.every(slot => slot === 0)).toBe(true)
  setColorSlots(slots)
  expect(agentColor(66)).toBe(AGENT_COLORS[0])
  setColorSlots([])
})

test('with every color held, a new agent shares the color with the fewest holders', () => {
  expect(colorSlots([1, 2, 3, 4, 5, 6, 7, 8].map(live), 6)).toEqual([0, 1, 2, 3, 4, 5, 0, 1])
})

test('sixteen agent colors, all different', () => {
  expect(new Set(AGENT_COLORS).size).toBe(16)
})

test('a new agent never changes the color of an agent already drawn', () => {
  const before = colorSlots([live(1), ended(2, 3), live(4)], 6)
  expect(colorSlots([live(1), ended(2, 3), live(4), live(5)], 6).slice(0, 3)).toEqual(before)
})
