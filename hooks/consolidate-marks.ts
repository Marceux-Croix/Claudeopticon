/** The Consolidate retry record: which sources a press copied but did not empty, and what a retry does with each. */

import { applyRenames, sectionCount, sectionSpans, stripIds } from './consolidate-text'
import { CHECKBOX, ID_SRC } from './todo-markdown'

/**
 * A source a Consolidate press copied into the target, or was about to, and has not emptied. Stored
 * per central folder, so a retry after a reload or in another session still knows it.
 * `lines`: the lines copied, as read from the source. `sectionsBefore`: how many `## From <heading>`
 * sections the target held right before the copy was written. `told`: the renumbering notes of the
 * copy, and `isTold` once they were queued for Claude. `copied`: the lines as written into the target,
 * renumbered (absent in a mark stored before then `lines` with the renames of `told`).
 */
export type CopyMark = { heading: string; lines: string[]; sectionsBefore: number; told: string[]; isTold: boolean; copied?: string[] }

/** What a press does with a source: copy it, only empty it (its copy is in the target), or leave it (it changed after its copy). */
export type RetryStep = 'copy' | 'empty' | 'changed'

/**
 * The step for one source with lines `lines` under `heading`, given its mark and the target's text now.
 *
 * No mark (or one of another heading; a record lost to a store that failed): a section of the
 * heading that is the lines, but for the changes the mod itself makes to a copy (`asLanded`: a box set,
 * an ID numbering put in front of a line), is the copy, so only empty. One that is the lines up to the
 * item IDs, or the lines shortened by the archive step (a ticket block gone), may be the copy
 * renumbered or archived, or the source edited since: left, never copied a second time. Else copy.
 *
 * A mark: its copy is in the target when the heading has more sections than before the copy, or when
 * a section of the heading is the copied lines as written (`copied`, renumbered), but for those same
 * changes and the ticket blocks the archive step took out. A line that only looks like one
 * of the copy (another ID, an older section of the same heading) is no copy, so taking the copy out
 * never makes an older section stand in for it, and the source is copied again, never emptied into
 * nothing. A copy not there (never landed, or taken out): copy again. Else the source is only emptied
 * when its lines are still the copied ones, letter for letter but for an ID numbering put in front of
 * a line since; any other change, a changed ID included, leaves it: never a second copy, never a lost
 * edit.
 */
export function retryStep(mark: CopyMark | undefined, heading: string, lines: readonly string[], target: string): RetryStep {
  const bodies = sectionSpans(target, heading)
  if (mark === undefined || mark.heading !== heading) {
    if (bodies.some(body => asLanded(body, lines, false))) {
      return 'empty'
    }
    const bare = lines.map(idless)

    // An empty body is no copy: a section the archive step emptied must not hold a new source back.
    return bodies.some(body => body.length > 0 && asLanded(body.map(idless), bare, true)) ? 'changed' : 'copy'
  }
  const copied = mark.copied ?? mark.lines.map(line => applyRenames(line, toldRenames(mark.told)))
  const isThere = sectionCount(target, heading) > mark.sectionsBefore || bodies.some(body => body.length > 0 && asLanded(body, copied, true))
  if (!isThere) {
    return 'copy'
  }

  return mark.lines.length === lines.length && mark.lines.every((line, at) => isAsCopied(line, lines[at]!)) ? 'empty' : 'changed'
}

/** The checkbox and the space after it, then a leading `#ID ` (one numbering may have put there). */
const LEAD_ID = new RegExp(`^(\\s*[-*+] \\[[ xX~>]\\]\\s+)#${ID_SRC}\\b `)
const BOX = /^(\s*[-*+] )\[[ xX~>]\]/

/** The line with no IDs: a leading one taken out with its space, every other one cut to `#`. Two copies of one ticket, renumbered or not, compare equal. */
const idless = (line: string): string => stripIds(line.replace(LEAD_ID, '$1'))

/** True when the source line is the copied one: the same, or the same with one ID numbering put in front of its text. */
const isAsCopied = (copied: string, now: string): boolean => now === copied || now.replace(LEAD_ID, '$1') === copied

/** The renames a mark's renumbering notes name (`- <heading>: #T7 is now`), old (lowercase) to new. */
function toldRenames(told: readonly string[]): Record<string, string> {
  const renames: Record<string, string> = {}
  for (const note of told) {
    const m = new RegExp(`#(${ID_SRC}) is now #(${ID_SRC})$`).exec(note)
    if (m !== null) {
      renames[m[1]!.toLowerCase()] = m[2]!
    }
  }

  return renames
}

/** A target line is the copied line as the mod may have changed it: the same, a box set, or an ID numbering put in front. */
function isLandedLine(target: string, copied: string): boolean {
  const open = (line: string) => line.replace(BOX, '$1[ ]')

  return isAsCopied(open(copied), open(target))
}

/**
 * True when a section body is the copied lines as they landed: line for line `isLandedLine`,
 * and, with `mayShorten`, with whole ticket blocks gone (a checkbox line and the indented or blank lines
 * under it), as the archive step takes closed tickets out. Every body line must stand for a copied
 * line in order: no extra line, no edited one.
 */
function asLanded(body: readonly string[], copied: readonly string[], mayShorten: boolean): boolean {
  let at = 0
  for (let i = 0; i < copied.length; i += 1) {
    if (at < body.length && isLandedLine(body[at]!, copied[i]!)) {
      at += 1
      continue
    }
    if (!mayShorten || !CHECKBOX.test(copied[i]!)) {
      return false
    }
    // The archive step took this ticket out: its block is the indented and blank lines under it.
    const indent = /^\s*/.exec(copied[i]!)![0].length
    while (i + 1 < copied.length && (copied[i + 1]!.trim() === '' || /^\s*/.exec(copied[i + 1]!)![0].length > indent)) {
      i += 1
    }
  }

  return at === body.length
}

/** Reads the stored marks back (source path to mark), keeping only well-formed entries. */
export function readKeptMarks(stored: unknown): Map<string, CopyMark> {
  const out = new Map<string, CopyMark>()
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return out
  }
  const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(one => typeof one === 'string')
  for (const [path, raw] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const one = raw as Record<string, unknown>
    if (typeof one.heading === 'string' && isStrings(one.lines) && typeof one.sectionsBefore === 'number' && Number.isFinite(one.sectionsBefore) && isStrings(one.told) && typeof one.isTold === 'boolean') {
      out.set(path, { heading: one.heading, lines: one.lines, sectionsBefore: one.sectionsBefore, told: one.told, isTold: one.isTold, ...(isStrings(one.copied) ? { copied: one.copied } : {}) })
    }
  }

  return out
}

/**
 * The marks after a store read: the stored ones merged into memory, never in place of it.
 * A mark in memory wins over the stored one of the same source, since a save that failed leaves the
 * store older than memory; a stored mark this session dropped (`dropped`: done with since its last
 * stored save) is not brought back.
 */
export function mergeMarks(memory: ReadonlyMap<string, CopyMark>, stored: ReadonlyMap<string, CopyMark>, dropped: ReadonlySet<string>): Map<string, CopyMark> {
  const out = new Map(memory)
  for (const [path, mark] of stored) {
    if (!out.has(path) && !dropped.has(path)) {
      out.set(path, mark)
    }
  }

  return out
}
