import { expect, test } from 'claude-code/testing'

import { agentCardHeight, AGENT_CARD_MIN_PX, agentSvg, ORCHESTRATOR_HELD_PX, orchestratorSvg, timelineHeight, timelineSvg } from '../hooks/agent-cards'
import { buildView } from '../hooks/view-model'
import type { AgentRow } from '../types'

test('the orchestrator card draws a dim mono detail line per entry, and none when there is no detail', () => {
  const plain = orchestratorSvg([{ line: 'A', at: 0, isRunning: false }, { line: 'B', at: 0, isRunning: false }])
  const rich = orchestratorSvg([{ line: 'A', at: 0, isRunning: false, detail: 'npm test <all>' }, { line: 'B', at: 0, isRunning: false }])
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

test('the orchestrator card holds the height of a full page of five entries with detail lines, however few or short its entries', () => {
  const entry = (detail?: string) => ({ line: 'A', at: 0, isRunning: false, ...(detail === undefined ? {} : { detail }) })
  expect(orchestratorSvg([entry()]).height).toBe(ORCHESTRATOR_HELD_PX)
  expect(orchestratorSvg([entry('npm test')]).height).toBe(ORCHESTRATOR_HELD_PX)
  const full = orchestratorSvg(Array.from({ length: 5 }, () => entry('npm test')))
  expect(full.height).toBe(ORCHESTRATOR_HELD_PX)
  expect(full.source).toContain(`height="${ORCHESTRATOR_HELD_PX}"`)
})

test('the held orchestrator card with no entries is drawn empty at its held height, and says so', () => {
  const empty = orchestratorSvg([])
  expect(empty.height).toBe(ORCHESTRATOR_HELD_PX)
  expect(empty.alt).toBe('Orchestrator: nothing done yet')
  expect(empty.source).not.toContain('<text')
})

test('the orchestrator card not held fits its entries', () => {
  const one = orchestratorSvg([{ line: 'A', at: 0, isRunning: false }], false)
  expect(one.height).toBeLessThan(ORCHESTRATOR_HELD_PX)
  expect(one.height).toBe(8 + 22 + 14)
})

test('timelineHeight and agentCardHeight are the heights the cards draw at', () => {
  const view = buildView([], [], 9000)
  expect(timelineSvg(view, []).height).toBe(timelineHeight(0))
  expect(timelineHeight(0)).toBe(timelineHeight(1))
  expect(timelineHeight(3) - timelineHeight(2)).toBe(30)
  expect(AGENT_CARD_MIN_PX).toBe(agentCardHeight(2, false))
  expect(agentCardHeight(3, true) - agentCardHeight(2, false)).toBe(28)
})

test('the card of an ended agent is the same markup at two clock readings 30 s apart', () => {
  const rows = [row({ id: 'a', status: 'completed', startedAt: 0, endedAt: 50_000 }), row({ id: 'b', status: 'failed', startedAt: 0, endedAt: 60_000 })]
  for (const [i, agentRow] of rows.entries()) {
    const early = buildView([], [agentRow], 120_000)
    const late = buildView([], [agentRow], 150_000)
    expect(agentSvg(late.agents[0]!, late).source, `row ${i}`).toBe(agentSvg(early.agents[0]!, early).source)
  }
})

/**
 * Property: a live agent's Stop key is drawn in its card on the badge's row, at the badge's height, red with a white stop
 * sign, so the two line up at any scale. An ended agent and the orchestrator draw no key.
 */
test('a live agent card draws a red Stop key at the badge row and height; an ended one draws none', () => {
  const rects = (svg: string) => [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" rx="4" fill="([^"]+)"\/>/g)].map(m => ({ y: m[1], h: m[2], fill: m[3] }))
  const live = buildView([], [row({ id: 'a', status: 'running', startedAt: 0 })], 10_000)
  const drawn = rects(agentSvg(live.agents[0]!, live).source)
  const key = drawn.find(r => r.fill === '#DC2626')
  const tag = drawn.find(r => r.fill !== '#DC2626')
  expect(key).toBeDefined()
  expect(tag).toBeDefined()
  expect(key!.y).toBe(tag!.y)
  expect(key!.h).toBe(tag!.h)
  // The key takes the right edge, the badge sits left of it.
  const xs = [...agentSvg(live.agents[0]!, live).source.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="22" rx="4" fill="([^"]+)"\/>/g)].map(m => ({ x: Number(m[1]), w: Number(m[2]), fill: m[3] }))
  const keyX = xs.find(r => r.fill === '#DC2626')!
  const tagX = xs.find(r => r.fill !== '#DC2626')!
  expect(tagX.x + tagX.w).toBeLessThan(keyX.x)
  // White in both themes: the light theme turns a `#FFFFFF` stroke dark.
  const sign = agentSvg(live.agents[0]!, live).source.split('fill="#DC2626"/>')[1]!.split('\n').slice(1, 3).join('\n')
  expect(sign).toContain('stroke="#FFF"')
  expect(sign).not.toContain('#FFFFFF')
  const ended = buildView([], [row({ id: 'a', status: 'completed', startedAt: 0, endedAt: 5_000 })], 10_000)
  expect(agentSvg(ended.agents[0]!, ended).source).not.toContain('#DC2626')
})

test('the timeline always spans the last 30 minutes, however recently its agents started', () => {
  const now = 3 * 3_600_000
  const fresh = buildView([], [row({ id: 'a', startedAt: now - 25_000 })], now)
  const source = timelineSvg(fresh, fresh.agents).source
  expect(source).toContain('>30m 00s ago<')
  expect(source).toContain('>15m 00s ago<')
  expect(source).toContain('>Now<')
  const width = Number(/<rect x="[\d.]+" y="[\d.-]+" width="([\d.]+)"/.exec(source)![1])
  expect(width).toBeLessThan(20)
  const old = buildView([], [row({ id: 'b', startedAt: now - 2 * 3_600_000 })], now)
  expect(timelineSvg(old, old.agents).source).toContain('>30m 00s ago<')
  expect(timelineSvg(buildView([], [], now), []).source).toContain('>30m 00s ago<')
})
