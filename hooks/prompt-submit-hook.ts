/** The prompt.submit hook: notes a background agent end, and adds the moves, labels and next IDs to a prompt. */

import type { EngineInterface, Next, PromptSubmitInput, PromptSubmitResult } from 'claude-code'
import { isEnded, notifiedEnd } from './agent-ends'
import { hasLabel, labelNote } from './claude-notes'
import { refreshAgents } from './agent-refresh'
import { setRows } from './agent-rows'
import { offerIds } from './id-claims'
import { stillOpenLine } from './orchestrator-tickets'
import { redraw } from './pane-redraw'
import { forgetTold, noteEnds, pendingNotes, queuedNotes, restoreTold } from './pending-notes'
import { S, endedHere } from './state'
import { followSessionFolder } from './todo-folders'
import { scan } from './todo-scan'
import { loadToldNotes, saveToldNotes } from './told-store'

export async function onPromptSubmit($: EngineInterface, e: PromptSubmitInput, next: Next<'prompt.submit', PromptSubmitInput, PromptSubmitResult, { 'prompt.submit': PromptSubmitInput }>, isRules: boolean) {
  if (e.origin?.kind === 'task-notification') {
    const ended = notifiedEnd(e.text)
    if (ended !== undefined) {
      // A background agent's notification carries its task ID, which is its agent ID: its row
      // takes the status it reports, also over an `ended` row.
      if (S.agentRows.some(row => row.id === ended.id && (row.status === 'ended' || !isEnded(row.status)))) {
        const old = S.agentRows
        setRows(S.agentRows.map(row => (row.id === ended.id ? { ...row, status: ended.status, endedAt: row.endedAt ?? S.clockMs } : row)))
        endedHere.add(ended.id)
        noteEnds(old, S.agentRows)
        redraw($)
      }
    }
  }
  // Moves not yet told with a tool result ride on the next prompt, a ticket button's own included.
  // They leave the waiting lists while the prompt is in flight, so a tool result of its turn does not
  // tell them twice, and go back when the prompt is dropped beneath the mod or fails.
  await loadToldNotes($)
  const told = pendingNotes()
  const moves = queuedNotes()
  forgetTold(told)
  // Local state: the prompt's own result, set inside the try so a failure on any await puts the notes back.
  let ran: Awaited<ReturnType<typeof next>>
  // The pane says "Working" only for a prompt that runs: a throw or a drop below this handler puts it back.
  const wasActive = S.orchestrator.isActive
  try {
    const isLabeled = hasLabel(e.text)
    if (isLabeled) {
      await refreshAgents($).catch(() => undefined)
    }
    // The next free IDs, recomputed each prompt; not for a notification the mod's host sends by itself.
    let idLine: string | undefined
    // A session moved to another folder reads the new repo's folders before it names IDs.
    if (await followSessionFolder($).catch(() => false)) {
      await scan($, true).catch(() => undefined)
    }
    if (isRules && e.origin?.kind !== 'task-notification' && (S.todoFolders ?? []).length > 0) {
      idLine = await offerIds($)
    }
    const notes = [...moves, isLabeled ? labelNote(e.text, S.agentRows, S.agentBase) : undefined, idLine, isRules && e.origin?.kind !== 'task-notification' ? await stillOpenLine($) : undefined].filter(note => note !== undefined)
    S.orchestrator = { ...S.orchestrator, isActive: true }
    redraw($)
    ran = await next(notes.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...notes] })
  } catch (error) {
    restoreTold(told)
    S.orchestrator = { ...S.orchestrator, isActive: wasActive }
    redraw($)
    throw error
  }
  if ((ran as { drop?: unknown } | undefined)?.drop !== undefined) {
    restoreTold(told)
    S.orchestrator = { ...S.orchestrator, isActive: wasActive }
    redraw($)
  } else if (told.renames.length + told.numbered.length + told.removed.length > 0) {
    // Told: the store forgets them too, so a reload does not tell them twice.
    await saveToldNotes($)
  }

  return ran
}
