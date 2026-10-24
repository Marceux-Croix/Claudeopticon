/** The text work of the archive step: closed blocks, their removal, and where they go in the archive file. */

import { itemKey, storedKey } from './item-keys'
import { continuesParagraph } from './markdown-blocks'
import { bare, CHECKBOX, exampleMask, FENCE, HEADING_LINE, itemsAt, parseTodo } from './todo-markdown'

/** A closed ticket is moved once it has been closed this long: a mis-click on Mark done can still be undone. */
export const ARCHIVE_AFTER_MS = 5000

/** A closed ticket in a todo file's text: its lines, where they sit (`from` to `to`, end excluded), and the heading above it. */
export type ClosedBlock = { heading?: string; lines: string[]; from: number; to: number }

/** True for a line that is, or looks like, a checkbox that is not done: a line that looks like one but fails the match counts open. */
function isOpenLine(line: string): boolean {
  const box = CHECKBOX.exec(line)?.[1]
  if (box !== undefined) {
    return box.toLowerCase() !== 'x'
  }

  return /^\s*[-*+] \[[^\]]*\]/.test(line)
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
 */
export function closedBlocks(markdown: string): ClosedBlock[] {
  const lines = markdown.split('\n').map(bare)
  const isExample = exampleMask(lines)
  const blocks: ClosedBlock[] = []
  let heading: string | undefined
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (isExample[i] === true) {
      i += 1

      continue
    }
    if (HEADING_LINE.test(line)) {
      heading = line.trim()
    } else if (/^[-*+] \[[xX]\]\s+/.test(line)) {
      // The block ends at its last indented line; blank lines after it are not taken.
      let end = i + 1
      // A line that is not indented but goes on the paragraph above it (a wrapped ticket text) is part of the block: an open subtask after it holds the block back.
      const isInside = (at: number) => lines[at]!.trim() === '' || /^[ \t]+\S/.test(lines[at]!) || continuesParagraph(lines[at - 1]!, lines[at]!)
      for (let at = i + 1; at < lines.length && isInside(at); at += 1) {
        end = lines[at]!.trim() === '' ? end : at + 1
      }
      const block = lines.slice(i, end)
      // A block that holds an example line (a fence, a comment) or a fence-like line stays whole; the walk goes on line by line.
      if (isExample.slice(i, end).some(is => is === true) || block.some(one => FENCE.test(one))) {
        i += 1

        continue
      }
      if (!block.some(isOpenLine)) {
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

/** True when `block` stands whole at a place of `index`: in order, and the next non-blank line after it is not indented. */
function standsWhole(index: LineIndex, block: readonly string[]): boolean {
  const { want, places } = placesOf(index, block)

  return places.some(at => {
    const after = index.nextFilled[at + want.length]!

    return after >= index.flat.length || !/^[ \t]/.test(index.flat[after]!)
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
 * The blank line to put between `before` and a block that starts with `first`, when the block would
 * sit inside an example right after `before` and a blank line ends that example: an HTML block of type
 * 6 or 7 (`<details>`, `<div>`, a lone tag) runs to the next blank line. Else none, so an
 * archive keeps its blocks together as before.
 */
function gapBefore(before: readonly string[], first: string): string[] {
  return exampleMask([...before, first]).at(-1) === true && exampleMask([...before, '', first]).at(-1) !== true ? [''] : []
}

/** The lines of the last section of `heading` in `lines` (outside examples; up to the next heading), or none when it has no section. */
function sectionOf(lines: readonly string[], isExample: readonly boolean[], heading: string): string[] {
  const at = lines.reduce((last, line, k) => (isExample[k] !== true && line.trim() === heading ? k : last), -1)
  if (at < 0) {
    return []
  }
  const next = lines.findIndex((line, k) => k > at && isExample[k] !== true && HEADING_LINE.test(line))

  return lines.slice(at + 1, next < 0 ? lines.length : next)
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
 */
export function addToArchive(existing: string, blocks: readonly ClosedBlock[], wrote: readonly (readonly string[])[] = [], eol = '\n'): string {
  const lines = existing.trim() === '' ? [] : existing.replace(/(\r?\n)+$/, '').split('\n').map(bare)
  const end = existing.includes('\r\n') ? '\r\n' : existing.trim() === '' ? eol : '\n'
  const base = [...lines]
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
  // The archive as it was before this call, for the retry check: a block is skipped only when it stands whole under its own heading.
  const baseMask = wroteSet.size === 0 ? [] : exampleMask(base)
  const stands = new Map<string | undefined, (block: readonly string[]) => boolean>()
  const standsUnder = (heading: string | undefined, block: readonly string[]): boolean => {
    let find = stands.get(heading)
    if (find === undefined) {
      find = blockFinder(heading === undefined ? base : sectionOf(base, baseMask, heading))
      stands.set(heading, find)
    }

    return find(block)
  }
  for (const [heading, own] of byHeading) {
    const fresh = own.filter(block => !(wroteSet.has(block.lines.join('\n')) && standsUnder(heading, block.lines))).flatMap(block => block.lines)
    if (fresh.length === 0) {
      continue
    }
    // Outside every example: a heading inside a code fence or an HTML comment is no heading, so a block put
    // under it would sit inside the comment and be no item. Read again each turn: the lines grow as blocks go in.
    const isExample = exampleMask(lines)
    const at = heading === undefined ? -1 : lines.map((line, k) => (isExample[k] !== true && line.trim() === heading ? k : -1)).reduce((last, k) => Math.max(last, k), -1)
    if (heading === undefined) {
      lines.push(...gapBefore(lines, fresh[0]!), ...fresh)
    } else if (at < 0) {
      lines.push(...(lines.length > 0 ? [''] : []), heading, '', ...fresh)
    } else {
      let stop = lines.findIndex((line, k) => k > at && isExample[k] !== true && HEADING_LINE.test(line))
      stop = stop < 0 ? lines.length : stop
      while (stop - 1 > at && lines[stop - 1]!.trim() === '') {
        stop -= 1
      }
      const isNext = stop < lines.length
      lines.splice(stop, 0, ...(stop === at + 1 ? [''] : gapBefore(lines.slice(0, stop), fresh[0]!)), ...fresh, ...(isNext && lines[stop]!.trim() !== '' ? [''] : []))
    }
  }

  return `${lines.join(end)}${end}`
}

/**
 * True when every block stands in `text` as items: at some place where its lines stand in
 * order, each of its checkbox lines is an item of the whole text (`itemsAt`), not a line inside a code
 * fence or an HTML comment. The archive move checks its new text with this before the write, so a moved
 * ticket never lands where it is no ticket.
 */
export function blocksStandAsItems(text: string, blocks: readonly ClosedBlock[]): boolean {
  const lines = text.split('\n').map(bare)
  const items = new Set(itemsAt(lines).map(one => one.at))
  const index = indexLines(lines)

  return blocks.every(block => {
    const { want, places } = placesOf(index, block.lines)

    return places.some(at => want.every((line, k) => !CHECKBOX.test(line) || items.has(at + k)))
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
export function blocksLeft(read: string, now: string, blocks: readonly ClosedBlock[]): ClosedBlock[] {
  const counts = (markdown: string) => {
    const out = new Map<string, number>()
    for (const item of parseTodo(markdown)) {
      const key = storedKey(itemKey(item))
      out.set(key, (out.get(key) ?? 0) + 1)
    }

    return out
  }
  const [was, is] = [counts(read), counts(now)]
  const taken = new Map<string, number>()

  return blocks.filter(block => {
    const first = parseTodo(block.lines[0] ?? '')[0]
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
 * The name of the archive file the Show completed link opens, for a folder: a `TODO.md` (any case)
 * among its todo or archive files; else its only live file; else its only archive file; else `TODO.md`.
 */
export function archiveName(files: readonly { name: string; folder: string; isArchived?: boolean }[], folder: string): string {
  const mine = files.filter(file => file.folder === folder)
  const live = mine.filter(file => file.isArchived !== true).map(file => file.name)
  const old = mine.filter(file => file.isArchived === true).map(file => file.name.slice('archive/'.length))

  return [...live, ...old].find(name => name.toLowerCase() === 'todo.md') ?? (live.length === 1 ? live[0] : old.length === 1 ? old[0] : undefined) ?? 'TODO.md'
}
