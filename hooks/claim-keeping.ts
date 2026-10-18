/** Which claims on tickets the scan did not find stay: those a folder that did not read could hold, for a bounded time. */

/** How long a claim on a ticket not found stays while a folder that could hold it does not read; then it ends, as for a folder that reads. */
export const MISSING_CLAIM_MS = 30 * 60_000

/** A todo folder as the claim keys name it: its path, its repo path, and whether it is not the primary folder (whose keys then start with its name). */
export type ClaimFolder = { folder: string; rel?: string; isOther?: boolean }

/** The start of the keys of a folder that is not the primary one, as `qualifiedKey` writes them. */
const prefixOf = (folder: ClaimFolder): string => `${folder.rel ?? folder.folder}::`

/**
 * True when `folder` could hold the ticket of claim `key`: a folder that is not the primary one holds
 * the keys that start with its name and `::`; a primary folder holds every key that starts with the
 * name of no other folder in `folders`.
 */
export function couldHold(key: string, folder: ClaimFolder, folders: readonly ClaimFolder[]): boolean {
  return folder.isOther === true ? key.startsWith(prefixOf(folder)) : !folders.some(one => one.isOther === true && key.startsWith(prefixOf(one)))
}

/**
 * Whether the claim on a ticket the scan did not find stays: a folder that could hold it did not
 * read (`unread`), and it was first missed (`missedAt`) less than MISSING_CLAIM_MS before `time`. A
 * folder that cannot hold the key never keeps it, so one unreadable folder does not keep the gone
 * claims of every other folder; the time bound ends a claim whose folder stays unreadable.
 */
export function keepsMissing(key: string, unread: readonly ClaimFolder[], folders: readonly ClaimFolder[], missedAt: number, time: number): boolean {
  return time - missedAt < MISSING_CLAIM_MS && unread.some(folder => couldHold(key, folder, folders))
}
