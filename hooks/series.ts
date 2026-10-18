/** The top card's data: the agent and token series over the window, and the axes they plot on. */

import type { Usage } from './card-types'

/** A sample: [time in ms, value]. */
export type Point = readonly [number, number]

/**
 * What the top card plots, kept per session in the store: live agents (a point at each change of
 * the count), all tokens since the last compaction (main loop and agents, a point at each model
 * request, see addStep), and the times of the compactions. Agent points older than the window are
 * dropped, except the last one before it; token points are kept one RATE_MS longer, so the
 * tokens per minute at the left edge still has its minute (UCR-113). The tokens-per-minute trace
 * is worked out from the token points (tokenRate), so it is not stored. `seeds` are the times of
 * token points set from the kept count after a load (seedSeries), whose rise is no usage.
 */
export type Series = { agents: Point[]; tokens: Point[]; compacts: number[]; seeds?: number[] }

/** The time axis spans the last 30 minutes. */
export const WINDOW_MS = 30 * 60_000
/** Most points kept per series. */
export const SERIES_CAP = 2000
/** The tokens-per-minute trace counts the tokens of the minute before each QUANT_MS step. */
export const RATE_MS = 60_000

/** X positions snap to this step, so a redraw between steps sends the same markup. */
export const QUANT_MS = 30_000
/** An axis shrinks only after every visible value stayed below half of it for this long. */
export const SHRINK_MS = 5 * 60_000

export const emptySeries = (): Series => ({ agents: [], tokens: [], compacts: [] })

/** Drops points older than `keepMs` (the window), keeping the last one before it so the line starts at the left edge. */
export function trimPoints(points: readonly Point[], now: number, keepMs = WINDOW_MS): Point[] {
  const from = now - keepMs
  const first = points.findIndex(point => point[0] >= from)
  const start = first === -1 ? Math.max(0, points.length - 1) : Math.max(0, first - 1)

  return points.slice(start).slice(-SERIES_CAP)
}

/**
 * The blip rule (UCR-195): a new time more than one QUANT_MS behind the last point is not a small
 * step back but a clock that once read far ahead. The points later than the new time are then
 * re-timed to it, with their values kept, so the series follows the clock again from here. A
 * smaller step back keeps the clamp of UCR-158 (the new point goes at the last point's time).
 * This moves one list of points only; retimeSeries moves the compactions and seeds with them, so
 * a seeded point keeps its seed mark (UCR-215).
 */
export function retimeTail(points: readonly Point[], at: number): readonly Point[] {
  const last = points[points.length - 1]
  if (last === undefined || last[0] - at <= QUANT_MS) {
    return points
  }

  return points.map((point): Point => (point[0] > at ? [at, point[1]] : point))
}

/**
 * The time a trim may cut to (UCR-212): the new time, but never more than one QUANT_MS past the
 * last point already held (the last trusted time). A clock that reads far ahead once (a blip) then
 * trims nothing; the next real read re-times the blip point (retimeTail) and trims as usual. A real
 * gap (an idle hour) is trimmed at the request after it, one point later.
 */
export function trustedTime(points: readonly Point[], at: number): number {
  const last = points[points.length - 1]

  return last === undefined ? at : Math.min(at, last[0] + QUANT_MS)
}

/** Adds a point when the value changed (or the series is empty), then trims to `keepMs`. */
export function addPoint(all: readonly Point[], rawAt: number, value: number, keepMs = WINDOW_MS): Point[] {
  const points = retimeTail(all, rawAt)
  const last = points[points.length - 1]
  // Points stay in time order: a clock that stepped back adds its point at the last point's time (UCR-158).
  const at = last === undefined ? rawAt : Math.max(rawAt, last[0])
  const trim = trustedTime(points, at)
  if (last !== undefined && last[1] === value) {
    return trimPoints(points, trim, keepMs)
  }

  return trimPoints([...points, [at, value]], trim, keepMs)
}

/**
 * Adds one live-agent count. A change in the same QUANT_MS step as the last point replaces that
 * point (the step keeps its last value), as the plot snaps x to the step anyway: a count that
 * flips every second would else fill SERIES_CAP and push the start of the window out (UCR-162).
 * The series' first point is never replaced, so the line keeps its start; a replacement that
 * returns to the value before it leaves no point.
 */
export function addAgentPoint(all: readonly Point[], at: number, value: number): Point[] {
  const points = retimeTail(all, at)
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  if (last !== undefined && prev !== undefined && last[1] !== value && Math.floor(last[0] / QUANT_MS) === Math.floor(Math.max(at, last[0]) / QUANT_MS)) {
    return addPoint(points.slice(0, -1), at, value)
  }

  return addPoint(points, at, value)
}

/** How long token points are kept: the window and the minute the first tokens-per-minute step sums. */
const TOKEN_KEEP_MS = WINDOW_MS + RATE_MS

/**
 * Adds one model request's count to the token series. A request in the same QUANT_MS step as the
 * last point, when that point was a rise, moves that point up instead of adding one: the plot
 * snaps x to QUANT_MS anyway, the rises in each step still sum to the tokens of that step (so
 * tokenRate is exact), and a busy session keeps about two points a step, far under SERIES_CAP,
 * where one point per request would push the start of the window out of the cap.
 */
export function addStep(all: readonly Point[], rawAt: number, value: number, seeds: readonly number[] = [], used = 0): Point[] {
  const points = retimeTail(all, rawAt)
  if (points.length === 0 && seeds.length === 0 && used > 0 && value > 0) {
    // The first request of a fresh series: a base point under it, so its rise counts as usage (UCR-157).
    return addStep([[rawAt, Math.max(0, value - used)]], rawAt, value, seeds)
  }
  const last0 = points[points.length - 1]
  const at = last0 === undefined ? rawAt : Math.max(rawAt, last0[0])
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  // A seeded point is never moved: its time marks its rise as no usage (seedSeries).
  if (last !== undefined && prev !== undefined && last[1] > prev[1] && value >= last[1] && Math.floor(last[0] / QUANT_MS) === Math.floor(at / QUANT_MS) && !seeds.includes(last[0])) {
    return trimPoints([...points.slice(0, -1), [at, value]], trustedTime(points, at), TOKEN_KEEP_MS)
  }

  return addPoint(points, at, value, TOKEN_KEEP_MS)
}

/**
 * Tokens per minute over the window, from the token series: at each QUANT_MS step `t`, the sum of
 * the rises with a time in [t - RATE_MS, t). A fall (a compaction) is no usage, the first point
 * has no rise, and the rise into the first point at a `seeds` time is no usage, so a value seeded from the
 * kept count after a load is never counted as usage. The steps start where the data starts (the
 * left edge at the latest) and end at `now` snapped down, so the trace, like the rest of the card,
 * changes only with the data and each QUANT_MS step.
 */
export function tokenRate(points: readonly Point[], now: number, seeds: readonly number[] = []): Point[] {
  const first = points[0]
  if (first === undefined) {
    return []
  }
  const end = Math.floor(now / QUANT_MS) * QUANT_MS
  const rises: Point[] = []
  for (let i = 1; i < points.length; i += 1) {
    const rise = points[i]![1] - points[i - 1]![1]
    // The seed is the first point at its time; a request counted at that same ms comes after it.
    const isSeed = seeds.includes(points[i]![0]) && points[i - 1]![0] !== points[i]![0]
    if (rise > 0 && !isSeed) {
      rises.push([points[i]![0], rise])
    }
  }
  const out: Point[] = []
  for (let t = Math.max(end - WINDOW_MS, Math.ceil(first[0] / QUANT_MS) * QUANT_MS); t <= end; t += QUANT_MS) {
    out.push([t, rises.reduce((sum, rise) => (rise[0] >= t - RATE_MS && rise[0] < t ? sum + rise[1] : sum), 0)])
  }

  return out
}

/**
 * The series after a load, so the trace ends at the kept count since the last compaction, the
 * value the mod holds. The count is stored at each model request and the series only with a
 * redraw (UCR-084), so the kept series can lag the kept count:
 * - a series with no token point gets one point at `now` with the kept count;
 * - a kept compaction inside the window, missing from the series and after its last token point,
 *   gets its marker, and its fall to zero when the series has token points;
 * - a series whose last token value is under the kept count gets a point at `now` with the count.
 * Each point added at `now` is a seed: tokenRate counts its rise as no usage, so the gap draws no
 * false tokens-per-minute spike. A series at or above the kept count is returned as it is.
 */
export function seedSeries(series: Series, usage: Usage | undefined, now: number): Series {
  if (usage === undefined) {
    return series
  }
  const kept = Math.max(0, usage.tokens - (usage.atCompact ?? 0))
  const at = usage.compactAt
  const lastAt = series.tokens[series.tokens.length - 1]?.[0] ?? -Infinity
  const isMarked = at !== undefined && at >= now - WINDOW_MS && at <= now && !series.compacts.includes(at) && at > lastAt
  // The fall to zero only after points of the segment before it; an empty series gets the marker alone.
  const fall: Point[] = series.tokens.length > 0 && at !== undefined ? [[at, 0]] : []
  const marked = isMarked ? { ...series, tokens: [...series.tokens, ...fall], compacts: [...series.compacts, at].sort((a, b) => a - b) } : series
  const last = marked.tokens[marked.tokens.length - 1]
  if (last !== undefined && last[1] >= kept) {
    return marked
  }
  // After the last point, never at its time: the seed must be the first point at its time.
  const time = last !== undefined && last[0] >= now ? last[0] + 1 : now

  return { ...marked, tokens: [...marked.tokens, [time, kept]], seeds: [...(series.seeds ?? []), time] }
}

/**
 * The whole series re-timed by the blip rule of retimeTail (UCR-195, UCR-215): when the latest
 * time it holds (a token or agent point, a compaction, a seed) is more than one QUANT_MS past `at`,
 * every token point, agent point, compaction and seed later than `at` moves to `at`. So a
 * compaction mark moves back with its fall, and a seed with its point, and the seed's rise stays
 * no usage. The seed must stay the first point at its time (tokenRate): the re-timed token points
 * before the last seeded one go (their rises are inside the seed's, which the kept count already
 * holds), and the run goes 1 ms after `at` when a kept point sits at `at` already. A series that is
 * not ahead is returned as it is.
 */
export function retimeSeries(series: Series, at: number): Series {
  const seeds = series.seeds ?? []
  const lastOf = (points: readonly Point[]) => points[points.length - 1]?.[0] ?? -Infinity
  const latest = Math.max(lastOf(series.tokens), lastOf(series.agents), ...series.compacts, ...seeds)
  if (!(latest - at > QUANT_MS)) {
    return series
  }
  const kept = series.tokens.filter(point => point[0] <= at)
  let run = series.tokens.filter(point => point[0] > at)
  let seedAt: number | undefined
  let seedIndex = -1
  run.forEach((point, i) => {
    if (seeds.includes(point[0])) {
      seedIndex = i
    }
  })
  let time = at
  if (seedIndex >= 0) {
    run = run.slice(seedIndex)
    time = kept[kept.length - 1]?.[0] === at ? at + 1 : at
    seedAt = time
  }
  const tokens = [...kept, ...run.map((point): Point => [time, point[1]])]
  const compacts = [...new Set(series.compacts.map(one => Math.min(one, at)))].sort((a, b) => a - b)
  const nextSeeds = [...seeds.filter(one => one <= at), ...(seedAt === undefined ? [] : [seedAt])]
  return {
    agents: series.agents.map((point): Point => (point[0] > at ? [at, point[1]] : point)),
    tokens,
    compacts,
    ...(nextSeeds.length > 0 ? { seeds: nextSeeds } : {}),
  }
}

/** One model request's count, on the whole series: re-timed first (retimeSeries), then addStep with the series' seeds. */
export function addTokens(series: Series, rawAt: number, value: number, used = 0): Series {
  const timed = retimeSeries(series, rawAt)

  return { ...timed, tokens: addStep(timed.tokens, rawAt, value, timed.seeds, used) }
}

/** One live-agent count, on the whole series: re-timed first (retimeSeries), then addAgentPoint. */
export function addAgents(series: Series, rawAt: number, value: number): Series {
  const timed = retimeSeries(series, rawAt)

  return { ...timed, agents: addAgentPoint(timed.agents, rawAt, value) }
}

/** Records a compaction: the marker, and the token line falling to zero. */
export function addCompact(series: Series, rawAt: number): Series {
  // Clamped like addStep (UCR-158): a compaction behind the last token point goes at its time; a far-behind one re-times the series (UCR-195, UCR-215).
  const timed = retimeSeries(series, rawAt)
  const tokens = retimeTail(timed.tokens, rawAt)
  const last = tokens[tokens.length - 1]
  const at = last === undefined ? rawAt : Math.max(rawAt, last[0])
  const trim = trustedTime(tokens, at)
  const from = trim - WINDOW_MS
  // A compaction already at this time is not added again (UCR-216): two marks on one x would draw two dashed lines.
  const compacts = timed.compacts.map(one => Math.min(one, at)).filter(one => one >= from)

  return { ...timed, tokens: trimPoints([...tokens, [at, 0]], trim, TOKEN_KEEP_MS), compacts: [...new Set([...compacts, at])].slice(-SERIES_CAP) }
}

/**
 * Reads a stored series back, keeping only well-formed points: finite, not negative, not later than
 * `now` plus one QUANT_MS step (a clock that ran ahead), sorted by time (the sort is stable, so
 * points at one time keep their order). Compaction times and seeds need the same bounds (UCR-158).
 */
export function readKeptSeries(stored: unknown, now = Infinity): Series {
  const out = emptySeries()
  if (typeof stored !== 'object' || stored === null) {
    return out
  }
  const raw = stored as Partial<Record<keyof Series, unknown>>
  const limit = now + QUANT_MS
  const points = (list: unknown): Point[] =>
    Array.isArray(list)
      ? list
          .filter((one): one is [number, number] => Array.isArray(one) && one.length === 2 && Number.isFinite(one[0]) && Number.isFinite(one[1]) && one[0] <= limit && one[1] >= 0)
          .sort((a, b) => a[0] - b[0])
          .slice(-SERIES_CAP)
      : []
  out.agents = points(raw.agents)
  out.tokens = points(raw.tokens)
  // One compaction a time (UCR-216).
  out.compacts = Array.isArray(raw.compacts) ? [...new Set(raw.compacts.filter((one): one is number => Number.isFinite(one) && one <= limit))].sort((a, b) => a - b).slice(-SERIES_CAP) : []
  // Seeds older than the first token point mark no point any more; a seed past the limit is a clock that ran ahead, as for points (UCR-216).
  const first = out.tokens[0]?.[0] ?? Infinity
  const seeds = Array.isArray(raw.seeds) ? raw.seeds.filter((one): one is number => Number.isFinite(one) && one >= first && one <= limit).slice(-SERIES_CAP) : []
  if (seeds.length > 0) {
    out.seeds = seeds
  }

  return out
}

/** One axis: its top value, and since when every visible value has been under half of it. */
export type AxisState = { max: number; lowSince?: number }
export type Axes = { agents: AxisState; tokens: AxisState }
type AxisKind = 'agents' | 'tokens'

/** The nth nice top: agents 4, 6, 8, 12, 16, 24, 32...; tokens 150k, 300k, 600k, 900k, 1.5M, 3M, 6M, 9M, 15M... */
function niceAt(kind: AxisKind, k: number): number {
  return kind === 'agents'
    ? (k % 2 === 0 ? 4 : 6) * 2 ** Math.floor(k / 2)
    : Math.round([1.5, 3, 6, 9][k % 4]! * 10 ** (5 + Math.floor(k / 4)))
}

/** The smallest nice axis top that holds `peak`. */
export function niceMax(kind: AxisKind, peak: number): number {
  // A peak that is not a number (UCR-155) draws the base step, never the last of 200.
  if (!Number.isFinite(peak)) {
    return niceAt(kind, 0)
  }
  for (let k = 0; k < 200; k += 1) {
    const value = niceAt(kind, k)
    if (value >= peak) {
      return value
    }
  }

  return niceAt(kind, 199)
}

/**
 * The next state of one axis: it grows when the peak would leave the plot, to the next nice step;
 * it shrinks, to the step that holds the peak, only after the peak stayed under half the axis for
 * SHRINK_MS. Otherwise it stays.
 */
export function stepAxis(prev: AxisState | undefined, kind: AxisKind, peak: number, now: number): AxisState {
  const need = niceMax(kind, peak)
  if (prev === undefined || peak > prev.max) {
    return { max: need }
  }
  if (peak < prev.max / 2) {
    const low = prev.lowSince ?? now

    return now - low >= SHRINK_MS ? { max: need } : { max: prev.max, lowSince: low }
  }

  return { max: prev.max }
}

/** The points on the plot: those in the window, and the one before it moved to the left edge. */
export function windowed(points: readonly Point[], from: number): Point[] {
  const inside = points.filter(point => point[0] >= from)
  const before = points.filter(point => point[0] < from).pop()

  return before === undefined ? inside : [[from, before[1]], ...inside]
}

/**
 * The points to draw: the first, then the last point of each QUANT_MS step (UCR-217). The series
 * coalesces each step to about one point already (addStep, addAgentPoint), so a live series draws
 * as it is held; a stored series of an older build, up to SERIES_CAP points, draws its steps only,
 * and the end labels place over about 60 segments a trace, not 2000 (358 ms a draw before).
 */
export function onePerStep(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const point of points) {
    const prev = out[out.length - 1]
    if (out.length > 1 && prev !== undefined && Math.floor(prev[0] / QUANT_MS) === Math.floor(point[0] / QUANT_MS)) {
      out[out.length - 1] = point
    } else {
      out.push(point)
    }
  }

  return out
}

/**
 * The token axis's top over the tokens-per-minute axis's top (#T003K): the rate axis is always the
 * token axis divided by RATE_RATIO, so the two lines stay comparable at every scale.
 */
export const RATE_RATIO = 10

/** Steps both axes for the series as of `now`. */
export function stepAxes(prev: Axes | undefined, series: Series, now: number): Axes {
  const from = Math.floor(now / QUANT_MS) * QUANT_MS - WINDOW_MS
  const peak = (points: readonly Point[]) => windowed(points, from).reduce((top, point) => Math.max(top, point[1]), 0)

  // The token axis holds both token traces: the count since compact, and the tokens per minute on its own axis, RATE_RATIO times smaller.
  const tokenPeak = Math.max(peak(series.tokens), peak(tokenRate(series.tokens, now, series.seeds)) * RATE_RATIO)

  return { agents: stepAxis(prev?.agents, 'agents', peak(series.agents), now), tokens: stepAxis(prev?.tokens, 'tokens', tokenPeak, now) }
}
