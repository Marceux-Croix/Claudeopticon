/** The category book: its file, its backups and its safe load. */

import type { EngineInterface } from 'claude-code'
import { addFailure, isRetryDue } from './backoff'
import type { Failing } from './backoff'
import { bookBackups, emptyBook, readBook, SORT_EVERY_MS } from './categories'
import { fsBounded } from './fs-bounds'
import { nowSync } from './pane-clock'
import { hasEntry, isPlainFile, isTrustedDir } from './path-trust'
import { S } from './state'
import { showToast } from './toasts'

/** The failures in a row after which the sort says so once. */
const SORT_FAILS_TO_TOAST = 3

/** Counts a failed sort and, at SORT_FAILS_TO_TOAST in a row, says once why: a sort that fails for good would otherwise leave the tickets unsorted with no word. */
export function sortFailed($: EngineInterface, why: string): void {
  S.sortFailures += 1
  if (S.sortFailures >= SORT_FAILS_TO_TOAST && !S.isSortToastShown) {
    S.isSortToastShown = true
    showToast($, `Sorting into categories failed ${S.sortFailures} times in a row (${why}). The tickets stay unsorted; it is tried again later.`)
  }
}

/** The wait before the next sort: 30 s, doubled for each failure in a row. */
export function sortWaitMs(): number {
  return SORT_EVERY_MS * 2 ** Math.min(S.sortFailures, 6)
}

/**
 * Whether `categories.json` in the folder may be read or written: the folder is trusted (its own real
 * path, inside the checkout, not the global one) and the file is either not there or a plain file.
 * A symlink at that name (a repo can commit one) is never followed.
 */
export async function isBookSafe($: EngineInterface, folder: string): Promise<boolean> {
  const path = `${folder}/categories.json`

  return (await isTrustedDir($, folder)) && (!(await hasEntry($, path)) || (await isPlainFile($, path)))
}

/**
 * Reads the book from `categories.json` in the primary folder. Three outcomes, kept apart:
 * no file, or a file that reads and parses: the book is that, and the folder is set. A file that reads
 * but does not parse: a copy goes to the first free of the numbered backup names (`categories.json.bak`,
 * `.bak.2`, ...) first, then the book starts over. A file
 * that does not read at all: the book in memory stays as it is and `bookDir` is cleared, so no sort
 * runs and nothing is written until a later scan reads the file.
 */
export async function loadBook($: EngineInterface, folder: string | undefined, isFull = false): Promise<void> {
  if (folder === S.bookDir && !isFull) {
    return
  }
  if (S.isSorting) {
    return
  }
  await readBookFile($, folder)
}

/** The text of a book file now: null when there is none, undefined when it cannot be told (a failed check or read). */
async function bookOnDisk($: EngineInterface, path: string): Promise<string | null | undefined> {
  const exists = await fsBounded($, () => $.fs.exists(path)).then(is => is, () => undefined)
  if (exists !== true) {
    return exists === false ? null : undefined
  }
  try {
    const text: unknown = await fsBounded($, () => $.fs.read(path))

    return typeof text === 'string' ? text : ''
  } catch {
    return undefined
  }
}

/**
 * True when `categories.json` is no longer the text the book came from: a user edit, a
 * `git pull` or a branch switch. The book is then read again from the file and the caller skips its
 * write, so the change is kept; the next sort works on the book as read. A file that cannot be read
 * now counts as changed, and the read clears `bookDir`, so nothing is written.
 */
export async function isBookChanged($: EngineInterface, folder: string): Promise<boolean> {
  const now = await bookOnDisk($, `${folder}/categories.json`)
  if (now !== undefined && now === S.bookSeen) {
    return false
  }
  await readBookFile($, folder)

  return true
}

/** The body of `loadBook` with no guard, also the reload after a change on disk. */
async function readBookFile($: EngineInterface, folder: string | undefined): Promise<void> {
  // A folder or file that is not safe (a symlink at the book's name, an untrusted folder) is not read: no book, no sort, no write.
  if (folder !== undefined && !(await isBookSafe($, folder))) {
    S.bookDir = undefined
    S.book = emptyBook()

    return
  }
  const path = `${folder}/categories.json`
  const raw = folder === undefined ? null : await bookOnDisk($, path)
  if (raw === undefined) {
    S.bookDir = undefined

    return
  }
  S.bookSeen = raw
  if (raw === null) {
    S.bookDir = folder
    S.book = emptyBook()

    return
  }
  const read = readBook(raw)
  if (read !== undefined) {
    S.book = read
    S.bookDir = folder

    return
  }
  // A damaged file (not JSON, or JSON of another shape) starts the book over, but the next
  // sort overwrites it: keep a copy first, under the first backup name with nothing at it, so an older
  // copy is never written over and a symlink at a backup name is never written through.
  // With no copy made, the file is left alone and the next scan tries again.
  S.book = emptyBook()
  S.bookDir = raw.trim() === '' ? folder : await backUpBook($, path, raw).then(isKept => (isKept ? folder : undefined), () => undefined)
}

/** True once the user was told that every backup name of a damaged book is taken. */
let backupsFullToasted = false

/** True once the user was told that the folder of a damaged book cannot be listed. */
let backupsListToasted = false

/** The first wait after a failed backup write of a damaged book, and the longest: 5 s doubling to 10 min. */
const BACKUP_RETRY_MS = 5000

const BACKUP_RETRY_MAX_MS = 10 * 60_000

/** The backup writes of a damaged book that failed in a row, and the time of the next try. */
let backupFailing: Failing | undefined

/** True once the user was told that a backup write failed; cleared when one works. */
let backupWriteToasted = false

/**
 * Writes a copy of a damaged book to the first free backup name (`bookBackups`). False when every name
 * is taken: the book is then left alone, so no sort runs, and a toast says so once. False too when the
 * write fails (a read-only folder, a full disk): one toast names the error, and the next try
 * waits (BACKUP_RETRY_MS, doubled per failure in a row) instead of coming with every scan.
 */
async function backUpBook($: EngineInterface, path: string, raw: string): Promise<boolean> {
  if (!isRetryDue(backupFailing, nowSync(), BACKUP_RETRY_MAX_MS)) {
    return false
  }
  try {
    return await backUpBookNow($, path, raw)
  } catch (error) {
    backupFailing = addFailure(backupFailing, nowSync(), BACKUP_RETRY_MS, BACKUP_RETRY_MAX_MS)
    if (!backupWriteToasted) {
      backupWriteToasted = true
      showToast($, `${path} is damaged and its backup could not be written (${error instanceof Error ? error.message : String(error)}), so it is left as it is and nothing is sorted. The backup is tried again later.`)
    }

    return false
  }
}

/** The body of `backUpBook`, with no retry wait: a write or check that throws goes up to it. */
async function backUpBookNow($: EngineInterface, path: string, raw: string): Promise<boolean> {
  const names = bookBackups(path)
  // A folder that will not list would make every name look taken (hasEntry answers yes): say the true cause instead.
  const dir = path.slice(0, path.lastIndexOf('/'))
  if ((await fsBounded($, () => $.fs.list(dir)).catch(() => undefined)) === undefined) {
    if (!backupsListToasted) {
      backupsListToasted = true
      showToast($, `${path} is damaged and ${dir} cannot be listed, so no backup can be made. It is left as it is and nothing is sorted.`)
    }

    return false
  }
  for (const name of names) {
    if (!(await hasEntry($, name))) {
      await $.fs.write(name, raw)
      backupFailing = undefined
      backupWriteToasted = false

      return true
    }
  }
  if (!backupsFullToasted) {
    backupsFullToasted = true
    showToast($, `${path} is damaged and its ${names.length} backup names are taken, so it is left as it is and nothing is sorted. Remove an old backup to sort again.`)
  }

  return false
}
