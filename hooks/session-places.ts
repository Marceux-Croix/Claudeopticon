/** The folders the session works in: the project root, the session folder and home. */

import type { EngineInterface } from 'claude-code'
import { samePath } from './path-forms'
import { isInsideRoots } from './repo-folders'
import { realOf } from './fs-bounds'

/**
 * The real path of the session's project root: where it started, or where a host's directory
 * change or `/cd` took it. A shell `cd` moves `.` but not this. Undefined on an engine with no
 * `session.root`, or when the disk cannot resolve it.
 */
async function projectRoot($: EngineInterface): Promise<string | undefined> {
  const root = await Promise.resolve()
    .then(() => $.session.root())
    .catch(() => undefined)

  return typeof root === 'string' && root !== '' ? realOf($, root) : undefined
}

/** What a move of the session is told by: its project root, else `.` as before. A shell `cd` never changes it (). */
export async function sessionPlace($: EngineInterface): Promise<string | undefined> {
  return (await projectRoot($)) ?? realOf($, '.')
}

/**
 * The project root when a shell `cd` took `.` out of it: the folder search then starts there.
 * Undefined while `.` is the root or inside it (a `cd` into a folder of the project finds the same
 * repo), or when the root is unknown: the search then starts at `.`, as before.
 */
export async function sessionHome($: EngineInterface): Promise<string | undefined> {
  const root = await projectRoot($)
  if (root === undefined) {
    return undefined
  }
  const here = await realOf($, '.')

  return here !== undefined && (samePath(here, root) || isInsideRoots(here, [root])) ? undefined : root
}
