import { expect, test } from 'claude-code/testing'

import { agentLabel as labelOf, labelFontSize, setLabelBase } from '../hooks/agent-identity'
import { labelNote } from '../hooks/claude-notes'
import type { AgentRow } from '../types'

test('agent labels fit their circle at any length, and count from the kept base after a reload', () => {
  // Instrument Sans at weight 500: A is 0.461 em, a digit 0.664 em; the circle leaves at most 17 px.
  for (const label of ['A1', 'A10', 'A100', 'A1000', 'A10000']) {
    const width = (0.461 + 0.664 * (label.length - 1)) * labelFontSize(label)
    expect(width).toBeLessThanOrEqual(17)
  }
  expect(labelFontSize('A1')).toBe(11)
  expect(labelFontSize('A23')).toBe(9.5)
  setLabelBase(200)
  expect(labelOf(0)).toBe('A201')
  expect(labelNote('how is A201 doing? and A1?', [{ id: 'x', description: 'Kept', type: 'general-purpose', status: 'running', startedAt: 1, toolCalls: 0, brief: '' } as AgentRow], 200)).toContain('- A201: "Kept"')
  setLabelBase(0)
  expect(labelOf(0)).toBe('A1')
})
