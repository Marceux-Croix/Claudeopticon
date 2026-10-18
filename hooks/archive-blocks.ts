/** The text work of the archive step: closed blocks, their removal, and where they go in the archive file. */

import { itemKey, storedKey } from './item-keys'
import { bare, CHECKBOX, exampleMask, FENCE, itemsAt, parseTodo } from './todo-markdown'

/** A closed ticket is moved once it has been closed this long: a mis-click on Mark done can still be undone. */
export const ARCHIVE_AFTER_MS = 5000
const HEADING = /^#{1,6}\s/

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
 * next non-blank line is indented. An open or in-progress subtask keeps the whole block, and so does
 * a code fence, HTML or block quote line in it. Prose, headings and tables are never part of a
 * block. Every line `exampleMask` marks (a code fence and its lines, an HTML block, a block quote) is an
 * example: it never starts or joins a block, and is never a heading (UCR-139). The heading is the
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
    if (HEADING.test(line)) {
      heading = line.trimEnd()
    } else if (/^[-*+] \[[xX]\]\s+/.test(line)) {
      // The block ends at its last indented line; blank lines after it are not taken.
      let end = i + 1
      for (let at = i + 1; at < lines.length && (lines[at]!.trim() === '' || /^[ \t]+\S/.test(lines[at]!)); at += 1) {
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

/** The text without the lines of the given blocks; everything else stays as it was. */
export function removeBlocks(markdown: string, blocks: readonly ClosedBlock[]): string {
  return markdown.split('\n').filter((_, i) => !blocks.some(block => i >= block.from && i < block.to)).join('\n')
}

/**
 * True when `block` stands in `lines` as one whole block: its lines in order (trailing spaces
 * ignored), from a non-indented first line, and the next non-blank line after it is not indented.
 */
export function hasBlock(lines: readonly string[], block: readonly string[]): boolean {
  const flat = lines.map(line => bare(line).trimEnd())
  const want = block.map(line => bare(line).trimEnd())

  return flat.some((_, at) => {
    if (!want.every((line, k) => flat[at + k] === line)) {
      return false
    }
    const after = flat.slice(at + want.length).find(line => line.trim() !== '')

    return after === undefined || !/^[ \t]/.test(after)
  })
}

/**
 * The blank line to put between `before` and a block that starts with `first`, when the block would
 * sit inside an example right after `before` and a blank line ends that example: an HTML block of type
 * 6 or 7 (`<details>`, `<div>`, a lone tag) runs to the next blank line (UCR-203). Else none, so an
 * archive keeps its blocks together as before.
 */
function gapBefore(before: readonly string[], first: string): string[] {
  return exampleMask([...before, first]).at(-1) === true && exampleMask([...before, '', first]).at(-1) !== true ? [''] : []
}

/**
 * The archive file's text with the blocks added. A block goes at the end of the section under its
 * own heading when the archive has that heading (the last one, outside code fences and HTML
 * comments, UCR-227), else the
 * heading is added at the end of the file; a block with no heading goes at the end. A block is
 * skipped only when it stands whole in the archive AND is one of `wrote`, the blocks this mod wrote
 * last for the file: a retry never adds a block twice, and a new block that equals an old archived
 * one is added. Lines end with the archive's own line ending (CRLF if it has one), else `eol`.
 */
export function addToArchive(existing: string, blocks: readonly ClosedBlock[], wrote: readonly (readonly string[])[] = [], eol = '\n'): string {
  const lines = existing.trim() === '' ? [] : existing.replace(/(\r?\n)+$/, '').split('\n').map(bare)
  const end = existing.includes('\r\n') ? '\r\n' : existing.trim() === '' ? eol : '\n'
  const base = [...lines]
  const wroteSet = new Set(wrote.map(one => one.join('\n')))
  const headings = [...new Set(blocks.map(block => block.heading))]
  for (const heading of headings) {
    const fresh = blocks.filter(block => block.heading === heading && !(hasBlock(base, block.lines) && wroteSet.has(block.lines.join('\n')))).flatMap(block => block.lines)
    if (fresh.length === 0) {
      continue
    }
    // Outside every example (UCR-227): a heading inside a code fence or an HTML comment is no heading, so a block put
    // under it would sit inside the comment and be no item. Read again each turn: the lines grow as blocks go in.
    const isExample = exampleMask(lines)
    const at = heading === undefined ? -1 : lines.map((line, k) => (isExample[k] !== true && line.trimEnd() === heading ? k : -1)).reduce((last, k) => Math.max(last, k), -1)
    if (heading === undefined) {
      lines.push(...gapBefore(lines, fresh[0]!), ...fresh)
    } else if (at < 0) {
      lines.push(...(lines.length > 0 ? [''] : []), heading, '', ...fresh)
    } else {
      let stop = lines.findIndex((line, k) => k > at && isExample[k] !== true && HEADING.test(line))
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
 * True when every block stands in `text` as items (UCR-227): at some place where its lines stand in
 * order, each of its checkbox lines is an item of the whole text (`itemsAt`), not a line inside a code
 * fence or an HTML comment. The archive move checks its new text with this before the write, so a moved
 * ticket never lands where it is no ticket.
 */
export function blocksStandAsItems(text: string, blocks: readonly ClosedBlock[]): boolean {
  const lines = text.split('\n').map(bare)
  const items = new Set(itemsAt(lines).map(one => one.at))
  const flat = lines.map(line => line.trimEnd())

  return blocks.every(block => {
    const want = block.lines.map(line => bare(line).trimEnd())

    return flat.some((_, at) => want.every((line, k) => flat[at + k] === line) && want.every((line, k) => !CHECKBOX.test(line) || items.has(at + k)))
  })
}

/**
 * The record a rollback leaves (UCR-226): the blocks of `wrote`, the record the move read, that still
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
 * The blocks that left the source between the read the move worked from (`read`) and now (UCR-226):
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
