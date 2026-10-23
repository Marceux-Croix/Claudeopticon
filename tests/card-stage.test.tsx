import { expect, test } from 'claude-code/testing'

import { agentSvg, timelineSvg } from '../hooks/agent-cards'
import { PANE, setWidth, W } from '../hooks/card-stage'
import { heroSvg } from '../hooks/hero-card'
import { fileCards } from '../hooks/todo-cards'
import { parseTodo } from '../hooks/todo-markdown'
import { buildView } from '../hooks/view-model'
import type { AgentRow } from '../types'

const row = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1', description: 'x', type: 'Explore', status: 'running', startedAt: 0, toolCalls: 0, brief: '', ...over,
})

test('the cards take the width they are given, at least 300 px and with no upper cap', async () => {
  const view = buildView([], [row({})], 1000)
  setWidth(720)
  expect(timelineSvg(view, view.agents).width).toBe(720)
  setWidth(5000)
  expect(timelineSvg(view, view.agents).width).toBe(5000)
  setWidth(10)
  expect(timelineSvg(view, view.agents).width).toBe(300)
  setWidth(384)
})

test('every card carries the light palette, swapped in by the system theme', async () => {
  const view = buildView([{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] one') }], [row({})], 10)
  for (const card of [heroSvg(view), ...fileCards(view.files[0]!, view, 12), timelineSvg(view, view.agents), agentSvg(view.agents[0]!, view)]) {
    expect(card.source).toContain('@media (prefers-color-scheme:light){[fill="#07080F"]{fill:#FFFFFF}')
    expect(card.source).toContain('[fill="rgba(255,255,255,.88)"]{fill:#10131C}')
  }
})

test(' setWidth gives the cards and the board the full pane width', () => {
  setWidth(2000)
  expect(W).toBe(2000)
  expect(PANE).toBe(2000)
  setWidth(200)
  expect(PANE).toBe(300)
  setWidth(384)
})
