/** The flags and the can-do checks of Consolidate, Delete empty todos and Delete duplicate tickets. */

import type { EngineInterface } from 'claude-code'
import { findMainTodo, todoKind } from './todo-file-names'
import { itemLines } from './consolidate-text'
import { fileId } from './item-keys'
import { DIR } from './repo-folders'
import { S, filledSources } from './state'
import { showToast } from './toasts'
import { readStrict } from './todo-io'

/** The most new IDs Consolidate asks `freeIds` for at once: one pick scans CLAIM_SCAN blocks of BLOCK_SIZE IDs, so a count past that always fails. */
export const PICK_CHUNK = 256

/** The central folder: `<root of the main checkout>/.claude_todo`. */
export function centralFolder(): string | undefined {
  return S.centralRoot === undefined ? undefined : `${S.centralRoot}/${DIR}`
}

/**
 * True when the Consolidate todos button shows: a repo's main checkout (not a worktree, not the
 * global folder), and more than one file to merge: the top-level todo files on the board, in any
 * folder, and every `.md` or `.html` file outside the central folder that holds any text, an archive
 * file or one with no items included; or a source this session copied and did not empty. So the
 * "press Consolidate todos again" a toast asks for after a press that stopped half way has a button,
 * also when only a source archive file is left.
 */
export function canConsolidate(): boolean {
  const places = new Set([...S.todoFiles.filter(file => file.isArchived !== true).map(fileId), ...filledSources])

  return !S.centralBlocked && S.centralRoot !== undefined && (places.size > 1 || S.copiedNotEmptied.size > 0)
}

/** True when the Delete empty todos button shows: the same gate, and an empty `.md` or `.html` file in a known folder. */
export function canDeleteEmpty(): boolean {
  return !S.centralBlocked && S.centralRoot !== undefined && S.emptyFiles.length > 0
}

/** True when the Delete duplicate tickets button shows: the same gate, and identical tickets in the target file. */
export function canDeleteDupTickets(): boolean {
  return !S.centralBlocked && S.centralRoot !== undefined && (S.hasDupTickets || Object.keys(S.refsToFix).length > 0)
}

/** True when busy: the press is not run, and the user is told. */
export function isBusy($: EngineInterface): boolean {
  if (S.isWorking || S.isArchiving || S.isNumbering) {
    showToast($, 'Busy, try again in a moment')

    return true
  }

  return false
}

/**
 * The one file the central todo is merged into: `TODO.md` (else `TODO.html`) when the central folder has it; else the
 * only top-level `.md` or `.html` todo file (one with checkbox items) when there is exactly one; else `TODO.md`,
 * to be created.
 */
export async function chooseTarget($: EngineInterface, central: string, topNames: readonly string[]): Promise<string> {
  // Names compare without case, as the disk may: a `todo.md` (or `todo.html`) is the target, by its own name.
  const main = findMainTodo(topNames)
  if (main !== undefined) {
    return main
  }
  const todo: string[] = []
  for (const name of topNames) {
    if (itemLines(await readStrict($, `${central}/${name}`), todoKind(name)).length > 0) {
      todo.push(name)
    }
  }

  return todo.length === 1 ? todo[0]! : 'TODO.md'
}
