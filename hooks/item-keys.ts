/** The identity keys of todo files and items, as the pane, the store and the categories use them. */

import { cutUnits } from './card-text'
import { normalize } from './normalize'

/** A file's unique ID in the pane: its folder and its name. */
export function fileId(file: { folder: string; name: string }): string {
  return `${file.folder}/${file.name}`
}

/** A file's path from the repo root, for prompts: `mods/x/.claude_todo/TODO.md`. */
export function filePath(file: { folder: string; rel?: string; name: string }): string {
  return `${file.rel ?? file.folder}/${file.name}`
}

/** An item's key for the categories book: qualified by its folder outside the primary one. */
export function qualifiedKey(file: { rel?: string; folder: string; isOther?: true }, item: { text: string; id?: string }): string {
  return file.isOther === true ? `${file.rel ?? file.folder}::${itemKey(item)}` : itemKey(item)
}

/**
 * An item's stable key: its ID when it has one, else its normalized text. A later line of a file with
 * the same key gets its place too (`nth`, from 2, after a tab, which normalized text never holds), so
 * three identical lines have three keys and a button on the third writes the third.
 */
export function itemKey(item: { text: string; id?: string; nth?: number }): string {
  const base = item.id !== undefined ? `#${item.id.toLowerCase()}` : cutUnits(normalize(item.text), 200)

  return item.nth === undefined ? base : `${base}\t${item.nth}`
}

/**
 * The key a store keeps for an item (the categories book, the orchestrator's tickets): its key without
 * the place number, so the key of the first of identical lines. The place number
 * moves when a line is added or removed above identical lines, so a stored place would name another
 * line after a reload. The rule: identical lines share one stored key, and so one category and one
 * orchestrator claim; nothing stored ever names a line by its place. Presses and moves, which do use
 * the place, check the line's text and box first (`isDrawnLine`).
 */
export const storedKey = (key: string): string => key.replace(/\t\d+$/, '')

/** An item's stored key, qualified by its folder as `qualifiedKey` is (`storedKey`). */
export const keptKey = (file: { rel?: string; folder: string; isOther?: true }, item: { text: string; id?: string; nth?: number }): string => storedKey(qualifiedKey(file, item))
