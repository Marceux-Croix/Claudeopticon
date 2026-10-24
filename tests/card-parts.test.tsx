import { expect, test } from 'claude-code/testing'

import { ORCH } from '../hooks/agent-identity'
import { actor, badge, badgeWidth, isBlinking, moreDisk, ownerDot, ownersFit, strip } from '../hooks/card-parts'
import { Blinks } from '../hooks/card-stage'
import type { View } from '../hooks/card-types'

const view = (status?: 'running') => ({ orchestrator: status === undefined ? undefined : { status } }) as unknown as View

test('isBlinking: an agent always blinks, the orchestrator only while its card shows it running', async () => {
  expect(isBlinking(0, view())).toBe(true)
  expect(isBlinking(ORCH, view('running'))).toBe(true)
  expect(isBlinking(ORCH, view())).toBe(false)
})

test('ownerDot blinks in the first live color, and is steady for an orchestrator that does not run alone', async () => {
  const blinks = new Blinks()
  const live = ownerDot(10, 20, 4, [ORCH, 0], view(), blinks)
  expect(live).toContain('class="k0"')
  expect(live).toContain('fill="#3987e5"')
  expect(live).toContain('cx="10" cy="20" r="4"')
  const steady = ownerDot(1, 2, 3, [ORCH], view(), blinks)
  expect(steady).not.toContain('class=')
  expect(steady).toContain('fill="#1fa7b8"')
  // No owners at all draws a steady dot, not a crash.
  expect(ownerDot(1, 2, 3, [], view(), blinks)).not.toContain('class=')
})

test('actor draws the disk and label, a match ring, and a state dot by state', async () => {
  const blinks = new Blinks()
  const none = actor(50, 50, 0, 'none', false, blinks)
  expect(none).toContain('>A1</text>')
  expect(none.match(/<circle/g)!.length).toBe(1)
  expect(actor(50, 50, 0, 'none', true, blinks).match(/<circle/g)!.length).toBe(2)
  expect(actor(50, 50, 1, 'working', false, blinks)).toContain('class="k0"')
  expect(actor(50, 50, 1, 'steady', false, blinks)).not.toContain('class=')
  expect(actor(50, 50, 1, 'failed', false, blinks)).toContain('#FF7A33')
  expect(actor(50, 50, ORCH, 'none', false, blinks)).toContain('>O</text>')
})

test('strip scales done and active shares, and draws no fill for a zero total', async () => {
  const full = strip(0, 0, 100, 1, 1, 4)
  expect(full).toContain('width="25"')
  expect(full).toContain('x="25"')
  expect(full).toContain('url(#progress)')
  const empty = strip(0, 0, 100, 0, 0, 0)
  expect(empty).not.toContain('url(#progress)')
  expect(empty.match(/<rect/g)!.length).toBe(1)
  // A tiny done share still shows 4 px.
  expect(strip(0, 0, 100, 1, 0, 1000)).toContain('width="4"')
})

test('badge sizes by label length, picks colors by kind, and escapes the label', async () => {
  expect(badgeWidth('')).toBe(12)
  expect(badgeWidth('done')).toBe(Math.round(4 * 6.4 + 12))
  expect(badge(100, 20, 'live', 'live')).toContain('fill="#FFFFFF"')
  expect(badge(100, 20, 'x', 'danger')).toContain('rgba(251,146,60,.16)')
  expect(badge(100, 20, 'x', 'neutral')).toContain('rgba(255,255,255,.1)')
  expect(badge(100, 20, 'a<b&"c', 'ok')).toContain('a&lt;b&amp;&quot;c')
  expect(badge(100, 20, 'x', 'ok')).not.toBe(badge(100, 20, 'x', 'neutral'))
})

test('ownersFit shows the chips that fit and leaves room for one "+M" chip for the rest', () => {
  const more = () => 30
  const ten = new Array<number>(10).fill(40)
  // All of them when they fit without the chip: 10 x 46 = 460.
  expect(ownersFit(ten, 460, 6, more)).toBe(10)
  // One short: the chip is needed, and 9 chips (9 x 46) with the chip (30) take 444.
  expect(ownersFit(ten, 459, 6, more)).toBe(9)
  expect(ownersFit(ten, 200, 6, more)).toBe(3)
  // The limit: not even one chip and the "+M" fit, so the "+M" stands alone.
  expect(ownersFit(ten, 60, 6, more)).toBe(0)
  expect(ownersFit([], 0, 6, more)).toBe(0)
  expect(moreDisk(100, 20, 7)).toContain('>+7<')
})
