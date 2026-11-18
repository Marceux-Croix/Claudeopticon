/** The ticket IDs on the disk, read from every todo file, with the files that did not read. */

import type { EngineInterface } from 'claude-code'
import { textIds } from './numbering'
import { todoKind } from './todo-file-names'
import { TodoReadError } from './todo-read'
import { isSkipped, nextStreak } from './unread-files'
import type { UnreadStreak } from './unread-files'
import { S, seenIdsOf, unreadToasted } from './state'
import { showToast } from './toasts'
import { mdFiles, readTodo } from './todo-io'

/** The todo files that failed to read when IDs were chosen, by path: how many passes in a row, and why. */
const unreadStreaks = new Map<string, UnreadStreak>()

/** The skipped files already named in a toast: once each, until the file reads again. */
const skipToasted = new Set<string>()

/**
 * Every item ID held by every `.md` or `.html` file of every known folder (top level and archive), read from the
 * disk now, lowercase. A folder that will not list is an error. A file that will not read is an error
 * that names it (`TodoReadError`), never an empty file: an ID it holds would be given again.
 * Once a file failed SKIP_AFTER scan passes in a row (for any reason), it is skipped, with one toast, and
 * counts as every ID it held at any good read in this load, so the new IDs go above those; one file
 * that stopped reading no longer stops every ID. A good read is one of this step or the board's scan. A file
 * with no good read in this load is never skipped: what it holds is not known, so it stays an error,
 * with one toast that says why. A file that is gone (a dangling link) holds none.
 */
export async function diskIds($: EngineInterface): Promise<string[]> {
  const ids: string[] = []
  const take = async (path: string): Promise<string[] | undefined> => {
    const read = await readTodo($, path)
    if (read.kind === 'ok') {
      const found = textIds(read.text, todoKind(path))
      ids.push(...found)
      seenIdsOf.set(path, new Set([...(seenIdsOf.get(path) ?? []), ...found]))
      unreadStreaks.delete(path)
      skipToasted.delete(path)
      unreadToasted.delete(path)

      return found
    }
    if (read.kind === 'missing') {
      return []
    }
    const streak = nextStreak(unreadStreaks.get(path), read.reason, S.passStarted)
    unreadStreaks.set(path, streak)
    // A good read in this load: one of this step (`seenIdsOf`), or the board's parse of the file, which the scan keeps
    // only from a read that worked (a file the scan never read is in `unreadPlaces`, with no items).
    const board = S.todoFiles.find(file => `${file.folder}/${file.name}` === path)
    const boardIds = board === undefined || S.unreadPlaces.includes(`${board.rel ?? board.folder}/${board.name}`) ? undefined : board.items.flatMap(item => (item.id === undefined ? [] : [item.id.toLowerCase()]))
    const seen = seenIdsOf.get(path) === undefined && boardIds === undefined ? undefined : [...(seenIdsOf.get(path) ?? []), ...(boardIds ?? [])]
    if (!isSkipped(streak)) {
      throw new TodoReadError(path, read.reason)
    }
    // A file with no good read in this load is never skipped: its IDs are not known, and would be given again.
    if (seen === undefined) {
      if (!skipToasted.has(path)) {
        skipToasted.add(path)
        showToast($, `${path} did not read ${streak.count} times in a row (${read.reason}), and it has not read since Claudeopticon loaded. No new ticket IDs are named until it reads.`)
      }
      throw new TodoReadError(path, read.reason)
    }
    if (!skipToasted.has(path)) {
      skipToasted.add(path)
      showToast($, `${path} did not read ${streak.count} times in a row (${read.reason}). New ticket IDs are now chosen without it, above every ID it held at its good reads since Claudeopticon loaded.`)
    }
    ids.push(...seen)

    return undefined
  }
  for (const folder of S.todoFolders ?? []) {
    for (const name of await mdFiles($, folder.path, true)) {
      await take(`${folder.path}/${name}`)
    }
  }
  // A cut folder's file that never read is unknown, not empty: it is read again here, as a file of the
  // board is, and stops the IDs until it reads or is skipped. Its IDs, once read, count as the cut folders' do.
  for (const path of [...S.cutUnknown]) {
    const found = await take(path)
    if (found !== undefined) {
      S.cutUnknown.delete(path)
      S.cutIdsByFile.set(path, found)
      S.cutIds = [...S.cutIdsByFile.values()].flat()
    }
  }

  return ids
}
