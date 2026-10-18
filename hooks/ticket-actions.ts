/** The ticket buttons: each button's glyph, tip, toast, and the prompt or box it gives. */

import type { ItemStatus } from './card-types'
import { statusPrompt, ticketPrompt } from './ticket-prompts'

/**
 * A ticket's corner button: its name, one-glyph label, hover tip and toast; then either the prompt
 * it sends to Claude, or, for a manual move, the box it writes in the todo file (no prompt).
 */
export type TicketAction = { name: string; glyph: string; tip: string; toast: string; prompt: (path: string, text: string) => string; mark?: ItemStatus }

/** On an open ticket: three chevrons, sending the item to Claude to build. */
export const SEND_ACTION: TicketAction = { name: 'send', glyph: '\u22D9', tip: 'Send to Claude', toast: 'Sent to Claude', prompt: ticketPrompt }

/** On a ticket in progress or already sent: a question mark, asking Claude for the item's status. */
export const STATUS_ACTION: TicketAction = { name: 'status', glyph: '?', tip: 'Ask Claude for a status update', toast: 'Asked for status', prompt: statusPrompt }

/** The manual moves: they write the box and tell Claude at the next prompt, asking nothing of it. */
export const START_ACTION: TicketAction = { name: 'start', glyph: '\u25D0', tip: 'Mark in progress', toast: 'Marked in progress', prompt: () => '', mark: 'in_progress' }
export const DONE_ACTION: TicketAction = { name: 'done', glyph: '\u2713', tip: 'Mark done', toast: 'Marked done', prompt: () => '', mark: 'completed' }
export const REOPEN_ACTION: TicketAction = { name: 'reopen', glyph: '\u21A9', tip: 'Move back to open', toast: 'Moved back to open', prompt: () => '', mark: 'pending' }
/** The labels of the ticket buttons: a press on one keeps the layout, so the ticket it moves leaves its space. */
export const TICKET_GLYPHS = new Set([SEND_ACTION, STATUS_ACTION, START_ACTION, DONE_ACTION, REOPEN_ACTION].map(action => action.glyph))
