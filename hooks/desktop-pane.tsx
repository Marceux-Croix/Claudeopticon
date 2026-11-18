/** The desktop pane: the top card, the orchestrator and agent cards, and the todo heading, search and filters, with the todo cards below. */

import type { EngineInterface, RenderInput } from 'claude-code'
import type { View } from './card-types'
import { boardFiles } from './board-files'
import type { DesktopKit } from './pane-kit'
import { agentSvg, orchestratorSvg, timelineSvg } from './agent-cards'
import { isEnded } from './agent-ends'
import { setWidth } from './card-stage'
import { altText, controlFree, keyText } from './card-text'
import { filterNames } from './categories'
import { heroCard } from './hero-card'
import { orchestratorView, pageLabel } from './orchestrator-history'
import { beginRender, clearSpaces } from './ticket-spaces'
import { ledger, searchTodo, todoLedger } from './view-model'
import { blankCard, holdRoom } from './agent-room'
import { stopAgent } from './agent-refresh'
import { openItems, recategorize } from './category-sort'
import { ACTION_RIGHT, CELL_PX, ROOM_SCOPE, ROOM_TIP, SEARCH_MIN_CELLS, STOP_HIT, STOP_PAD_CELLS, STOP_TOP } from './pane-constants'
import { redraw } from './pane-redraw'
import { S, hiddenCategories, layout } from './state'
import { toastFailure } from './toasts'
import { todoActions, todoDetail } from './todo-heading'
import { openArchive } from './trash-files'

export function desktopPane($: EngineInterface, kit: DesktopKit, e: RenderInput<'Pane'>, view: View) {
  const { Box, Button, Text, Input, Svg } = kit
  setWidth((e.props.bodyColumns ?? 48) * CELL_PX)
  beginRender(layout)
  const { active, idle, finished, shown } = ledger(view, S.isFinishedShown)
  // Held, it is drawn with no agents too, so the held room starts with the timeline's empty card.
  const timeline = S.isRoomHeld || view.agents.length > 0 ? timelineSvg(view, shown) : undefined
  const orchCard = view.orchestrator !== undefined ? agentSvg(view.orchestrator, view) : undefined
  const agentCards = shown.map(agent => ({ agent, drawn: agentSvg(agent, view) }))
  const held = S.isRoomHeld ? holdRoom(S.agentRoom, [timeline, orchCard, ...agentCards.map(one => one.drawn)].flatMap(one => (one === undefined ? [] : [one.height])), agentCards.length) : { room: S.agentRoom, blanks: [] }
  S.agentRoom = held.room
  // Every card reaches the pane here, so its alt is cleaned here, once: one control character
  // in a ticket, a command or a file name would make the engine refuse the whole pane.
  // No height is given: CELL_PX overestimates the cell, so the desktop scales each card down to the pane, and a
  // given height kept the box at the unscaled height with the image centered in it: a gap under each card, and columns of
  // different card heights starting at different tops. Without it the box takes the scaled image's own proportions.
  const card = (key: string, drawn: { source: string; width: number; height: number; alt: string; isInteractive?: true }) => (
    <Svg key={keyText(key)} source={drawn.source} alt={altText(drawn.alt)} width={drawn.width} {...(drawn.isInteractive === true ? { isInteractive: true } : {})} />
  )
  const section = (key: string, title: string, detail: string, buttonLabel: string | undefined, toggle: () => void, extra: { key: string; label: string; onPress: () => void }[] = [], showDone?: { label: string; onPress: () => void }) => (
    <Box key={keyText(key)} flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
      <Box flexDirection="row" gap={2}>
        <Text bold>{title}</Text>
        <Text dimColor>{detail}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        {extra.filter(one => one.key !== 'todo-consolidate').map(one => <Button key={one.key} label={one.label} onPress={one.onPress} />)}
        {buttonLabel !== undefined && <Button key={keyText(`${key}-toggle`)} label={buttonLabel} onPress={toggle} />}
        {showDone !== undefined && <Button key="todo-show-completed" label={showDone.label} onPress={showDone.onPress} />}
        {extra.filter(one => one.key === 'todo-consolidate').map(one => <Button key={one.key} label={one.label} onPress={one.onPress} />)}
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {(view.total > 0 || view.agents.length > 0 || view.usage !== undefined) && card('hero', heroCard(S.pluginVersion === undefined ? view : { ...view, version: S.pluginVersion }))}
      {/* The Orchestrator heading carries the room switch; pointing at it reveals its tip to its left, on the same line. */}
      <Box key="orchestrator-heading" flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
        <Box flexDirection="row" gap={2}>
          <Text bold>Orchestrator</Text>
          <Text dimColor>{S.orchestrator.isActive ? 'Working' : S.orchestrator.history.length === 0 ? 'Idle, nothing done yet' : 'Idle'}</Text>
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Box key="room-tip" display="none" hover={{ scope: ROOM_SCOPE, display: 'flex' }}>
            <Text dimColor wrap="truncate-end">{ROOM_TIP}</Text>
          </Box>
          <Button
            key="room-toggle"
            label="Limit UI shift"
            variant={S.isRoomHeld ? 'primary' : 'secondary'}
            hover={{ scope: ROOM_SCOPE, bold: true }}
            onPress={() => {
              S.isRoomHeld = !S.isRoomHeld
              redraw($)
            }}
          />
        </Box>
      </Box>
      {/* With nothing done yet, the heading alone; held, the card is drawn empty at its held height, so the first call moves nothing below it. */}
      {(S.orchestrator.history.length > 0 || S.isRoomHeld) && card('orchestrator', orchestratorSvg(orchestratorView(S.orchestrator.history, S.orchestratorPage).entries, S.isRoomHeld))}
      {orchestratorView(S.orchestrator.history, S.orchestratorPage).pages > 1 && (
        <Box key="orchestrator-pages" flexDirection="row" gap={1} alignItems="center">
          <Text dimColor>{pageLabel(orchestratorView(S.orchestrator.history, S.orchestratorPage), S.callCount)}</Text>
          {orchestratorView(S.orchestrator.history, S.orchestratorPage).page > 0 && (
            <Button
              key="orchestrator-newer"
              label="Newer"
              onPress={() => {
                S.orchestratorPage = Math.max(0, orchestratorView(S.orchestrator.history, S.orchestratorPage).page - 1)
                redraw($)
              }}
            />
          )}
          {orchestratorView(S.orchestrator.history, S.orchestratorPage).page < orchestratorView(S.orchestrator.history, S.orchestratorPage).pages - 1 && (
            <Button
              key="orchestrator-older"
              label="Older"
              onPress={() => {
                S.orchestratorPage = orchestratorView(S.orchestrator.history, S.orchestratorPage).page + 1
                redraw($)
              }}
            />
          )}
          {orchestratorView(S.orchestrator.history, S.orchestratorPage).page > 1 && (
            <Button
              key="orchestrator-latest"
              label="Latest"
              onPress={() => {
                S.orchestratorPage = 0
                redraw($)
              }}
            />
          )}
        </Box>
      )}
      {section(
        'agents',
        'Agents',
        view.agents.length === 0 ? (view.orchestrator === undefined ? 'None in this session yet' : 'No helper agents yet') : `${active.length} live, ${idle.length > 0 ? `${idle.length} idle, ` : ''}${finished.length + (view.dropped ?? 0)} finished`,
        finished.length === 0 ? undefined : S.isFinishedShown ? 'Hide finished agents' : `Show finished agents (${finished.length})`,
        () => {
          S.isFinishedShown = !S.isFinishedShown
          redraw($)
        },
      )}
      {timeline !== undefined && card('timeline', timeline)}
      {/* The orchestrator leads, before A1; no Stop button, no timeline bar. */}
      {orchCard !== undefined && card('agent-orchestrator-card', orchCard)}
      {agentCards.map(({ agent, drawn }) => (
        // A live agent's Stop button is drawn in its card at the right edge, right of the badge: the badge's row and height, red with a
        // white stop sign, so it lines up at any cell size. A plain Button of blank text lies over it to take the press.
        // Keyed by the agent's ID: a cut at the front of the rows shifts every index, and index keys would remount every card.
        <Box key={keyText(`agent-${agent.id ?? agent.index}`)} flexDirection="column" position="relative">
          {card(`agent-${agent.id ?? agent.index}-card`, drawn)}
          {!agent.isEnded && (
            <Box position="absolute" right={ACTION_RIGHT - STOP_PAD_CELLS} top={STOP_TOP}>
              <Button key={keyText(`agent-stop-${agent.id ?? agent.index}`)} label={STOP_HIT} plain onPress={() => (agent.id === undefined ? undefined : stopAgent($, agent.id).catch(toastFailure($, 'mark the agent stopped')))} />
            </Box>
          )}
        </Box>
      ))}
      {/* Empty gray slots hold the agent area at its height, so the board below stays put while three agents or fewer show. */}
      {held.blanks.map((px, i) => card(`agent-room-${i}`, blankCard(px)))}
      {section(
        'todo',
        'Todo',
        todoDetail(view),
        undefined,
        () => undefined,
        todoActions($),
        S.archiveLink === undefined ? undefined : { label: `Show completed (${view.archived})`, onPress: () => void openArchive($).catch(toastFailure($, 'open the archive')) },
      )}
      {/* The row wraps, and the search box keeps a minimum width: a row that could not wrap squeezed the search box to nothing in a very narrow pane,
          and the buttons lay over it. A wide pane keeps one row. */}
      <Box key="todo-controls" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
        {Input !== undefined && (
          <Box key="todo-search-box" minWidth={SEARCH_MIN_CELLS}>
          <Input
            key="todo-search"
            placeholder="Search open, queued and in-progress items"
            value={controlFree(S.query)}
            submitLabel="Search"
            onInput={(value: string) => {
              clearSpaces(layout, false)
              // Cleaned before it is kept: the engine refuses an Input value with a control character, and the pane would stay refused until a reload.
              S.query = controlFree(String(value))
              redraw($)
            }}
            onSubmit={(value: string) => {
              clearSpaces(layout, false)
              S.query = controlFree(String(value))
              redraw($)
            }}
          />
          </Box>
        )}
        <Button
          key="todo-tickets"
          label={S.isTicketView ? 'Show as list' : 'Show as tickets'}
          onPress={() => {
            S.isTicketView = !S.isTicketView
            redraw($)
          }}
        />
        {S.isTicketView && (
          <Button
            key="todo-order"
            label={S.ticketOrder === 'recency' ? 'Rank by group' : 'Rank by recency'}
            onPress={() => {
              S.ticketOrder = S.ticketOrder === 'recency' ? 'group' : 'recency'
              redraw($)
            }}
          />
        )}
        {openItems().length > 0 && (
          <Button
            key="todo-recategorize"
            label="Recategorize"
            onPress={() => {
              void recategorize($).catch(() => undefined)
            }}
          />
        )}
        {/* One line, cut to fit: a long note that wrapped made the row taller, and moved the board below, for its 4 s. */}
        {(S.isRecategorizing || S.recatNote !== undefined) && <Text dimColor wrap="truncate-end">{S.isRecategorizing ? 'Recategorizing...' : S.recatNote!.text}</Text>}
        {S.query.trim() === '' && !S.isTicketView && (
          <Button
            key="todo-sort"
            label="Arrange by category"
            variant={S.sortBy === 'category' ? 'primary' : 'secondary'}
            onPress={() => {
              S.sortBy = S.sortBy === 'category' ? 'file' : 'category'
              redraw($)
            }}
          />
        )}
      </Box>
      {S.query.trim() === '' && filterNames(todoLedger(view), S.book).length > 0 && (
        <Box key="category-filter" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
          <Text dimColor>Categories</Text>
          {filterNames(todoLedger(view), S.book).map(name => (
            <Button
              key={keyText(`category-toggle-${name}`)}
              label={name}
              variant={hiddenCategories.has(name) ? 'secondary' : 'primary'}
              onPress={() => {
                if (hiddenCategories.has(name)) {
                  hiddenCategories.delete(name)
                } else {
                  hiddenCategories.add(name)
                }
                redraw($)
              }}
            />
          ))}
        </Box>
      )}
      {S.query.trim() !== '' && (
        <Box key="search-head" flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text dimColor>{`${searchTodo(view.files, S.query).reduce((sum, file) => sum + file.items.length, 0)} matching items, open, queued and in progress`}</Text>
          <Button
            key="search-clear"
            label="Clear search"
            onPress={() => {
              S.query = ''
              redraw($)
            }}
          />
        </Box>
      )}
      {boardFiles($, kit, view, card)}
    </Box>
  )
}
