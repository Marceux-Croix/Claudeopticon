/** The SVG parts that more than one card draws: owner dots, actor disks, progress strips and badges. */

import { agentColor, agentLabel, labelFontSize, ORCH } from './agent-identity'
import { ACTOR, Blinks, DANGER, FAINT, GREEN, INDICATOR, LABEL, STAGE_BG, STAGE_DANGER, STAGE_GRAY, TRACK } from './card-stage'
import { esc } from './card-text'
import type { View } from './card-types'

/** Whether an owner's tag blinks: an agent's always, the orchestrator's only while it runs a turn. */
export function isBlinking(owner: number, view: View): boolean {
  return owner !== ORCH || view.orchestrator?.status === 'running'
}

/**
 * The status dot of a ticket: in the first color that blinks, cycling through every blinking
 * owner; steady in the first owner's color when none blinks (only an idle orchestrator).
 */
export function ownerDot(cx: number, cy: number, r: number, owners: readonly number[], view: View, blinks: Blinks): string {
  const live = owners.filter(owner => isBlinking(owner, view)).map(agentColor)
  if (live.length === 0) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${agentColor(owners[0] ?? 0)}"/>`
  }

  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${live[0]}" class="${blinks.cls(live)}"/>`
}

/**
 * How many of `sizes` (the px widths of owner chips or disks, first first) fit in `room` px with
 * `gap` after each, when the rest are told by one "+M" chip of `moreSize(M)` px. All of
 * them when they fit without it. Zero when not even one fits with the chip: the chip stands alone.
 */
export function ownersFit(sizes: readonly number[], room: number, gap: number, moreSize: (more: number) => number): number {
  const widthOf = (n: number) => sizes.slice(0, n).reduce((sum, size) => sum + size + gap, 0)
  if (widthOf(sizes.length) <= room) {
    return sizes.length
  }
  for (let n = sizes.length - 1; n > 0; n -= 1) {
    if (widthOf(n) + moreSize(sizes.length - n) <= room) {
      return n
    }
  }

  return 0
}

/** The "+M" disk that stands for the owners left out: the size of an actor disk, no ring and no state dot. */
export function moreDisk(cx: number, cy: number, more: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="14" fill="${ACTOR}" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>
<text x="${cx}" y="${(cy + 3.7).toFixed(1)}" text-anchor="middle" fill="${LABEL}" font-size="10.5" font-weight="500">+${more}</text>`
}

/** An actor disk: 12 px radius, letter 500; the state dot at its lower right (STG-DRAW-7, CMP-AV-4). */
export function actor(cx: number, cy: number, index: number, state: 'working' | 'steady' | 'failed' | 'none', isMatch: boolean, blinks: Blinks): string {
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
export function strip(x: number, y: number, w: number, done: number, active: number, total: number): string {
  const wDone = total === 0 ? 0 : (done / total) * w
  const wActive = total === 0 ? 0 : (active / total) * w

  return `<rect x="${x}" y="${y}" width="${w}" height="4" rx="2" fill="${TRACK}"/>
${wActive > 0 ? `<rect x="${x + wDone}" y="${y}" width="${wActive}" height="4" rx="2" fill="${FAINT}"/>` : ''}
${wDone > 0 ? `<rect x="${x}" y="${y}" width="${Math.max(wDone, 4)}" height="4" rx="2" fill="url(#progress)"/>` : ''}`
}

export function badgeWidth(label: string): number {
  return Math.round(label.length * 6.4 + 12)
}

/** A status badge: 22 px high, radius 4, 500 12 px (CMP-BDG-1). */
export function badge(right: number, y: number, label: string, kind: 'live' | 'ok' | 'danger' | 'neutral'): string {
  const w = badgeWidth(label)
  const fill = kind === 'live' ? INDICATOR : kind === 'danger' ? 'rgba(251,146,60,.16)' : 'rgba(255,255,255,.1)'
  const ink = kind === 'live' ? '#FFFFFF' : kind === 'danger' ? DANGER : kind === 'ok' ? GREEN : STAGE_GRAY

  return `<rect x="${right - w}" y="${y - 15}" width="${w}" height="22" rx="4" fill="${fill}"/>
<text x="${right - w / 2}" y="${y}" text-anchor="middle" fill="${ink}" font-size="12" font-weight="500">${esc(label)}</text>`
}
