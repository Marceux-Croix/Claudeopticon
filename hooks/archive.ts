/** The archive move: closed tickets go to archive/ in the same folder, with a record that makes a crash safe. */

import type { EngineInterface } from 'claude-code'
import type { TodoFile } from '../types'
import { isTodoFileName, todoKind } from './todo-file-names'
import { addToArchive, ARCHIVE_AFTER_MS, archiveName, blockFinder, blocksLeft, blocksStandAsItems, closedBlocks, recordAfterRollback, removeBlocks } from './archive-blocks'
import type { ClosedBlock } from './archive-blocks'
import { clock } from './card-format'
import { endsInExample } from './example-end'
import { readKeptBlocks, readKeptWrote } from './kept-records'
import { normalize } from './normalize'
import { normPath, samePath } from './path-forms'
import { tryWriteLock } from './write-lock'
import { archiveDirOf, archiveEntryName } from './archive-folder'
import { centralFolder } from './consolidate-gates'
import { fsBounded, realOf } from './fs-bounds'
import { redraw } from './pane-redraw'
import { hasEntry, isPlainFile, isTrustedDir } from './path-trust'
import { S } from './state'
import { storeSet, tryGet } from './store-access'
import { showToast, toastFailure } from './toasts'
import { readStrict, readTodo, writeIfUnchanged } from './todo-io'
import type { WriteOutcome } from './todo-io'

/**
 * Works out the archive file of the central folder (else the primary one) that the Show completed
 * button opens. The button shows when the folder is trusted and the file is either a plain `.md` or `.html`
 * file (its own real path, no symlink) or not there at all. Nothing is created here: a file made
 * during a scan could overwrite an archive move that lands a moment later. `openArchive` creates
 * it, under the writer lock, when the button is pressed.
 */
export async function refreshArchiveLink($: EngineInterface): Promise<void> {
  const folders = S.todoFolders ?? []
  const central = centralFolder()
  const folder = folders.find(one => one.path === central) ?? folders.find(one => !one.isOther)
  let link: string | undefined
  if (folder !== undefined) {
    const dir = await archiveDirOf($, folder.path)
    const path = `${dir}/${archiveName(S.todoFiles, folder.path)}`
    if (await isTrustedDir($, folder.path)) {
      if (await hasEntry($, path)) {
        link = (await isArchiveFile($, path)) ? path : undefined
      } else if (!(await fsBounded($, () => $.fs.exists(dir)).catch(() => false)) || samePath((await realOf($, dir)) ?? '', dir)) {
        link = path
      }
    }
  }
  if (link !== S.archiveLink) {
    S.archiveLink = link
    redraw($)
  }
}

/** True for an archive file the mod may open: a plain file (no symlink in it or above it) whose name ends in `.md` or `.html`. */
export async function isArchiveFile($: EngineInterface, path: string): Promise<boolean> {
  return isTodoFileName(path) && (await isPlainFile($, path)) && isTodoFileName((await realOf($, path)) ?? '')
}

/** The first time a closed block was seen closed, by file and text: the debounce. */
const closedAt = new Map<string, number>()

/**
 * Moves the closed tickets of every trusted top-level todo file to `archive/<same name>`, under the
 * heading each had. For each file: read it; read the archive; write the archive; read it back and
 * check every moved line is there; read the file again and write it without those lines only if it
 * is unchanged since the first read. Otherwise nothing more happens this scan: the next one tries
 * again, and the archive's own check keeps a block from being added twice. Never through a symlink,
 * never into the global folder, never from a file that did not read.
 */
export async function archiveDone($: EngineInterface): Promise<boolean> {
  if (S.isArchiving || S.isWorking) {
    return false
  }
  S.isArchiving = true
  try {
    // A held lock skips this scan; the next one tries again. True: a file was rewritten, so the scan runs again.
    return (await tryWriteLock(() => archivePass($))) === true
  } finally {
    S.isArchiving = false
  }
}

/** One archive pass over the todo files, under the writer lock; true when a file was rewritten. */
async function archivePass($: EngineInterface): Promise<boolean> {
  const time = await $.clock.now()
  const seen = new Set<string>()
  let isMoved = false
  for (const file of S.todoFiles) {
    if (file.isArchived === true || file.name.includes('/') || !file.items.some(item => item.status === 'completed')) {
      continue
    }
    const path = `${file.folder}/${file.name}`
    if (!(await isTrustedDir($, file.folder)) || !(await isPlainFile($, path))) {
      continue
    }
    const read = await readTodo($, path)
    if (read.kind !== 'ok') {
      continue
    }
    const text = read.text
    const ready = closedBlocks(text, todoKind(file.name)).filter(block => {
      const sign = `${path}\0${block.lines.join('\n')}`
      seen.add(sign)
      closedAt.set(sign, closedAt.get(sign) ?? time)

      return time - closedAt.get(sign)! >= ARCHIVE_AFTER_MS
    })
    // One file that fails leaves itself as it is; the others go on.
    // A move that throws is told once per file, then retried at each scan (the cause may clear).
    const moved =
      ready.length > 0 &&
      (await moveBlocks($, file, path, text, ready).catch(error => {
        toldOnce(`${path}\0threw`, () => toastFailure($, `archive ${path} into ${file.folder}/archive`)(error))

        return false
      }))
    if (moved) {
      isMoved = true
    }
  }
  for (const sign of [...closedAt.keys()]) {
    if (!seen.has(sign)) {
      closedAt.delete(sign)
    }
  }

  return isMoved
}

/**
 * The record of what this mod wrote last to each archive file: one store key per archive
 * path, shared by every session, so a retry skips a block this mod wrote whatever session or load
 * makes it. Written before the archive write, cleared (null) once the source is cut. The key is the
 * archive's real path, in one spelling (NFC, Windows slashes and drive folded), so two
 * sessions that reach one folder by different paths share it.
 */
function wroteKey(record: string): string {
  return `archive-wrote:${record}`
}

/** The record path of a todo file's archive: the real path of its folder, in one spelling, then `archive/` and its name; undefined when the folder's real path cannot be read. */
async function recordOf($: EngineInterface, file: TodoFile): Promise<string | undefined> {
  const real = await realOf($, file.folder)

  return real === undefined ? undefined : `${normPath(real).normalize('NFC')}/archive/${file.name.normalize('NFC')}`
}

/** The clears of a record that failed, by record path: written again before the next move of that file. */
const wrotePending = new Map<string, null>()

/**
 * The blocks this mod wrote last to the archive file, read from the store; undefined when the record
 * cannot be read (or a pending clear cannot be written), and the move must wait. An archive with no
 * record under its real path takes the record under the path the scan gave (`target`, the key of
 * 0.8 before ), and then its entry from the per-session record of 0.7.
 */
async function readWrote($: EngineInterface, record: string, target: string): Promise<string[][] | undefined> {
  if (wrotePending.has(record) && !(await writeWrote($, record, null))) {
    return undefined
  }
  const got = await tryGet($, wroteKey(record))
  if (!got.ok) {
    return undefined
  }
  if (got.value !== undefined) {
    return readKeptBlocks(got.value)
  }
  if (record !== target) {
    const byTarget = await tryGet($, wroteKey(target))
    if (!byTarget.ok) {
      return undefined
    }
    if (byTarget.value !== undefined) {
      return readKeptBlocks(byTarget.value)
    }
  }
  // The old record is a fallback only: with no session ID there is none of this session's to read.
  const me = await Promise.resolve()
    .then(() => $.session.id())
    .catch(() => undefined)
  if (me === undefined) {
    return []
  }
  const legacy = await tryGet($, `archive-wrote:${me}`)

  return legacy.ok ? (readKeptWrote(legacy.value).get(target) ?? []) : undefined
}

/** Stores the archive file's record; true when stored. A clear that fails is kept to write again. */
async function writeWrote($: EngineInterface, record: string, blocks: string[][] | null): Promise<boolean> {
  const ok = await Promise.resolve()
    .then(() => storeSet($, wroteKey(record), blocks))
    .then(() => true, () => false)
  if (blocks === null) {
    if (ok) {
      wrotePending.delete(record)
    } else {
      wrotePending.set(record, null)
    }
  }

  return ok
}

/**
 * Undoes an archive write whose source cut did not land. The source is read again first:
 * only the blocks still in it come out of the archive. A block that left the source meanwhile (another
 * session cut it after it found the block in this archive and in the shared record, or the user deleted
 * the line) stays in the archive, or the ticket would be in neither file. The archive is put back only
 * when it still holds exactly `next`, the text the step wrote; a changed archive is left. The record is
 * cleared when the archive went back or every block left: then no block is in two places, but for a
 * block of the record the move read (an earlier step's, whose rollback a write between was refused)
 * still in the archive and the source: its record stays, so the next pass only cuts it. A source
 * that does not read leaves the archive and the record as they are: the record keeps the next pass from
 * adding the blocks again, and that pass only cuts what is still in the source.
 */
async function rollBack($: EngineInterface, move: { path: string; text: string; target: string; record: string; before: string; next: string; ready: readonly ClosedBlock[]; wrote: string[][]; eol: string }): Promise<void> {
  const now = await readTodo($, move.path)
  if (now.kind !== 'ok') {
    return
  }
  const left = blocksLeft(move.text, now.text, move.ready, todoKind(move.path))
  // An earlier step's block (the record the move read) still in the archive and the source keeps its record.
  const keep = (archived: string) => {
    const kept = recordAfterRollback(move.wrote, archived, now.text)

    return kept.length > 0 ? kept : null
  }
  if (left.length === move.ready.length) {
    await writeWrote($, move.record, keep(move.next))

    return
  }
  // An archive that was missing goes back to an empty file, or to one with only the blocks that left.
  const back = left.length === 0 ? move.before : addToArchive(move.before, left, move.wrote, move.eol, todoKind(move.target))
  // Checks, then the read and compare as the last call before the write.
  const put = await writeIfUnchanged($, move.target, move.next, back).catch(() => undefined)
  if (put?.kind === 'written') {
    await writeWrote($, move.record, keep(back))
  }
}

/** The archive files already named in a "moved tickets would be no items there" toast: one toast each, per session. */
const notItemsToasted = new Set<string>()

/** The archive files already named in an "unclosed code block" toast: one toast each, per session. */
const unclosedToasted = new Set<string>()

/** The refusals of the archive move already told, by file and cause: a cause that lasts is told once per session, not at each scan. */
const archiveToldOnce = new Set<string>()

/** Runs `tell` the first time `key` comes; the archive move's persistent failures use it so one cause gives one toast. */
function toldOnce(key: string, tell: () => void): void {
  if (!archiveToldOnce.has(key)) {
    archiveToldOnce.add(key)
    tell()
  }
}

/**
 * The record after an archive write that did not land: the move stored its blocks as the record before
 * the write, so a failed write leaves a record of blocks that are not in the archive, and a later equal
 * block would be taken for a retry and dropped. The record goes back to what the move read (`wrote`,
 * none cleared) unless the archive holds exactly `next`: a write that threw may have landed, and then the
 * record stays, so the retry only cuts the source. An archive that does not read keeps the record too.
 */
async function forgetUnwritten($: EngineInterface, record: string, target: string, next: string, wrote: readonly (readonly string[])[]): Promise<void> {
  // An archive that was never created is empty.
  const now = (await fsBounded($, () => $.fs.exists(target)).catch(() => true)) ? await readStrict($, target).catch(() => undefined) : ''
  if (now === undefined || now === next) {
    return
  }
  await writeWrote($, record, wrote.length > 0 ? wrote.map(block => [...block]) : null)
}

/** One file's move; true when the file was rewritten without the blocks. */
async function moveBlocks($: EngineInterface, file: TodoFile, path: string, text: string, ready: readonly ClosedBlock[]): Promise<boolean> {
  const dir = await archiveDirOf($, file.folder)
  const target = `${dir}/${await archiveEntryName($, dir, file.name)}`
  // What this mod wrote last comes from the store: without it a retry would add a block twice.
  // A record that cannot be read stops the move; the next scan tries again. So does a folder whose real path, the record's key, will not read.
  const record = await recordOf($, file)
  if (record === undefined) {
    return false
  }
  const wrote = await readWrote($, record, target)
  if (wrote === undefined) {
    return false
  }
  const isThere = await fsBounded($, () => $.fs.exists(target))
  // Never written through a symlink: archive/ and an existing archive file must be their own real paths.
  // A missing archive file with anything at its name (a dangling symlink) is left alone.
  if (((await fsBounded($, () => $.fs.exists(dir))) && !samePath((await realOf($, dir)) ?? '', dir)) || (isThere ? !(await isPlainFile($, target)) : await hasEntry($, target))) {
    toldOnce(`${target}\0place`, () => showToast($, `Not archived: ${target} or its folder is a symlink or no plain file. The tickets stay in ${path}.`))

    return false
  }
  const before = isThere ? await readStrict($, target) : ''
  // Text added after an open code fence or HTML comment would sit inside it, and be no ticket: the move waits for a fix.
  if (endsInExample(before, todoKind(target))) {
    if (!unclosedToasted.has(target)) {
      unclosedToasted.add(target)
      showToast($, `Not archived: ${target} has an unclosed code block or HTML block at its end`)
    }

    return false
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const next = addToArchive(before, ready, wrote, eol, todoKind(target))
  // Each moved block must be items in the new text: never put where a fence or a comment makes it no ticket.
  if (!blocksStandAsItems(next, ready, todoKind(target))) {
    if (!notItemsToasted.has(target)) {
      notItemsToasted.add(target)
      showToast($, `Not archived: in ${target} the moved tickets would sit inside a code block or HTML block, where they are no tickets. Fix the archive file; the tickets stay in ${path}.`)
    }

    return false
  }
  let isWritten = false
  if (next !== before) {
    // The checks, then the record stored, then the read and compare as the last call before the write.
    // Stored before the archive is written: a crash or reload after the write still finds the record.
    // A record that cannot be stored stops the move before the archive is touched.
    let put: WriteOutcome
    try {
      put = await writeIfUnchanged($, target, before, next, { mayCreate: true, before: () => writeWrote($, record, ready.map(block => [...block.lines])) })
    } catch (error) {
      await forgetUnwritten($, record, target, next, wrote)

      throw error
    }
    if (put.kind !== 'written') {
      // 'unsafe' and 'refused' come before the record is stored; 'unread' and 'changed' come after it: the record names blocks that are not in the archive.
      if (put.kind === 'unread' || put.kind === 'changed') {
        await forgetUnwritten($, record, target, next, wrote)
      }
      if (put.kind === 'unsafe') {
        toldOnce(`${target}\0unsafe:${put.reason}`, () => showToast($, `Not archived: ${target} cannot be written (${put.reason}). The tickets stay in ${path}.`))
      }

      return false
    }
    isWritten = true
  }
  // Confirmed from the disk before the source is touched.
  const after = (await readStrict($, target)).split('\n')
  const stands = blockFinder(after)
  if (!ready.every(block => stands(block.lines))) {
    toldOnce(`${target}\0confirm`, () => showToast($, `Not archived: ${target} does not hold the moved tickets after the write. The tickets stay in ${path}.`))

    return false
  }
  // A write that throws leaves the archive and its record: the next pass finds the blocks there and only cuts the source.
  const cut = await writeIfUnchanged($, path, text, removeBlocks(text, ready))
  if (cut.kind !== 'written') {
    // The source changed (or would not check or read): the blocks still in it come out of the archive again; a
    // block that left it meanwhile stays in the archive.
    if (isWritten) {
      await rollBack($, { path, text, target, record, before, next, ready, wrote, eol })
    }

    return false
  }
  await writeWrote($, record, null)

  return true
}
