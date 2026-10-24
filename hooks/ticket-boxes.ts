/** The checkbox of a ticket: the box per status, its words, and the edit of one box in a file. */

import type { ItemStatus } from './card-types'
import { itemKey, storedKey } from './item-keys'
import { bare, exampleMask, HEADING_LINE, itemsAt } from './todo-markdown'

const BOXES: Record<ItemStatus, string> = { pending: ' ', queued: '>', in_progress: '~', completed: 'x' }
export const STATUS_WORDS: Record<ItemStatus, string> = { pending: 'open', queued: 'queued', in_progress: 'in progress', completed: 'done' }

/**
 * What the board drew for an item: its text, the status of its box in the file, and (when the scan
 * knew it) its place: the heading path and section above the line, its rank there, and the count of
 * lines with its key (`linePlaces`). For a line with no ID that shares its key with another line,
 * `sum` is the hash of the whole text the board read: any edit of the file refuses the press.
 */
export type DrawnItem = { text: string; status: ItemStatus; place?: string; sum?: string }

/** The place of a drawn line, as the board keeps it from the parse that drew the item. */
export type DrawnPlace = { place: string; sum?: string }

/**
 * Test only: the board reads the sum through `drawnPlaces`.
 * A short hash of a text (FNV-1a, 32 bits, and the length), with every checkbox read as open: tells the
 * text the board read from one where a line moved. A box set by a press on one of two identical
 * lines does not change it, so the other line stays pressable before the next scan.
 */
export function textSum(markdown: string): string {
  const text = markdown.replace(/^(\s*[-*+] )\[[ xX~>]\]/gm, '$1[ ]')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return `${hash.toString(16)}:${text.length}`
}

/**
 * Exported for the tests; the board reads the same places through `drawnPlaces`.
 * The place of each item line by its key: the full path of headings above it
 * outside code fences and HTML comments (empty before the first heading), with the index of that
 * path's occurrence in the file, so two sections under the same heading text differ; its rank among
 * the lines of the same key (without the place number) in that section; and how many lines of the
 * file share its key. Sections marked only by prose lines (`Frontend:`) have no heading:
 * there the count tells a press that one of two identical lines went (or one was added), and the
 * press is refused. A line with identical twins also holds its previous and next non-blank lines, so
 * twins reordered with the same count (two blocks swapped, one deleted and a copy added) refuse a stale
 * press. A key that is unique in the file skips the place check (`isSame`), so an
 * edit elsewhere, a parent heading added too, never refuses it.
 */
export function linePlaces(markdown: string): Map<string, string> {
  const lines = markdown.split('\n').map(bare)
  const isExample = exampleMask(lines)
  const sectionAt: string[] = []
  // The open headings by level (index 0 is level 1), and how often each full path has opened so far.
  const path: string[] = []
  const opened = new Map<string, number>()
  let section = ''
  lines.forEach((line, at) => {
    const m = isExample[at] === true ? null : HEADING_LINE.exec(line)
    if (m !== null) {
      const level = m[1]!.length
      path.length = Math.min(path.length, level - 1)
      while (path.length < level - 1) {
        path.push('')
      }
      path.push(line.trim())
      const name = path.join('\u0001')
      const nth = (opened.get(name) ?? 0) + 1
      opened.set(name, nth)
      section = `${name}\u0002${nth}`
    }
    sectionAt.push(section)
  })
  const found = itemsAt(lines)
  // Counted by key alone, not by box too: a press that sets the box of one of two identical lines then never
  // refuses a press on the other before the next scan.
  const sameKey = new Map<string, number>()
  for (const one of found) {
    const base = storedKey(itemKey(one.item))
    sameKey.set(base, (sameKey.get(base) ?? 0) + 1)
  }
  const ranks = new Map<string, number>()
  const places = new Map<string, string>()
  for (const one of found) {
    const key = itemKey(one.item)
    const group = `${sectionAt[one.at]!}\0${storedKey(key)}`
    const rank = (ranks.get(group) ?? 0) + 1
    ranks.set(group, rank)
    const twins = sameKey.get(storedKey(key))!
    // A line with identical twins also carries the lines drawn around it: two blocks swapped, or one deleted
    // and a copy added, keep the count and the rank, but not the neighbors, so a stale press is refused.
    places.set(key, `${sectionAt[one.at]!}\0${rank}\0${twins}${twins > 1 ? `\0${neighbors(lines, one.at)}` : ''}`)
  }

  return places
}

/**
 * The previous and the next non-blank lines around line `at` (empty at the file's ends), each with its
 * box read as open: a press that sets the box of one of two identical lines changes no neighbor of the
 * other, so it never refuses a press on the other before the next scan (as the count by key alone).
 */
function neighbors(lines: readonly string[], at: number): string {
  const drawn = (index: number) => lines[index]!.replace(/^(\s*[-*+] )\[[ xX~>]\]/, '$1[ ]').trimEnd()
  let before = at - 1
  while (before >= 0 && lines[before]!.trim() === '') {
    before -= 1
  }
  let after = at + 1
  while (after < lines.length && lines[after]!.trim() === '') {
    after += 1
  }

  return `${before < 0 ? '' : drawn(before)}\u0003${after >= lines.length ? '' : drawn(after)}`
}

/**
 * The places the board keeps for one read of a file, by key: each line's place
 * (`linePlaces`), and for a line with no ID whose key another line shares, the hash of the text
 * (`textSum`). In sections marked by prose lines (`Frontend:`) one identical line can go and another
 * come elsewhere with the count and the rank unchanged; only the text tells.
 */
export function drawnPlaces(markdown: string): Map<string, DrawnPlace> {
  const places = linePlaces(markdown)
  const sum = textSum(markdown)
  const out = new Map<string, DrawnPlace>()
  const noId = new Set(itemsAt(markdown.split('\n')).filter(one => one.item.id === undefined).map(one => itemKey(one.item)))
  for (const [key, place] of places) {
    out.set(key, noId.has(key) && countOf(place) > 1 ? { place, sum } : { place })
  }

  return out
}

/** The count of lines that share a key: the third part of a place (`linePlaces`); the neighbors of twins may follow it. */
const countOf = (place: string | undefined): number => Number(place?.split('\0')[2] ?? Number.NaN)

/**
 * True when the line `hit` names is the drawn one: the same text and box, and the same place when the
 * board knew it. A key that is unique in the file, then and now, needs no place: an edit
 * elsewhere (a parent heading added) never refuses it. A drawn `sum` must match the text now.
 */
function isSame(markdown: string, key: string, hit: { item: { text: string; status: ItemStatus } }, drawn: DrawnItem): boolean {
  if (hit.item.text !== drawn.text || hit.item.status !== drawn.status) {
    return false
  }
  if (drawn.sum !== undefined && textSum(markdown) !== drawn.sum) {
    return false
  }
  if (drawn.place === undefined) {
    return true
  }
  const now = linePlaces(markdown).get(key)

  return now === drawn.place || (countOf(now) === 1 && countOf(drawn.place) === 1)
}

/**
 * True when the line `key` names in the file still has the text and box the board drew (,
 * ), and, when the board knew it, the same place: the heading above it and its rank under it.
 * The place number of identical lines moves when a line is added or removed above them, so a press
 * from a board that is out of date could name the neighbor line, also one in another section: this
 * check refuses it.
 */
export function isDrawnLine(markdown: string, key: string, drawn: DrawnItem): boolean {
  const hit = itemsAt(markdown.split('\n')).find(one => itemKey(one.item) === key)

  return hit !== undefined && isSame(markdown, key, hit, drawn)
}

/**
 * The todo file with one item's box set to `status`: the first checkbox line, outside code fences, whose item has `key`.
 * Undefined when no line has it, its box already says so, or (with `drawn`) it is not the line the board drew.
 */
export function setBox(markdown: string, key: string, status: ItemStatus, drawn?: DrawnItem): string | undefined {
  const lines = markdown.split('\n')
  // Read as the parser reads the whole file: a fenced line is no item, and a line that only names another ticket has no ID of its own.
  const hit = itemsAt(lines).find(one => itemKey(one.item) === key)
  const line = hit === undefined ? undefined : lines[hit.at]
  if (hit === undefined || line === undefined || hit.item.status === status) {
    return undefined
  }
  if (drawn !== undefined && !isSame(markdown, key, hit, drawn)) {
    return undefined
  }
  lines[hit.at] = line.replace(/\[[ xX~>]\]/, `[${BOXES[status]}]`)

  return lines.join('\n')
}

const STATUS_NAMES: Readonly<Record<string, ItemStatus>> = { open: 'pending', queued: 'queued', in_progress: 'in_progress', done: 'completed' }

/**
 * The status a move_ticket `to` names, or undefined for any other value. An own key only:
 * a plain-object lookup gives `constructor`, `toString` or `__proto__` a value, and the box the file
 * got was `[undefined]`.
 */
export function statusNamed(to: unknown): ItemStatus | undefined {
  return typeof to === 'string' && Object.hasOwn(STATUS_NAMES, to) ? STATUS_NAMES[to] : undefined
}
