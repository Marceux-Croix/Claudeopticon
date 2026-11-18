/** Consolidate todos: copies the tickets of every todo folder into the central one. */

import type { EngineInterface } from 'claude-code'
import { retryStep } from './consolidate-marks'
import { appendSections, copyLines, destOf, eolOf, isUnsafeHeadingName, itemLines, keepsEveryItem, pressToast, renameLines, renumberLines, sectionCount, sectionText } from './consolidate-text'
import { endsInExample } from './example-end'
import { DIR, placeOf } from './repo-folders'
import { RESERVE_MS, ticketValue } from './ticket-ids'
import { todoKind, type TodoKind } from './todo-file-names'
import { bare, isItemLine, ITEM_ID, lineOwnIds, parseTodo } from './todo-markdown'
import { withWriteLock } from './write-lock'
import { archiveDirOf } from './archive-folder'
import { PICK_CHUNK, canConsolidate, centralFolder, chooseTarget, isBusy } from './consolidate-gates'
import { dropMark, loadMarks, saveMarks } from './copy-marks'
import { diskIds } from './disk-ids'
import { boundedJob, fsBounded } from './fs-bounds'
import { freeIds } from './id-claims'
import { sessionOf, syncReserved } from './id-reservations'
import { nowSync } from './pane-clock'
import { redraw } from './pane-redraw'
import { isPlainFile, plainFileProblem, trustProblem } from './path-trust'
import { S, droppedMarks, reservedIds } from './state'
import { showToast } from './toasts'
import { rediscoverFolders } from './todo-folders'
import { mdFiles, projectIds, readStrict, writeIfUnchanged } from './todo-io'
import { scan } from './todo-scan'
import { saveToldNotes } from './told-store'

/**
 * Moves the work to one central todo, `<root of the main checkout>/.claude_todo/`: every non-blank
 * line of every other top-level todo file (other folders, and the central folder's own extra files)
 * goes into the target file, in order, under a `## From <place>/<file>` heading. Archive files of
 * other folders go to the same-named central archive file the same way. An item ID the central
 * files that stay already use gets the next free one, and references to it in the same file follow.
 * Each destination is written once, if it did not change since it was read, then read again to
 * confirm the block is there. Only then is a source emptied, and only if its text is still what was
 * copied; a source that changed is left and named. The target is never emptied. Then the folders are
 * found again (the one discovery outside startup). Off in a linked worktree and when the main
 * folder would be the global one.
 */
export async function consolidate($: EngineInterface): Promise<void> {
  await withWriteLock(() => consolidateLocked($))
}

/** True when the lines hold the same items, by box and text, read with the source file's grammar and with the destination's. */
function readsTheSame(lines: readonly string[], from: TodoKind, to: TodoKind): boolean {
  if (from === to) {
    return true
  }
  const keys = (kind: TodoKind) => parseTodo(lines.join('\n'), kind).map(item => `${item.status}\0${item.text}`).join('\n')

  return keys(from) === keys(to)
}

async function consolidateLocked($: EngineInterface): Promise<void> {
  const central = centralFolder()
  if (central === undefined || !canConsolidate() || isBusy($)) {
    return
  }
  S.isWorking = true
  // What the press did so far, for the message when it stops half way.
  const progress = { written: [] as string[], emptied: [] as string[] }
  try {
    const sources: { path: string; rel: string }[] = []
    // A source that will not list or read stays as it is: nothing of it is copied, and the press says so.
    // A source folder that is not trusted (a symlink, or outside the checkout) is named the same way, not dropped in silence.
    const unreadable: string[] = []
    for (const one of S.todoFolders ?? []) {
      if (one.path === central) {
        continue
      }
      // The reason says which check failed: a path that would not read is not called a symlink.
      const why = await trustProblem($, one.path)
      if (why === undefined) {
        sources.push({ path: one.path, rel: one.rel })
      } else {
        unreadable.push(`${one.path} (not safe: ${why})`)
      }
    }
    const texts = new Map<string, string>()
    const centralText = async (name: string) => {
      const held = texts.get(name)
      if (held !== undefined) {
        return held
      }
      const path = `${central}/${name}`
      // An existing central file that cannot be read aborts the press: it is never written over.
      const text = (await fsBounded($, () => $.fs.exists(path))) ? await readStrict($, path) : ''
      texts.set(name, text)

      return text
    }
    // One target file takes everything; the central folder's other top-level todo files are merged into it.
    const centralNames = await mdFiles($, central, true)
    // A top-level name holds no `/`; an archived one starts with the archive folder's disk name, `archive/` or `Archive/`.
    const topNames = centralNames.filter(name => !name.includes('/'))
    const target = await chooseTarget($, central, topNames)
    const mergeNames: string[] = []
    for (const name of topNames) {
      if (name !== target && itemLines(await centralText(name), todoKind(name)).length > 0) {
        mergeNames.push(name)
      }
    }
    // The IDs of the central files that stay; a moved file keeps its own IDs unless they clash with those.
    const used = new Set<string>()
    for (const name of centralNames.filter(one => !mergeNames.includes(one))) {
      for (const line of itemLines(await centralText(name), todoKind(name))) {
        const id = ITEM_ID.exec(line)?.[1]
        if (id !== undefined) {
          used.add(id.toLowerCase())
        }
      }
    }
    type Job = { path: string; name: string; heading: string; text: string; dest: string; lines: string[]; group: string }
    const jobs: Job[] = []
    // The sources whose copy would end inside an unclosed code block or HTML comment: one would swallow every section
    // after it. They are not copied and stay as they are, named, with their marks kept.
    const openSources: string[] = []
    // The sources whose name cannot stand in a `## From` heading (a line break, a control character or a format character): the heading
    // would add lines to the central todo. They are not copied and stay as they are, named, marks kept.
    const badNames: string[] = []
    // The sources whose tickets would not all read the same in their destination's grammar (a `.html` file's HTML
    // items copied into a `.md` file are no items there): not copied, left as they are, named, marks kept.
    const kindSources: string[] = []
    // The central folder's archive folder and the files in it, as its disk spells them: `Archive/` too.
    const centralArchive = (await archiveDirOf($, central)).slice(central.length + 1)
    const centralArchived = centralNames.filter(one => one.includes('/')).map(one => one.slice(one.indexOf('/') + 1))
    const add = (path: string, name: string, heading: string, text: string, group: string) => {
      const lines = copyLines(text)
      if (lines.some(line => line.trim() !== '')) {
        if (isUnsafeHeadingName(heading)) {
          badNames.push(path)

          return
        }
        // An archived source (in `archive/` or `Archive/`) goes to the central folder's own archive, as its disk spells it.
        const dest = destOf(name, target, centralArchive, centralArchived)
        if (endsInExample(lines.join('\n'), todoKind(dest))) {
          openSources.push(path)

          return
        }
        if (!readsTheSame(lines, todoKind(name), todoKind(dest))) {
          kindSources.push(path)

          return
        }
        jobs.push({ path, name, heading, text, dest, lines, group })
      }
    }
    for (const name of mergeNames) {
      if (await isPlainFile($, `${central}/${name}`)) {
        add(`${central}/${name}`, name, name, await centralText(name), central)
      }
    }
    // The source folders with a file that did not read: none of their files is a job this press, but the marks of their healthy files stay.
    const heldFolders: string[] = []
    for (const source of sources) {
      const names = await mdFiles($, source.path, true).catch(() => undefined)
      if (names === undefined) {
        unreadable.push(source.path)
        continue
      }
      const read: { name: string; text: string }[] = []
      for (const name of names) {
        // A file behind a symlink (or in a symlinked archive/) counts as unreadable: the source stays.
        const why = await plainFileProblem($, `${source.path}/${name}`)
        const text = why === undefined ? await readStrict($, `${source.path}/${name}`).catch(() => undefined) : undefined
        if (text === undefined) {
          read.length = 0
          heldFolders.push(source.path)
          unreadable.push(why === undefined ? `${source.path}/${name}` : `${source.path}/${name} (${why})`)
          break
        }
        read.push({ name, text })
      }
      for (const one of read) {
        add(`${source.path}/${one.name}`, one.name, `${placeOf(source.rel)}/${one.name}`, one.text, source.path)
      }
    }
    const unreadNote = unreadable.length > 0 ? `Not read, left as they are: ${unreadable.join(', ')}` : undefined
    const openNote = openSources.length > 0 ? `Not copied, left as they are: ${openSources.join(', ')} (ends inside an unclosed code block or HTML block). Close it, then press Consolidate todos again.` : undefined
    // Named as JSON: the name's line breaks show as \n, never as lines of the toast.
    const nameNote = badNames.length > 0 ? `Not copied, left as they are: ${badNames.map(one => JSON.stringify(one)).join(', ')} (the name holds a line break, a control character or a format character, which a heading cannot hold). Rename it, then press Consolidate todos again.` : undefined
    const kindNote = kindSources.length > 0 ? `Not copied, left as they are: ${kindSources.join(', ')} (its tickets would not all be tickets in the central file: a .md file does not read HTML checkbox items, and a .html file reads more). Move them by hand, then press Consolidate todos again.` : undefined
    if (jobs.length === 0) {
      for (const note of [unreadNote, openNote, nameNote, kindNote]) {
        if (note !== undefined) {
          showToast($, note)
        }
      }

      return
    }
    // A source copied by an earlier press (of any session, before a reload too) that was not emptied is never
    // copied again: it is only emptied, or, when it changed after that copy, left and named.
    await loadMarks($, central)
    const fresh: Job[] = []
    const changedSince: string[] = []
    const isStale = new Set<Job>()
    for (const job of jobs) {
      const step = retryStep(S.copiedNotEmptied.get(job.path), job.heading, job.lines, await centralText(job.dest), todoKind(job.dest))
      if (step === 'copy') {
        dropMark(job.path)
        fresh.push(job)
      } else if (step === 'changed') {
        isStale.add(job)
        changedSince.push(job.path)
      }
    }
    // A mark whose source is no longer a job (emptied or deleted by hand) is done with; an unreadable source keeps its mark,
    // and so does one not copied for an open end. An unreadable entry may carry its reason in parentheses: the path is before it.
    const kept = [...unreadable.map(one => one.replace(/ \([^()]*\)$/, '')), ...heldFolders, ...openSources, ...badNames, ...kindSources]
    for (const path of [...S.copiedNotEmptied.keys()]) {
      if (!jobs.some(job => job.path === path) && !kept.some(one => path === one || path.startsWith(`${one}/`))) {
        dropMark(path)
      }
    }
    // The blocks per destination, with the renumbering of each file.
    const blocks = new Map<Job, string[]>()
    const toldOf = new Map<Job, string[]>()
    // Every ID of every moved file: a new ID never takes one a later file keeps, so one clash renames one line.
    // The IDs of every folder and archive on the board are reserved too: a new value is free project-wide.
    const reserved = new Set([
      ...projectIds(),
      ...reservedIds.keys(),
      ...jobs.flatMap(job => job.lines.flatMap(line => {
        const id = isItemLine(line, todoKind(job.name)) ? ITEM_ID.exec(line)?.[1] : undefined

        return id === undefined ? [] : [id.toLowerCase()]
      })),
    ])
    // Each new `T` ID comes from this session's claimed block, as numbering's and the prompt offers' do:
    // a dry run counts them, `freeIds` gives them (recorded in `givenIds`), and they are stored with the repo's
    // reservations before any write, so no prompt, numbering pass or other session names one of them.
    const tCount = (() => {
      const dry = new Set(used)

      return fresh.reduce((sum, job) => sum + renumberLines(job.lines, dry, reserved, undefined, todoKind(job.name)).pairs.filter(pair => ticketValue(pair.to) !== undefined).length, 0)
    })()
    const supply: string[] = []
    if (tCount > 0) {
      const me = await sessionOf($)
      // The disk too, not only the board: a file may hold an ID the board has not seen yet.
      const onDisk = await diskIds($)
      // At most PICK_CHUNK IDs per pick: one pick holds at most CLAIM_SCAN blocks, so a larger count would fail every press.
      let picked: string[] | undefined = []
      for (let left = tCount; left > 0 && picked !== undefined; left -= PICK_CHUNK) {
        const part = await freeIds($, [...reserved, ...used, ...onDisk, ...picked], Math.min(PICK_CHUNK, left))
        picked = part === undefined ? undefined : [...picked, ...part]
      }
      if (picked === undefined) {
        throw new Error('no new ticket IDs could be claimed for the renumbering, so nothing was moved')
      }
      const ids = picked.map(id => id.toLowerCase())
      for (const id of ids) {
        reservedIds.set(id, { until: nowSync() + RESERVE_MS, by: me })
      }
      const lost = await syncReserved($)
      if (lost === undefined || lost.some(id => ids.includes(id))) {
        ids.forEach(id => reservedIds.delete(id))
        await syncReserved($, lost === undefined ? ids : ids.filter(id => !lost.includes(id)))
        throw new Error('the new ticket IDs for the renumbering could not be stored, so nothing was moved')
      }
      supply.push(...picked)
    }
    const renamed = new Map<Job, ReturnType<typeof renumberLines>>()
    for (const job of fresh) {
      renamed.set(job, renumberLines(job.lines, used, reserved, () => supply.shift(), todoKind(job.name)))
    }
    // One rename map per source folder: a file of the folder that names a ticket another file of the
    // folder renamed follows it. An ID the file owns itself, or that two files renamed differently, is left.
    for (const job of fresh) {
      const mine = renamed.get(job)!
      const owns = new Set(lineOwnIds(job.lines.map(bare), new Set(), todoKind(job.name)).flatMap(id => (id === undefined ? [] : [id.toLowerCase()])))
      const cross: Record<string, string> = {}
      const clash = new Set<string>()
      for (const other of fresh) {
        if (other === job || other.group !== job.group) {
          continue
        }
        for (const [old, to] of Object.entries(renamed.get(other)!.renames)) {
          if (owns.has(old)) {
            continue
          }
          if (cross[old] !== undefined && cross[old] !== to) {
            clash.add(old)
          }
          cross[old] = to
        }
      }
      clash.forEach(old => delete cross[old])
      // Lines in a code fence or an HTML comment are examples and keep their IDs.
      blocks.set(job, renameLines(mine.lines, cross, todoKind(job.name)))
      toldOf.set(job, mine.pairs.map(pair => `- ${job.heading}: #${pair.from} is now #${pair.to}`))
    }
    const emptied: string[] = []
    const left: string[] = []
    const skipped: string[] = []
    const failed: string[] = []
    const told: string[] = []
    // The destinations that end inside an unclosed code block or comment, or whose sections would not all stay items.
    const openEnded: string[] = []
    // The destinations a check refused, with the check's own reason: never called "changed meanwhile".
    const notSafe: string[] = []
    progress.emptied = emptied
    for (const dest of [...new Set(jobs.map(job => job.dest))]) {
      const path = `${central}/${dest}`
      // A source that changed after an earlier copy is neither copied nor emptied here.
      const mine = jobs.filter(one => one.dest === dest && !isStale.has(one))
      if (mine.length === 0) {
        continue
      }
      try {
        const list = fresh.filter(one => one.dest === dest).map(one => ({ job: one, place: one.heading, lines: blocks.get(one)! }))
        if (list.length > 0) {
          // The text the press read: the write below happens only if the file still holds it.
          const now = await centralText(dest)
          // Sections added after an open code fence or HTML comment would sit inside it, and leave the board.
          if (endsInExample(now, todoKind(dest))) {
            openEnded.push(`${DIR}/${dest}`)
            continue
          }
          const next = appendSections(now, list)
          // The result's items must be exactly the target's and then every section's, by text and box, before anything is
          // written or emptied: a count alone passes a lost item and an added one together.
          if (!keepsEveryItem(now, next, list, todoKind(dest))) {
            openEnded.push(`${DIR}/${dest}`)
            continue
          }
          // Marked before the write, and stored by the write's own `before` step: if the confirming read fails, or the press
          // stops before a source is emptied, a retry (after a reload too) empties the source instead of copying it again.
          // The store call comes before the write's last read and compare, so an edit made during it is never written over.
          for (const one of list) {
            droppedMarks.delete(one.job.path)
            S.copiedNotEmptied.set(one.job.path, { heading: one.job.heading, lines: one.job.lines, sectionsBefore: sectionCount(now, one.job.heading), told: toldOf.get(one.job) ?? [], isTold: false, copied: one.lines })
          }
          // Never written through a symlink: the central folder, its archive/ and an existing file must be their own real paths.
          const wrote = await writeIfUnchanged($, path, now, next, {
            folder: central,
            mayCreate: true,
            before: async () => {
              await saveMarks($, central)

              return true
            },
          })
          if (wrote.kind !== 'written') {
            // Not written: the marks go, and the sources stay as they are.
            list.forEach(one => dropMark(one.job.path))
            if (wrote.kind === 'unread') {
              failed.push(`${DIR}/${dest} (could not be read: ${wrote.reason})`)
            } else if (wrote.kind === 'unsafe') {
              notSafe.push(`${DIR}/${dest} (${wrote.reason})`)
            } else {
              skipped.push(`${DIR}/${dest}`)
            }
            continue
          }
          // Confirmed from the disk before any source is emptied.
          const after = await readStrict($, path)
          const eol = eolOf(now)
          if (!list.every(block => after.includes(sectionText(block.place, block.lines, eol)))) {
            list.forEach(one => dropMark(one.job.path))
            skipped.push(`${DIR}/${dest} (not confirmed)`)
            continue
          }
          progress.written.push(`${DIR}/${dest}`)
        } else {
          // Every source here was copied before: its copy must still be in the target, edited or not.
          const now = (await fsBounded($, () => $.fs.exists(path))) ? await readStrict($, path) : ''
          if (!mine.every(job => retryStep(S.copiedNotEmptied.get(job.path), job.heading, job.lines, now, todoKind(dest)) === 'empty')) {
            skipped.push(`${DIR}/${dest}`)
            continue
          }
        }
        // The renumbering notes of this destination are queued now it is confirmed, whatever happens to the sources.
        for (const job of mine) {
          const mark = S.copiedNotEmptied.get(job.path)
          if (mark !== undefined && !mark.isTold) {
            mark.isTold = true
            S.pendingRenames = [...S.pendingRenames, ...mark.told]
            told.push(...mark.told)
            await saveToldNotes($)
          }
        }
        for (const job of mine) {
          if (job.path === path) {
            continue
          }
          try {
            // Emptied only if it is still what was copied. A read that fails is a failure, not a change: the source
            // stays marked, so the next press only empties it.
            // The checks first, then the read and compare as the last call before the write.
            const cut = await writeIfUnchanged($, job.path, job.text, '')
            if (cut.kind === 'written') {
              emptied.push(job.path)
              dropMark(job.path)
            } else if (cut.kind === 'changed') {
              // Changed since the copy: it stays marked, so a retry names it and never copies it a second time.
              left.push(job.path)
            } else {
              // Not checked or not read: a failure, not a change. It stays marked, so the next press only empties it.
              failed.push(`${job.path} (${cut.kind === 'refused' ? 'not written' : cut.kind === 'unsafe' ? `not safe: ${cut.reason}` : `could not be read: ${cut.reason}`})`)
            }
          } catch (error) {
            // Copied, not emptied: it stays marked so the next press only empties it. Only `failed` names it: it did not change.
            failed.push(`${job.path} (${error instanceof Error ? error.message : String(error)})`)
          }
        }
      } catch (error) {
        failed.push(`${DIR}/${dest} (${error instanceof Error ? error.message : String(error)})`)
      }
    }
    await saveMarks($, central)
    // The one discovery outside startup: the git index again. The board keeps its folders until it ends.
    await rediscoverFolders($)
    // Bounded: a scan that does not end in time frees the writer lock; it goes on, and its late result still counts.
    await boundedJob($, scan($, true).catch(() => undefined))
    // One toast for the whole press: a host that keeps only the last toast of a burst would lose every refusal.
    const notes: string[] = []
    if (openEnded.length > 0) {
      notes.push(`Not written: ${openEnded.join(', ')} ends inside an unclosed code block or HTML block, so the moved tickets would not be tickets there. Their sources are as they were. Close it, then press Consolidate todos again.`)
    }
    if (openNote !== undefined) {
      notes.push(openNote)
    }
    if (nameNote !== undefined) {
      notes.push(nameNote)
    }
    if (kindNote !== undefined) {
      notes.push(kindNote)
    }
    if (notSafe.length > 0) {
      notes.push(`Not written, not safe to change: ${notSafe.join(', ')}. Their sources are as they were. Press Consolidate todos again.`)
    }
    if (skipped.length > 0) {
      notes.push(`Not written, changed meanwhile: ${skipped.join(', ')}. Their sources are as they were. Press Consolidate todos again.`)
    }
    if (left.length > 0) {
      notes.push(`Left as they are, changed since the copy: ${left.join(', ')}`)
    }
    if (changedSince.length > 0) {
      notes.push(`Not copied again, changed since an earlier copy: ${changedSince.join(', ')}. The central ${DIR}/ holds that copy under its "## From" heading. Empty the file, or take that section out, then press Consolidate todos again.`)
    }
    if (failed.length > 0) {
      notes.push(`Not finished: ${failed.join('; ')}. Written to the target: ${progress.written.length > 0 ? progress.written.join(', ') : 'nothing'}. Emptied: ${emptied.length > 0 ? emptied.join(', ') : 'none'}. Press Consolidate todos again to finish.`)
    }
    if (unreadNote !== undefined) {
      notes.push(unreadNote)
    }
    const summary = `Moved ${emptied.length} ${emptied.length === 1 ? 'file' : 'files'} into ${DIR}/${target} at the repo root.${told.length > 0 ? ` Renumbered: ${told.map(line => line.slice(2)).join('; ')}` : ''}`
    showToast($, pressToast(notes, summary, emptied.length))
  } catch (error) {
    showToast($, `Could not consolidate: ${error instanceof Error ? error.message : String(error)}. Written to the target: ${progress.written.length > 0 ? progress.written.join(', ') : 'nothing'}. Emptied: ${progress.emptied.length > 0 ? progress.emptied.join(', ') : 'none'}.`)
  } finally {
    S.isWorking = false
    redraw($)
  }
}
