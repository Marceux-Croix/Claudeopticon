/** The text work of Consolidate todos: copied lines, sections, renumbered IDs and renamed references. */

import { listedName } from './path-forms'
import { nextTicketIds } from './ticket-ids'
import { bare, CHECKBOX, exampleMask, ID_SRC, lineOwnIds, parseTodo } from './todo-markdown'

/** Every checkbox line of a todo file's text, as written. */
export function itemLines(markdown: string): string[] {
  return markdown.split('\n').filter(line => CHECKBOX.test(line))
}

/** The lines with the blank ones cut from the start and the end; every other line stays as it is, blank lines and trailing spaces inside included. */
export function trimBlankLines(lines: readonly string[]): string[] {
  let from = 0
  let to = lines.length
  while (from < to && lines[from]!.trim() === '') {
    from += 1
  }
  while (to > from && lines[to - 1]!.trim() === '') {
    to -= 1
  }

  return lines.slice(from, to)
}

/** The lines of a source file as Consolidate copies them: as written (a carriage return dropped), only the blank lines at both ends cut. */
export function copyLines(markdown: string): string[] {
  return trimBlankLines(markdown.split(/\r?\n/))
}

/** The line with every `#ID` taken out: two copies of one ticket compare equal after a renumbering. */
export const stripIds = (line: string): string => line.replace(new RegExp(`#${ID_SRC}\\b`, 'g'), '#')

/** The bodies (blank ends cut) of every `## From <heading>` section of a target file's text. */
export function sectionBodies(text: string, heading: string): string[][] {
  const lines = text.split(/\r?\n/)
  const out: string[][] = []
  lines.forEach((line, at) => {
    if (line !== `## From ${heading}`) {
      return
    }
    let end = at + 1
    while (end < lines.length && !lines[end]!.startsWith('## From ')) {
      end += 1
    }
    out.push(trimBlankLines(lines.slice(at + 1, end)))
  })

  return out
}

/**
 * Every possible body of a `## From <heading>` section: from each such heading to each later `## From `
 * line (or the end). A `## From` line the source itself held is copied into the section's body, so the
 * section can run past it; the mod cannot tell it from a heading it wrote, so a retry accepts the body
 * that ends at any of them.
 */
export function sectionSpans(text: string, heading: string): string[][] {
  const lines = text.split(/\r?\n/)
  const out: string[][] = []
  lines.forEach((line, at) => {
    if (line !== `## From ${heading}`) {
      return
    }
    for (let end = at + 1; end <= lines.length; end += 1) {
      if (end === lines.length || lines[end]!.startsWith('## From ')) {
        out.push(trimBlankLines(lines.slice(at + 1, end)))
      }
    }
  })

  return out
}

/** The line ending of a text: CRLF when it has one, else LF. */
export const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')

/**
 * True when a name cannot stand in a `## From` heading: it holds a line break, a carriage
 * return, a Unicode line or paragraph separator, another control character, or a format character
 * (a bidi override or a zero-width joiner makes the heading read as another name). A file or folder
 * named `a\n- [ ] #T5 Ghost\n<!--.md` would add a ticket line to the central todo and open a
 * comment that swallows the sections after it; the press refuses such a source and names it.
 */
export function isUnsafeHeadingName(name: string): boolean {
  return /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name)
}

/** One `## From` section, lines joined with `eol`. A place that cannot stand in a heading throws: it is refused before it gets here. */
export function sectionText(place: string, lines: readonly string[], eol: string): string {
  if (isUnsafeHeadingName(place)) {
    throw new Error(`a \`## From\` heading cannot hold the name ${JSON.stringify(place)}`)
  }

  return `## From ${place}${eol}${eol}${lines.join(eol)}${eol}`
}

/**
 * True when the items of `next` are exactly the items of `now` and then those of each section, in
 * order, by text and box: no item of a section is lost, none is added (by a heading, say),
 * and none of the target changes. A count alone passes a lost item and an added one together. The
 * text holds an item's IDs, so the compare does not depend on which line of the file owns an ID.
 */
export function keepsEveryItem(now: string, next: string, sections: readonly { lines: readonly string[] }[]): boolean {
  const keys = (text: string) => parseTodo(text).map(item => `${item.status}\0${item.text}`)
  const want = [...keys(now), ...sections.flatMap(one => keys(one.lines.join('\n')))]
  const got = keys(next)

  return got.length === want.length && got.every((key, at) => key === want[at])
}

/** The line with every `#ID` in the map replaced by its new one (one pass, so a new ID is never renamed again). */
export function applyRenames(line: string, renames: Readonly<Record<string, string>>): string {
  return line.replace(new RegExp(`#(${ID_SRC})\\b`, 'g'), (whole, id: string) => {
    const fresh = renames[id.toLowerCase()]

    return fresh === undefined ? whole : `#${fresh}`
  })
}

/**
 * Like `applyRenames`, but a ticket line keeps its own leading ID: only its references change. A
 * trailing carriage return stays and never stops the match: `.` does not match `\r`.
 */
export function applyRefRenames(line: string, renames: Readonly<Record<string, string>>): string {
  const cr = line.endsWith('\r') ? '\r' : ''
  const body = bare(line)
  const m = new RegExp(`^(\\s*[-*+] \\[[ xX~>]\\]\\s+#${ID_SRC})(.*)$`).exec(body)

  return `${m === null ? applyRenames(body, renames) : `${m[1]}${applyRenames(m[2]!, renames)}`}${cr}`
}

/** The lines with the renames applied (`applyRenames`), except lines in a code fence or an HTML comment: those are examples. */
export function renameLines(lines: readonly string[], renames: Readonly<Record<string, string>>): string[] {
  if (Object.keys(renames).length === 0) {
    return [...lines]
  }
  const isExample = exampleMask(lines.map(bare))

  return lines.map((line, at) => (isExample[at] === true ? line : applyRenames(line, renames)))
}

/** How many `## From <heading>` sections a target file's text holds. */
export function sectionCount(text: string, heading: string): number {
  return text.split(/\r?\n/).filter(line => line === `## From ${heading}`).length
}

/**
 * The lines of one source file with every item ID that `used` has already replaced by the next free
 * ID (`` when `#T1` and `#T2` are taken; `#PROJ3` for other letters), and the references to it in the other
 * lines of the file rewritten the same way. `used` (lowercase IDs) gains each ID the file ends up with.
 * `renames` maps old (lowercase) to new; `pairs` lists them as written, for the toast. A new ID also
 * skips every ID in `reserved` (lowercase): the IDs of the other files still to come. Lines in a
 * code fence or an HTML comment are examples: they are never renamed.
 *
 * `takeT`, when given, is the one source of each new `T` ID: the caller's claimed IDs, free of
 * every ID above. A source that runs dry throws, so a new `T` ID is never picked outside the claim.
 * Without it the next `T` ID above all of the IDs is taken, as a count of the renames needs.
 */
export function renumberLines(lines: readonly string[], used: Set<string>, reserved: ReadonlySet<string> = new Set(), takeT?: () => string | undefined): { lines: string[]; renames: Record<string, string>; pairs: { from: string; to: string }[] } {
  const renames: Record<string, string> = {}
  const pairs: { from: string; to: string }[] = []
  // A new number also skips this source's own IDs, so one clash never pushes a later line out.
  const ids = lineOwnIds(lines.map(bare))
  const own = ids.flatMap(id => (id === undefined ? [] : [id.toLowerCase()]))
  // Other letters than `T` keep the older rule: the next number after the highest one of those letters.
  const nextFree = (letters: string) => {
    const all = [...used, ...own, ...reserved]
    if (letters.toLowerCase() === 't') {
      if (takeT === undefined) {
        const next = nextTicketIds(all, 1)[0]
        if (next === undefined) {
          throw new Error('no ticket ID left for the renumbering: the number line is used up')
        }

        return next
      }
      const given = takeT()
      if (given === undefined) {
        throw new Error('no claimed ticket ID left for the renumbering')
      }

      return given
    }
    let top = 0
    for (const id of all) {
      const m = /^([a-z]+)(\d+)$/.exec(id)
      if (m !== null && m[1] === letters.toLowerCase()) {
        top = Math.max(top, Number(m[2]))
      }
    }

    return `${letters}${top + 1}`
  }
  for (const id of ids) {
    if (id === undefined) {
      continue
    }
    if (renames[id.toLowerCase()] !== undefined) {
      continue
    }
    if (!used.has(id.toLowerCase())) {
      used.add(id.toLowerCase())
      continue
    }
    const fresh = nextFree(/^[A-Za-z]+/.exec(id)?.[0] ?? 'T')
    used.add(fresh.toLowerCase())
    renames[id.toLowerCase()] = fresh
    pairs.push({ from: id, to: fresh })
  }

  return { lines: renameLines(lines, renames), renames, pairs }
}

/** The text of a target file with new sections added: kept as it was, then each `## From <place>` block. */
export function appendSections(existing: string, sections: readonly { place: string; lines: readonly string[] }[]): string {
  let text = existing
  // The target's own line ending: a CRLF file gets CRLF lines.
  const eol = eolOf(existing)
  for (const section of sections) {
    const gap = text.trim() === '' ? '' : text.endsWith('\n') ? eol : `${eol}${eol}`
    text = `${text}${gap}${sectionText(section.place, section.lines, eol)}`
  }

  return text
}

/**
 * The file a source file is judged against in the central folder: the target for a top-level file; for an
 * archived one (its name holds a `/`: `archive/x.md`, or `Archive/x.md` on a disk that ignores case), the
 * same-named file in the central folder's own archive folder, both as the central disk spells them:
 * `archive` is that folder's name, `archived` the file names in it. A path built from a lowercase `archive/`
 * when the disk says `Archive/` is no real path, and the symlink check refused every press.
 */
export const destOf = (name: string, target: string, archive = 'archive', archived: readonly string[] = []): string =>
  name.includes('/') ? `${archive}/${listedName(archived, name.slice(name.indexOf('/') + 1))}` : target

/** The longest Consolidate result toast, in characters. */
export const TOAST_MAX = 1500

/**
 * One toast from the notes of a press: the notes in order, joined with a space, cut at `max` characters
 * with `...` when longer. A host that keeps only the last toast of a burst then still shows every refusal.
 * `summary` (the "Moved N files" line) is left out when it moved nothing and a note says why, and goes last otherwise.
 */
export function pressToast(notes: readonly string[], summary: string, moved: number, max = TOAST_MAX): string {
  const all = notes.length > 0 && moved === 0 ? [...notes] : [...notes, summary]
  const text = all.join(' ')

  return text.length <= max ? text : `${text.slice(0, max - 3)}...`
}
