/** The notes of tickets that were stopped, claimed or deferred, queued for Claude. */

import type { EngineInterface } from 'claude-code'
import type { TodoItem } from '../types'
import { moveLine, quoteName, quoteTicket } from './claude-notes'
import { filePath, itemKey, keptKey } from './item-keys'
import { ticketId } from './peer-sessions'
import { setBox, STATUS_WORDS } from './ticket-boxes'
import { todoKind } from './todo-file-names'
import { withWriteLock } from './write-lock'
import { deferredIds } from './deferred-tickets'
import { filesAt, planTickets } from './orchestrator-tickets'
import { isPlainFile, isTrustedDir } from './path-trust'
import { S } from './state'
import { readStrict, writeIfUnchanged } from './todo-io'
import { scan } from './todo-scan'

/** The most characters of one model step's text read for deferred tickets: a reply past it is read only to there. */
export const SAID_CHARS = 20_000

/** The tickets already named in a deferred note this session, by item key: each is named once. */
const deferredNamed = new Set<string>()

/**
 * Writes `- [>]` for the tickets of the file at `path` whose kept key is in `keys`: the ones the main
 * conversation's edit took from in progress to open (stoppedKeys). Under the writer lock, from a fresh
 * read; a box that changed since is left. Each queued ticket goes in the stopped note for Claude.
 */
export async function queueStopped($: EngineInterface, path: string, keys: readonly string[]): Promise<void> {
  const file = filesAt(path)[0]
  if (file === undefined) {
    return
  }
  const wanted = new Set(keys)
  const items = file.items.filter(item => wanted.has(keptKey(file, item)))
  const target = `${file.folder}/${file.name}`
  // Why the queueing could not be written, when it could not: Claude is told, as the ticket stays at the open box its own edit set.
  const failed: { reason?: string } = {}
  const written = await withWriteLock(async () => {
    if (!(await isTrustedDir($, file.folder)) || !(await isPlainFile($, target))) {
      return []
    }
    const text = await readStrict($, target)
    let next = text
    const done: TodoItem[] = []
    for (const item of items) {
      const changed = setBox(next, itemKey(item), 'queued', { text: item.text, status: 'pending' }, todoKind(file.name))
      if (changed !== undefined) {
        next = changed
        done.push(item)
      }
    }
    if (done.length === 0) {
      return []
    }
    const put = await writeIfUnchanged($, target, text, next, { folder: file.folder })
    // A box that changed since the read is left as the other writer made it: that is no failure.
    if (put.kind !== 'written' && put.kind !== 'changed') {
      failed.reason = 'reason' in put ? put.reason : 'the write was refused'
    }

    return put.kind === 'written' ? done : []
  }).catch((error: unknown) => {
    failed.reason = error instanceof Error ? error.message : String(error)

    return [] as TodoItem[]
  })
  if (failed.reason !== undefined) {
    const lines = items.map(item => `${quoteTicket(item.text, 160)} in ${quoteName(path)} stayed open: the Claudeopticon pane could not set it to queued (${failed.reason}). If you still plan it soon, set its box to \`- [>]\` yourself.`)
    S.pendingClaimed = [...S.pendingClaimed, ...lines]
  }
  if (written.length > 0) {
    S.pendingStopped = [...S.pendingStopped, ...written.map(item => moveLine(item.text, path, STATUS_WORDS.in_progress, STATUS_WORDS.queued))]
    await scan($).catch(() => undefined)
    // The main conversation took these out of progress and still means to work them: planned. After the scan, so a prune never sees the old box.
    planTickets($, written.map(item => ticketId(file, item)))
  }
}

/** Queues a deferred note for each open ticket that `text`, the main conversation's reply, puts off until later; each ticket once a session. */
export function noteDeferred(text: string): void {
  const ids = new Set(deferredIds(text))
  if (ids.size === 0) {
    return
  }
  for (const file of S.todoFiles.filter(one => one.isArchived !== true)) {
    for (const item of file.items) {
      const key = keptKey(file, item)
      if (item.status === 'pending' && item.id !== undefined && ids.has(item.id.toUpperCase()) && !deferredNamed.has(key)) {
        deferredNamed.add(key)
        S.pendingDeferred = [...S.pendingDeferred, `- ${quoteTicket(item.text, 160)} in ${quoteName(filePath(file))}`]
      }
    }
  }
}
