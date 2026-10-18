import { expect, test } from 'claude-code/testing'

import { nextIdsLine, numberedNote } from '../hooks/claude-notes'
import { applyRenames } from '../hooks/consolidate-text'
import { insertIds } from '../hooks/numbering'
import { heldBy, highestId, lostIds, nextTicketIds, SUFFIX_MAX, ticketValue, VALUE_END } from '../hooks/ticket-ids'
import type { Reservation } from '../hooks/ticket-ids'
import { parseTodo } from '../hooks/todo-markdown'

// ---------------------------------------------------------------- ticket IDs and auto-numbering

test('ticket IDs: T plus a digit then digits and letters parse in any case, #TODO does not, and values are base 36', () => {
  const ids = parseTodo(['- [ ] #T12 old', '- [ ] #T002A new', '- [ ] #t002b lower', '- [ ] #TODO fix', '- [ ] #PROJ7 other prefix', '- [ ] #TA1 letter first', '- [ ] #T1x2y'].join('\n')).map(item => item.id)
  expect(ids).toEqual(['T12', 'T002A', 't002b', undefined, 'PROJ7', 'TA1', 'T1x2y'])
  expect(ticketValue('T25')).toBe(77)
  expect(ticketValue('T0026')).toBe(78)
  expect(ticketValue('t002a')).toBe(82)
  expect(ticketValue('PROJ7')).toBeUndefined()
  expect(ticketValue('TODO')).toBeUndefined()
  expect(applyRenames('#TODO and #T12 and #T002A', { t12: 'T0001', t002a: 'T0002' })).toBe('#TODO and #T0001 and #T0002')
})

test('the next free ticket IDs follow the highest value, old or new, and skip forms that start with a letter', () => {
  expect(nextTicketIds([], 2)).toEqual(['T0001', 'T0002'])
  // Old #T25 (77) then (78).
  expect(nextTicketIds(['t25'], 3)).toEqual(['T0026', 'T0027', 'T0028'])
  expect(nextTicketIds(['t0029', 'T1'], 2)).toEqual(['T002A', 'T002B'])
  expect(nextTicketIds(['t002a', 'proj9'], 1)).toEqual(['T002B'])
  // 9ZZZ is the last 4-character form that starts with a digit: then 5 characters, still a digit first.
  expect(nextTicketIds(['t9zzz'], 2)).toEqual(['T10000', 'T10001'])
  expect(nextTicketIds(['t9zzy'], 2)).toEqual(['T9ZZZ', 'T10000'])
  // nextIdsLine names the IDs it is given; nextTicketIds picks them.
  expect(nextIdsLine(nextTicketIds(['t25'], 3))).toBe('Next free ticket IDs: #T0026, #T0027, #T0028')
  expect(insertIds('# P\n- [ ] a\n  - [~] b\nc', [1, 2], ['T0001', 'T0002'])).toBe('# P\n- [ ] #T0001 a\n  - [~] #T0002 b\nc')
  expect(numberedNote([])).toBeUndefined()
})

// ---------------------------------------------------------------- (batch J2)

/** Property: only `T` and up to SUFFIX_MAX characters counts on the number line, and a pick never repeats an ID. */
test('a long #T word is a plain word on the number line, and nextTicketIds never repeats', () => {
  expect(SUFFIX_MAX).toBe(6)
  // The reviewer's P3 state: a date-like tag in a fenced example no longer moves the next IDs.
  expect(nextTicketIds(['t0001', 't20241005'], 1)).toEqual(['T0002'])
  // Behind a valid first case: a long word after a real ID; the probe's pair that gave one ID twice.
  expect(nextTicketIds(['t0005', 'T2024100512'], 1)).toEqual(['T0006'])
  const pair = nextTicketIds(['T9ZZZZZZZZZ', 'T10000000000'], 1)
  expect(pair.some(id => ['T9ZZZZZZZZZ', 'T10000000000'].includes(id))).toBe(false)
  // At the limit: 7 characters never count. moved the end of the line from 9ZZZZZ to VALUE_END (T20000),
  // so the last ID is T1ZZZZ, and past it fewer come back, never a repeat.
  expect(ticketValue('T1000000')).toBeUndefined()
  expect(nextTicketIds(['T1ZZZY'], 3)).toEqual(['T1ZZZZ'])
  expect(nextTicketIds(['T1ZZZZ'], 2)).toEqual([])
  // The excluded population: short old forms still count (T12 is 38), and the floor moves the start.
  expect(nextTicketIds(['T12'], 1)).toEqual(['T0013'])
  expect(nextTicketIds([], 1, 77)).toEqual(['T0026'])
})

// ---------------------------------------------------------------- (batch K1)

/**
 * Property: one stray `#T` word, a date tag or a placeholder, never moves the next IDs and never
 * uses up the number line; only values below VALUE_END (`T20000`: 4 characters and a margin) count.
 */
test('a #T word at or past VALUE_END is a plain word, and the line is full only past T1ZZZZ', () => {
  expect(VALUE_END).toBe(parseInt('20000', 36))
  // The verifier's states: a 6-digit date tag and `Z` beside a real ID.
  expect(nextTicketIds(['t0001', 't202410'], 1)).toEqual(['T0002'])
  expect(nextTicketIds(['t0001', 'T9ZZZZZ'], 1)).toEqual(['T0002'])
  // (batch L2) removed `isLineFull`, which no code called: "the line is full" is now said as no next ID.
  expect(nextTicketIds(['t0001', 'T9ZZZZZ'], 1)).toHaveLength(1)
  // Behind a valid first case: a 5-character tag that starts with 2 or more is plain; the margin (`1....`) counts.
  expect(ticketValue('T20241')).toBeUndefined()
  expect(nextTicketIds(['t0005', 'T20241'], 1)).toEqual(['T0006'])
  expect(nextTicketIds(['T12345'], 1)).toEqual(['T12346'])
  // At the limit: T1ZZZZ is the last value; T20000 is none; the line is full at T1ZZZZ.
  expect(ticketValue('T1ZZZZ')).toBe(VALUE_END - 1)
  expect(ticketValue('T20000')).toBeUndefined()
  expect(nextTicketIds(['T1ZZZZ'], 1)).toEqual([])
  expect(nextTicketIds(['T1ZZZY'], 1)).toEqual(['T1ZZZZ'])
  // The excluded population: the mod's own 4-character form and old short forms count as before.
  expect(nextTicketIds(['t9zzz'], 1)).toEqual(['T10000'])
  expect(nextTicketIds(['T12'], 1)).toEqual(['T0013'])
  expect(highestId(['t0001', 'T9ZZZZZ', 'T0A0B', 'T0003'])).toBe('T0A0B')
  expect(highestId(['T9ZZZZZ'])).toBeUndefined()
})

// ---------------------------------------------------------------- (batch G2)

test('an ID this session holds that the store gives to another session is lost to it', () => {
  const mine = new Map<string, Reservation>([
    ['t0002', { until: 100, offeredTo: 'me', by: 'me' }],
    ['t0003', { until: 100, by: 'me' }],
    ['t0004', { until: 100, offeredTo: 'me' }],
    ['t0005', { until: 100, by: 'other' }],
  ])
  // Behind a valid first entry: the second of mine is taken by another session.
  expect(lostIds(mine, [['t0002', { until: 100, by: 'me' }], ['t0003', { until: 100, by: 'b' }]], 'me', 50)).toEqual(['t0003'])
  // At the limit: an entry that expires at this very moment is no claim; one a moment later is.
  expect(lostIds(mine, [['t0002', { until: 50, by: 'b' }]], 'me', 50)).toEqual([])
  expect(lostIds(mine, [['t0002', { until: 51, by: 'b' }]], 'me', 50)).toEqual(['t0002'])
  // An entry stored before holders were named (no `by`, no offer) counts as another's; an older offer to me counts as mine.
  expect(lostIds(mine, [['t0004', { until: 100 }], ['t0002', { until: 100, offeredTo: 'me' }]], 'me', 50)).toEqual(['t0004'])
  // An ID another session already held in memory is never this session's loss.
  expect(lostIds(mine, [['t0005', { until: 100, by: 'b' }]], 'me', 50)).toEqual([])
  expect(heldBy({ until: 1, offeredTo: 'x' })).toBe('x')
})
