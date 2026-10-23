/** The view the pane draws: files, items, agents and the orchestrator, worked out from the todo and the rows. */

import type { AgentRow, TodoFile } from '../types'
import { isEnded } from './agent-ends'
import { colorSlots } from './agent-colors'
import { AGENT_COLORS, ORCH, setColorSlots } from './agent-identity'
import type { AgentView, FileView, ItemStatus, ItemView, View } from './card-types'
import { categoryOf } from './categories'
import type { CategoryBook } from './categories'
import { fileId, filePath, itemKey, keptKey, qualifiedKey, storedKey } from './item-keys'
import { linkAgents } from './links'
import { PEER_DIM_MS, ticketId } from './peer-sessions'
import type { PeerClaim } from './peer-sessions'
import { folderPlace } from './repo-folders'
import { ticketValue } from './ticket-ids'
import { count } from './todo-markdown'

/**
 * Every open or in-progress item of the live files whose text holds every word of the query. Done
 * and archived items are not searched: the board shows no done tickets, and Show completed opens them.
 */
export function searchTodo(files: readonly FileView[], query: string): FileView[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) {
    return []
  }

  return files
    .filter(file => file.isArchived !== true)
    .map(file => ({ ...file, items: file.items.filter(item => item.status !== 'completed' && words.every(word => item.text.toLowerCase().includes(word))) }))
    .filter(file => file.items.length > 0)
}

/** The orchestrator as the view needs it: its ticket keys, whether a turn runs, and its call summary. */
export type OrchestratorState = { keys: ReadonlySet<string>; isRunning: boolean; doing?: string; toolCalls: number; title?: string }

/** The orchestrator card's title: Claude's headline, else the first ticket it owns, and how many more. */
export function orchestratorTitle(title: string | undefined, tickets: readonly string[]): string {
  const first = tickets[0]
  if (title !== undefined && title !== '') {
    return title
  }

  return first === undefined ? 'Orchestrator' : tickets.length > 1 ? `${first} and ${tickets.length - 1} more` : first
}

/** Whether a peer works on the ticket, itself or through its agents, rather than only planning it. */
const isPeerHeld = (peer: ItemView['peer']): boolean => peer !== undefined && peer.isPlanned !== true

/** What the pane draws, worked out once for the cards and the terminal alike. */
export function buildView(list: readonly TodoFile[], rows: readonly AgentRow[], now: number, orch?: OrchestratorState, peers: ReadonlyMap<string, PeerClaim> = new Map()): View {
  const links = linkAgents(list, rows)
  // Every card drawn from this view takes its agent colors from these slots.
  setColorSlots(colorSlots(rows.map(row => ({ startedAt: row.startedAt, endedAt: row.endedAt, idleSince: row.idleSince, isEnded: isEnded(row.status) })), AGENT_COLORS.length))
  const itemOwners = new Map<string, number[]>()
  const fileOwners = new Map<string, number[]>()
  rows.forEach((row, i) => {
    for (const link of links.get(row.id) ?? []) {
      const key = `${link.file}:${link.index}`
      itemOwners.set(key, [...(itemOwners.get(key) ?? []), i])
      fileOwners.set(link.file, [...new Set([...(fileOwners.get(link.file) ?? []), i])])
    }
  })
  // The orchestrator owns a ticket only while no live agent works it, then last in the item's list.
  const orchLinks: string[] = []
  const isLive = (i: number) => !isEnded(rows[i]!.status) && rows[i]!.idleSince === undefined
  if (orch !== undefined && orch.keys.size > 0) {
    for (const file of list.filter(one => one.isArchived !== true)) {
      file.items.forEach((item, index) => {
        if (item.status !== 'completed' && orch.keys.has(keptKey(file, item))) {
          const key = `${fileId(file)}:${index}`
          // A ticket handed off to a live agent is that agent's alone (#T0044): its card and its owner disk.
          if ((itemOwners.get(key) ?? []).some(isLive)) {
            return
          }
          itemOwners.set(key, [...(itemOwners.get(key) ?? []), ORCH])
          fileOwners.set(fileId(file), [...new Set([...(fileOwners.get(fileId(file)) ?? []), ORCH])])
          orchLinks.push(item.text)
        }
      })
    }
  }

  // A ticket a peer session claims, that no agent or orchestrator here holds (#T008R, #T008U): by file ID and place, to the claim.
  // A claim stands only while the box is in progress or queued; a queued one is planned work, and stays in Queued.
  // A record silent past PEER_DIM_MS is dimmed and carries its last time.
  const peerOf = new Map<string, NonNullable<ItemView['peer']>>()
  if (peers.size > 0) {
    for (const file of list.filter(one => one.isArchived !== true)) {
      file.items.forEach((item, index) => {
        const key = `${fileId(file)}:${index}`
        // Only a live holder here hides the peer's claim: an agent that finished here holds nothing (#T008Y).
        const isHeldHere = (itemOwners.get(key) ?? []).some(i => i === ORCH || isLive(i))
        const found = isHeldHere || item.status === 'completed' ? undefined : peers.get(ticketId(file, item))
        // A ticket the peer works on counts on any open box, as on its own board; planned work only while the box is in progress or queued.
        const claim = found?.isPlanned === true && item.status === 'pending' ? undefined : found
        if (claim !== undefined) {
          peerOf.set(key, {
            ...(claim.name === undefined ? {} : { name: claim.name }),
            ...(claim.isPlanned === true && item.status === 'queued' ? { isPlanned: true as const } : {}),
            ...(now - claim.seenAt > PEER_DIM_MS ? { silentSince: claim.seenAt } : {}),
          })
        }
      })
    }
  }

  // One FileView per file: the ticket board shares its columns across files, and the header card
  // has one row per file. Each item keeps its source (folder, file, path) for the writes and the
  // prompts. Sources run primary folder first, then by folder path, so the order is stable.
  const sources = [...list].sort((a, b) => Number(a.isOther === true) - Number(b.isOther === true) || ((a.rel ?? a.folder) < (b.rel ?? b.folder) ? -1 : (a.rel ?? a.folder) > (b.rel ?? b.folder) ? 1 : 0))
  // The pane ID is the name, kept short for the common case; a repeated name takes its folder too.
  const nameCount = new Map<string, number>()
  for (const file of sources) {
    nameCount.set(file.name, (nameCount.get(file.name) ?? 0) + 1)
  }
  // A file's counts include the done tickets of its archive file, so archiving leaves its bar as it was.
  const archiveDone = (file: TodoFile) => count(list.find(one => one.isArchived === true && one.folder === file.folder && one.name === `archive/${file.name}`)?.items ?? []).done
  const files: FileView[] = sources.map(file => {
    const own = count(file.items)
    const inArchive = file.isArchived === true ? 0 : archiveDone(file)
    const indexed = file.items.map((item, index) => ({ file, item, owners: itemOwners.get(`${fileId(file)}:${index}`) ?? [], peer: peerOf.get(`${fileId(file)}:${index}`) }))
    // An open or queued ticket that an agent holds shows in In progress (ticketColumns), so it counts there.
    const held = indexed.filter(one => (one.item.status === 'pending' || one.item.status === 'queued') && (one.owners.length > 0 || isPeerHeld(one.peer))).length
    const [done, active, total] = [own.done + inArchive, own.active + held, own.total + inArchive]
    const linked = indexed.filter(one => one.owners.length > 0 || one.peer !== undefined)
    const rest = [
      ...indexed.filter(one => one.item.status === 'in_progress'),
      ...indexed.filter(one => one.item.status === 'queued'),
      ...indexed.filter(one => one.item.status === 'pending'),
      ...indexed.filter(one => one.item.status === 'completed'),
    ].filter(one => one.owners.length === 0 && one.peer === undefined)
    const shown = [...linked, ...rest]

    return {
      name: file.name,
      id: (nameCount.get(file.name) ?? 0) > 1 ? fileId(file) : file.name,
      place: folderPlace(file.rel ?? file.folder),
      done,
      active,
      total,
      owners: fileOwners.get(fileId(file)) ?? [],
      items: shown.map(one => ({
        text: one.item.text,
        status: one.item.status,
        owners: one.owners,
        key: qualifiedKey(one.file, one.item),
        localKey: itemKey(one.item),
        folder: one.file.folder,
        file: one.file.name,
        path: filePath(one.file),
        ...(one.peer === undefined ? {} : { peer: one.peer }),
      })),
      mtimeMs: file.mtimeMs,
      ...(file.isArchived === true ? { isArchived: true } : {}),
    }
  })
  files.sort((a, b) => {
    const linkA = a.owners.length > 0 ? 0 : 1
    const linkB = b.owners.length > 0 ? 0 : 1
    const openA = a.done < a.total ? 0 : 1
    const openB = b.done < b.total ? 0 : 1

    // The repo root's own files first, then the rest.
    const rootA = (a.place ?? '') === '' ? 0 : 1
    const rootB = (b.place ?? '') === '' ? 0 : 1

    return rootA - rootB || linkA - linkB || openA - openB || b.mtimeMs - a.mtimeMs
  })

  const current = files.filter(file => file.isArchived !== true)
  const archivedFiles = files.filter(file => file.isArchived === true)
  const archived = count(list.filter(file => file.isArchived === true).flatMap(file => file.items)).done
  // The heading counts what the board shows: the live files with the done tickets of their own archive
  // files (the same counts as each file's bar), not an archive file that has no live file; and an open
  // ticket an agent works on counts as in progress, as the In progress column shows it.
  const all = { done: current.reduce((sum, file) => sum + file.done, 0), active: current.reduce((sum, file) => sum + file.active, 0), total: current.reduce((sum, file) => sum + file.total, 0) }

  return {
    files: [...current.filter(file => file.done < file.total), ...current.filter(file => file.done === file.total), ...archivedFiles],
    archived,
    agents: rows.map((row, i) => ({
      index: i,
      id: row.id,
      description: row.description,
      type: row.type,
      model: row.model,
      status: row.status,
      isEnded: isEnded(row.status),
      isIdle: !isEnded(row.status) && row.idleSince !== undefined,
      idleSince: row.idleSince,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      toolCalls: row.toolCalls,
      tokens: row.tokens,
      doing: row.doing,
      links: (links.get(row.id) ?? []).map(link => link.item.text),
      progress: row.progress,
    })),
    ...all,
    live: rows.filter(row => !isEnded(row.status) && row.idleSince === undefined).length,
    now,
    // The orchestrator card shows only while the main conversation works a ticket itself (#T0044).
    ...(orch === undefined || orchLinks.length === 0 || !orch.isRunning
      ? {}
      : {
          orchestrator: {
            index: ORCH,
            description: orchestratorTitle(orch.title, orchLinks),
            type: 'main conversation',
            status: orch.isRunning ? 'running' : 'idle',
            isEnded: false,
            isIdle: !orch.isRunning,
            startedAt: now,
            toolCalls: orch.toolCalls,
            ...(orch.doing === undefined ? {} : { doing: orch.doing }),
            links: orchLinks,
          } satisfies AgentView,
        }),
  }
}

/**
 * The agents in three groups: live, idle (finished but never stopped, always shown, since an open
 * task is worth a look), and finished, most recently ended first, so the bottom of the list is the
 * ledger of who ran. `shown` is what the pane lists: the finished ones only with `showFinished`.
 */
export function ledger(view: View, showFinished: boolean): { active: AgentView[]; idle: AgentView[]; finished: AgentView[]; shown: AgentView[] } {
  const active = view.agents.filter(agent => !agent.isEnded && !agent.isIdle)
  const idle = view.agents.filter(agent => !agent.isEnded && agent.isIdle)
  const finished = view.agents.filter(agent => agent.isEnded).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

  return { active, idle, finished, shown: showFinished ? [...active, ...idle, ...finished] : [...active, ...idle] }
}

/**
 * The todo files as the pane lists them: each file with open items, its open items only. With
 * `showCompleted`, every item shows, done ones last, then the complete files, then the archive.
 */
export function todoLedger(view: View, showCompleted = false): FileView[] {
  if (showCompleted) {
    return view.files
  }

  return view.files
    .filter(file => file.isArchived !== true && file.done < file.total)
    .map(file => ({ ...file, items: file.items.filter(item => item.status !== 'completed') }))
}

/**
 * What the todo area draws. The list view draws one card set per file. The ticket view draws one
 * board: a single FileView holding every file's items, files in their order (the tiebreak within
 * a column), with `rows` the files for the board's header. No files, no board.
 */
export function boardTargets(entries: readonly { file: FileView; prefix: string }[], isTickets: boolean): { file: FileView; prefix: string; rows: FileView[] }[] {
  if (!isTickets) {
    return entries.map(one => ({ ...one, rows: [one.file] }))
  }
  const first = entries[0]
  if (first === undefined) {
    return []
  }
  const files = entries.map(one => one.file)
  const file: FileView = {
    name: 'board',
    id: 'board',
    done: files.reduce((sum, one) => sum + one.done, 0),
    active: files.reduce((sum, one) => sum + one.active, 0),
    total: files.reduce((sum, one) => sum + one.total, 0),
    owners: [...new Set(files.flatMap(one => one.owners))],
    items: files.flatMap(one => one.items.map(item => (item.file === undefined ? { ...item, file: one.name } : item))),
    mtimeMs: Math.max(0, ...files.map(one => one.mtimeMs)),
  }

  return [{ file, prefix: first.prefix, rows: files }]
}

export type TicketColumn = { name: string; items: ItemView[] }

/** How the board orders the tickets of a column: `group` (agent, category, file order) or `recency` (newest ID first). */
export type TicketOrder = 'group' | 'recency'

/**
 * The value of an item's ticket ID on the number line (`ticketValue`), which grows with each new ID;
 * undefined for an item with no `#T` ID.
 */
export function itemIdValue(item: ItemView): number | undefined {
  const key = item.localKey ?? item.key

  return key.startsWith('#') ? ticketValue(key.slice(1)) : undefined
}

/**
 * A file's tickets as board columns: In progress, Queued (`- [>]`, the work slated next) and Open;
 * done tickets have no column (Show completed opens them). An open or queued ticket that a live
 * agent works on goes in In progress, and shows as in progress, though its box is still `- [ ]` or
 * `- [>]`. Within a column, the tickets an agent works on come first, then by category in the
 * order the categories were made, then in file order. With `order` set to `recency` (#T004F), each
 * column is newest first by ticket ID value instead; a ticket with no ID comes last, in file order.
 */
export function ticketColumns(given: readonly ItemView[], current: CategoryBook, order: TicketOrder = 'group'): TicketColumn[] {
  // A ticket a peer works on (not only plans) shows in In progress, as it does on that peer's own board (#T008Y).
  const items = given.map(item => ((item.status === 'pending' || item.status === 'queued') && (item.owners.length > 0 || isPeerHeld(item.peer)) ? { ...item, status: 'in_progress' as const, heldFrom: item.status } : item))
  const rank = (item: ItemView) => {
    const category = categoryOf(current, storedKey(item.key))
    const at = category === undefined ? current.categories.length : current.categories.indexOf(category)

    return (item.owners.length > 0 || item.peer !== undefined ? 0 : 1) * 100 + (at < 0 ? current.categories.length : at)
  }
  const newer = (a: ItemView, b: ItemView) => (itemIdValue(b) ?? -1) - (itemIdValue(a) ?? -1)
  const column = (name: string, status: ItemStatus) => ({
    name,
    items: items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === status)
      .sort((a, b) => (order === 'recency' ? newer(a.item, b.item) : rank(a.item) - rank(b.item)) || a.index - b.index)
      .map(({ item }) => item),
  })

  return [column('In progress', 'in_progress'), column('Queued', 'queued'), column('Open', 'pending')]
}

/**
 * How many board columns sit side by side in `width` px: the most, up to `columns`, that each keep
 * `min` px for a ticket with `gap` px between them; 1 when none does. The columns past that count
 * wrap to the next row.
 */
export function columnsThatFit(width: number, columns: number, gap: number, min: number): number {
  for (let n = Math.max(1, columns); n > 1; n -= 1) {
    if (Math.floor((width - (n - 1) * gap) / n) >= min) {
      return n
    }
  }

  return 1
}

/**
 * A board column's share of the pane, by the number of columns in its row: the width each column starts from,
 * before the columns grow to fill their row (#T0097). A last row with fewer columns widens them to fill it
 * (#T0042): Open goes double wide under the other two.
 */
export function columnShare(inRow: number): number {
  return inRow >= 3 ? 0.32 : inRow === 2 ? 0.49 : 1
}

/**
 * A board column's width in px once the columns of its row fill the pane: the pane less the gaps between the
 * columns, shared alike (#T0097).
 */
export function columnPx(paneW: number, inRow: number, gapPx: number): number {
  const n = Math.max(1, Math.floor(inRow))

  return Math.floor((paneW - (n - 1) * gapPx) / n)
}

/** The board's columns in rows of `perRow`, left to right: the rows the board draws one under another (#T0041). */
export function rowsOf<T>(columns: readonly T[], perRow: number): T[][] {
  const n = Math.max(1, Math.floor(perRow))
  const rows: T[][] = []
  for (let i = 0; i < columns.length; i += n) {
    rows.push(columns.slice(i, i + n))
  }

  return rows
}
