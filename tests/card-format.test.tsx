import { expect, test } from 'claude-code/testing'

import { tokens } from '../hooks/card-format'
import type { View } from '../hooks/card-types'
import { heroSvg } from '../hooks/hero-card'
import { QUANT_MS } from '../hooks/series'
import type { Axes, Series } from '../hooks/series'
import { buildView } from '../hooks/view-model'
import type { AgentRow } from '../types'

// ---------------------------------------------------------------- 

test('tokens picks the unit after rounding, and the axis labels keep three decimals', () => {
  expect(tokens(999_950)).toBe('1.00M')
  expect(tokens(999_999)).toBe('1.00M')
  expect(tokens(999_949)).toBe('999.9k')
  expect(tokens(1_000_000)).toBe('1.00M')
  expect(tokens(950)).toBe('950')
  expect(tokens(84_321)).toBe('84.3k')
  expect(tokens(17_380_000)).toBe('17.38M')
  const view = heroView({ axes: { agents: { max: 4 }, tokens: { max: 4_500_000 } } })
  const labels = [...heroSvg(view).source.matchAll(/font-size="11\.5">([0-9.]+[Mk]?)<\/text>/g)].map(match => match[1])
  expect(labels).toContain('1.125M')
  expect(labels).toContain('3.375M')
  expect(labels).not.toContain('1.13M')
})

// ---------------------------------------------------------------- hero helpers

const NOW = 100 * QUANT_MS

type HeroOpts = { agents?: [number, number][]; tokens?: [number, number][]; axes?: Axes; usage?: number; rows?: AgentRow[]; compacts?: number[] }

function heroView(opts: HeroOpts = {}): View {
  const series: Series = { agents: opts.agents ?? [], tokens: opts.tokens ?? [], compacts: opts.compacts ?? [] }
  const base = buildView([], opts.rows ?? [], NOW)

  return { ...base, series, axes: opts.axes ?? { agents: { max: 4 }, tokens: { max: 150_000 } }, usage: opts.usage === undefined ? undefined : { tokens: opts.usage, since: 0 } }
}

test('tokens has a B unit from a billion, and the axis labels too', () => {
  expect(tokens(1_000_000_000)).toBe('1.00B')
  expect(tokens(1_234_000_000)).toBe('1.23B')
  expect(tokens(1e12)).toBe('1000.00B')
  // The unit is chosen after rounding, as for M: 999,995,000 reads 1.00B, not 1000.00M.
  expect(tokens(999_995_000)).toBe('1.00B')
  expect(tokens(999_994_999)).toBe('999.99M')
  // Under a billion nothing changes.
  expect(tokens(623_590_000)).toBe('623.59M')
  const view = heroView({ axes: { agents: { max: 4 }, tokens: { max: 6_000_000_000 } } })
  const labels = [...heroSvg(view).source.matchAll(/font-size="11\.5">([0-9.]+[BMk]?)<\/text>/g)].map(match => match[1])
  expect(labels).toContain('6B')
  expect(labels).toContain('1.5B')
  expect(labels.some(label => /^\d{4,}M$/.test(label ?? ''))).toBe(false)
})

test('tokens() shows 0 for a value that is not a finite number', () => {
  expect(tokens(Infinity)).toBe('0')
  expect(tokens(-Infinity)).toBe('0')
  expect(tokens(NaN)).toBe('0')
  expect(tokens(1_500)).toBe('1.5k')
})

test('tokens() rounds before it chooses the unit: 999.6 is 1.0k, never "1000"', () => {
  // The reported state: the old code printed "1000".
  expect(tokens(999.6)).toBe('1.0k')
  // The limit: 999.5 rounds up to 1000, so it is 1.0k too; 999.49 stays 999.
  expect(tokens(999.5)).toBe('1.0k')
  expect(tokens(999.49)).toBe('999')
  // Whole counts under 1000 are as before.
  expect(tokens(950)).toBe('950')
  expect(tokens(0)).toBe('0')
})
