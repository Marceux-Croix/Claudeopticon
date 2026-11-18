/** The session.start hook: reads the plugin version, registers the commands and tools, and starts the first scan and the ticker. */

import type { EngineInterface, Next, SessionStartInput, SessionStartResult } from 'claude-code'
import { refreshAgents } from './agent-refresh'
import { TITLE } from './pane-constants'
import { readPluginVersion, redraw } from './pane-redraw'
import { pruneSessions } from './session-roster'
import { S } from './state'
import { start } from './tick-loop'
import { toastFailure } from './toasts'
import { registerTools } from './tool-definitions'
import { scan } from './todo-scan'
import { readUsage } from './token-burn'

export async function onSessionStart($: EngineInterface, e: SessionStartInput, next: Next<'session.start', SessionStartInput, SessionStartResult, { 'session.start': SessionStartInput }>, pane: string) {
  // Read at each load, so a reload shows the revision that runs; a manifest that cannot be read shows none.
  void readPluginVersion($).then(version => {
    S.pluginVersion = version
    redraw($)
  })
  await $.command.register({
    name: 'claudeopticon',
    description: 'Show the project todo and the running agents in one pane',
  })
  await $.command.register({
    name: 'claudeopticon-status',
    description: 'Show the mod version, the folders and todo files it scanned, and its options',
  })
  $.ui.status(undefined)
  await registerTools($)
  await pruneSessions($).catch(() => undefined)
  // A scan that fails is told: the board would otherwise stay empty with no word why.
  await scan($).catch(toastFailure($, 'read the todo files'))
  await refreshAgents($).catch(() => undefined)
  await readUsage($).catch(() => undefined)
  start($)
  void $.ui.open({ id: pane, title: TITLE }).catch(() => undefined)

  return next(e)
}
