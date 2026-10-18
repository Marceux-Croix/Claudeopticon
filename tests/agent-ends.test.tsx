import { expect, test } from 'claude-code/testing'

import { notifiedEnd, UNLISTED_MS, unlistedEnds } from '../hooks/agent-ends'

test('a task notification reports an ID and an end status; other messages report none', () => {
  expect(notifiedEnd('<task-notification><task-id>b1</task-id><status>completed</status></task-notification>')).toEqual({ id: 'b1', status: 'completed' })
  expect(notifiedEnd('<task-id>m1</task-id><status>stopped</status>')?.status).toBe('killed')
  expect(notifiedEnd('<task-id>m1</task-id><event>line</event>')).toBeUndefined()
})

// ---------------------------------------------------------------- UCR-068

/** Property: a live agent ends only after it has been missing from the list for UNLISTED_MS, counted from the first refresh that missed it. */
test('UCR-068 the unlisted grace counts from when the agent left the list, in three constructed states', () => {
  const hour = 60 * 60_000
  const rows = [
    { id: 'ok', status: 'running' as const },
    { id: 'long', status: 'running' as const },
    { id: 'done', status: 'completed' as const },
  ]
  // Behind a listed row: a row that ran for an hour and is missing for the first time is not ended.
  let state = unlistedEnds(rows, new Set(['ok']), new Map(), hour)
  expect([...state.ended]).toEqual([])
  expect(state.missing.get('long')).toBe(hour)
  // At the limit: missing for exactly UNLISTED_MS it stays; one ms past, it ends.
  state = unlistedEnds(rows, new Set(['ok']), state.missing, hour + UNLISTED_MS)
  expect([...state.ended]).toEqual([])
  expect([...unlistedEnds(rows, new Set(['ok']), state.missing, hour + UNLISTED_MS + 1).ended]).toEqual(['long'])
  // Listed again, the clock starts over; an ended row is never counted.
  state = unlistedEnds(rows, new Set(['ok', 'long']), state.missing, hour + UNLISTED_MS)
  expect(state.missing.size).toBe(0)
  expect(unlistedEnds(rows, new Set(), new Map([['done', 0]]), hour).missing.has('done')).toBe(false)
})

// ---------------------------------------------------------------- UCR-130

/** Property: after a clock set back, a gone agent still ends UNLISTED_MS after the set-back, not after the set-back's length. */
test('UCR-130 the unlisted grace restarts from a clock set back, in three states', () => {
  const rows = [{ id: 'gone', status: 'running' as const }]
  const t = 10_000_000
  // Behind a valid first case: missing since t, it ends after UNLISTED_MS.
  let state = unlistedEnds(rows, new Set(), new Map(), t)
  expect([...unlistedEnds(rows, new Set(), state.missing, t + UNLISTED_MS + 1).ended]).toEqual(['gone'])
  // The clock goes back 2 h: the start is reset to the new time, not kept 2 h ahead.
  const back = t - 7_200_000
  state = unlistedEnds(rows, new Set(), state.missing, back)
  expect(state.missing.get('gone')).toBe(back)
  // At the limit: UNLISTED_MS after the set-back it stays, 1 ms later it ends (the old code waited 2 h more).
  expect([...unlistedEnds(rows, new Set(), state.missing, back + UNLISTED_MS).ended]).toEqual([])
  expect([...unlistedEnds(rows, new Set(), state.missing, back + UNLISTED_MS + 1).ended]).toEqual(['gone'])
})

test('UCR-188 a task notification whose status is an Object prototype key reports no end', () => {
  // State 1: each inherited key, behind a valid task ID.
  for (const word of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect([word, notifiedEnd(`<task-id>a1</task-id><status>${word}</status>`)]).toEqual([word, undefined])
  }
  // State 2: the case fold the lookup makes cannot reach one either.
  expect(notifiedEnd('<task-id>a1</task-id><status>Constructor</status>')).toBeUndefined()
  // State 3: a real end next to it still counts.
  expect(notifiedEnd('<task-id>a1</task-id><status>Timed_Out</status>')).toEqual({ id: 'a1', status: 'failed' })
})
