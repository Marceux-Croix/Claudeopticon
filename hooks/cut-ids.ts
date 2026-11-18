/** The ticket IDs of the cut folders, so a new ID never repeats one of theirs. */

import type { EngineInterface } from 'claude-code'
import { textIds } from './numbering'
import { todoKind } from './todo-file-names'
import { S, unreadToasted } from './state'
import { showToast } from './toasts'
import { mdFiles, readTodo } from './todo-io'

/**
 * Reads the ticket IDs of the cut folders (top level and archive). A file that does not read, or a
 * folder that does not list, keeps the IDs of its last good read: a failed read is never
 * an empty file. A file whose first read fails is unknown (`cutUnknown`), with one toast, and stops new
 * IDs until it reads or is skipped. A file that is gone holds none.
 */
export async function refreshCutIds($: EngineInterface): Promise<void> {
  const next = new Map<string, string[]>()
  const unknown = new Set<string>()
  for (const folder of S.cutFolders) {
    const names = await mdFiles($, folder, true).catch(() => undefined)
    if (names === undefined) {
      for (const [path, ids] of S.cutIdsByFile) {
        if (path.startsWith(`${folder}/`)) {
          next.set(path, ids)
        }
      }
      for (const path of S.cutUnknown) {
        if (path.startsWith(`${folder}/`)) {
          unknown.add(path)
        }
      }
      continue
    }
    for (const name of names) {
      const path = `${folder}/${name}`
      const read = await readTodo($, path)
      const was = S.cutIdsByFile.get(path)
      if (read.kind === 'ok') {
        next.set(path, textIds(read.text, todoKind(path)))
        unreadToasted.delete(path)
      } else if (read.kind === 'failed' && was !== undefined) {
        next.set(path, was)
      } else if (read.kind === 'failed') {
        // Its first read failed: its IDs are unknown, never none. Named once, until it reads.
        unknown.add(path)
        if (!unreadToasted.has(path)) {
          unreadToasted.add(path)
          showToast($, `${path} did not read (${read.reason}). Its ticket IDs are unknown, so no new ticket ID is given until it reads.`)
        }
      }
    }
  }
  S.cutIdsByFile = next
  S.cutUnknown = unknown
  S.cutIds = [...next.values()].flat()
}
