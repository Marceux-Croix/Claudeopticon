/** The hooks module that hooks.json loads: it registers the hooks and the tools, and calls into the modules. */

import type { Register } from 'claude-code'
import { onAgentSpawn } from './agent-spawn-hook'
import { DATA_MARK } from './claude-notes'
import { createFoundIssues } from './found-issues'
import { renderPane } from './pane-render'
import { TITLE } from './pane-constants'
import { onProgressCall } from './progress-tool-hook'
import { progressNote } from './progress-note'
import { onPromptSubmit } from './prompt-submit-hook'
import { withRules } from './rules'
import { onSessionStart } from './session-start-hook'
import { runStatus } from './status-command'
import { start } from './tick-loop'
import { moveTicket } from './ticket-move'
import { freshTodoFiles, scan } from './todo-scan'
import { burnInOrder, unlessStoreWaits } from './token-burn'
import { onToolCall } from './tool-call-hook'
import { onTurnComplete, onTurnStep } from './turn-hooks'

export { findTodoDir } from './global-folders'

/** The tool names and the pane ID stay in this file: the validator reads the filter of a hook only from a constant here. */
const PANE = 'claudeopticon'
const PROGRESS_TOOL = 'mcp__claudeopticon__report_progress'
const MOVE_TOOL = 'mcp__claudeopticon__move_ticket'

/** Appended to each agent's prompt (the test reads it from here). */
export const PROGRESS_NOTE = progressNote(PROGRESS_TOOL)

export const register: Register = (on, options) => {
  // The found-issues rule: the controller keeps the snapshot; the hooks below read the files and submit the nudge.
  const foundIssues = createFoundIssues({ enabled: options.foundIssues !== false })
  // The snapshot's scan, started at the prompt and not awaited there: a prompt never waits for a slow scan; the turn end waits for it.
  let snapshotting: Promise<void> = Promise.resolve()
  // Give Claude the todo rules, unless the user turned them off in the mod's options.
  on('prompt.context', async ($, e, next) => {
    return withRules(await next(e), options.rules !== false)
  })
  on('session.start', ($, e, next) => onSessionStart($, e, next, PANE))

  on('command.run', { command: 'claudeopticon' }, async $ => {
    await scan($).catch(() => undefined)
    start($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Claudeopticon pane opened.' }
  })
  on('command.run', { command: 'claudeopticon-status' }, async $ => ({ text: await runStatus($, { rules: options.rules !== false, foundIssues: options.foundIssues !== false }) }))
  on('agent.spawn', ($, e, next) => onAgentSpawn($, e, next, PROGRESS_TOOL, PROGRESS_NOTE))
  on('tool.call', { tool: PROGRESS_TOOL }, ($, e) => onProgressCall($, e))

  on('tool.call', { tool: MOVE_TOOL }, async ($, e) => {
    const text = await moveTicket($, e as unknown as Record<string, unknown>, e.agentId === undefined)

    // Every answer quotes ticket text or a name from a todo folder: it ends with the data mark.
    return { result: `${text} ${DATA_MARK}` }
  })
  on('tool.call', ($, e, next) => onToolCall($, e, next, PROGRESS_TOOL))
  on('prompt.submit', async ($, e, next) => {
    const submitted = await onPromptSubmit($, e, next, options.rules !== false)
    // A fresh scan, after the prompt's own work: the board may be empty before the first scan or one tick old.
    if (foundIssues.takesPrompt(e)) {
      snapshotting = freshTodoFiles($).then(files => foundIssues.onPrompt(e, files))
    }

    return submitted
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined) {
      await unlessStoreWaits(burnInOrder($, 0, true))
    }

    return compacted
  })
  on('turn.step', async function* ($, e, next) {
    return yield* onTurnStep($, e, next)
  })
  on('turn.complete', async ($, e, next) => {
    const done = await onTurnComplete($, e, next)
    await snapshotting
    if (foundIssues.takesTurn(e)) {
      const nudge = foundIssues.onTurnEnd(e, await freshTodoFiles($))
      if (nudge !== undefined) {
        // Not awaited: the nudge runs as a turn of its own once the session is idle.
        void $.prompt.submit({ text: nudge }).catch(() => undefined)
      }
    }

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e, PANE))
}
