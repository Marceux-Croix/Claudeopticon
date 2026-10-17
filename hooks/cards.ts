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
  /** The item's stable key: its ID (`#t12`) when it has one, else its normalized text; qualified by folder outside the primary folder. */
  key: string
  /** The key without the folder: how the line is found in its file. Same as `key` when absent. */
  localKey?: string
  /** The source of the item, which the pane never shows: its folder, its file in that folder, and its path from the repo root. */
  folder?: string
  file?: string
  path?: string
  /** Shown in progress only because a live agent works on it: its box is still `- [ ]`. */
  isHeld?: true
}

export type FileView = {
  /** The file's path inside its folder. */
  name: string
  /** The file's ID in the pane: its name, or its folder and name when another file has that name. */
  id: string
  /** Where its folder sits in the repo (no `.claude_todo`); empty at the root. Shown only to tell same-named files apart. */
  place?: string
  done: number
  active: number
  total: number
  owners: number[]
  items: ItemView[]
  mtimeMs: number
  isArchived?: boolean
  /** True for a todo file with nothing in it, such as one Consolidate emptied: its header row says Empty until Delete empty todos removes it. */
  isEmpty?: boolean
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
  /** Its last turn ended and nothing followed: finished, but never stopped. Not live. */
  isIdle?: boolean
  idleSince?: number
  doing?: string
  /** The open todo items the agent works on, by text. */
  links: string[]
  progress?: { done: number; total: number; step?: string }
}

export type View = {
  /** Every todo file, those with open items first; each carries all its items: linked, in progress, open, done. */
  files: FileView[]
  agents: AgentView[]
  /**
   * The main conversation, when it owns a ticket: drawn as an agent card before A1 (index ORCH),
   * and not one of `agents`, so no count or timeline holds it. Running during a turn, else idle.
   */
  orchestrator?: AgentView
  /** Counts over the files at the top of `.claude_todo/` plus the done tickets of every archive file, so moving a ticket to the archive leaves them as they were. */
  done: number
  active: number
  total: number
  /** Done tickets in the archive files: the number on the Show completed link. */
  archived: number
  live: number
  now: number
  /** The session's token burn, when the mod has counted any. */
  usage?: Usage
  /** What the top card plots, and the axes it plots on (held by the pane across draws). */
  series?: Series
  axes?: Axes
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

/** The owner index of the orchestrator (the main conversation) in `owners`: no agent has it. */
export const ORCH = -1

/**
 * The number of agents before the first kept row: rows past the kept window are dropped from the store,
 * so after a reload the first row is not A1. Labels and colors count from this base, and never shift.
 */
let labelBase = 0
export function setLabelBase(base: number): void {
  labelBase = Math.max(0, Math.floor(base))
}

export function agentLabel(index: number): string {
  return index === ORCH ? 'O' : `A${labelBase + index + 1}`
}

/**
 * The font size that fits a label in its 28 px circle, with at most 17 px of text, so a few pixels stay clear on each side. Widths are
 * Instrument Sans at weight 500, the widest of the fallback fonts: `A` is 0.461 em, a digit 0.664 em.
 */
export function labelFontSize(label: string): number {
  const em = 0.461 + 0.664 * Math.max(1, label.length - 1)

  return Math.min(11, Math.floor((17 / em) * 10) / 10)
}

/**
 * Agent colors, a deliberate exception to Stage UI COL-8: each live agent
 * blinks a color, and so does each todo item it works on. Six colors of a brand-neutral categorical
 * palette, at their dark steps, in fixed order, checked for color-vision deficiency; never cycled, so an
 * agent past the sixth is gray. The A1, A2 labels stay, so color is never the only cue (COL-9).
 */
export const AGENT_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9']

/** The orchestrator's color: a teal, apart from the six agent colors and from the violet progress. */
export const ORCH_COLOR = '#1fa7b8'

export function agentColor(index: number): string {
  return index === ORCH ? ORCH_COLOR : (AGENT_COLORS[labelBase + index] ?? STAGE_GRAY_FALLBACK)
}

/** Whether an owner's tag blinks: an agent's always, the orchestrator's only while it runs a turn. */
function isBlinking(owner: number, view: View): boolean {
  return owner !== ORCH || view.orchestrator?.status === 'running'
}

/**
 * The status dot of a ticket: in the first color that blinks, cycling through every blinking
 * owner; steady in the first owner's color when none blinks (only an idle orchestrator).
 */
function ownerDot(cx: number, cy: number, r: number, owners: readonly number[], view: View, blinks: Blinks): string {
  const live = owners.filter(owner => isBlinking(owner, view)).map(agentColor)
  if (live.length === 0) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${agentColor(owners[0] ?? 0)}"/>`
  }

  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${live[0]}" class="${blinks.cls(live)}"/>`
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

/** The height of one Orchestrator entry: its summary line, and a dim detail line when it has one. */
const ENTRY_PX = 22
const DETAIL_PX = 16

/**
 * The Orchestrator card: one line per tool call summary, newest first, each with its start time in
 * small text on the right; a call still running has a live dot, a finished one a quiet one. An
 * entry with a `detail` (the command, path or pattern of the call) has it on a dim mono line below.
 */
export function orchestratorSvg(entries: readonly { line: string; at: number; isRunning: boolean; detail?: string }[]): Card {
  let y = 8
  const parts = entries.map(entry => {
    y += ENTRY_PX
    const dot = entry.isRunning
      ? `<circle cx="${PAD + 5}" cy="${y - 4}" r="4" fill="${ACCENT}"/><circle cx="${PAD + 5}" cy="${y - 4}" r="4" fill="${ACCENT}" class="pulse"/>`
      : `<circle cx="${PAD + 5}" cy="${y - 4}" r="3" fill="${FAINT}"/>`
    const detail = entry.detail === undefined || entry.detail === '' ? '' : `\n<text x="${PAD + 18}" y="${y + 14}" fill="${FAINT}" font-size="11" class="mono">${esc(fit(entry.detail, INNER - 18, 11, 400, true))}</text>`
    const drawn = `${dot}<text x="${PAD + 18}" y="${y}" fill="${entry.isRunning ? LABEL : SUB}" font-size="13">${esc(fit(entry.line, INNER - 18 - 64, 13))}</text>
<text x="${W - PAD}" y="${y}" text-anchor="end" fill="${FAINT}" font-size="10.5" class="mono">${clock(entry.at)}</text>${detail}`
    y += detail === '' ? 0 : DETAIL_PX

    return drawn
  })

  return stage(y + 14, parts.join('\n'), `Orchestrator: ${entries.map(entry => `${clock(entry.at)} ${entry.line}`).join('; ')}`)
}

/** An actor disk: 12 px radius, letter 500; the state dot at its lower right (STG-DRAW-7, CMP-AV-4). */
function actor(cx: number, cy: number, index: number, state: 'working' | 'steady' | 'failed' | 'none', isMatch: boolean, blinks: Blinks): string {
  const color = agentColor(index)
  const ring = isMatch ? `<circle cx="${cx}" cy="${cy}" r="16.5" fill="none" stroke="${color}" stroke-width="1.5"/>` : ''
  const dot =
    state === 'none'
      ? ''
      : state === 'failed'
        ? `<circle cx="${cx + 10.8}" cy="${cy + 10.8}" r="4.5" fill="${STAGE_DANGER}" stroke="${STAGE_BG}" stroke-width="2"/>`
        : state === 'steady'
          ? `<circle cx="${cx + 10.8}" cy="${cy + 10.8}" r="4.5" fill="${color}" stroke="${STAGE_BG}" stroke-width="2"/>`
          : `<circle cx="${cx + 10.8}" cy="${cy + 10.8}" r="4.5" fill="${color}" stroke="${STAGE_BG}" stroke-width="2" class="${blinks.cls([color])}"/>`

  return `${ring}<circle cx="${cx}" cy="${cy}" r="14" fill="${ACTOR}" stroke="rgba(255,255,255,.6)" stroke-width="1.2"/>
<text x="${cx}" y="${(cy + labelFontSize(agentLabel(index)) * 0.35).toFixed(1)}" text-anchor="middle" fill="${LABEL}" font-size="${labelFontSize(agentLabel(index))}" font-weight="500">${agentLabel(index)}</text>${dot}`
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

// ---------------------------------------------------------------- top card: live graph

/** A sample: [time in ms, value]. */
export type Point = readonly [number, number]

/**
 * What the top card plots, kept per session in the store: live agents (a point at each change of
 * the count), tokens since the last compaction (a point at each usage report), and the times of
 * the compactions. Points older than the window are dropped, except the last one before it.
 */
export type Series = { agents: Point[]; tokens: Point[]; compacts: number[] }

/** The time axis spans the last 30 minutes. */
export const WINDOW_MS = 30 * 60_000
/** Most points kept per series. */
export const SERIES_CAP = 2000
/** X positions snap to this step, so a redraw between steps sends the same markup. */
export const QUANT_MS = 30_000
/** An axis shrinks only after every visible value stayed below half of it for this long. */
export const SHRINK_MS = 5 * 60_000
/** The top card's fixed height, in px. */
export const HERO_H = 300
/** The smallest axis: 4 agents, 150k tokens. */
export const AGENT_AXIS_MIN = 4
export const TOKEN_AXIS_MIN = 150_000
/** Trace colors, dark theme as drawn; HERO_LIGHT_CSS swaps them in the light theme. */
export const AGENT_LINE = '#FACC15'
export const AGENT_LINE_LIGHT = '#CA8A04'
export const TOKEN_LINE = '#A3E635'
export const TOKEN_LINE_LIGHT = '#65A30D'

/**
 * Trace colors by class, not by LIGHT attribute: the orange here is DANGER's dark value, which
 * LIGHT darkens for text, and the traces want their own light step.
 */
const HERO_LIGHT_CSS = `@media (prefers-color-scheme:light){.fa{fill:${AGENT_LINE_LIGHT}}.sa{stroke:${AGENT_LINE_LIGHT}}.ft{fill:${TOKEN_LINE_LIGHT}}.st{stroke:${TOKEN_LINE_LIGHT}}.pt{stop-color:${TOKEN_LINE_LIGHT}}}`

export const emptySeries = (): Series => ({ agents: [], tokens: [], compacts: [] })

/** Drops points older than the window, keeping the last one before it so the line starts at the left edge. */
export function trimPoints(points: readonly Point[], now: number): Point[] {
  const from = now - WINDOW_MS
  const first = points.findIndex(point => point[0] >= from)
  const start = first === -1 ? Math.max(0, points.length - 1) : Math.max(0, first - 1)

  return points.slice(start).slice(-SERIES_CAP)
}

/** Adds a point when the value changed (or the series is empty), then trims. Returns the same array when nothing changed. */
export function addPoint(points: readonly Point[], at: number, value: number): Point[] {
  const last = points[points.length - 1]
  if (last !== undefined && last[1] === value) {
    return trimPoints(points, at)
  }

  return trimPoints([...points, [at, value]], at)
}

/** Records a compaction: the marker, and the token line falling to zero. */
export function addCompact(series: Series, at: number): Series {
  const from = at - WINDOW_MS

  return { ...series, tokens: trimPoints([...series.tokens, [at, 0]], at), compacts: [...series.compacts.filter(one => one >= from), at].slice(-SERIES_CAP) }
}

/** Reads a stored series back, keeping only well-formed points in time order. */
export function readKeptSeries(stored: unknown): Series {
  const out = emptySeries()
  if (typeof stored !== 'object' || stored === null) {
    return out
  }
  const raw = stored as Partial<Record<keyof Series, unknown>>
  const points = (list: unknown): Point[] =>
    Array.isArray(list)
      ? list.filter((one): one is [number, number] => Array.isArray(one) && one.length === 2 && Number.isFinite(one[0]) && Number.isFinite(one[1])).slice(-SERIES_CAP)
      : []
  out.agents = points(raw.agents)
  out.tokens = points(raw.tokens)
  out.compacts = Array.isArray(raw.compacts) ? raw.compacts.filter((one): one is number => Number.isFinite(one)).slice(-SERIES_CAP) : []

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
function windowed(points: readonly Point[], from: number): Point[] {
  const inside = points.filter(point => point[0] >= from)
  const before = points.filter(point => point[0] < from).pop()

  return before === undefined ? inside : [[from, before[1]], ...inside]
}

/** Steps both axes for the series as of `now`. */
export function stepAxes(prev: Axes | undefined, series: Series, now: number): Axes {
  const from = Math.floor(now / QUANT_MS) * QUANT_MS - WINDOW_MS
  const peak = (points: readonly Point[]) => windowed(points, from).reduce((top, point) => Math.max(top, point[1]), 0)

  return { agents: stepAxis(prev?.agents, 'agents', peak(series.agents), now), tokens: stepAxis(prev?.tokens, 'tokens', peak(series.tokens), now) }
}

/** An axis label: integers for agents; for tokens 15M, 3.75M, 450k, with the unit of the top on zero. */
function axisLabel(value: number, top: number): string {
  const trim = (n: number) => String(Math.round(n * 100) / 100)
  if (value === 0) {
    return top >= 1_000_000 ? '0M' : top >= 1000 ? '0k' : '0'
  }

  return value >= 1_000_000 ? `${trim(value / 1_000_000)}M` : value >= 1000 ? `${trim(value / 1000)}k` : trim(value)
}

/** One line for the terminal and the card's alt text: agents, then tokens. */
export function heroText(view: View): string {
  const n = view.agents.length
  const agents = n === 0 ? 'Agents: none yet.' : `Agents: ${view.live} live, ${n - view.live} of ${n} finished.`
  const usage = view.usage
  const burn = usage === undefined ? 'Tokens: none counted yet.' : `Tokens: ${tokens(usage.tokens - (usage.atCompact ?? 0))} since compact, ${tokens(usage.tokens)} total.`

  return `${agents} ${burn}`
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
    if (agent.isEnded || agent.isIdle) {
      return total + 1
    }
    const progress = agent.progress

    return total + (progress === undefined ? 0 : progress.done / progress.total)
  }, 0)

  return sum / agents.length
}

/**
 * The top card, at a fixed height: the token total and the agents finished in a line, a legend, and
 * a two-axis plot of the last 30 minutes. Live agents are a step line on the left axis; tokens since
 * the last compaction are a line with a light fill on the right axis, broken at each compaction,
 * which also gets a dashed line. Time snaps to QUANT_MS and axes come from `view.axes` (held across
 * draws by the pane), so the markup changes only with the data and with each QUANT_MS step.
 */
export function heroSvg(view: View): Card {
  const series = view.series ?? emptySeries()
  const now = Math.floor(view.now / QUANT_MS) * QUANT_MS
  const from = now - WINDOW_MS
  const axes = view.axes ?? stepAxes(undefined, series, view.now)
  const n = view.agents.length
  const usage = view.usage
  const pad = W >= 700 ? 64 : 48
  const x0 = pad
  const x1 = W - pad
  const legend1 = 'Live agents'
  const legend2 = 'Tokens since compact'
  const size = W < 520 ? 12 : 13
  // The key sits in the top row after the totals text (about 6.5 px a character at 13 px; widths are estimates).
  // When it would run into "Live", it moves to a row of its own and the plot starts lower.
  const totalChars = `${usage === undefined ? '0' : tokens(usage.tokens)} tokens total  ·  ${n - view.live} of ${n} agents finished`.length
  const keyWidth = 19 + Math.round(legend1.length * 6.4) + 5 + 19 + Math.round(legend2.length * 6.4)
  const inlineLeft = 24 + Math.round(totalChars * 6.5 * (size / 13)) + 29
  const isInline = inlineLeft + keyWidth <= W - PAD - 14 - 40
  const keyLeft = isInline ? inlineLeft : 24
  const keyY = isInline ? 25.5 : 47
  const top = isInline ? 56 : 62
  const bottom = 250
  const height = bottom - top
  const f = (v: number) => String(Math.round(v * 10) / 10)
  const px = (t: number) => x0 + Math.min(1, Math.max(0, (t - from) / WINDOW_MS)) * (x1 - x0)
  const ya = (v: number) => bottom - Math.min(1, v / axes.agents.max) * height
  const yt = (v: number) => bottom - Math.min(1, v / axes.tokens.max) * height
  const parts: string[] = []

  const total = usage === undefined ? '0' : tokens(usage.tokens)
  parts.push(
    `<text x="24" y="30" font-size="${size}"><tspan fill="${LABEL}" font-weight="600">${esc(total)}</tspan><tspan fill="${SUB}"> tokens total</tspan><tspan fill="${FAINT}">  ·  </tspan><tspan fill="${LABEL}" font-weight="600">${n - view.live} of ${n}</tspan><tspan fill="${SUB}"> ${n === 1 ? 'agent' : 'agents'} finished</tspan></text>`,
  )
  if (view.live > 0) {
    parts.push(`<circle cx="${W - PAD - 4}" cy="${PAD + 4}" r="4" fill="${ACCENT}" class="pulse"/>
<circle cx="${W - PAD - 4}" cy="${PAD + 4}" r="4" fill="${ACCENT}"/>
<text x="${W - PAD - 14}" y="${PAD + 8}" text-anchor="end" fill="${SUB}" font-size="12">Live</text>`)
  }
  const textX1 = keyLeft + 19
  const keyX2 = textX1 + Math.round(legend1.length * 6.4) + 5
  parts.push(
    `<line x1="${keyLeft}" y1="${keyY}" x2="${keyLeft + 14}" y2="${keyY}" stroke="${AGENT_LINE}" class="sa" stroke-width="2" stroke-linecap="round"/><text x="${textX1}" y="${keyY + 4.5}" fill="${SUB}" font-size="12">${legend1}</text>`,
    `<line x1="${keyX2}" y1="${keyY}" x2="${keyX2 + 14}" y2="${keyY}" stroke="${TOKEN_LINE}" class="st" stroke-width="2" stroke-linecap="round"/><text x="${keyX2 + 19}" y="${keyY + 4.5}" fill="${SUB}" font-size="12">${legend2}</text>`,
  )

  // Grid and both axes: 4 intervals; the left axis labels whole numbers only (a top of 6 labels 0, 3, 6).
  for (let i = 0; i <= 4; i += 1) {
    const y = bottom - (i / 4) * height
    const agentTick = (axes.agents.max * i) / 4
    parts.push(`<line x1="${x0}" y1="${f(y)}" x2="${x1}" y2="${f(y)}" stroke="${RULE}"/>`)
    if (Number.isInteger(agentTick)) {
      parts.push(`<text x="${x0 - 10}" y="${f(y + 4)}" text-anchor="end" fill="${LABEL}" font-size="11.5">${agentTick}</text>`)
    }
    parts.push(`<text x="${x1 + 10}" y="${f(y + 4)}" fill="${LABEL}" font-size="11.5">${axisLabel((axes.tokens.max * i) / 4, axes.tokens.max)}</text>`)
  }
  parts.push(
    `<text x="${x0}" y="270" text-anchor="start" fill="${FAINT}" font-size="11.5">30m ago</text>`,
    `<text x="${f(x0 + (x1 - x0) / 3)}" y="270" text-anchor="middle" fill="${FAINT}" font-size="11.5">20m ago</text>`,
    `<text x="${f(x0 + ((x1 - x0) * 2) / 3)}" y="270" text-anchor="middle" fill="${FAINT}" font-size="11.5">10m ago</text>`,
    `<text x="${x1}" y="270" text-anchor="end" fill="${FAINT}" font-size="11.5">Now</text>`,
  )

  const agentPts = windowed(series.agents, from)
  const tokenPts = windowed(series.tokens, from)
  const cs = series.compacts.filter(one => one >= from && one <= now + QUANT_MS).sort((a, b) => a - b)
  const hasData = agentPts.some(point => point[1] > 0) || tokenPts.some(point => point[1] > 0) || cs.length > 0
  if (!hasData) {
    parts.push(`<text x="${f((x0 + x1) / 2)}" y="${f((top + bottom) / 2)}" text-anchor="middle" fill="${FAINT}" font-size="13">No activity yet</text>`)
  } else {
    // Compactions: a dashed line each, labeled when there is room from the last label.
    let labelEnd = -Infinity
    for (const c of cs) {
      const x = px(c)
      parts.push(`<line x1="${f(x)}" y1="${top}" x2="${f(x)}" y2="${bottom}" stroke="${FAINT}" stroke-dasharray="3 4"/>`)
      if (x - labelEnd > 70) {
        const isLeft = x + 5 + 60 > x1
        parts.push(`<text x="${f(isLeft ? x - 5 : x + 5)}" y="${top + 12}" text-anchor="${isLeft ? 'end' : 'start'}" fill="${FAINT}" font-size="11">Compacted</text>`)
        labelEnd = x
      }
    }
    // Tokens: one segment between compactions, each held flat to the compaction or to now.
    const segments: Point[][] = []
    for (const point of tokenPts) {
      const k = cs.filter(c => c <= point[0]).length
      ;(segments[k] ??= []).push(point)
    }
    if (tokenPts.length > 0) {
      parts.push(`<defs><linearGradient id="tk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TOKEN_LINE}" class="pt" stop-opacity=".18"/><stop offset="1" stop-color="${TOKEN_LINE}" class="pt" stop-opacity="0"/></linearGradient></defs>`)
    }
    segments.forEach((segment, k) => {
      if (segment === undefined || segment.length === 0) {
        return
      }
      const end = cs[k] ?? now
      const last = segment[segment.length - 1]!
      const pts = [...segment, ...(last[0] < end ? [[end, last[1]] as Point] : [])]
      const line = pts.map(point => `${f(px(point[0]))},${f(yt(point[1]))}`).join(' ')
      parts.push(
        `<polygon points="${f(px(pts[0]![0]))},${bottom} ${line} ${f(px(pts[pts.length - 1]![0]))},${bottom}" fill="url(#tk)"/>`,
        `<polyline points="${line}" fill="none" stroke="${TOKEN_LINE}" class="st" stroke-width="1.25" stroke-linejoin="round"/>`,
      )
    })
    // Agents: a step line.
    if (agentPts.length > 0) {
      const path = agentPts.map((point, i) => (i === 0 ? `M ${f(px(point[0]))} ${f(ya(point[1]))}` : `H ${f(px(point[0]))} V ${f(ya(point[1]))}`)).join(' ')
      parts.push(`<path d="${path} H ${f(px(now))}" fill="none" stroke="${AGENT_LINE}" class="sa" stroke-width="1.5" stroke-linejoin="round"/>`)
    }
    // End dots and their values; the lower label drops under its dot when the two would touch.
    const ends: { y: number; text: string; color: string; cls: string; tail?: string }[] = []
    const lastAgent = agentPts[agentPts.length - 1]
    const lastToken = tokenPts[tokenPts.length - 1]
    if (lastAgent !== undefined) {
      ends.push({ y: ya(lastAgent[1]), text: `${lastAgent[1]}`, tail: ' live', color: AGENT_LINE, cls: 'fa' })
    }
    if (lastToken !== undefined) {
      ends.push({ y: yt(lastToken[1]), text: tokens(lastToken[1]), color: TOKEN_LINE, cls: 'ft' })
    }
    const below = new Set<number>()
    if (ends.length === 2 && Math.abs(ends[0]!.y - ends[1]!.y) < 16) {
      below.add(ends[0]!.y > ends[1]!.y ? 0 : 1)
    }
    ends.forEach((end, i) => {
      const isBelow = below.has(i) || end.y - 9 < top + 8
      parts.push(
        `<circle cx="${f(x1)}" cy="${f(end.y)}" r="3.5" fill="${end.color}" class="${end.cls}" stroke="${STAGE_BG}" stroke-width="2"/>`,
        `<text x="${f(x1 - 10)}" y="${f(isBelow ? end.y + 19 : end.y - 9)}" text-anchor="end" font-size="12"><tspan fill="${end.color}" class="${end.cls}" font-weight="600">${esc(end.text)}</tspan>${end.tail === undefined ? '' : `<tspan fill="${SUB}">${end.tail}</tspan>`}</text>`,
      )
    })
  }

  return stage(HERO_H, parts.join('\n'), `Last 30 minutes: live agents and tokens since compact. ${heroText(view)}`, HERO_LIGHT_CSS)
}

// ---------------------------------------------------------------- todo

function itemMark(x: number, y: number, status: ItemStatus, owners: readonly number[], view: View, blinks: Blinks): string {
  if (status === 'completed') {
    return `<path d="M ${x - 4} ${y} l 2.8 2.8 l 5.2 -5.6" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (owners.length > 0) {
    return ownerDot(x, y, 5, owners, view, blinks)
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
    parts.push(ownerDot(x + 4, top - 3, 4.5, item.owners, view, blinks))
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
    const working = owner === ORCH ? view.orchestrator : view.agents[owner ?? 0]
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
    const room = INNER - 24 - item.owners.length * 36

    return wrap(item.text, room, 13, item.owners.length > 0 ? 500 : 400, Number.POSITIVE_INFINITY).length > MAX_LINES
  }).length
}

/** The height of an item's row in the list view, so a row that left can keep its place. */
export function listRowPx(item: ItemView, isTextOpen = false): number {
  const room = INNER - 24 - item.owners.length * 36

  return 34 + (wrap(item.text, room, 13, item.owners.length > 0 ? 500 : 400, isTextOpen ? Number.POSITIVE_INFINITY : MAX_LINES).length - 1) * LINE_H
}

/** An empty space `height` px high: a transparent card with no text and no buttons, that holds a ticket's place. */
export function spaceSvg(width: number, height: number): Card {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))

  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="presentation"></svg>`, width: w, height: h, alt: '' }
}

/**
 * `gaps` holds empty space before an item of the shown list, by its index (the shown length: after
 * the last): the list view's way to keep the place of an item that left.
 */
export function fileCards(file: FileView, view: View, limit: number, isTextOpen = false, gaps: ReadonlyMap<number, number> = new Map()): Card[] {
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
    y += gaps.get(index) ?? 0
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
    const room = INNER - 24 - item.owners.length * 36
    const lines = wrap(item.text, room, 13, weight, isTextOpen ? Number.POSITIVE_INFINITY : MAX_LINES)
    const extra = (lines.length - 1) * LINE_H
    if (isMatch) {
      parts.push(`<rect x="${PAD - 8}" y="${y - 17}" width="${INNER + 16}" height="${32 + extra}" rx="8" fill="${SUGGESTED}"/>`)
    }
    parts.push(itemMark(PAD + 6, y - 1, item.status, item.owners, view, blinks))
    const ink = isMatch || item.status === 'in_progress' ? LABEL : item.status === 'completed' ? FAINT : LABEL
    const strike = item.status === 'completed' ? ' text-decoration="line-through"' : ''
    const tspans = lines.map((line, k) => `<tspan x="${PAD + 22}" dy="${k === 0 ? 0 : LINE_H}">${esc(line)}</tspan>`).join('')
    parts.push(`<text x="${PAD + 22}" y="${y + 3}" fill="${ink}" font-size="13" font-weight="${weight}"${strike}>${tspans}</text>`)
    item.owners.forEach((owner, k) => {
      const agent = owner === ORCH ? view.orchestrator : view.agents[owner]
      const failed = agent?.status === 'failed' || agent?.status === 'killed'
      const state = failed ? 'failed' : agent?.isEnded === false ? (isBlinking(owner, view) ? 'working' : 'steady') : 'none'
      parts.push(actor(W - PAD - 8 - k * 36, y - 1, owner, state, true, blinks))
    })
    y += 34 + extra
    count += 1
  })
  y += gaps.get(shown.length) ?? 0
  if (count > 0 || cards.length === 0) {
    flush()
  }

  return cards
}

/** The height of one file row in the board header. */
const HEAD_ROW_PX = 44

/**
 * The ticket board's header: one row per file, each with its name, its own progress strip and its
 * own "done of total". With one file it is the same card as the list view's first card. A file's
 * place (its folder) shows in dim text after the name only when another row has the same name,
 * since the two rows would look the same. Archived files are grayed.
 */
export function boardHead(files: readonly FileView[]): Card {
  const counts = new Map<string, number>()
  for (const file of files) {
    counts.set(file.name, (counts.get(file.name) ?? 0) + 1)
  }
  const rows = files.map((file, i) => {
    const y = 26 + i * HEAD_ROW_PX
    const place = (counts.get(file.name) ?? 0) > 1 && file.place !== undefined && file.place !== '' ? file.place : undefined
    const room = INNER - 70
    const placeText = place === undefined ? undefined : fit(place, Math.floor(room / 2), 12)
    const nameText = fit(file.name, placeText === undefined ? room : room - placeText.length * 12 * 0.52 - 10, 14, 500)
    // The place rides in the name's own text, so the gap is the font's, not a width guess.
    const placeSpan = placeText === undefined ? '' : `<tspan dx="10" fill="${FAINT}" font-size="12" font-weight="400">${esc(placeText)}</tspan>`
    const body = `<text x="${PAD}" y="${y}" fill="${LABEL}" font-size="14" font-weight="500">${esc(nameText)}${placeSpan}</text>
<text x="${W - PAD}" y="${y}" text-anchor="end" fill="${SUB}" font-size="12">${file.isEmpty === true ? 'Empty' : `${file.done} of ${file.total}`}</text>
${strip(PAD, y + 9, INNER, file.done, file.active, file.total)}`

    return file.isArchived === true || file.isEmpty === true ? `<g opacity=".55">${body}</g>` : body
  })
  const height = 26 + Math.max(0, files.length - 1) * HEAD_ROW_PX + 34

  return stage(height, rows.join('\n'), files.map(file => (file.isEmpty === true ? `${file.name}: empty` : `${file.name}: ${file.done} of ${file.total} done`)).join('; '))
}

// ---------------------------------------------------------------- agents

function agentBadge(agent: AgentView): { label: string; kind: 'live' | 'ok' | 'danger' | 'neutral' } {
  if (agent.isIdle) {
    return { label: 'Idle', kind: 'neutral' }
  }
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
    const end = agent.endedAt ?? agent.idleSince ?? view.now
    const x0 = x(agent.startedAt)
    const w = Math.max(6, x(end) - x0)
    const failed = agent.status === 'failed' || agent.status === 'killed'
    parts.push(agent.isEnded ? '<g opacity=".55">' : '<g>')
    parts.push(actor(PAD + 12, y - 2, agent.index, failed ? 'failed' : agent.isEnded ? 'none' : 'working', false, blinks))
    const fill = agent.isEnded ? (failed ? STAGE_DANGER : TRACK) : 'url(#progress)'
    parts.push(`<rect x="${x0}" y="${y - 4}" width="${w}" height="4" rx="2" fill="${fill}"/>`)
    if (agent.status === 'completed' && end <= t1) {
      parts.push(`<path d="M ${x0 + w + 5} ${y - 2} l 2.4 2.4 l 4.6 -5" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`)
    } else if (!agent.isEnded && !agent.isIdle) {
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
  const isOrch = agent.index === ORCH
  // The orchestrator has no Stop button: it is the main conversation, not a task to kill.
  const stop = agent.isEnded || isOrch ? 0 : STOP_PX
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
  // An idle orchestrator keeps a steady dot and steady ticket dots; an idle agent still blinks.
  const isCalm = isOrch && agent.isIdle === true
  parts.push(actor(PAD + 12, 26 + HEAD_DROP_PX, agent.index, failed ? 'failed' : agent.isEnded ? 'none' : isCalm ? 'steady' : 'working', hasLink && !agent.isEnded, blinks))
  let ty = 31 + HEAD_DROP_PX
  const tx = PAD + 36
  parts.push(`<text x="${tx}" y="${ty}" fill="${agent.isEnded ? SUB : LABEL}" font-size="14" font-weight="500">${esc(fit(agent.description, INNER - 44 - bw - stop, 14, 500))}</text>`)
  parts.push(badge(W - PAD, ty, label, kind))
  ty += 20
  for (const link of shownLinks) {
    parts.push(`<circle cx="${tx + 4}" cy="${ty - 4}" r="4" fill="${color}"${isCalm ? '' : ` class="${blinks.cls([color])}"`}/>
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
  const ran = elapsed((agent.endedAt ?? agent.idleSince ?? view.now) - agent.startedAt)
  const isIdle = agent.isIdle === true && agent.idleSince !== undefined
  const when = agent.endedAt !== undefined ? [`ran ${ran}`, `ended ${elapsed(view.now - agent.endedAt)} ago`] : isIdle ? [`ran ${ran}`] : [ran]
  // An idle agent's note leads, so a narrow card never cuts it off. The orchestrator has no run
  // time: the main conversation has been there since the session began.
  const meta = (isOrch
    ? ['Orchestrator', agent.type, plural(agent.toolCalls, 'tool call')]
    : [isIdle ? `Finished ${clock(agent.idleSince!)}, not stopped` : undefined, agent.type, agent.model, ...when, plural(agent.toolCalls, 'tool call'), agent.tokens ? `${tokens(agent.tokens)} tokens` : undefined])
    .filter((part): part is string => part !== undefined && part !== '')
    .join('\u2002·\u2002')
  parts.push(`<text x="${tx}" y="${ty}" fill="${SUB}" font-size="12">${esc(fit(meta, INNER - 40, 12))}</text>`)
  ty += 20
  if (!agent.isEnded && agent.doing !== undefined) {
    // An idle agent's call has long returned: it is the last one, not the current one.
    const doing = agent.isIdle ? `Last: ${agent.doing}` : agent.doing
    parts.push(`<text x="${tx}" y="${ty}" fill="${SUB}" font-size="12" class="mono">${esc(fit(doing, INNER - 44, 12, 400, true))}</text>`)
  }

  // A finished agent stays in the ledger, grayed out (STG-DRAW-6: a quiet item draws at reduced opacity).
  const body = agent.isEnded ? `<g opacity=".55">${parts.join('\n')}</g>` : parts.join('\n')

  // The orchestrator's title is a headline, so its alt text keeps the name that identifies the card.
  const alt = isOrch ? `${agentLabel(agent.index)}, Orchestrator: ${label}, ${agent.description}` : `${agentLabel(agent.index)}, ${agent.description}: ${label}`

  return stage(h, body, alt, blinks.css())
}
