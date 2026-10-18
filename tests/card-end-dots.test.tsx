import { expect, test } from 'claude-code/testing'

import { dotGroups, endDots, MERGE_PX } from '../hooks/card-end-dots'
import { setWidth } from '../hooks/card-stage'
import { heroSvg } from '../hooks/hero-card'
import { heroStates } from '../scripts/sample'

const GREEN = { color: '#A3E635', cls: 'ft' }
const BLUE = { color: '#60A5FA', cls: 'fr' }
const YELLOW = { color: '#FACC15', cls: 'fa' }

test('two ends with equal values share one dot, split half green and half blue', () => {
  const { svg, boxes } = endDots([{ y: 240, ...GREEN }, { y: 240, ...BLUE }], 300, '#07080F')
  // One ring in the stage color, and one wedge each in its own color and light-theme class.
  expect(svg.filter(one => one.startsWith('<circle'))).toEqual(['<circle cx="300" cy="240" r="5.5" fill="#07080F"/>'])
  expect(svg.filter(one => one.includes('fill="#A3E635" class="ft"')).length).toBe(1)
  expect(svg.filter(one => one.includes('fill="#60A5FA" class="fr"')).length).toBe(1)
  expect(boxes).toEqual([{ x0: 294.5, x1: 305.5, y0: 234.5, y1: 245.5 }])
})

test('ends closer than MERGE_PX share a dot, at the limit too; ends MERGE_PX apart keep their own', () => {
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

test('the late-compact sample draws no two plain end dots on top of each other, at every width', () => {
  for (const width of [300, 384, 520, 720, 960]) {
    setWidth(width)
    const svg = heroSvg(heroStates()['late-compact']!).source
    const ys = [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)" r="3.5"/g)].map(match => Number(match[1])).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(MERGE_PX)
    }
    // The equal green and blue ends (both near zero) share the split dot.
    expect(svg).toMatch(/<path d="[^"]+" fill="#A3E635" class="ft"\/>/)
    expect(svg).toMatch(/<path d="[^"]+" fill="#60A5FA" class="fr"\/>/)
  }
  setWidth(384)
})
