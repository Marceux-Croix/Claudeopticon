/** The pane render: the cleaned Box, Text and Button, the view the pane draws, and the choice of the desktop or the terminal pane. */

import type { EngineInterface, RenderInput } from 'claude-code'
import { desktopPane } from './desktop-pane'
import { terminalPane } from './terminal-pane'
import { controlFree } from './card-text'
import { stepAxes } from './series'
import { textChildren } from './terminal-text'
import { clearSpaces, pressKeepsSpaces } from './ticket-spaces'
import { buildView } from './view-model'
import { pinColorSlots } from './agent-refresh'
import { loadAgents, saveAgents } from './kept-store'
import { orchestratorState, prunePlannedTickets, pruneTickets } from './orchestrator-tickets'
import { TITLE } from './pane-constants'
import { redraw } from './pane-redraw'
import { S, layout } from './state'
import { readUsage } from './token-burn'

export async function renderPane($: EngineInterface, e: RenderInput<'Pane'>, pane: string) {
  // A pane opened under an older title keeps it through a plugin reload: opening it again, just
  // after this draw, gives it the current one.
  if (e.props.title !== undefined && e.props.title !== TITLE && !S.isRetitled) {
    S.isRetitled = true
    // Tried once per load: a failed open retried on every draw reseated the pane each time, and a reseat resets its scroll.
    void Promise.resolve().then(() => $.ui.open({ id: pane, title: TITLE })).catch(() => undefined)
  }
  const table = $.ui.resolve(e)
  const { Box, Button: RawButton, Text: RawText } = table
  // Every Text reaches the pane here, so its words are cleaned here, once, as the cards' alt is:
  // a control character in a ticket, a todo file name or a command would make the engine refuse
  // the whole pane (the terminal surface draws them all as Text).
  const Text = ((props: Parameters<typeof RawText>[0]) => <RawText {...props}>{textChildren(props.children) as never}</RawText>) as typeof RawText
  // A press that changes nothing on the board keeps the spaces of the list view's rows that left, so no row moves at the press;
  // every other press clears them and forgets what was drawn, so the change it makes (a filter, a view switch, a search) reflows.
  // Every label is cleaned here, once, as Text is: a category name with a control character made the engine refuse the pane.
  const Button = ((props: Parameters<typeof RawButton>[0]) => (
    <RawButton
      {...props}
      label={controlFree(String(props.label))}
      onPress={(...press: Parameters<NonNullable<typeof props.onPress>>) => {
        if (!pressKeepsSpaces(props.key) && clearSpaces(layout, false)) {
          redraw($)
        }
        props.onPress?.(...press)
      }}
    />
  )) as typeof RawButton
  const Input = 'Input' in table ? table.Input : undefined
  const rows = S.agentRows
  const time = Math.max(S.clockMs, ...rows.map(row => row.endedAt ?? row.startedAt))
  if (pruneTickets() || prunePlannedTickets()) {
    saveAgents($)
  }
  // A pane drawn before the kept state is read (a plugin reload, with no session.start and no live
  // agent to tick a refresh) reads it now, and draws again once it has: the seeded token trace
  // shows at once. A read that fails draws nothing more, so this cannot loop.
  if (!S.isAgentsLoaded || !S.isBurnLoaded) {
    void Promise.all([loadAgents($), readUsage($)]).then(() => redraw($)).catch(() => undefined)
  }
  S.axes = stepAxes(S.axes, S.series, time)
  const built = buildView(S.todoFiles, rows, time, orchestratorState(), S.peerHeld)
  pinColorSlots(rows)
  const view = { ...built, ...(S.usage === undefined ? {} : { usage: S.usage }), ...(S.agentBase > 0 ? { dropped: S.agentBase } : {}), series: S.series, axes: S.axes }
  const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined
  if (Svg !== undefined) {
    return desktopPane($, { Box, Button, Text, Input, Svg }, e, view)
  }

  return terminalPane($, { Box, Button, Text, Input, Svg }, e, view)
}
