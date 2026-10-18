import { expect, test } from 'claude-code/testing'

import type { ItemStatus } from '../hooks/card-types'
import { stoppedKeys } from '../hooks/stop-queue'

const statuses = (pairs: [string, ItemStatus][]) => new Map<string, ItemStatus>(pairs)

test('stoppedKeys names the tickets an edit took from in progress to open, and no other move', () => {
  const before = statuses([['#t1', 'in_progress'], ['#t2', 'in_progress'], ['#t3', 'queued'], ['#t4', 'pending'], ['#t5', 'in_progress']])
  const after = statuses([['#t1', 'pending'], ['#t2', 'completed'], ['#t3', 'pending'], ['#t4', 'pending'], ['#t5', 'queued']])
  expect(stoppedKeys(before, after)).toEqual(['#t1'])
})

test('stoppedKeys: a ticket the edit added open was never in progress, so it stays open', () => {
  expect(stoppedKeys(statuses([]), statuses([['#t9', 'pending']]))).toEqual([])
})
