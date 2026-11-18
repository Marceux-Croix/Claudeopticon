/** The tool.call hook of every tool: counts an agent's calls, logs the main conversation's calls, and reads the todo edits it makes. */

import type { EngineInterface, Next, ToolCallInput, ToolCallResult } from 'claude-code'
import { ORCHESTRATOR_KEPT } from './orchestrator-history'
import type { OrchestratorEntry } from './orchestrator-history'
import { DIR } from './repo-folders'
import { newlyQueued } from './peer-sessions'
import { HIDDEN, hideSecrets } from './secrets'
import { describeCall } from './tool-calls'
import { stoppedKeys } from './stop-queue'
import { wake } from './agent-refresh'
import { claimTickets, planTickets, plannedIdsOf, ticketStatuses } from './orchestrator-tickets'
import { redraw } from './pane-redraw'
import { orchestratorEntry } from './peer-sync'
import { forgetTold, pendingNotes, queuedNotes } from './pending-notes'
import { queueStopped } from './queued-notes'
import { S, pendingTools } from './state'
import { scan } from './todo-scan'
import { loadToldNotes, saveToldNotes } from './told-store'

export async function onToolCall($: EngineInterface, e: ToolCallInput, next: Next<'tool.call', ToolCallInput, ToolCallResult, { 'tool.call': ToolCallInput }>, progressTool: string) {
  const id = e.agentId
  if (id !== undefined && e.tool !== progressTool) {
    const input = e as unknown as Record<string, unknown>
    const described = describeCall(e.tool, input)
    // The whole command is checked, not only the first line the pane shows; the stored row never holds a secret.
    const command = typeof input.command === 'string' ? input.command : ''
    const doing = hideSecrets(command) === HIDDEN || hideSecrets(described) === HIDDEN ? `${e.tool}: ${HIDDEN}` : described
    pendingTools.set(id, { calls: (pendingTools.get(id)?.calls ?? 0) + 1, doing })
    wake(id)
  }
  const entry: OrchestratorEntry | undefined = id === undefined && e.tool !== 'Agent' ? await orchestratorEntry($, e as unknown as Record<string, unknown> & { tool: string }) : undefined
  if (entry !== undefined) {
    S.orchestrator = { isActive: true, history: [...S.orchestrator.history, entry].slice(-ORCHESTRATOR_KEPT) }
    redraw($)
  }
  const path = (e as { file_path?: unknown }).file_path
  // What the main conversation's edit of a todo file starts: the tickets it sets in progress.
  // Read from a scan made just now, not from a board up to 3 s old: a ticket a helper set
  // in progress since the last scan is in progress before this edit, so the edit does not claim it.
  const isOwnTodoEdit = id === undefined && typeof path === 'string' && path.includes(DIR)
  if (isOwnTodoEdit) {
    await scan($).catch(() => undefined)
  }
  const before = isOwnTodoEdit ? ticketStatuses(path) : undefined
  const ran = await next(e).finally(() => {
    if (entry !== undefined) {
      entry.isRunning = false
      redraw($)
    }
  })
  if (typeof path === 'string' && path.includes(DIR)) {
    await scan($).catch(() => undefined)
    if (before !== undefined) {
      const after = ticketStatuses(path)
      claimTickets($, [...after].filter(([key, status]) => status === 'in_progress' && before.get(key) !== 'in_progress').map(([key]) => key))
      // Work Claude stopped but did not finish is work it will come back to: the box goes to queued, not open.
      // The tickets this edit queued itself are planned; the mod's own queueing below adds the ones it queues.
      planTickets($, plannedIdsOf(path, newlyQueued(before, after)))
      const stopped = stoppedKeys(before, after)
      if (stopped.length > 0) {
        await queueStopped($, path, stopped)
      }
    }
  }
  // Moves made by hand reach the main conversation with its next tool result, mid-turn.
  if (id === undefined) {
    await loadToldNotes($)
  }
  const told = pendingNotes()
  const queued = id === undefined ? queuedNotes() : []
  if (queued.length === 0 || ran.deny !== undefined) {
    return ran
  }
  forgetTold(told)
  await saveToldNotes($)

  return { ...ran, context: [...(ran.context ?? []), ...queued] }
}
