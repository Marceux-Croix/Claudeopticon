/** Delete duplicate tickets: renames or removes tickets that share an ID. */

import type { EngineInterface } from 'claude-code'
import { removeDuplicateTickets, renameRefs } from './duplicate-tickets'
import { DIR } from './repo-folders'
import { todoKind } from './todo-file-names'
import { withWriteLock } from './write-lock'
import { canDeleteDupTickets, centralFolder, chooseTarget, isBusy } from './consolidate-gates'
import { boundedJob } from './fs-bounds'
import { redraw } from './pane-redraw'
import { plainFileProblem, trustProblem } from './path-trust'
import { S } from './state'
import { showToast } from './toasts'
import { mdFiles, readStrict, writeIfUnchanged } from './todo-io'
import { scan } from './todo-scan'
import { saveToldNotes } from './told-store'

/**
 * Removes the identical tickets from the central target file (the first of each group stays) and
 * rewrites references to a removed ticket in the target and the central archive files. Each file is
 * read again right before it is written, and left alone if it changed.
 */
export async function deleteDupTickets($: EngineInterface): Promise<void> {
  await withWriteLock(() => deleteDupTicketsLocked($))
}

async function deleteDupTicketsLocked($: EngineInterface): Promise<void> {
  const central = centralFolder()
  if (central === undefined || !canDeleteDupTickets() || isBusy($)) {
    return
  }
  S.isWorking = true
  try {
    const names = await mdFiles($, central, true)
    const target = await chooseTarget($, central, names.filter(name => !name.includes('/')))
    const path = `${central}/${target}`
    if (!names.includes(target)) {
      return
    }
    // A press that cannot write says why; the button shows only when these pass (`refreshDupTickets`).
    const why = (await trustProblem($, central)) ?? (await plainFileProblem($, path))
    if (why !== undefined) {
      showToast($, `Not changed: ${DIR}/${target} (not safe: ${why})`)

      return
    }
    const text = await readStrict($, path)
    const result = removeDuplicateTickets(text, todoKind(target))
    // Nothing to remove, but archive files a press before could not follow: only their references are fixed now.
    if (result.removed.length === 0 && Object.keys(S.refsToFix).length === 0) {
      return
    }
    let done = ''
    if (result.removed.length > 0) {
      const put = await writeIfUnchanged($, path, text, result.text, { folder: central })
      if (put.kind !== 'written') {
        showToast($, put.kind === 'changed' ? `Not changed, the file changed meanwhile: ${DIR}/${target}` : `Not changed: ${DIR}/${target} (${put.kind === 'unsafe' ? `not safe: ${put.reason}` : put.kind === 'unread' ? `could not be read: ${put.reason}` : 'not written'})`)

        return
      }
      // The target changed: Claude is told, and the toast is built, now, whatever happens to the archive files.
      const mapped = Object.entries(result.map).map(([id, kept]) => `#${id.toUpperCase()} is now #${kept}`)
      S.pendingRemoved = [...S.pendingRemoved, ...result.removed.map(one => `- #${one.id} removed, it repeated #${one.kept}`), ...mapped.map(line => `- ${line}`)]
      await saveToldNotes($)
      done = `Removed ${result.removed.length} duplicate ${result.removed.length === 1 ? 'ticket' : 'tickets'} from ${DIR}/${target}.${mapped.length > 0 ? ` ${mapped.join('; ')}` : ''}`
    }
    // References in the central archive files follow; each file on its own, so one that fails names itself and stops no other.
    const changed: string[] = []
    const notFixed: string[] = []
    const fixMap = { ...S.refsToFix, ...result.map }
    if (Object.keys(fixMap).length > 0) {
      for (const name of names.filter(one => one.includes('/'))) {
        const file = `${central}/${name}`
        try {
          const before = await readStrict($, file)
          const after = renameRefs(before, fixMap, todoKind(name))
          if (after === before) {
            continue
          }
          // The checks first, then the read and compare as the last call before the write.
          const fixed = await writeIfUnchanged($, file, before, after, { folder: central })
          if (fixed.kind === 'written') {
            changed.push(name)
          } else {
            notFixed.push(`${name} (${fixed.kind === 'changed' ? 'changed meanwhile' : fixed.kind === 'unsafe' ? `not safe: ${fixed.reason}` : fixed.kind === 'unread' ? `could not be read: ${fixed.reason}` : 'not written'})`)
          }
        } catch (error) {
          notFixed.push(`${name} (${error instanceof Error ? error.message : String(error)})`)
        }
      }
    }
    // A reference fix that failed is kept: the button stays, and the next press tries those files again.
    S.refsToFix = notFixed.length > 0 ? fixMap : {}
    showToast($, `${done}${changed.length > 0 ? `${done === '' ? '' : ' '}References fixed in ${changed.join(', ')}.` : ''}${notFixed.length > 0 ? `${done === '' && changed.length === 0 ? '' : ' '}References not fixed in ${notFixed.join(', ')}.` : ''}`)
    // Bounded: a scan that does not end in time frees the writer lock; it goes on, and its late result still counts.
    await boundedJob($, scan($, true).catch(() => undefined))
  } catch (error) {
    showToast($, `Could not remove duplicate tickets: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    S.isWorking = false
    redraw($)
  }
}
