import { expect, test } from 'claude-code/testing'

import { agentSvg } from '../hooks/agent-cards'
import { endLabelWidth, labelBox, segmentMeets } from '../hooks/card-end-labels'
import { tokens } from '../hooks/card-format'
import { setWidth } from '../hooks/card-stage'
import type { View } from '../hooks/card-types'
import { finishedCount, HERO_H, heroSvg, heroText, LEADER_PX, leaderLine, totalsLine } from '../hooks/hero-card'
import { r5States } from '../scripts/hero-fuzz-r5'
import { heroView as sampleHero } from '../scripts/sample'
import { addCompact, addPoint, emptySeries, QUANT_MS, stepAxes } from '../hooks/series'
import type { Axes, Point, Series } from '../hooks/series'
import { turnTokens } from '../hooks/token-usage'
import { buildView } from '../hooks/view-model'
import type { AgentRow } from '../types'

const row = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1', description: 'x', type: 'Explore', status: 'running', startedAt: 0, toolCalls: 0, brief: '', ...over,
})

test('an agent card shows the step and share its agent reports', async () => {
  const view = buildView(
    [],
    [
      row({ id: 'a', status: 'completed', endedAt: 5 }),
      row({ id: 'b', progress: { done: 1, total: 4 } }),
      row({ id: 'c' }),
      row({ id: 'd', progress: { done: 3, total: 4 } }),
    ],
    10,
  )
  const card = agentSvg(view.agents[3] ?? view.agents[0]!, view).source
  expect(card).toContain('Step 4 of 4')
  expect(card).toContain('75%')
})

const MIN = 60_000
const HERO_NOW = 100 * MIN

/** A view with a series, as the pane builds it: the axes stepped once. */
function graphView(series: Series, usage?: { tokens: number; atCompact?: number }, now = HERO_NOW) {
  const base = buildView([], [], now)

  return { ...base, series, axes: stepAxes(undefined, series, now), ...(usage === undefined ? {} : { usage: { ...usage, since: 0 } }) }
}

test('the token burn is the total in the top-left line, and the burn since the last compaction in the text and the right-axis label', async () => {
  const base = buildView([], [], 0)
  const usage = { tokens: 1_234_567, atCompact: 900_000, since: 0 }
  const after = heroSvg({ ...base, usage }).source
  expect(after).toContain('>1.23M<')
  // the totals line says "total session tokens".
  expect(after).toContain('total session tokens')
  expect(after).not.toContain('tokens total')
  expect(heroText({ ...base, usage })).toBe('Agents: none yet. Tokens: 334.6k since compact, 1.23M total session tokens.')
  expect(heroText({ ...base, usage: { tokens: 950, since: 0 } })).toContain('950 since compact, 950 total')
  expect(heroText(base)).toBe('Agents: none yet. Tokens: none counted yet.')
  expect([tokens(950), tokens(84_321), tokens(1_234_567), tokens(23_456_789)]).toEqual(['950', '84.3k', '1.23M', '23.46M'])
  expect(turnTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 })).toBe(10)
})

test('the top card has the token total and agents finished in one line, a legend, and no Todo ring', async () => {
  const rows = [row({ id: 'a', status: 'completed', endedAt: 5 }), row({ id: 'b', status: 'completed', endedAt: 5 }), row({ id: 'c' })]
  const view = { ...buildView([], rows, HERO_NOW), usage: { tokens: 623_590_000, atCompact: 578_780_000, since: 0 } }
  const card = heroSvg(view)
  const svg = card.source
  expect(svg).toContain('>623.59M</tspan><tspan fill="rgba(255,255,255,.62)"> total session tokens</tspan>')
  expect(svg).toContain('>2 of 3</tspan>')
  // at 384 px the longest totals form would run into the Live dot, so the word "agents" goes; at 720 px it stays.
  expect(svg).toContain('> finished</tspan>')
  setWidth(720)
  expect(heroSvg(view).source).toContain('> agents finished</tspan>')
  setWidth(384)
  expect(svg).toContain('>Live agents<')
  // and the token trace counts everything, and a third trace counts tokens per minute.
  expect(svg).toContain('>All tokens since compact<')
  expect(svg).toContain('>Tokens per minute<')
  expect(svg).not.toContain('(left axis)')
  expect(svg).toContain('30m ago')
  expect(svg).toContain('>20m ago<')
  expect(svg).toContain('>10m ago<')
  expect(svg).toContain('>Now<')
  expect(svg).toContain('>Live<')
  // The Todo ring is gone: no ring track, no Todo title, no percent.
  expect(svg).not.toContain('stroke-width="6"')
  expect(svg).not.toContain('>Todo<')
  expect(svg).not.toMatch(/>\d+%</)
  expect(svg).not.toContain('NaN')
  expect(card.height).toBe(HERO_H)
  // The card keeps its height with data, without, and with the key on its own row at a narrow width.
  setWidth(300)
  expect(heroSvg(view).height).toBe(HERO_H)
  setWidth(384)
})

test('the trace colors: agents yellow and tokens lime, dark as drawn and light by class', async () => {
  const series = { agents: [[HERO_NOW - 5 * MIN, 1], [HERO_NOW - 2 * MIN, 2]] as Point[], tokens: [[HERO_NOW - 4 * MIN, 1_000_000]] as Point[], compacts: [] }
  const svg = heroSvg(graphView(series, { tokens: 1_000_000 })).source
  expect(svg).toContain('stroke="#FACC15" class="sa" stroke-width="1.5"')
  expect(svg).toContain('stroke="#A3E635" class="st" stroke-width="1.25"')
  expect(svg).toContain('.fa{fill:#CA8A04}.sa{stroke:#CA8A04}.ft{fill:#65A30D}.st{stroke:#65A30D}.pt{stop-color:#65A30D}')
  expect(svg).toContain('stop-color="#A3E635" class="pt" stop-opacity=".18"')
  // The key has line swatches in the trace colors: in rows of its own at 384 px, in the top row at 960 px
  // (three entries no longer fit the top row at 720 px).
  expect(svg).toMatch(/<line x1="24" y1="47" x2="38" y2="47" stroke="#FACC15" class="sa" stroke-width="2"/)
  setWidth(960)
  const wide = heroSvg(graphView(series, { tokens: 1_000_000 })).source
  setWidth(384)
  expect(wide).toMatch(/<line x1="\d+" y1="25.5" x2="\d+" y2="25.5" stroke="#FACC15" class="sa" stroke-width="2"/)
  expect(wide).toMatch(/y1="25.5"[^>]*stroke="#A3E635" class="st" stroke-width="2"/)
  expect(wide).toMatch(/y1="25.5"[^>]*stroke="#60A5FA" class="sr" stroke-width="2"/)
  expect(svg).not.toContain('#8B5CF6" class="sa"')
  // Axis labels are neutral ink; end values take their trace's color.
  expect(svg).toMatch(/fill="rgba\(255,255,255,.88\)" font-size="11.5">4</)
  expect(svg).toMatch(/fill="rgba\(255,255,255,.88\)" font-size="11.5">1.5M</)
  expect(svg).toMatch(/<tspan fill="#FACC15" class="fa" font-weight="600">2<\/tspan><tspan fill="rgba\(255,255,255,.62\)"> live<\/tspan>/)
  expect(svg).toMatch(/<tspan fill="#A3E635" class="ft" font-weight="600">1.00M<\/tspan><\/text>/)
})

test('the plot starts the line at the left edge from the point before the window, and ignores older points', async () => {
  const series = { agents: [[HERO_NOW - 50 * MIN, 1], [HERO_NOW - 40 * MIN, 3], [HERO_NOW - 10 * MIN, 2]] as Point[], tokens: [], compacts: [] }
  const svg = heroSvg(graphView(series)).source
  // The point 40 minutes ago (value 3) is the last one before the window: the path starts at the left edge, x=64, at 3 of 4
  // (the key takes two rows of its own at 384 px, so the plot top is 78: 250 - 0.75 * 172 = 121).
  expect(svg).toMatch(/<path d="M 64 121 H /)
  expect(svg).not.toContain('>No activity yet<')
})

test('a compaction drops the token line to zero and shows a dashed line labeled Compacted', async () => {
  let series: Series = emptySeries()
  series = { ...series, tokens: addPoint(series.tokens, HERO_NOW - 20 * MIN, 5_000_000) }
  series = { ...series, tokens: addPoint(series.tokens, HERO_NOW - 12 * MIN, 9_000_000) }
  series = addCompact(series, HERO_NOW - 10 * MIN)
  series = { ...series, tokens: addPoint(series.tokens, HERO_NOW - 5 * MIN, 1_000_000) }
  expect(series.tokens.map(point => point[1])).toEqual([5_000_000, 9_000_000, 0, 1_000_000])
  expect(series.compacts).toEqual([HERO_NOW - 10 * MIN])
  const svg = heroSvg(graphView(series, { tokens: 10_000_000, atCompact: 9_000_000 })).source
  expect(svg).toContain('>Compacted<')
  expect(svg).toContain('stroke-dasharray="3 4"')
  // Two token segments: the line before the compaction and the one after it; and one tokens-per-minute line.
  expect(svg.match(/<polyline [^>]*class="st"/g)?.length).toBe(2)
  expect(svg.match(/<polyline [^>]*class="sr"/g)?.length).toBe(1)
  // The axis tops out at 9M, so the first segment's peak sits on the top gridline, and the second segment starts at the bottom.
  expect(svg).toContain('>9M<')
})

test('with no data the card draws the empty axes and says no activity yet', async () => {
  const svg = heroSvg(graphView(emptySeries())).source
  expect(svg).toContain('>No activity yet<')
  expect(svg).toContain('>150k<')
  // zero reads a plain 0, as in the approved sample (it read 0k).
  expect(svg).toContain('>0<')
  expect(svg).not.toContain('>0k<')
  expect(svg).not.toContain('<polyline')
  expect(svg).not.toContain('class="sa" stroke-width="1.5"')
  // Zeros alone are no activity.
  expect(heroSvg(graphView({ agents: [[HERO_NOW - MIN, 0]], tokens: [], compacts: [] })).source).toContain('>No activity yet<')
})

test('the axis labels: 4 grid intervals, whole numbers on the left, M and k on the right', async () => {
  const series = { agents: [[HERO_NOW - 5 * MIN, 5]] as Point[], tokens: [[HERO_NOW - 5 * MIN, 44_810_000]] as Point[], compacts: [] }
  const svg = heroSvg(graphView(series, { tokens: 44_810_000 })).source
  // Left top is 6, labeled 0, 3 and 6 only (1.5 and 4.5 are not whole). Right top is 60M: 0, 15M, 30M, 45M, 60M (zero reads 0, not 0M).
  expect((svg.match(/text-anchor="end" fill="rgba\(255,255,255,.88\)" font-size="11.5"/g) ?? []).length).toBe(3)
  for (const label of ['0', '15M', '30M', '45M', '60M']) {
    expect(svg).toContain(`>${label}<`)
  }
  expect(svg.match(/<line x1="64" /g)?.length).toBe(5)
  expect(svg).toContain('>44.81M<')
  expect(svg).toContain('> live</tspan>')
  expect(svg).toContain('font-weight="600">5</tspan>')
})

test('the top card changes only with the data and each 30 s step of time, so a redraw between steps sends the same markup', async () => {
  const series = { agents: [[HERO_NOW - 20 * MIN, 1]] as Point[], tokens: [[HERO_NOW - 20 * MIN, 1_000_000]] as Point[], compacts: [] }
  const one = heroSvg(graphView(series, { tokens: 1_000_000 }, HERO_NOW + 1000)).source
  const two = heroSvg(graphView(series, { tokens: 1_000_000 }, HERO_NOW + 29_000)).source
  expect(one).toBe(two)
  const later = heroSvg(graphView(series, { tokens: 1_000_000 }, HERO_NOW + QUANT_MS + 1000)).source
  expect(later).not.toBe(one)
  expect(QUANT_MS).toBe(30_000)
})

// ---------------------------------------------------------------- hero helpers

const NOW = 100 * QUANT_MS

type HeroOpts = { agents?: [number, number][]; tokens?: [number, number][]; axes?: Axes; usage?: number; rows?: AgentRow[]; compacts?: number[] }

function heroView(opts: HeroOpts = {}): View {
  const series: Series = { agents: opts.agents ?? [], tokens: opts.tokens ?? [], compacts: opts.compacts ?? [] }
  const base = buildView([], opts.rows ?? [], NOW)

  return { ...base, series, axes: opts.axes ?? { agents: { max: 4 }, tokens: { max: 150_000 } }, usage: opts.usage === undefined ? undefined : { tokens: opts.usage, since: 0 } }
}

/** The baselines of the end-value labels (text anchored end, font size 12, inside the plot). */
function endLabelYs(source: string): number[] {
  return [...source.matchAll(/<text x="[\d.]+" y="([\d.]+)" text-anchor="end" font-size="12"[^>]*><tspan fill="#[0-9A-F]+" class="f[atr]"/g)].map(match => Number(match[1]))
}

// added the tokens-per-minute label: the rule now holds for all three.
test('the end labels stay 14 px apart and inside the plot, clear of the time axis', () => {
  setWidth(720)
  const at = NOW - 60_000
  const states: [string, HeroOpts][] = [
    // Both values at zero: both dots on the bottom line (the old code drew one label on the time axis).
    ['bottom', { agents: [[at, 0]], tokens: [[at, 0]], compacts: [NOW - 120_000] }],
    // Both at the top of the plot (the old code drew both under their dots, on top of each other).
    ['top', { agents: [[at, 4]], tokens: [[at, 150_000]] }],
    // Close together in the middle.
    ['middle', { agents: [[at, 2]], tokens: [[at, 76_000]] }],
    // One at the top, the other just under it.
    ['top-near', { agents: [[at, 4]], tokens: [[at, 145_000]] }],
    // One at the bottom, the other just above it.
    ['bottom-near', { agents: [[at, 0]], tokens: [[at, 3_000]], compacts: [NOW - 120_000] }],
  ]
  for (const [, opts] of states) {
    const ys = endLabelYs(heroSvg(heroView(opts)).source)
    expect(ys.length).toBe(3)
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
      expect(Math.abs(ys[i]! - ys[j]!)).toBeGreaterThanOrEqual(14)
    }
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(60)
      expect(y).toBeLessThanOrEqual(246)
    }
  }
  setWidth(384)
})

test('at narrow widths text is dropped or shortened instead of overlapping', () => {
  const rows = Array.from({ length: 35 }, (_, i) => row({ id: `a${i}`, status: i < 33 ? 'completed' : 'running', endedAt: i < 33 ? 5 : undefined }))
  const opts: HeroOpts = { rows, usage: 17_380_000, axes: { agents: { max: 4 }, tokens: { max: 4_500_000 } }, agents: [[NOW - 60_000, 2]], tokens: [[NOW - 60_000, 1_500_000]] }
  setWidth(300)
  const narrow = heroSvg(heroView(opts)).source
  // the totals line drops words to fit, so "Live" keeps its room; the two middle time labels go.
  // The agent count goes before "total session tokens" loses a word (it read "17.38M tokens  ·  33/35 done").
  expect(narrow).toContain('> total session tokens</tspan>')
  expect(narrow).not.toContain('>33/35</tspan>')
  expect(narrow).not.toContain('20m ago')
  expect(narrow).not.toContain('10m ago')
  expect(narrow).toContain('30m ago')
  expect(narrow).toContain('>Now<')
  setWidth(720)
  const wide = heroSvg(heroView(opts)).source
  expect(wide).toContain('>Live</text>')
  expect(wide).toContain('20m ago')
  for (const width of [300, 384, 500, 640, 699, 700, 960]) {
    setWidth(width)
    const source = heroSvg(heroView(opts)).source
    // Each right axis label (about 6.3 px a character) ends inside the card with a margin.
    const right = [...source.matchAll(/<text x="([\d.]+)" y="[\d.]+" fill="rgba\(255,255,255,\.88\)" font-size="11\.5">([0-9.]+[Mk])<\/text>/g)]
    expect(right.length).toBeGreaterThan(0)
    for (const [, x, label] of right) {
      expect(Number(x) + label!.length * 6.3).toBeLessThanOrEqual(width - 4)
    }
  }
  setWidth(384)
})

// ---------------------------------------------------------------- 

test('the top card counts the agents that ended; an idle agent is neither live nor finished', () => {
  const idle = row({ id: 'i', status: 'running', idleSince: 5 })
  const done = row({ id: 'd', status: 'completed', endedAt: 5 })
  const failed = row({ id: 'f', status: 'failed', endedAt: 5 })
  const live = row({ id: 'l' })
  const states: [AgentRow[], string][] = [
    [[idle], 'Agents: 0 live, 0 of 1 finished.'],
    [[idle, done, live], 'Agents: 1 live, 1 of 3 finished.'],
    [[idle, idle, failed, failed], 'Agents: 0 live, 2 of 4 finished.'],
  ]
  for (const [rows, text] of states) {
    const view = heroView({ rows: rows.map((one, i) => ({ ...one, id: `${one.id}${i}` })) })
    expect(heroText(view)).toContain(text)
    const card = heroSvg(view)
    expect(card.alt).toContain(text)
    expect(card.source).toContain(`>${finishedCount(view)} of ${rows.length}</tspan>`)
  }
})

// ----------------------------------------------------------------, ,, 

/** Every end label: its baseline and its words (value and tail). */
function endLabels(source: string): { x: number; y: number; text: string }[] {
  return [...source.matchAll(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="end" font-size="12"[^>]*><tspan[^>]*>([^<]+)<\/tspan>(?:<tspan[^>]*>([^<]+)<\/tspan>)?<\/text>/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]), text: `${match[3]}${match[4] ?? ''}` }))
}

test('a third trace, tokens per minute, in blue on the token axis, with its key entry, end dot and end label', () => {
  setWidth(720)
  const series: Series = { agents: [[NOW - 20 * MIN, 1]], tokens: [[NOW - 20 * MIN, 0], [NOW - 3 * MIN, 900_000], [NOW - 45_000, 1_200_000]], compacts: [] }
  const svg = heroSvg(graphView(series, { tokens: 1_200_000 }, NOW)).source
  setWidth(384)
  expect(svg).toContain('stroke="#60A5FA" class="sr" stroke-width="1.25"')
  expect(svg).toContain('.fr{fill:#2563EB}.sr{stroke:#2563EB}')
  expect(svg).toMatch(/stroke="#60A5FA" class="sr" stroke-width="2"[^>]*\/><text[^>]*>Tokens per minute</)
  expect(svg).toMatch(/<circle cx="[\d.]+" cy="[\d.]+" r="3.5" fill="#60A5FA" class="fr"/)
  // The minute before now holds the last request, 300k: the label reads "300.0k/min".
  expect(endLabels(svg).map(label => label.text)).toContain('300.0k/min')
  // Axis titles: "Live agents" bottom to top, 46 px left of the plot (x0 = 96 at 720 px); "Tokens" top to bottom.
  expect(svg).toMatch(/<text transform="translate\(50 [\d.]+\) rotate\(-90\)" text-anchor="middle"[^>]*>Live agents</)
  expect(svg).toMatch(/<text transform="translate\([\d.]+ [\d.]+\) rotate\(90\)" text-anchor="middle"[^>]*>Tokens</)
  expect(heroSvg(graphView(series, { tokens: 1_200_000 }, NOW)).alt).toContain('Tokens per minute:')
})

test('nothing clips from 300 to 960 px: axis titles and labels stay inside the card', () => {
  const series: Series = { agents: [[NOW - 20 * MIN, 3]], tokens: [[NOW - 20 * MIN, 0], [NOW - MIN, 1_125_000]], compacts: [] }
  for (const width of [300, 384, 520, 700, 720, 960]) {
    setWidth(width)
    const svg = heroSvg(graphView(series, { tokens: 1_125_000 }, NOW)).source
    const left = Number(/translate\(([\d.]+) [\d.]+\) rotate\(-90\)/.exec(svg)?.[1])
    const right = Number(/translate\(([\d.]+) [\d.]+\) rotate\(90\)/.exec(svg)?.[1])
    // A rotated 12 px title spans 9 px to the side of its tops and 3 px to the other.
    expect(left - 9).toBeGreaterThanOrEqual(4)
    expect(right + 9).toBeLessThanOrEqual(width - 4)
    // The right axis labels end before the right title starts.
    for (const [, x, label] of svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" fill="rgba\(255,255,255,\.88\)" font-size="11\.5">([0-9.]+[Mk])<\/text>/g)) {
      expect(Number(x) + label!.length * 6.3).toBeLessThan(right - 3)
    }
  }
  setWidth(384)
})

test('the end labels have a halo in the stage color, and sit off the traces in the owner crossing case', () => {
  // Agents 3 then 2 near the end, tokens climbing through the agent level at the right edge: "2 live" must not sit on the token line.
  const crossing: Series = { agents: [[NOW - 30 * MIN, 1], [NOW - 20 * MIN, 3], [NOW - 150_000, 2]], tokens: Array.from({ length: 31 }, (_, i) => [NOW - (30 - i) * MIN, 3_330_000 + i * 1_000_000] as Point), compacts: [] }
  for (const width of [300, 384, 520, 720, 960]) {
    setWidth(width)
    const svg = heroSvg(graphView(crossing, { tokens: 659_630_000, atCompact: 626_300_000 }, NOW)).source
    expect(svg).toMatch(/text-anchor="end" font-size="12" stroke="#07080F" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/)
    const labels = endLabels(svg)
    expect(labels.map(label => label.text)).toEqual(['2 live', '33.33M', '1.00M/min'])
    // The token line's y at the right end of the plot, from its last two vertices, against the "2 live" box.
    const line = /<polyline points="([^"]+)" fill="none" stroke="#A3E635"/.exec(svg)![1]!.split(' ').map(pair => pair.split(',').map(Number))
    const [a, b] = [line[line.length - 2]!, line[line.length - 1]!]
    const live = labels[0]!
    // The label's own right edge: it may sit a column left of the dots (, wider candidates).
    const xEnd = live.x
    // The label's width from its glyphs (card-end-labels; it was an estimate of 38 px, 9 px wider than the ink).
    const xStart = xEnd - endLabelWidth('2', ' live')
    const yAt = (x: number) => a[1]! + ((x - a[0]!) / (b[0]! - a[0]!)) * (b[1]! - a[1]!)
    const [lo, hi] = [Math.min(yAt(xStart), yAt(xEnd)), Math.max(yAt(xStart), yAt(xEnd))]
    expect(hi < live.y - 10 || lo > live.y + 3).toBe(true)
  }
  setWidth(384)
})

test('with a compaction in the last minute no end label sits on the Compacted label', () => {
  // The verifier's state: a compaction about a minute ago, the agent label at the top right.
  const series: Series = { agents: [[NOW - 20 * MIN, 4]], tokens: [[NOW - 20 * MIN, 20_000_000], [NOW - 70_000, 0], [NOW - 40_000, 400_000]], compacts: [NOW - 70_000] }
  for (const width of [300, 384, 520, 720, 960]) {
    setWidth(width)
    const svg = heroSvg(graphView(series, { tokens: 400_000 }, NOW)).source
    const compacted = /<text x="([\d.]+)" y="([\d.]+)" text-anchor="end" fill="[^"]+" font-size="11">Compacted</.exec(svg)
    expect(compacted).not.toBeNull()
    const cy = Number(compacted![2])
    for (const label of endLabels(svg)) {
      // A label box (baseline - 10 to + 3) never meets the Compacted box (its baseline - 9 to + 3), both at the right edge.
      expect(label.y - 10 >= cy + 3 || label.y + 3 <= cy - 9).toBe(true)
    }
  }
  setWidth(384)
})

test('the totals line says total session tokens, and drops words to fit at narrow widths', () => {
  const rows = Array.from({ length: 50 }, (_, i) => row({ id: `a${i}`, status: i < 47 ? 'completed' : 'running', endedAt: i < 47 ? 5 : undefined }))
  const opts: HeroOpts = { rows, usage: 659_630_000 }
  const words = (svg: string) => [.../<text x="24" y="30"[^>]*>(.*?)<\/text>/.exec(svg)![1]!.matchAll(/>([^<]*)</g)].map(match => match[1]).join('')
  setWidth(960)
  expect(words(heroSvg(heroView(opts)).source)).toBe('659.63M total session tokens  ·  47 of 50 agents finished')
  for (const width of [300, 340, 384, 520]) {
    setWidth(width)
    const svg = heroSvg(heroView(opts)).source
    const text = words(svg)
    expect(text.startsWith('659.63M')).toBe(true)
    // About 6.5 px a character at 13 px (12 px under 520): the line ends before the Live dot (W - 24).
    const size = width < 520 ? 12 : 13
    expect(24 + text.length * 6.5 * (size / 13)).toBeLessThanOrEqual(width - 24 - 16)
  }
  setWidth(300)
  // The agent count goes first, so the owner's phrase stays (it read '659.63M tokens  ·  47/50 done').
  expect(words(heroSvg(heroView(opts)).source)).toBe('659.63M total session tokens')
  setWidth(384)
  expect(heroText(heroView(opts))).toContain('659.63M total session tokens.')
})

// ---------------------------------------------------------------- and, loop-1 tail (H1)

/** The grid's right end (x1), the right axis labels and the right title's center x. */
function rightAxis(svg: string): { x1: number; labels: { x: number; text: string }[]; title: number } {
  const x1 = Number(/<line x1="[\d.]+" y1="[\d.]+" x2="([\d.]+)" y2="[\d.]+" stroke="rgba\(255,255,255,\.08\)"\/>/.exec(svg)![1])
  const labels = [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" fill="rgba\(255,255,255,\.88\)" font-size="11\.5">([^<]+)<\/text>/g)].map(match => ({ x: Number(match[1]), text: match[2]! }))
  const title = Number(/translate\(([\d.]+) [\d.]+\) rotate\(90\)/.exec(svg)![1])

  return { x1, labels, title }
}

test('the zero axis label reads 0 on every token axis, as in the approved sample', () => {
  for (const top of [150_000, 4_500_000, 60_000_000, 9_000_000_000]) {
    const svg = heroSvg({ ...graphView({ agents: [[NOW - 5 * MIN, 1]], tokens: [[NOW - 5 * MIN, top / 2]], compacts: [] }, { tokens: top / 2 }, NOW), axes: { agents: { max: 4 }, tokens: { max: top } } }).source
    const zero = rightAxis(svg).labels[0]!
    expect(zero.text).toBe('0')
    expect(svg).not.toMatch(/>0[Mk]</)
  }
})

test('the right axis title sits at x1 + 63, as in the approved sample, clear of the widest axis label at every width', () => {
  // The sample: 900 px wide, x1 = 790, the title at 853 (x1 + 63).
  for (const top of [150_000, 4_500_000, 60_000_000]) {
    for (const width of [300, 384, 520, 699, 700, 720, 900, 960]) {
      setWidth(width)
      const svg = heroSvg({ ...graphView({ agents: [[NOW - 5 * MIN, 1]], tokens: [[NOW - 5 * MIN, top / 2]], compacts: [] }, { tokens: top / 2 }, NOW), axes: { agents: { max: 4 }, tokens: { max: top } } }).source
      const { x1, labels, title } = rightAxis(svg)
      expect(title).toBe(x1 + 63)
      // A rotated 12 px title spans 3 px left of its center and 9 px right; the widest label (6.3 px a character) ends before it.
      for (const label of labels) {
        expect(label.x + label.text.length * 6.3).toBeLessThan(title - 3)
      }
      expect(title + 9).toBeLessThanOrEqual(width - 4)
    }
  }
  setWidth(384)
})

test('at 300 px the sample reads "623.59M total session tokens": the agent count goes first', () => {
  const words = (svg: string) => [.../<text x="24" y="30"[^>]*>(.*?)<\/text>/.exec(svg)![1]!.matchAll(/>([^<]*)</g)].map(match => match[1]).join('')
  setWidth(300)
  expect(words(heroSvg(sampleHero).source)).toBe('623.59M total session tokens')
  // Where the short count fits, it stays, after the full phrase.
  setWidth(340)
  expect(words(heroSvg(sampleHero).source)).toBe('623.59M total session tokens  ·  33/35 done')
  setWidth(384)
  expect(words(heroSvg(sampleHero).source)).toContain('623.59M total session tokens  ·  33 of 35')
  // The phrase loses a word only where it cannot fit alone.
  expect(totalsLine('623.59M', 33, 35, 12, 160).parts.map(part => part.text).join('')).toBe('623.59M tokens')
  expect(totalsLine('623.59M', 33, 35, 12, 170).parts.map(part => part.text).join('')).toBe('623.59M total session tokens')
})

// ---------------------------------------------------------------- loop 2, batch J5

test('M4 a compaction 10 s ago keeps its marker: the plot snaps now down, and the marker stays up to one step past it', () => {
  // now is 25 s into a QUANT_MS step, so the snapped now is 25 s behind it and the compaction (at now - 10 s) is 15 s past the snapped now.
  const now = NOW + 25_000
  const series: Series = { agents: [], tokens: [[now - 20 * MIN, 200_000], [now - 10_000, 0]], compacts: [now - 10_000] }
  const svg = heroSvg({ ...buildView([], [], now), series, axes: { agents: { max: 4 }, tokens: { max: 300_000 } }, usage: { tokens: 200_000, atCompact: 200_000, since: 0 } }).source
  expect(svg).toContain('>Compacted<')
  expect(svg).toContain('stroke-dasharray="3 4"')
  // The limit: exactly one step past the snapped now still shows; one ms more does not (a clock that ran ahead).
  const edge = (at: number) => heroSvg({ ...buildView([], [], now), series: { ...series, compacts: [at] }, axes: { agents: { max: 4 }, tokens: { max: 300_000 } } }).source
  expect(edge(NOW + QUANT_MS)).toContain('>Compacted<')
  expect(edge(NOW + QUANT_MS + 1)).not.toContain('>Compacted<')
})

// ---------------------------------------------------------------- loop 3, batch L5

/** The visible Compacted labels of a drawn top card, as boxes (58 px wide, as compactedBox places them). */
function compactedBoxes(svg: string): { x0: number; x1: number }[] {
  return [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="(start|end)" fill="[^"]+" font-size="11">Compacted<\/text>/g)].map(m =>
    m[2] === 'end' ? { x0: Number(m[1]) - 58, x1: Number(m[1]) } : { x0: Number(m[1]), x1: Number(m[1]) + 58 },
  )
}

/**
 * A top card at 384 px (plot x 64 to 304, 8 px a minute) with compactions at the given x positions,
 * each with its fall to zero; `isTokenTop` puts the token end at the top of the plot instead (its dot then sits where a Compacted label goes).
 */
function compactedAt(xs: readonly number[], isTokenTop = false): string {
  setWidth(384)
  const from = HERO_NOW - 30 * MIN
  const at = (x: number) => from + (x - 64) * 7500
  const tokens: Point[] = isTokenTop ? [[from - MIN, 300_000]] : [[from - MIN, 1000], ...xs.map((x): Point => [at(x), 0])]

  return heroSvg({ ...buildView([], [], HERO_NOW), series: { agents: [], tokens, compacts: xs.map(at) }, axes: { agents: { max: 4 }, tokens: { max: 300_000 } } }).source
}

test('a Compacted label is drawn only where its box clears every earlier Compacted label by 4 px, in three constructed states', () => {
  const apart = (boxes: { x0: number; x1: number }[]) => boxes.every((one, i) => boxes.every((two, k) => k <= i || one.x1 + 4 <= two.x0 || two.x1 + 4 <= one.x0))
  // State 1, the reported defect behind a valid first case: a label right of the line at x 200 (box 205 to 263), then a
  // line at 280, 80 px on, whose label must flip left (217 to 275, on the first). The old rule (x - last x > 70) drew both.
  expect(compactedBoxes(compactedAt([200, 280]))).toEqual([{ x0: 205, x1: 263 }])
  // State 2, the limit: a second box 4.5 px clear is drawn (lines at 100 and 162.5: 105 to 163, 167.5 to 225.5); 3.5 px clear it is not.
  expect(compactedBoxes(compactedAt([100, 162.5]))).toEqual([{ x0: 105, x1: 163 }, { x0: 167.5, x1: 225.5 }])
  expect(compactedBoxes(compactedAt([100, 161.5]))).toEqual([{ x0: 105, x1: 163 }])
  // State 3, the population the fix excludes: a line at the right edge whose left label would sit on the token end dot at
  // the top of the plot gets no label; with the dot at the bottom, it gets one, left of the line.
  expect(compactedBoxes(compactedAt([304], true))).toEqual([])
  expect(compactedBoxes(compactedAt([304]))).toEqual([{ x0: 241, x1: 299 }])
  // Many compactions at every spacing: never two labels on each other.
  for (let step = 20; step <= 130; step += 3) {
    const xs = Array.from({ length: 12 }, (_, k) => 64 + k * step).filter(x => x <= 304)
    expect(apart(compactedBoxes(compactedAt(xs)))).toBe(true)
  }
  setWidth(384)
})

test('the Compacted label is drawn after the traces, on a halo in the stage color', () => {
  setWidth(384)
  const from = HERO_NOW - 30 * MIN
  const series: Series = { agents: [[from - MIN, 4]], tokens: [[from - MIN, 1000], [from + 10 * MIN, 0]], compacts: [from + 10 * MIN] }
  const svg = heroSvg({ ...buildView([], [], HERO_NOW), series, axes: { agents: { max: 4 }, tokens: { max: 300_000 } } }).source
  const halo = svg.indexOf('fill="none" stroke="#07080F" stroke-width="3" stroke-linejoin="round" font-size="11" aria-hidden="true">Compacted<')
  const label = svg.indexOf('font-size="11">Compacted<')
  const agent = svg.indexOf('class="sa" stroke-width="1.5"')
  expect(halo).toBeGreaterThan(-1)
  // The agent line, then the halo, then the label: a line that crosses the label never runs through its letters.
  expect(agent).toBeGreaterThan(-1)
  expect(agent).toBeLessThan(halo)
  expect(halo).toBeLessThan(label)
})

test('a stored series of 2000 points draws one point per 30 s step, so the end labels place over about 60 segments', () => {
  const pts: Point[] = Array.from({ length: 2000 }, (_, i): Point => [HERO_NOW - 31 * MIN + i * 900, i * 10])
  const series: Series = { agents: pts.map((p): Point => [p[0], p[1] % 7]), tokens: pts, compacts: [] }
  setWidth(960)
  const started = performance.now()
  const svg = heroSvg({ ...buildView([], [], HERO_NOW), series, usage: { tokens: 20_000, since: 0 } }).source
  const ms = performance.now() - started
  setWidth(384)
  const tokenLine = /<polyline points="([^"]+)" fill="none" stroke="#A3E635" class="st"/.exec(svg)![1]!.split(' ')
  const agentSteps = /<path d="([^"]+)" fill="none" stroke="#FACC15" class="sa"/.exec(svg)![1]!.split('H').length - 1
  // 29 minutes of 30 s steps, the point before the window and the hold to now: at most 63; the old code drew about 1930.
  expect(tokenLine.length).toBeLessThanOrEqual(63)
  expect(agentSteps).toBeLessThanOrEqual(63)
  console.log(`heroSvg of a 2000-point series at 960 px: ${ms.toFixed(1)} ms (358 ms before the fix, reviewer probe S7)`)
})

test('two compactions at one time draw one dashed line and one label, and addCompact never adds a time twice', () => {
  setWidth(384)
  const t = HERO_NOW - 5 * MIN
  // [t, t] as an older build stored it.
  const svg = heroSvg({ ...buildView([], [], HERO_NOW), series: { agents: [], tokens: [[t - MIN, 1000], [t, 0]], compacts: [t, t] }, usage: { tokens: 1000, atCompact: 1000, since: 0 } }).source
  expect(svg.split('stroke-dasharray').length - 1).toBe(1)
  expect(compactedBoxes(svg).length).toBe(1)
  expect(addCompact(addCompact({ agents: [], tokens: [[t - MIN, 1000]], compacts: [] }, t), t).compacts).toEqual([t])
})

test('"since compact" is never negative, even for a count at compact above the total', () => {
  const base = buildView([], [], 0)
  expect(heroText({ ...base, usage: { tokens: 1000, atCompact: 5_000_000, since: 0 } })).toBe('Agents: none yet. Tokens: 0 since compact, 1.0k total session tokens.')
  // The limit (equal counts) and the normal case.
  expect(heroText({ ...base, usage: { tokens: 1000, atCompact: 1000, since: 0 } })).toContain('Tokens: 0 since compact')
  expect(heroText({ ...base, usage: { tokens: 1500, atCompact: 1000, since: 0 } })).toContain('Tokens: 500 since compact')
})

test('a label far from its dot gets a leader line; one near it does not, in three constructed states', () => {
  // State 1, the defect behind a valid first case: a label 110 px left of its dot (as "0/min" in the reviewer's s9) gets a leader.
  const far = leaderLine({ x0: 150, x1: 190, y0: 100, y1: 112 }, 300, 106)
  expect(far).toBeDefined()
  expect(far!.map(n => Math.round(n * 10) / 10)).toEqual([192, 106, 295, 106])
  // State 2, the limit: a box exactly LEADER_PX from the dot gets none; 1 px further it does.
  expect(leaderLine({ x0: 236, x1: 276, y0: 100, y1: 112 }, 276 + LEADER_PX, 106)).toBeUndefined()
  expect(leaderLine({ x0: 235, x1: 275, y0: 100, y1: 112 }, 276 + LEADER_PX, 106)).toBeDefined()
  // State 3, the excluded population: the home place, 10 px left of and just above the dot, draws none.
  expect(leaderLine({ x0: 250, x1: 290, y0: 94, y1: 106 }, 300, 109)).toBeUndefined()
  // In a drawn card: the reviewer's s30-equal state at 300 px moves its /min label far left, with a leader in its color.
  setWidth(300)
  const s30 = r5States(31)[30]!
  expect(s30[0]).toBe('s30-equal')
  expect(heroSvg(s30[1]).source).toMatch(/<line [^>]*stroke="#60A5FA" class="sr" stroke-width="0.75"/)
  // Over the reviewer's states at 300 px, no leader crosses another end label (s90-huge had one through "807.23M").
  const crossed: string[] = []
  for (const [name, view] of r5States(140)) {
    const svg = heroSvg(view).source
    const boxes = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="end" font-size="12" stroke=[^>]*><tspan [^>]*>([^<]*)<\/tspan>(?:<tspan [^>]*>([^<]*)<\/tspan>)?/g)].map(m => labelBox(Number(m[2]), endLabelWidth(m[3]!, m[4] ?? ''), Number(m[1])))
    for (const m of svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" [^>]*stroke-width="0.75"/g)) {
      const segment = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const
      // A leader starts 2 px off its own label's box, so it meets only another label's.
      if (boxes.some(box => segmentMeets(segment, box))) {
        crossed.push(name)
      }
    }
  }
  expect(crossed).toEqual([])
  setWidth(384)
})
