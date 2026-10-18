/** The category book: its file shape, the sort prompt, the reply, the change test, and the grouping and filter of the view. */

import { altText, cutUnits } from './card-text'
import { storedKey } from './item-keys'
import type { FileView, ItemStatus } from './card-types'

/**
 * Categories Claude gives the open items, kept in `categories.json` in the primary `.claude_todo/`
 * folder (the first folder when none is primary); items of other folders carry their folder in the
 * key. An item keeps the
 * category it was first given; new categories are made only while there are fewer than five.
 */
export type CategoryBook = { categories: string[]; items: Record<string, string> }

/**
 * A book's item map with no prototype: its keys are normalized ticket text, so a
 * no-ID ticket named `constructor`, `__proto__` or `toString` must be its own key, never a name that
 * Object.prototype answers. Every items map is built here; a key holds a string or nothing.
 */
export function bookItems(entries: Iterable<readonly [string, string]> = []): Record<string, string> {
  const out = Object.create(null) as Record<string, string>
  for (const [key, name] of entries) {
    out[key] = name
  }

  return out
}

/** An empty book: no categories, no items (a null-prototype map, bookItems). */
export const emptyBook = (): CategoryBook => ({ categories: [], items: bookItems() })

/** The category the book gives `key`: an own string entry only, so a prototype name never reads as a category. */
export function categoryOf(current: CategoryBook, key: string): string | undefined {
  if (!Object.hasOwn(current.items, key)) {
    return undefined
  }
  const name = current.items[key]

  return typeof name === 'string' ? name : undefined
}

/**
 * The group the view puts `key` in: its category when the book lists that category, else UNSORTED.
 * A ticket whose entry names no listed category (a prototype name before , or a hand edit)
 * still draws, under Not sorted yet, and is never dropped from the view.
 */
export function groupOf(current: CategoryBook, key: string): string {
  const name = categoryOf(current, key)

  return name !== undefined && current.categories.includes(name) ? name : UNSORTED
}

export const MAX_CATEGORIES = 5
export const UNSORTED = 'Not sorted yet'
export const SORT_BATCH = 60
/** The most batches one sort runs back to back. */
export const SORT_BATCHES = 5
export const SORT_EVERY_MS = 30_000
export const SORT_MODEL = 'haiku'
/** After this many failed attempts an item is not sent again until its text changes. */
export const SORT_TRIES = 2

/**
 * The book in the text of `categories.json`, or undefined when the text is not a book: not
 * JSON, or JSON of another shape (a list, a string, a key spelled wrong, `categories` not a list of
 * names, `items` not a map of names). The caller keeps a copy of such a file before it starts over.
 * Only the first MAX_CATEGORIES categories are kept.
 */
export function readBook(raw: string): CategoryBook | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  const { categories, items } = parsed as { categories?: unknown; items?: unknown }
  const isNames = Array.isArray(categories) && categories.every(name => typeof name === 'string')
  const isMap = typeof items === 'object' && items !== null && !Array.isArray(items) && Object.values(items).every(name => typeof name === 'string')

  if (!isNames || !isMap) {
    return undefined
  }
  // A name is drawn as a Button label, which the engine refuses with a control character in it:
  // names are cleaned here, and an item's category with them, so the two stay equal. A name that
  // cleans to nothing, or to one already held, is dropped.
  const clean = [...new Set((categories as string[]).map(altText).filter(name => name !== ''))].slice(0, MAX_CATEGORIES)
  // JSON.parse makes "__proto__" an own key; bookItems keeps it one (a plain object would take it as the prototype).
  const cleanItems = bookItems(
    Object.entries(items as Record<string, string>)
      .map(([key, name]): [string, string] => [key, altText(name)])
      .filter(([, cleaned]) => cleaned !== ''),
  )

  return { categories: clean, items: cleanItems }
}

/** The most copies of damaged books kept side by side. */
export const BOOK_BACKUPS = 10

/**
 * The names a copy of a damaged book may take, in order: `categories.json.bak`, then
 * `categories.json.bak.2` up to BOOK_BACKUPS. The caller takes the first name with nothing at it, so
 * an older copy is never written over and a symlink at a name is never written through.
 */
export function bookBackups(path: string): string[] {
  return Array.from({ length: BOOK_BACKUPS }, (_, i) => (i === 0 ? `${path}.bak` : `${path}.bak.${i + 1}`))
}

export function sortPrompt(categories: readonly string[], texts: readonly string[]): string {
  return [
    `Sort these todo items from one software project into categories. Use at most ${MAX_CATEGORIES} categories in all.`,
    categories.length === 0
      ? 'There are no categories yet: make them from the items, so that together they cover the whole project.'
      : `Existing categories, which you must keep: ${JSON.stringify(categories)}. Add a new one only while there are fewer than ${MAX_CATEGORIES}.`,
    'A category name is 1 to 3 words, in sentence case.',
    '',
    'Items:',
    ...texts.map((text, i) => `${i + 1}. ${cutUnits(text, 160)}`),
    '',
    'Reply with JSON only: {"categories": [every category name], "assign": {"1": "Category", "2": "Category", ...}}. Give every item exactly one category from the list.',
  ].join('\n')
}

/**
 * Reads the model's reply into the book: existing categories stay first and unchanged, new ones are
 * kept up to five, and an item assigned to no listed category is left for the next sort.
 */
export function applySortReply(current: CategoryBook, keys: readonly string[], reply: string): CategoryBook | undefined {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return undefined
  }
  const record = parsed as { categories?: unknown; assign?: unknown }
  const proposed = Array.isArray(record.categories) ? record.categories.filter((name): name is string => typeof name === 'string' && altText(name) !== '') : []
  const categories = [...current.categories]
  for (const name of proposed.map(one => cutUnits(altText(one), 40))) {
    if (categories.length < MAX_CATEGORIES && !categories.includes(name)) {
      categories.push(name)
    }
  }
  const items = bookItems(Object.entries(current.items))
  const assign = typeof record.assign === 'object' && record.assign !== null ? (record.assign as Record<string, unknown>) : {}
  keys.forEach((key, i) => {
    const number = String(i + 1)
    const name = Object.hasOwn(assign, number) ? assign[number] : undefined
    if (!Object.hasOwn(items, key) && typeof name === 'string' && categories.includes(altText(name))) {
      items[key] = altText(name)
    }
  })

  return { categories, items }
}

/**
 * The book with only the items that `isKept` holds: a ticket deleted from every todo file
 * leaves the book with the next write, so `categories.json` never grows without limit and never
 * keeps the text of a deleted ticket (a key with no ID is the ticket's normalized text). The caller
 * passes `isKept` undefined when a folder or file did not read: an item there is not known to be
 * gone, so nothing is dropped. The categories stay as they are.
 */
export function pruneBookItems(current: CategoryBook, isKept: ((key: string) => boolean) | undefined): CategoryBook {
  if (isKept === undefined) {
    return current
  }
  const items = bookItems(Object.entries(current.items).filter(([key]) => isKept(key)))

  return Object.keys(items).length === Object.keys(current.items).length ? current : { categories: current.categories, items }
}

/**
 * Which book keys a write keeps, given the keys the read files hold (`held`) and the
 * folders that read this scan: `others`, the places (`rel`) of the other folders, which qualify
 * their keys as `<place>::<key>`, and `hasPrimary`, whether the primary folder (unqualified keys)
 * read. A key is dropped only when its folder read and does not hold it. A key of a folder that
 * this discovery left out (git failed, an exists check failed, a symlinked file) is kept: its
 * item is not known to be gone. A key whose qualifier is no folder read is taken as such a folder's
 * when the qualifier ends in `.claude_todo`, so an unqualified key with `::` in its text stays
 * the primary folder's.
 */
export function bookKeptBy(held: ReadonlySet<string>, read: { others: readonly string[]; hasPrimary: boolean }): (key: string) => boolean {
  return key => {
    if (held.has(key)) {
      return true
    }
    if (read.others.some(place => key.startsWith(`${place}::`))) {
      return false
    }
    const cut = key.indexOf('::')
    if (cut > 0 && /(?:^|\/)\.claude_todo$/.test(key.slice(0, cut))) {
      return true
    }

    return !read.hasPrimary
  }
}

/**
 * The categories a Recategorize keeps, in the fresh order: each one a covered ticket holds
 * in the fresh sort, and each one an open ticket past the covered ones (`rest`) holds in the saved
 * book, since mergeRecategorized keeps that assignment. A category no ticket holds is dropped, so
 * it does not count as a group.
 */
export function usedCategories(old: CategoryBook, fresh: CategoryBook, covered: readonly string[], rest: readonly string[]): string[] {
  const used = new Set<string>()
  for (const key of covered) {
    const name = categoryOf(fresh, key)
    if (name !== undefined) {
      used.add(name)
    }
  }
  for (const key of rest) {
    const name = categoryOf(old, key)
    if (name !== undefined) {
      used.add(name)
    }
  }

  return fresh.categories.filter(name => used.has(name))
}

/**
 * The book a Recategorize keeps: the fresh assignments of the tickets it covered, and the
 * saved assignment of every other ticket whose category is still in the fresh list. A ticket whose
 * old category is gone is left unsorted, so the normal sort puts it into the new categories; an
 * assignment to a category that is not in the list would hide the ticket from every group.
 */
export function mergeRecategorized(old: CategoryBook, fresh: CategoryBook, covered: readonly string[]): CategoryBook {
  const isCovered = new Set(covered)
  const names = new Set(fresh.categories)
  const items = bookItems()
  for (const [key, name] of Object.entries(old.items)) {
    if (!isCovered.has(key) && names.has(name)) {
      items[key] = name
    }
  }
  for (const key of covered) {
    const name = categoryOf(fresh, key)
    if (name !== undefined && names.has(name)) {
      items[key] = name
    }
  }

  return { categories: [...fresh.categories], items }
}

/**
 * Whether a fresh sort differs enough from the current categories to be worth applying. Over the
 * given open tickets: true when the number of groups differs, or when at least a quarter of the
 * tickets land in a new group that does not map to their old one. Each new group maps to the old
 * group it shares the most tickets with, one old group to one new group (an unsorted ticket counts as an old group of its own), so
 * a rename alone moves nothing.
 */
export function isSubstantialChange(old: CategoryBook, next: CategoryBook, keys: readonly string[]): boolean {
  const oldOf = (key: string) => {
    const name = categoryOf(old, key)

    return name !== undefined && old.categories.includes(name) ? name : UNSORTED
  }
  const newOf = (key: string) => categoryOf(next, key) ?? UNSORTED
  const groups = (of: (key: string) => string) => new Set(keys.map(of).filter(name => name !== UNSORTED))
  if (groups(oldOf).size !== groups(newOf).size) {
    return true
  }
  // One-to-one: each old group is the match of at most one new group, taken greedily by
  // the number of tickets they share. A new group with no old group left to match moves all its tickets.
  const shared = new Map<string, Map<string, number>>()
  for (const key of keys) {
    const row = shared.get(newOf(key)) ?? new Map<string, number>()
    row.set(oldOf(key), (row.get(oldOf(key)) ?? 0) + 1)
    shared.set(newOf(key), row)
  }
  const pairs = [...shared.entries()].flatMap(([name, row]) => [...row.entries()].map(([was, count]) => ({ name, was, count }))).sort((a, b) => b.count - a.count)
  const mapped = new Map<string, string>()
  const taken = new Set<string>()
  for (const pair of pairs) {
    if (!mapped.has(pair.name) && !taken.has(pair.was)) {
      mapped.set(pair.name, pair.was)
      taken.add(pair.was)
    }
  }
  const moved = keys.filter(key => mapped.get(newOf(key)) !== oldOf(key)).length

  return keys.length > 0 && moved * 4 >= keys.length
}

/**
 * Each file with its items grouped by category under headings: the categories in the order they
 * were made, then the items not sorted yet. Within a category the usual order holds: linked, in
 * progress, open, done.
 */
export function categoryGroups(files: readonly FileView[], current: CategoryBook): FileView[] {
  const rank = (item: { status: ItemStatus; owners: number[] }) =>
    item.owners.length > 0 ? 0 : item.status === 'in_progress' ? 1 : item.status === 'pending' ? 2 : 3
  const names = [...current.categories, UNSORTED]

  return files.map(file => {
    const groups: { name: string; from: number; count: number }[] = []
    const items = names.flatMap(name => {
      const members = file.items.filter(item => groupOf(current, storedKey(item.key)) === name).sort((a, b) => rank(a) - rank(b))
      if (members.length > 0) {
        groups.push({ name, from: groups.reduce((sum, group) => sum + group.count, 0), count: members.length })
      }

      return members
    })

    return { ...file, items, groups }
  })
}

/** The files with the items of hidden categories taken out; a file left with none drops out. */
export function withoutHidden(files: readonly FileView[], current: CategoryBook, hidden: ReadonlySet<string>): FileView[] {
  if (hidden.size === 0) {
    return [...files]
  }

  return files
    .map(file => ({ ...file, items: file.items.filter(item => !hidden.has(groupOf(current, storedKey(item.key)))) }))
    .filter(file => file.items.length > 0)
}

/** The category names the filter offers: the book's, then Not sorted yet when an item has none. */
export function filterNames(files: readonly FileView[], current: CategoryBook): string[] {
  const unsorted = files.some(file => file.items.some(item => groupOf(current, storedKey(item.key)) === UNSORTED))

  return current.categories.length === 0 ? [] : [...current.categories, ...(unsorted ? [UNSORTED] : [])]
}
