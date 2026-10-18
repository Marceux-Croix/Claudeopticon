/**
 * The loop-3 reviewer's hero fuzz (UCR run 2026-10-17-1, slice R5), kept call for call so its state
 * names hold (s30-equal is the 31st state): 14 kinds of state built through the series API from a
 * mulberry32 source (seed 20261018), and the reviewer's own geometry check, independent of the
 * code's: Helvetica Neue ink widths and segments sampled every 0.25 px.
 */

import type { View } from '../hooks/card-types'
import { addAgentPoint, addCompact, addStep, emptySeries, seedSeries, WINDOW_MS } from '../hooks/series'

export const R5_KINDS = ['walk', 'late', 'equal', 'agentsOnly', 'tokensOnly', 'compactOnly', 'huge', 'tiny', 'burst', 'many', 'seeded', 'blip', 'flat', 'idle'] as const
export const R5_WIDTHS = [300, 384, 520, 720, 960] as const

const M = 60_000
const BASE = 1_792_000_000_000

/** mulberry32 from `seed`, the reviewer's source. */
function source(seed: number): () => number {
  let state = seed

  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function state(kind: string, rnd: () => number): View {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!
  const now = BASE + Math.floor(rnd() * 3_600_000)
  let s = emptySeries()
  let tok = 0
  let since = 0
  const scale = kind === 'huge' ? 5e7 : kind === 'tiny' ? 40 : pick([2e3, 2e4, 2e5, 2e6])
  const start = now - WINDOW_MS - 2 * M
  let agents = Math.floor(rnd() * 6)
  const lateAt = kind === 'late' ? now - Math.floor(rnd() * 100_000) : undefined
  let lateDone = false
  for (let t = start; t <= now; t += 2_000 + Math.floor(rnd() * (kind === 'burst' ? 20_000 : 60_000))) {
    if (kind !== 'tokensOnly' && kind !== 'compactOnly' && rnd() < 0.15) {
      agents = Math.max(0, agents + pick([-2, -1, 1, 2, 3]))
      s = { ...s, agents: addAgentPoint(s.agents, t, kind === 'idle' ? 0 : agents) }
    }
    if ((lateAt !== undefined && !lateDone && t >= lateAt) || (kind === 'many' && rnd() < 0.08) || (kind !== 'tokensOnly' && rnd() < 0.01)) {
      const isLate = lateAt !== undefined && !lateDone && t >= lateAt
      s = addCompact(s, isLate ? lateAt : t)
      lateDone = lateDone || isLate
      since = tok
      continue
    }
    if (kind === 'agentsOnly' || kind === 'compactOnly' || kind === 'idle') {
      continue
    }
    if (kind === 'flat' && t > now - 20 * M) {
      continue
    }
    const burst = kind === 'burst' && t > now - 90_000 ? 20 : 1
    const add = Math.floor(rnd() * scale * burst) + 1
    tok += add
    const at = kind === 'blip' && rnd() < 0.03 ? t + 3_600_000 : t
    s = { ...s, tokens: addStep(s.tokens, at, tok - since, s.seeds ?? [], add) }
  }
  if (kind === 'compactOnly') {
    s = addCompact(s, now - Math.floor(rnd() * 20 * M))
  }
  if (kind === 'equal') {
    agents = 4
    s = { ...s, agents: addAgentPoint(s.agents, now - 40_000, agents) }
  }
  const usage = { tokens: tok + 1e8, atCompact: 1e8 + since, since: 0 }
  if (kind === 'seeded') {
    s = seedSeries(s, { ...usage, tokens: usage.tokens + Math.floor(rnd() * scale * 30) }, now)
  }
  const live = s.agents[s.agents.length - 1]?.[1] ?? 0
  const n = Math.max(live, Math.floor(rnd() * 60))
  const ag = Array.from({ length: n }, (_, i) => ({ index: i, id: `a${i}`, description: 'x', type: 't', status: i < live ? 'running' : 'completed', isEnded: i >= live, startedAt: 0, toolCalls: 0, links: [] }))

  return { files: [], agents: ag, done: 0, active: 0, total: 0, archived: 0, live, now, usage, series: s } as unknown as View
}

/** The reviewer's `n` states, named `s<i>-<kind>`, in the order the reviewer drew them. */
export function r5States(n = 420): [string, View][] {
  const rnd = source(20261018)

  return Array.from({ length: n }, (_, i) => {
    const kind = R5_KINDS[i % R5_KINDS.length]!

    return [`s${i}-${kind}`, state(kind, rnd)]
  })
}

type Box = { x0: number; x1: number; y0: number; y1: number }
const meets = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
// Helvetica Neue ink widths at 12 px (em), independent of the code's table.
const BOLD: Record<string, number> = { '.': 0.278, k: 0.537, M: 0.87, B: 0.667 }
const REG: Record<string, number> = { ' ': 0.278, l: 0.222, i: 0.222, v: 0.5, e: 0.556, '/': 0.278, m: 0.833, n: 0.556 }
const wb = (s: string) => [...s].reduce((a, c) => a + 12 * (BOLD[c] ?? 0.556), 0)
const wr = (s: string) => [...s].reduce((a, c) => a + 12 * (REG[c] ?? 0.556), 0)

/** Whether a segment meets the open box, sampled every 0.25 px (not Liang-Barsky, so independent of the code). */
function segHits(ax: number, ay: number, bx: number, by: number, b: Box): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25))
  for (let i = 0; i <= n; i += 1) {
    const x = ax + ((bx - ax) * i) / n
    const y = ay + ((by - ay) * i) / n
    if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) {
      return true
    }
  }

  return false
}

/**
 * The reviewer's check of one drawn top card at width `w`: "HARD" lines for a label on a dot or a
 * label, a Compacted label on another, or anything out of the card; "SOFT" lines for a label on a
 * trace or on the Compacted label, or a Compacted label on a dot.
 */
export function r5Check(svg: string, w: number): string[] {
  const issues: string[] = []
  const labels: (Box & { t: string })[] = []
  for (const m of svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="end" font-size="12" stroke="[^"]+"[^>]*><tspan[^>]*class="(\w+)"[^>]*>([^<]*)<\/tspan>(?:<tspan[^>]*>([^<]*)<\/tspan>)?<\/text>/g)) {
    const x = Number(m[1])
    const y = Number(m[2])
    const tail = m[5] ?? ''
    labels.push({ x0: x - wb(m[4]!) - wr(tail), x1: x, y0: y - 8.6, y1: y + (tail.includes('/') ? 2.2 : 0.2), t: `${m[3]}:${m[4]}${tail}` })
  }
  const dots: Box[] = []
  for (const m of svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/g)) {
    const r = Number(m[3])
    // The Live dot, top right, is not an end dot.
    if (Number(m[2]) < 20) {
      continue
    }
    dots.push({ x0: Number(m[1]) - r, x1: Number(m[1]) + r, y0: Number(m[2]) - r, y1: Number(m[2]) + r })
  }
  const marks: Box[] = []
  for (const m of svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="(start|end)" fill="[^"]+" font-size="11">Compacted<\/text>/g)) {
    const x = Number(m[1])
    const y = Number(m[2])
    const width = 56.2
    marks.push({ x0: m[3] === 'end' ? x - width : x, x1: m[3] === 'end' ? x : x + width, y0: y - 7.9, y1: y + 2.3 })
  }
  const segs: [number, number, number, number, string][] = []
  for (const m of svg.matchAll(/<polyline points="([^"]+)"[^>]*class="(st|sr)"/g)) {
    const p = m[1]!.split(' ').map(q => q.split(',').map(Number))
    for (let i = 1; i < p.length; i += 1) {
      segs.push([p[i - 1]![0]!, p[i - 1]![1]!, p[i]![0]!, p[i]![1]!, m[2]!])
    }
  }
  for (const m of svg.matchAll(/<path d="([^"]+)" fill="none"[^>]*class="sa"/g)) {
    const t = m[1]!.split(/\s+/)
    let x = 0
    let y = 0
    for (let i = 0; i < t.length; ) {
      const c = t[i]!
      if (c === 'M') {
        x = Number(t[i + 1])
        y = Number(t[i + 2])
        i += 3
      } else if (c === 'H') {
        segs.push([x, y, Number(t[i + 1]), y, 'sa'])
        x = Number(t[i + 1])
        i += 2
      } else if (c === 'V') {
        segs.push([x, y, x, Number(t[i + 1]), 'sa'])
        y = Number(t[i + 1])
        i += 2
      } else {
        i += 1
      }
    }
  }
  labels.forEach((l, i) => {
    for (const d of dots) {
      if (meets(l, d)) {
        issues.push(`HARD ${l.t} on dot`)
      }
    }
    labels.forEach((o, k) => {
      if (k > i && meets(l, o)) {
        issues.push(`HARD ${l.t} on label ${o.t}`)
      }
    })
    for (const o of marks) {
      if (meets(l, o)) {
        issues.push(`SOFT ${l.t} on Compacted`)
      }
    }
    for (const c of new Set(segs.filter(s => segHits(s[0], s[1], s[2], s[3], l)).map(s => s[4]))) {
      issues.push(`SOFT ${l.t} on trace ${c}`)
    }
    if (l.x0 < 0 || l.x1 > w) {
      issues.push(`HARD ${l.t} out of card`)
    }
  })
  marks.forEach((a, i) => {
    marks.forEach((b, k) => {
      if (k > i && meets(a, b)) {
        issues.push('HARD Compacted on Compacted')
      }
    })
    for (const d of dots) {
      if (meets(a, d)) {
        issues.push('SOFT Compacted on dot')
      }
    }
  })

  return issues
}
