/** The agent cards: the live agent card, the timeline and the Orchestrator history. */

import { agentColor, agentLabel, ORCH } from './agent-identity'
import { clock, elapsed, plural, tokens } from './card-format'
import { actor, badge, badgeWidth, strip } from './card-parts'
import { ACCENT, Blinks, FAINT, INNER, LABEL, PAD, RULE, stage, STAGE_DANGER, SUB, TRACK, W } from './card-stage'
import { esc, fit } from './card-text'
import type { AgentView, Card, View } from './card-types'
import { ORCHESTRATOR_PAGE } from './orchestrator-history'

const MAX_LINKS_SHOWN = 3

/** The height of one Orchestrator entry: its summary line, and a dim detail line when it has one. */
const ENTRY_PX = 22
const DETAIL_PX = 16
/**
 * The Orchestrator card's held height: a full page of entries, each with a detail line. A page with
 * fewer entries or shorter ones keeps it, so the cards below the card stay put as calls come in.
 */
export const ORCHESTRATOR_HELD_PX = 8 + ORCHESTRATOR_PAGE * (ENTRY_PX + DETAIL_PX) + 14

/**
 * The Orchestrator card: one line per tool call summary, newest first, each with its start time in
 * small text on the right; a call still running has a live dot, a finished one a quiet one. An
 * entry with a `detail` (the command, path or pattern of the call) has it on a dim mono line below.
 * Held (the default), the card keeps the height of a full page; not held, it fits its entries.
 */
export function orchestratorSvg(entries: readonly { line: string; at: number; isRunning: boolean; detail?: string }[], isHeld = true): Card {
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

  const alt = entries.length === 0 ? 'Orchestrator: nothing done yet' : `Orchestrator: ${entries.map(entry => `${clock(entry.at)} ${entry.line}`).join('; ')}`

  return stage(isHeld ? Math.max(y + 14, ORCHESTRATOR_HELD_PX) : y + 14, parts.join('\n'), alt)
}

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

/**
 * The agents' timeline, from the first agent's start to now: one strip per agent. The right end
 * reads "Now" and a running strip pulses at its head.
 */
/** The timeline's top margin, and the room each agent's strip takes. */
const TIMELINE_TOP = 26
const TIMELINE_ROW_H = 30

/** The height of the timeline for `n` agent strips: one strip's room when there are none. */
export function timelineHeight(n: number): number {
  return TIMELINE_TOP + Math.max(n, 1) * TIMELINE_ROW_H - 8 + 28
}

export function timelineSvg(view: View, all: readonly AgentView[]): Card {
  // No agent shown: the span is empty (Math.min() of nothing is Infinity and would draw NaN).
  const t0 = all.length === 0 ? view.now : Math.min(...all.map(a => a.startedAt))
  const t1 = view.now
  const agents = [...all]
  const n = agents.length
  const parts: string[] = []
  const blinks = new Blinks()
  const plotX = PAD + 34
  const plotW = INNER - 34 - 52
  const span = Math.max(1000, t1 - t0)
  const x = (t: number) => plotX + ((Math.min(Math.max(t, t0), t1) - t0) / span) * plotW
  const top = TIMELINE_TOP
  const rowH = TIMELINE_ROW_H
  const axisY = timelineHeight(n) - 28
  for (const f of [0, 0.5, 1]) {
    const gx = plotX + f * plotW
    const t = t0 + f * span
    const tick = f === 1 ? 'Now' : `${elapsed(view.now - t)} ago`
    parts.push(`<line x1="${gx}" y1="${top - 16}" x2="${gx}" y2="${axisY}" stroke="${RULE}"/>
<text x="${gx}" y="${axisY + 16}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}" fill="${FAINT}" font-size="11">${tick}</text>`)
  }
  if (n === 0) {
    parts.push(`<text x="${plotX + plotW / 2}" y="${top + 4}" text-anchor="middle" fill="${SUB}" font-size="12">${view.agents.length > 0 ? 'All agents finished' : 'No agents ran in this window'}</text>`)
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

/** The room left of a live agent's badge that the card keeps free for the pane's Stop button. */
export const STOP_PX = 44
/** The gap between a live agent's Stop button and its badge. */
const STOP_GAP_PX = 8
/**
 * How far an agent card's title row sits below its usual place: the pane places the Stop button
 * in whole text rows, and one row down puts its center 5 px below a badge at the usual place.
 */
const HEAD_DROP_PX = 5

/** The height of an agent card of `lines` text lines, with the progress strip's extra room when it has one. */
export function agentCardHeight(lines: number, hasProgress: boolean): number {
  return 20 + HEAD_DROP_PX + lines * 20 + (hasProgress ? 8 : 0)
}

/** The smallest agent card: its title line and its meta line. */
export const AGENT_CARD_MIN_PX = agentCardHeight(2, false)

/** How far a live agent's Stop button sits from the card's right padding: past the badge and a gap. */
export function stopInsetPx(agent: AgentView): number {
  return badgeWidth(agentBadge(agent).label) + STOP_GAP_PX
}

/** One agent: actor, name and status badge; the item it works on; meta; current tool call. */
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
  const h = agentCardHeight(lines, progress !== undefined)
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
