/** The text work of numbering: the ID a line has, and IDs written into lines that have none. */

import { bare, ID_SRC, itemParts, itemText, parseTodo, withLeadingId, type TodoKind } from './todo-markdown'

export const NUMBER_AFTER_MS = 5000

/**
 * The most lines of one file numbered in one pass; the rest wait for the next pass. One
 * pick claims at most CLAIM_SCAN blocks of BLOCK_SIZE IDs (512), and fewer when other sessions hold
 * some: 128 leaves room for that, so a file of many new lines never asks for more than a pick gives.
 */
export const NUMBER_MAX = 128

/** Every ID word of the line (`#` dropped). */
const ID_WORDS = new RegExp(`#(${ID_SRC})\\b`, 'g')

/**
 * Every ID word a checkbox line carries (no `#`), in order: an example line `- [ ] see #h264
 * and` holds `T0099` as well, so its value counts as taken. Empty for a line with none.
 */
export function lineIds(line: string, kind: TodoKind = 'md'): string[] {
  const parts = itemParts(line, kind)

  return parts === undefined ? [] : [...itemText(parts).matchAll(ID_WORDS)].map(word => word[1]!)
}

/**
 * The first checkbox line of `text` that holds the ID word `#<id>` (any case), trimmed; undefined when none
 * does. For a toast that names where an ID is. Only checkbox lines count (`lineIds`), as
 * only their IDs move the next IDs: a prose line that names the ID is never the line to edit.
 */
export function lineHolding(text: string, id: string, kind: TodoKind = 'md'): string | undefined {
  const want = id.toLowerCase()

  return text
    .split('\n')
    .map(bare)
    .find(line => lineIds(line, kind).some(word => word.toLowerCase() === want))
    ?.trim()
}

/** Every item ID a todo file's text holds, lowercase: the parser's, and every ID word of each checkbox line, examples included. */
export function textIds(text: string, kind: TodoKind = 'md'): string[] {
  const ids = parseTodo(text, kind).flatMap(item => (item.id === undefined ? [] : [item.id.toLowerCase()]))
  for (const line of text.split('\n').map(bare)) {
    ids.push(...lineIds(line, kind).map(id => id.toLowerCase()))
  }

  return ids
}

/**
 * The text with `ids` inserted, in order, right after the box of each line in `at` (line indexes):
 * `- [ ] Fix x` becomes `- [ ] Fix x`.
 */
export function insertIds(text: string, at: readonly number[], ids: readonly string[], kind: TodoKind = 'md'): string {
  const lines = text.split('\n')
  at.forEach((index, i) => {
    // An HTML item gets the ID at the start of its text, after the input tag and its spaces (`withLeadingId`).
    lines[index] = withLeadingId(lines[index]!, kind, ids[i]!)
  })

  return lines.join('\n')
}
