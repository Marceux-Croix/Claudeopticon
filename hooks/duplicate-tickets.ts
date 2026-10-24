/** The text work of Delete duplicate tickets: which tickets repeat, and the references that follow the kept one. */

import { applyRefRenames } from './consolidate-text'
import { bare, exampleMask, ID_SRC } from './todo-markdown'

/**
 * The parts of a ticket line that a fold compares: everything but the item's own leading `#T<n>` ID,
 * kept letter for letter (bullet, box, spacing, text), and that ID. Undefined for any other line.
 */
export function foldParts(line: string): { key: string; id: string; inner?: { key: string; id: string } } | undefined {
  const m = new RegExp(`^(\\s*[-*+] \\[[ xX~>]\\]\\s+)#(${ID_SRC})(?=\\s|$)(.*)$`).exec(line.trimEnd())
  if (m === null) {
    return undefined
  }
  // A copy that numbering gave an ID in front of the one it repeats (` Fix`): its parts after both IDs.
  const n = new RegExp(`^ #(${ID_SRC})(?=\\s|$)(.*)$`).exec(m[3]!)

  return { key: `${m[1]}#${m[3]}`, id: m[2]!, ...(n === null ? {} : { inner: { key: `${m[1]}#${n[2]}`, id: n[1]! } }) }
}

/**
 * Finds identical tickets in a todo file's text, within one `## From` section (or before the first): ticket lines whose bullet, box and text, after the
 * item's own leading ID, are letter for letter the same. The first of each group stays. Returns the
 * text without the others, with references to a removed ticket's ID rewritten to the kept one, the
 * removed tickets, and the ID map (old lowercase to kept). An ID that a kept ticket owns is never remapped.
 * A copy that numbering gave its own ID before the repeated one (` Fix the parser` after
 * `Fix the parser`) is a copy of the earlier line that leads with that second ID.
 */
export function removeDuplicateTickets(markdown: string): { text: string; removed: { id: string; kept: string }[]; map: Record<string, string> } {
  const seen = new Map<string, string>()
  const removed: { id: string; kept: string }[] = []
  const kept: string[] = []
  const map: Record<string, string> = {}
  const owned = new Set<string>()
  const lines = markdown.split('\n')
  // A line in a code fence or an HTML comment is an example: never a ticket, never kept as the first copy, never rewritten.
  const isFenced = exampleMask(lines.map(bare))
  // The block rule of the archive: the lines under a ticket run past blank lines while the next non-blank line is indented.
  const hasChild = (index: number) => {
    let at = index + 1
    while (at < lines.length && lines[at]!.trim() === '') {
      at += 1
    }

    return at < lines.length && /^[ \t]+\S/.test(lines[at]!)
  }
  // The `## From` section a line stands in: equal text under two sections is two tickets, one per source, never folded.
  let section = ''
  for (const [index, line] of lines.entries()) {
    if (isFenced[index] === true) {
      kept.push(line)
      continue
    }
    if (line.startsWith('## From ')) {
      section = line.trimEnd()
    }
    // A subtask, or a ticket with lines indented under it, is never a duplicate: its place in the tree is part of it.
    const parts = /^[-*+] /.test(line) && !hasChild(index) ? foldParts(line) : undefined
    if (parts === undefined) {
      const own = foldParts(line)
      if (own !== undefined) {
        owned.add(own.id.toLowerCase())
      }
      kept.push(line)
      continue
    }
    // A numbered copy (` Fix the parser`) repeats an earlier `Fix the parser`: the line it names by its second ID.
    const key = `${section}\0${parts.key}`
    const inner = parts.inner === undefined ? undefined : seen.get(`${section}\0${parts.inner.key}`)
    const first = seen.get(key) ?? (inner !== undefined && inner.toLowerCase() === parts.inner!.id.toLowerCase() ? inner : undefined)
    if (first === undefined) {
      seen.set(key, parts.id)
      owned.add(parts.id.toLowerCase())
      kept.push(line)
    } else {
      removed.push({ id: parts.id, kept: first })
      if (first.toLowerCase() !== parts.id.toLowerCase()) {
        map[parts.id.toLowerCase()] = first
      }
    }
  }
  for (const id of Object.keys(map)) {
    if (owned.has(id)) {
      delete map[id]
    }
  }

  return { text: renameRefs(kept.join('\n'), map), removed, map }
}

/** The text with references to renamed IDs rewritten line by line (a ticket keeps its own ID); lines in a code fence or an HTML comment are left as they are. */
export function renameRefs(markdown: string, map: Readonly<Record<string, string>>): string {
  if (Object.keys(map).length === 0) {
    return markdown
  }
  const lines = markdown.split('\n')
  const isFenced = exampleMask(lines.map(bare))

  return lines.map((line, index) => (isFenced[index] === true ? line : applyRefRenames(line, map))).join('\n')
}
