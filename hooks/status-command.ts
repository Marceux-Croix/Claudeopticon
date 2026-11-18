/** The `/claudeopticon-status` command: rescans, gathers the session facts, and answers with the report text. */

import type { EngineInterface } from 'claude-code'
import { readPluginVersion } from './pane-redraw'
import { S } from './state'
import { statusReport } from './status-report'
import { scan } from './todo-scan'

/** The option values the report states, each as the hooks read it: on unless the user turned it off. */
export type StatusOptions = { rules: boolean; foundIssues: boolean }

export async function runStatus($: EngineInterface, options: StatusOptions): Promise<string> {
  // A full rescan, so the report states the disk as it is now; a failed scan is told in the report, not hidden.
  const failed = await scan($, true).then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
  const scannedAt = await $.clock.now()
  const projectRoot: unknown = await Promise.resolve()
    .then(() => $.session.root())
    .catch(() => undefined)

  return statusReport({
    // The version session.start read; read here when that read has not ended or failed.
    version: S.pluginVersion ?? (await readPluginVersion($)),
    projectRoot: typeof projectRoot === 'string' && projectRoot !== '' ? projectRoot : undefined,
    repoRoot: S.repoRoot,
    folders: S.todoFolders ?? [],
    files: S.todoFiles,
    emptyFiles: S.emptyFiles,
    options,
    scannedAt,
    unread: failed === undefined ? S.unreadPlaces : [...S.unreadPlaces, `the scan failed: ${failed}`],
  })
}
