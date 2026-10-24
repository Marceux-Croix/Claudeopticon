import { expect, test } from 'claude-code/testing'

import { addAgentPoint, addAgents, addCompact, addPoint, addStep, addTokens, emptySeries, niceMax, onePerStep, QUANT_MS, readKeptSeries, retimeSeries, seedSeries, SERIES_CAP, sinceCompact, stepAxes, stepAxis, tokenRate, WINDOW_MS } from '../hooks/series'
import type { Point, Series } from '../hooks/series'

const MIN = 60_000
const HERO_NOW = 100 * MIN

test('the series records a point only when the value changes, and keeps 30 minutes plus one point before', async () => {
  let live: Point[] = []
  live = addPoint(live, 0, 0)
  live = addPoint(live, 1 * MIN, 0)
  expect(live).toEqual([[0, 0]])
  live = addPoint(live, 2 * MIN, 1)
  live = addPoint(live, 10 * MIN, 3)
  live = addPoint(live, 20 * MIN, 2)
  expect(live.length).toBe(4)
  // At 35 minutes, 15 minutes after the last point: since a point far after the last one trims only to the
  // last point plus one QUANT_MS (it may be a clock blip), so the point at 0 stays until the next point.
  live = addPoint(live, 35 * MIN, 1)
  expect(live).toEqual([[0, 0], [2 * MIN, 1], [10 * MIN, 3], [20 * MIN, 2], [35 * MIN, 1]])
  // The next point, 30 s on, trims to the window: it starts at 5.5, the point at 2 is the one before it and stays.
  live = addPoint(live, 35.5 * MIN, 4)
  expect(live).toEqual([[2 * MIN, 1], [10 * MIN, 3], [20 * MIN, 2], [35 * MIN, 1], [35.5 * MIN, 4]])
  // At 60 minutes the trim goes to 36 (the window starts at 6): the point at 2 is still the one before it.
  live = addPoint(live, 60 * MIN, 0)
  expect(live).toEqual([[2 * MIN, 1], [10 * MIN, 3], [20 * MIN, 2], [35 * MIN, 1], [35.5 * MIN, 4], [60 * MIN, 0]])
  // And 30 s later the window starts at 30.5: the point at 20 is the one before it.
  live = addPoint(live, 60.5 * MIN, 1)
  expect(live).toEqual([[20 * MIN, 2], [35 * MIN, 1], [35.5 * MIN, 4], [60 * MIN, 0], [60.5 * MIN, 1]])
  expect(WINDOW_MS).toBe(30 * MIN)
  // A series is capped.
  let many: Point[] = []
  for (let i = 0; i < SERIES_CAP + 500; i += 1) {
    many = addPoint(many, 1000 + i, i % 2)
  }
  expect(many.length).toBe(SERIES_CAP)
})

test('a stored series reads back whole, and malformed entries are dropped', async () => {
  let series: Series = emptySeries()
  series = { ...series, agents: addPoint(series.agents, 1000, 2) }
  series = { ...series, tokens: addPoint(series.tokens, 2000, 500) }
  series = addCompact(series, 3000)
  expect(readKeptSeries(JSON.parse(JSON.stringify(series)))).toEqual(series)
  expect(readKeptSeries({ agents: [[1, 2], [3], 'x', [4, NaN]], tokens: 5, compacts: [1, 'a'] })).toEqual({ agents: [[1, 2]], tokens: [], compacts: [1] })
  expect(readKeptSeries(undefined)).toEqual(emptySeries())
})

test('the nice axis tops: agents 4, 6, 8, 12, 16, 24; tokens 150k, 300k, 600k, 900k, 1.5M, 3M', async () => {
  const up = (kind: 'agents' | 'tokens', peaks: number[]) => peaks.map(peak => niceMax(kind, peak))
  expect(up('agents', [0, 4, 5, 6, 7, 9, 13, 17, 25, 33])).toEqual([4, 4, 6, 6, 8, 12, 16, 24, 32, 48])
  expect(up('tokens', [0, 150_000, 150_001, 400_000, 700_000, 1_000_000, 1_600_000, 44_810_000, 70_000_000, 100_000_000])).toEqual([
    150_000, 150_000, 300_000, 600_000, 900_000, 1_500_000, 3_000_000, 60_000_000, 90_000_000, 150_000_000,
  ])
})

test('an axis grows to the next step when a value would leave the plot, and shrinks once the peak is under half', async () => {
  let axis = stepAxis(undefined, 'agents', 3)
  expect(axis.max).toBe(4)
  axis = stepAxis(axis, 'agents', 4)
  expect(axis.max).toBe(4)
  axis = stepAxis(axis, 'agents', 5)
  expect(axis.max).toBe(6)
  axis = stepAxis(axis, 'agents', 9)
  expect(axis.max).toBe(12)
  // At half (6) or above, it stays.
  axis = stepAxis(axis, 'agents', 6)
  expect(axis).toEqual({ max: 12 })
  // Under half, it shrinks at once to the step that holds the peak.
  axis = stepAxis(axis, 'agents', 5)
  expect(axis.max).toBe(6)
  axis = stepAxis(axis, 'agents', 2)
  expect(axis.max).toBe(4)
  // Tokens use the same rule.
  let tokensAxis = stepAxis(undefined, 'tokens', 44_810_000)
  expect(tokensAxis.max).toBe(60_000_000)
  tokensAxis = stepAxis(tokensAxis, 'tokens', 1_000_000)
  expect(tokensAxis.max).toBe(1_500_000)
})

test('the rate axis lets go of a rate burst the moment it leaves the window', async () => {
  let series = emptySeries()
  let axes: ReturnType<typeof stepAxes> | undefined
  let t = HERO_NOW
  // A burst: 10M a step for 10 steps (20M a minute), then a slow climb of 100k a step.
  for (let i = 1; i <= 10; i += 1) {
    t += QUANT_MS
    series = addTokens(series, t, i * 10_000_000, 10_000_000)
    axes = stepAxes(axes, series, t)
  }
  // the burst holds the rate axis (20M a minute), and only the count (100M) the token axis.
  expect(axes!.rate.max).toBe(30_000_000)
  expect(axes!.tokens.max).toBe(150_000_000)
  const burstEnd = t
  for (let i = 1; t < burstEnd + WINDOW_MS + 4 * QUANT_MS; i += 1) {
    t += QUANT_MS
    series = addTokens(series, t, 100_000_000 + i * 100_000, 100_000)
    axes = stepAxes(axes, series, t)
    if (t < burstEnd + WINDOW_MS - QUANT_MS) {
      expect(axes.rate.max).toBe(30_000_000)
    }
  }
  // The slow climb (200k a minute) holds the rate axis now; the burst no longer does, and no 5-minute hold keeps it.
  expect(axes!.rate.max).toBe(300_000)
})

test('the token axis holds the count since the last compaction in the window, not the count before it', async () => {
  const tokens = [[HERO_NOW - 20 * MIN, 375_000_000], [HERO_NOW - 15 * MIN, 0], [HERO_NOW - 5 * MIN, 13_000_000]] as Point[]
  const series = { agents: [], tokens, compacts: [HERO_NOW - 15 * MIN] }
  expect(sinceCompact(series, HERO_NOW - WINDOW_MS)).toEqual(tokens.slice(1))
  // A compaction out of the window holds nothing back.
  expect(sinceCompact(series, HERO_NOW - 10 * MIN)).toEqual(tokens)
  // The count since the compaction is 13M, so the step holds 15M, not 375M. The rate has its own axis.
  expect(stepAxes(undefined, series, HERO_NOW).tokens.max).toBe(15_000_000)
  const slow = { ...series, tokens: [...tokens.slice(0, 2), [HERO_NOW - 10 * MIN, 6_500_000], [HERO_NOW - 5 * MIN, 13_000_000]] as Point[] }
  expect(stepAxes(undefined, slow, HERO_NOW).tokens.max).toBe(15_000_000)
})

test('stepAxes plots the visible values only, so a value that left the window no longer holds the axis up', async () => {
  const series = { agents: [[HERO_NOW - 60 * MIN, 20], [HERO_NOW - 40 * MIN, 1]] as Point[], tokens: [], compacts: [] }
  expect(stepAxes(undefined, series, HERO_NOW).agents.max).toBe(4)
  const high = { ...series, agents: [[HERO_NOW - 20 * MIN, 20]] as Point[] }
  expect(stepAxes(undefined, high, HERO_NOW).agents.max).toBe(24)
})

// ---------------------------------------------------------------- ,

test('a load with a kept count and no token point seeds the trace at that count, with the compaction marked inside the window', () => {
  const now = 200 * MIN
  const usage = { tokens: 603_133_622, atCompact: 602_397_694, compactAt: now - 11 * MIN, since: 0 }
  // State 1, the live case: a kept count and no series at all.
  const seeded = seedSeries(emptySeries(), usage, now)
  expect(seeded.tokens).toEqual([[now, 735_928]])
  expect(seeded.compacts).toEqual([now - 11 * MIN])
  // State 2: a series with agent points but no token point (it was written by code that kept no token points).
  const agentsOnly = seedSeries({ agents: [[now - MIN, 3]], tokens: [], compacts: [] }, usage, now)
  expect(agentsOnly.tokens).toEqual([[now, 735_928]])
  expect(agentsOnly.agents).toEqual([[now - MIN, 3]])
  // State 3: the compaction at the limit of the window is marked; one just outside it is not, and the seed still is.
  expect(seedSeries(emptySeries(), { ...usage, compactAt: now - WINDOW_MS }, now).compacts).toEqual([now - WINDOW_MS])
  const outside = seedSeries(emptySeries(), { ...usage, compactAt: now - WINDOW_MS - 1 }, now)
  expect(outside.compacts).toEqual([])
  expect(outside.tokens).toEqual([[now, 735_928]])
  // A count with no compaction seeds its whole value; a series whose last token point holds the kept
  // count, or no count, is kept as it is (a series behind the count is seeded: B2 below; this
  // case was a point of 7 tokens, kept as it was).
  expect(seedSeries(emptySeries(), { tokens: 5000, since: 0 }, now).tokens).toEqual([[now, 5000]])
  const kept: Series = { agents: [], tokens: [[now - MIN, 735_928]], compacts: [now - 11 * MIN] }
  expect(seedSeries(kept, usage, now)).toBe(kept)
  expect(seedSeries(emptySeries(), undefined, now)).toEqual(emptySeries())
})

test('tokenRate counts each rise in the minute it happened: never a fall, never the seed', () => {
  const now = 100 * QUANT_MS
  let tokens: Point[] = [[now - 10 * MIN, 1_000_000]]
  // Steps of 10k, 20k and 30k inside one QUANT_MS step coalesce into one point that keeps their sum.
  tokens = addStep(tokens, now - 2 * MIN + 1000, 1_010_000)
  tokens = addStep(tokens, now - 2 * MIN + 2000, 1_030_000)
  tokens = addStep(tokens, now - 2 * MIN + 3000, 1_060_000)
  expect(tokens).toEqual([[now - 10 * MIN, 1_000_000], [now - 2 * MIN + 3000, 1_060_000]])
  // A compaction falls to zero; the next request rises from zero.
  tokens = addCompact({ agents: [], tokens, compacts: [] }, now - 90_000).tokens
  tokens = addStep(tokens, now - 45_000, 5_000)
  const rate = tokenRate(tokens, now)
  const at = (t: number) => rate.find(point => point[0] === t)?.[1]
  // The minute before now - 60 s holds the 60k of steps; the fall adds nothing; the minute before now holds the 5k.
  expect(at(now - 60_000)).toBe(60_000)
  expect(at(now - 30_000)).toBe(5_000)
  expect(at(now)).toBe(5_000)
  // The seed point (the first point, at 1M) is no usage: the rate is 0 before the first request.
  expect(at(now - 9 * MIN)).toBe(0)
  expect(Math.max(...rate.map(point => point[1]))).toBe(60_000)
  // The steps run from where the data starts to now, each QUANT_MS.
  expect(rate[0]![0]).toBe(now - 10 * MIN)
  expect(rate[rate.length - 1]![0]).toBe(now)
  expect(tokenRate([], now)).toEqual([])
})

test('the rate axis holds the highest tokens per minute, and the token axis only the count', () => {
  const now = 100 * QUANT_MS
  // A burst, a compaction a minute ago, and a quiet climb: the rate axis top fits every rate step.
  const states: Series[] = [
    { agents: [], tokens: [[now - 5 * MIN, 0], [now - 2 * MIN, 2_000_000], [now - MIN, 0], [now - 30_000, 100_000]], compacts: [now - MIN] },
    { agents: [], tokens: Array.from({ length: 30 }, (_, i) => [now - (30 - i) * MIN, i * 400_000] as Point), compacts: [] },
    { agents: [], tokens: [[now - 40 * MIN, 9_000_000], [now - 29 * MIN, 9_100_000]], compacts: [] },
  ]
  for (const series of states) {
    const axes = stepAxes(undefined, series, now)
    const ratePeak = Math.max(...tokenRate(series.tokens, now).map(point => point[1]))
    expect(axes.rate.max).toBe(niceMax('tokens', ratePeak))
    expect(axes.tokens.max).toBe(niceMax('tokens', Math.max(...sinceCompact(series, now - WINDOW_MS).map(point => point[1]))))
  }
  // A count of 600M with a rate of 2M a minute: the rate fills most of its axis, not 2% of it.
  const big: Series = { agents: [], tokens: [[now - 10 * MIN, 598_000_000], [now - 30_000, 600_000_000]], compacts: [] }
  const axes = stepAxes(undefined, big, now)
  expect(axes.tokens.max).toBeGreaterThanOrEqual(600_000_000)
  expect(axes.rate.max).toBeLessThanOrEqual(3_000_000)
})

test('B2 a kept series behind the kept count is brought to it, and its seeded rise is never usage', () => {
  const now = 200 * MIN
  const usage = { tokens: 2_000_000, atCompact: 1_000_000, since: 0 }
  // State 1: the series ends at 900k, 100k under the count.
  const behind: Series = { agents: [], tokens: [[now - 2 * MIN, 900_000]], compacts: [] }
  const seeded = seedSeries(behind, usage, now)
  expect(seeded.tokens).toEqual([[now - 2 * MIN, 900_000], [now, 1_000_000]])
  expect(seeded.seeds).toEqual([now])
  // The gap draws no tokens per minute at any step, and a request after it counts alone, not with the 100k.
  expect(tokenRate(seeded.tokens, now + 60_000, seeded.seeds).every(point => point[1] === 0)).toBe(true)
  const after = addStep(seeded.tokens, now + 10_000, 1_001_000, seeded.seeds)
  expect(after).toEqual([[now - 2 * MIN, 900_000], [now, 1_000_000], [now + 10_000, 1_001_000]])
  expect(tokenRate(after, now + 60_000, seeded.seeds).pop()).toEqual([now + 60_000, 1000])
  // A request in the same ms as the seed is usage; the seed is the first point at its time.
  const same = addStep(seeded.tokens, now, 1_002_000, seeded.seeds)
  expect(tokenRate(same, now + 30_000, seeded.seeds).pop()).toEqual([now + 30_000, 2000])
  // State 2, at the limit: one token under the count is seeded too.
  expect(seedSeries({ agents: [], tokens: [[now - MIN, 999_999]], compacts: [] }, usage, now).tokens.pop()).toEqual([now, 1_000_000])
  // State 3: a compaction the series missed (after its last point, inside the window) gets its marker and its fall, then the seed.
  const missed = seedSeries({ agents: [], tokens: [[now - 20 * MIN, 9_000_000]], compacts: [] }, { tokens: 9_050_000, atCompact: 9_000_000, compactAt: now - 5 * MIN, since: 0 }, now)
  expect(missed.tokens).toEqual([[now - 20 * MIN, 9_000_000], [now - 5 * MIN, 0], [now, 50_000]])
  expect(missed.compacts).toEqual([now - 5 * MIN])
  // Outside the defect: a series at or above the count is kept as it is, and a seed at the time of the last point goes 1 ms after it.
  const ahead: Series = { agents: [], tokens: [[now - MIN, 1_200_000]], compacts: [] }
  expect(seedSeries(ahead, usage, now)).toBe(ahead)
  expect(seedSeries({ agents: [], tokens: [[now, 10]], compacts: [] }, usage, now).seeds).toEqual([now + 1])
  // The seeds are stored with the series; one older than the first token point is dropped on reading.
  const read = readKeptSeries(JSON.parse(JSON.stringify({ ...seeded, seeds: [now - 9 * MIN, now] })))
  expect(read.seeds).toEqual([now])
  expect(readKeptSeries({ agents: [], tokens: [], compacts: [] }).seeds).toBeUndefined()
})

test('the token points keep the minute before the window, so tokens per minute at the left edge reads the steady rate', () => {
  const now = 2000 * QUANT_MS
  let points: Point[] = []
  // 100k every 30 s for 45 minutes: 200k a minute, steady.
  for (let t = now - 45 * MIN + 1_000; t <= now; t += 30_000) {
    points = addStep(points, t, (points[points.length - 1]?.[1] ?? 0) + 100_000)
  }
  const rate = tokenRate(points, now)
  // The first step sits on the left edge of the window and reads 200k like the rest (it read 100k).
  expect(rate[0]![0]).toBe(now - WINDOW_MS)
  expect(rate.every(point => point[1] === 200_000)).toBe(true)
  // Only the minute before the window (of the last request) is kept, and one point before it.
  const last = points[points.length - 1]![0]
  expect(points[1]![0]).toBeGreaterThanOrEqual(last - WINDOW_MS - MIN)
  expect(points[0]![0]).toBeLessThan(last - WINDOW_MS - MIN)
  // A compaction keeps the same horizon; the agent series keeps the window alone.
  expect(addCompact({ agents: [], tokens: points, compacts: [] }, now).tokens[1]![0]).toBeGreaterThanOrEqual(now - WINDOW_MS - MIN)
  const agents = [0, 1, 2, 3].reduce<Point[]>((list, k) => addPoint(list, now - (33 - k) * MIN, k), [])
  // A point 30 minutes after the last one trims only to the last point plus one QUANT_MS (it may be a
  // clock blip), so all are kept; the next point, 30 s on, trims to its window: the point at its edge (now - 30 m)
  // is the one before it, and nothing older.
  const atNow = addPoint(agents, now, 9)
  expect(atNow).toEqual([[now - 33 * MIN, 0], [now - 32 * MIN, 1], [now - 31 * MIN, 2], [now - 30 * MIN, 3], [now, 9]])
  expect(addPoint(atNow, now + QUANT_MS, 8)).toEqual([[now - 30 * MIN, 3], [now, 9], [now + QUANT_MS, 8]])
})

// ---------------------------------------------------------------- more cases

test('niceMax gives the base step for a peak that is not a finite number, never the last of 200', () => {
  for (const peak of [NaN, Infinity, -Infinity]) {
    expect(niceMax('tokens', peak)).toBe(150_000)
    expect(niceMax('agents', peak)).toBe(4)
  }
  // A finite peak is unchanged.
  expect(niceMax('tokens', 200_000)).toBe(300_000)
})

test('the first request of a fresh series counts in tokens per minute: a base point sits under it', () => {
  const t0 = 10 * QUANT_MS
  // State 1: the very first request of an empty, unseeded series.
  const first = addStep([], t0 + 1000, 3500, [], 3500)
  expect(first).toEqual([[t0 + 1000, 0], [t0 + 1000, 3500]])
  expect(tokenRate(first, t0 + QUANT_MS).find(point => point[0] === t0 + QUANT_MS)?.[1]).toBe(3500)
  // State 2: three requests of 1000, 2000 and 500 inside one minute add up to 3500 (they read 2500).
  let points: Point[] = []
  let total = 0
  for (const [at, used] of [[1000, 1000], [11_000, 2000], [21_000, 500]] as const) {
    total += used
    points = addStep(points, t0 + at, total, [], used)
  }
  const rate = tokenRate(points, t0 + 51_000)
  expect(rate[rate.length - 1]![1]).toBe(3500)
  // State 3, the limit: a first request after a compaction restart is the same as any first request (value equals used).
  expect(addStep([], t0, 800, [], 800)).toEqual([[t0, 0], [t0, 800]])
  // Excluded populations: a seeded series gets no base point (its first point is the seed), a series with points gets none, and a request that used nothing gets none.
  expect(addStep([], t0, 5000, [t0], 700)).toEqual([[t0, 5000]])
  expect(addStep([[t0, 100]], t0 + 1000, 200, [], 100)).toEqual([[t0, 100], [t0 + 1000, 200]])
  expect(addStep([], t0, 5000, [], 0)).toEqual([[t0, 5000]])
})

test('a point never goes back in time: a clock that stepped back is clamped to the last point', () => {
  const t = 100 * QUANT_MS
  // addPoint: a point 10 minutes in the past of the last one. Since a step back of more than one QUANT_MS
  // re-times the last point to the new time (the old expectation clamped the new point forward, which froze the
  // trace after a clock blip). The series stays in time order.
  expect(addPoint([[t, 1]], t - 10 * MIN, 2)).toEqual([[t - 10 * MIN, 1], [t - 10 * MIN, 2]])
  // addStep: a request more than one step in the past of the last point re-times that point, so it joins that step.
  expect(addStep([[t, 1], [t + QUANT_MS * 3, 5]], t, 9)).toEqual([[t, 1], [t, 9]])
  // A step back of one QUANT_MS or less keeps the clamp of .
  expect(addStep([[t, 1], [t + QUANT_MS, 5]], t, 9)).toEqual([[t, 1], [t + QUANT_MS, 9]])
  // The limit: exactly the last point's time is kept as it is.
  expect(addPoint([[t, 1]], t, 2)).toEqual([[t, 1], [t, 2]])
  // The excluded population: a point later than the last one is not moved.
  expect(addPoint([[t, 1]], t + 5, 2)).toEqual([[t, 1], [t + 5, 2]])
  // Any run of times in any order leaves the series sorted.
  let list: Point[] = []
  for (const [k, at] of [-600_000, 3_600_000, -300_000, -60_000].entries()) {
    list = addPoint(list, t + at, k)
  }
  expect(list.map(point => point[0])).toEqual([...list.map(point => point[0])].sort((a, b) => a - b))
})

test('readKeptSeries sorts the points by time and drops negative values and points past now plus one step', () => {
  const now = 100 * QUANT_MS
  const stored = {
    agents: [[now - 2000, 2], [now - 9000, 1], [now + QUANT_MS, 3], [now + QUANT_MS + 1, 4]],
    tokens: [[now - 1000, 50], [now - 5000, -1], [now - 8000, 10], [now + 10 * 60_000, 99]],
    compacts: [now - 1000, now - 7000, now + 10 * 60_000],
  }
  const read = readKeptSeries(stored, now)
  // Sorted; a point at exactly now + QUANT_MS stays (the limit); one ms later goes.
  expect(read.agents).toEqual([[now - 9000, 1], [now - 2000, 2], [now + QUANT_MS, 3]])
  expect(read.tokens).toEqual([[now - 8000, 10], [now - 1000, 50]])
  expect(read.compacts).toEqual([now - 7000, now - 1000])
  // Without a clock nothing is dropped for being late, but the order is still the time order.
  expect(readKeptSeries(stored).tokens.map(point => point[0])).toEqual([now - 8000, now - 1000, now + 10 * 60_000])
})

test('agent points are coalesced per QUANT_MS step: the step keeps its last value', () => {
  const t = 100 * QUANT_MS
  // A count that changes every 500 ms for 20 minutes (a seeded sequence, 2400 changes) makes at most two points a step.
  let seed = 7
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648

    return seed % 6
  }
  const fed: Point[] = []
  let points: Point[] = []
  for (let k = 0; k < 2400; k += 1) {
    const at = t + k * 500
    const value = next()
    fed.push([at, value])
    points = addAgentPoint(points, at, value)
  }
  expect(points.length).toBeLessThanOrEqual(2 * ((20 * MIN) / QUANT_MS) + 1)
  // The first point stays, and the 20 minutes are all there: the line is not cut at the left (the cap held them before, too, but a flip every 0.5 s for 17 minutes would not).
  expect(points[0]![0]).toBe(t)
  // At the end of every step the plot holds the last value fed in it.
  const valueAt = (list: readonly Point[], when: number) => list.filter(point => point[0] <= when).pop()?.[1]
  for (let step = 0; step < (20 * MIN) / QUANT_MS; step += 1) {
    const end = t + (step + 1) * QUANT_MS - 1
    expect(valueAt(points, end)).toBe(valueAt(fed, end))
  }
  // A step keeps its last value; a change that returns to the value before the step leaves no point.
  const base: Point[] = [[t, 0], [t + QUANT_MS, 2]]
  expect(addAgentPoint(base, t + QUANT_MS + 1000, 3)).toEqual([[t, 0], [t + QUANT_MS + 1000, 3]])
  expect(addAgentPoint(base, t + QUANT_MS + 1000, 0)).toEqual([[t, 0]])
  // The next step adds a point; a series with one point adds a second in the same step (the first is never replaced).
  expect(addAgentPoint(base, t + 2 * QUANT_MS, 3)).toEqual([[t, 0], [t + QUANT_MS, 2], [t + 2 * QUANT_MS, 3]])
  expect(addAgentPoint([[t, 0]], t + 1000, 2)).toEqual([[t, 0], [t + 1000, 2]])
})

test('M1 tokenRate window: a rise at exactly t counts in the steps after t, not at t; a rise at exactly t - 60 s counts at t', () => {
  const t = 50 * QUANT_MS
  const points: Point[] = [[t - 5 * MIN, 0], [t, 1000]]
  const at = (list: Point[], when: number) => list.find(point => point[0] === when)?.[1]
  const rate = tokenRate(points, t + 3 * MIN)
  // [t - 60 s, t): the rise at t is not inside it for the step t, and is inside for t + 30 s and t + 60 s; for t + 90 s it is out.
  expect(at(rate, t)).toBe(0)
  expect(at(rate, t + QUANT_MS)).toBe(1000)
  expect(at(rate, t + 2 * QUANT_MS)).toBe(1000)
  expect(at(rate, t + 3 * QUANT_MS)).toBe(0)
})

test('addCompact never goes back in time: a compaction behind the last point goes at its time', () => {
  const t = 100 * QUANT_MS
  const base: Series = { agents: [], tokens: [[t, 1000], [t + 60_000, 2000]], compacts: [] }
  // Three states: 1 s behind, exactly one step behind (the limit): clamped to the last point. 50 s behind (the reported
  // defect, more than a step): the tail is re-timed. In all three the times stay in order.
  for (const behind of [1000, QUANT_MS, 50_000]) {
    const out = addCompact(base, t + 60_000 - behind)
    const times = out.tokens.map(point => point[0])
    expect(times).toEqual([...times].sort((a, b) => a - b))
    const end = behind > QUANT_MS ? t + 60_000 - behind : t + 60_000
    expect(out.tokens[out.tokens.length - 1]).toEqual([end, 0])
    expect(out.compacts).toEqual([end])
  }
})

test('a clock that once read far ahead does not freeze the trace: the tail is re-timed to the new time', () => {
  // Rule: a new time more than one QUANT_MS behind the last point re-times the points after it to the new time, values kept.
  const T = 1_800_000_000_000 - (1_800_000_000_000 % QUANT_MS)
  let v = 1000
  let pts = addStep([], T - 600_000, v, [], 1000)
  v += 1000
  pts = addStep(pts, T + 3_600_000, v, [], 1000)
  for (let k = 1; k <= 20; k += 1) {
    v += 500
    pts = addStep(pts, T + k * QUANT_MS, v, [], 500)
  }
  // Twenty real requests of 500 tokens each 30 s: the hand rate is 1000 a minute in every full minute.
  const rate = tokenRate(pts, T + 600_000)
  const at = (when: number) => rate.find(point => point[0] === when)?.[1]
  for (let k = 4; k <= 20; k += 1) {
    expect(at(T + k * QUANT_MS)).toBe(1000)
  }
  expect(pts.every((point, i) => i === 0 || point[0] >= pts[i - 1]![0])).toBe(true)
  expect(pts.some(point => point[0] > T + 600_000)).toBe(false)
  // The agent line follows the clock again too.
  let agents = addAgentPoint([], T - 600_000, 1)
  agents = addAgentPoint(agents, T + 3_600_000, 2)
  agents = addAgentPoint(agents, T + 60_000, 3)
  expect(agents[agents.length - 1]).toEqual([T + 60_000, 3])
  expect(agents.some(point => point[0] > T + 60_000)).toBe(false)
  // A small step back (under one step) keeps the clamp.
  expect(addPoint([[T, 1]], T - 10_000, 2)).toEqual([[T, 1], [T, 2]])
  // A blip on the only point of a series (the limit): that point is re-timed.
  expect(addPoint([[T + 3_600_000, 1]], T, 2)).toEqual([[T, 1], [T, 2]])
})

// ---------------------------------------------------------------- more cases

const T5 = 1_792_000_000_000

test('one forward clock blip keeps the history: a trim never goes past the last point plus one QUANT_MS', () => {
  // State 1, the probe (blip.ts): 40 requests 30 s apart, one clock read 1 h ahead, then the next real request.
  let pts: Point[] = []
  let v = 0
  for (let i = 0; i < 40; i += 1) {
    pts = addStep(pts, T5 + i * QUANT_MS, (v += 1000), [], 1000)
  }
  expect(pts.length).toBe(41)
  pts = addStep(pts, T5 + 40 * QUANT_MS + 3_600_000, (v += 1000), [], 1000)
  // The old code trimmed to the blip time minus 31 minutes: 2 points left.
  expect(pts.length).toBe(42)
  pts = addStep(pts, T5 + 41 * QUANT_MS, (v += 1000), [], 1000)
  expect(pts.length).toBe(42)
  expect(pts[0]).toEqual([T5, 0])
  expect(pts.some(point => point[0] > T5 + 41 * QUANT_MS)).toBe(false)
  const rate = tokenRate(pts, T5 + 41 * QUANT_MS + 1)
  expect(rate.filter(point => point[1] > 0).length).toBeGreaterThan(30)
  // The agent line keeps its history the same way.
  let ag: Point[] = []
  for (let i = 0; i < 40; i += 1) {
    ag = addAgentPoint(ag, T5 + i * QUANT_MS, i % 3)
  }
  ag = addAgentPoint(ag, T5 + 40 * QUANT_MS + 3_600_000, 5)
  ag = addAgentPoint(ag, T5 + 41 * QUANT_MS, 1)
  expect(ag[0]![0]).toBe(T5)
  expect(ag.length).toBeGreaterThanOrEqual(40)
  // A compaction at the blip time keeps the history too.
  expect(addCompact({ agents: [], tokens: pts, compacts: [] }, T5 + 41 * QUANT_MS + 3_600_000).tokens[0]).toEqual([T5, 0])
  // State 2, the limit: a new point at the last point plus QUANT_MS trims to its own window; one further on trims no further.
  const t0 = 100 * QUANT_MS
  const four: Point[] = [[t0, 1], [t0 + 10 * MIN, 2], [t0 + 11 * MIN, 3], [t0 + 40 * MIN, 4]]
  expect(addPoint(four, t0 + 40 * MIN + QUANT_MS, 5).map(point => point[0])).toEqual([t0 + 10 * MIN, t0 + 11 * MIN, t0 + 40 * MIN, t0 + 40 * MIN + QUANT_MS])
  // The old code trimmed to t0 + 42 m and dropped the point at 10 m too.
  expect(addPoint(four, t0 + 42 * MIN, 5).map(point => point[0])).toEqual([t0 + 10 * MIN, t0 + 11 * MIN, t0 + 40 * MIN, t0 + 42 * MIN])
  // State 3, the population the bound holds back: a real idle gap is trimmed at the request after it.
  const after = addPoint(addPoint(four, t0 + 100 * MIN, 5), t0 + 100 * MIN + QUANT_MS, 6)
  expect(after.map(point => point[0])).toEqual([t0 + 40 * MIN, t0 + 100 * MIN, t0 + 100 * MIN + QUANT_MS])
})

test('retimeSeries re-times the compactions and seeds with the token points, so a seed stays no usage and a mark follows its fall', () => {
  const M = MIN
  // State 1, the probe S1: a seeded series, then a request from a clock set back 45 s (more than one step).
  let s: Series = { agents: [], tokens: [[T5 - 10 * M, 100], [T5 - 5 * M, 200]], compacts: [] }
  s = seedSeries(s, { tokens: 900_200, atCompact: 0, since: 0 }, T5)
  s = addTokens(s, T5 - 45_000, 900_700, 500)
  expect(s.seeds).toEqual([T5 - 45_000])
  // The old code moved the seed point but not its seed mark: 900,500 a minute.
  expect(Math.max(...tokenRate(s.tokens, T5 + 40_000, s.seeds).map(point => point[1]))).toBe(500)
  // A compaction from a blip moves back with its fall.
  let c: Series = addCompact({ agents: [[T5 - 5 * M, 2]], tokens: [[T5 - 10 * M, 100], [T5 - 5 * M, 200]], compacts: [] }, T5 + 3_600_000)
  c = addTokens(c, T5, 300, 300)
  expect(c.compacts).toEqual([T5])
  expect(c.tokens.some(point => point[0] === T5 && point[1] === 0)).toBe(true)
  expect(c.tokens.every(point => point[0] <= T5)).toBe(true)
  // State 2, the limit: a step back of exactly one QUANT_MS re-times nothing (the clamp of holds).
  const seeded = seedSeries({ agents: [], tokens: [[T5 - 5 * M, 200]], compacts: [] }, { tokens: 9000, since: 0 }, T5)
  expect(retimeSeries(seeded, T5 - QUANT_MS)).toBe(seeded)
  const clamped = addTokens(seeded, T5 - QUANT_MS, 9500, 500)
  expect(clamped.seeds).toEqual([T5])
  expect(Math.max(...tokenRate(clamped.tokens, T5 + 40_000, clamped.seeds).map(point => point[1]))).toBe(500)
  // A kept point already at the new time: the seed goes 1 ms after it, so it stays the first point at its time.
  const crowd: Series = { agents: [], tokens: [[T5 - 5 * M, 100], [T5 - 45_000, 200], [T5, 900_200]], compacts: [], seeds: [T5] }
  const moved = addTokens(crowd, T5 - 45_000, 900_700, 500)
  expect(moved.seeds).toEqual([T5 - 45_000 + 1])
  expect(Math.max(...tokenRate(moved.tokens, T5 + 40_000, moved.seeds).map(point => point[1]))).toBe(600)
  // State 3, the population left alone: compactions, seeds and points at or before the new time keep their times.
  const old: Series = { agents: [[T5 - 9 * M, 1], [T5 + 3_600_000, 4]], tokens: [[T5 - 9 * M, 100], [T5 - 8 * M, 200], [T5 + 3_600_000, 300]], compacts: [T5 - 8 * M], seeds: [T5 - 9 * M] }
  const back = retimeSeries(old, T5)
  expect(back.compacts).toEqual([T5 - 8 * M])
  expect(back.seeds).toEqual([T5 - 9 * M])
  expect(back.tokens).toEqual([[T5 - 9 * M, 100], [T5 - 8 * M, 200], [T5, 300]])
  expect(back.agents).toEqual([[T5 - 9 * M, 1], [T5, 4]])
  // addAgents re-times the whole series too.
  expect(addAgents(old, T5, 2).tokens.every(point => point[0] <= T5)).toBe(true)
})

test('readKeptSeries keeps one compaction a time and bounds seeds by now plus one step, like points', () => {
  const now = T5
  const read = readKeptSeries({ agents: [], tokens: [[now - MIN, 5]], compacts: [now - MIN, now - MIN], seeds: [now + 10 * 3_600_000] }, now)
  expect(read.compacts).toEqual([now - MIN])
  // A seed 10 h ahead is a clock that ran ahead: the old code kept it.
  expect(read.seeds).toBeUndefined()
  // The limit: exactly now plus one step is kept, one ms more is not.
  expect(readKeptSeries({ agents: [], tokens: [[now - MIN, 5]], compacts: [], seeds: [now + QUANT_MS] }, now).seeds).toEqual([now + QUANT_MS])
  expect(readKeptSeries({ agents: [], tokens: [[now - MIN, 5]], compacts: [], seeds: [now + QUANT_MS + 1] }, now).seeds).toBeUndefined()
  // The rule kept from before: a seed older than the first token point goes.
  expect(readKeptSeries({ agents: [], tokens: [[now - MIN, 5]], compacts: [], seeds: [now - 2 * MIN] }, now).seeds).toBeUndefined()
})

test('onePerStep draws the first point and the last point of each QUANT_MS step', () => {
  expect(onePerStep([[0, 1], [1000, 2], [2000, 3], [31_000, 4], [32_000, 5]])).toEqual([[0, 1], [2000, 3], [32_000, 5]])
  // A series of one point a step is drawn as it is held.
  const live: Point[] = [[0, 0], [QUANT_MS, 2], [2 * QUANT_MS, 3]]
  expect(onePerStep(live)).toEqual(live)
  expect(onePerStep([])).toEqual([])
  // 2000 points 1 s apart become 68 or fewer (one per step and the first).
  const many: Point[] = Array.from({ length: 2000 }, (_, i): Point => [i * 1000, i])
  expect(onePerStep(many).length).toBeLessThanOrEqual(Math.ceil(2_000_000 / QUANT_MS) + 2)
})
