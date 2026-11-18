/**
 * The item tree of a todo file: the block of lines a ticket holds (its subtasks and continuation lines),
 * and which item lines are top-level tickets. A Markdown ticket is top-level at indent 0, as it always
 * was; an HTML item (`.html` file) is top-level when no ticket block above it holds it, at any indent, so
 * an item list inside `<ul>` reads as a list of tickets.
 */

import { continuesParagraph } from './markdown-blocks'
import { indentOf, itemParts, type TodoKind } from './item-lines'

/**
 * The end (excluded) of the block of the item at `at`: its line, then the lines under it while each is
 * blank or indented past the item, or goes on the paragraph right above it (a wrapped ticket text,
 * `continuesParagraph`); blank lines after the last such line are not in it. A Markdown item at indent 0
 * keeps the rule it always had (indented means any leading space or tab). An HTML item has no wrapped
 * text: it ends at its own `</li>`. In a `.html` file a line that is only `<ul>`, `<ol>`, `</ul>`
 * or `</ol>` goes on the block when the next non-blank line is indented past the item, and a close goes
 * on it too when it closes a list tag the block took: the usual nesting puts the `<ul>` at the
 * parent `<li>`'s indent.
 */
export function blockEnd(lines: readonly string[], at: number, kind: TodoKind): number {
  const line = lines[at]!
  const isHtml = itemParts(line, kind)?.isHtml === true
  const indent = indentOf(line)
  const isIndented = (k: number): boolean => (isHtml || indent > 0 ? indentOf(lines[k]!) > indent && lines[k]!.trim() !== '' : /^[ \t]+\S/.test(lines[k]!))
  // How many list tags the block opened and has not closed: a `</ul>` that closes one is the block's too.
  let openLists = 0
  const isUnder = (k: number): boolean => {
    if (isIndented(k)) {
      return true
    }
    const list = kind === 'html' ? LIST_TAG.exec(lines[k]!) : null
    if (list === null) {
      return false
    }
    // A list tag at the item's indent (`<li>` then `<ul>` then a deeper `<li>`, the usual nesting) goes on
    // the block when the next non-blank line is indented past the item, or it closes a list the block opened.
    // The blank lines skipped here are the ones the walk takes next, so the block still costs its own lines.
    let next = k + 1
    while (next < lines.length && lines[next]!.trim() === '') {
      next += 1
    }
    const isDeeper = next < lines.length && indentOf(lines[next]!) > indent
    if (list[1] === '/' ? !(isDeeper || openLists > 0) : !isDeeper) {
      return false
    }
    openLists = Math.max(0, openLists + (list[1] === '/' ? -1 : 1))

    return true
  }
  // An HTML item ends at its own `</li>`: prose right under it is no wrapped text of it.
  const isLazy = (k: number): boolean => (isHtml ? false : continuesParagraph(lines[k - 1]!, lines[k]!))
  let end = at + 1
  for (let k = at + 1; k < lines.length && (lines[k]!.trim() === '' || isUnder(k) || isLazy(k)); k += 1) {
    end = lines[k]!.trim() === '' ? end : k + 1
  }

  return end
}

/** A line that is only a list tag: `<ul>` or `<ol>` (attributes allowed), `</ul>` or `</ol>`, any case. Group 1 is `/` for a close. */
const LIST_TAG = /^[ \t]*<(?:(\/)[uo]l[ \t]*|[uo]l(?:[ \t][^<>]*)?)>[ \t]*$/i

/**
 * Per line: true for an item line that is a top-level ticket. `isExample` is the file's mask: an example
 * is no item. A Markdown item is top-level at indent 0 (and its block holds the lines under it); an HTML
 * item is top-level when it is past the block of every top-level ticket above it.
 */
export function topLevelItems(lines: readonly string[], isExample: readonly boolean[], kind: TodoKind): boolean[] {
  const out = new Array<boolean>(lines.length).fill(false)
  let heldUntil = 0
  for (let at = 0; at < lines.length; at += 1) {
    const parts = isExample[at] === true ? undefined : itemParts(lines[at]!, kind)
    if (parts === undefined) {
      continue
    }
    const isTop = parts.isHtml ? at >= heldUntil : /^[-*+] /.test(lines[at]!)
    if (isTop) {
      out[at] = true
      heldUntil = Math.max(heldUntil, blockEnd(lines, at, kind))
    }
  }

  return out
}
