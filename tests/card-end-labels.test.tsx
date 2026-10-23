import { expect, test } from 'claude-code/testing'

import { boxesMeet, endLabelWidth, labelBox, placeEndLabels, segmentMeets } from '../hooks/card-end-labels'
import type { Box, Trace } from '../hooks/card-end-labels'
import { setWidth } from '../hooks/card-stage'
import { heroSvg } from '../hooks/hero-card'
import { fuzzStates } from '../scripts/hero-fuzz'
import { r5Check, r5States, R5_WIDTHS } from '../scripts/hero-fuzz-r5'
import { clearPlaceExists, overlaps } from '../scripts/hero-geometry'
import { heroStates } from '../scripts/sample'

const AREA = { right: 470, minY: 72, maxY: 246, gap: 14 }

/**
 * The lowest and highest y of a trace between x = a and x = b, or undefined when it does not reach there.
 * The geometry oracle of these tests (UCR-189: moved here from hooks/card-end-labels.ts, where no code called it).
 */
function traceSpan(trace: Trace, a: number, b: number): [number, number] | undefined {
  let lo = Infinity
  let hi = -Infinity
  const take = (y: number) => {
    lo = Math.min(lo, y)
    hi = Math.max(hi, y)
  }
  for (let i = 0; i < trace.length; i += 1) {
    const p = trace[i]!
    if (p[0] >= a && p[0] <= b) {
      take(p[1])
    }
    const q = trace[i + 1]
    if (q === undefined || q[0] === p[0]) {
      continue
    }
    // Where the segment from p to q crosses x = a and x = b.
    for (const x of [a, b]) {
      const t = (x - p[0]) / (q[0] - p[0])
      if (t > 0 && t < 1) {
        take(p[1] + t * (q[1] - p[1]))
      }
    }
  }

  return lo === Infinity ? undefined : [lo, hi]
}

/** True when a trace passes through the label's box. */
function onTrace(trace: Trace, baseline: number, width: number): boolean {
  const box = labelBox(baseline, width, AREA.right)
  const span = traceSpan(trace, box.x0, box.x1)

  return span !== undefined && span[0] <= box.y1 && span[1] >= box.y0
}
const meets = (one: Box, two: Box) => one.x0 < two.x1 && two.x0 < one.x1 && one.y0 < two.y1 && two.y0 < one.y1

test('traceSpan gives the y range of a trace over an x range, a step line too', () => {
  expect(traceSpan([[0, 100], [100, 0]], 25, 75)).toEqual([25, 75])
  expect(traceSpan([[0, 50], [40, 50], [40, 10], [100, 10]], 30, 60)).toEqual([10, 50])
  expect(traceSpan([[0, 50], [10, 50]], 30, 60)).toBeUndefined()
})

test('#T003B the owner case: an agent label under its dot is not put on the token line that crosses there', () => {
  // The token line climbs to the right edge and crosses the agent level just left of it (as in the screenshot).
  const tokenLine: Trace = [[64, 240], [480, 150]]
  const agentLine: Trace = [[64, 200], [400, 200], [400, 164], [480, 164]]
  const ys = placeEndLabels([{ y: 164, width: 38 }, { y: 150, width: 42 }], { traces: [tokenLine, agentLine], dots: [], marks: [] }, AREA).map(place => place.y)
  expect(onTrace(tokenLine, ys[0]!, 38)).toBe(false)
  expect(onTrace(agentLine, ys[0]!, 38)).toBe(false)
  expect(onTrace(tokenLine, ys[1]!, 42)).toBe(false)
  expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThanOrEqual(14)
})

test('#T003B three labels stay 14 px apart inside the band, in every corner of it', () => {
  for (const dots of [[246, 246, 246], [72, 72, 72], [150, 151, 152], [72, 246, 160]]) {
    const ys = placeEndLabels(dots.map(y => ({ y, width: 40 })), { traces: [], dots: [], marks: [] }, AREA).map(place => place.y)
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
      expect(Math.abs(ys[i]! - ys[j]!)).toBeGreaterThanOrEqual(14)
    }
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(AREA.minY)
      expect(y).toBeLessThanOrEqual(AREA.maxY)
    }
  }
})

test('UCR-089 an end label is never put on the Compacted label', () => {
  // The Compacted label at the right edge, top of the plot (top 62: its box 65 to 77).
  const compacted: Box = { x0: 400, x1: 465, y0: 65, y1: 77 }
  // A dot at the top (the old code drew "4 live" at y 72, on the label), one just under it, one at the limit of the band.
  for (const dot of [62, 70, 82]) {
    const ys = placeEndLabels([{ y: dot, width: 38 }], { traces: [], dots: [], marks: [compacted] }, AREA).map(place => place.y)
    expect(meets(labelBox(ys[0]!, 38, AREA.right), compacted)).toBe(false)
  }
  // With two labels near the top, neither sits on it.
  const two = placeEndLabels([{ y: 62, width: 38 }, { y: 66, width: 44 }], { traces: [], dots: [], marks: [compacted] }, AREA).map(place => place.y)
  expect(two.some((y, i) => meets(labelBox(y, [38, 44][i]!, AREA.right), compacted))).toBe(false)
})

// ---------------------------------------------------------------- #T003B: the verifier's fuzz, kept as a test

const FUZZ_WIDTHS = [300, 384, 520, 720, 960, 1920]
/** The sample states and the verifier's 340 fuzz states (fixed seed): 344 states, drawn once per width below. */
const FUZZ = [...Object.entries(heroStates()), ...fuzzStates()]

// One test per width. Each takes 0.4 to 1 s alone but 5.8 to 6.9 s at a load average of 61, so each has its own limit (UCR-164), not the 5 s default.
for (const width of FUZZ_WIDTHS) {
  test(`#T003B fuzz at ${width} px: no end label on a dot or a label ever, and none on a trace or the Compacted label where a clear place exists`, { timeoutMs: 120_000 }, () => {
    setWidth(width)
    const failures: string[] = []
    let threeLabels = 0
    for (const [name, view] of FUZZ) {
      const { soft, hard, geometry } = overlaps(heroSvg(view).source)
      if (geometry.labels.length === 3) {
        threeLabels += 1
      }
      // The code's box holds the glyphs: its clear means the ink is clear.
      for (const label of geometry.labels) {
        if (label.code.x0 > label.x0 || label.code.x1 < label.x1 || label.code.y0 > label.y0 || label.code.y1 < label.y1) {
          failures.push(`${name}: code box under the ink of ${label.what}`)
        }
      }
      failures.push(...hard.map(one => `${name}: ${one}`))
      if (soft.length > 0 && clearPlaceExists(geometry)) {
        failures.push(...soft.map(one => `${name} (a clear place existed): ${one}`))
      }
    }
    setWidth(384)
    expect(FUZZ.length).toBeGreaterThanOrEqual(340)
    expect(threeLabels).toBeGreaterThan(300)
    expect(failures).toEqual([])
  })
}

test('UCR-089 the verifier r24 state: "7 live" never sits on "Compacted", at any width', () => {
  const r24 = fuzzStates(25, 0)[24]![1]
  for (const width of FUZZ_WIDTHS) {
    setWidth(width)
    const { soft, geometry } = overlaps(heroSvg(r24).source)
    // The Compacted label, and the peak of the segment before it, clipped since the rate has its own axis (#T004E).
    expect(geometry.marks.length).toBe(2)
    expect(geometry.labels.some(label => label.what === 'fa:7 live')).toBe(true)
    expect(soft.filter(one => one.includes('Compacted'))).toEqual([])
  }
  setWidth(384)
})

test('#T003B a label goes a column left when every row of its own column is on a trace, and the least-overlap place when none is clear', () => {
  const area = { right: 470, minY: 72, maxY: 246, gap: 14 }
  // A trace that zigzags through the whole home column (x 432 to 470), every 6 px: no row of it is clear.
  const zigzag: Trace = Array.from({ length: 40 }, (_, k) => [432 + (k % 2) * 40, 60 + k * 6] as const)
  const [place] = placeEndLabels([{ y: 160, width: 30 }], { traces: [zigzag], dots: [], marks: [] }, area)
  expect(place!.right).toBeLessThan(area.right)
  expect(boxesMeet(labelBox(place!.y, 30, place!.right), { x0: 432, x1: 472, y0: 60, y1: 300 })).toBe(false)
  // A wall over every column the label can take: it still goes somewhere, never on a dot, and the halo is its only help.
  const wall: Trace = Array.from({ length: 60 }, (_, k) => [300 + (k % 2) * 180, 60 + k * 4] as const)
  const dot = { x0: 465, x1: 475, y0: 155, y1: 165 }
  const [forced] = placeEndLabels([{ y: 160, width: 30 }], { traces: [wall], dots: [dot], marks: [] }, area)
  expect(forced!.y).toBeGreaterThanOrEqual(area.minY)
  expect(boxesMeet(labelBox(forced!.y, 30, forced!.right), dot)).toBe(false)
})

test('#T003B no two labels share a row, even in two columns, and none sits on a dot, with three dots on one spot at the band edge', () => {
  const area = { right: 470, minY: 72, maxY: 246, gap: 14 }
  const dots = [{ x0: 465, x1: 475, y0: 241, y1: 251 }]
  for (const y of [246, 72, 160]) {
    const places = placeEndLabels([{ y, width: 40 }, { y, width: 44 }, { y, width: 52 }], { traces: [], dots, marks: [] }, area)
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
      expect(Math.abs(places[i]!.y - places[j]!.y)).toBeGreaterThanOrEqual(14)
    }
    places.forEach((place, i) => {
      expect(dots.some(one => boxesMeet(one, labelBox(place.y, [40, 44, 52][i]!, place.right)))).toBe(false)
    })
  }
})

test('#T003B endLabelWidth holds the glyphs of every end label character at 12 px', () => {
  // Helvetica Neue em widths, bold digits and units, regular tails: the box is at least this wide.
  const bold: Record<string, number> = { '0': 0.556, '9': 0.556, '.': 0.278, k: 0.574, M: 0.87 }
  for (const [ch, em] of Object.entries(bold)) {
    expect(endLabelWidth(ch)).toBeGreaterThanOrEqual(em * 12)
  }
  expect(endLabelWidth('999.9k', '/min')).toBeGreaterThanOrEqual(12 * (0.556 * 4 + 0.278 + 0.574) + 12 * (0.278 + 0.833 + 0.222 + 0.556))
  expect(endLabelWidth('12', ' live')).toBeGreaterThanOrEqual(12 * (0.556 * 2) + 12 * (0.278 + 0.222 + 0.222 + 0.5 + 0.556))
})

// ---------------------------------------------------------------- loop 3, batch L5: UCR-218 and #T003B (never on a trace)

/** The loop-3 reviewer's 420 states (scripts/hero-fuzz-r5.ts), drawn once per width. */
const R5 = r5States(420)

/** The widths where the card is too narrow for a clear place in every state (#T003K: the rate axis takes a second label column). */
const CROWDED_WIDTHS = [300, 384]

for (const width of R5_WIDTHS) {
  const crowded = CROWDED_WIDTHS.includes(width)
  test(`UCR-218 #T003B the loop-3 reviewer's fuzz at ${width} px: no end label on a trace, dot, label or Compacted label, in all 420 states${crowded ? ' where a clear place exists (else the halo)' : ''}`, { timeoutMs: 300_000 }, () => {
    setWidth(width)
    const failures: string[] = []
    // States with a hit and no clear place: the owner rule allows them (the halo is the label's only help).
    const noClear: string[] = []
    // States with a hit although a clear place exists: never allowed.
    const clearHit: string[] = []
    for (const [name, view] of R5) {
      const svg = heroSvg(view).source
      // The reviewer's check (its own ink widths, sampled segments) and this suite's (hero-geometry): both must be empty.
      const found = r5Check(svg, width).map(one => `${name}: ${one}`)
      const { soft, hard, geometry } = overlaps(svg)
      found.push(...[...soft, ...hard].map(one => `${name} (geometry): ${one}`))
      failures.push(...found)
      if (found.length > 0) {
        ;(clearPlaceExists(geometry) ? clearHit : noClear).push(name)
      }
    }
    setWidth(384)
    expect(R5.length).toBe(420)
    if (crowded) {
      // (a) zero failures among the states that have a clear place; (b) every failing state has none.
      expect(clearHit).toEqual([])
      // A bound on the crowded states, so a layout that takes more plot width fails: 18 at 300 px
      // and 1 at 384 px with the dual token axis (#T003K). With the rate on its own axis (#T004E)
      // the rate line fills the plot height: 47 at 300 px (a 101 px plot) and 3 at 384 px; at most 12 percent of the 420.
      expect(noClear.length).toBeLessThanOrEqual(50)
    } else {
      expect(failures).toEqual([])
    }
  })
}

test('UCR-218 #T003B the states the reviewer flagged at 300 px (s30-equal, s90-huge, s178-seeded) put the /min label off every trace', () => {
  setWidth(300)
  const flagged = R5.filter(([name]) => ['s30-equal', 's90-huge', 's178-seeded'].includes(name))
  expect(flagged.length).toBe(3)
  for (const [, view] of flagged) {
    const svg = heroSvg(view).source
    expect(r5Check(svg, 300)).toEqual([])
    expect(overlaps(svg).soft).toEqual([])
  }
  setWidth(384)
})

for (const width of FUZZ_WIDTHS) {
  test(`UCR-218 #T003B the earlier fuzz at ${width} px: no end label on a trace or the Compacted label where a clear place exists, the halo where none does`, { timeoutMs: 120_000 }, () => {
    setWidth(width)
    // (a) A state with a clear place has no hit; (b) every state with a hit has no clear place.
    const clearHit: string[] = []
    const noClear: string[] = []
    for (const [name, view] of FUZZ) {
      const { soft, hard, geometry } = overlaps(heroSvg(view).source)
      const found = [...soft, ...hard].map(one => `${name}: ${one}`)
      if (found.length > 0) {
        ;(clearPlaceExists(geometry) ? clearHit : noClear).push(...found)
      }
    }
    setWidth(384)
    expect(clearHit).toEqual([])
    if (width >= 520) {
      // Wide cards keep a clear place in every state.
      expect(noClear).toEqual([])
    }
  })
}

/** Whether any segment of the trace meets the box (the code's Liang-Barsky, segmentMeets). */
function traceMeets(trace: Trace, box: Box): boolean {
  return trace.slice(1).some((q, i) => segmentMeets([trace[i]![0], trace[i]![1], q[0], q[1]], box))
}

test('UCR-218 placeEndLabels searches the whole width to area.left when the near columns have no clear place, and never past it', () => {
  const area = { right: 470, minY: 72, maxY: 246, gap: 14 }
  const label = [{ y: 160, width: 30 }]
  // A zigzag over x 330 to 472 at every row: no clear place in the 4 near columns (right 470 to 398, boxes from 368).
  const wall: Trace = Array.from({ length: 50 }, (_, k) => [330 + (k % 2) * 142, 60 + k * 4] as const)
  // State 1, the defect behind a valid first case: without `left` (the old search) the label lands on the wall.
  const [old] = placeEndLabels(label, { traces: [wall], dots: [], marks: [] }, area)
  expect(traceMeets(wall, labelBox(old!.y, 30, old!.right))).toBe(true)
  // With `left` the label goes left of the wall, clear, and its box stays right of `left`.
  const [wide] = placeEndLabels(label, { traces: [wall], dots: [], marks: [] }, { ...area, left: 100 })
  expect(traceMeets(wall, labelBox(wide!.y, 30, wide!.right))).toBe(false)
  expect(wide!.right - 30).toBeGreaterThanOrEqual(100 - 0.1)
  // State 2, the limit of the scanned range: a zigzag from x 134 leaves one clear column, the box from exactly `left` (100 to 130).
  const fence: Trace = Array.from({ length: 50 }, (_, k) => [134 + (k % 2) * 338, 60 + k * 4] as const)
  const [edge] = placeEndLabels(label, { traces: [fence], dots: [], marks: [] }, { ...area, left: 100 })
  expect(traceMeets(fence, labelBox(edge!.y, 30, edge!.right))).toBe(false)
  expect(edge!.right).toBe(130)
  // State 3, the excluded population: with `left` 1 px further right that column is out, and is never taken; the label stays inside.
  const [inside] = placeEndLabels(label, { traces: [fence], dots: [], marks: [] }, { ...area, left: 101 })
  expect(inside!.right - 30).toBeGreaterThanOrEqual(101 - 0.1)
  // A clear near place keeps its home column: the wide search runs only when the near one costs a hit.
  const [near] = placeEndLabels(label, { traces: [], dots: [], marks: [] }, { ...area, left: 100 })
  expect(near!.right).toBe(area.right)
})

test('UCR-251 labels keep the vertical order of their dots, in a clear plot and at its foot', () => {
  // Clear plot: the higher dot gets the higher label, in whatever order the labels come.
  const [a, b] = placeEndLabels([{ y: 160, width: 40 }, { y: 150, width: 40 }], { traces: [], dots: [], marks: [] }, AREA)
  expect(b!.y).toBeLessThan(a!.y)
  // Three dots at the foot of the plot: the labels stack upward, apart, in the dots' order.
  const foot = placeEndLabels([{ y: 244, width: 40 }, { y: 245, width: 40 }, { y: 246, width: 40 }], { traces: [], dots: [], marks: [] }, AREA).map(place => place.y)
  expect(foot[0]!).toBeLessThan(foot[1]!)
  expect(foot[1]!).toBeLessThan(foot[2]!)
  expect(foot[1]! - foot[0]!).toBeGreaterThanOrEqual(AREA.gap)
  expect(foot[2]! - foot[1]!).toBeGreaterThanOrEqual(AREA.gap)
})

test('UCR-251 UCR-252 the leaders are drawn under the Compacted text', { timeoutMs: 120_000 }, () => {
  setWidth(300)
  let leaders = 0
  for (const [, view] of R5) {
    const svg = heroSvg(view).source
    const at = [...svg.matchAll(/stroke-opacity="0\.7"\/>/g)].map(m => m.index!)
    leaders += at.length
    const compacted = svg.indexOf('>Compacted</text>')
    if (compacted >= 0 && at.length > 0) {
      expect(Math.max(...at)).toBeLessThan(compacted)
    }
  }
  setWidth(384)
  expect(leaders).toBeGreaterThan(0)
})
