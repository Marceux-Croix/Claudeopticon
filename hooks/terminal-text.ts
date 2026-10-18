/** The terminal pane's text parts: the progress bar, the clipped line and the control-free text. */

import { cutUnits, controlFree } from './card-text'

export function bar(done: number, total: number, width: number): string {
  if (total === 0) {
    return '░'.repeat(width)
  }
  const filled = Math.min(width, Math.max(0, Math.round((done / total) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** The text cut to at most `width` characters, with three dots when cut and the width allows them. */
export function clip(text: string, width: number): string {
  const room = Math.max(0, width)
  if (text.length <= room) {
    return text
  }

  return room <= 3 ? cutUnits(text, room) : `${cutUnits(text, room - 3)}...`
}

/**
 * A Text element's children made safe for the engine: every string in them, at any depth of
 * arrays, goes through controlFree (UCR-038: one control character in a ticket, a todo file name
 * or a Bash command made the engine refuse the whole pane). Elements stay as they are: a nested
 * Text cleans its own children, and numbers and booleans hold no text.
 */
export function textChildren(children: unknown): unknown {
  if (typeof children === 'string') {
    return controlFree(children)
  }

  return Array.isArray(children) ? children.map(textChildren) : children
}
