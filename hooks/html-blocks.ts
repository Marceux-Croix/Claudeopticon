/**
 * The HTML block start and end conditions of CommonMark (spec 0.31.2, section 4.6, types 1 to 7), read
 * on a line cut at its container's content column. `markdown-blocks.ts` reads every line of an HTML
 * block as an example, never an item.
 */

/** How an HTML block ends: on the first line that matches (that line is in the block), or at a blank line (not in it). */
export type HtmlEnd = RegExp | 'blank'

/** The tag names of an HTML block of type 6 (CommonMark 0.31.2; markdown-it-py 4 has the same list). */
const BLOCK_TAGS = [
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup', 'dd', 'details',
  'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes',
  'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title',
  'tr', 'track', 'ul',
]

/**
 * A complete open or closing tag alone on its line (type 7), as the spec's grammar gives it. No part can
 * match the same text two ways (a name ends at a space, `=`, `/` or `>`), so a failed match is linear.
 * Any tag name, as commonmark.js 0.31.2 and markdown-it read it: `<pre>` and its kin are type 1 first.
 */
const ATTRIBUTE = String.raw`(?:\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\s*=\s*(?:[^"'=<>\x60\x00-\x20]+|'[^']*'|"[^"]*"))?)`
const LONE_TAG = new RegExp(String.raw`^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*${ATTRIBUTE}*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)\s*$`, 'i')

/** The seven kinds, in the spec's order: the first whose start matches is the block. `interrupts`: it may end a paragraph. */
const KINDS: readonly { start: RegExp; end: HtmlEnd; interrupts: boolean }[] = [
  { start: /^ {0,3}<(?:pre|script|style|textarea)(?:\s|>|$)/i, end: /<\/(?:pre|script|style|textarea)>/i, interrupts: true },
  { start: /^ {0,3}<!--/, end: /-->/, interrupts: true },
  { start: /^ {0,3}<\?/, end: /\?>/, interrupts: true },
  { start: /^ {0,3}<![A-Za-z]/, end: />/, interrupts: true },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/, interrupts: true },
  { start: new RegExp(String.raw`^ {0,3}<\/?(?:${BLOCK_TAGS.join('|')})(?:\s|\/?>|$)`, 'i'), end: 'blank', interrupts: true },
  { start: LONE_TAG, end: 'blank', interrupts: false },
]

/** The start patterns of the seven kinds, in order: for the linearity test (rule: a todo line can be 1 MB). */
export const HTML_STARTS: readonly RegExp[] = KINDS.map(kind => kind.start)

/**
 * The end condition of the HTML block that `rest` (a line cut at its container's content column) starts,
 * or undefined when it starts none. `isOnParagraph`: the line would go on an open paragraph, which only
 * types 1 to 6 may end (CommonMark). The caller checks the end on the start line too: `<!-- note -->`
 * ends where it starts.
 */
export function htmlStart(rest: string, isOnParagraph: boolean): HtmlEnd | undefined {
  const kind = KINDS.find(one => one.start.test(rest))

  return kind === undefined || (isOnParagraph && !kind.interrupts) ? undefined : kind.end
}

/** True when the line ends an open HTML block with end condition `end`: a matching line, or a blank one. */
/** Whether a line is blank in CommonMark terms: only spaces and tabs (trim() also strips NBSP, U+3000 and U+FEFF, which are content). */
export const isBlankLine = (line: string): boolean => /^[ \t\r]*$/.test(line)

export const htmlEnds = (line: string, end: HtmlEnd): boolean => (end === 'blank' ? isBlankLine(line) : end.test(line))
