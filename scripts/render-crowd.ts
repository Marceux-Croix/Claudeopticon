/**
 * Renders the top card, a ticket card and a list card with 12 owners, and the top card with 1e12
 * tokens, at 300, 384, 520 and 960 px, dark and light, as SVG files in the folder given (default
 * .claude_work/crowd), each in a square frame, for a check by eye. Convert them on macOS with
 * `qlmanage -t -s 1440 -o <dir> <dir>/*.svg` and look at the PNGs.
 */
process.env.TZ = 'UTC'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setWidth } from '../hooks/card-stage.ts'
import type { FileView, ItemView } from '../hooks/card-types.ts'
import { heroSvg } from '../hooks/hero-card.ts'
import { QUANT_MS, stepAxes } from '../hooks/series.ts'
import type { Point, Series } from '../hooks/series.ts'
import { fileCards, ticketSvg } from '../hooks/todo-cards.ts'
import { buildView } from '../hooks/view-model.ts'
import type { AgentRow } from '../types'

const WIDTHS = [300, 384, 520, 960]
const OWNERS = 12
const NOW = 4000 * QUANT_MS
const MIN = 60_000
const out = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../.claude_work/crowd'))
mkdirSync(out, { recursive: true })

const rows: AgentRow[] = Array.from({ length: OWNERS }, (_, i) => ({ id: `a${i}`, description: `Agent number ${i} works on the parser`, type: 'engineer', status: 'running', startedAt: NOW - 20 * MIN + i * MIN, toolCalls: 3 * i, brief: '' }))
const item: ItemView = { text: 'Pay the vendor invoice, file the receipt in the books and tell the finance team', status: 'in_progress', owners: Array.from({ length: OWNERS }, (_, i) => i), key: '#t1' }
const file: FileView = { name: 'OPEN.md', id: 'OPEN.md', done: 0, active: 1, total: 1, owners: item.owners, items: [item], mtimeMs: 1 }

/** A token trace that climbs to `top` over 25 minutes, with live agents in step. */
function heroOf(top: number) {
  const tokens: Point[] = Array.from({ length: 26 }, (_, i): Point => [NOW - (25 - i) * MIN, (top * i) / 25])
  const agents: Point[] = Array.from({ length: 13 }, (_, i): Point => [NOW - (25 - 2 * i) * MIN, i])
  const series: Series = { agents, tokens, compacts: [] }
  const base = buildView([], rows, NOW)

  return { ...base, series, axes: stepAxes(undefined, series, NOW), usage: { tokens: top, since: 0 } }
}

const cards: [string, (width: number) => string][] = [
  ['hero-12-owners', () => heroSvg(heroOf(2_000_000)).source],
  ['hero-1e12', () => heroSvg(heroOf(1e12)).source],
  ['ticket-12-owners', width => ticketSvg(item, buildView([], rows, NOW), width, { id: '#T0001', isSent: false }).source],
  ['list-12-owners', () => fileCards(file, buildView([], rows, NOW), 12)[0]!.source],
]
for (const [name, draw] of cards) {
  for (const width of WIDTHS) {
    setWidth(width)
    const dark = draw(width)
    const light = dark.replaceAll('@media (prefers-color-scheme:light){', '@media all{')
    for (const [theme, source] of [['dark', dark], ['light', light]] as const) {
      const path = resolve(out, `${name}-${width}-${theme}.svg`)
      writeFileSync(path, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}">\n${source}\n</svg>`)
      console.log(path)
    }
  }
}
