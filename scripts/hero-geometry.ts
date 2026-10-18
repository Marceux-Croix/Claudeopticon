/**
 * The end-label geometry of a drawn top card, read back from its SVG: each end label's ink box (from
 * Helvetica Neue glyph widths, the UCR verifier's, independent of the code's estimate) and the box
 * the code places by (labelBox, endLabelWidth), the dots, the Compacted label and the trace segments;
 * what overlaps; and whether a clear place for every label existed in the home column.
 */

import { endLabelWidth, labelBox } from '../hooks/card-end-labels'
import type { Box } from '../hooks/card-end-labels'

type Named = Box & { what: string }
/** A trace segment from (ax, ay) to (bx, by), and the class of its trace (st, sr or sa). */
type Seg = [number, number, number, number, string]
export type HeroGeometry = { labels: (Named & { code: Box; cls: string })[]; dots: Named[]; marks: Named[]; segs: Seg[]; top: number; right?: number }

// Helvetica Neue widths at 12 px, in em (the verifier's).
const BOLD: Record<string, number> = { '.': 0.278, k: 0.574, M: 0.87, '0': 0.556 }
const REG: Record<string, number> = { ' ': 0.278, l: 0.222, i: 0.222, v: 0.5, e: 0.556, '/': 0.278, m: 0.833, n: 0.556 }
const wBold = (s: string) => [...s].reduce((a, c) => a + 12 * (BOLD[c] ?? 0.556), 0)
const wReg = (s: string) => [...s].reduce((a, c) => a + 12 * (REG[c] ?? 0.556), 0)

export function heroGeometry(svg: string): HeroGeometry {
  const labels: HeroGeometry['labels'] = []
  for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="end" font-size="12" stroke="[^"]+" stroke-width="3"[^>]*><tspan fill="[^"]+" class="(\w+)" font-weight="600">([^<]*)<\/tspan>(?:<tspan fill="[^"]+">([^<]*)<\/tspan>)?<\/text>/g)) {
    const x = Number(m[1])
    const y = Number(m[2])
    const tail = m[5] ?? ''
    const w = wBold(m[4]!) + wReg(tail)
    // Ink: cap height about 8.6 px above the baseline (9 kept); '/' goes 2 px under it.
    labels.push({ x0: x - w, x1: x, y0: y - 9, y1: y + (tail.includes('/') ? 2 : 0.5), what: `${m[3]}:${m[4]}${tail}`, cls: m[3]!, code: labelBox(y, endLabelWidth(m[4]!, tail), x) })
  }
  const marks: Named[] = []
  for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="(end|start)" fill="[^"]+" font-size="11">Compacted<\/text>/g)) {
    const x = Number(m[1])
    const y = Number(m[2])
    const w = 11 * 4.9
    marks.push({ x0: m[3] === 'end' ? x - w : x, x1: m[3] === 'end' ? x : x + w, y0: y - 8, y1: y + 2.5, what: 'Compacted' })
  }
  const dots: Named[] = []
  let right: number | undefined
  for (const m of svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="(3.5|5.5)" fill="([^"]+)"(?: class="(\w+)")?/g)) {
    const x = Number(m[1])
    const y = Number(m[2])
    // A plain dot is 3.5 px with a 1 px ring drawn past it; a shared dot's ring circle is 5.5 px.
    const r = m[3] === '3.5' ? 4.5 : 5.5
    right = x - 10
    dots.push({ x0: x - r, x1: x + r, y0: y - r, y1: y + r, what: `dot:${m[5] ?? 'shared'}` })
  }
  const segs: Seg[] = []
  for (const m of svg.matchAll(/<polyline points="([^"]+)"[^>]*class="(st|sr)"/g)) {
    const pts = m[1]!.split(' ').map(p => p.split(',').map(Number) as [number, number])
    for (let i = 1; i < pts.length; i += 1) {
      segs.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1], m[2]!])
    }
  }
  for (const m of svg.matchAll(/<path d="([^"]+)" fill="none" stroke="[^"]+" class="sa"/g)) {
    const tok = m[1]!.trim().split(/\s+/)
    let x = 0
    let y = 0
    for (let i = 0; i < tok.length; ) {
      const c = tok[i]!
      if (c === 'M') {
        x = Number(tok[i + 1])
        y = Number(tok[i + 2])
        i += 3
      } else if (c === 'H') {
        const nx = Number(tok[i + 1])
        segs.push([x, y, nx, y, 'sa'])
        x = nx
        i += 2
      } else if (c === 'V') {
        const ny = Number(tok[i + 1])
        segs.push([x, y, x, ny, 'sa'])
        y = ny
        i += 2
      } else {
        i += 1
      }
    }
  }
  const top = Math.min(...[...svg.matchAll(/<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="[\d.]+" stroke="rgba[^"]+"\/>/g)].map(m => Number(m[1])))

  return { labels, dots, marks, segs, top, ...(right === undefined ? {} : { right }) }
}

/** Liang-Barsky: does the segment meet the box? The verifier's, kept apart from the code's own. */
export function hits(s: Seg, b: Box): boolean {
  const [x0, y0, x1, y1] = s
  const dx = x1 - x0
  const dy = y1 - y0
  let t0 = 0
  let t1 = 1
  const p = [-dx, dx, -dy, dy]
  const q = [x0 - b.x0, b.x1 - x0, y0 - b.y0, b.y1 - y0]
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i]! < 0) {
        return false
      }
    } else {
      const r = q[i]! / p[i]!
      if (p[i]! < 0) {
        t0 = Math.max(t0, r)
      } else {
        t1 = Math.min(t1, r)
      }
    }
  }

  return t0 <= t1
}
export const meets = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/**
 * What overlaps in a drawn top card, as "<label> x <what>" lines, by kind: `soft` holds a label on a
 * trace or on the Compacted label (ink box or the code's box), `hard` a label on a dot or on another
 * label (ink box).
 */
export function overlaps(svg: string): { soft: string[]; hard: string[]; geometry: HeroGeometry } {
  const g = heroGeometry(svg)
  const soft = new Set<string>()
  const hard = new Set<string>()
  g.labels.forEach((l, i) => {
    for (const [name, box] of [['ink', l], ['code', l.code]] as const) {
      for (const s of g.segs) {
        if (hits(s, box)) {
          soft.add(`${l.what} (${name}) x trace ${s[4]}`)
        }
      }
      for (const o of g.marks) {
        if (meets(box, o)) {
          soft.add(`${l.what} (${name}) x Compacted`)
        }
      }
    }
    for (const o of g.dots) {
      if (meets(l, o)) {
        hard.add(`${l.what} x ${o.what}`)
      }
    }
    g.labels.forEach((m, k) => {
      if (k > i && meets(l, m)) {
        hard.add(`${l.what} x ${m.what}`)
      }
    })
  })

  return { soft: [...soft], hard: [...hard], geometry: g }
}

/**
 * Whether a clear place existed for every label: a baseline anywhere in the band (each px), in the
 * home column (right edge 10 px left of the dots), whose code box meets no trace, dot or Compacted
 * label, the labels' baselines 14 px apart. This is a superset of the verifier's places (dot - 9 - 14k
 * and dot + 19 + 14k, k up to 4), and a subset of the code's (which also tries columns to the left).
 */
export function clearPlaceExists(g: HeroGeometry): boolean {
  if (g.right === undefined) {
    return true
  }
  const minY = g.top + 10
  const maxY = 246
  const cands = g.labels.map(l => {
    const width = l.code.x1 - l.code.x0
    const out: number[] = []
    for (let y = minY; y <= maxY; y += 1) {
      const box = labelBox(y, width, g.right!)
      if (!g.segs.some(s => hits(s, box)) && !g.marks.some(o => meets(box, o)) && !g.dots.some(o => meets(box, o))) {
        out.push(y)
      }
    }

    return out
  })
  const go = (i: number, chosen: number[]): boolean => i === cands.length || cands[i]!.some(y => chosen.every(c => Math.abs(c - y) >= 14) && go(i + 1, [...chosen, y]))

  return go(0, [])
}
