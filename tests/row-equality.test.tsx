import { expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import { sameRows } from '../hooks/row-equality'

function row(over: Partial<AgentRow> = {}): AgentRow {
  return { id: 'a1', description: 'd', type: 't', status: 'running', startedAt: 1, toolCalls: 0, brief: 'b', ...over } as AgentRow
}

test('equal rows in the same order are the same, even as separate objects', async () => {
  expect(sameRows([], [])).toBe(true)
  expect(sameRows([row(), row({ id: 'a2' })], [row(), row({ id: 'a2' })])).toBe(true)
  const same = [row()]
  expect(sameRows(same, same)).toBe(true)
})

test('a changed field, length or order makes the lists differ', async () => {
  expect(sameRows([row()], [row({ toolCalls: 1 })])).toBe(false)
  expect(sameRows([row()], [])).toBe(false)
  expect(sameRows([row({ id: 'a1' }), row({ id: 'a2' })], [row({ id: 'a2' }), row({ id: 'a1' })])).toBe(false)
  expect(sameRows([row()], [row({ doing: 'x' })])).toBe(false)
})

test('nested progress objects compare by value', async () => {
  const p = { done: 1, total: 3, step: 's' }
  expect(sameRows([row({ progress: p } as Partial<AgentRow>)], [row({ progress: { ...p } } as Partial<AgentRow>)])).toBe(true)
  expect(sameRows([row({ progress: p } as Partial<AgentRow>)], [row({ progress: { ...p, done: 2 } } as Partial<AgentRow>)])).toBe(false)
  expect(sameRows([row({ progress: p } as Partial<AgentRow>)], [row()])).toBe(false)
})
