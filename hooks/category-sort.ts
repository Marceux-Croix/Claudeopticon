/** Sorting tickets into categories through the model, and Recategorize. */

import type { EngineInterface } from 'claude-code'
import { clock } from './card-format'
import { applySortReply, bookKeptBy, categoryOf, emptyBook, isSubstantialChange, mergeRecategorized, pruneBookItems, SORT_BATCH, SORT_BATCHES, SORT_MODEL, SORT_TRIES, sortPrompt, usedCategories } from './categories'
import type { CategoryBook } from './categories'
import { elapsedSince } from './clock-elapsed'
import { keptKey } from './item-keys'
import { addAloneTry, isItemsFailure, nextBatchSize, nextSortBatch, nextThrows, sortReplyKind, THROWS_TO_HALVE } from './sort-queue'
import { ticketSummary } from './ticket-prompts'
import { foldersWithUnread } from './unread-folders'
import { isBookChanged, isBookSafe, sortFailed, sortWaitMs } from './category-book'
import { NOTE_MS } from './pane-constants'
import { redraw } from './pane-redraw'
import { S, sortAlone, sortTries } from './state'
import { showToast } from './toasts'

/**
 * Asks the model to sort the open items that have no category yet: batch after batch, up to
 * SORT_BATCHES batches in one run (so the first scan sorts most folders whole), then again at most
 * every 30 s.
 */
export async function sortItems($: EngineInterface): Promise<void> {
  const time = await $.clock.now()
  // Timed with elapsedSince: a clock set back restarts the wait, it never stops the sort for the length of the set-back.
  const sinceSort = S.lastSortAt === undefined ? undefined : elapsedSince(S.lastSortAt, time)
  S.lastSortAt = sinceSort?.from
  if (S.bookDir === undefined || S.isSorting || (sinceSort !== undefined && sinceSort.ms < sortWaitMs())) {
    return
  }
  const open = S.todoFiles
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map(item => ({ item, key: keptKey(file, item) })))
    .filter(one => one.item.status !== 'completed' && categoryOf(S.book, one.key) === undefined)
    // An item the model has twice failed to sort stays unsorted until its text changes.
    .filter(one => {
      const tried = sortTries.get(one.key)

      return tried === undefined || tried.text !== one.item.text || tried.count < SORT_TRIES
    })
  const unsorted = [...new Map(open.map(one => [one.key, one.item.text])).entries()]
  if (unsorted.length === 0) {
    return
  }
  S.isSorting = true
  S.lastSortAt = time
  try {
    // No model call for a book that could not be saved: the folder or file is not safe to write.
    if (!(await isBookSafe($, S.bookDir))) {
      return
    }
    for (const key of [...sortAlone.keys()]) {
      if (!unsorted.some(([one]) => one === key)) {
        sortAlone.delete(key)
      }
    }
    let queue = unsorted
    for (let call = 0; call < SORT_BATCHES; call += 1) {
      const batch = nextSortBatch(queue, sortAlone, S.sortBatchSize)
      if (batch.length === 0) {
        break
      }
      queue = queue.filter(one => !batch.includes(one))
      let reply: { isAnswered: boolean; text?: string; reason?: string; status?: unknown } | undefined
      let isThrown = false
      let failure = 'the model call failed'
      try {
        reply = (await $.model.complete({ model: SORT_MODEL, prompt: sortPrompt(S.book.categories, batch.map(([, text]) => text)), maxTokens: 4000 })) as typeof reply
      } catch (error) {
        reply = undefined
        isThrown = true
        failure = error instanceof Error ? error.message : String(error)
      }
      const kind = sortReplyKind(reply)
      if (kind === 'failed') {
        // The model call failed: wait longer before the next try.
        sortFailed($, reply?.reason === undefined || reply.reason === '' ? failure : reply.reason)
        // A throw, or an HTTP 4xx answer (a 400, a 413), may be the items' fault: the second
        // in a row for the same batch halves it, and a lone item goes last, with no try counted, so the
        // queue moves past it. A transport or capacity failure (no status, 5xx, 429, an abort) only waits.
        if (isItemsFailure(reply, isThrown)) {
          S.sortThrows = nextThrows(S.sortThrows, batch.map(([key]) => key).join('\u0000'))
          if (S.sortThrows.count >= THROWS_TO_HALVE) {
            S.sortThrows = undefined
            if (batch.length === 1) {
              sortAlone.delete(batch[0]![0])
              sortAlone.set(batch[0]![0], batch[0]![1])
            } else {
              S.sortBatchSize = nextBatchSize(Math.min(S.sortBatchSize, batch.length), false)
            }
          }
        }

        break
      }
      S.sortThrows = undefined
      // An empty reply (a refusal, no text) is read like one that does not parse: the items may be the cause.
      // The write drops the items of tickets gone from every file.
      const next = kind === 'text' ? applySortReply(pruneBookItems(S.book, bookKeep()), batch.map(([key]) => key), reply?.text ?? '') : undefined
      if (next === undefined) {
        // A reply that does not parse is the model's fault, not the items': it waits longer, as a failed call does, and counts against no item in a batch of more than one.
        // The next call carries half the items, so one item that never gets a readable reply ends up alone and last, and the queue moves past it.
        sortFailed($, 'the reply could not be read')
        if (batch.length === 1) {
          const [key, text] = batch[0]!
          // Set again at the end of the order: the other lone items go first next time.
          sortAlone.delete(key)
          sortAlone.set(key, text)
          // An item that fails alone SORT_TRIES times is tried for the session: it is not sent again until its text changes, so a poison item costs no call for good.
          const tried = addAloneTry(sortTries.get(key), text)
          sortTries.set(key, tried)
          if (tried.count >= SORT_TRIES) {
            sortAlone.delete(key)
            showToast($, `Not sorted: no readable reply for "${ticketSummary(text, 60)}" when sent alone. It stays unsorted until its text changes.`)
          }
        } else {
          S.sortBatchSize = nextBatchSize(Math.min(S.sortBatchSize, batch.length), false)
        }

        break
      }
      S.sortBatchSize = nextBatchSize(S.sortBatchSize, true)
      for (const [key] of batch) {
        sortAlone.delete(key)
      }
      for (const [key, text] of batch) {
        // Only a reply that parses but leaves an item out counts a try against it.
        if (categoryOf(next, key) === undefined) {
          const tried = sortTries.get(key)
          sortTries.set(key, { text, count: tried !== undefined && tried.text === text ? tried.count + 1 : 1 })
        } else {
          sortTries.delete(key)
        }
      }
      if (S.bookDir === undefined) {
        break
      }
      // The last check before the write: never through a symlink, never into an untrusted folder.
      if (!(await isBookSafe($, S.bookDir))) {
        break
      }
      // The file changed since the book was read: it is read again and this reply is dropped, so the change is never written over.
      if (await isBookChanged($, S.bookDir)) {
        redraw($)

        break
      }
      // Write first, then keep: a failed write leaves the book as the file has it.
      const written = `${JSON.stringify(next, null, 2)}\n`
      try {
        await $.fs.write(`${S.bookDir}/categories.json`, written)
      } catch (error) {
        sortFailed($, `categories.json could not be written: ${error instanceof Error ? error.message : String(error)}`)

        break
      }
      S.sortFailures = 0
      S.isSortToastShown = false
      S.book = next
      S.bookSeen = written
      redraw($)
    }
  } finally {
    S.isSorting = false
  }
}

/**
 * Which book keys a write keeps: the keys of the items of every live and archived file
 * the scan read, and every key of a folder that did not read whole: one that this discovery left
 * out (git failed, an exists check failed), one that lists a linked todo file, or one that holds a
 * place the scan could not read (`bookKeptBy`): an item in it is not known to be gone. Only that
 * folder keeps every key: one unread file never stops the pruning of the other folders.
 */
export function bookKeep(): (key: string) => boolean {
  const keys = new Set(S.todoFiles.flatMap(file => file.items.map(item => keptKey(file, item))))
  const unreadAt = foldersWithUnread(S.unreadPlaces, S.scanFolders)
  const whole = S.scanFolders.filter(folder => !S.linkedFolders.has(folder.folder) && !unreadAt.has(folder.folder))

  return bookKeptBy(keys, { others: whole.filter(folder => folder.isOther === true).map(folder => folder.rel ?? folder.folder), hasPrimary: whole.some(folder => folder.isOther !== true) })
}

/** The open items of the live files, once each by key: [key, text]. */
export function openItems(): [string, string][] {
  const open = S.todoFiles
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map(item => ({ item, key: keptKey(file, item) })))
    .filter(one => one.item.status !== 'completed')

  return [...new Map(open.map(one => [one.key, one.item.text])).entries()]
}

/**
 * The Recategorize button: asks the model to sort every open ticket from scratch (the sort prompt,
 * batch after batch, ignoring the current assignments), then keeps the result only when it is a
 * real change. Otherwise the current categories stay, and a note says so. A model failure leaves
 * everything as it was.
 */
export async function recategorize($: EngineInterface): Promise<void> {
  const open = openItems()
  if (S.isRecategorizing || S.isSorting || open.length === 0) {
    return
  }
  S.isRecategorizing = true
  S.isSorting = true
  S.recatNote = undefined
  redraw($)
  let text: string | undefined = 'Could not recategorize'
  try {
    if (S.bookDir === undefined) {
      throw new Error('no book folder')
    }
    let fresh: CategoryBook = emptyBook()
    // At most SORT_BATCHES batches: the tickets past them are sorted afterwards by the
    // normal sort, into the new categories. A batch that fails is asked once more; if it fails
    // again nothing is written, since a part of the tickets cannot be judged as the whole.
    const covered = open.slice(0, SORT_BATCH * SORT_BATCHES)
    for (let from = 0; from < covered.length; from += SORT_BATCH) {
      const batch = covered.slice(from, from + SORT_BATCH)
      let next: CategoryBook | undefined
      let why = 'unreadable reply'
      for (let attempt = 0; attempt < 2 && next === undefined; attempt += 1) {
        try {
          const reply = await $.model.complete({ model: SORT_MODEL, prompt: sortPrompt(fresh.categories, batch.map(([, one]) => one)), maxTokens: 4000 })
          next = reply.isAnswered ? applySortReply(fresh, batch.map(([key]) => key), reply.text) : undefined
          why = reply.isAnswered ? 'unreadable reply' : 'no answer from the model'
        } catch (error) {
          why = error instanceof Error ? error.message : String(error)
        }
      }
      if (next === undefined) {
        throw new Error(why)
      }
      fresh = next
    }
    const keys = covered.map(([key]) => key).filter(key => categoryOf(fresh, key) !== undefined)
    if (keys.length === 0) {
      throw new Error('nothing sorted')
    }
    // Groups the model named but gave no ticket are dropped, so they do not count as groups; a group
    // only tickets past the covered ones hold stays, so the merge keeps their category.
    fresh = { categories: usedCategories(S.book, fresh, keys, open.slice(covered.length).map(([key]) => key)), items: fresh.items }
    if (isSubstantialChange(S.book, fresh, keys)) {
      // The tickets past the covered ones keep their saved category where it is still a category.
      fresh = mergeRecategorized(pruneBookItems(S.book, bookKeep()), fresh, covered.map(([key]) => key))
      if (!(await isBookSafe($, S.bookDir))) {
        throw new Error('the categories file is not safe to write')
      }
      // A file changed since it was read is read again and kept: the new sort is not written over it.
      if (await isBookChanged($, S.bookDir)) {
        throw new Error('categories.json changed on disk, so it was read again. Press again to sort its categories')
      }
      // Write first, then keep: a failed write leaves the book, and the pane, as they were.
      const written = `${JSON.stringify(fresh, null, 2)}\n`
      await $.fs.write(`${S.bookDir}/categories.json`, written)
      S.book = fresh
      S.bookSeen = written
      text = undefined
    } else {
      text = 'The current categories are correct'
    }
  } catch (error) {
    text = `Could not recategorize: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    S.isRecategorizing = false
    S.isSorting = false
    S.recatNote = text === undefined ? undefined : { text, until: (await $.clock.now()) + NOTE_MS }
    redraw($)
  }
}
