/** The spaces that hold the place of a ticket that left a column, so the cards below do not move. */

/** A drawn entry of a column or list: a ticket (or row) by ID, or the space of one that left. */
export type Slot = { id: string; h: number; isSpace?: true }
/** The space of a ticket that left: its ID, where it was in the column's drawn sequence, how high, and since when. */
export type Space = { col: string; id: string; index: number; h: number; at: number; seq: number }
export type Layout = { spaces: Space[]; drawn: Map<string, { sig: string; slots: Slot[] }>; seq: number }

/** A space lasts this long if no control is pressed. */
export const SPACE_MS = 60_000
/** Most spaces held at once, over all columns; the oldest go first. */
export const MAX_SPACES = 10

export const newLayout = (): Layout => ({ spaces: [], drawn: new Map(), seq: 0 })

/** Removes one space. The spaces after it in its column move up one place, and it leaves the column's last drawn sequence. */
function dropSpace(layout: Layout, space: Space): void {
  layout.spaces = layout.spaces.filter(one => one !== space)
  for (const one of layout.spaces) {
    if (one.col === space.col && one.index > space.index) {
      one.index -= 1
    }
  }
  const last = layout.drawn.get(space.col)
  if (last !== undefined) {
    last.slots = last.slots.filter(slot => slot.id !== `space:${space.seq}`)
  }
}

/**
 * The sequence to draw for one column (or list) whose entries are now `items`. An entry that was
 * drawn last time (same `sig`: same width, same limit) and is gone now leaves a space of its height
 * at its place, so what is below does not move. Never more than MAX_SPACES in all.
 *
 * An entry that left for a column drawn above this one (`above`, the IDs in the board's rows above
 * it) leaves no space: the column above grew by its card, and the space it would leave
 * here would move everything below down by one card. Without it the two cancel, and the cards from
 * its place down stay put.
 */
export function columnSlots(layout: Layout, col: string, sig: string, items: readonly { id: string; h: number }[], now: number, above: ReadonlySet<string> = new Set()): Slot[] {
  const last = layout.drawn.get(col)
  if (last !== undefined && last.sig !== sig) {
    for (const space of layout.spaces.filter(one => one.col === col)) {
      dropSpace(layout, space)
    }
  } else if (last !== undefined) {
    const present = new Set(items.map(item => item.id))
    // A ticket that is back takes its place again: its space goes, so the column does not keep growing.
    for (const space of layout.spaces.filter(one => one.col === col && present.has(one.id))) {
      dropSpace(layout, space)
    }
    // Each entry that went up leaves no place, so the places after it, held spaces too, move up one.
    const upAt = last.slots.flatMap((slot, index) => (slot.isSpace !== true && !present.has(slot.id) && above.has(slot.id) ? [index] : []))
    for (const space of layout.spaces.filter(one => one.col === col)) {
      space.index -= upAt.filter(at => at < space.index).length
    }
    let wentUp = 0
    last.slots.forEach((slot, index) => {
      if (upAt.includes(index)) {
        wentUp += 1
      } else if (slot.isSpace !== true && !present.has(slot.id)) {
        layout.seq += 1
        layout.spaces.push({ col, id: slot.id, index: index - wentUp, h: slot.h, at: now, seq: layout.seq })
      }
    })
    while (layout.spaces.length > MAX_SPACES) {
      dropSpace(layout, layout.spaces.reduce((oldest, one) => (one.seq < oldest.seq ? one : oldest)))
    }
  }
  const slots: Slot[] = items.map(item => ({ id: item.id, h: item.h }))
  for (const space of layout.spaces.filter(one => one.col === col).sort((a, b) => a.index - b.index)) {
    slots.splice(Math.min(space.index, slots.length), 0, { id: `space:${space.seq}`, h: space.h, isSpace: true })
  }
  layout.drawn.set(col, { sig, slots })

  return slots
}

/** Removes every space at a press. A press that moves no ticket by itself also forgets what was drawn, so its changes reflow. */
export function clearSpaces(layout: Layout, isKept: boolean): boolean {
  const had = layout.spaces.length > 0
  layout.spaces = []
  for (const last of layout.drawn.values()) {
    last.slots = last.slots.filter(slot => slot.isSpace !== true)
  }
  if (!isKept) {
    layout.drawn.clear()
  }

  return had
}

/** The keys of the pane's buttons that change nothing on the board: the room switch, the Orchestrator pages, the finished agents switch and Show completed. */
const OFF_BOARD_KEYS: ReadonlySet<string> = new Set(['room-toggle', 'orchestrator-newer', 'orchestrator-older', 'orchestrator-latest', 'agents-toggle', 'todo-show-completed'])
/** An agent's Stop button: its key is this and the agent's ID. */
const STOP_KEY_PREFIX = 'agent-stop-'

/**
 * Whether a press leaves the spaces as they are. A ticket's own button (its label one of
 * `ticketGlyphs`) and a press that changes nothing on the board keep them, so no space goes, and
 * the cards below it do not move, at a press; each still goes after SPACE_MS. Every other press
 * (a filter, a view switch, a search, Show all) changes the board itself, so its spaces clear and
 * that change reflows.
 */
export function pressKeepsSpaces(key: string | undefined, label: string, ticketGlyphs: ReadonlySet<string>): boolean {
  return ticketGlyphs.has(label) || (key !== undefined && (OFF_BOARD_KEYS.has(key) || key.startsWith(STOP_KEY_PREFIX)))
}

/** Removes the spaces older than SPACE_MS. True when any went. */
export function expireSpaces(layout: Layout, now: number): boolean {
  const old = layout.spaces.filter(one => now - one.at >= SPACE_MS)
  for (const space of old) {
    dropSpace(layout, space)
  }

  return old.length > 0
}
