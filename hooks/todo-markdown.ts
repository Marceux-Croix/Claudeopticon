/**
 * The todo Markdown grammar: item IDs, inline code, and the items of a file. The block structure
 * (checkbox lines, fences, comments, indented code) is in `markdown-blocks.ts`; it is re-exported here,
 * so every caller reads the grammar from this one module.
 */

import type { TodoItem, TodoStatus } from '../types'
import { itemKey } from './item-keys'
import { bare, CHECKBOX, exampleMask } from './markdown-blocks'

export { bare, CHECKBOX, exampleMask, expandTabs, FENCE, fenceMask, fenceOpens, fenceStep } from './markdown-blocks'
export type { Fence } from './markdown-blocks'

/**
 * An item ID without its `#`: `T` and a digit, then digits and capital letters (`T12`, `T3C`,
 * `T002A`); the mod's form of 4 or more characters in any case (`t002a`); or the older forms of other
 * letters and digits (`PROJ7`). `#TODO` is no ID, and neither is a word such as `#T1st` or `#t2a`
 *: a lowercase letter makes an ID only in the 4-character form.
 */
export const ID_SRC = '(?:[Tt]\\d[0-9A-Za-z]{3,}|[Tt]\\d[0-9A-Z]*|[A-Za-z]+\\d+)'
export const ITEM_ID = new RegExp(`#(${ID_SRC})\\b`)

/** An item's text as the pane shows it: Markdown bold and strike markers taken out, U+2028 and U+2029 read as spaces, spaces trimmed. */
export function plainText(markdown: string): string {
  return markdown.replace(/\*\*|__|~~/g, '').replace(/[\u2028\u2029]/g, ' ').trim()
}

/** The item's leading ID (no `#`): the one right after the box, at the start of its text. */
export const leadingId = (text: string): string | undefined => new RegExp(`^#(${ID_SRC})\\b`).exec(text)?.[1]

/**
 * The text with every inline code span (CommonMark: a run of backticks up to the next run of the same
 * length) blanked to spaces, so a word inside one (`` `` ``, an example) is never read as an ID
 *. A run with no closing run is plain text, and stays.
 *
 * Linear in the text: one pass finds every backtick run, indexed by its length; each opening
 * run then takes the next run of its length after it through a cursor per length that only moves
 * forward. The old scan searched to the end of the text for each unclosed run, so runs of many lengths
 * (`a``a```a`...) cost the square of the line.
 */
export function codeSpansOut(text: string): string {
  if (!text.includes('`')) {
    return text
  }
  // Every backtick run: its start and length, in order; and the run indexes of each length.
  const runs: { start: number; len: number }[] = []
  const byLen = new Map<number, number[]>()
  for (let i = 0; i < text.length; ) {
    if (text[i] !== '`') {
      i += 1
      continue
    }
    const start = i
    while (i < text.length && text[i] === '`') {
      i += 1
    }
    const len = i - start
    // Local mutation: a push, never a copy, keeps the pass linear when many runs share a length.
    const list = byLen.get(len)
    if (list === undefined) {
      byLen.set(len, [runs.length])
    } else {
      list.push(runs.length)
    }
    runs.push({ start, len })
  }
  const cursor = new Map<number, number>()
  // The first run of length `len` after run `after`, or undefined; the cursor of that length skips the runs passed.
  const nextOf = (len: number, after: number): number | undefined => {
    const list = byLen.get(len)!
    let at = cursor.get(len) ?? 0
    while (at < list.length && list[at]! <= after) {
      at += 1
    }
    cursor.set(len, at)

    return list[at]
  }
  let out = ''
  let copied = 0
  for (let r = 0; r < runs.length; ) {
    const run = runs[r]!
    const close = nextOf(run.len, r)
    if (close === undefined) {
      r += 1
      continue
    }
    const end = runs[close]!.start + run.len
    out += text.slice(copied, run.start) + ' '.repeat(end - run.start)
    copied = end
    r = close + 1
  }

  return out + text.slice(copied)
}

/** A `T` ID anywhere in a text (no `#`), outside inline code: the only form that counts as an item's own ID when it is not the leading one. */
const trailingTicketId = (text: string): string | undefined => /#([Tt]\d[0-9A-Za-z]{3,}|[Tt]\d[0-9A-Z]*)\b/.exec(codeSpansOut(text))?.[1]

/**
 * The item's own ID for a checkbox line's text. A leading ID is its own. Else the first `T` ID anywhere,
 * unless another ticket owns that ID as its leading ID (`owned`, lowercase): then the line only
 * refers to that ticket and has no ID of its own. Words that look like IDs (`#h264`, `#utf8`) are
 * never an ID unless they lead the line.
 */
function ownId(text: string, owned: ReadonlySet<string>): string | undefined {
  const lead = leadingId(text)
  if (lead !== undefined) {
    return lead
  }
  const first = trailingTicketId(text)

  return first !== undefined && owned.has(first.toLowerCase()) ? undefined : first
}

/**
 * Per line of a file (`undefined` for a line that is no item, or sits in a code fence or an HTML
 * comment): the line's own ID. A leading ID is its own, unless an earlier line of the file leads
 * with the same ID; a `T` ID elsewhere is its own only when no ticket of the file
 * (or of `extra`, lowercase) leads with it and no earlier line already took it. So a reference line
 * above its ticket has no ID, and two lines that name one ID do not share a key.
 */
export function lineOwnIds(lines: readonly string[], extra: ReadonlySet<string> = new Set()): (string | undefined)[] {
  const isFenced = exampleMask(lines)
  const texts = lines.map((line, at) => {
    const match = isFenced[at] === true ? null : CHECKBOX.exec(line)

    return match === null ? undefined : plainText(match[2] ?? '')
  })
  const owned = new Set(extra)
  for (const text of texts) {
    const lead = text === undefined ? undefined : leadingId(text)
    if (lead !== undefined) {
      owned.add(lead.toLowerCase())
    }
  }
  const claimed = new Set<string>()
  const led = new Set<string>()

  return texts.map(text => {
    if (text === undefined) {
      return undefined
    }
    const id = ownId(text, owned)
    const lead = leadingId(text)
    if (lead !== undefined) {
      // A later line that leads with the same ID has no ID of its own: one key never names two lines, so a
      // button on the second never writes the first, and numbering gives the second an ID.
      if (led.has(lead.toLowerCase())) {
        return undefined
      }
      led.add(lead.toLowerCase())
    } else if (id !== undefined) {
      if (claimed.has(id.toLowerCase())) {
        return undefined
      }
      claimed.add(id.toLowerCase())
    }

    return id
  })
}

/** The checkbox items of a todo file's lines, each with the index of its line. Code fences and HTML comments hold none. */
export function itemsAt(rawLines: readonly string[]): { at: number; item: TodoItem }[] {
  const lines = rawLines.map(bare)
  const isFenced = exampleMask(lines)
  const ids = lineOwnIds(lines)
  const found: { at: number; item: TodoItem }[] = []
  const seen = new Map<string, number>()
  for (const [at, line] of lines.entries()) {
    const match = isFenced[at] === true ? null : CHECKBOX.exec(line)
    if (match === null) {
      continue
    }
    const box = match[1] ?? ' '
    const status: TodoStatus =
      box === 'x' || box === 'X' ? 'completed' : box === '~' || box === '>' ? 'in_progress' : 'pending'
    const text = plainText(match[2] ?? '')
    const id = ids[at]
    const item: TodoItem = id === undefined ? { text, status } : { text, status, id }
    // A line whose key an earlier line of the file has gets its place among them: every key names one line.
    const key = itemKey(item)
    const nth = (seen.get(key) ?? 0) + 1
    seen.set(key, nth)
    found.push({ at, item: nth === 1 ? item : { ...item, nth } })
  }

  return found
}

/** Reads the checkbox items of one todo file, in the format the RULES block gives Claude. */
export function parseTodo(markdown: string): TodoItem[] {
  return itemsAt(markdown.split('\n')).map(one => one.item)
}

export function count(items: readonly TodoItem[]): { done: number; active: number; total: number } {
  return {
    done: items.filter(item => item.status === 'completed').length,
    active: items.filter(item => item.status === 'in_progress').length,
    total: items.length,
  }
}
