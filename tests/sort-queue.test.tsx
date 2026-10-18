import { expect, test } from 'claude-code/testing'

import { SORT_BATCH } from '../hooks/categories'
import { addAloneTry, isItemsFailure, nextBatchSize, nextSortBatch, nextThrows, sortReplyKind, THROWS_TO_HALVE } from '../hooks/sort-queue'
import type { Queued } from '../hooks/sort-queue'

const queue = (n: number): Queued[] => Array.from({ length: n }, (_, i) => [`#t${i + 1}`, `item ${i + 1}`] as const)

/**
 * Property: one item whose reply never parses holds up only its own call. The size halves
 * after each reply that does not parse, so the item ends up alone; then it goes last, alone, and the
 * items behind it are sent. Three states: the poison item first in the queue (behind nothing), the
 * poison item last (the end of the queue), and (the excluded population) an item marked alone whose
 * text changed since, which is an ordinary item again.
 */
test('a lone item whose reply never parses goes last, in three constructed states', () => {
  // The size from 60 down to 1 in halves: 7 replies that do not parse, at most.
  const sizes = [SORT_BATCH]
  while (sizes[sizes.length - 1]! > 1) {
    sizes.push(nextBatchSize(sizes[sizes.length - 1]!, false))
  }
  expect(sizes).toEqual([60, 30, 15, 8, 4, 2, 1])
  expect(nextBatchSize(1, false)).toBe(1)
  // Changed by (I4): a parsed reply doubles the size, up to SORT_BATCH, instead of resetting it.
  expect(nextBatchSize(4, true)).toBe(8)
  expect(nextBatchSize(SORT_BATCH, true)).toBe(SORT_BATCH)
  expect(nextBatchSize(40, true)).toBe(SORT_BATCH)
  const items = queue(61)
  // First in the queue: once alone, it is left out, and the next call carries the items behind it.
  const first = new Map([['#t1', 'item 1']])
  expect(nextSortBatch(items, first, SORT_BATCH).map(([key]) => key)).toEqual(items.slice(1, 61).map(([key]) => key))
  // Last in the queue: the same; and once the others are sorted, it is sent alone.
  const last = new Map([['#t61', 'item 61']])
  expect(nextSortBatch(items, last, SORT_BATCH)).not.toContainEqual(items[60])
  expect(nextSortBatch(items.slice(60), last, SORT_BATCH)).toEqual([items[60]])
  // Excluded: its text changed since its lone failure, so it is sent with the others again.
  const changed = new Map([['#t1', 'old text']])
  expect(nextSortBatch(items, changed, SORT_BATCH)[0]).toEqual(items[0])
})

test('two lone items take turns, the one tried longest ago first', () => {
  const items = queue(2)
  expect(nextSortBatch(items, new Map([['#t1', 'item 1'], ['#t2', 'item 2']]), 1)).toEqual([items[0]])
  // #t1 failed again, so it was set again at the end of the order.
  expect(nextSortBatch(items, new Map([['#t2', 'item 2'], ['#t1', 'item 1']]), 1)).toEqual([items[1]])
  expect(nextSortBatch([], new Map(), 60)).toEqual([])
})

/**
 * Property: an empty reply (reason empty-reply) is read like one that does not parse, and
 * an API or network error is not. Three states: the empty reply, a failed call that throws, and an
 * unanswered call for another reason.
 */
test('sortReplyKind tells an empty reply from a failed call', () => {
  expect(sortReplyKind({ isAnswered: false, reason: 'empty-reply' })).toBe('empty')
  expect(sortReplyKind(undefined)).toBe('failed')
  expect(sortReplyKind({ isAnswered: false, reason: 'api-error' })).toBe('failed')
  expect(sortReplyKind({ isAnswered: false })).toBe('failed')
  expect(sortReplyKind({ isAnswered: true })).toBe('text')
})

/** Property: after a cut-down size, parsed replies grow it back by doubling, and never past SORT_BATCH. */
test('a parsed reply doubles the batch size step by step', () => {
  const sizes = [1]
  while (sizes[sizes.length - 1]! < SORT_BATCH) {
    sizes.push(nextBatchSize(sizes[sizes.length - 1]!, true))
  }
  expect(sizes).toEqual([1, 2, 4, 8, 16, 32, 60])
  expect(nextBatchSize(SORT_BATCH, true)).toBe(SORT_BATCH)
})

/** Property: a lone item that fails SORT_TRIES times is counted; a changed text starts the count again. */
test('addAloneTry counts failures of one text', () => {
  const one = addAloneTry(undefined, 'x')
  expect(one).toEqual({ text: 'x', count: 1 })
  expect(addAloneTry(one, 'x').count).toBe(2)
  expect(addAloneTry({ text: 'x', count: 2 }, 'y')).toEqual({ text: 'y', count: 1 })
})

// ---------------------------------------------------------------- (J4)

/** Property: a failure that may be the items' fault (a throw, an HTTP 4xx) is told from a transport or capacity failure, which only waits. */
test('isItemsFailure tells a failure the items may cause from a transport failure, in three states', () => {
  const apiError = (status: number | null) => ({ isAnswered: false, reason: 'api-error', status, error: 'x' })
  // Behind a valid first case: a throw, an HTTP 400 and a 413 may be the items' fault.
  expect(isItemsFailure(undefined, true)).toBe(true)
  expect(isItemsFailure(apiError(400), false)).toBe(true)
  expect(isItemsFailure(apiError(413), false)).toBe(true)
  // At the limits of the 4xx range: 499 counts, 500 and 399 do not; 408 and 429 are transport.
  expect(isItemsFailure(apiError(499), false)).toBe(true)
  expect(isItemsFailure(apiError(500), false)).toBe(false)
  expect(isItemsFailure(apiError(399), false)).toBe(false)
  expect(isItemsFailure(apiError(408), false)).toBe(false)
  expect(isItemsFailure(apiError(429), false)).toBe(false)
  // The excluded population: no response (status null), 503, 529 overloaded, an abort, an empty reply, an answer.
  for (const reply of [apiError(null), apiError(503), apiError(529), { isAnswered: false, reason: 'aborted' }, { isAnswered: false, reason: 'empty-reply' }, { isAnswered: true }]) {
    expect(isItemsFailure(reply, false)).toBe(false)
  }
})

/** Property: such failures count up for the same batch only; THROWS_TO_HALVE in a row halve it. */
test('nextThrows counts throws in a row for one batch', () => {
  const one = nextThrows(undefined, 'a|b')
  expect(one).toEqual({ batch: 'a|b', count: 1 })
  expect(nextThrows(one, 'a|b').count).toBe(THROWS_TO_HALVE)
  expect(nextThrows(one, 'a').count).toBe(1)
})
