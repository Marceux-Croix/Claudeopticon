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
 * blinks a color, and so does each todo item it works on. Sixteen colors, most distinct first: each is
 * the OKLab color farthest from the ones before it, from the orchestrator teal, the progress violet and the
 * stage gray, with at least 3:1 contrast to white chip text and to the dark card. An agent takes the first
 * free color when it starts and keeps it; the color is free again once the agent finishes (agent-colors.ts).
 * The A1, A2 labels stay, so color is never the only cue (COL-9).
 */
export const AGENT_COLORS = [
  '#3987e5', '#a05001', '#f55a79', '#207e27', '#da7e1e', '#79579b', '#d665cf', '#8e8227',
  '#1870a1', '#d9471b', '#269573', '#2d5ed4', '#cc4394', '#8a87fd', '#ad52c8', '#0f9b23',
]

/** The orchestrator's color: a teal, apart from the agent colors and from the violet progress. */
export const ORCH_COLOR = '#1fa7b8'

/** Each agent's color slot by its index, set with each view. */
let slots: readonly number[] = []
export function setColorSlots(next: readonly number[]): void {
  slots = next
}

export function agentColor(index: number): string {
  if (index === ORCH) {
    return ORCH_COLOR
  }

  return AGENT_COLORS[slots[index] ?? index % AGENT_COLORS.length] ?? AGENT_COLORS[0]!
}
