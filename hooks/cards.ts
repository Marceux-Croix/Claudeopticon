/**
 * The desktop look, to the Stage UI style guide (v1.10), with two deliberate
 * exceptions: the cards follow the system theme (the stage palette when dark, the guide's
 * light page tokens when light, LIGHT_CSS; STG-1 keeps the stage black in every theme), and each
 * live agent has a color that its todo items blink (AGENT_COLORS; COL-8 names no category by
 * color). Violet is progress and live (COL-1); failed is orange (COL-7). Motion is CSS, so reduced
 * motion stops it (MOT-2). A card's markup holds nothing that changes with the clock alone: a
 * redraw that changes no data sends the same markup, so the pane does not reload the image.
 */

export type ItemStatus = 'pending' | 'in_progress' | 'completed'

export type ItemView = {
  text: string
  status: ItemStatus
  owners: number[]
  /** The item's stable key: its ID (`#t12`) when it has one, else its normalized text. */
  key: string
  /** Shown in progress only because a live agent works on it: its box is still `- [ ]`. */
  isHeld?: true
}

export type FileView = {
  name: string
  done: number
  active: number
  total: number
  owners: number[]
  items: ItemView[]
  mtimeMs: number
  isArchived?: boolean
  /** Category headings inside the card: each names the index of its first item. */
  groups?: { name: string; from: number; count: number }[]
}

export type AgentView = {
  index: number
  description: string
  type: string
  model?: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed' | 'ended'
  isEnded: boolean
  startedAt: number
  endedAt?: number
  toolCalls: number
  /** The tokens of every model request the agent made, every kind summed. */
  tokens?: number
  doing?: string
  /** The open todo items the agent works on, by text. */
  links: string[]
  progress?: { done: number; total: number; step?: string }
}

export type View = {
  /** Every todo file, those with open items first; each carries all its items: linked, in progress, open, done. */
  files: FileView[]
  agents: AgentView[]
  /** Counts over the files at the top of `.claude_todo/`; the archive is not in them. */
  done: number
  active: number
  total: number
  /** Done items in the completed ledger: checked items at the top level and every done item in the archive. */
  completed: number
  live: number
  now: number
  /** The session's token burn, when the mod has counted any. */
  usage?: Usage
}

/**
 * Tokens the session has used, main conversation and subagents, every kind (input, output, cache
 * read and cache write) summed from each finished turn; what the total stood at when the
 * conversation last compacted; and since when the mod has counted.
 */
export type Usage = { tokens: number; atCompact?: number; since: number }

/** "950", "84.3k", "1.23M", "17.38M": a token count, to 2 decimals in millions and 1 in thousands. */
export function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}

// Stage UI tokens: section 3.3 (fixed) and 3.4 (stage palette).
export const ACCENT = '#8B5CF6'
export const PROGRESS_END = '#C084FC'
export const INDICATOR = '#7C3AED'
export const PRIMARY = '#22D3EE'
export const SUGGESTED = '#10303B'
export const DANGER = '#FB923C'
export const STAGE_DANGER = '#FF7A33'
export const GREEN = '#34D399'
const STAGE_BG = '#07080F'
const CARD = '#171A26'
const ACTOR = '#1E2233'
const STAGE_GRAY = '#9AA0B4'

const LABEL = 'rgba(255,255,255,.88)'
const SUB = 'rgba(255,255,255,.62)'
const FAINT = 'rgba(255,255,255,.38)'
const TRACK = 'rgba(255,255,255,.22)'
const RULE = 'rgba(255,255,255,.08)'

const PAD = 16
let W = 384
let INNER = W - PAD * 2

/** The cards' width in CSS pixels, set once per draw from the pane's width. */
export function setWidth(px: number): void {
  W = Math.round(Math.min(960, Math.max(300, px)))
  INNER = W - PAD * 2
}

export function agentLabel(index: number): string {
  return `A${index + 1}`
}

/**
 * Agent colors, a deliberate exception to Stage UI COL-8: each live agent
 * blinks a color, and so does each todo item it works on. Six colors of a brand-neutral categorical
 * palette, at their dark steps, in fixed order, checked for color-vision deficiency; never cycled, so an
 * agent past the sixth is gray. The A1, A2 labels stay, so color is never the only cue (COL-9).
 */
export const AGENT_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9']

export function agentColor(index: number): string {
  return AGENT_COLORS[index] ?? STAGE_GRAY_FALLBACK
}

const STAGE_GRAY_FALLBACK = '#9AA0B4'

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
const MAX_LINKS_SHOWN = 3

/**
 * The blink animations one card uses: a class per set of colors, which blinks each color in turn,
 * 1.2 s per color. Reduced motion holds the first color solid.
 */
class Blinks {
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

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)

  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** "1 agent", "3 agents" (TXT-4). */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Ends a single-line text with an ellipsis when it does not fit (TYP-3). */
function fit(text: string, px: number, size: number, weight = 400, isMono = false): string {
  const glyph = size * (isMono ? 0.62 : weight >= 500 ? 0.55 : 0.52)
  const room = Math.max(1, Math.floor(px / glyph))

  return text.length > room ? `${text.slice(0, Math.max(1, room - 1)).trimEnd()}…` : text
}

/** A drawn card: its SVG and its size in CSS pixels, so the pane sizes its frame to it. */
export type Card = { source: string; width: number; height: number; alt: string }


function stage(height: number, body: string, alt: string, css = ''): Card {
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

/** A wall-clock time in the local time zone, `14:32:05`. */
export function clock(ms: number): string {
  const at = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
}

/**
 * The Orchestrator card: one line per tool call summary, newest first, each with its start time in
 * small text on the right; a call still running has a live dot, a finished one a quiet one.
 */
export function orchestratorSvg(entries: readonly { line: string; at: number; isRunning: boolean }[]): Card {
  const h = 22 + entries.length * 22
  const parts = entries.map((entry, k) => {
    const y = 30 + k * 22
    const dot = entry.isRunning
      ? `<circle cx="${PAD + 5}" cy="${y - 4}" r="4" fill="${ACCENT}"/><circle cx="${PAD + 5}" cy="${y - 4}" r="4" fill="${ACCENT}" class="pulse"/>`
      : `<circle cx="${PAD + 5}" cy="${y - 4}" r="3" fill="${FAINT}"/>`

    return `${dot}<text x="${PAD + 18}" y="${y}" fill="${entry.isRunning ? LABEL : SUB}" font-size="13">${esc(fit(entry.line, INNER - 18 - 64, 13))}</text>
<text x="${W - PAD}" y="${y}" text-anchor="end" fill="${FAINT}" font-size="10.5" class="mono">${clock(entry.at)}</text>`
  })

  return stage(h, parts.join('\n'), `Orchestrator: ${entries.map(entry => `${clock(entry.at)} ${entry.line}`).join('; ')}`)
}

/** A background task as the pane draws it: its short name, what kind it is, and how it stands. */
export type TaskView = {
  name: string
  kind: 'shell' | 'monitor' | 'workflow'
  /** `ended`: the helper agent that started it ended, and no word came of how the task ended. */
  status: 'running' | 'completed' | 'failed' | 'killed' | 'ended'
  startedAt: number
  endedAt?: number
}

/** An actor disk: 12 px radius, letter 500; the state dot at its lower right (STG-DRAW-7, CMP-AV-4). */
function actor(cx: number, cy: number, index: number, state: 'working' | 'failed' | 'none', isMatch: boolean, blinks: Blinks): string {
  const color = agentColor(index)
  const ring = isMatch ? `<circle cx="${cx}" cy="${cy}" r="14.5" fill="none" stroke="${color}" stroke-width="1.5"/>` : ''
  const dot =
    state === 'none'
      ? ''
      : state === 'failed'
        ? `<circle cx="${cx + 8.5}" cy="${cy + 8.5}" r="4.5" fill="${STAGE_DANGER}" stroke="${STAGE_BG}" stroke-width="2"/>`
        : `<circle cx="${cx + 8.5}" cy="${cy + 8.5}" r="4.5" fill="${color}" stroke="${STAGE_BG}" stroke-width="2" class="${blinks.cls([color])}"/>`

  return `${ring}<circle cx="${cx}" cy="${cy}" r="12" fill="${ACTOR}" stroke="rgba(255,255,255,.6)" stroke-width="1.2"/>
<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${LABEL}" font-size="${index >= 9 ? 9.5 : 11}" font-weight="500">${agentLabel(index)}</text>${dot}`
}

/** A 4 px progress strip: white 22% track, `--progress` fill (STG-DRAW-5); the working share in white 38%. */
function strip(x: number, y: number, w: number, done: number, active: number, total: number): string {
  const wDone = total === 0 ? 0 : (done / total) * w
  const wActive = total === 0 ? 0 : (active / total) * w

  return `<rect x="${x}" y="${y}" width="${w}" height="4" rx="2" fill="${TRACK}"/>
${wActive > 0 ? `<rect x="${x + wDone}" y="${y}" width="${wActive}" height="4" rx="2" fill="${FAINT}"/>` : ''}
${wDone > 0 ? `<rect x="${x}" y="${y}" width="${Math.max(wDone, 4)}" height="4" rx="2" fill="url(#progress)"/>` : ''}`
}

function badgeWidth(label: string): number {
  return Math.round(label.length * 6.4 + 12)
}

/** A status badge: 22 px high, radius 4, 500 12 px (CMP-BDG-1). */
function badge(right: number, y: number, label: string, kind: 'live' | 'ok' | 'danger' | 'neutral'): string {
  const w = badgeWidth(label)
  const fill = kind === 'live' ? INDICATOR : kind === 'danger' ? 'rgba(251,146,60,.16)' : 'rgba(255,255,255,.1)'
  const ink = kind === 'live' ? '#FFFFFF' : kind === 'danger' ? DANGER : kind === 'ok' ? GREEN : STAGE_GRAY

  return `<rect x="${right - w}" y="${y - 15}" width="${w}" height="22" rx="4" fill="${fill}"/>
<text x="${right - w / 2}" y="${y}" text-anchor="middle" fill="${ink}" font-size="12" font-weight="500">${esc(label)}</text>`
}

// ---------------------------------------------------------------- summary

function ringArc(cx: number, cy: number, r: number, share: number): string {
  const sweep = Math.min(Math.max(share, 0.0001), 0.9999)
  const a1 = (sweep - 0.25) * 2 * Math.PI

  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${sweep > 0.5 ? 1 : 0} 1 ${(cx + r * Math.cos(a1)).toFixed(2)} ${(cy + r * Math.sin(a1)).toFixed(2)}`
}

/** A figure in a gauge's place: the number large, then its title and line, aligned with the rings. */
function stat(cx: number, cy: number, value: string, title: string, detail: string): string {
  const r = 34
  // 32 px, smaller when the number would not fit its third of the card (a bold digit is about 0.6 em).
  const size = Math.min(32, Math.floor((W / 3 - 16) / (value.length * 0.6)))

  return `<text x="${cx}" y="${cy + 11}" text-anchor="middle" fill="${LABEL}" font-size="${size}" font-weight="700" letter-spacing="-0.5">${esc(value)}</text>
<text x="${cx}" y="${cy + r + 24}" text-anchor="middle" fill="${LABEL}" font-size="14" font-weight="500">${esc(title)}</text>
<text x="${cx}" y="${cy + r + 42}" text-anchor="middle" fill="${SUB}" font-size="12">${esc(detail)}</text>`
}

function gauge(cx: number, cy: number, share: number | undefined, value: string, unit: string, title: string, detail: string, stroke = 'url(#progress)', valueSize = 22): string {
  const r = 34
  const arc = share === undefined || share <= 0 ? '' : `<path d="${ringArc(cx, cy, r, share)}" fill="none" stroke="${stroke}" stroke-width="6" stroke-linecap="round"/>`

  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="6"/>${arc}
<text x="${cx}" y="${cy + valueSize * 0.32}" text-anchor="middle" fill="${LABEL}" font-size="${valueSize}" font-weight="700">${esc(value)}<tspan fill="${SUB}" font-size="13" font-weight="500">${esc(unit)}</tspan></text>
<text x="${cx}" y="${cy + r + 24}" text-anchor="middle" fill="${LABEL}" font-size="14" font-weight="500">${esc(title)}</text>
<text x="${cx}" y="${cy + r + 42}" text-anchor="middle" fill="${SUB}" font-size="12">${esc(detail)}</text>`
}

/**
 * The share of the agents' work done: a finished agent counts whole, a running one by the share
 * of its plan it reports done, and one that has not reported counts as nothing yet.
 */
export function agentShare(agents: readonly AgentView[]): number {
  if (agents.length === 0) {
    return 0
  }
  const sum = agents.reduce((total, agent) => {
    if (agent.isEnded) {
      return total + 1
    }
    const progress = agent.progress

    return total + (progress === undefined ? 0 : progress.done / progress.total)
  }, 0)

  return sum / agents.length
}

/** Two gauges: the share of todo items done, and the share of agents finished, with a live dot. */
export function heroSvg(view: View): Card {
  const n = view.agents.length
  const ended = n - view.live
  const at = [W / 6 + 4, W / 2, (W * 5) / 6 - 4]
  const todo =
    view.total === 0
      ? gauge(at[0]!, 62, undefined, '', '', 'Todo', 'No items')
      : gauge(at[0]!, 62, view.done / view.total, String(Math.round((view.done / view.total) * 100)), '%', 'Todo', `${view.done} of ${view.total} done`)
  const agents =
    n === 0
      ? gauge(at[1]!, 62, undefined, '', '', 'Agents', 'None yet')
      : gauge(at[1]!, 62, agentShare(view.agents), String(view.live), ' live', 'Agents', `${ended} of ${plural(n, 'agent')} finished`)
  // Token burn: a number, not a ring.
  const usage = view.usage
  const burn =
    usage === undefined
      ? stat(at[2]!, 62, '', 'Tokens', 'None counted yet')
      : stat(
          at[2]!,
          62,
          tokens(usage.tokens),
          'Tokens',
          usage.atCompact === undefined ? 'No compaction yet' : `${tokens(usage.tokens - usage.atCompact)} since compact`,
        )
  const live =
    view.live > 0
      ? `<circle cx="${W - PAD - 4}" cy="${PAD + 4}" r="4" fill="${ACCENT}" class="pulse"/>
<circle cx="${W - PAD - 4}" cy="${PAD + 4}" r="4" fill="${ACCENT}"/>
<text x="${W - PAD - 14}" y="${PAD + 8}" text-anchor="end" fill="${SUB}" font-size="12">Live</text>`
      : ''

  return stage(166, `${todo}${agents}${burn}${live}`, `Todo ${view.done} of ${view.total} done. ${view.live} of ${plural(n, 'agent')} live.${usage === undefined ? '' : ` ${tokens(usage.tokens)} tokens used${usage.atCompact === undefined ? '' : `, ${tokens(usage.tokens - usage.atCompact)} since compact`}.`}`)
}

// ---------------------------------------------------------------- todo

function itemMark(x: number, y: number, status: ItemStatus, owners: readonly number[], blinks: Blinks): string {
  if (status === 'completed') {
    return `<path d="M ${x - 4} ${y} l 2.8 2.8 l 5.2 -5.6" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (owners.length > 0) {
    const colors = owners.map(agentColor)

    return `<circle cx="${x}" cy="${y}" r="5" fill="${colors[0]}" class="${blinks.cls(colors)}"/>`
  }
  if (status === 'in_progress') {
    return `<circle cx="${x}" cy="${y}" r="4" fill="${STAGE_GRAY}"/>`
  }

  return `<circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="${FAINT}" stroke-width="1.2"/>`
}

const ITEMS_PER_CARD = 40
const LINE_H = 18
const MAX_LINES = 8

/**
 * Breaks a text into lines that fit `px` at `size`, at spaces where it can and inside a long word
 * where it must; past `maxLines` the last line ends with an ellipsis (TYP-3: long free text wraps).
 */
export function wrap(text: string, px: number, size: number, weight = 400, maxLines = MAX_LINES): string[] {
  const room = Math.max(8, Math.floor(px / (size * (weight >= 500 ? 0.55 : 0.52))))
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(one => one !== '')) {
    let rest = word
    while (rest.length > room) {
      if (line !== '') {
        lines.push(line)
        line = ''
      }
      lines.push(rest.slice(0, room))
      rest = rest.slice(room)
    }
    if (line === '') {
      line = rest
    } else if (line.length + 1 + rest.length <= room) {
      line = `${line} ${rest}`
    } else {
      lines.push(line)
      line = rest
    }
  }
  if (line !== '' || lines.length === 0) {
    lines.push(line)
  }
  if (lines.length <= maxLines) {
    return lines
  }
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = `${(kept[maxLines - 1] ?? '').slice(0, Math.max(1, room - 1)).trimEnd()}…`

  return kept
}

/**
 * One todo file as cards: the first carries its name, count and strip; then up to `limit` of its
 * items in the view's order, 40 to a card, so a file of any length stays inside the SVG limit. An
 * item longer than 8 lines stops there with an ellipsis, unless `isTextOpen` shows every item whole.
 */
/**
 * One ticket as a Stage UI card, `width` px wide: a 12 px container on the tonal card fill; a top
 * row with the status mark, an ID chip, a category chip and a status badge; the item's text, up to
 * 4 lines; and the agents on it as colored chips. In progress draws a violet accent bar (progress,
 * COL-1); a ticket an agent works on draws its border and bar in the agent's color instead. When
 * `actions` (a count), a bottom row of its own is kept free for the pane's buttons and their tips.
 */
export function ticketSvg(item: ItemView, view: View, width: number, info: { id?: string; category?: string; isSent: boolean; actions?: number }): Card {
  const w = Math.max(200, Math.round(width))
  const pad = 14
  const blinks = new Blinks()
  const owner = item.owners[0]
  const accent = owner !== undefined ? agentColor(owner) : item.status === 'in_progress' ? ACCENT : undefined
  const parts: string[] = []
  let x = pad
  const top = 22
  // Status mark
  if (item.status === 'completed') {
    parts.push(`<path d="M ${x} ${top - 1} l 2.8 2.8 l 5.2 -5.6" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`)
  } else if (owner !== undefined) {
    const colors = item.owners.map(agentColor)
    parts.push(`<circle cx="${x + 4}" cy="${top - 3}" r="4.5" fill="${colors[0]}" class="${blinks.cls(colors)}"/>`)
  } else if (item.status === 'in_progress') {
    parts.push(`<circle cx="${x + 4}" cy="${top - 3}" r="4" fill="${STAGE_GRAY}"/>`)
  } else {
    parts.push(`<circle cx="${x + 4}" cy="${top - 3}" r="4.5" fill="none" stroke="${FAINT}" stroke-width="1.2"/>`)
  }
  x += 16
  // Status badge, right
  const status = info.isSent && item.status !== 'completed' ? { label: 'Sent', kind: 'neutral' as const } : item.status === 'completed' ? { label: 'Done', kind: 'ok' as const } : item.status === 'in_progress' ? { label: 'In progress', kind: 'live' as const } : { label: 'Open', kind: 'neutral' as const }
  const badgeRight = w - pad
  parts.push(badge(badgeRight, top + 2, status.label, status.kind))
  const room = badgeRight - badgeWidth(status.label) - 8
  // ID chip
  if (info.id !== undefined && x + 40 < room) {
    const cw = Math.round(info.id.length * 7 + 14)
    parts.push(`<rect x="${x}" y="${top - 13}" width="${cw}" height="20" rx="8" fill="rgba(255,255,255,.1)"/>
<text x="${x + cw / 2}" y="${top + 1}" text-anchor="middle" fill="${LABEL}" font-size="11" class="mono">${esc(info.id)}</text>`)
    x += cw + 6
  }
  // Category chip
  if (info.category !== undefined && x + 40 < room) {
    const label = fit(info.category, room - x - 16, 11, 500)
    const cw = Math.round(label.length * 6 + 16)
    parts.push(`<rect x="${x + 0.5}" y="${top - 12.5}" width="${cw}" height="19" rx="9.5" fill="none" stroke="rgba(255,255,255,.22)"/>
<text x="${x + cw / 2}" y="${top + 1}" text-anchor="middle" fill="${SUB}" font-size="11" font-weight="500">${esc(label)}</text>`)
  }
  // Body
  const text = info.id === undefined ? item.text : item.text.replace(info.id, '').replace(/^\s*[:.-]?\s*/, '')
  const lines = wrap(text, w - pad * 2, 13, 400, 4)
  let y = top + 26
  const ink = item.status === 'completed' ? FAINT : LABEL
  const strike = item.status === 'completed' ? ' text-decoration="line-through"' : ''
  parts.push(`<text x="${pad}" y="${y}" fill="${ink}" font-size="13"${strike}>${lines.map((line, k) => `<tspan x="${pad}" dy="${k === 0 ? 0 : 18}">${esc(line)}</tspan>`).join('')}</text>`)
  y += (lines.length - 1) * 18 + 10
  // Agents
  if (item.owners.length > 0) {
    let ax = pad
    for (const o of item.owners) {
      const label = agentLabel(o)
      const cw = Math.round(label.length * 7 + 14)
      parts.push(`<rect x="${ax}" y="${y}" width="${cw}" height="18" rx="9" fill="${agentColor(o)}"/>
<text x="${ax + cw / 2}" y="${y + 13}" text-anchor="middle" fill="#FFFFFF" font-size="10.5" font-weight="700">${label}</text>`)
      ax += cw + 6
    }
    const working = view.agents[owner ?? 0]
    if (working !== undefined) {
      parts.push(`<text x="${ax + 2}" y="${y + 13}" fill="${SUB}" font-size="11">${esc(fit(working.description, w - ax - pad - 2, 11))}</text>`)
    }
    y += 26
  }
  if ((info.actions ?? 0) > 0) {
    y += SEND_ROW_PX
  }
  const h = y + 8
  const frame = `<rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="12" fill="${CARD}" stroke="${owner !== undefined ? agentColor(owner) : RULE}" stroke-width="${owner !== undefined ? 1.5 : 1}"/>`
  const bar = accent === undefined ? '' : `<rect x="0" y="12" width="3" height="${h - 24}" rx="1.5" fill="${accent}"/>`
  const body = item.status === 'completed' ? `<g opacity=".6">${parts.join('\n')}</g>` : parts.join('\n')
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`${status.label}: ${item.text.slice(0, 120)}`)}">
<style>
text{font-family:"Instrument Sans","Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.mono{font-family:"Fragment Mono",ui-monospace,Menlo,monospace}
${LIGHT_CSS}
${blinks.css()}
</style>
${frame}${bar}
${body}</svg>`

  return { source, width: w, height: h, alt: `${status.label}: ${item.text.slice(0, 200)}` }
}

/** The button row's height: a native button, raised one row off the card's bottom edge. */
export const SEND_ROW_PX = 60

/** The pane's card width, for laying tickets out in columns beside it. */
export function cardWidth(): number {
  return W
}

/** How many of the first `limit` items of a file run past 8 lines, for the Show full text button. */
export function longItems(file: FileView, limit: number): number {
  return file.items.slice(0, limit).filter(item => {
    const room = INNER - 24 - item.owners.length * 32

    return wrap(item.text, room, 13, item.owners.length > 0 ? 500 : 400, Number.POSITIVE_INFINITY).length > MAX_LINES
  }).length
}

export function fileCards(file: FileView, view: View, limit: number, isTextOpen = false): Card[] {
  const shown = file.items.slice(0, limit)
  const cards: Card[] = []
  let parts: string[] = []
  let blinks = new Blinks()
  let y = 0
  let count = 0
  let first = 0
  const begin = (isFirst: boolean) => {
    parts = []
    blinks = new Blinks()
    y = 8
    count = 0
    if (isFirst) {
      y = 26
      parts.push(`<text x="${PAD}" y="${y}" fill="${LABEL}" font-size="14" font-weight="500">${esc(fit(file.name, INNER - 70, 14, 500))}</text>
<text x="${W - PAD}" y="${y}" text-anchor="end" fill="${SUB}" font-size="12">${file.done} of ${file.total}</text>`)
      parts.push(strip(PAD, y + 9, INNER, file.done, file.active, file.total))
      y += 22
    }
    y += 18
  }
  const flush = () => {
    const body = file.isArchived === true ? `<g opacity=".55">${parts.join('\n')}</g>` : parts.join('\n')
    const card = stage(y - 6, body, `${file.name}: ${file.done} of ${file.total} done${first > 0 ? `, items ${first + 1} on` : ''}`, blinks.css())
    cards.push(card)
  }
  begin(true)
  shown.forEach((item, index) => {
    if (count === ITEMS_PER_CARD) {
      flush()
      first = index
      begin(false)
    }
    const group = file.groups?.find(one => one.from === index)
    if (group !== undefined) {
      parts.push(`<text x="${PAD}" y="${y + 2}" fill="${SUB}" font-size="12" font-weight="500">${esc(fit(group.name, INNER - 40, 12, 500))}</text>
<text x="${W - PAD}" y="${y + 2}" text-anchor="end" fill="${FAINT}" font-size="11">${group.count}</text>
<line x1="${PAD}" y1="${y + 9}" x2="${W - PAD}" y2="${y + 9}" stroke="${RULE}"/>`)
      y += 30
    }
    const isMatch = item.owners.length > 0
    const weight = isMatch ? 500 : 400
    const room = INNER - 24 - item.owners.length * 32
    const lines = wrap(item.text, room, 13, weight, isTextOpen ? Number.POSITIVE_INFINITY : MAX_LINES)
    const extra = (lines.length - 1) * LINE_H
    if (isMatch) {
      parts.push(`<rect x="${PAD - 8}" y="${y - 17}" width="${INNER + 16}" height="${32 + extra}" rx="8" fill="${SUGGESTED}"/>`)
    }
    parts.push(itemMark(PAD + 6, y - 1, item.status, item.owners, blinks))
    const ink = isMatch || item.status === 'in_progress' ? LABEL : item.status === 'completed' ? FAINT : LABEL
    const strike = item.status === 'completed' ? ' text-decoration="line-through"' : ''
    const tspans = lines.map((line, k) => `<tspan x="${PAD + 22}" dy="${k === 0 ? 0 : LINE_H}">${esc(line)}</tspan>`).join('')
    parts.push(`<text x="${PAD + 22}" y="${y + 3}" fill="${ink}" font-size="13" font-weight="${weight}"${strike}>${tspans}</text>`)
    item.owners.forEach((owner, k) => {
      const agent = view.agents[owner]
      const failed = agent?.status === 'failed' || agent?.status === 'killed'
      parts.push(actor(W - PAD - 6 - k * 32, y - 1, owner, failed ? 'failed' : agent?.isEnded === false ? 'working' : 'none', true, blinks))
    })
    y += 34 + extra
    count += 1
  })
  if (count > 0 || cards.length === 0) {
    flush()
  }

  return cards
}

// ---------------------------------------------------------------- agents

function agentBadge(agent: AgentView): { label: string; kind: 'live' | 'ok' | 'danger' | 'neutral' } {
  if (agent.status === 'completed') {
    return { label: 'Done', kind: 'ok' }
  }
  if (agent.status === 'failed') {
    return { label: 'Failed', kind: 'danger' }
  }
  if (agent.status === 'killed') {
    return { label: 'Stopped', kind: 'danger' }
  }
  if (agent.status === 'running') {
    return { label: 'Running', kind: 'live' }
  }

  return { label: `${agent.status.charAt(0).toUpperCase()}${agent.status.slice(1)}`, kind: 'neutral' }
}

/** A span of wall-clock time the timeline shows: from `start` to `end`, in ms since the epoch. */
/**
 * The agents' timeline, from the first agent's start to now: one strip per agent. The right end
 * reads "Now" and a running strip pulses at its head.
 */
export function timelineSvg(view: View, all: readonly AgentView[]): Card {
  const t0 = Math.min(...all.map(a => a.startedAt))
  const t1 = view.now
  const agents = [...all]
  const n = agents.length
  const parts: string[] = []
  const blinks = new Blinks()
  const plotX = PAD + 34
  const plotW = INNER - 34 - 52
  const span = Math.max(1000, t1 - t0)
  const x = (t: number) => plotX + ((Math.min(Math.max(t, t0), t1) - t0) / span) * plotW
  const top = 26
  const rowH = 30
  const axisY = top + Math.max(n, 1) * rowH - 8
  for (const f of [0, 0.5, 1]) {
    const gx = plotX + f * plotW
    const t = t0 + f * span
    const tick = f === 1 ? 'Now' : `${elapsed(view.now - t)} ago`
    parts.push(`<line x1="${gx}" y1="${top - 16}" x2="${gx}" y2="${axisY}" stroke="${RULE}"/>
<text x="${gx}" y="${axisY + 16}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}" fill="${FAINT}" font-size="11">${tick}</text>`)
  }
  if (n === 0) {
    parts.push(`<text x="${plotX + plotW / 2}" y="${top + 4}" text-anchor="middle" fill="${SUB}" font-size="12">No agents ran in this window</text>`)
  }
  agents.forEach((agent, i) => {
    const y = top + i * rowH
    const end = agent.endedAt ?? view.now
    const x0 = x(agent.startedAt)
    const w = Math.max(6, x(end) - x0)
    const failed = agent.status === 'failed' || agent.status === 'killed'
    parts.push(agent.isEnded ? '<g opacity=".55">' : '<g>')
    parts.push(actor(PAD + 12, y - 2, agent.index, failed ? 'failed' : agent.isEnded ? 'none' : 'working', false, blinks))
    const fill = agent.isEnded ? (failed ? STAGE_DANGER : TRACK) : 'url(#progress)'
    parts.push(`<rect x="${x0}" y="${y - 4}" width="${w}" height="4" rx="2" fill="${fill}"/>`)
    if (agent.status === 'completed' && end <= t1) {
      parts.push(`<path d="M ${x0 + w + 5} ${y - 2} l 2.4 2.4 l 4.6 -5" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`)
    } else if (!agent.isEnded) {
      parts.push(`<circle cx="${x0 + w}" cy="${y - 2}" r="4" fill="${ACCENT}" class="pulse"/>
<circle cx="${x0 + w}" cy="${y - 2}" r="3.5" fill="${ACCENT}"/>`)
    }
    parts.push(`<text x="${W - PAD}" y="${y + 2}" text-anchor="end" fill="${SUB}" font-size="12">${elapsed(end - agent.startedAt)}</text></g>`)
  })

  return stage(axisY + 28, parts.join('\n'), `Timeline of ${plural(n, 'agent')}`, blinks.css())
}

/** One agent: actor, name and status badge; the item it works on; meta; current tool call. */
/** The room left of a live agent's badge that the card keeps free for the pane's Stop button. */
export const STOP_PX = 44
/** The gap between a live agent's Stop button and its badge. */
const STOP_GAP_PX = 8
/**
 * How far an agent card's title row sits below its usual place: the pane places the Stop button
 * in whole text rows, and one row down puts its center 5 px below a badge at the usual place.
 */
const HEAD_DROP_PX = 5

/** How far a live agent's Stop button sits from the card's right padding: past the badge and a gap. */
export function stopInsetPx(agent: AgentView): number {
  return badgeWidth(agentBadge(agent).label) + STOP_GAP_PX
}

export function agentSvg(agent: AgentView, view: View): Card {
  const parts: string[] = []
  // A live agent's title ends short of its Stop button, left of the badge.
  const stop = agent.isEnded ? 0 : STOP_PX
  const failed = agent.status === 'failed' || agent.status === 'killed'
  const { label, kind } = agentBadge(agent)
  const bw = badgeWidth(label)
  const blinks = new Blinks()
  const color = agentColor(agent.index)
  const shownLinks = agent.links.slice(0, MAX_LINKS_SHOWN)
  const moreLinks = agent.links.length - shownLinks.length
  const hasLink = shownLinks.length > 0
  const progress = agent.isEnded ? undefined : agent.progress
  const lines = 2 + shownLinks.length + (moreLinks > 0 ? 1 : 0) + (!agent.isEnded && agent.doing !== undefined ? 1 : 0) + (progress !== undefined ? 1 : 0)
  const h = 20 + HEAD_DROP_PX + lines * 20 + (progress !== undefined ? 8 : 0)
  if (hasLink && !agent.isEnded) {
    parts.push(`<rect x="1" y="1" width="${W - 2}" height="${h - 2}" rx="11" fill="none" stroke="${color}" stroke-opacity=".55"/>`)
  }
  parts.push(actor(PAD + 12, 26 + HEAD_DROP_PX, agent.index, failed ? 'failed' : agent.isEnded ? 'none' : 'working', hasLink && !agent.isEnded, blinks))
  let ty = 31 + HEAD_DROP_PX
  const tx = PAD + 36
  parts.push(`<text x="${tx}" y="${ty}" fill="${agent.isEnded ? SUB : LABEL}" font-size="14" font-weight="500">${esc(fit(agent.description, INNER - 44 - bw - stop, 14, 500))}</text>`)
  parts.push(badge(W - PAD, ty, label, kind))
  ty += 20
  for (const link of shownLinks) {
    parts.push(`<circle cx="${tx + 4}" cy="${ty - 4}" r="4" fill="${color}" class="${blinks.cls([color])}"/>
<text x="${tx + 14}" y="${ty}" fill="${SUB}" font-size="12">Working on <tspan fill="${color}" font-weight="500">${esc(fit(link, INNER - 130, 12, 500))}</tspan></text>`)
    ty += 20
  }
  if (moreLinks > 0) {
    parts.push(`<text x="${tx + 14}" y="${ty}" fill="${SUB}" font-size="12">and ${plural(moreLinks, 'more item')}</text>`)
    ty += 20
  }
  if (progress !== undefined) {
    const percent = Math.round((progress.done / progress.total) * 100)
    const label = `Step ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${progress.step ? `: ${progress.step}` : ''}`
    parts.push(`<text x="${tx}" y="${ty}" fill="${LABEL}" font-size="12" font-weight="500">${esc(fit(label, INNER - 90, 12, 500))}</text>
<text x="${W - PAD}" y="${ty}" text-anchor="end" fill="${SUB}" font-size="12">${percent}%</text>`)
    parts.push(strip(tx, ty + 7, W - PAD - tx, progress.done, 0, progress.total))
    ty += 28
  }
  const ran = elapsed((agent.endedAt ?? view.now) - agent.startedAt)
  const when = agent.endedAt === undefined ? [ran] : [`ran ${ran}`, `ended ${elapsed(view.now - agent.endedAt)} ago`]
  const meta = [agent.type, agent.model, ...when, plural(agent.toolCalls, 'tool call'), agent.tokens ? `${tokens(agent.tokens)} tokens` : undefined]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('\u2002·\u2002')
  parts.push(`<text x="${tx}" y="${ty}" fill="${SUB}" font-size="12">${esc(fit(meta, INNER - 40, 12))}</text>`)
  ty += 20
  if (!agent.isEnded && agent.doing !== undefined) {
    parts.push(`<text x="${tx}" y="${ty}" fill="${SUB}" font-size="12" class="mono">${esc(fit(agent.doing, INNER - 44, 12, 400, true))}</text>`)
  }

  // A finished agent stays in the ledger, grayed out (STG-DRAW-6: a quiet item draws at reduced opacity).
  const body = agent.isEnded ? `<g opacity=".55">${parts.join('\n')}</g>` : parts.join('\n')

  return stage(h, body, `${agentLabel(agent.index)}, ${agent.description}: ${label}`, blinks.css())
}
