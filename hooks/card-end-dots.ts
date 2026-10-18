/** The end dots on the top card: one dot per trace end, and one shared dot, split in wedges, for ends that would sit on top of each other. */

import type { Box } from './card-end-labels'

/** One trace end: its y in px, its color as drawn (dark theme) and the fill class that swaps it in the light theme. */
export type EndDot = { y: number; color: string; cls: string }

/** A dot is 3.5 px with a 2 px ring in the stage color: two dots closer than this look like one blot. */
export const MERGE_PX = 8
const R = 3.5
/** A shared dot is a little larger, so each wedge reads as its color. */
const SHARED_R = 4.5

/**
 * The ends in groups of dots that touch: sorted by y, an end joins the group before it when it is
 * less than MERGE_PX from the group's last end. Returns the groups as lists of indexes into `ends`.
 */
export function dotGroups(ends: readonly EndDot[]): number[][] {
  const order = ends.map((end, i) => ({ y: end.y, i })).sort((a, b) => a.y - b.y || a.i - b.i)
  const groups: { last: number; items: number[] }[] = []
  for (const one of order) {
    const group = groups[groups.length - 1]
    if (group !== undefined && one.y - group.last < MERGE_PX) {
      group.items.push(one.i)
      group.last = one.y
    } else {
      groups.push({ last: one.y, items: [one.i] })
    }
  }

  return groups.map(group => group.items.sort((a, b) => a - b))
}

const f = (v: number) => String(Math.round(v * 10) / 10)

/**
 * The end dots at x = `x`, as SVG, and the box each drawn dot covers (for the end labels to keep
 * off). A lone end is a plain dot. Ends that touch share one dot at their mean y, split in equal
 * wedges, one per end in its own color, the first from the top clockwise: two equal values read as
 * one dot half green, half blue, not as one color hiding the other.
 */
export function endDots(ends: readonly EndDot[], x: number, ring: string): { svg: string[]; boxes: Box[] } {
  const svg: string[] = []
  const boxes: Box[] = []
  for (const group of dotGroups(ends)) {
    const members = group.map(i => ends[i]!)
    if (members.length === 1) {
      const end = members[0]!
      svg.push(`<circle cx="${f(x)}" cy="${f(end.y)}" r="${R}" fill="${end.color}" class="${end.cls}" stroke="${ring}" stroke-width="2"/>`)
      boxes.push({ x0: x - R - 1, x1: x + R + 1, y0: end.y - R - 1, y1: end.y + R + 1 })
      continue
    }
    const y = members.reduce((sum, end) => sum + end.y, 0) / members.length
    svg.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${SHARED_R + 1}" fill="${ring}"/>`)
    const step = (2 * Math.PI) / members.length
    members.forEach((end, k) => {
      const a0 = -Math.PI / 2 + k * step
      const a1 = a0 + step
      const at = (a: number) => `${f(x + SHARED_R * Math.cos(a))} ${f(y + SHARED_R * Math.sin(a))}`
      svg.push(`<path d="M ${f(x)} ${f(y)} L ${at(a0)} A ${SHARED_R} ${SHARED_R} 0 0 1 ${at(a1)} Z" fill="${end.color}" class="${end.cls}"/>`)
    })
    boxes.push({ x0: x - SHARED_R - 1, x1: x + SHARED_R + 1, y0: y - SHARED_R - 1, y1: y + SHARED_R + 1 })
  }

  return { svg, boxes }
}
