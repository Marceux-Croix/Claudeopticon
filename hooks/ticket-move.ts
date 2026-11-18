/** Moving a ticket to a status, by the move_ticket tool or a press on the board. */

import type { EngineInterface } from 'claude-code'
import type { ItemStatus, ItemView } from './card-types'
import { moveLine, noteName, quoteName, quoteTicket } from './claude-notes'
import { itemKey, keptKey } from './item-keys'
import { ticketId } from './peer-sessions'
import { isDrawnLine, setBox, statusNamed, STATUS_WORDS } from './ticket-boxes'
import { todoKind } from './todo-file-names'
import { findTickets, narrowTickets } from './ticket-lookup'
import { moveQuestion, ticketSummary } from './ticket-prompts'
import { readReason, TodoReadError } from './todo-read'
import { withWriteLock } from './write-lock'
import { planTickets } from './orchestrator-tickets'
import { redraw } from './pane-redraw'
import { isPlainFile, isTrustedDir } from './path-trust'
import { S, claimMissedAt, orchTickets } from './state'
import { showToast } from './toasts'
import { readStrict, readTodo, writeIfUnchanged } from './todo-io'
import { placeOfLine, scan } from './todo-scan'

/** Every item the user moved by hand this session, by `file:key`, with the box they gave it. */
const userMoves = new Map<string, ItemStatus>()

/** Answers a move_ticket call: asks the user, and writes the box only on a yes. */
export async function moveTicket($: EngineInterface, input: Record<string, unknown>, isMain = false): Promise<string> {
  const ref = typeof input.item === 'string' ? input.item : ''
  const to = statusNamed(input.to)
  const reason = typeof input.reason === 'string' ? input.reason : ''
  if (to === undefined) {
    return 'Not moved: "to" must be open, queued, in_progress or done.'
  }
  // A scan that throws read nothing new, so the unread places of an older pass say nothing about this one.
  const isScanned = await scan($).then(
    () => true,
    () => false,
  )
  const all = findTickets(S.todoFiles, ref)
  if (all.length === 0) {
    // Not found in what did not read is not "no match": adding the item again would make a duplicate.
    if (!isScanned) {
      return `Not moved: could not read the todo folders, so it is not known whether ${quoteName(ref)} is there. Nothing was changed. Try again later; do not add the item again.`
    }
    if (S.unreadPlaces.length > 0) {
      return `Not moved: could not read ${S.unreadPlaces.map(quoteName).join(', ')}, so it is not known whether ${quoteName(ref)} is there. Nothing was changed. Try again later; do not add the item again.`
    }

    return `Not moved: no live todo item matches ${quoteName(ref)}. Add the item to .claude_todo/ first.`
  }
  const where = typeof input.folder === 'string' ? input.folder.trim() : ''
  const hits = where === '' ? all : narrowTickets(all, where)
  if (hits.length === 0) {
    return `Not moved: ${quoteName(ref)} has no match in ${quoteName(where)}. Matches are in: ${[...new Set(all.map(one => quoteName(`${one.rel}/${one.file}`)))].join(', ')}.`
  }
  const places = [...new Set(hits.map(one => quoteName(`${one.rel}/${one.file}`)))]
  if (places.length > 1) {
    return `Not moved: ${quoteName(ref)} matches items in more than one file (${places.join(', ')}). Call move_ticket again with folder set to one of these paths.`
  }
  const found = hits[0]!
  const { file, folder, rel, item } = found
  // The path as the dialog names it, with no control characters, and as the answers to Claude quote it; the file calls use folder and file.
  const path = noteName(`${rel}/${file}`)
  const quoted = quoteName(`${rel}/${file}`)
  if (item.status === to) {
    // A ticket whose box is already open or queued can still show in In progress under the main conversation's claim:
    // moving it there ends that claim, with no write and no question, since the box does not change.
    const todo = S.todoFiles.find(one => one.folder === folder && one.name === file)
    const claimKey = todo === undefined ? undefined : keptKey(todo, item)
    if ((to === 'pending' || to === 'queued') && claimKey !== undefined && orchTickets.delete(claimKey)) {
      claimMissedAt.delete(claimKey)
      redraw($)

      return `Released: ${quoteTicket(item.text, 80)} was already ${STATUS_WORDS[to]} in the file; the main conversation's claim on it is cleared, so the board shows it ${STATUS_WORDS[to]} again.`
    }

    return `Not moved: ${quoteTicket(item.text, 80)} is already ${STATUS_WORDS[to]}.`
  }
  const key = `${folder}/${file}:${itemKey(item)}`
  const yes = 'Move it'
  // A dialog that could not be shown is no answer: the user has not decided, so it is not read as "kept".
  const asked = await $.ui
    .ask(moveQuestion(path, item, to, reason, userMoves.has(key)), { options: [yes, 'Keep it where it is'], header: 'Ticket' })
    .then(
      (value): { value: string | undefined } => ({ value }),
      () => undefined,
    )
  if (asked === undefined) {
    return `Not moved: the confirmation could not be shown, so the user has not decided about ${quoteTicket(item.text, 80)}. Try again later.`
  }
  const answer = asked.value
  if (answer !== yes) {
    return `Not moved: the user kept ${quoteTicket(item.text, 80)} ${STATUS_WORDS[item.status]}${answer === undefined || answer === 'Keep it where it is' ? '' : ` and said: ${answer}`}. Do not move it again unless the user asks.`
  }
  // The file is read again under the writer lock and only this one box changes in the fresh text.
  const isWritten = await withWriteLock(async () => {
    // Never through a symlink, never outside the checkout or into the global folder.
    if (!(await isTrustedDir($, folder)) || !(await isPlainFile($, `${folder}/${file}`))) {
      return { isUnsafe: true } as const
    }
    const read = await readTodo($, `${folder}/${file}`)
    if (read.kind !== 'ok') {
      return readReason(read)
    }
    // The line the key names must still be the one the board found: a place number moves when a line above it goes,
    // and identical lines in two sections differ by their place (the heading above and the rank under it).
    if (!isDrawnLine(read.text, itemKey(item), { text: item.text, status: item.status, ...placeOfLine(`${folder}/${file}`, itemKey(item)) }, todoKind(file))) {
      return { isMoved: true } as const
    }
    const next = setBox(read.text, itemKey(item), to, undefined, todoKind(file))
    if (next === undefined) {
      return false
    }
    // A failed write is an answer, not a tool error. The checks, then the read and compare, then the write.
    try {
      const put = await writeIfUnchanged($, `${folder}/${file}`, read.text, next, { folder })
      if (put.kind === 'changed') {
        return { isMoved: true } as const
      }
      if (put.kind === 'unsafe' || put.kind === 'refused') {
        return { isUnsafe: true } as const
      }
      if (put.kind === 'unread') {
        return put.reason
      }
    } catch (error) {
      return { writeError: error instanceof Error ? error.message : String(error) }
    }

    return true
  })
  if (typeof isWritten === 'object' && 'writeError' in isWritten) {
    return `Not moved: ${quoted} could not be written (${noteName(isWritten.writeError ?? 'unknown error')}). The user approved the move; try again.`
  }
  if (typeof isWritten === 'object' && 'isMoved' in isWritten) {
    return `Not moved: the line of ${quoteTicket(item.text, 80)} in ${quoted} changed since the board read it. Nothing was written; call move_ticket again.`
  }
  if (typeof isWritten === 'object') {
    return `Not moved: ${quoted} is not safe to change (a symlink, or outside this repo). Nothing was written.`
  }
  if (typeof isWritten === 'string') {
    return `Not moved: ${quoted} could not be read (${noteName(isWritten)}). Nothing was changed.`
  }
  if (!isWritten) {
    return `Not moved: the line for ${quoteTicket(item.text, 80)} was not found in ${quoted}.`
  }
  userMoves.delete(key)
  await scan($).catch(() => undefined)
  // A move to queued the main conversation asked for and the user approved plans the ticket; a helper's ask does not.
  if (isMain && to === 'queued') {
    const todo = S.todoFiles.find(one => one.folder === folder && one.name === file)
    if (todo !== undefined) {
      planTickets($, [ticketId(todo, item)])
    }
  }

  return `Moved with the user's approval: ${quoteTicket(item.text, 80)} is now ${STATUS_WORDS[to]} in ${quoted}.`
}

/** Writes a manual move into the item's todo file, rereads the folder, and queues the note for Claude. */
export async function markTicket($: EngineInterface, item: ItemView, status: ItemStatus, toast: string): Promise<void> {
  // An archived item never reaches here: the pane gives it no button (removed that check).
  if (item.folder === undefined || item.file === undefined) {
    return
  }
  // Only the file the item came from is written: its folder and its name. The pane shows neither.
  const folder = item.folder
  const path = `${folder}/${item.file}`
  // Read again under the writer lock: the one box changes in the fresh text, never in a stale copy.
  let isWritten: boolean | 'unsafe' | 'moved'
  try {
    isWritten = await withWriteLock(async () => {
      // Never through a symlink, never outside the checkout or into the global folder.
      if (!(await isTrustedDir($, folder)) || !(await isPlainFile($, path))) {
        return 'unsafe' as const
      }
      const text = await readStrict($, path)
      const key = item.localKey ?? item.key
      // The press writes only the line the board drew: the same text and box. A board that is out of
      // date (a line added or removed above identical lines moves their place numbers) is refused, never the neighbor written.
      // Identical lines in two sections differ by their place: the heading above and the rank under it.
      if (!isDrawnLine(text, key, { text: item.text, status: item.heldFrom ?? item.status, ...placeOfLine(path, key) }, todoKind(path))) {
        return 'moved' as const
      }
      const next = setBox(text, key, status, undefined, todoKind(path))
      if (next === undefined) {
        return false
      }
      // The checks, then the read and compare as the last call before the write. A read that fails throws, as the first one does.
      const put = await writeIfUnchanged($, path, text, next, { folder })
      if (put.kind === 'unread') {
        throw new TodoReadError(path, put.reason)
      }

      return put.kind === 'written' ? true : put.kind === 'changed' ? ('moved' as const) : ('unsafe' as const)
    })
  } catch (error) {
    showToast($, `Could not move ${ticketSummary(item.text, 60)}: ${error instanceof Error ? error.message : String(error)}`)

    return
  }
  if (isWritten === 'unsafe') {
    showToast($, `Not changed, ${item.file} is not safe to write (a symlink, or outside this repo): ${ticketSummary(item.text, 60)}`)

    return
  }
  if (isWritten === 'moved') {
    showToast($, `Not changed, the line changed in ${item.file} since the board drew it: ${ticketSummary(item.text, 60)}. Press again on the updated board.`)
    await scan($).catch(() => undefined)

    return
  }
  if (!isWritten) {
    showToast($, `Not found in ${item.file}: ${ticketSummary(item.text, 60)}`)

    return
  }
  userMoves.set(`${path}:${item.localKey ?? item.key}`, status)
  S.pendingMoves = [...S.pendingMoves, moveLine(item.text, item.path ?? path, STATUS_WORDS[item.heldFrom ?? item.status], STATUS_WORDS[status])]
  showToast($, `${toast}: ${ticketSummary(item.text, 60)}`)
  // The box is written: a scan that fails must not make the press read as failed.
  await scan($).catch(() => undefined)
}
