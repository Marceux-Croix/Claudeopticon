/** The Todo heading of the pane: its detail text, its buttons and the rows of empty files. */

import type { EngineInterface } from 'claude-code'
import type { FileView, View } from './card-types'
import { folderPlace } from './repo-folders'
import { consolidate } from './consolidate'
import { canConsolidate, canDeleteDupTickets, canDeleteEmpty } from './consolidate-gates'
import { deleteDupTickets } from './delete-duplicates'
import { deleteEmpty } from './delete-empty'
import { S } from './state'
import { toastFailure } from './toasts'

/** Header rows for the empty top-level todo files, so a file Consolidate emptied stays in view until Delete empty todos removes it. */
export function emptyRows(): FileView[] {
  return S.emptyFiles
    .filter(file => !file.name.startsWith('archive/'))
    .map(file => ({ name: file.name, id: `empty:${file.path}`, place: folderPlace(file.rel ?? file.folder), done: 0, active: 0, total: 0, owners: [], items: [], mtimeMs: 0, isEmpty: true }))
}

/** How many todo files the board pulls from: the top-level files with items, in every folder on the board; archives are not counted. */
export function todoCount(): number {
  return S.todoFiles.filter(file => file.isArchived !== true).length
}

/** The dim text after the Todo heading: the counts, then the number of files they come from. */
export function todoDetail(view: View): string {
  const files = todoCount()
  // A file the scan could not read is said so; it is never shown as a file with no items.
  const unread = S.unreadPlaces.length === 0 ? '' : `Could not read ${S.unreadPlaces.length} todo ${S.unreadPlaces.length === 1 ? 'file' : 'files'}`
  const counts = view.total === 0 ? (unread === '' ? 'No checkbox items in .claude_todo/' : '') : `${view.done} of ${view.total} done, ${view.active} in progress`
  const pulling = files === 0 ? '' : `Pulling todo from ${files} ${files === 1 ? 'file' : 'files'}`

  return [counts, pulling, unread].filter(part => part !== '').join('. ')
}

/** The heading's buttons for many folders: Consolidate todos when the tickets are in more than one place or a copied file was not emptied, Delete empty todos and Delete duplicate tickets while they have work. */
export function todoActions($: EngineInterface): { key: string; label: string; onPress: () => void }[] {
  return [
    ...(canDeleteDupTickets() ? [{ key: 'todo-delete-dup-tickets', label: 'Delete duplicate tickets', onPress: () => void deleteDupTickets($).catch(toastFailure($, 'delete duplicate tickets')) }] : []),
    ...(canDeleteEmpty() ? [{ key: 'todo-delete-empty', label: 'Delete empty todos', onPress: () => void deleteEmpty($).catch(toastFailure($, 'delete empty todos')) }] : []),
    ...(canConsolidate() ? [{ key: 'todo-consolidate', label: 'Consolidate todos', onPress: () => void consolidate($).catch(toastFailure($, 'consolidate todos')) }] : []),
  ]
}
