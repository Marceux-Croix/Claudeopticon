/** The scan of the todo folders into the board files. */

import type { EngineInterface } from 'claude-code'
import type { TodoFile } from '../types'
import { isMainTodoName, isTodoFileName, todoKind } from './todo-file-names'
import { removeDuplicateTickets } from './duplicate-tickets'
import { fileId } from './item-keys'
import { relIn } from './path-forms'
import { MAX_FOLDERS } from './repo-folders'
import type { TodoFolder } from './repo-folders'
import { drawnPlaces } from './ticket-boxes'
import type { DrawnPlace } from './ticket-boxes'
import { parseTodo } from './todo-markdown'
import { archiveDone, refreshArchiveLink } from './archive'
import { archiveDirOf } from './archive-folder'
import { loadBook } from './category-book'
import { sortItems } from './category-sort'
import { centralFolder, chooseTarget } from './consolidate-gates'
import { refreshCutIds } from './cut-ids'
import { fsBounded, realOf } from './fs-bounds'
import { atHome, findTodoDir } from './global-folders'
import { prunePlannedTickets, pruneTickets } from './orchestrator-tickets'
import { redraw } from './pane-redraw'
import { isPlainFile, isTrustedDir } from './path-trust'
import { sessionHome } from './session-places'
import { S, filledSources } from './state'
import { numberTickets } from './ticket-numbering'
import { showToast } from './toasts'
import { absNearest, ensureFolders, followSessionFolder } from './todo-folders'
import { mdFiles, readStrict, readTodo } from './todo-io'

/** Sets hasDupTickets from the central target file; false when it cannot be read, or the press could not write it: an untrusted folder, or a target that is no plain file of its own real path. */
async function refreshDupTickets($: EngineInterface): Promise<void> {
  S.hasDupTickets = false
  const central = centralFolder()
  if (central === undefined || S.centralBlocked) {
    return
  }
  try {
    const names = (await mdFiles($, central)).filter(name => !name.includes('/'))
    if (names.length === 0) {
      return
    }
    const target = await chooseTarget($, central, names)
    const path = `${central}/${target}`
    // The press's own checks: a button that shows must be one that can write.
    if (!names.includes(target) || !(await isTrustedDir($, central)) || !(await isPlainFile($, path))) {
      return
    }
    S.hasDupTickets = removeDuplicateTickets(await readStrict($, path), todoKind(target)).removed.length > 0
  } catch {
    S.hasDupTickets = false
  }
}

/**
 * The cheap check each scan makes, with no git: the nearest folder by the old rule. A folder made
 * after the mod loaded (Claude creating `.claude_todo/` in a repo that had none) joins the known
 * ones: as the primary folder when there is none, else as one more folder. A known folder that was
 * only "other" becomes the primary when there is none.
 */
async function noteNearest($: EngineInterface, folders: TodoFolder[]): Promise<TodoFolder[]> {
  const near = await findTodoDir($).catch(() => undefined)
  if (near === undefined || near === S.nearestSeen) {
    return folders
  }
  S.nearestSeen = near
  const real = await realOf($, atHome(await sessionHome($))(near))
  // By its absolute path, as discovery gives it, so the trust check passes it: numbered and archived like the rest.
  const path = absNearest(near, real) ?? near
  const hasPrimary = folders.some(one => !one.isOther)
  const known = folders.find(one => one.path === near || one.path === path || (real !== undefined && one.real === real))
  if (known !== undefined) {
    return hasPrimary || !known.isOther ? folders : folders.map(one => (one === known ? { ...one, isOther: false } : one))
  }
  const added: TodoFolder = { path, rel: relIn(real, S.repoRoot) ?? near, isOther: hasPrimary, ...(real === undefined ? {} : { real }) }
  if (folders.length < MAX_FOLDERS) {
    return hasPrimary ? [...folders, added] : [added, ...folders]
  }
  // At the limit no folder drops in silence. The session's own folder, with no primary yet,
  // is shown first and the last folder is cut; else the new folder is the one cut. The cut folder's IDs
  // still count, and a toast names it.
  const shown = hasPrimary ? folders : [added, ...folders]
  const cut = hasPrimary ? added : shown[shown.length - 1]!
  S.cutFolders = [...S.cutFolders.filter(one => one !== added.path), cut.path]
  await refreshCutIds($).catch(() => undefined)
  showToast($, `The todo folder ${cut.rel} is not shown: the pane shows ${MAX_FOLDERS} folders. Its ticket IDs still count.`)

  return shown.slice(0, MAX_FOLDERS)
}

/** The scan in flight, and the ask that came while it ran: one scan at a time, so an older slow scan never puts an older board over a newer one. */
let scanRun: Promise<void> | undefined

let scanAsked: { isFull: boolean } | undefined

let passWaiters: { pass: number; resolve: () => void; reject: (error: unknown) => void }[] = []

/**
 * Rereads the todo files (`.md` or `.html`) of every known folder; a file whose mtime is unchanged keeps its parse.
 * Single-flight: a call while a scan runs asks for one more pass after it (full if any ask was full).
 * The promise a caller gets settles when the first pass that started after its call ends:
 * at most the pass in flight and one more, never the follow-up passes others ask for after it.
 */
export function scan($: EngineInterface, isFull = false): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    passWaiters.push({ pass: S.passStarted + 1, resolve, reject })
  })
  if (scanRun !== undefined) {
    scanAsked = { isFull: isFull || scanAsked?.isFull === true }

    return done
  }
  scanRun = (async () => {
    try {
      let full = isFull
      for (;;) {
        S.passStarted += 1
        // A write (numbering, an archive move) asks for a full pass again, so the next pass never works from stale text.
        const again = await scanOnce($, full)
        const ended = passWaiters.filter(one => one.pass <= S.passStarted)
        passWaiters = passWaiters.filter(one => one.pass > S.passStarted)
        for (const one of ended) {
          one.resolve()
        }
        const asked = scanAsked
        scanAsked = undefined
        if (!again && asked === undefined) {
          return
        }
        full = again || asked?.isFull === true
      }
    } catch (error) {
      const failed = passWaiters
      passWaiters = []
      for (const one of failed) {
        one.reject(error)
      }
    } finally {
      scanRun = undefined
      scanAsked = undefined
    }
  })()

  return done
}

/** One scan pass; true when it wrote a file, so another full pass is due. */
/**
 * The place of each item line by file path and key, from the read that built the items the board
 * draws (`drawnPlaces`): a press checks that the line it writes is still at the place the board drew
 *. A scan collects the places of its reads and sets them in the same step as
 * `todoFiles`, so a press in the middle of a scan never checks the old board's item against
 * the new text's places.
 */
let linePlacesOf = new Map<string, Map<string, DrawnPlace>>()

/** The drawn place of a line for `isDrawnLine`: empty when the scan has no read of the file (then text and box are checked alone). */
export function placeOfLine(path: string, key: string): { place?: string; sum?: string } {
  return linePlacesOf.get(path)?.get(key) ?? {}
}

/** Notes from one read whether a file outside the central folder holds text. */
function noteFilled(folder: string, path: string, text: string): void {
  if (folder !== centralFolder() && text.trim() !== '') {
    filledSources.add(path)
  } else {
    filledSources.delete(path)
  }
}

async function scanOnce($: EngineInterface, isFull: boolean): Promise<boolean> {
  await followSessionFolder($)
  S.todoFolders = await noteNearest($, await ensureFolders($))
  const folders = S.todoFolders ?? []
  // The book lives in the primary folder only. With no primary folder the items are not sorted.
  const bookFolder = folders.find(one => !one.isOther)?.path
  await loadBook($, bookFolder, isFull)
  if (isFull) {
    await refreshCutIds($).catch(() => undefined)
  }
  const known = new Map(S.todoFiles.map(file => [fileId(file), file]))
  const next: TodoFile[] = []
  const empties: { folder: string; path: string; name: string; rel?: string }[] = []
  const unread: string[] = []
  // The folders whose top level did not read whole: only they may hold a ticket the scan did not find (an archive holds no live ticket).
  const unreadTop = new Set<string>()
  // The files listed this scan, and the folders that would not list: a file gone from a listed folder leaves `filledSources` and `linePlacesOf`.
  const listedPaths = new Set<string>()
  const unlistedDirs: string[] = []
  const linked = new Set<string>()
  // The places of the files this scan keeps, from the read each one's items come from: set with `todoFiles`.
  const places = new Map<string, Map<string, DrawnPlace>>()
  const keepPlaces = (path: string) => {
    const was = linePlacesOf.get(path)
    if (was !== undefined) {
      places.set(path, was)
    }
  }
  for (const folder of folders) {
    // The archive folder by its disk name: a file's path is then its own real path, and its name keeps `archive/`.
    const sources: [string, string][] = [[folder.path, ''], [await archiveDirOf($, folder.path), 'archive/']]
    for (const [dir, prefix] of sources) {
      // A folder whose check or list fails is not known to be empty: its files stay as last read.
      const exists = await fsBounded($, () => $.fs.exists(dir)).then(is => is, () => undefined)
      const entries = exists === true ? await fsBounded($, () => $.fs.list(dir)).then(list => list, () => undefined) : []
      if (exists === undefined || entries === undefined) {
        unlistedDirs.push(dir)
        unread.push(`${folder.rel ?? folder.path}${prefix === '' ? '' : '/archive'}`)
        if (prefix === '') {
          unreadTop.add(folder.path)
        }
        const stay = S.todoFiles.filter(file => file.folder === folder.path && (prefix === '' ? !file.name.includes('/') : file.name.startsWith(prefix)))
        stay.forEach(file => keepPlaces(`${file.folder}/${file.name}`))
        next.push(...stay)
        continue
      }
      for (const entry of entries) {
        if (entry.kind !== 'file' || !isTodoFileName(entry.name)) {
          // A linked (or other non-file) todo entry is never read, so its tickets are not known to be gone.
          if (isTodoFileName(entry.name) && entry.kind !== 'dir') {
            linked.add(folder.path)
          }
          continue
        }
        const name = `${prefix}${entry.name}`
        listedPaths.add(`${dir}/${entry.name}`)
        const place = { name, folder: folder.path, rel: folder.rel, ...(folder.isOther ? { isOther: true as const } : {}) }
        const cached = known.get(fileId(place))
        if (!isFull && cached !== undefined && cached.mtimeMs === entry.mtimeMs) {
          keepPlaces(`${dir}/${entry.name}`)
          next.push(cached)
          continue
        }
        const read = await readTodo($, `${dir}/${entry.name}`)
        const text = read.kind === 'ok' ? read.text : undefined
        // A read that failed is not an empty file: the last good parse stays (with its old mtime, so the next scan reads it again). Dropping it would end the orchestrator's claims on its tickets.
        if (typeof text !== 'string' && cached !== undefined) {
          keepPlaces(`${dir}/${entry.name}`)
          next.push(cached)
          continue
        }
        if (typeof text !== 'string') {
          unread.push(`${folder.rel ?? folder.path}/${name}`)
          if (prefix === '') {
            unreadTop.add(folder.path)
          }
        }
        // A file with nothing but blanks is empty; one that would not read is not known to be.
        if (typeof text === 'string' && text.trim() === '' && !(folder.path === centralFolder() && prefix === '' && isMainTodoName(entry.name))) {
          empties.push({ folder: folder.path, path: `${dir}/${entry.name}`, name, ...(folder.rel === undefined ? {} : { rel: folder.rel }) })
        }
        if (typeof text === 'string') {
          places.set(`${dir}/${entry.name}`, drawnPlaces(text, todoKind(entry.name)))
          noteFilled(folder.path, `${dir}/${entry.name}`, text)
        }
        const items = parseTodo(typeof text === 'string' ? text : '', todoKind(entry.name))
        next.push(prefix === '' ? { ...place, mtimeMs: entry.mtimeMs, items } : { ...place, mtimeMs: entry.mtimeMs, items, isArchived: true })
      }
    }
  }
  for (const path of [...filledSources.keys()]) {
    if (!listedPaths.has(path) && !unlistedDirs.some(dir => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))) {
      filledSources.delete(path)
    }
  }
  S.unreadPlaces = unread
  S.linkedFolders = linked
  S.scanFolders = folders.map(folder => ({ folder: folder.path, rel: folder.rel, isOther: folder.isOther }))
  S.unreadFolders = S.scanFolders.filter(folder => unreadTop.has(folder.folder))
  const kept = next.filter(file => file.items.length > 0)
  const isSame = isFull
    ? JSON.stringify(S.todoFiles) === JSON.stringify(kept)
    : S.todoFiles.length === kept.length && S.todoFiles.every((file, i) => fileId(file) === (kept[i] === undefined ? '' : fileId(kept[i])) && file.mtimeMs === kept[i]?.mtimeMs)
  // The places go with the items they came from, in the same step, with no await between. When the items
  // are the same the board is the same, and the new places name the same lines.
  linePlacesOf = places
  if (!isSame) {
    S.todoFiles = kept
    redraw($)
  }
  if (pruneTickets() || prunePlannedTickets()) {
    redraw($)
  }
  const sign = `${S.hasDupTickets}|${S.emptyFiles.map(one => one.path).join('|')}`
  await refreshArchiveLink($).catch(() => undefined)
  // The archive file the Show completed link opens may be empty: Delete empty todos leaves it be.
  S.emptyFiles = empties.filter(one => one.path !== S.archiveLink)
  await refreshDupTickets($)
  if (sign !== `${S.hasDupTickets}|${S.emptyFiles.map(one => one.path).join('|')}`) {
    redraw($)
  }
  // Numbering first, and a scan again after a write, so the archive move never works from stale text.
  if (await numberTickets($).catch(() => false)) {
    return true
  }
  if (await archiveDone($).catch(() => false)) {
    return true
  }
  void sortItems($).catch(() => undefined)

  return false
}

/** The live todo files after a forced rescan, for the found-issues rule; `undefined` when the scan fails. */
export async function freshTodoFiles($: EngineInterface): Promise<readonly TodoFile[] | undefined> {
  try {
    await scan($, true)

    return S.todoFiles
  } catch {
    return undefined
  }
}
