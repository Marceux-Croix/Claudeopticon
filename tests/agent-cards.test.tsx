import { expect, test } from 'claude-code/testing'

import { orchestratorSvg, timelineSvg } from '../hooks/agent-cards'
import { buildView } from '../hooks/view-model'
import type { AgentRow } from '../types'

test('the orchestrator card draws a dim mono detail line per entry, in a taller card, and none when there is no detail', () => {
  const plain = orchestratorSvg([{ line: 'A', at: 0, isRunning: false }, { line: 'B', at: 0, isRunning: false }])
  const rich = orchestratorSvg([{ line: 'A', at: 0, isRunning: false, detail: 'npm test <all>' }, { line: 'B', at: 0, isRunning: false }])
  expect(rich.height).toBe(plain.height + 16)
  expect(rich.source).toContain('npm test &lt;all&gt;')
  expect(rich.source).not.toContain('<all>')
  expect(rich.source).toMatch(/font-size="11" class="mono">npm test/)
  expect(plain.source).not.toContain('font-size="11"')
  expect(rich.source).toContain(`height="${rich.height}"`)
  const long = orchestratorSvg([{ line: 'A', at: 0, isRunning: false, detail: 'x'.repeat(400) }])
  expect(long.source).toContain('…')
  expect(long.source).not.toContain('x'.repeat(400))
})

const row = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1', description: 'x', type: 'Explore', status: 'running', startedAt: 0, toolCalls: 0, brief: '', ...over,
})

test('the timeline of finished agents that are hidden says so instead of drawing NaN', () => {
  const rows = [row({ id: 'a', status: 'completed', startedAt: 10, endedAt: 50 }), row({ id: 'b', status: 'failed', startedAt: 20, endedAt: 60 })]
  const view = buildView([], rows, 9000)
  for (const hidden of [view, buildView([], rows.slice(0, 1), 9000), buildView([], rows.slice(1), 9000)]) {
    const source = timelineSvg(hidden, []).source
    expect(source).toContain('All agents finished')
    expect(source).not.toContain('No agents ran')
    expect(source).not.toContain('NaN')
    expect(source).not.toContain('Infinity')
  }
  expect(timelineSvg(buildView([], [], 9000), []).source).toContain('No agents ran in this window')
  expect(timelineSvg(view, view.agents).source).not.toContain('All agents finished')
})
