/** The ticket IDs that Claude's own text puts off until later: "after X lands, is next". */

import { ID_SRC } from './todo-markdown'

/** The words that put work off: the ticket is next, or waits for an event. */
const DEFER = /\b(?:after|afterwards?|next|once|later|queue|queued|follow[- ]?up|until|when\s+\S+\s+(?:lands|is\s+done|finishes))\b/i

/** One sentence: up to a full stop, question or exclamation mark followed by a space, or a line break. */
const SENTENCES = /[^.!?\n]+(?:[.!?](?=\s|$))?/g

/**
 * The IDs (`T0042`, uppercase, no `#`) named in a sentence of `text` that also holds a word that puts
 * work off. Each ID once, in the order of the text. A match is a hint, never a fact: the mod only asks
 * Claude to queue the ticket, it never moves it on a match.
 */
export function deferredIds(text: string): string[] {
  const found = new Set<string>()
  for (const sentence of text.match(SENTENCES) ?? []) {
    if (!DEFER.test(sentence)) {
      continue
    }
    for (const match of sentence.matchAll(new RegExp(`#(${ID_SRC})\\b`, 'g'))) {
      found.add((match[1] ?? '').toUpperCase())
    }
  }

  return [...found]
}
