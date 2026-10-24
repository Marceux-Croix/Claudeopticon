/**
 * Random top-card states, from a fixed seed: the fuzz, kept call for call
 * so its names hold (r24 is the 25th random state, tight7 the 8th tight one). The random states have
 * a live-agent step line, a token climb with compactions (a late one in about 30 percent), and the
 * tight states put all three end dots within a few px at the right edge, the crossing case.
 */

import type { View } from '../hooks/card-types'
import { stepAxes, stepAxis, WINDOW_MS } from '../hooks/series'
import type { Point, Series } from '../hooks/series'
import { heroView, NOW } from './sample'

const MIN = 60_000

/** A linear congruential source from `seed`. */
function source(seed: number): () => number {
  let state = seed

  return () => {
    state = (state * 1103515245 + 12345) % 2147483648

    return state / 2147483648
  }
}

function randomView(rnd: () => number): View {
  const now = NOW + Math.floor(rnd() * 600_000)
  const agents: Point[] = []
  let a = Math.floor(rnd() * 5)
  for (let t = now - WINDOW_MS - MIN; t < now; t += Math.floor(rnd() * 6 * MIN) + 10_000) {
    a = Math.max(0, a + Math.floor(rnd() * 5) - 2)
    agents.push([t, a])
  }
  const tokens: Point[] = []
  const compacts: number[] = []
  let v = Math.floor(rnd() * 5_000_000)
  const scale = [20_000, 200_000, 2_000_000][Math.floor(rnd() * 3)]!
  const late = rnd() < 0.3 ? now - Math.floor(rnd() * 2 * MIN) : undefined
  for (let t = now - WINDOW_MS - MIN; t < now; t += Math.floor(rnd() * 90_000) + 5_000) {
    if ((late !== undefined && t >= late && !compacts.includes(late) && compacts.every(c => c < late)) || rnd() < 0.01) {
      const at = late !== undefined && t >= late && compacts.every(c => c < late) ? late : t
      compacts.push(at)
      tokens.push([at, 0])
      v = 0
      continue
    }
    if (rnd() < 0.8) {
      v += Math.floor(rnd() * scale)
      tokens.push([t, v])
    }
  }
  const series: Series = { agents, tokens, compacts }
  const live = agents[agents.length - 1]?.[1] ?? 0

  return { ...heroView, now, series, axes: stepAxes(undefined, series, now), usage: { tokens: 900_000_000 + v, atCompact: 900_000_000, since: 0 }, live }
}

const niceTop = (tokens: Point[]) => stepAxes(undefined, { agents: [], tokens, compacts: [] }, NOW).tokens.max

function tightView(rnd: () => number): View {
  const now = NOW
  const top = 4 * 2 ** Math.floor(rnd() * 3)
  const frac = 0.15 + rnd() * 0.7
  const agentsAtEnd = Math.round(frac * top)
  const tokMax = 3_000_000
  const tokEnd = (agentsAtEnd / top) * tokMax * (0.97 + rnd() * 0.06)
  const tokens: Point[] = []
  // A climb that crosses the agent line near the right edge.
  for (let i = 0; i <= 60; i += 1) {
    tokens.push([now - WINDOW_MS + i * 30_000, Math.round(tokEnd * (0.5 + (i / 60) * 0.5))])
  }
  // The rate near the same height: rises in the last minute that sum to about tokEnd.
  const r = tokEnd * (0.9 + rnd() * 0.2)
  tokens.push([now - 40_000, tokens[tokens.length - 1]![1] + r / 2], [now - 10_000, tokens[tokens.length - 1]![1] + r])
  const agents: Point[] = [[now - WINDOW_MS, Math.round(top * rnd())], [now - Math.floor(rnd() * 3 * MIN), agentsAtEnd]]
  const series: Series = { agents, tokens, compacts: rnd() < 0.5 ? [now - 50_000] : [] }

  return { ...heroView, now, series, axes: { agents: { max: top }, tokens: { max: niceTop(tokens) }, rate: stepAxis(undefined, 'tokens', r) }, usage: { tokens: 9e8, atCompact: 9e8 - tokEnd, since: 0 }, live: agentsAtEnd }
}

/** `random` random states and `tight` tight ones, named r0... and tight0..., from `seed` (the 12345 by default). */
export function fuzzStates(random = 300, tight = 40, seed = 12345): [string, View][] {
  const rnd = source(seed)
  const out: [string, View][] = []
  for (let i = 0; i < random; i += 1) {
    out.push([`r${i}`, randomView(rnd)])
  }
  for (let i = 0; i < tight; i += 1) {
    out.push([`tight${i}`, tightView(rnd)])
  }

  return out
}
