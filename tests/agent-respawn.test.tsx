import { expect, test } from 'claude-code/testing'

import { respawnedRow } from '../hooks/agent-respawn'
import type { AgentRow } from '../types'

const OLD: AgentRow = { id: 'a1', description: 'Old task', type: 'engineer', status: 'completed', startedAt: 1, endedAt: 9, toolCalls: 7, tokens: 1200, brief: 'old task', idleSince: 8, progress: { done: 2, total: 2 }, claims: ['#T1'], autoClaims: ['Old'] }
const FRESH: AgentRow = { id: 'a1', description: 'New task', type: 'engineer', model: 'm', status: 'running', startedAt: 20, toolCalls: 0, doing: 'Starting', brief: 'new task' }

/** Property (UCR-220): a re-spawned ID keeps its tool calls and tokens and takes everything else from the new spawn. */
test('UCR-220 respawnedRow keeps the counts and takes the new task', () => {
  expect(respawnedRow(OLD, FRESH)).toEqual({ ...FRESH, toolCalls: 7, tokens: 1200 })
  // A row with no tokens yet stays with none.
  const { tokens: _, ...noTokens } = OLD
  expect('tokens' in respawnedRow(noTokens, FRESH)).toBe(false)
})
