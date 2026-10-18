/**
 * The block structure of a todo file, as CommonMark reads it: list items, block quotes, paragraphs,
 * headings, code fences, indented code and HTML blocks, so the mod knows which checkbox lines are
 * examples. `todo-markdown.ts` re-exports what its callers use, so they import the grammar from one place.
 */

import { htmlEnds, htmlStart, isBlankLine, type HtmlEnd } from './html-blocks'

/** A checkbox line: a list marker, a box (` `, `x`, `X`, `~`, `>`), then the text. U+2028 and U+2029 are text in it, never line ends (UCR-201). */
export const CHECKBOX = /^\s*[-*+] \[([ xX~>])\]\s+([^\r\n]*)$/
/** A code fence line: up to 3 spaces, then 3+ backticks or 3+ tildes, then the rest. */
export const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** An open code fence: its character and the length of its opening run. */
export interface Fence {
  char: string
  len: number
}

/** The fence a line opens, if any: a backtick fence's info string may not hold a backtick (CommonMark). */
export function fenceOpens(line: string): Fence | undefined {
  const m = FENCE.exec(line)
  if (m === null || (m[1]![0] === '`' && m[2]!.includes('`'))) {
    return undefined
  }

  return { char: m[1]![0]!, len: m[1]!.length }
}

/** True when the line closes `open`: the same character, at least as long, and nothing else but spaces. */
function fenceCloses(line: string, open: Fence): boolean {
  const m = FENCE.exec(line)

  return m !== null && m[1]![0] === open.char && m[1]!.length >= open.len && isBlankLine(m[2]!)
}

/** The fence state after one line: opens, closes or keeps. */
export const fenceStep = (line: string, open: Fence | undefined): Fence | undefined => (open === undefined ? fenceOpens(line) : fenceCloses(line, open) ? undefined : open)

/** The line without a trailing carriage return: a CRLF file matches like an LF one. */
export const bare = (line: string): string => line.replace(/\r$/, '')

/** Per line: true for a code fence line and for every line inside a fence. Such lines are never items or headings. */
export function fenceMask(lines: readonly string[]): boolean[] {
  let open: Fence | undefined

  return lines.map(line => {
    const was = open
    open = fenceStep(line, open)

    return was !== undefined || open !== undefined
  })
}

/** The tab stop (CommonMark): a tab moves to the next column that is a multiple of 4. */
const TAB_STOP = 4

/**
 * The line with every tab expanded to spaces, up to the next multiple of TAB_STOP (CommonMark, UCR-141),
 * so the indent and column math counts a tab as the columns it fills: `\t<!--` under `- [ ] #T1 parent`
 * is a comment as `    <!--` is. For that math only: the mask gives one flag per line, never the text.
 */
export function expandTabs(line: string): string {
  if (!line.includes('\t')) {
    return line
  }
  let out = ''
  for (const char of line) {
    out += char === '\t' ? ' '.repeat(TAB_STOP - (out.length % TAB_STOP)) : char
  }

  return out
}

/** A block quote marker (CommonMark): up to 3 spaces of indent, then `>`. */
const QUOTE_START = /^ {0,3}>/
/** A list item's first line: its indent, its marker (`-`, `*`, `+`, `1.`, `1)`), and the spaces after it. */
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)/
/** An ATX heading line (`## Title`), up to 3 spaces of indent. */
const ATX_HEADING = /^ {0,3}#{1,6}(?: |$)/
/** A setext heading underline (`===` or `---`), which ends the paragraph above it. */
const SETEXT_LINE = /^ {0,3}(?:=+|-+) *$/
/** A thematic break (`---`, `* * *`, `___`): it ends a paragraph and is no list item. */
const THEMATIC_BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/
/** A checkbox list item's start on a line cut at its container's content column (the deliberate exception below). */
const BOX_ITEM = /^ *[-*+] \[[ xX~>]\]\s/

/** The indent past a content column that makes a line indented code (CommonMark, UCR-198). */
const CODE_INDENT = 4

/** The spaces of a line from `column` on. */
const spacesFrom = (line: string, column: number): number => /^ */.exec(line.slice(column))![0].length

/**
 * The content column after a block quote marker at `column` (up to 3 spaces, `>`, and one optional
 * space), or undefined when the line has no marker there. A tab after `>` is already spaces (expandTabs),
 * and CommonMark takes one column of it, as here.
 */
function quoteAfter(line: string, column: number): number | undefined {
  const m = QUOTE_START.exec(line.slice(column))
  if (m === null) {
    return undefined
  }
  const at = column + m[0].length

  return line[at] === ' ' ? at + 1 : at
}

/**
 * The content column of a list item line cut at its container's column (CommonMark), from its
 * LIST_ITEM match: the marker's end plus the spaces after it, or one space when there are 5 or more
 * (the rest is indented code) or none (the line ends there).
 */
function contentColumn(m: RegExpExecArray): number {
  const marker = m[1]!.length + m[2]!.length
  const gap = m[3]!.length

  return marker + (gap === 0 || gap > 4 ? 1 : gap)
}

/**
 * An open container: a list item (its content column, and whether it holds anything: CommonMark lets an
 * item start with at most one blank line) or a block quote (UCR-203). Columns count from the line start.
 */
type Container = { kind: 'item'; column: number; hasContent: boolean } | { kind: 'quote' }

/** The open leaf block, the one the next line may go on: none, a paragraph, indented code, an HTML block (with its end), or a fence at its container's column. */
type Leaf = { kind: 'none' | 'paragraph' | 'code' } | { kind: 'html'; end: HtmlEnd } | { kind: 'fence'; fence: Fence }

const NO_LEAF: Leaf = { kind: 'none' }

/** True when a block quote is among the containers: every line in it is an example. */
const isInQuote = (containers: readonly Container[]): boolean => containers.some(one => one.kind === 'quote')

/**
 * Per line: true for a line that is an example, never an item: a code fence line or a line inside a
 * fence, a line of an HTML block of any of the 7 CommonMark types (UCR-024, UCR-203), a line of
 * indented code (UCR-198), and every line of a block quote (UCR-203). The lines are read as CommonMark
 * reads blocks (UCR-203 to UCR-205), with list items and block quotes as containers:
 *
 * - Each open list item holds a line that is blank or indented to its content column; each open block
 *   quote holds a line with a `>` marker (up to 3 spaces in) at its column. The line's indent is measured
 *   from the content column of the innermost container that holds it (UCR-106, UCR-140), and a tab
 *   counts to the next multiple of 4 (UCR-141).
 * - A line that is not held by every open container closes the ones it is not, and the fence, HTML
 *   block or indented code in them (UCR-205: an unclosed `<!--` in an item ends with the item). The
 *   exception is a lazy line: a line that goes on an open paragraph and starts no block keeps every
 *   container open (UCR-204), so a wrapped line under a ticket never ends the ticket, and a line right
 *   under a quote's paragraph is in the quote.
 * - Indented code is a line 4 or more columns past that content column that does not go on a
 *   paragraph: on the first line, after a blank line, a heading, an HTML block, a closed fence, or a
 *   thematic break (UCR-203). It runs on through blank lines to a line indented less.
 * - A fence opens and closes on a line with up to 3 spaces of indent. An HTML block starts on a line
 *   whose content starts as `html-blocks.ts` gives (up to 3 spaces, then `<!--`, `<div`, `<details>`, a
 *   lone tag, and so on), and runs to its end: types 1 to 5 to the line that holds their end mark, the
 *   start line included; types 6 and 7 to the next blank line. A lone tag (type 7) never interrupts a
 *   paragraph. A `<` in the middle of a line opens nothing (UCR-106). A fence inside an HTML block, or
 *   an HTML block inside a fence, opens nothing.
 *
 * Deliberate differences from CommonMark, each kept on purpose:
 * - A checkbox item indented 4 or more past its container right under a paragraph line starts an item
 *   (CommonMark: paragraph text). It is how an over-indented subtask is written, and hiding it would
 *   drop a real ticket with no message. It does not hold under a block quote's paragraph: there the
 *   line is lazy quote text, as in CommonMark.
 * - A list item in a block quote is no item: a quote holds examples and citations, never tickets.
 * - An item's first line counts as one line: `- - [ ] x` is no checkbox line (the CHECKBOX grammar).
 *
 * The dedup, the parser, the numbering and Consolidate's renaming read lines through this mask.
 */
export function exampleMask(lines: readonly string[]): boolean[] {
  const containers: Container[] = []
  let leaf: Leaf = NO_LEAF

  /**
   * The blocks a line opens at `column` (the content column of the innermost container that holds it),
   * and whether it is an example. `isOnParagraph`: an open paragraph in that container may take the
   * line. `isAfterLazy`: a paragraph is open in an item the line left (it is no lazy line), so only the
   * over-indented checkbox item rule applies. Mutates `containers` and `leaf`, the parser state of this call.
   */
  const open = (line: string, column: number, isOnParagraph: boolean, isAfterLazy = false): boolean => {
    let at = column
    let isPara = isOnParagraph
    for (;;) {
      const rest = line.slice(at)
      if (isBlankLine(rest)) {
        // An item or a quote with nothing after its marker: no leaf yet.
        leaf = NO_LEAF

        return false
      }
      if (spacesFrom(line, at) >= CODE_INDENT) {
        if ((isPara || (isAfterLazy && at === column)) && BOX_ITEM.test(rest)) {
          // The deliberate exception: an over-indented checkbox item under a paragraph line is an item.
          const m = LIST_ITEM.exec(rest)!
          containers.push({ kind: 'item', column: at + contentColumn(m), hasContent: true })
          leaf = { kind: 'paragraph' }

          return false
        }
        if (isPara) {
          // Paragraph text: indented code never interrupts a paragraph.
          return false
        }
        leaf = { kind: 'code' }

        return true
      }
      const quoted = quoteAfter(line, at)
      if (quoted !== undefined) {
        containers.push({ kind: 'quote' })
        at = quoted
        isPara = false
        continue
      }
      const fence = fenceOpens(rest)
      if (fence !== undefined) {
        leaf = { kind: 'fence', fence }

        return true
      }
      const html = htmlStart(rest, isPara)
      if (html !== undefined) {
        // The end condition is checked on the start line too: `<!-- note -->` and `<!-->` end where they start.
        leaf = html !== 'blank' && htmlEnds(rest, html) ? NO_LEAF : { kind: 'html', end: html }

        return true
      }
      if (ATX_HEADING.test(rest) || (isPara && SETEXT_LINE.test(rest)) || THEMATIC_BREAK.test(rest)) {
        leaf = NO_LEAF

        return false
      }
      const m = LIST_ITEM.exec(rest)
      const isEmpty = m !== null && isBlankLine(rest.slice(m[0].length))
      // An item that interrupts a paragraph has content, and an ordered one starts at 1 (CommonMark).
      if (m !== null && (!isPara || (!isEmpty && (!/^\d/.test(m[2]!) || parseInt(m[2]!, 10) === 1)))) {
        at += contentColumn(m)
        containers.push({ kind: 'item', column: at, hasContent: !isEmpty })
        isPara = false
        continue
      }
      leaf = { kind: 'paragraph' }

      return false
    }
  }

  /** The line's flag by the leaf and container rules above, before the quote rule. */
  const step = (line: string): boolean => {
    // The containers that hold the line, outermost first, and the column its content starts at.
    let held = 0
    let column = 0
    while (held < containers.length) {
      const one = containers[held]!
      if (one.kind === 'quote') {
        const at = quoteAfter(line, column)
        if (at === undefined) {
          break
        }
        column = at
      } else if (isBlankLine(line.slice(column)) ? one.hasContent : column + spacesFrom(line, column) >= one.column) {
        column = one.column
      } else {
        break
      }
      held += 1
    }
    const isBlank = isBlankLine(line.slice(column))
    if (held === containers.length) {
      if (!isBlank) {
        containers.forEach(one => one.kind === 'item' && (one.hasContent = true))
      }
      if (leaf.kind === 'fence') {
        if (!isBlank && fenceCloses(line.slice(column), leaf.fence)) {
          leaf = NO_LEAF
        }

        return true
      }
      if (leaf.kind === 'html') {
        const end = leaf.end
        if (htmlEnds(line.slice(column), end)) {
          leaf = NO_LEAF

          // A blank line that ends a type 6 or 7 block is not in it.
          return end !== 'blank'
        }

        return true
      }
      if (leaf.kind === 'code') {
        if (isBlank) {
          // A blank line keeps indented code open: it ends at the next line that is not indented enough.
          return false
        }
        if (spacesFrom(line, column) >= CODE_INDENT) {
          return true
        }
        leaf = NO_LEAF
      }
      if (isBlank) {
        leaf = NO_LEAF

        return false
      }

      return open(line, column, leaf.kind === 'paragraph')
    }
    // A lazy line (UCR-204): it goes on the open paragraph of a container it is not in, and keeps every container open.
    const wasParagraph = leaf.kind === 'paragraph'
    const isQuoteParagraph = wasParagraph && isInQuote(containers)
    if (wasParagraph && !isBlank && isLazy(line, column, isQuoteParagraph)) {
      return false
    }
    // The line ends the containers that do not hold it, and the leaf block in them (UCR-205).
    containers.length = held
    leaf = NO_LEAF
    if (isBlank) {
      return false
    }
    containers.forEach(one => one.kind === 'item' && (one.hasContent = true))

    return open(line, column, false, wasParagraph && !isQuoteParagraph)
  }

  // Every line in a block quote, a lazy one included, is an example (UCR-203).
  return lines.map(raw => step(expandTabs(raw)) || isInQuote(containers))
}

/**
 * True when a line that an open container does not hold goes on that container's paragraph (a lazy
 * continuation line, CommonMark): read at `column` (the innermost container that holds it), it starts
 * no block. An item, a quote, a heading, a fence, an HTML block of types 1 to 6 or a thematic break ends
 * the paragraph; a setext underline does not (it is text there), and neither does an ordered item that
 * does not start at 1 (CommonMark checks that rule only against a paragraph of the item itself).
 * `isQuoteParagraph`: the paragraph is in a block quote, where an over-indented checkbox line is text.
 */
function isLazy(line: string, column: number, isQuoteParagraph: boolean): boolean {
  const rest = line.slice(column)
  if (spacesFrom(line, column) >= CODE_INDENT) {
    // The deliberate exception of exampleMask: an over-indented checkbox item is an item, not text (not in a quote).
    return isQuoteParagraph || !BOX_ITEM.test(rest)
  }

  return (
    fenceOpens(rest) === undefined &&
    quoteAfter(line, column) === undefined &&
    htmlStart(rest, true) === undefined &&
    !ATX_HEADING.test(rest) &&
    !THEMATIC_BREAK.test(rest) &&
    LIST_ITEM.exec(rest) === null
  )
}
