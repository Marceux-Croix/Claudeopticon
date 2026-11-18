/** Giving a ticket without an ID the next free ID. */

import type { EngineInterface } from 'claude-code'
import { clock } from './card-format'
import { numberedLine } from './claude-notes'
import { insertIds, lineIds, NUMBER_AFTER_MS, NUMBER_MAX } from './numbering'
import { RESERVE_MS } from './ticket-ids'
import { todoKind, type TodoKind } from './todo-file-names'
import { bare, itemParts, itemText, leadingId, lineMask, lineOwnIds } from './todo-markdown'
import { reasonOf, TodoReadError } from './todo-read'
import { tryWriteLock } from './write-lock'
import { diskIds } from './disk-ids'
import { freeIds } from './id-claims'
import { pruneReserved, sessionOf, syncReserved } from './id-reservations'
import { isPlainFile, isTrustedDir } from './path-trust'
import { S, givenIds, reservedIds, unreadToasted } from './state'
import { showToast } from './toasts'
import { projectIds, readTodo, writeIfUnchanged } from './todo-io'
import { saveToldNotes } from './told-store'

/** The board text of an item line, or empty for a line that is none. */
function textAt(line: string, kind: TodoKind): string {
  const parts = itemParts(line, kind)

  return parts === undefined ? '' : itemText(parts)
}

/** The first time a line was seen without an ID, by file and text: the debounce. */
const unnumberedAt = new Map<string, number>()

/**
 * Gives every unnumbered checkbox line of every trusted top-level todo file the next free ticket ID
 * (free project-wide: every folder, live and archive), after the line was seen without one for
 * NUMBER_AFTER_MS, so Claude's own edit is done first. The safe write is the archive move's: read,
 * compute, read again right before the write, write only if the text is unchanged, never through a
 * symlink or into the global folder, never from a file that did not read. A file that fails is left
 * for the next scan. True when any file was written. Claude is told once, with the next prompt.
 */
export async function numberTickets($: EngineInterface): Promise<boolean> {
  if (S.isNumbering || S.isWorking) {
    return false
  }
  S.isNumbering = true
  try {
    // A held lock skips this scan; the next one tries again.
    return (await tryWriteLock(() => numberPass($))) ?? false
  } finally {
    S.isNumbering = false
  }
}

/** The todo files whose numbering write failed and was told to the user: one toast each, until it works again. */
const numberFailed = new Set<string>()

/**
 * One numbering pass, under the writer lock. A file that fails (a write that throws) does not stop
 * the others, and the note for a file that was written is queued right after its write.
 */
async function numberPass($: EngineInterface): Promise<boolean> {
  const time = await $.clock.now()
  S.wallMs = time
  const me = await sessionOf($)
  // The IDs other sessions of this repo reserved count as taken, when the store reads. When it does not, numbering goes
  // on (a choice): the IDs come from this session's claimed block, which no session of a current build gives
  // from, so the store adds only the reservations of a session of an older build (one with no claims). An offer does
  // stop, as it names IDs to Claude before any file holds them.
  await syncReserved($)
  const seen = new Set<string>()
  // The disk read once per pass, when the first file needs numbers: a read for every file would scale with the file count.
  // The IDs this pass gives are reserved, so a later file never takes one the memo lacks.
  let onDiskOnce: string[] | undefined
  // The leading IDs of every ticket on the board: a line that only names one of them refers to it.
  const owned = new Set(S.todoFiles.flatMap(file => file.items.flatMap(item => leadingId(item.text) ?? [])).map(id => id.toLowerCase()))
  let wrote = 0
  for (const file of S.todoFiles) {
    const path = `${file.folder}/${file.name}`
    const taken: string[] = []
    try {
      if (file.isArchived === true || file.name.includes('/')) {
        continue
      }
      // Two non-leading lines naming one ID share a key: the file is read to number the later one.
      const trailing = file.items.filter(item => item.id !== undefined && leadingId(item.text) === undefined).map(item => item.id!.toLowerCase())
      if (file.items.every(item => item.id !== undefined && (leadingId(item.text) !== undefined || !owned.has(item.id.toLowerCase()))) && new Set(trailing).size === trailing.length) {
        continue
      }
      if (!(await isTrustedDir($, file.folder)) || !(await isPlainFile($, path))) {
        continue
      }
      const read = await readTodo($, path)
      if (read.kind !== 'ok') {
        continue
      }
      const text = read.text
      // A carriage return never reaches a match, and a line in a code fence is never a ticket.
      const lines = text.split('\n').map(bare)
      // The file's own grammar: a `.html` file has HTML checkbox items too.
      const kind = todoKind(file.name)
      const isFenced = lineMask(lines, kind)
      lines.forEach((line, index) => {
        const m = isFenced[index] === true ? undefined : itemParts(line, kind)
        const id = m === undefined ? undefined : leadingId(itemText(m))
        if (id !== undefined) {
          owned.add(id.toLowerCase())
        }
      })
      const own = lineOwnIds(lines, owned, kind)
      const at: number[] = []
      lines.forEach((line, index) => {
        const m = isFenced[index] === true ? undefined : itemParts(line, kind)
        if (m === undefined || m.text.trim() === '' || own[index] !== undefined) {
          return
        }
        const sign = `${path}\0${line}`
        seen.add(sign)
        unnumberedAt.set(sign, unnumberedAt.get(sign) ?? time)
        if (time - unnumberedAt.get(sign)! >= NUMBER_AFTER_MS) {
          at.push(index)
        }
      })
      if (at.length === 0) {
        continue
      }
      // At most NUMBER_MAX lines per file per pass, which one pick can give; the rest wait for the next pass.
      at.splice(NUMBER_MAX)
      // Every file read again from the disk, inside the lock: the board may be older than the files.
      onDiskOnce ??= await diskIds($)
      const onDisk = onDiskOnce
      // The IDs are chosen now, above the board, the disk, the IDs reserved at this moment (a prompt may have
      // named some while this pass awaited) and the file's own text, which may be newer than the board. They come
      // from this session's claimed block, as the prompt offers do, and `freeIds` records each pick with no await
      // between, so a prompt never names them; they stay reserved until a scan finds them in a file.
      pruneReserved(time)
      // From this session's claimed block, as the prompt offers' are: no block, and the file waits.
      const ids = await freeIds($, [...projectIds(), ...onDisk, ...reservedIds.keys(), ...lines.flatMap(line => lineIds(line, kind).map(id => id.toLowerCase()))], at.length)
      if (ids === undefined) {
        continue
      }
      ids.forEach(id => {
        reservedIds.set(id.toLowerCase(), { until: time + RESERVE_MS, by: me })
        taken.push(id.toLowerCase())
      })
      const next = insertIds(text, at, ids, kind)
      // Stored with the repo's reservations before the write, so another session's pass or prompt skips them too.
      // An ID another session took between the pick and this store write is lost to it: the file waits for the next scan.
      const lost = await syncReserved($)
      const isLost = lost?.some(id => taken.includes(id)) === true
      // The checks first, then the read and compare as the last call before the write (writeIfUnchanged).
      const put = isLost ? undefined : await writeIfUnchanged($, path, text, next)
      if (put?.kind !== 'written') {
        const back = [...taken]
        taken.forEach(id => reservedIds.delete(id))
        // Not written: the IDs go back to this session's block, so the next pass gives them again (not one the store gives another session).
        if (!isLost) {
          back.forEach(id => givenIds.delete(id))
        }
        await syncReserved($, back)
        continue
      }
      taken.length = 0
      const place = file.rel === undefined ? file.name : `${file.rel}/${file.name}`
      S.pendingNumbered = [...S.pendingNumbered, ...at.map((index, i) => numberedLine(place, ids[i]!, textAt(lines[index]!, kind)))]
      await saveToldNotes($)
      numberFailed.delete(path)
      wrote += 1
    } catch (error) {
      // The IDs of a write that did not happen go back; the file is tried again at the next scan.
      const back = [...taken]
      taken.forEach(id => reservedIds.delete(id))
      back.forEach(id => givenIds.delete(id))
      await syncReserved($, back)
      // A file that did not read is named itself, not the file being numbered.
      if (error instanceof TodoReadError) {
        if (!unreadToasted.has(error.path)) {
          unreadToasted.add(error.path)
          showToast($, `Could not number the tickets: ${error.message}`)
        }
      } else if (!numberFailed.has(path)) {
        numberFailed.add(path)
        showToast($, `Could not number the tickets in ${path}: ${reasonOf(error)}`)
      }
    }
  }
  for (const sign of [...unnumberedAt.keys()]) {
    if (!seen.has(sign)) {
      unnumberedAt.delete(sign)
    }
  }

  return wrote > 0
}
