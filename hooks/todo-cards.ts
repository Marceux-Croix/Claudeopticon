/** The todo cards: ticket cards, file cards, the board header, and the space a ticket leaves. */

import { agentColor, agentLabel, ORCH } from './agent-identity'
import { actor, badge, badgeWidth, isBlinking, moreDisk, ownerDot, ownersFit, strip } from './card-parts'
import { ACCENT, Blinks, CARD, FAINT, INNER, LABEL, LIGHT_CSS, PAD, RULE, stage, STAGE_GRAY, SUB, SUGGESTED, W } from './card-stage'
import { cutText, esc, fit, MAX_LINES, wrap } from './card-text'
import type { Card, FileView, ItemStatus, ItemView, View } from './card-types'

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
  const status = info.isSent && item.status !== 'completed' ? { label: 'Sent', kind: 'neutral' as const } : item.status === 'completed' ? { label: 'Done', kind: 'ok' as const } : item.status === 'in_progress' ? { label: 'In progress', kind: 'live' as const } : item.status === 'queued' ? { label: 'Queued', kind: 'neutral' as const } : { label: 'Open', kind: 'neutral' as const }
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
  // Category chip: a string only (UCR-210), so a value that is no name never reaches esc().
  if (typeof info.category === 'string' && x + 40 < room) {
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
    const widths = item.owners.map(o => Math.round(agentLabel(o).length * 7 + 14))
    // The chips leave 70 px for the working agent's text; owners past those that fit are told by one "+M" chip (UCR-160).
    const shown = ownersFit(widths, w - pad * 2 - 70, 6, more => Math.round(`+${more}`.length * 7 + 14))
    item.owners.slice(0, shown).forEach((o, k) => {
      const label = agentLabel(o)
      const cw = widths[k]!
      parts.push(`<rect x="${ax}" y="${y}" width="${cw}" height="18" rx="9" fill="${agentColor(o)}"/>
<text x="${ax + cw / 2}" y="${y + 13}" text-anchor="middle" fill="#FFFFFF" font-size="10.5" font-weight="700">${label}</text>`)
      ax += cw + 6
    })
    if (shown < item.owners.length) {
      const label = `+${item.owners.length - shown}`
      const cw = Math.round(label.length * 7 + 14)
      parts.push(`<rect x="${ax}" y="${y}" width="${cw}" height="18" rx="9" fill="rgba(255,255,255,.14)"/>
<text x="${ax + cw / 2}" y="${y + 13}" text-anchor="middle" fill="${LABEL}" font-size="10.5" font-weight="700">${label}</text>`)
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
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`${status.label}: ${cutText(item.text, 120)}`)}">
<style>
text{font-family:"Instrument Sans","Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.mono{font-family:"Fragment Mono",ui-monospace,Menlo,monospace}
${LIGHT_CSS}
${blinks.css()}
</style>
${frame}${bar}
${body}</svg>`

  return { source, width: w, height: h, alt: `${status.label}: ${cutText(item.text, 200)}` }
}

/** The button row's height: a native button, raised one row off the card's bottom edge. */
export const SEND_ROW_PX = 60

/** The pane's card width, for laying tickets out in columns beside it. */
export function cardWidth(): number {
  return W
}

/** The least width, in px, that an item's text keeps in the list view. */
const LIST_TEXT_MIN = 120
/** One owner disk's width in the list view. */
const DISK_PX = 36

/** How many owner disks a list row shows (a "+M" disk takes the place of the rest), and the px they take (UCR-160). */
function listDisks(count: number): { shown: number; used: number } {
  const shown = ownersFit(new Array<number>(count).fill(DISK_PX), INNER - 24 - LIST_TEXT_MIN, 0, () => DISK_PX)

  return { shown, used: shown < count ? shown + 1 : shown }
}

/** How many of the first `limit` items of a file run past 8 lines, for the Show full text button. */
export function longItems(file: FileView, limit: number): number {
  return file.items.slice(0, limit).filter(item => {
    const room = INNER - 24 - listDisks(item.owners.length).used * DISK_PX

    return wrap(item.text, room, 13, item.owners.length > 0 ? 500 : 400, Number.POSITIVE_INFINITY).length > MAX_LINES
  }).length
}

/** The height of an item's row in the list view, so a row that left can keep its place. */
export function listRowPx(item: ItemView, isTextOpen = false): number {
  const room = INNER - 24 - listDisks(item.owners.length).used * DISK_PX

  return 34 + (wrap(item.text, room, 13, item.owners.length > 0 ? 500 : 400, isTextOpen ? Number.POSITIVE_INFINITY : MAX_LINES).length - 1) * LINE_H
}

/** An empty space `height` px high: a transparent card with no text and no buttons, that holds a ticket's place. */
export function spaceSvg(width: number, height: number): Card {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))

  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="presentation"></svg>`, width: w, height: h, alt: '' }
}

/**
 * One todo file as cards: the first carries its name, count and strip; then up to `limit` of its
 * items in the view's order, 40 to a card, so a file of any length stays inside the SVG limit. An
 * item longer than 8 lines stops there with an ellipsis, unless `isTextOpen` shows every item whole.
 * The owners of an item show as the disks that fit, then a "+M" disk (UCR-160).
 *
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
    const room = INNER - 24 - listDisks(item.owners.length).used * DISK_PX
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
    const disks = listDisks(item.owners.length)
    item.owners.slice(0, disks.shown).forEach((owner, k) => {
      const agent = owner === ORCH ? view.orchestrator : view.agents[owner]
      const failed = agent?.status === 'failed' || agent?.status === 'killed'
      const state = failed ? 'failed' : agent?.isEnded === false ? (isBlinking(owner, view) ? 'working' : 'steady') : 'none'
      parts.push(actor(W - PAD - 8 - k * DISK_PX, y - 1, owner, state, true, blinks))
    })
    if (disks.shown < item.owners.length) {
      parts.push(moreDisk(W - PAD - 8 - disks.shown * DISK_PX, y - 1, item.owners.length - disks.shown))
    }
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
