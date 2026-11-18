/** Delete empty todos: removes the todo files with no items. */

import type { EngineInterface } from 'claude-code'
import { isTodoFileName } from './todo-file-names'
import { isWinPath, psPath } from './path-forms'
import { trashReason } from './platform-commands'
import { TIMED_OUT } from './time-limit'
import { withWriteLock } from './write-lock'
import { archiveDirOf } from './archive-folder'
import { canDeleteEmpty, centralFolder, chooseTarget, isBusy } from './consolidate-gates'
import { boundedJob, fsBounded, runInTime } from './fs-bounds'
import { redraw } from './pane-redraw'
import { isPlainFile, isTrustedDir } from './path-trust'
import { S } from './state'
import { showToast } from './toasts'
import { mdFiles, readTodo } from './todo-io'
import { scan } from './todo-scan'
import { trashFile } from './trash-files'

/**
 * Sends the empty todo files (`.md` or `.html`) the last scan found (top level and archive) to the OS trash: each is
 * read again right before `trashFile` (no shell, no glob, one call per file) and skipped if it holds
 * anything now. Never the central target, never a file in an untrusted folder or behind a symlink,
 * never `categories.json`. A file whose trash call fails is kept and named with the reason; nothing
 * is ever deleted outright. Then a non-recursive `rmdir --` (a .NET `Directory.Delete` on Windows)
 * on an emptied `archive/` and folder, which fails on a non-empty directory: the intended guard.
 */
export async function deleteEmpty($: EngineInterface): Promise<void> {
  await withWriteLock(() => deleteEmptyLocked($))
}

async function deleteEmptyLocked($: EngineInterface): Promise<void> {
  const central = centralFolder()
  if (central === undefined || !canDeleteEmpty() || isBusy($)) {
    return
  }
  S.isWorking = true
  try {
    // `uname` is asked once per press, so a changed platform is never read from a stale answer.
    S.unameCache = undefined
    // Bounded: an rmdir that hangs frees the writer lock.
    const run = async (argv: string[]) => {
      const done = await runInTime($, argv)

      return done !== TIMED_OUT && done?.exitCode === 0
    }
    // The target read also stops a press whose files will not read. The target check
    // below (M40) is defense in depth: the target is the central todo.md, which the scan
    // never lists as empty, or the one file with items, which the read below finds not empty, so no
    // state reaches it today. It stays so a change to the scan's rule cannot trash the target.
    const target = await chooseTarget($, central, (await mdFiles($, central)).filter(name => !name.includes('/')))
    const folders = new Set<string>()
    const isWin = isWinPath(central)
    const unmoved: string[] = []
    // What each trash command did, once per command, for the reason in the toast.
    const attempts: string[] = []
    let removed = 0
    const kept: string[] = []
    const archives = new Map<string, string>()
    for (const file of S.emptyFiles) {
      const name = file.path.slice(file.folder.length + 1)
      // The scan names an archived file by the archive folder's disk name, `Archive/` on a disk that ignores case.
      const isArchive = /^archive\/[^/]+$/i.test(name)
      const isTop = !name.includes('/')
      if ((!isArchive && !isTop) || !isTodoFileName(name) || (file.folder === central && !isArchive && name === target) || !(await isTrustedDir($, file.folder)) || !(await isPlainFile($, file.path))) {
        kept.push(file.path)
        continue
      }
      const read = await readTodo($, file.path)
      const text = read.kind === 'ok' ? read.text : undefined
      if (text === undefined || text.trim() !== '') {
        kept.push(file.path)
        continue
      }
      const done = await trashFile($, file.path)
      if (done.isOk) {
        removed += 1
        folders.add(file.folder)
        if (isArchive) {
          // The archive folder by the name the scan found it under, for the rmdir below.
          archives.set(file.folder, file.path.slice(0, file.path.lastIndexOf('/')))
        }
      } else {
        kept.push(file.path)
        unmoved.push(file.path)
        attempts.push(...done.tried.filter(one => !attempts.includes(one)))
      }
    }
    for (const folder of folders) {
      for (const dir of [archives.get(folder) ?? (await archiveDirOf($, folder)), folder]) {
        // Fails on a directory that still holds files, which keeps it.
        await run(isWin ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `[System.IO.Directory]::Delete(${psPath(dir)})`] : ['rmdir', '--', dir])
      }
    }
    // A folder that is gone leaves the folder list.
    const gone = new Set<string>()
    for (const folder of folders) {
      if (!(await fsBounded($, () => $.fs.exists(folder)).catch(() => true))) {
        gone.add(folder)
      }
    }
    S.todoFolders = S.todoFolders?.filter(one => !gone.has(one.path))
    if (kept.length > 0) {
      showToast($, `Kept: ${kept.join(', ')}`)
    }
    if (unmoved.length > 0) {
      const reason = trashReason(attempts, isWin, S.unameCache ?? '')
      showToast($, `Not moved to the ${isWin ? 'Recycle Bin' : 'Trash'}, file kept (${reason}): ${unmoved.join(', ')}`)
    }
    showToast($, `Moved ${removed} empty todo ${removed === 1 ? 'file' : 'files'} to the ${isWin ? 'Recycle Bin' : 'Trash'}.`)
    await boundedJob($, scan($, true).catch(() => undefined))
  } catch (error) {
    showToast($, `Could not delete empty todos: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    S.isWorking = false
    redraw($)
  }
}
