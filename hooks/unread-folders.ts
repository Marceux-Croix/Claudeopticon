/** The scan folders that hold a place the last scan could not read. */

import type { ClaimFolder } from './claim-keeping'

/**
 * The paths of the folders in `folders` that hold one of the `unread` places. A place is
 * named as the scan names it: the folder (`<label>`), its archive (`<label>/archive`) or a file
 * (`<label>/<name>`), where the label is the folder's `rel`, else its path. A place goes to the
 * folder with the longest label it falls under, so a folder nested in another's path takes only
 * its own places. A place under no folder marks every folder: it is not known which one holds it,
 * and keeping too much is safe where dropping is not.
 */
export function foldersWithUnread(unread: readonly string[], folders: readonly ClaimFolder[]): Set<string> {
  const out = new Set<string>()
  for (const place of unread) {
    let best: ClaimFolder | undefined
    for (const folder of folders) {
      const label = folder.rel ?? folder.folder
      if ((place === label || place.startsWith(`${label}/`)) && (best === undefined || label.length > (best.rel ?? best.folder).length)) {
        best = folder
      }
    }
    if (best === undefined) {
      return new Set(folders.map(folder => folder.folder))
    }
    out.add(best.folder)
  }

  return out
}
