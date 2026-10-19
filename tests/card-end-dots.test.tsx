import { expect, test } from 'claude-code/testing'

import { dotGroups, endDots, MERGE_PX } from '../hooks/card-end-dots'
import { setWidth } from '../hooks/card-stage'
import { heroSvg } from '../hooks/hero-card'
import { QUANT_MS, stepAxes } from '../hooks/series'
import type { Series } from '../hooks/series'
import { buildView } from '../hooks/view-model'
import { heroStates } from '../scripts/sample'

const MIN = 60_000
const GREEN = { color: '#A3E635', cls: 'ft' }
const BLUE = { color: '#60A5FA', cls: 'fr' }
const YELLOW = { color: '#FACC15', cls: 'fa' }

test('UCR-112 two ends with equal values share one dot, split half green and half blue', () => {
  const { svg, boxes } = endDots([{ y: 240, ...GREEN }, { y: 240, ...BLUE }], 300, '#07080F')
  // One ring in the stage color, and one wedge each in its own color and light-theme class.
  expect(svg.filter(one => one.startsWith('<circle'))).toEqual(['<circle cx="300" cy="240" r="5.5" fill="#07080F"/>'])
  expect(svg.filter(one => one.includes('fill="#A3E635" class="ft"')).length).toBe(1)
  expect(svg.filter(one => one.includes('fill="#60A5FA" class="fr"')).length).toBe(1)
  expect(boxes).toEqual([{ x0: 294.5, x1: 305.5, y0: 234.5, y1: 245.5 }])
})

test('UCR-112 ends closer than MERGE_PX share a dot, at the limit too; ends MERGE_PX apart keep their own', () => {
  // The defect behind a valid first case: the third end equals the second.
  expect(dotGroups([{ y: 100, ...YELLOW }, { y: 200, ...GREEN }, { y: 200, ...BLUE }])).toEqual([[0], [1, 2]])
  // At the limit: just under MERGE_PX shares, MERGE_PX apart does not.
  expect(dotGroups([{ y: 200, ...GREEN }, { y: 200 + MERGE_PX - 0.1, ...BLUE }])).toEqual([[0, 1]])
  expect(dotGroups([{ y: 200, ...GREEN }, { y: 200 + MERGE_PX, ...BLUE }])).toEqual([[0], [1]])
  // All three on one spot: three wedges.
  const three = endDots([{ y: 150, ...YELLOW }, { y: 152, ...GREEN }, { y: 151, ...BLUE }], 300, '#07080F').svg
  expect(three.filter(one => one.startsWith('<path')).length).toBe(3)
  // A lone end is the plain dot it always was.
  expect(endDots([{ y: 80, ...YELLOW }], 300, '#07080F').svg).toEqual(['<circle cx="300" cy="80" r="3.5" fill="#FACC15" class="fa" stroke="#07080F" stroke-width="2"/>'])
})

test('UCR-112 the late-compact sample draws no two plain end dots on top of each other, at every width', () => {
  for (const width of [300, 384, 520, 720, 960]) {
    setWidth(width)
    const svg = heroSvg(heroStates()['late-compact']!).source
    const ys = [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)" r="3.5"/g)].map(match => Number(match[1])).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(MERGE_PX)
    }
    // #T003K: the rate is drawn at 10 x its value, so the green and blue ends of this sample no longer coincide: three plain dots, no split one.
    expect(ys.length).toBe(3)
    expect(svg).not.toMatch(/<path d="[^"]+" fill="#A3E635" class="ft"\/>/)
  }
  setWidth(384)
})

test('UCR-112 #T004E a state with the token count and the rate at the same height draws the green and blue ends as one split dot, at every width', () => {
  // 900k tokens since compact, all in the last minute: the rate is 900k a minute, and both axes top out at 900k.
  const now = 100 * QUANT_MS
  const series: Series = { agents: [[now - 20 * MIN, 2]], tokens: [[now - 20 * MIN, 0], [now - 45_000, 900_000]], compacts: [] }
  for (const width of [300, 384, 520, 720, 960]) {
    setWidth(width)
    const svg = heroSvg({ ...buildView([], [], now), series, axes: stepAxes(undefined, series, now), usage: { tokens: 900_000, since: 0 } }).source
    // The agent end stays a plain dot; the green and blue ends share one ring with a wedge each.
    expect(svg.match(/<circle cx="[\d.]+" cy="[\d.]+" r="3.5"/g)?.length).toBe(1)
    expect(svg.match(/<circle cx="[\d.]+" cy="[\d.]+" r="5.5" fill="#07080F"\/>/g)?.length).toBe(1)
    expect(svg).toMatch(/<path d="[^"]+" fill="#A3E635" class="ft"\/>/)
    expect(svg).toMatch(/<path d="[^"]+" fill="#60A5FA" class="fr"\/>/)
  }
  setWidth(384)
})
