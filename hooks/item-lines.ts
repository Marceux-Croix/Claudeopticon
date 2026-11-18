/**
 * The checkbox line grammar of a todo file by its kind (`todoKind`): which lines are items, their box,
 * text and parts, the box and ID edits, the heading lines, and which lines are examples. A `.md` file
 * reads Markdown checkbox lines only, exactly as before; a `.html` file reads them and HTML checkbox
 * items (`html-items.ts`).
 */

import { htmlItem, HTML_HEADING, looksLikeHtmlCheckbox, withHtmlBox, type HtmlBox } from './html-items'
import { htmlRegionMask } from './html-regions'
import { bare, CHECKBOX, exampleMask, expandTabs, HEADING_LINE } from './markdown-blocks'
import type { TodoKind } from './todo-file-names'

export type { TodoKind } from './todo-file-names'

/**
 * One item line, split: `head` (up to the text: the indent, marker and box, or `<li>` and the tag, and
 * the spaces after), `text` as written, `tail` (after the text: `</li>` and its spaces; empty for a
 * Markdown line). `isHtml` for an HTML item. `head + text + tail` is the line.
 */
export interface ItemParts {
  box: string
  head: string
  text: string
  tail: string
  isHtml: boolean
}

/** The line as an item of a file of `kind`, or undefined. A Markdown checkbox line is one in either kind; an HTML item only in a `.html` file. */
export function itemParts(line: string, kind: TodoKind): ItemParts | undefined {
  const m = CHECKBOX.exec(line)
  if (m !== null) {
    const text = m[2] ?? ''

    return { box: m[1]!, head: line.slice(0, line.length - text.length), text, tail: '', isHtml: false }
  }
  const html = kind === 'html' ? htmlItem(line) : undefined

  return html === undefined ? undefined : { box: html.box, head: html.head, text: html.text, tail: html.tail, isHtml: true }
}

/** True for an item line of a file of `kind`. */
export const isItemLine = (line: string, kind: TodoKind): boolean => itemParts(line, kind) !== undefined

/** True for a line that is, or looks like, a checkbox: a Markdown box (`- [?]`), or in a `.html` file an input of type checkbox. */
export const looksLikeItem = (line: string, kind: TodoKind): boolean => /^\s*[-*+] \[[^\]]*\]/.test(line) || (kind === 'html' && looksLikeHtmlCheckbox(line))

/**
 * The line with its item's box set to `box` (` `, `x`, `~`, `>`); the line as it is when it is no item.
 * A Markdown line changes its first `[?]`; an HTML item changes only its input tag, to the canonical one.
 * `line` may end in a carriage return: it stays.
 */
export function withBox(line: string, kind: TodoKind, box: HtmlBox): string {
  const html = kind === 'html' && !CHECKBOX.test(bare(line)) ? htmlItem(line) : undefined

  return html === undefined ? line.replace(/\[[ xX~>]\]/, `[${box}]`) : withHtmlBox(line, html, box)
}

/** The line with its box read as open (a Markdown box `[ ]`, an HTML item's canonical open tag): for the sums and neighbors of the board. */
export function openedLine(line: string, kind: TodoKind): string {
  const md = line.replace(/^(\s*[-*+] )\[[ xX~>]\]/, '$1[ ]')
  if (kind !== 'html' || md !== line) {
    return md
  }
  const html = htmlItem(line)

  return html === undefined ? line : withHtmlBox(line, html, ' ')
}

/**
 * The line with `id` put at the start of its item text (``); `line` may end in a carriage return.
 * A Markdown line gets it right after the box and its spaces, as it always did; an HTML item right after
 * the input tag and its spaces. Any other line stays as it is.
 */
export function withLeadingId(line: string, kind: TodoKind, id: string): string {
  const parts = kind === 'html' ? itemParts(bare(line), kind) : undefined

  return parts?.isHtml === true ? `${line.slice(0, parts.head.length)}#${id} ${line.slice(parts.head.length)}` : line.replace(/^(\s*[-*+] \[[ xX~>]\]\s+)/, `$1#${id} `)
}

/** The level (1 to 6) of a heading line of a file of `kind`: an ATX heading, or in a `.html` file an `<hN>` line. Undefined for no heading. */
export function headingLevel(line: string, kind: TodoKind): number | undefined {
  const m = HEADING_LINE.exec(line)
  if (m !== null) {
    return m[1]!.length
  }
  const h = kind === 'html' ? HTML_HEADING.exec(line) : null

  return h === null ? undefined : Number(h[1])
}

/**
 * Per line: true for an example, never an item or a heading. A `.md` file: `exampleMask` (CommonMark).
 * A `.html` file: a Markdown checkbox or ATX heading line keeps the CommonMark rule, as in a `.md` file,
 * and is an example in an HTML comment or raw element too (one opened mid-line is no HTML block);
 * every other line (an HTML item, an `<hN>` heading, a tag, text) is an example only in an HTML comment
 * or a `<pre>`, `<script>`, `<style>` or `<textarea>` element (`htmlRegionMask`). So an HTML block, an
 * indent or a code fence never hides an HTML item, as a browser shows it.
 */
export function lineMask(lines: readonly string[], kind: TodoKind): boolean[] {
  const md = exampleMask(lines)
  if (kind !== 'html') {
    return md
  }
  const regions = htmlRegionMask(lines)

  // A Markdown line is an example by either rule: a comment opened mid-line (`text <!--`) is no HTML block, so only the regions see it.
  return lines.map((line, at) => (CHECKBOX.test(line) || HEADING_LINE.test(line) ? md[at]! || regions[at]! : regions[at]!))
}

/** The indent of a line in columns, a tab to the next multiple of 4. */
export const indentOf = (line: string): number => /^ */.exec(expandTabs(/^[ \t]*/.exec(line)![0]))![0].length
