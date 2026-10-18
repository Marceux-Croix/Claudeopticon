/**
 * Renders the top card in each sample state, and in fuzz states (scripts/hero-fuzz: r24 and tight7,
 * the verifier's cases, and 20 more: r0 to r10 and tight0 to tight9 but tight7), at the widths the pane allows, dark and light, as SVG
 * files in the folder given (default .claude_work/hero), each in a square frame, for a check by eye: convert them with
 * `qlmanage -t -s 1440 -o <dir> <dir>/*.svg` on macOS and look at the PNGs.
 */
process.env.TZ = 'UTC'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setWidth } from '../hooks/card-stage.ts'
import { heroSvg } from '../hooks/hero-card.ts'
import { fuzzStates } from './hero-fuzz.ts'
import { heroStates } from './sample.ts'

const WIDTHS = [300, 384, 520, 720, 960]
const out = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../.claude_work/hero'))
mkdirSync(out, { recursive: true })
const FUZZ = new Set(['r24', 'tight7', ...Array.from({ length: 11 }, (_, i) => `r${i}`), ...Array.from({ length: 10 }, (_, i) => `tight${i}`)])
for (const [name, view] of [...Object.entries(heroStates()), ...fuzzStates().filter(([one]) => FUZZ.has(one))]) {
  for (const width of WIDTHS) {
    setWidth(width)
    const dark = heroSvg(view).source
    // The light theme is the card's own light rules, applied whatever the system theme is.
    const light = dark.replaceAll('@media (prefers-color-scheme:light){', '@media all{')
    for (const [theme, source] of [['dark', dark], ['light', light]] as const) {
      const file = resolve(out, `${name}-${width}-${theme}.svg`)
      // In a square frame, card at the top: Quick Look crops a wide image to a square thumbnail.
      writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}">\n${source}\n</svg>`)
      console.log(file)
    }
  }
}
