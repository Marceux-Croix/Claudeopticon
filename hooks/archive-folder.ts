/** The archive folder of a todo folder and the name of a file in it, in the disk spelling. */

import type { EngineInterface } from 'claude-code'
import { listedName } from './path-forms'
import { fsBounded } from './fs-bounds'

/**
 * A folder's `archive/` in the disk's spelling: on a disk that ignores case, `archive` answers
 * for `Archive/` or `ARCHIVE/`, but the symlink check compares the real path by exact case and refused
 * it, so no ticket was ever archived and nothing said why. The folder's own entry name is taken; only
 * when the disk says `archive` is there, so a disk that keeps case apart gets a new `archive/`. A folder
 * that will not list keeps `archive`.
 */
export async function archiveDirOf($: EngineInterface, folder: string): Promise<string> {
  const dir = `${folder}/archive`
  if (!(await fsBounded($, () => $.fs.exists(dir)).catch(() => false))) {
    return dir
  }
  const entries = await fsBounded($, () => $.fs.list(folder)).catch(() => undefined)

  return entries === undefined ? dir : `${folder}/${listedName(entries.map(entry => entry.name), 'archive')}`
}

/**
 * The name of a file's archive in `archive/` as the folder lists it. On a disk that ignores
 * case, `archive/todo.md` answers for `TODO.md` but the safe-file check compares exact case and refuses
 * it, so the archive's own entry name is taken. Only when the disk says the file is there: a disk that
 * keeps case apart has no `TODO.md` then, and a new one is made. A folder that will not list keeps the name.
 */
export async function archiveEntryName($: EngineInterface, dir: string, name: string): Promise<string> {
  if (!(await fsBounded($, () => $.fs.exists(`${dir}/${name}`)).catch(() => false))) {
    return name
  }
  const entries = await fsBounded($, () => $.fs.list(dir)).catch(() => undefined)

  return entries === undefined ? name : listedName(entries.map(entry => entry.name), name)
}
