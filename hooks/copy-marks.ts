/** The marks of files Consolidate copied but did not empty, kept in the store. */

import type { EngineInterface } from 'claude-code'
import { mergeMarks, readKeptMarks } from './consolidate-marks'
import { S, droppedMarks } from './state'
import { storeSet, tryGet } from './store-access'

/** Ends a source's mark: in memory now, in the store with the next save that works. */
export function dropMark(path: string): void {
  S.copiedNotEmptied.delete(path)
  droppedMarks.add(path)
}

const marksKey = (central: string): string => `consolidate-marks:${central}`

/**
 * Merges the stored marks of the central folder into memory (`mergeMarks`): a mark in memory is never
 * replaced by an older stored one after a save that failed. A store that cannot be read
 * leaves the memory as it is.
 */
export async function loadMarks($: EngineInterface, central: string): Promise<void> {
  const got = await tryGet($, marksKey(central))
  if (got.ok) {
    S.copiedNotEmptied = mergeMarks(S.copiedNotEmptied, readKeptMarks(got.value), droppedMarks)
  }
}

/** Stores the marks; a store that cannot be written does not stop the press (the memory holds them, as before). */
export async function saveMarks($: EngineInterface, central: string): Promise<void> {
  // Read again first: a mark another session stored since this session's last read stays in the written map.
  await loadMarks($, central)
  const isSaved = await Promise.resolve()
    .then(() => storeSet($, marksKey(central), Object.fromEntries(S.copiedNotEmptied)))
    .then(() => true, () => false)
  if (isSaved) {
    droppedMarks.clear()
  }
}
