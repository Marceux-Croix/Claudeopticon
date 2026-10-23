/** The card stage: the Stage UI palette, the card width, the blink classes and the SVG frame every card sits in. */

/**
 * The desktop look, to the Stage UI style guide (v1.10), with two deliberate
 * exceptions: the cards follow the system theme (the stage palette when dark, the guide's
 * light page tokens when light, LIGHT_CSS; STG-1 keeps the stage black in every theme), and each
 * live agent has a color that its todo items blink (AGENT_COLORS; COL-8 names no category by
 * color). Violet is progress and live (COL-1); failed is orange (COL-7). Motion is CSS, so reduced
 * motion stops it (MOT-2). A card's markup holds nothing that changes with the clock alone: a
 * redraw that changes no data sends the same markup, so the pane does not reload the image.
 */

import { esc } from './card-text'
import type { Card } from './card-types'

// Stage UI tokens: section 3.3 (fixed) and 3.4 (stage palette).
export const ACCENT = '#8B5CF6'
export const PROGRESS_END = '#C084FC'
export const INDICATOR = '#7C3AED'
export const SUGGESTED = '#10303B'
export const DANGER = '#FB923C'
export const STAGE_DANGER = '#FF7A33'
export const GREEN = '#34D399'
export const STAGE_BG = '#07080F'
export const CARD = '#171A26'
export const ACTOR = '#1E2233'
export const STAGE_GRAY = '#9AA0B4'

export const LABEL = 'rgba(255,255,255,.88)'
export const SUB = 'rgba(255,255,255,.62)'
export const FAINT = 'rgba(255,255,255,.38)'
export const TRACK = 'rgba(255,255,255,.22)'
export const RULE = 'rgba(255,255,255,.08)'

export const PAD = 16
export let W = 384
export let INNER = W - PAD * 2
/** The pane's width in CSS pixels: the board's ticket columns grow with it. Equal to `W` since the cards lost their 960 px cap (). */
export let PANE = W

/** The cards' width in CSS pixels, set once per draw from the pane's width: at least 300, with no upper cap. */
export function setWidth(px: number): void {
  W = Math.round(Math.max(300, px))
  PANE = W
  INNER = W - PAD * 2
}

/**
 * The light theme: each dark-palette color as drawn, and its Stage UI light page token (section
 * 3.2). A CSS rule beats a presentation attribute, so one block per card swaps them all when the
 * system is light; the desktop app on its default "system" theme follows the same setting. Agent
 * colors and the violet progress stay as they are.
 */
const LIGHT: readonly (readonly [string, string, string])[] = [
  ['fill', STAGE_BG, '#FFFFFF'],
  ['stroke', STAGE_BG, '#FFFFFF'],
  ['fill', 'rgba(255,255,255,.88)', '#10131C'],
  ['fill', 'rgba(255,255,255,.62)', '#5A6072'],
  ['fill', 'rgba(255,255,255,.38)', 'rgba(16,19,28,.45)'],
  ['stroke', 'rgba(255,255,255,.38)', 'rgba(16,19,28,.45)'],
  ['fill', 'rgba(255,255,255,.22)', 'rgba(16,19,28,.12)'],
  ['stroke', 'rgba(255,255,255,.22)', 'rgba(16,19,28,.12)'],
  ['stroke', 'rgba(255,255,255,.08)', 'rgba(16,19,28,.08)'],
  ['fill', 'rgba(255,255,255,.1)', 'rgba(16,19,28,.06)'],
  ['stroke', 'rgba(255,255,255,.6)', 'rgba(16,19,28,.35)'],
  ['fill', '#171A26', '#F1F3F8'],
  ['fill', '#1E2233', '#E1E4EE'],
  ['fill', '#10303B', '#DDF6FB'],
  ['fill', '#9AA0B4', '#6B7186'],
  ['stroke', '#FFFFFF', '#10131C'],
  ['stroke', '#9AA0B4', '#6B7186'],
  ['fill', '#FB923C', '#B83C0B'],
  ['fill', 'rgba(251,146,60,.16)', '#FFEDE3'],
  ['fill', '#34D399', '#047857'],
  ['fill', '#22D3EE', '#0E7490'],
]

export const LIGHT_CSS = `@media (prefers-color-scheme:light){${LIGHT.map(([prop, dark, light]) => `[${prop}="${dark}"]{${prop}:${light}}`).join('')}rect[fill="${STAGE_BG}"]{stroke:rgba(16,19,28,.12);stroke-width:2}}`
const BLINK_S = 1.2

/**
 * The blink animations one card uses: a class per set of colors, which blinks each color in turn,
 * 1.2 s per color. Reduced motion holds the first color solid.
 */
export class Blinks {
  private readonly rules = new Map<string, string>()

  cls(colors: readonly string[]): string {
    const id = colors.join(',')
    const known = this.rules.get(id)
    if (known !== undefined) {
      return known.split('{')[0]?.slice(1) ?? ''
    }
    const name = `k${this.rules.size}`
    const n = colors.length
    const frames = colors
      .map((color, k) => `${((k / n) * 100).toFixed(2)}%{fill:${color};opacity:1}${(((k + 0.5) / n) * 100).toFixed(2)}%{fill:${color};opacity:.25}`)
      .join('')
    this.rules.set(id, `.${name}{animation:${name} ${(BLINK_S * n).toFixed(1)}s steps(1,end) infinite}@keyframes ${name}{${frames}}`)

    return name
  }

  css(): string {
    const names = [...this.rules.values()].map(rule => `.${rule.split('{')[0]?.slice(1)}`)

    return [...this.rules.values()].join('\n') + (names.length === 0 ? '' : `\n@media (prefers-reduced-motion:reduce){${names.join(',')}{animation:none}}`)
  }
}


export function stage(height: number, body: string, alt: string, css = ''): Card {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(alt)}">
<defs><linearGradient id="progress" x1="0" x2="1"><stop offset="0.7" stop-color="${ACCENT}"/><stop offset="1" stop-color="${PROGRESS_END}"/></linearGradient></defs>
<style>
text{font-family:"Instrument Sans","Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.mono{font-family:"Fragment Mono",ui-monospace,Menlo,monospace}
.blink{animation:blink 1.2s steps(1,end) infinite}
@keyframes blink{50%{opacity:.25}}
.pulse{animation:pulse 1.2s cubic-bezier(0,0,.2,1) infinite;transform-box:fill-box;transform-origin:center}
@keyframes pulse{0%{opacity:.6;transform:scale(1)}100%{opacity:0;transform:scale(2.4)}}
@media (prefers-reduced-motion:reduce){.blink,.pulse{animation:none}.pulse{opacity:0}}
${LIGHT_CSS}
${css}
</style>
<rect width="${W}" height="${height}" rx="12" fill="${STAGE_BG}"/>
${body}</svg>`

  return { source, width: W, height, alt }
}
