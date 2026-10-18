/** An agent's identity on the pane: its label (A1, O), the label's font size, and its color. */

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

const STAGE_GRAY_FALLBACK = '#9AA0B4'
