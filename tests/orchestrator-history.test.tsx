import { expect, test } from 'claude-code/testing'

import { orchestratorSvg } from '../hooks/agent-cards'
import { clock } from '../hooks/card-format'
import { orchestratorView, pageLabel } from '../hooks/orchestrator-history'
import { callSummary } from '../hooks/tool-calls'

test('the Orchestrator history pages newest first, five at a time, and times each line', async () => {
  expect(callSummary('Bash', { command: 'ls', description: 'List files\nmore' })).toBe('List files')
  expect(callSummary('Read', { file_path: '/a/b.ts' })).toBe('Read: /a/b.ts')
  const history = Array.from({ length: 25 }, (_, i) => ({ id: i, line: `L${i}`, at: 0, isRunning: i === 24 }))
  expect(orchestratorView(history, 0).entries.map(entry => entry.line).slice(0, 2)).toEqual(['L24', 'L23'])
  expect(orchestratorView(history, 4).entries.map(entry => entry.line)).toEqual(['L4', 'L3', 'L2', 'L1', 'L0'])
  expect(orchestratorView(history, 9).page).toBe(4)
  expect(orchestratorView([], 0).pages).toBe(1)
  expect(pageLabel(orchestratorView(history, 4), 25)).toBe('21 to 25 of 25')
  expect(clock(new Date(2026, 9, 15, 9, 5, 7).getTime())).toBe('09:05:07')
  const card = orchestratorSvg(history.slice(-2)).source
  expect(card).toContain('>L24<')
  expect(card).toContain('class="pulse"')
})
