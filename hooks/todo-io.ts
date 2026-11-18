/** The reads and writes of todo files: every one goes through readTodo and writeIfUnchanged. */

import type { EngineInterface } from 'claude-code'
import { isTodoFileName } from './todo-file-names'
import { samePath } from './path-forms'
import { readReason, reasonOf, TodoReadError } from './todo-read'
import type { TodoRead } from './todo-read'
import { TIMED_OUT } from './time-limit'
import { archiveDirOf } from './archive-folder'
import { fsBounded, realOf, runInTime } from './fs-bounds'
import { hasEntry, plainFileProblem, trustProblem } from './path-trust'
import { S } from './state'

/** Every item ID of every todo and archive file on the board, lowercase: all folders, the project-wide number line. */
export function projectIds(): string[] {
  return [...S.todoFiles.flatMap(file => file.items.flatMap(item => (item.id === undefined ? [] : [item.id.toLowerCase()]))), ...S.cutIds]
}

/**
 * The todo files (`.md` or `.html`) of a folder, top level and archive, as names inside it. An archived name starts with
 * the archive folder's own name on the disk (`archiveDirOf`): `Archive/x.md` on a disk that
 * ignores case, so a path built from the name is its own real path and the symlink check passes it.
 * A top-level name never holds a `/`, which is how a caller tells the two apart.
 */
export async function mdFiles($: EngineInterface, folder: string, isStrict = false): Promise<string[]> {
  const names: string[] = []
  const archive = await archiveDirOf($, folder)
  for (const [dir, prefix] of [[folder, ''], [archive, `${archive.slice(folder.length + 1)}/`]] as const) {
    // Strict, a folder that will not answer or list is an error, not an empty or absent folder.
    if (!(isStrict ? await fsBounded($, () => $.fs.exists(dir)) : await fsBounded($, () => $.fs.exists(dir)).catch(() => false))) {
      continue
    }
    for (const entry of isStrict ? await fsBounded($, () => $.fs.list(dir)) : await fsBounded($, () => $.fs.list(dir)).catch(() => [])) {
      if (entry.kind === 'file' && isTodoFileName(entry.name)) {
        names.push(`${prefix}${entry.name}`)
      }
    }
  }

  return names
}

/**
 * The one read of a todo file: every todo read goes through here, so a read that failed is
 * never taken for an empty or an absent file. A read that throws is `missing` only when the disk says
 * nothing stands at the path; when that check fails too, the read is `failed`.
 */
export async function readTodo($: EngineInterface, path: string): Promise<TodoRead> {
  let text: unknown
  try {
    text = await fsBounded($, () => $.fs.read(path))
  } catch (error) {
    const isThere = await fsBounded($, () => $.fs.exists(path)).then(is => is, () => true)

    return isThere ? { kind: 'failed', reason: reasonOf(error), error } : { kind: 'missing', error }
  }

  return typeof text === 'string' ? { kind: 'ok', text } : { kind: 'failed', reason: 'the read gave no text' }
}

/** The text of a todo file that must read: a failed or missing read is an error (the engine's own when it threw), never an empty file. */
export async function readStrict($: EngineInterface, path: string): Promise<string> {
  const read = await readTodo($, path)
  if (read.kind === 'ok') {
    return read.text
  }

  throw read.error ?? new TodoReadError(path, readReason(read))
}

/** What a guarded todo write did (`writeIfUnchanged`). */
export type WriteOutcome = { kind: 'written' } | { kind: 'changed' } | { kind: 'unread'; reason: string } | { kind: 'unsafe'; reason: string } | { kind: 'refused' }

/**
 * Why a file may not be written at `path`, or undefined when it may: an existing file must be a
 * plain file that is its own real path; a missing one must have nothing at its name (no dangling
 * symlink), and its folder, when there, must be its own real path. Never through a symlink.
 */
async function placeProblem($: EngineInterface, path: string): Promise<string | undefined> {
  if (await fsBounded($, () => $.fs.exists(path))) {
    return plainFileProblem($, path)
  }
  if (await hasEntry($, path)) {
    return 'something that is no file stands at its name (a dangling symlink?)'
  }
  const dir = path.slice(0, path.lastIndexOf('/'))
  if ((await fsBounded($, () => $.fs.exists(dir))) && !samePath((await realOf($, dir)) ?? '', dir)) {
    return 'its folder is a symlink or could not be read'
  }

  return undefined
}

/**
 * The one write of a todo file: every todo write goes through here,
 * and `scripts/check-writes.ts` fails on any other. It does every check first: the folder's trust
 * (`folder`), the file's place (`placeProblem`), then the caller's own step that must come before the
 * write (`before`: a record or a mark stored; false stops the write). Then it reads the file and
 * compares it with `expected`, the text the caller computed `next` from, and writes `next` with no
 * await between that read and the write, so an edit made while any check or store call ran is never
 * written over. A missing file counts as `expected` '' only with `mayCreate`; then a write that fails
 * makes the folder (`mkdir -p`, no shell), checks the file's place again, and reads and compares again before it writes. A read that
 * fails is `unread`, never a change and never an empty file; a write that fails throws.
 */
export async function writeIfUnchanged($: EngineInterface, path: string, expected: string, next: string, opts: { folder?: string; mayCreate?: boolean; before?: () => Promise<boolean> } = {}): Promise<WriteOutcome> {
  const isCreate = opts.mayCreate === true
  const trust = opts.folder === undefined ? undefined : await trustProblem($, opts.folder)
  if (trust !== undefined) {
    return { kind: 'unsafe', reason: trust }
  }
  const place = await placeProblem($, path)
  if (place !== undefined) {
    return { kind: 'unsafe', reason: place }
  }
  if (opts.before !== undefined && !(await opts.before())) {
    return { kind: 'refused' }
  }
  // The read and compare: the last await before the write.
  let read = await readTodo($, path)
  let isSame = read.kind === 'ok' ? read.text === expected : read.kind === 'missing' && isCreate && expected === ''
  if (read.kind === 'failed') {
    return { kind: 'unread', reason: read.reason }
  }
  if (!isSame) {
    return { kind: 'changed' }
  }
  try {
    await $.fs.write(path, next)
  } catch (error) {
    // Only a file that is not there may need its folder made; a check that fails counts as there.
    if (!isCreate || (await fsBounded($, () => $.fs.exists(path)).catch(() => true))) {
      throw error
    }
    const made = await runInTime($, ['mkdir', '-p', path.slice(0, path.lastIndexOf('/'))])
    if (made === undefined || made === TIMED_OUT || made.exitCode !== 0) {
      throw error
    }
    // The folder is new: its place is checked again, so a symlink made at its name meanwhile is never written through.
    const madePlace = await placeProblem($, path)
    if (madePlace !== undefined) {
      return { kind: 'unsafe', reason: madePlace }
    }
    read = await readTodo($, path)
    isSame = read.kind === 'ok' ? read.text === expected : read.kind === 'missing' && expected === ''
    if (read.kind === 'failed') {
      return { kind: 'unread', reason: read.reason }
    }
    if (!isSame) {
      return { kind: 'changed' }
    }
    await $.fs.write(path, next)
  }

  return { kind: 'written' }
}
