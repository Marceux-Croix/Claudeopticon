/** The pane, timing and layout constants. */

export const TITLE = 'Claudeopticon'

/** The hover group of the room switch and its tip. */
export const ROOM_SCOPE = 'claudeopticon-room'

export const ROOM_TIP = 'Limit UI shift reserves interface space so new agent activity does not cause scroll jumps.'

export const TICK_MS = 1000

export const SCAN_EVERY = 3

/** Ticks between full resyncs: every file reread whatever its mtime, the categories reloaded, the agent list asked again. */
export const RESYNC_EVERY = 60

export const CLOCK_MS = 5000

export const ITEMS_SHOWN = 12

/** The corner button's offsets from the card's lower right corner, in cells: about even in px. */
export const ACTION_RIGHT = 2

export const ACTION_BOTTOM = 1

/** Rows from a live agent card's top edge to its Stop button, on the title row at the card's right edge. */
export const STOP_TOP = 1

/** The Stop button's label: blank, since the card draws the red key it lies over; two no-break spaces and the button's padding are about the key's width. */
export const STOP_HIT = '\u00a0'.repeat(2)

/** Cells the blank Stop button's right edge sits left of the drawn key's: the button's own padding, measured on the desktop (2026-10-24). */
export const STOP_PAD_CELLS = 1

/** The cells one corner button and its gap take, to set the tip left of them all. */
export const ACTION_CELLS = 5

/** Cells the todo search box keeps before the buttons beside it wrap to the next line: room for the box and its Search key. */
export const SEARCH_MIN_CELLS = 24

/**
 * CSS pixels per pane cell on the desktop: an estimate, not a measure (the pane reports cells, not pixels). It must be an
 * overestimate. A card drawn wider than the pane scales down to the pane's exact width, and the buttons placed over a card
 * in cells (Stop, tips) then land on the scaled card at any real cell width, since both use this value. An underestimate
 * draws every card short of the pane, out of line with the buttons outside the cards, and a Stop button over the badge
 * (, 8.5 fell short after a desktop update, 2026-10-24).
 */
export const CELL_PX = 10

export const NOTE_MS = 4000

/** The top card redraws this often when nothing else does, so its time axis scrolls. */
export const IDLE_DRAW_MS = 30_000

/** After this many failed writes in a row of one key, one toast says nothing is kept. */
export const SAVE_FAILS_TOAST = 5
