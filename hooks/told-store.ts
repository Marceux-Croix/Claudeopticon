/** The notes told to Claude, kept in the store. */

import type { EngineInterface } from 'claude-code'
import { mergeToldLines, readToldLists } from './told-notes'
import { sessionOf } from './id-reservations'
import { S } from './state'
import { storeSet, tryGet } from './store-access'

const toldKey = (me: string): string => `told-notes:${me}`

/** True once the stored waiting lines of this session were read into memory (once per load). */
let toldLoaded = false

/**
 * Brings the waiting renumbering, numbering and removal notes that an earlier load of this session
 * stored into memory, before the next prompt or tool result tells them: a reload between the change
 * and the prompt must not lose "#T7 is now". A store that does not read is tried again next time.
 */
export async function loadToldNotes($: EngineInterface): Promise<void> {
  if (toldLoaded) {
    return
  }
  const got = await tryGet($, toldKey(await sessionOf($)))
  if (!got.ok) {
    return
  }
  toldLoaded = true
  const stored = readToldLists(got.value)
  S.pendingRenames = mergeToldLines(S.pendingRenames, stored.renames)
  S.pendingNumbered = mergeToldLines(S.pendingNumbered, stored.numbered)
  S.pendingRemoved = mergeToldLines(S.pendingRemoved, stored.removed)
}

/** Stores the waiting lines (what loadToldNotes reads); a store that fails leaves the memory as the only copy. */
export async function saveToldNotes($: EngineInterface): Promise<void> {
  await storeSet($, toldKey(await sessionOf($)), { renames: S.pendingRenames, numbered: S.pendingNumbered, removed: S.pendingRemoved }).catch(() => undefined)
}
