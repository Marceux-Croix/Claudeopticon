/**
 * Peer sessions: which tickets other Claude Code sessions on the same repo hold. Each session keeps a
 * presence record in the shared store (`presence:<session id>`); every session reads its peers' records
 * and marks their tickets "Peer owned", with "<name> owns this" in the hover tip on its board. Pure logic only: the store calls live in register.tsx.
 */

import type { AgentRow, TodoFile } from '../types'
import { cutText } from './card-text'
import { isEnded } from './agent-ends'
import { fileId, itemKey, keptKey, storedKey } from './item-keys'
import { linkAgents } from './links'

/** A session refreshes its record at most this often while it runs, and at once when its holdings change. */
export const PRESENCE_EVERY_MS = 5000
/** A session reads its peers' records this often. */
export const PEERS_EVERY_MS = 5000
/** A record older than this is a dead session's: its claims do not count. */
export const PEER_STALE_MS = 120_000
/** Caps on what a peer's record may carry, so a bad record cannot flood the board. */
export const MAX_PRESENCE_TICKETS = 200
const MAX_TICKET_CHARS = 600
const MAX_ROOT_CHARS = 1000
const MAX_ID_CHARS = 200
const MAX_PEERS = 50
export const MAX_NAME = 60

export type Presence = {
  v: 1
  sessionId: string
  name?: string
  /** The main checkout's root: worktrees of one repo share it. */
  root: string
  /** Tickets the session's main conversation holds, by `ticketId`. */
  tickets: string[]
  /** Tickets its live helper agents hold. */
  agentTickets: string[]
  seenAt: number
}

export const presenceKey = (sessionId: string): string => `presence:${sessionId}`

/**
 * A ticket's identity across sessions, whatever their cwd: the todo folder's absolute path, the file
 * name, and the stored item key (the item's own key, not the folder-qualified display key, which
 * differs by session: a folder outside the primary one adds its place to the display key).
 */
export function ticketId(file: { folder: string; name: string }, item: { text: string; id?: string; nth?: number }): string {
  return `${fileId(file)}\t${storedKey(itemKey(item))}`
}

/**
 * A session name made safe to store and draw: control characters and markup characters removed,
 * a trailing " [ref]" (ListAgents writes the name with its ref) cut, at most MAX_NAME characters.
 * Undefined when nothing is left.
 */
export function sanitizeSessionName(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined
  }
  const text = input
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/[<>&`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = cutText(text, MAX_NAME).trim()

  return cut === '' ? undefined : cut
}

/**
 * The tickets this session holds, by `ticketId`: `tickets` for its main conversation (the claims in
 * `orchKeys`, stored keys), `agentTickets` for its live agents' links. Done tickets and archived files hold nothing.
 */
export function holdings(list: readonly TodoFile[], rows: readonly AgentRow[], orchKeys: ReadonlySet<string>): { tickets: string[]; agentTickets: string[] } {
  const live = new Set(rows.filter(row => !isEnded(row.status) && row.idleSince === undefined).map(row => row.id))
  const files = list.filter(file => file.isArchived !== true)
  const byId = new Map(files.map(file => [fileId(file), file]))
  const tickets = new Set<string>()
  for (const file of files) {
    for (const item of file.items) {
      if (item.status !== 'completed' && orchKeys.has(keptKey(file, item))) {
        tickets.add(ticketId(file, item))
      }
    }
  }
  const agentTickets = new Set<string>()
  if (live.size > 0) {
    // Called as buildView calls it, with the whole list and every row: the link index is cached by the list's identity, and a different list would rebuild it at each call.
    for (const [agent, links] of linkAgents(list, rows)) {
      for (const link of live.has(agent) ? links : []) {
        const file = byId.get(link.file)
        if (file !== undefined && link.item.status !== 'completed') {
          agentTickets.add(ticketId(file, link.item))
        }
      }
    }
  }

  return { tickets: [...tickets].slice(0, MAX_PRESENCE_TICKETS), agentTickets: [...agentTickets].slice(0, MAX_PRESENCE_TICKETS) }
}

export function buildPresence(sessionId: string, name: string | undefined, root: string, held: { tickets: string[]; agentTickets: string[] }, seenAt: number): Presence {
  return { v: 1, sessionId, ...(name === undefined ? {} : { name }), root, tickets: held.tickets, agentTickets: held.agentTickets, seenAt }
}

/** Whether two records say the same, the time apart: a refresh within PRESENCE_EVERY_MS is only due when this is false. */
export function samePresence(a: Presence | undefined, b: Presence): boolean {
  return a !== undefined && a.name === b.name && a.root === b.root && a.sessionId === b.sessionId && JSON.stringify([a.tickets, a.agentTickets]) === JSON.stringify([b.tickets, b.agentTickets])
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one !== '' && one.length <= MAX_TICKET_CHARS).slice(0, MAX_PRESENCE_TICKETS) : undefined

/** A stored record held to its shape, lists and strings capped; undefined for anything else. */
export function readPresence(value: unknown): Presence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const one = value as Record<string, unknown>
  const tickets = strings(one.tickets)
  const agentTickets = strings(one.agentTickets)
  if (
    one.v !== 1 ||
    typeof one.sessionId !== 'string' ||
    one.sessionId === '' ||
    one.sessionId.length > MAX_ID_CHARS ||
    typeof one.root !== 'string' ||
    one.root === '' ||
    one.root.length > MAX_ROOT_CHARS ||
    tickets === undefined ||
    agentTickets === undefined ||
    typeof one.seenAt !== 'number' ||
    !Number.isFinite(one.seenAt)
  ) {
    return undefined
  }
  const name = sanitizeSessionName(one.name)

  return { v: 1, sessionId: one.sessionId, ...(name === undefined ? {} : { name }), root: one.root, tickets, agentTickets, seenAt: one.seenAt }
}

/** The IDs of the sessions the store's session list names, but this one, newest last; at most MAX_PEERS. */
export function peerIds(sessionList: unknown, me: string): string[] {
  const ids: string[] = []
  for (const one of Array.isArray(sessionList) ? (sessionList as unknown[]) : []) {
    const id = typeof one === 'string' ? one : Array.isArray(one) && typeof one[0] === 'string' ? one[0] : undefined
    if (id !== undefined && id !== '' && id !== me && id.length <= MAX_ID_CHARS && !ids.includes(id)) {
      ids.push(id)
    }
  }

  return ids.slice(-MAX_PEERS)
}

/**
 * The tickets live peers hold, by `ticketId`, with the name of the holder (undefined when the peer never
 * gave one). A record counts when it is well formed, names its own key's session, is of another session
 * than `me`, has the same repo root, and was seen within PEER_STALE_MS (a time in the future counts as
 * now, within the same bound). A ticket in `own` is not counted: this session's claim wins. Of two
 * peers on one ticket, the one seen last names it.
 */
export function peerHolds(records: readonly { id: string; value: unknown }[], me: string, root: string, now: number, own: ReadonlySet<string>): Map<string, string | undefined> {
  const live = records
    .map(one => ({ id: one.id, presence: readPresence(one.value) }))
    .filter((one): one is { id: string; presence: Presence } => one.presence !== undefined && one.id !== me && one.presence.sessionId === one.id && one.presence.root === root && Math.abs(now - one.presence.seenAt) < PEER_STALE_MS)
    .sort((a, b) => b.presence.seenAt - a.presence.seenAt)
  const held = new Map<string, string | undefined>()
  for (const { presence } of live) {
    for (const ticket of [...presence.tickets, ...presence.agentTickets]) {
      if (!own.has(ticket) && !held.has(ticket)) {
        held.set(ticket, presence.name)
      }
    }
  }

  return held
}

/** The owner in the tag's hover tip on a ticket a peer holds: its session name, or "An unnamed peer session" when it sent none. */
export const holderName = (name: string | undefined): string => name ?? 'An unnamed peer session'
