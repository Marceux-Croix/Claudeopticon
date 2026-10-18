/** The top card: the totals line and the live graph of agents, tokens and tokens per minute. */

import { endDots } from './card-end-dots'
import { boxesMeet, endLabelWidth, labelBox, leaderLine, placeEndLabels } from './card-end-labels'
export { LEADER_PX, leaderLine } from './card-end-labels'
import type { Box, Trace } from './card-end-labels'
import { tokens } from './card-format'
import { ACCENT, FAINT, LABEL, PAD, RULE, stage, STAGE_BG, SUB, W } from './card-stage'
import { esc } from './card-text'
import type { Card, View } from './card-types'
import { emptySeries, onePerStep, QUANT_MS, stepAxes, tokenRate, WINDOW_MS, windowed } from './series'
import type { Point } from './series'

/** The top card's fixed height, in px. */
export const HERO_H = 300
/** Trace colors, dark theme as drawn; HERO_LIGHT_CSS swaps them in the light theme. */
export const AGENT_LINE = '#FACC15'
export const AGENT_LINE_LIGHT = '#CA8A04'
export const TOKEN_LINE = '#A3E635'
export const TOKEN_LINE_LIGHT = '#65A30D'
/** Tokens per minute: blue-400 on the dark stage, blue-600 on white (5.2:1, past WCAG AA for text). */
export const RATE_LINE = '#60A5FA'
export const RATE_LINE_LIGHT = '#2563EB'

/**
 * Trace colors by class, not by LIGHT attribute: LIGHT darkens the colors of text, and the traces
 * want their own light step.
 */
const HERO_LIGHT_CSS = `@media (prefers-color-scheme:light){.fa{fill:${AGENT_LINE_LIGHT}}.sa{stroke:${AGENT_LINE_LIGHT}}.ft{fill:${TOKEN_LINE_LIGHT}}.st{stroke:${TOKEN_LINE_LIGHT}}.pt{stop-color:${TOKEN_LINE_LIGHT}}.fr{fill:${RATE_LINE_LIGHT}}.sr{stroke:${RATE_LINE_LIGHT}}}`

/** An axis label: integers for agents; for tokens 6B, 15M, 3.75M, 450k, and zero as a plain "0", as in the approved sample. */
function axisLabel(value: number): string {
  // Up to 3 decimals, so 1.125M is not drawn as 1.13M.
  const trim = (n: number) => String(Math.round(n * 1000) / 1000)

  return value >= 1_000_000_000 ? `${trim(value / 1_000_000_000)}B` : value >= 1_000_000 ? `${trim(value / 1_000_000)}M` : value >= 1000 ? `${trim(value / 1000)}k` : trim(value)
}

/** The agents that ended. An idle agent is neither live nor finished, as the Agents heading counts it. */
export function finishedCount(view: View): number {
  return view.agents.filter(agent => agent.isEnded).length
}

/** One line for the terminal and the card's alt text: agents, then tokens. */
export function heroText(view: View): string {
  const n = view.agents.length
  const agents = n === 0 ? 'Agents: none yet.' : `Agents: ${view.live} live, ${finishedCount(view)} of ${n} finished.`
  const usage = view.usage
  const burn = usage === undefined ? 'Tokens: none counted yet.' : `Tokens: ${tokens(Math.max(0, usage.tokens - (usage.atCompact ?? 0)))} since compact, ${tokens(usage.tokens)} total session tokens.`

  return `${agents} ${burn}`
}

/** One run of the totals line: its words, and how it is inked. */
export type TotalsPart = { text: string; ink: 'label' | 'sub' | 'faint' }

/**
 * The totals line, with words dropped where the card is narrow: the longest form whose estimated
 * width (about 6.5 px a character at 13 px) fits `room` px at `size`, else the shortest form. The
 * agent count goes shorter, then goes, before "total session tokens" loses a word: the
 * owner's phrase stays at every width where it fits alone.
 */
export function totalsLine(total: string, done: number, n: number, size: number, room: number): { parts: TotalsPart[]; chars: number } {
  const dot: TotalsPart = { text: '  ·  ', ink: 'faint' }
  const head: TotalsPart[] = [{ text: total, ink: 'label' }, { text: ' total session tokens', ink: 'sub' }]
  const forms: TotalsPart[][] = [
    [...head, dot, { text: `${done} of ${n}`, ink: 'label' }, { text: ` ${n === 1 ? 'agent' : 'agents'} finished`, ink: 'sub' }],
    [...head, dot, { text: `${done} of ${n}`, ink: 'label' }, { text: ' finished', ink: 'sub' }],
    [...head, dot, { text: `${done}/${n}`, ink: 'label' }, { text: ' done', ink: 'sub' }],
    head,
    [{ text: total, ink: 'label' }, { text: ' tokens', ink: 'sub' }],
  ]
  const charsOf = (form: TotalsPart[]) => form.reduce((sum, part) => sum + part.text.length, 0)
  const form = forms.find(one => Math.round(charsOf(one) * 6.5 * (size / 13)) <= room) ?? forms[forms.length - 1]!

  return { parts: form, chars: charsOf(form) }
}

/** One entry of the key: the swatch color and class, and the words. */
type KeyEntry = { color: string; cls: string; text: string }
const KEY: readonly KeyEntry[] = [
  { color: AGENT_LINE, cls: 'sa', text: 'Live agents' },
  { color: TOKEN_LINE, cls: 'st', text: 'All tokens since compact' },
  { color: RATE_LINE, cls: 'sr', text: 'Tokens per minute' },
]
/** A key entry's width: a 14 px swatch, 5 px, its words (about 6.4 px a character at 12 px). Entries are KEY_GAP apart. */
const keyWidth = (entry: KeyEntry) => 19 + Math.round(entry.text.length * 6.4)
const KEY_GAP = 12

/** The key's entries in rows from `left`, each row no wider than `right` allows (one entry a row at the least). */
function keyRows(left: number, right: number): { x: number; entry: KeyEntry }[][] {
  const rows: { x: number; entry: KeyEntry }[][] = [[]]
  let x = left
  for (const entry of KEY) {
    if (rows[rows.length - 1]!.length > 0 && x + keyWidth(entry) > right) {
      rows.push([])
      x = left
    }
    rows[rows.length - 1]!.push({ x, entry })
    x += keyWidth(entry) + KEY_GAP
  }

  return rows
}

/** The least gap, in px, between two Compacted labels' boxes. */
export const COMPACT_CLEAR = 4

/**
 * Where the Compacted label of the line at `x` goes: right of it (its box from x + 5, 58 px wide,
 * "Compacted" at 11 px), else left of it, each only inside the plot [x0, x1] and COMPACT_CLEAR px
 * clear of every box in `taken` (the Compacted labels placed before it, and the end dots). Undefined when neither side is clear: the line is drawn
 * with no label.
 */
export function compactedBox(x: number, top: number, x0: number, x1: number, taken: readonly Box[]): { box: Box; isLeft: boolean } | undefined {
  const sides = [false, true].map(isLeft => ({ isLeft, box: { x0: isLeft ? x - 5 - 58 : x + 5, x1: isLeft ? x - 5 : x + 5 + 58, y0: top + 3, y1: top + 15 } }))
  const grown = (box: Box): Box => ({ x0: box.x0 - COMPACT_CLEAR, x1: box.x1 + COMPACT_CLEAR, y0: box.y0 - COMPACT_CLEAR, y1: box.y1 + COMPACT_CLEAR })
  // The right side is tried first, as before; at the right edge only the left side fits.
  return sides.find(side => side.box.x0 >= x0 - 0.5 && side.box.x1 <= x1 + 0.5 && !taken.some(one => boxesMeet(grown(one), side.box)))
}

/** The right axis title's center from the plot's right edge, in px, as in the approved sample. */
export const TITLE_DX = 63

const INK = { label: `fill="${LABEL}" font-weight="600"`, sub: `fill="${SUB}"`, faint: `fill="${FAINT}"` } as const

/**
 * The top card, at a fixed height: the token total and the agents finished in a line, a key, and
 * a two-axis plot of the last 30 minutes. Live agents are a step line on the left axis. On the
 * right axis, all tokens since the last compaction (main loop and agents, each model request at
 * the time it ran) are a line with a light fill, broken at each compaction, which also gets a
 * dashed line; the tokens per minute are a blue line on the same axis, whose top holds both.
 * Time snaps to QUANT_MS and axes come from `view.axes` (held across draws by the pane), so the
 * markup changes only with the data and with each QUANT_MS step.
 */
export function heroSvg(view: View): Card {
  const series = view.series ?? emptySeries()
  const now = Math.floor(view.now / QUANT_MS) * QUANT_MS
  const from = now - WINDOW_MS
  const axes = view.axes ?? stepAxes(undefined, series, view.now)
  const n = view.agents.length
  const usage = view.usage
  // The left margin holds the axis title and the agent labels (right-aligned at x0 - 10): the
  // title's center sits 46 px left of the plot, as in the approved sample, its glyphs from 9 px
  // left of the center to 3 px right of it.
  const x0 = W >= 700 ? 96 : 64
  // The right margin holds the right axis labels (about 6.3 px a character) from x1 + 10, then the
  // axis title, its glyphs 9 px right of its center, and 8 px to the edge. The title's center sits
  // 63 px right of the plot, as in the approved sample (x1 + 63 at 900 px), at every width; a widest
  // label longer than the sample's six characters pushes it on, so it stays 15 px clear of them.
  const rightLabels = [0, 1, 2, 3, 4].map(i => axisLabel((axes.tokens.max * i) / 4))
  const labelW = Math.ceil(Math.max(...rightLabels.map(label => label.length)) * 6.3)
  const titleDx = Math.max(TITLE_DX, 10 + labelW + 15)
  const x1 = W - Math.max(W >= 700 ? 96 : 0, titleDx + 9 + 8)
  const size = W < 520 ? 12 : 13
  // The totals keep clear of the Live dot (top right) when an agent is live, else of the edge; the
  // word "Live" is drawn only when it has room after them.
  const totals = totalsLine(usage === undefined ? '0' : tokens(usage.tokens), finishedCount(view), n, size, view.live > 0 ? W - PAD - 16 - 24 : W - 24 - PAD - 8)
  const totalsEnd = 24 + Math.round(totals.chars * 6.5 * (size / 13))
  // The key sits in the top row after the totals text when all of it fits before "Live"; else in
  // rows of its own under the totals, and the plot starts lower.
  const inlineLeft = totalsEnd + 29
  const isInline = inlineLeft + KEY.reduce((sum, entry) => sum + keyWidth(entry) + KEY_GAP, -KEY_GAP) <= W - PAD - 14 - 40
  const rows = isInline ? keyRows(inlineLeft, Infinity) : keyRows(24, W - 24)
  const keyY = isInline ? 25.5 : 47
  const top = isInline ? 56 : 62 + 16 * (rows.length - 1)
  const bottom = 250
  const height = bottom - top
  const f = (v: number) => String(Math.round(v * 10) / 10)
  const px = (t: number) => x0 + Math.min(1, Math.max(0, (t - from) / WINDOW_MS)) * (x1 - x0)
  const ya = (v: number) => bottom - Math.min(1, v / axes.agents.max) * height
  const yt = (v: number) => bottom - Math.min(1, v / axes.tokens.max) * height
  const parts: string[] = []

  parts.push(`<text x="24" y="30" font-size="${size}">${totals.parts.map(part => `<tspan ${INK[part.ink]}>${esc(part.text)}</tspan>`).join('')}</text>`)
  // "Live" and its dot sit top right. Where the totals text runs into them, the word goes first, then the dot.
  if (view.live > 0 && totalsEnd + 8 < W - PAD - 8) {
    const hasWord = totalsEnd + 8 < W - PAD - 14 - 28
    parts.push(`<circle cx="${W - PAD - 4}" cy="${PAD + 4}" r="4" fill="${ACCENT}" class="pulse"/>
<circle cx="${W - PAD - 4}" cy="${PAD + 4}" r="4" fill="${ACCENT}"/>${hasWord ? `
<text x="${W - PAD - 14}" y="${PAD + 8}" text-anchor="end" fill="${SUB}" font-size="12">Live</text>` : ''}`)
  }
  rows.forEach((row, r) => {
    const y = keyY + r * 16
    for (const { x, entry } of row) {
      parts.push(`<line x1="${x}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${entry.color}" class="${entry.cls}" stroke-width="2" stroke-linecap="round"/><text x="${x + 19}" y="${y + 4.5}" fill="${SUB}" font-size="12">${entry.text}</text>`)
    }
  })

  // Grid and both axes: 4 intervals; the left axis labels whole numbers only (a top of 6 labels 0, 3, 6).
  for (let i = 0; i <= 4; i += 1) {
    const y = bottom - (i / 4) * height
    const agentTick = (axes.agents.max * i) / 4
    parts.push(`<line x1="${x0}" y1="${f(y)}" x2="${x1}" y2="${f(y)}" stroke="${RULE}"/>`)
    if (Number.isInteger(agentTick)) {
      parts.push(`<text x="${x0 - 10}" y="${f(y + 4)}" text-anchor="end" fill="${LABEL}" font-size="11.5">${agentTick}</text>`)
    }
    parts.push(`<text x="${x1 + 10}" y="${f(y + 4)}" fill="${LABEL}" font-size="11.5">${rightLabels[i]}</text>`)
  }
  // Axis titles: the left one reads bottom to top, the right one top to bottom.
  const mid = f((top + bottom) / 2)
  parts.push(
    `<text transform="translate(${x0 - 46} ${mid}) rotate(-90)" text-anchor="middle" fill="${SUB}" font-size="12">Live agents</text>`,
    `<text transform="translate(${x1 + titleDx} ${mid}) rotate(90)" text-anchor="middle" fill="${SUB}" font-size="12">Tokens</text>`,
  )
  // The time labels are about 44 px wide; the two in the middle go when the plot is too narrow to keep a gap.
  const isRoomy = (x1 - x0) / 3 >= 78
  parts.push(
    `<text x="${x0}" y="270" text-anchor="start" fill="${FAINT}" font-size="11.5">30m ago</text>`,
    ...(isRoomy
      ? [
          `<text x="${f(x0 + (x1 - x0) / 3)}" y="270" text-anchor="middle" fill="${FAINT}" font-size="11.5">20m ago</text>`,
          `<text x="${f(x0 + ((x1 - x0) * 2) / 3)}" y="270" text-anchor="middle" fill="${FAINT}" font-size="11.5">10m ago</text>`,
        ]
      : []),
    `<text x="${x1}" y="270" text-anchor="end" fill="${FAINT}" font-size="11.5">Now</text>`,
  )

  // One point per QUANT_MS step is drawn: the x axis snaps to it, and the end labels place over the points drawn.
  const agentPts = onePerStep(windowed(series.agents, from))
  const tokenPts = windowed(series.tokens, from)
  const ratePts = tokenRate(series.tokens, view.now, series.seeds)
  // One mark a time.
  const cs = [...new Set(series.compacts.filter(one => one >= from && one <= now + QUANT_MS))].sort((a, b) => a - b)
  const hasData = [agentPts, tokenPts, ratePts].some(points => points.some(point => point[1] > 0)) || cs.length > 0
  if (!hasData) {
    parts.push(`<text x="${f((x0 + x1) / 2)}" y="${f((top + bottom) / 2)}" text-anchor="middle" fill="${FAINT}" font-size="13">No activity yet</text>`)
  } else {
    // Compactions: a dashed line each, here; their Compacted labels after the traces (below).
    const dashes: Trace[] = []
    for (const c of cs) {
      const x = px(c)
      parts.push(`<line x1="${f(x)}" y1="${top}" x2="${f(x)}" y2="${bottom}" stroke="${FAINT}" stroke-dasharray="3 4"/>`)
      dashes.push([[x, top], [x, bottom]])
    }
    // Tokens: one segment between compactions, each held flat to the compaction or to now.
    const segments: Point[][] = []
    for (const point of tokenPts) {
      const k = cs.filter(c => c <= point[0]).length
      ;(segments[k] ??= []).push(point)
    }
    if (tokenPts.length > 0) {
      parts.push(`<defs><linearGradient id="tk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TOKEN_LINE}" class="pt" stop-opacity=".18"/><stop offset="1" stop-color="${TOKEN_LINE}" class="pt" stop-opacity="0"/></linearGradient></defs>`)
    }
    // Every drawn trace in px, for the end labels to keep clear of.
    const traces: Trace[] = []
    segments.forEach((all, k) => {
      if (all === undefined || all.length === 0) {
        return
      }
      const segment = onePerStep(all)
      const end = cs[k] ?? now
      const last = segment[segment.length - 1]!
      const pts = [...segment, ...(last[0] < end ? [[end, last[1]] as Point] : [])]
      traces.push(pts.map(point => [px(point[0]), yt(point[1])]))
      const line = pts.map(point => `${f(px(point[0]))},${f(yt(point[1]))}`).join(' ')
      parts.push(
        `<polygon points="${f(px(pts[0]![0]))},${bottom} ${line} ${f(px(pts[pts.length - 1]![0]))},${bottom}" fill="url(#tk)"/>`,
        `<polyline points="${line}" fill="none" stroke="${TOKEN_LINE}" class="st" stroke-width="1.25" stroke-linejoin="round"/>`,
      )
    })
    // Tokens per minute: a line on the token axis, from where the data starts.
    if (ratePts.length > 0) {
      traces.push(ratePts.map(point => [px(point[0]), yt(point[1])]))
      parts.push(`<polyline points="${ratePts.map(point => `${f(px(point[0]))},${f(yt(point[1]))}`).join(' ')}" fill="none" stroke="${RATE_LINE}" class="sr" stroke-width="1.25" stroke-linejoin="round"/>`)
    }
    // Agents: a step line.
    if (agentPts.length > 0) {
      const path = agentPts.map((point, i) => (i === 0 ? `M ${f(px(point[0]))} ${f(ya(point[1]))}` : `H ${f(px(point[0]))} V ${f(ya(point[1]))}`)).join(' ')
      parts.push(`<path d="${path} H ${f(px(now))}" fill="none" stroke="${AGENT_LINE}" class="sa" stroke-width="1.5" stroke-linejoin="round"/>`)
      traces.push([
        ...agentPts.flatMap((point, i): [number, number][] => (i === 0 ? [[px(point[0]), ya(point[1])]] : [[px(point[0]), ya(agentPts[i - 1]![1])], [px(point[0]), ya(point[1])]])),
        [px(now), ya(agentPts[agentPts.length - 1]![1])],
      ])
    }
    // End dots and their values. Each label goes to the nearest place, above or under its dot or a
    // column to the left, and over the whole plot width when those all meet something, where it
    // meets no trace, dot, other label or Compacted label (card-end-labels); a far label
    // gets a leader to its dot, and a halo in the stage color stops a line that still must cross at
    // the letters when no place is clear. Ends that touch share one split dot (card-end-dots).
    const ends: { y: number; text: string; color: string; cls: string; tail?: string }[] = []
    const lastAgent = agentPts[agentPts.length - 1]
    const lastToken = tokenPts[tokenPts.length - 1]
    const lastRate = ratePts[ratePts.length - 1]
    if (lastAgent !== undefined) {
      ends.push({ y: ya(lastAgent[1]), text: `${lastAgent[1]}`, tail: ' live', color: AGENT_LINE, cls: 'fa' })
    }
    if (lastToken !== undefined) {
      ends.push({ y: yt(lastToken[1]), text: tokens(lastToken[1]), color: TOKEN_LINE, cls: 'ft' })
    }
    if (lastRate !== undefined) {
      ends.push({ y: yt(lastRate[1]), text: tokens(lastRate[1]), tail: '/min', color: RATE_LINE, cls: 'fr' })
    }
    const dots = endDots(ends, x1, STAGE_BG)
    // A Compacted label where its box clears every Compacted label drawn before it, and the end
    // dots, by COMPACT_CLEAR px: right of the line, else left of it, inside the plot.
    // Drawn after the traces, on a halo in the stage color, so a trace that crosses one never runs
    // through its letters.
    const obstacles: Box[] = []
    // The leaders go in here, under the Compacted labels and their halos.
    const leaderAt = parts.length
    for (const c of cs) {
      const x = px(c)
      const side = compactedBox(x, top, x0, x1, [...obstacles, ...dots.boxes])
      if (side !== undefined) {
        const at = `x="${f(side.isLeft ? x - 5 : x + 5)}" y="${top + 12}" text-anchor="${side.isLeft ? 'end' : 'start'}"`
        parts.push(
          `<text ${at} fill="none" stroke="${STAGE_BG}" stroke-width="3" stroke-linejoin="round" font-size="11" aria-hidden="true">Compacted</text>`,
          `<text ${at} fill="${FAINT}" font-size="11">Compacted</text>`,
        )
        obstacles.push(side.box)
      }
    }
    const labels = ends.map(end => ({ y: end.y, width: endLabelWidth(end.text, end.tail) }))
    // Over the whole plot width, and on into the left margin to 2 px right of the
    // agent axis labels (right-aligned at x0 - 10): at 300 px the plot is about 156 px wide, and the
    // clear place of a crowded state can start left of it.
    const places = placeEndLabels(labels, { traces, dots: dots.boxes, marks: obstacles, soft: dashes }, { right: x1 - 10, minY: top + 10, maxY: bottom - 4, gap: 14, left: x0 - 8, dotX: x1 })
    // A label placed far from its dot always gets a thin leader to it, drawn under the
    // Compacted labels, the dots and the label halos, so a leader never strikes through letters.
    const boxes = places.map((place, i) => labelBox(place.y, labels[i]!.width, place.right))
    const leaders: string[] = []
    ends.forEach((end, i) => {
      const leader = leaderLine(boxes[i]!, x1, end.y)
      if (leader !== undefined) {
        leaders.push(`<line x1="${f(leader[0])}" y1="${f(leader[1])}" x2="${f(leader[2])}" y2="${f(leader[3])}" stroke="${end.color}" class="${end.cls.replace(/^f/, 's')}" stroke-width="0.75" stroke-opacity="0.7"/>`)
      }
    })
    parts.splice(leaderAt, 0, ...leaders)
    parts.push(...dots.svg)
    ends.forEach((end, i) => {
      parts.push(
        `<text x="${f(places[i]!.right)}" y="${f(places[i]!.y)}" text-anchor="end" font-size="12" stroke="${STAGE_BG}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"><tspan fill="${end.color}" class="${end.cls}" font-weight="600">${esc(end.text)}</tspan>${end.tail === undefined ? '' : `<tspan fill="${SUB}">${end.tail}</tspan>`}</text>`,
      )
    })
  }
  const rate = ratePts[ratePts.length - 1]
  const alt = `Last 30 minutes: live agents, all tokens since compact, and tokens per minute. ${heroText(view)}${rate === undefined ? '' : ` Tokens per minute: ${tokens(rate[1])}.`}`

  return stage(HERO_H, parts.join('\n'), alt, HERO_LIGHT_CSS)
}
