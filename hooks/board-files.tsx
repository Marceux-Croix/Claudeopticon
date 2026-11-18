/** The cards of each todo file on the pane: the board columns of tickets, or the list view, with their Show all and Show full text buttons. */

import type { EngineInterface } from 'claude-code'
import type { PaneKit, CardFn } from './pane-kit'
import { keyText } from './card-text'
import type { ItemView, View } from './card-types'
import { categoryGroups, groupOf, withoutHidden } from './categories'
import { storedKey } from './item-keys'
import { DIR } from './repo-folders'
import { peerTip } from './peer-sessions'
import { DONE_ACTION, QUEUE_ACTION, REOPEN_ACTION, SEND_ACTION, START_ACTION, STATUS_ACTION, UNSTART_ACTION } from './ticket-actions'
import type { TicketAction } from './ticket-actions'
import { peerSendPrompt, sendScope, ticketSummary } from './ticket-prompts'
import { columnSlots } from './ticket-spaces'
import { boardHead, boardWidth, cardWidth, fileCards, isTicketLong, listRowHeights, padCard, longItems, ticketSvg } from './todo-cards'
import { boardTargets, columnPx, columnsThatFit, itemChipId, MIN_TICKET_PX, rowsOf, searchTodo, TICKET_GAP_PX, ticketColumns, todoLedger } from './view-model'
import { claimTickets } from './orchestrator-tickets'
import { nowSync } from './pane-clock'
import { ACTION_BOTTOM, ACTION_CELLS, ACTION_RIGHT, CELL_PX, ITEMS_SHOWN } from './pane-constants'
import { redraw } from './pane-redraw'
import { presenceRoot } from './peer-sync'
import { S, expandedFiles, hiddenCategories, layout, openText, sentTickets } from './state'
import { markTicket } from './ticket-move'
import { showToast, toastFailure } from './toasts'
import { emptyRows } from './todo-heading'

export function boardFiles($: EngineInterface, kit: PaneKit, view: View, card: CardFn) {
  const { Box, Button, Text } = kit

  return boardTargets(
    S.query.trim() !== ''
      ? searchTodo(view.files, S.query).map(file => ({ file, prefix: 'search' }))
      : S.sortBy === 'category' && !S.isTicketView
        ? categoryGroups(withoutHidden(todoLedger(view), S.book, hiddenCategories), S.book).map(file => ({ file, prefix: 'category' }))
        // The board keeps the live files whole; ticketColumns leaves their done tickets out (Show completed opens them).
        : withoutHidden(S.isTicketView ? view.files.filter(file => file.isArchived !== true) : todoLedger(view), S.book, hiddenCategories).map(file => ({ file, prefix: 'file' })),
    S.isTicketView,
  ).flatMap(({ file, prefix, rows }) => {
    const id = `${prefix}:${file.id}`
    const isExpanded = expandedFiles.has(id)
    const limit = isExpanded ? file.items.length : ITEMS_SHOWN
    const isTextOpen = openText.has(id)
    const sections = (file.groups ?? [{ name: '', from: 0, count: file.items.length }]).map(group => ({
      name: group.name,
      columns: ticketColumns(file.items.slice(group.from, group.from + group.count), S.book, S.ticketOrder),
    }))
    // Side by side while each ticket has room for its text and buttons; the rest wrap to the next row, or all stack.
    // The board view spans the whole pane, so its tickets grow with it; each ticket is as
    // wide as its column, so the buttons, anchored to the column's right edge, sit on the card.
    const paneW = S.isTicketView ? boardWidth() : cardWidth()
    const columnCount = columnsThatFit(paneW, sections[0]?.columns.length ?? 1, TICKET_GAP_PX, MIN_TICKET_PX)
    const isStacked = columnCount === 1
    // What one ticket draws, worked out once per render: the slots need its height before it is placed.
    const prepared = new Map<ItemView, { sentKey: string; isSent: boolean; actions: TicketAction[]; drawn: ReturnType<typeof ticketSvg> }>()
    // The tickets whose card cuts their text: the board offers the full text for them, as the list does.
    const longTickets = new Set<ItemView>()
    // Each item is in one column, so the first call's width is its column's.
    const prepare = (item: ItemView, ticketW: number) => {
      const known = prepared.get(item)
      if (known !== undefined) {
        return known
      }
      const sentKey = `${item.file ?? file.name}:${item.key}`
      const isSent = sentTickets.has(sentKey)
      // A ticket with no listed category is tagged Uncategorized, once the book has categories.
      const category = S.book.categories.length === 0 ? undefined : groupOf(S.book, storedKey(item.key))
      const id = itemChipId(item)
      const send = isSent ? [] : [SEND_ACTION]
      // Every ticket, in every column, ends with the status question mark.
      const actions: TicketAction[] =
        item.status === 'completed'
          ? [STATUS_ACTION]
          : item.status === 'pending'
            ? [QUEUE_ACTION, START_ACTION, DONE_ACTION, ...send, STATUS_ACTION]
            : item.status === 'queued'
              ? [REOPEN_ACTION, START_ACTION, DONE_ACTION, ...send, STATUS_ACTION]
              // Back moves one column, in progress to queued; a ticket held only by a live agent has no box to move back.
              : [...(item.heldFrom === undefined ? [UNSTART_ACTION] : []), DONE_ACTION, ...(item.peer !== undefined ? send : []), STATUS_ACTION]
      // The tag's room: the card width less the buttons' cells (an overestimate, so the tag stays clear of them) and the card's padding.
      const peerTag = item.peer === undefined ? undefined : { tip: peerTip(item.peer), isDim: item.peer.silentSince !== undefined }
      if (isTicketLong(item, id, ticketW)) {
        longTickets.add(item)
      }
      const drawn = ticketSvg(item, view, ticketW, { ...(id === undefined ? {} : { id }), ...(category === undefined ? {} : { category }), isSent, isTextOpen, actions: actions.length, ...(peerTag === undefined ? {} : { peerTag }) })
      const one = { sentKey, isSent, actions, drawn }
      prepared.set(item, one)

      return one
    }
    // `slotId` is the ticket's slot ID, which is stable while the ticket stays: its key may not carry the slot's index, or every card below a change would remount.
    // `left` and `top`: the margin that sets the gap to the column on the left and the ticket above.
    const ticket = (item: ItemView, slotId: string, ticketW: number, left: number, top: number) => {
      const { sentKey, actions, drawn: plain } = prepare(item, ticketW)
      const drawn = padCard(plain, left, top)
      const press = (action: TicketAction) => {
        if (action.mark !== undefined) {
          void markTicket($, item, action.mark, action.toast).catch(toastFailure($, `move ${ticketSummary(item.text, 60)}`))

          return
        }
        // Sent, the ticket is the orchestrator's to build. A status ask starts no work: on an open or queued box it
        // claims nothing, since a claim on a ticket never seen in progress never ends, and the board held it in In progress
        // for good. On a box already in progress the claim ends as the box leaves it, so that ask still claims.
        if (action === SEND_ACTION) {
          sentTickets.add(sentKey)
        }
        // A ticket a peer claims is sent with a different prompt: Claude checks in with the owner first, and claims it only when it starts.
        const isPeerSend = action === SEND_ACTION && item.peer !== undefined
        if (!isPeerSend && (action === SEND_ACTION || (item.status === 'in_progress' && item.heldFrom === undefined))) {
          claimTickets($, [item.key])
        }
        const where = item.path ?? `${DIR}/${item.file ?? file.name}`
        const sent = isPeerSend ? peerSendPrompt(where, item.text, item.peer?.name, presenceRoot() ?? '') : action.prompt(where, item.text)
        void $.prompt.submit({ text: sent, asUser: true }).catch(toastFailure($, `send ${ticketSummary(item.text, 60)}`))
        showToast($, `${action.toast}: ${ticketSummary(item.text, 60)}`)
        redraw($)
      }

      // The buttons sit over the card's bottom row, which the card keeps free for them;
      // pointing at one reveals its tip in the same row, left of them all, cut to fit.
      return (
        <Box key={keyText(`${prefix}-${file.id}-t-${slotId}`)} flexDirection="column" position="relative">
          {card(`${prefix}-${file.id}-c-${slotId}`, drawn)}
          {actions.map(action => (
            <Box
              key={keyText(`${prefix}-${file.id}-tip-${action.name}-${item.file ?? file.name}-${item.key}`)}
              position="absolute"
              left={2 + Math.ceil(left / CELL_PX)}
              right={ACTION_RIGHT + actions.length * ACTION_CELLS}
              bottom={ACTION_BOTTOM}
              display="none"
              hover={{ scope: sendScope(`${action.name}:${sentKey}`), display: 'flex' }}
            >
              <Text dimColor wrap="truncate-end">{action.tip}</Text>
            </Box>
          ))}
          {actions.length > 0 && (
            <Box position="absolute" right={ACTION_RIGHT} bottom={ACTION_BOTTOM} flexDirection="row" gap={1}>
              {actions.map(action => (
                <Button
                  key={keyText(action === SEND_ACTION ? `ticket-${item.file ?? file.name}-${item.key}` : `ticket-${action.name}-${item.file ?? file.name}-${item.key}`)}
                  label={action.glyph}
                  hover={{ scope: sendScope(`${action.name}:${sentKey}`), bold: true }}
                  onPress={() => press(action)}
                />
              ))}
            </Box>
          )}
        </Box>
      )
    }
    const cards = S.isTicketView
      ? [
          ...(rows.length + emptyRows().length === 0 ? [] : [card(`${prefix}-${file.id}-head`, boardHead([...rows, ...emptyRows()]))]),
          ...sections.map(section => (
            <Box key={keyText(`${prefix}-${file.id}-board-${section.name}`)} flexDirection="column" gap={1}>
              {section.name !== '' && (
                <Box flexDirection="row" gap={1} marginTop={1}>
                  <Text bold>{section.name}</Text>
                  <Text dimColor>{String(section.columns.reduce((sum, column) => sum + column.items.length, 0))}</Text>
                </Box>
              )}
              {/* Explicit rows of columnCount columns: a column that does not fit starts a row below, never past the right edge. */}
              {rowsOf(section.columns, columnCount).map((row, r) => (
              // Side by side, each column is as wide as its tickets, and a margin in each ticket after the first column sets the gap.
              // An empty column takes its tickets' share of the width, so it does not shrink to its heading. The pane takes
              // only a whole percentage; rounded down, the row never passes the right edge.
              <Box key={keyText(`${prefix}-${file.id}-row-${section.name}-${r}`)} flexDirection={isStacked ? 'column' : 'row'} gap={isStacked ? 1 : 0} alignItems="flex-start">
                {row.map((column, c) => {
                  const ticketW = isStacked ? paneW : columnPx(paneW, row.length, TICKET_GAP_PX)
                  const left = isStacked || c === 0 ? 0 : TICKET_GAP_PX

                  return (
                  <Box key={keyText(`${prefix}-${file.id}-col-${section.name}-${column.name}`)} flexDirection="column" gap={1} {...(isStacked ? { width: '100%' } : column.items.length === 0 ? { width: `${Math.floor(((ticketW + left) / paneW) * 100)}%` } : {})}>
                    {/* The heading starts over its tickets, past the margin that sets the column gap. */}
                    <Box flexDirection="row" gap={1} {...(left > 0 ? { marginLeft: Math.round(left / CELL_PX) } : {})}>
                      <Text dimColor bold>{column.name}</Text>
                      <Text dimColor>{String(column.items.length)}</Text>
                    </Box>
                    {/* flex-start: each ticket Box is as wide as its image, so its buttons sit on the card. */}
                    <Box flexDirection="column" alignItems="flex-start">
                    {(() => {
                      const shown = column.items.slice(0, isExpanded ? column.items.length : ITEMS_SHOWN)
                      // Two tickets with one key get distinct slot IDs.
                      const seen = new Map<string, number>()
                      const slotId = (item: ItemView) => {
                        const base = prepare(item, ticketW).sentKey
                        const n = seen.get(base) ?? 0
                        seen.set(base, n + 1)

                        return n === 0 ? base : `${base}#${n}`
                      }
                      const ids = shown.map(slotId)
                      // A margin above each ticket after the first sets the gap between stacked tickets. A ticket that
                      // leaves leaves no space on the board: the tickets below close up at once.
                      return shown.map((item, i) => ticket(item, ids[i]!, ticketW, left, i > 0 ? TICKET_GAP_PX : 0))
                    })()}
                    </Box>
                  </Box>
                  )
                })}
              </Box>
              ))}
            </Box>
          )),
        ]
      : (() => {
          // The list view keeps a row's place the same way.
          const shown = file.items.slice(0, limit)
          const heights = listRowHeights(file, limit, isTextOpen)
          const slots = columnSlots(layout, `list:${prefix}-${file.id}`, `${limit}:${isTextOpen}:${cardWidth()}`, shown.map((item, i) => ({ id: `${item.file ?? file.name}:${item.key}`, h: heights[i] ?? 0 })), nowSync())
          const gaps = new Map<number, number>()
          let at = 0
          for (const slot of slots) {
            if (slot.isSpace === true) {
              gaps.set(at, (gaps.get(at) ?? 0) + slot.h)
            } else {
              at += 1
            }
          }

          return fileCards(file, view, limit, isTextOpen, gaps).map((drawn, k) => card(`${prefix}-${file.id}-${k}`, drawn))
        })()
    // The tickets the file offers in this view: the board's columns hold the open ones, the list holds every item.
    const offered = S.isTicketView ? sections.flatMap(section => section.columns).reduce((sum, column) => sum + column.items.length, 0) : file.items.length
    const more = S.isTicketView
      ? sections.flatMap(section => section.columns).reduce((sum, column) => sum + Math.max(0, column.items.length - ITEMS_SHOWN), 0)
      : file.items.length - ITEMS_SHOWN
    const long = S.isTicketView ? longTickets.size : longItems(file, limit)
    const toggle = (set: Set<string>) => () => {
      if (set.has(id)) {
        set.delete(id)
      } else {
        set.add(id)
      }
      redraw($)
    }

    return more <= 0 && long === 0
      ? cards
      : [
          ...cards,
          <Box key={keyText(`${prefix}-${file.id}-more`)} flexDirection="row" justifyContent="flex-end" gap={1}>
            {long > 0 && (
              <Button
                key={keyText(`${prefix}-text-${file.id}`)}
                label={isTextOpen ? 'Shorten long items' : `Show full text (${long} long ${long === 1 ? 'item' : 'items'})`}
                onPress={toggle(openText)}
              />
            )}
            {more > 0 && (
              <Button
                key={keyText(`${prefix}-toggle-${file.id}`)}
                label={isExpanded ? 'Show fewer' : `Show all ${offered} items`}
                onPress={toggle(expandedFiles)}
              />
            )}
          </Box>,
        ]
  })
}
