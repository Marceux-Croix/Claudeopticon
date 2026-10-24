import { expect, test } from 'claude-code/testing'

import { peerHolds, PEER_DIM_MS, waitOver } from '../hooks/peer-sessions'

const ROOT = '/repo'
const NOW = 100_000_000
const TICKET = '/repo/.claude_todo/TODO.md\t#t1'
const record = (seenAt: number) => ({ v: 1, sessionId: 'a', name: 'Alpha', root: ROOT, tickets: [TICKET], agentTickets: [], planned: [], seenAt })

test('a peer record stamped in the future counts as seen now, so the board never dims or sorts it by its own clock', () => {
  const day = 23 * 3_600_000
  // Three states: far ahead (inside the ignore window), a second ahead, and exactly now.
  for (const ahead of [day, 1000, 0]) {
    const held = peerHolds([{ id: 'a', value: record(NOW + ahead) }], 'me', ROOT, NOW, new Set())
    expect(held.get(TICKET)?.seenAt).toBeLessThanOrEqual(NOW)
  }
  // The silence the dim reads is never negative.
  const held = peerHolds([{ id: 'a', value: record(NOW + day) }], 'me', ROOT, NOW, new Set())
  expect(NOW - (held.get(TICKET)?.seenAt ?? 0)).toBeLessThan(PEER_DIM_MS)
})

test('a wait restarts from a clock set back and is over one wait later, never held for the length of the set-back', () => {
  const every = 5000
  // Nothing done yet: over.
  expect(waitOver(undefined, NOW, every)).toEqual({ isOver: true, from: undefined })
  // Inside the wait: not over; at the wait: over.
  expect(waitOver(NOW - 4999, NOW, every).isOver).toBe(false)
  expect(waitOver(NOW - every, NOW, every).isOver).toBe(true)
  // Set back one hour: the reference moves to the new time, not over now, over one wait later.
  const back = waitOver(NOW + 3_600_000, NOW, every)
  expect(back).toEqual({ isOver: false, from: NOW })
  expect(waitOver(back.from, NOW + every, every).isOver).toBe(true)
})
