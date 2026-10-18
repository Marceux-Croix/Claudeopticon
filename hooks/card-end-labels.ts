/** End-label placement on the top card: where each trace's end value goes, clear of the traces, the dots, each other and the Compacted label. */

/** A box in px: left, right, top, bottom. */
export type Box = { x0: number; x1: number; y0: number; y1: number }
/** A drawn trace as its vertices in px, left to right (a step line has two vertices at each step). */
export type Trace = readonly (readonly [number, number])[]
/** One end label: the y of its dot, and the label's width in px (endLabelWidth). */
export type EndLabel = { y: number; width: number }
/**
 * Where the labels may go: the right edge of a label in its home column (just left of the dots),
 * the band for baselines, the least gap between the baselines of two labels, and `left`, the
 * leftmost x a label's box may reach (the plot's left edge on the card). Without `left` a label
 * tries its home column and SHIFTS columns to the left of it. With `dotX`, the x of the end dots, a
 * leader that would cross another label costs CROSSED (UCR-251).
 */
export type LabelArea = { right: number; minY: number; maxY: number; gap: number; left?: number; dotX?: number }
/** Where one label goes: its baseline and its right edge (it is drawn text-anchor="end"). */
export type LabelPlace = { y: number; right: number }
/** What a label must keep off: the drawn traces, the end dots, and the other marks (the Compacted label; the compaction lines are soft). */
export type LabelObstacles = { traces: readonly Trace[]; dots: readonly Box[]; marks: readonly Box[]; soft?: readonly Trace[] }

/**
 * Glyph widths of the end labels at 12 px, in em: the bold value (digits, the decimal point, k, M,
 * B) and the regular tail (" live", "/min"). They are Helvetica Neue's, rounded up a little so the
 * box holds the glyphs of Instrument Sans and Arial too (both a little narrower in these glyphs); a
 * character not listed counts as a wide one.
 */
const BOLD_EM: Readonly<Record<string, number>> = { '.': 0.3, k: 0.6, M: 0.9, B: 0.72 }
const REGULAR_EM: Readonly<Record<string, number>> = { ' ': 0.29, l: 0.25, i: 0.25, v: 0.53, e: 0.58, '/': 0.3, m: 0.87, n: 0.58 }
const DIGIT_EM = 0.6
const WIDE_EM = 0.9

/** An end label's width in px at 12 px: the bold value and the regular tail, plus 1 px. */
export function endLabelWidth(value: string, tail = ''): number {
  const em = (text: string, table: Readonly<Record<string, number>>) => [...text].reduce((sum, ch) => sum + (table[ch] ?? (/[0-9]/.test(ch) ? DIGIT_EM : WIDE_EM)), 0)

  return Math.ceil((em(value, BOLD_EM) + em(tail, REGULAR_EM)) * 12 + 1)
}

/** A label's box from its baseline: 12 px text, its cap height 9.5 px above the baseline, and 2.5 px under it for "/". */
export function labelBox(baseline: number, width: number, right: number): Box {
  return { x0: right - width, x1: right, y0: baseline - 9.5, y1: baseline + 2.5 }
}

/** A segment from (ax, ay) to (bx, by). */
type Segment = readonly [number, number, number, number]

/** Whether the segment meets the box, its edges included (Liang-Barsky clipping). */
export function segmentMeets(s: Segment, box: Box): boolean {
  const [ax, ay, bx, by] = s
  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  const sides: [number, number][] = [
    [-dx, ax - box.x0],
    [dx, box.x1 - ax],
    [-dy, ay - box.y0],
    [dy, box.y1 - ay],
  ]
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) {
        return false
      }
    } else if (p < 0) {
      t0 = Math.max(t0, q / p)
    } else {
      t1 = Math.min(t1, q / p)
    }
  }

  return t0 <= t1
}

/** A trace's segments (a lone vertex is a segment of no length). */
function segmentsOf(trace: Trace): Segment[] {
  if (trace.length === 1) {
    return [[trace[0]![0], trace[0]![1], trace[0]![0], trace[0]![1]]]
  }

  return trace.slice(1).map((q, i) => [trace[i]![0], trace[i]![1], q[0], q[1]] as const)
}

/** A label whose box is more than LEADER_PX from its dot gets a leader line (UCR-218). */
export const LEADER_PX = 24

/**
 * The leader from a label's box to its dot at (dotX, dotY), as [x1, y1, x2, y2]: from the box's
 * point nearest the dot, 2 px out, to 5 px short of the dot's center (its ring). Undefined when the
 * box is within LEADER_PX of the dot, where the label reads as the dot's.
 */
export function leaderLine(box: Box, dotX: number, dotY: number): [number, number, number, number] | undefined {
  const nearX = Math.min(box.x1, Math.max(box.x0, dotX))
  const nearY = Math.min(box.y1, Math.max(box.y0, dotY))
  const length = Math.hypot(dotX - nearX, dotY - nearY)
  if (length <= LEADER_PX) {
    return undefined
  }
  const ux = (dotX - nearX) / length
  const uy = (dotY - nearY) / length

  return [nearX + ux * 2, nearY + uy * 2, dotX - ux * 5, dotY - uy * 5]
}

export const boxesMeet = (one: Box, two: Box): boolean => one.x0 < two.x1 && two.x0 < one.x1 && one.y0 < two.y1 && two.y0 < one.y1
const grow = (box: Box, by: number): Box => ({ x0: box.x0 - by, x1: box.x1 + by, y0: box.y0 - by, y1: box.y1 + by })

/** Baselines are tried every px over the whole band, so a clear place is never missed between two rows. */
const ROW_STEP = 1
/**
 * A label may move left of its home column by up to SHIFTS columns SHIFT_PX apart. When no set of
 * places there keeps every label off the traces and marks, and `area.left` is given, the search
 * runs again over the whole width to `left`, a column every WIDE_STEP px (UCR-218, #T003B: at 300
 * px three states of the reviewer's fuzz had no clear place in four columns, but one 96 px or more
 * to the left). A px moved costs PER_SHIFT_PX, so a far column wins only over a place on a trace.
 */
const SHIFTS = 3
export const SHIFT_PX = 24
const WIDE_STEP = 4
/** The clear space wanted around a label's box, in px, past the 1.5 px halo; a trace inside it costs NEAR. */
const CLEAR = 2
/** Costs: a trace or a mark on the label's box; a trace in its clear space, or a compaction line on it; a px moved. */
const HIT = 10_000
const EPS = 0.1
const NEAR = 100
const PER_PX = 1
const PER_SHIFT_PX = 2

/** One place a label may go, with its box and the cost of everything but the other labels. */
type Candidate = LabelPlace & { box: Box; cost: number; dotY: number }

/**
 * Where one label may go: every baseline in the band ROW_STEP apart, above and under its dot,
 * and in its home column or up to SHIFTS columns to the left (with `isWide`, a column every
 * WIDE_STEP px to `area.left`); never on a dot. Each carries its
 * cost: HIT for each trace or mark on its box, NEAR for each trace in its CLEAR px or compaction
 * line on it, and the px it moved from its home place (just above its dot, in the home column).
 */
function candidates(label: EndLabel, obstacles: LabelObstacles, area: LabelArea, isWide: boolean): Candidate[] {
  const home = label.y - 9
  const out: Candidate[] = []
  const traces = obstacles.traces.map(segmentsOf)
  const soft = (obstacles.soft ?? []).map(segmentsOf)
  // A box's top and bottom from its baseline, as labelBox draws it.
  const probe = labelBox(0, label.width, 0)
  // The px each column is left of the home column: SHIFTS steps of SHIFT_PX, or every WIDE_STEP px whose box stays right of `left`.
  const moves: number[] = []
  if (isWide && area.left !== undefined) {
    for (let px = 0; px === 0 || area.right - px - label.width >= area.left - EPS; px += WIDE_STEP) {
      moves.push(px)
    }
  } else {
    for (let shift = 0; shift <= SHIFTS; shift += 1) {
      moves.push(shift * SHIFT_PX)
    }
  }
  for (const move of moves) {
    // Whole px, and the right edge to 0.1 px as the card draws it, so the box tried is the box drawn.
    const right = Math.round((area.right - move) * 10) / 10
    // Per trace, the baselines at which the label's box (or its CLEAR px) meets it: one test of
    // each segment per column, not one per row, since every row of a column spans the same x.
    // The box is grown by EPS, as the card rounds what it draws to 0.1 px.
    const onBox = traces.map(segments => blockedBaselines(segments, right - label.width - EPS, right + EPS, probe.y0 - EPS, probe.y1 + EPS))
    const onClear = traces.map(segments => blockedBaselines(segments, right - label.width - CLEAR, right + CLEAR, probe.y0 - CLEAR, probe.y1 + CLEAR))
    const onSoft = soft.map(segments => blockedBaselines(segments, right - label.width, right, probe.y0, probe.y1))
    for (let y = Math.ceil(area.minY); y <= area.maxY; y += ROW_STEP) {
      const box = labelBox(y, label.width, right)
      if (obstacles.dots.some(dot => boxesMeet(dot, box))) {
        continue
      }
      const clear = grow(box, CLEAR)
      let cost = Math.abs(y - home) * PER_PX + move * PER_SHIFT_PX
      onBox.forEach((spans, k) => {
        cost += isIn(spans, y) ? HIT : isIn(onClear[k]!, y) ? NEAR : 0
      })
      cost += onSoft.filter(spans => isIn(spans, y)).length * NEAR
      cost += obstacles.marks.filter(mark => boxesMeet(mark, clear)).length * HIT
      out.push({ y, right, box, cost, dotY: label.y })
    }
  }

  return out.sort((a, b) => a.cost - b.cost)
}

/**
 * The baselines at which a box from x0 to x1, its top `up` and its bottom `down` from the baseline
 * (up < 0 < down), meets one of the segments, as closed spans [from, to]. A straight segment cut
 * to [x0, x1] spans one y range [lo, hi], and the box meets it exactly when lo <= baseline + down
 * and hi >= baseline + up: the same answer as segmentMeets, for every row at once.
 */
function blockedBaselines(segments: readonly Segment[], x0: number, x1: number, up: number, down: number): [number, number][] {
  const out: [number, number][] = []
  for (const [ax, ay, bx, by] of segments) {
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1) {
      continue
    }
    let lo = Math.min(ay, by)
    let hi = Math.max(ay, by)
    if (ax !== bx) {
      const yAt = (x: number) => ay + ((x - ax) / (bx - ax)) * (by - ay)
      const from = yAt(Math.max(x0, Math.min(ax, bx)))
      const to = yAt(Math.min(x1, Math.max(ax, bx)))
      lo = Math.min(from, to)
      hi = Math.max(from, to)
    }
    out.push([lo - down, hi - up])
  }

  return out
}

const isIn = (spans: readonly [number, number][], y: number) => spans.some(span => y >= span[0] && y <= span[1])

/**
 * Two labels may not share space: their baselines are `gap` apart, in any column. Two labels side
 * by side on one row would read as one ("0/min 0"), so a column to the left dodges traces only.
 */
function isApart(one: Candidate, two: Candidate, gap: number): boolean {
  return Math.abs(one.y - two.y) >= gap && !boxesMeet(grow(one.box, 0.5), grow(two.box, 0.5))
}

/**
 * The cost a label out of its dots' order adds (UCR-251): more than a trace near the box, less than
 * a trace on it, so the order gives way only to keep a label off a trace.
 */
const OUT_OF_ORDER = 1_000

/** The cost of a leader through another label (UCR-251): less than a label on a trace, more than a label out of order. */
const CROSSED = 5_000

/** Whether the leader of `one` to its dot at `dotX` (when it has one) meets `box`, grown 1 px. */
function crosses(one: Candidate, box: Box, dotX: number): boolean {
  const leader = leaderLine(one.box, dotX, one.dotY)

  return leader !== undefined && segmentMeets(leader, grow(box, 1))
}

/** What `one`, for label `i`, adds next to the labels placed in `picked` (by label index): Infinity when it meets one, else OUT_OF_ORDER for each it is out of order with. */
function fitCost(one: Candidate, i: number, picked: readonly (Candidate | undefined)[], gap: number, dotX?: number): number {
  let cost = 0
  picked.forEach((other, j) => {
    if (other === undefined || j === i) {
      return
    }
    if (!isApart(one, other, gap)) {
      cost = Infinity
    } else if (j < i ? one.y <= other.y : one.y >= other.y) {
      cost += OUT_OF_ORDER
    }
    if (dotX !== undefined && (crosses(one, other.box, dotX) || crosses(other, one.box, dotX))) {
      cost += CROSSED
    }
  })

  return cost
}

/**
 * The places of the end labels: one candidate each (see `candidates`), the cheapest in which
 * no two labels share space (placeIn: greedy, then a bounded joint search). A label never sits on
 * a dot or another label; it sits on a trace or on the Compacted label only when every place for
 * it does (the halo then keeps the letters readable). The card draws at most one point per QUANT_MS
 * step of each trace (onePerStep, UCR-217), so the segments stay about 60 a trace however long the
 * series. Timings are in the UCR-217, UCR-218 and UCR-249 tests.
 */
export function placeEndLabels(labels: readonly EndLabel[], obstacles: LabelObstacles, area: LabelArea): LabelPlace[] {
  // Top dot first, so each label's baseline is under the one before it: the labels keep their dots' order (UCR-251).
  const order = labels.map((_, i) => i).sort((a, b) => labels[a]!.y - labels[b]!.y || a - b)
  const places = placeSorted(order.map(i => labels[i]!), obstacles, area)
  const out: LabelPlace[] = labels.map(() => ({ y: 0, right: 0 }))
  order.forEach((i, k) => {
    out[i] = places[k]!
  })

  return out
}

/** placeEndLabels for labels sorted top dot first. */
function placeSorted(labels: readonly EndLabel[], obstacles: LabelObstacles, area: LabelArea): LabelPlace[] {
  const near = placeIn(labels, obstacles, area, false)
  // A label on a trace or a mark costs HIT: then the whole width is searched (UCR-218), and kept when it costs less.
  if (area.left === undefined || near.cost < HIT) {
    return near.places
  }
  const wide = placeIn(labels, obstacles, area, true)

  return wide.cost < near.cost ? wide.places : near.places
}

/**
 * One greedy pass: each label in turn (top first, or bottom first with `isUp`) takes the candidate
 * cheapest with its fitCost next to the labels placed before it. A label with no candidate apart
 * from them takes its cheapest one, and the pass costs Infinity.
 */
function greedyPlaces(choices: readonly Candidate[][], gap: number, isUp: boolean, dotX?: number): { picked: (Candidate | undefined)[]; cost: number } {
  const picked: (Candidate | undefined)[] = choices.map(() => undefined)
  let cost = 0
  for (let k = 0; k < choices.length; k += 1) {
    const i = isUp ? choices.length - 1 - k : k
    let one: Candidate | undefined
    let oneCost = Infinity
    for (const c of choices[i]!) {
      if (c.cost >= oneCost) {
        break
      }
      const total = c.cost + fitCost(c, i, picked, gap, dotX)
      if (total < oneCost) {
        one = c
        oneCost = total
      }
    }
    picked[i] = one ?? choices[i]![0]
    cost += oneCost
  }

  return { picked, cost }
}

/**
 * Most label sets the joint search may try before it keeps the best set found so far (UCR-249): the
 * work of one draw is bounded in every state, so it stays a few tens of ms.
 */
export const JOINT_TRIES = 100_000

/**
 * The places over the near columns, or over the whole width (`isWide`), with their total cost.
 * The labels come top dot first. First greedy, top first and bottom first (greedyPlaces). Only when
 * that puts a label on a trace or a mark, out of its dots' order, or a leader across a label, a
 * branch and bound over the label sets, bounded by the greedy cost, looks for a cheaper set, for at
 * most JOINT_TRIES sets (UCR-249: the unbounded search took up to 5 s when no clear set existed).
 */
function placeIn(labels: readonly EndLabel[], obstacles: LabelObstacles, area: LabelArea, isWide: boolean): { places: LabelPlace[]; cost: number } {
  const choices = labels.map(label => candidates(label, obstacles, area, isWide))
  // Greedy top label first, and bottom label first (labels crowded at the plot's foot stack upward); the cheaper wins.
  const down = greedyPlaces(choices, area.gap, false, area.dotX)
  const up = greedyPlaces(choices, area.gap, true, area.dotX)
  const { picked: greedy, cost: greedyCost } = up.cost < down.cost ? up : down
  let best = { picked: greedy, cost: greedyCost }
  if (greedyCost >= OUT_OF_ORDER) {
    const floor = choices.map(list => list[0]?.cost ?? 0)
    const rest = floor.map((_, i) => floor.slice(i + 1).reduce((sum, cost) => sum + cost, 0))
    let tries = 0
    const pick = (picked: Candidate[], cost: number) => {
      const i = picked.length
      if (i === labels.length) {
        if (cost < best.cost) {
          best = { picked, cost }
        }

        return
      }
      for (const one of choices[i]!) {
        tries += 1
        if (tries > JOINT_TRIES || cost + one.cost + rest[i]! >= best.cost) {
          break
        }
        const fit = fitCost(one, i, picked, area.gap, area.dotX)
        if (fit < Infinity) {
          pick([...picked, one], cost + one.cost + fit)
        }
      }
    }
    pick([], 0)
  }

  return {
    places: best.picked.map((one, i) => (one === undefined ? { y: Math.min(area.maxY, Math.max(area.minY, labels[i]!.y - 9)), right: area.right } : { y: one.y, right: one.right })),
    cost: best.cost,
  }
}
