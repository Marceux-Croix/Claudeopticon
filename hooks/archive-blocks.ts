/** The text work of the archive step: closed blocks, their removal, and where they go in the archive file. */

import { findMainTodo } from './todo-file-names'
import { itemKey, storedKey } from './item-keys'
import { blockEnd, topLevelItems } from './item-tree'
import { bare, FENCE, headingLevel, indentOf, isItemLine, itemParts, itemsAt, lineMask, looksLikeItem, parseTodo, type TodoKind } from './todo-markdown'

/** A closed ticket is moved once it has been closed this long: a mis-click on Mark done can still be undone. */
export const ARCHIVE_AFTER_MS = 5000

/** A closed ticket in a todo file's text: its lines, where they sit (`from` to `to`, end excluded), and the heading above it. */
export type ClosedBlock = { heading?: string; lines: string[]; from: number; to: number }

/** True for a line that is, or looks like, a checkbox that is not done: a line that looks like one but fails the match counts open. */
function isOpenLine(line: string, kind: TodoKind): boolean {
  const box = itemParts(line, kind)?.box
  if (box !== undefined) {
    return box.toLowerCase() !== 'x'
  }

  return looksLikeItem(line, kind)
}

/**
 * The tickets of a todo file that can leave it: a top-level `- [x]` line plus the indented lines
 * under it, when every checkbox in that block is `[x]`. The block runs past blank lines while the
 * next non-blank line is indented, and takes a line that is not indented when it goes on the paragraph
 * right above it (a wrapped ticket text, `continuesParagraph`). The heading is an ATX heading with up
 * to 3 spaces of indent (setext headings are not read). An open or in-progress subtask keeps the whole block, and so does
 * a code fence, HTML or block quote line in it. Prose, headings and tables are never part of a
 * block. Every line `exampleMask` marks (a code fence and its lines, an HTML block, a block quote) is an
 * example: it never starts or joins a block, and is never a heading. The heading is the
 * last heading line above the block (any level), outside examples. A trailing carriage return is
 * ignored, so a CRLF file reads as an LF one; `lines` are without it.
 *
 * A `.html` file (`kind`) also has HTML items: a done one that is a top-level ticket (`topLevelItems`: no
 * ticket block above holds it, at any indent) leaves with the lines indented past it (`blockEnd`), on the
 * same terms; an `<hN>` line is a heading there too.
 */
export function closedBlocks(markdown: string, kind: TodoKind = 'md'): ClosedBlock[] {
  const lines = markdown.split('\n').map(bare)
  const isExample = lineMask(lines, kind)
  const isTop = kind === 'html' ? topLevelItems(lines, isExample, kind) : []
  const blocks: ClosedBlock[] = []
  let heading: string | undefined
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (isExample[i] === true) {
      i += 1

      continue
    }
    const html = isTop[i] === true ? itemParts(line, kind) : undefined
    if (headingLevel(line, kind) !== undefined) {
      heading = line.trim()
    } else if (/^[-*+] \[[xX]\]\s+/.test(line) || (html?.isHtml === true && html.box === 'x')) {
      // The block ends at its last indented line; blank lines after it are not taken. A line that is not indented but
      // goes on the paragraph above it (a wrapped ticket text) is part of the block: an open subtask after it holds the block back.
      const end = blockEnd(lines, i, kind)
      const block = lines.slice(i, end)
      // A block that holds an example line (a fence, a comment) or a fence-like line stays whole; the walk goes on line by line.
      if (isExample.slice(i, end).some(is => is === true) || block.some(one => FENCE.test(one))) {
        i += 1

        continue
      }
      if (!block.some(one => isOpenLine(one, kind))) {
        blocks.push({ ...(heading === undefined ? {} : { heading }), lines: block, from: i, to: end })
      }
      i = end

      continue
    }
    i += 1
  }

  return blocks
}

/** The text without the lines of the given blocks; everything else stays as it was. One pass: the lines a block covers are marked, then dropped. */
export function removeBlocks(markdown: string, blocks: readonly ClosedBlock[]): string {
  const lines = markdown.split('\n')
  const gone = new Uint8Array(lines.length)
  for (const block of blocks) {
    gone.fill(1, Math.max(block.from, 0), Math.min(block.to, lines.length))
  }

  return lines.filter((_, i) => gone[i] === 0).join('\n')
}

/**
 * The lines of a text, indexed for the question "does this block stand whole here": the lines without a
 * trailing space or carriage return, where each line occurs, and for each place the next non-blank line.
 * Built once per text, so a question costs the size of the block, not of the text.
 */
type LineIndex = { flat: string[]; where: Map<string, number[]>; nextFilled: number[] }

function indexLines(lines: readonly string[]): LineIndex {
  const flat = lines.map(line => bare(line).trimEnd())
  const where = new Map<string, number[]>()
  flat.forEach((line, at) => {
    const seen = where.get(line)
    if (seen === undefined) {
      where.set(line, [at])
    } else {
      seen.push(at)
    }
  })
  const nextFilled: number[] = new Array<number>(flat.length + 1)
  nextFilled[flat.length] = flat.length
  for (let at = flat.length - 1; at >= 0; at -= 1) {
    nextFilled[at] = flat[at]!.trim() === '' ? nextFilled[at + 1]! : at
  }

  return { flat, where, nextFilled }
}

/** The places in `index` where `block` stands in order (trailing spaces ignored), with the block's trimmed lines. */
function placesOf(index: LineIndex, block: readonly string[]): { want: string[]; places: number[] } {
  const want = block.map(line => bare(line).trimEnd())
  const places = want.length === 0 ? [] : (index.where.get(want[0]!) ?? []).filter(at => want.every((line, k) => index.flat[at + k] === line))

  return { want, places }
}

/**
 * True when `block` stands whole at a place of `index`: in order, and the next non-blank line after it is
 * not indented past the block's first line (not indented at all for a block at indent 0, as before).
 */
function standsWhole(index: LineIndex, block: readonly string[]): boolean {
  const { want, places } = placesOf(index, block)
  const indent = want.length === 0 ? 0 : indentOf(want[0]!)

  return places.some(at => {
    const after = index.nextFilled[at + want.length]!

    return after >= index.flat.length || (indent === 0 ? !/^[ \t]/.test(index.flat[after]!) : indentOf(index.flat[after]!) <= indent)
  })
}

/**
 * A test of "this block stands whole in these lines" (`hasBlock`) for many blocks: the lines are indexed
 * once, so the checks cost the sum of the block sizes, not the blocks times the lines.
 */
export function blockFinder(lines: readonly string[]): (block: readonly string[]) => boolean {
  const index = indexLines(lines)

  return block => standsWhole(index, block)
}

/**
 * True when `block` stands in `lines` as one whole block: its lines in order (trailing spaces
 * ignored), from a non-indented first line, and the next non-blank line after it is not indented.
 */
export function hasBlock(lines: readonly string[], block: readonly string[]): boolean {
  return blockFinder(lines)(block)
}

/**
 * The archive lines indexed once for the heading questions of `addToArchive`: the example mask, the last
 * line outside examples for each trimmed text, and for each line the next heading line outside examples at or after it.
 * Built once per call, so each heading group costs its own section, not the whole archive.
 */
type HeadingIndex = { isExample: boolean[]; lastAt: Map<string, number>; nextHeading: number[] }

function indexHeadings(lines: readonly string[], kind: TodoKind): HeadingIndex {
  const isExample = lineMask(lines, kind)
  const lastAt = new Map<string, number>()
  lines.forEach((line, k) => {
    if (isExample[k] !== true) {
      lastAt.set(line.trim(), k)
    }
  })
  const nextHeading = new Array<number>(lines.length + 1)
  nextHeading[lines.length] = lines.length
  for (let k = lines.length - 1; k >= 0; k -= 1) {
    nextHeading[k] = isExample[k] !== true && headingLevel(lines[k]!, kind) !== undefined ? k : nextHeading[k + 1]!
  }

  return { isExample, lastAt, nextHeading }
}

/**
 * One run of lines `addToArchive` puts in: `lead` (fixed lines before it, a new heading), the block lines, `after`
 * (a blank line before a next heading). `gap`: `always` a blank line before the lines (an empty section), `ask` one
 * only when the lines would sit inside an example that a blank line ends (an HTML block of type 6 or 7).
 */
type Insert = { lead: string[]; lines: string[]; after: string[]; gap: 'always' | 'ask' | 'never' }

/** The archive lines with the inserts: `at` maps a base line to the inserts put before it; `tail` follows the base. */
function layout(base: readonly string[], at: ReadonlyMap<number, Insert>, tail: readonly Insert[], gaps: ReadonlySet<Insert>): { lines: string[]; firstAt: Map<Insert, number> } {
  const lines: string[] = []
  const firstAt = new Map<Insert, number>()
  const put = (one: Insert) => {
    lines.push(...one.lead, ...(one.gap === 'always' || gaps.has(one) ? [''] : []))
    firstAt.set(one, lines.length)
    lines.push(...one.lines, ...one.after)
  }
  for (let k = 0; k <= base.length; k += 1) {
    const one = at.get(k)
    if (one !== undefined) {
      put(one)
    }
    if (k < base.length) {
      lines.push(base[k]!)
    }
  }
  tail.forEach(put)

  return { lines, firstAt }
}

/**
 * The gaps the `ask` inserts need, read from two masks of the whole layout: an insert gets a blank line
 * when its first line is an example without one and no example with one. A per-insert mask of the lines before it
 * (the old way) cost the archive once per heading.
 */
function askedGaps(base: readonly string[], at: ReadonlyMap<number, Insert>, tail: readonly Insert[], kind: TodoKind): Set<Insert> {
  const asks = [...at.values(), ...tail].filter(one => one.gap === 'ask')
  if (asks.length === 0) {
    return new Set()
  }
  const plain = layout(base, at, tail, new Set())
  const plainMask = lineMask(plain.lines, kind)
  const hidden = new Set(asks.filter(one => plainMask[plain.firstAt.get(one)!] === true))
  if (hidden.size === 0) {
    return hidden
  }
  const spaced = layout(base, at, tail, hidden)
  const spacedMask = lineMask(spaced.lines, kind)

  return new Set([...hidden].filter(one => spacedMask[spaced.firstAt.get(one)!] !== true))
}

/**
 * The archive file's text with the blocks added. A block goes at the end of the section under its
 * own heading when the archive has that heading (the last one, outside code fences and HTML
 * comments), else the
 * heading is added at the end of the file; a block with no heading goes at the end. A block is
 * skipped only when it stands whole in the archive under its own heading (anywhere for a block with
 * none) AND is one of `wrote`, the blocks this mod wrote last for the file: a retry never adds a block
 * twice, and a new block that equals an old archived one, in another section or after a failed write,
 * is added. Lines end with the archive's own line ending (CRLF if it has one), else `eol`.
 *
 * Linear in the archive and the blocks: the headings are found once in the archive as it was
 * (`indexHeadings`), each group's place is decided there, and the lines go in once (`layout`). The lines
 * put in are closed blocks, which hold no example line, so they move no heading of the archive in or out of
 * an example; a section's block goes before the next heading, so it never changes where a later section starts.
 */
export function addToArchive(existing: string, blocks: readonly ClosedBlock[], wrote: readonly (readonly string[])[] = [], eol = '\n', kind: TodoKind = 'md'): string {
  const base = existing.trim() === '' ? [] : existing.replace(/(\r?\n)+$/, '').split('\n').map(bare)
  const end = existing.includes('\r\n') ? '\r\n' : existing.trim() === '' ? eol : '\n'
  const wroteSet = new Set(wrote.map(one => one.join('\n')))
  // Blocks by heading, in the order the headings first occur.
  const byHeading = new Map<string | undefined, ClosedBlock[]>()
  for (const block of blocks) {
    const own = byHeading.get(block.heading)
    if (own === undefined) {
      byHeading.set(block.heading, [block])
    } else {
      own.push(block)
    }
  }
  // Outside every example: a heading inside a code fence or an HTML comment is no heading, so a block put
  // under it would sit inside the comment and be no item.
  const index = indexHeadings(base, kind)
  /** The lines of the last section of `heading` (up to the next heading), or none when it has no section. */
  const sectionOf = (heading: string): string[] => {
    const at = index.lastAt.get(heading)

    return at === undefined ? [] : base.slice(at + 1, index.nextHeading[at + 1])
  }
  // The archive as it was before this call, for the retry check: a block is skipped only when it stands whole under its own heading.
  const stands = new Map<string | undefined, (block: readonly string[]) => boolean>()
  const standsUnder = (heading: string | undefined, block: readonly string[]): boolean => {
    let find = stands.get(heading)
    if (find === undefined) {
      find = blockFinder(heading === undefined ? base : sectionOf(heading))
      stands.set(heading, find)
    }

    return find(block)
  }
  // The inserts before a base line, and the ones after the base: blocks with no heading, and new headings with theirs.
  const at = new Map<number, Insert>()
  const tail: Insert[] = []
  // The place in `tail` of its first new heading, or -1.
  let tailHeading = -1
  let isFilled = base.length > 0
  for (const [heading, own] of byHeading) {
    const fresh = own.filter(block => !(wroteSet.has(block.lines.join('\n')) && standsUnder(heading, block.lines))).flatMap(block => block.lines)
    if (fresh.length === 0) {
      continue
    }
    const found = heading === undefined ? undefined : index.lastAt.get(heading)
    if (heading === undefined) {
      tail.push({ lead: [], lines: fresh, after: [], gap: 'ask' })
    } else if (found === undefined) {
      tail.push({ lead: [...(isFilled ? [''] : []), heading, ''], lines: fresh, after: [], gap: 'never' })
      tailHeading = tailHeading < 0 ? tail.length - 1 : tailHeading
    } else {
      const next = index.nextHeading[found + 1]!
      const hasLoose = (tailHeading < 0 ? tail.length : tailHeading) > 0
      if (next >= base.length && hasLoose) {
        // The last section, after blocks with no heading went in at the end: the block follows them, before any new heading.
        tail.splice(tailHeading < 0 ? tail.length : tailHeading, 0, { lead: [], lines: fresh, after: [], gap: 'ask' })
        tailHeading = tailHeading < 0 ? tailHeading : tailHeading + 1
      } else {
        let stop = next
        while (stop - 1 > found && base[stop - 1]!.trim() === '') {
          stop -= 1
        }
        // A blank line before the next heading, unless one is there; none at the end (a new heading brings its own).
        at.set(stop, { lead: [], lines: fresh, after: next < base.length && base[stop]!.trim() !== '' ? [''] : [], gap: stop === found + 1 ? 'always' : 'ask' })
      }
    }
    isFilled = true
  }

  return `${layout(base, at, tail, askedGaps(base, at, tail, kind)).lines.join(end)}${end}`
}

/**
 * True when every block stands in `text` as items: at some place where its lines stand in
 * order, each of its checkbox lines is an item of the whole text (`itemsAt`), not a line inside a code
 * fence or an HTML comment. The archive move checks its new text with this before the write, so a moved
 * ticket never lands where it is no ticket.
 */
export function blocksStandAsItems(text: string, blocks: readonly ClosedBlock[], kind: TodoKind = 'md'): boolean {
  const lines = text.split('\n').map(bare)
  const items = new Set(itemsAt(lines, kind).map(one => one.at))
  const index = indexLines(lines)

  return blocks.every(block => {
    const { want, places } = placesOf(index, block.lines)

    return places.some(at => want.every((line, k) => !isItemLine(line, kind) || items.has(at + k)))
  })
}

/**
 * The record a rollback leaves: the blocks of `wrote`, the record the move read, that still
 * stand whole in the archive text it put back (`back`) and in the source (`source`). Such a block was
 * written by an earlier step (another session's) whose own rollback was refused, so it is in both files;
 * the record keeps the next pass from adding it to the archive again (a duplicate), and that pass only
 * cuts it from the source. Every other block is in one file, so its record is cleared.
 */
export function recordAfterRollback(wrote: readonly (readonly string[])[], back: string, source: string): string[][] {
  const archived = back.split('\n').map(bare)
  const live = source.split('\n').map(bare)

  return wrote.filter(block => hasBlock(archived, block) && hasBlock(live, block)).map(block => [...block])
}

/**
 * The blocks that left the source between the read the move worked from (`read`) and now:
 * for each item key of the blocks, as many of its blocks as the source lost lines with that key, the
 * first ones. Another session that moved the same blocks to the archive cut them; a user who deleted
 * a done line did too. A block whose line is still there (a box set back, a line typed elsewhere) has
 * not left. The key ignores the box, so a ticket set back to open is still there.
 */
export function blocksLeft(read: string, now: string, blocks: readonly ClosedBlock[], kind: TodoKind = 'md'): ClosedBlock[] {
  const counts = (markdown: string) => {
    const out = new Map<string, number>()
    for (const item of parseTodo(markdown, kind)) {
      const key = storedKey(itemKey(item))
      out.set(key, (out.get(key) ?? 0) + 1)
    }

    return out
  }
  const [was, is] = [counts(read), counts(now)]
  const taken = new Map<string, number>()

  return blocks.filter(block => {
    const first = parseTodo(block.lines[0] ?? '', kind)[0]
    if (first === undefined) {
      return false
    }
    const key = storedKey(itemKey(first))
    const lost = (was.get(key) ?? 0) - (is.get(key) ?? 0)
    const used = taken.get(key) ?? 0
    if (used >= lost) {
      return false
    }
    taken.set(key, used + 1)

    return true
  })
}

/**
 * The name of the archive file the Show completed link opens, for a folder: a `TODO.md` (any case), else a
 * `TODO.html`, among its todo or archive files; else its only live file; else its only archive file; else `TODO.md`.
 */
export function archiveName(files: readonly { name: string; folder: string; isArchived?: boolean }[], folder: string): string {
  const mine = files.filter(file => file.folder === folder)
  const live = mine.filter(file => file.isArchived !== true).map(file => file.name)
  const old = mine.filter(file => file.isArchived === true).map(file => file.name.slice('archive/'.length))

  return findMainTodo([...live, ...old]) ?? (live.length === 1 ? live[0] : old.length === 1 ? old[0] : undefined) ?? 'TODO.md'
}
