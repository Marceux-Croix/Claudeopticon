/** Renders the real cards from sample data into docs/images/, for the README. */
// The cards print clock times in local time: render in UTC, so the images are the same on every machine.
process.env.TZ = 'UTC'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentSvg, orchestratorSvg, timelineSvg } from '../hooks/agent-cards.ts'
import { setWidth } from '../hooks/card-stage.ts'
import type { Card } from '../hooks/card-types.ts'
import { heroSvg } from '../hooks/hero-card.ts'
import { boardHead, ticketSvg } from '../hooks/todo-cards.ts'
import { agents, entries, heroView, orchestrator, openTickets, progressTickets, view } from './sample.ts'

const WIDTH = 720
const GAP = 12
const FONT = '"Instrument Sans","Helvetica Neue",Arial,sans-serif'
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/images')

/**
 * One card's markup, placed at (x, y) inside a larger SVG. Its blink classes (`k0`, `k1`, ...) get a
 * prefix of their own: in the pane each card is a separate image, but here they share one document.
 */
let placed = 0
function place(card: Card, x: number, y: number): string {
  placed += 1
  const scoped = card.source.replace(/\bk(\d+)\b/g, `c${placed}k$1`)

  return scoped.replace('<svg ', `<svg x="${x}" y="${y}" `)
}

/** Stacks cards top to bottom, each in a nested <svg>, so each keeps its own <style>. */
function stack(cards: Card[]): string {
  let y = 0
  const inner = cards.map(card => {
    const s = place(card, 0, y)
    y += card.height + GAP
    return s
  })
  const h = y - GAP
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${h}" viewBox="0 0 ${WIDTH} ${h}">\n${inner.join('\n')}\n</svg>`
}

/** Two columns of tickets with a header each; the width follows the card width. */
function board(): string {
  const colW = (WIDTH - GAP) / 2
  const header = boardHead(view.files)
  const head = header.height + GAP + 28
  const columns = [
    { title: 'In progress', tickets: progressTickets },
    { title: 'Open', tickets: openTickets },
  ]
  let height = 0
  const parts = columns.map((col, c) => {
    const x = c * (colW + GAP)
    let y = head
    const cards = col.tickets.map(([it, id, category]) => {
      const card = ticketSvg(it, view, colW, { id, category, isSent: false })
      const s = place(card, x, y)
      y += card.height + GAP
      return s
    })
    height = Math.max(height, y - GAP)
    return `<text x="${x + 4}" y="${header.height + GAP + 18}" font-family='${FONT}' font-size="14" font-weight="600" fill="rgba(255,255,255,.88)">${col.title}</text>\n${cards.join('\n')}`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">\n<rect width="${WIDTH}" height="${height}" rx="12" fill="#07080F"/>\n${place(header, 0, 0)}\n${parts.join('\n')}\n</svg>`
}

/**
 * A live agent card with its Stop button drawn in: in the pane the button is the host's own, laid
 * over the card left of the status badge, in the room the card keeps free for it.
 */
function withStop(card: Card, badgeLabel: string): Card {
  const right = WIDTH - 16 - (Math.round(badgeLabel.length * 6.4 + 12) + 8)
  const x = right - 30
  const button = `<rect x="${x}" y="21" width="30" height="22" rx="6" fill="rgba(255,255,255,.1)"/>
<circle cx="${x + 15}" cy="32" r="7.5" fill="rgba(255,255,255,.88)"/>
<rect x="${x + 10.5}" y="30.75" width="9" height="2.5" fill="#07080F"/>`

  return { ...card, source: card.source.replace(/<\/svg>$/, `${button}</svg>`) }
}

// ---------------------------------------------------------------- the whole pane

/** The pane's own background, around the cards: the host draws it, not the mod. */
const PANE_BG = '#1C1C1E'
const PANE_PAD = 20
const INK = 'rgba(255,255,255,.88)'
const DIM = 'rgba(255,255,255,.55)'

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A host button as the desktop app draws it: a quiet rounded fill, or white for a primary one. */
function hostButton(x: number, y: number, label: string, isPrimary = false, height = 30): { svg: string; width: number } {
  const width = Math.round(label.length * 7.4 + 24)
  const fill = isPrimary ? '#FFFFFF' : 'rgba(255,255,255,.1)'
  const ink = isPrimary ? '#111114' : INK

  return {
    width,
    svg: `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="${fill}"/>
<text x="${x + width / 2}" y="${y + height / 2 + 5}" text-anchor="middle" font-family='${FONT}' font-size="13.5" font-weight="500" fill="${ink}">${esc(label)}</text>`,
  }
}

/** A row of host buttons from x, left to right, 8 px apart; returns the markup and where the row ends. */
function buttonRow(x: number, y: number, labels: readonly string[], primary = false): { svg: string; end: number } {
  const parts: string[] = []
  let at = x
  for (const label of labels) {
    const button = hostButton(at, y, label, primary)
    parts.push(button.svg)
    at += button.width + 8
  }

  return { svg: parts.join('\n'), end: at - 8 }
}

/** A section heading as the pane draws it: bold title, its count dimmed beside it, an optional button at the right. */
function heading(y: number, title: string, detail: string, button?: string): { svg: string; height: number } {
  const titleW = Math.round(title.length * 8.6)
  const right = button === undefined ? '' : hostButton(PANE_PAD + WIDTH - Math.round(button.length * 7.4 + 24), y, button).svg

  return {
    height: 30,
    svg: `<text x="${PANE_PAD}" y="${y + 20}" font-family='${FONT}' font-size="15" font-weight="600" fill="${INK}">${esc(title)}</text>
<text x="${PANE_PAD + titleW + 14}" y="${y + 20}" font-family='${FONT}' font-size="14" fill="${DIM}">${esc(detail)}</text>
${right}`,
  }
}

/** Ticket glyph buttons along a ticket's bottom row, right-aligned, as the pane lays them over the card. */
function ticketButtons(card: Card, x: number, y: number, width: number, glyphs: readonly string[]): string {
  let at = x + width - 14
  const parts: string[] = []
  for (const glyph of [...glyphs].reverse()) {
    at -= 28
    parts.push(`<rect x="${at}" y="${y + card.height - 38}" width="28" height="26" rx="6" fill="rgba(255,255,255,.1)"/>
<text x="${at + 14}" y="${y + card.height - 20}" text-anchor="middle" font-family='${FONT}' font-size="13" fill="${INK}">${esc(glyph)}</text>`)
    at -= 6
  }

  return parts.join('\n')
}

/**
 * The whole Claudeopticon pane, top to bottom, in the order the pane draws it: the top card; Orchestrator;
 * Agents with the timeline and the agent cards; Todo with its controls, the file
 * card and the ticket board. The headings and buttons are the host's own, drawn here to match.
 */
function pane(): string {
  const parts: string[] = []
  let y = PANE_PAD
  const add = (card: Card) => {
    parts.push(place(card, PANE_PAD, y))
    y += card.height + GAP
  }
  const head = (title: string, detail: string, button?: string) => {
    const h = heading(y, title, detail, button)
    parts.push(h.svg)
    y += h.height + GAP
  }

  add(heroSvg(heroView))
  head('Orchestrator', 'Working')
  add(orchestratorSvg(entries))
  const pages = buttonRow(PANE_PAD + 120, y, ['Older'])
  parts.push(`<text x="${PANE_PAD}" y="${y + 20}" font-family='${FONT}' font-size="13.5" fill="${DIM}">Newest 5 of 38</text>`, pages.svg)
  y += 30 + GAP + 6
  head('Agents', '2 live, 1 finished', 'Show finished agents (1)')
  add(timelineSvg(view, agents.slice(0, 2)))
  add(agentSvg(orchestrator, view))
  add(withStop(agentSvg(agents[0]!, view), 'Running'))
  add(withStop(agentSvg(agents[1]!, view), 'Running'))
  head('Todo', `${view.done} of ${view.total} done, ${view.active} in progress`, `Show completed (${view.archived})`)
  parts.push(`<rect x="${PANE_PAD}" y="${y}" width="220" height="30" rx="8" fill="none" stroke="rgba(255,255,255,.22)"/>
<text x="${PANE_PAD + 12}" y="${y + 20}" font-family='${FONT}' font-size="13.5" fill="${DIM}">Search open and in-progress items</text>`)
  parts.push(buttonRow(PANE_PAD + 228, y, ['Search', 'Show as list', 'Recategorize']).svg)
  y += 30 + GAP
  parts.push(`<text x="${PANE_PAD}" y="${y + 20}" font-family='${FONT}' font-size="13.5" fill="${DIM}">Categories</text>`)
  parts.push(buttonRow(PANE_PAD + 84, y, ['Config', 'Docs', 'Parser', 'Release'], true).svg)
  y += 30 + GAP
  add(boardHead(view.files))
  const colW = (WIDTH - GAP) / 2
  const columns = [
    { title: 'In progress', tickets: progressTickets, glyphs: ['✓', '↩', '?'] },
    { title: 'Open', tickets: openTickets, glyphs: ['◐', '⋙'] },
  ]
  let bottom = y
  columns.forEach((column, c) => {
    const x = PANE_PAD + c * (colW + GAP)
    let cy = y
    parts.push(`<text x="${x}" y="${cy + 16}" font-family='${FONT}' font-size="13.5" font-weight="600" fill="${DIM}">${column.title}  ${column.tickets.length}</text>`)
    cy += 24 + GAP
    for (const [item, id, category] of column.tickets) {
      const card = ticketSvg(item, view, colW, { id, category, isSent: false, actions: column.glyphs.length })
      parts.push(place(card, x, cy), ticketButtons(card, x, cy, colW, column.glyphs))
      cy += card.height + GAP
    }
    bottom = Math.max(bottom, cy)
  })
  const h = bottom - GAP + PANE_PAD
  const w = WIDTH + PANE_PAD * 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" rx="14" fill="${PANE_BG}"/>
${parts.join('\n')}
</svg>`
}

setWidth(WIDTH)
const files: Record<string, string> = {
  'top.svg': heroSvg(heroView).source,
  'orchestrator.svg': orchestratorSvg(entries).source,
  'agents.svg': stack([timelineSvg(view, agents), agentSvg(orchestrator, view), withStop(agentSvg(agents[0]!, view), 'Running'), withStop(agentSvg(agents[1]!, view), 'Running')]),
  'board.svg': board(),
  'pane.svg': pane(),
}
mkdirSync(out, { recursive: true })
for (const [name, source] of Object.entries(files)) {
  writeFileSync(resolve(out, name), source)
  console.log(`${resolve(out, name)} ${Buffer.byteLength(source)} bytes`)
}
