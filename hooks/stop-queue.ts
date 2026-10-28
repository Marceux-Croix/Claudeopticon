/** The tickets an edit took out of progress back to open: the ones the mod moves to queued. */

import type { ItemStatus } from './card-types'

/**
 * The keys whose ticket was in progress before an edit and open after it. Claude stopped work on
 * them but did not finish them, so they are work it will come back to soon: the mod writes `- [>]`
 * for them. A ticket already queued or open before the edit is not in the list, so an edit that sets a
 * queued ticket to open keeps it open: that is how Claude drops work it has no plan for.
 */
export function stoppedKeys(before: ReadonlyMap<string, ItemStatus>, after: ReadonlyMap<string, ItemStatus>): string[] {
  return [...after].filter(([key, status]) => status === 'pending' && before.get(key) === 'in_progress').map(([key]) => key)
}
