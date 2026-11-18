/** The presence of this session and the claims of the peer sessions. */

import type { EngineInterface } from 'claude-code'
import { clock } from './card-format'
import { SESSION_NAME_NOTE, peerClaimedLine } from './claude-notes'
import type { OrchestratorEntry } from './orchestrator-history'
import { buildPresence, holdings, peerHolds, peerIds, PEER_DIM_MS, PEERS_EVERY_MS, PRESENCE_EVERY_MS, presenceKey, readPresence, samePresence, waitOver } from './peer-sessions'
import type { PeerClaim, Presence } from './peer-sessions'
import { callDetail, callSummary } from './tool-calls'
import { sessionOf } from './id-reservations'
import { itemOfTicket } from './orchestrator-tickets'
import { redraw } from './pane-redraw'
import { S, loadedGroups, orchTickets } from './state'
import { storeSet, tryGet } from './store-access'

/** The last presence record stored, and when it was stored (clock ms). */
let lastPresence: Presence | undefined

let presenceAt: number | undefined

let peersAt: number | undefined

/** When the last presence write failed: the retry waits PRESENCE_EVERY_MS from it. */
let presenceFailedAt: number | undefined

let isPeerBusy = false

/** What the last drawn peer claims looked like (names, tickets, silent state), so the next read redraws on a change of any of them. */
let peerShape = '[]'

/** Whether the note that asks Claude for this session's name was queued in this load of the mod. */
let isNameAsked = false

/** The tickets this session claims that a peer claims too, already told to Claude: told again only after the peer's claim ended. */
const peerNoted = new Set<string>()

/** Whether this load has looked in the store for the name an earlier load of this session stored. */
let isNameRead = false

/**
 * The repo root that tells which sessions share the board: the main checkout's, so the worktrees of one
 * repo match; outside git, the primary todo folder's real path, as the reservations do. Undefined when no folder is known.
 */
export function presenceRoot(): string | undefined {
  const primary = S.todoFolders?.find(one => !one.isOther)
  const root = S.centralRoot ?? S.repoRoot ?? primary?.real ?? primary?.path

  // A relative root would match sessions of other folders: no presence without an absolute one.
  return root !== undefined && /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(root) ? root : undefined
}

/**
 * One step of the presence work, run by every tick and guarded against overlap: stores this session's
 * record when its holdings or name changed, or PRESENCE_EVERY_MS after the last store; reads the
 * peers' records every PEERS_EVERY_MS and redraws when the tickets they hold changed. The store has
 * no key listing, so the peers are those in the session list (`sessions-recent`); a session leaves
 * no end event the mod can see, so a dead session's record just goes stale (PEER_IGNORE_MS).
 */
export async function peerStep($: EngineInterface, now: number): Promise<void> {
  const root = presenceRoot()
  if (isPeerBusy || root === undefined || !loadedGroups.has('tickets')) {
    return
  }
  isPeerBusy = true
  try {
    const me = await sessionOf($)
    if (!isNameRead) {
      // A reload of the mod keeps the name an earlier load of this session stored.
      const got = await tryGet($, presenceKey(me))
      if (got.ok) {
        isNameRead = true
        S.sessionName ??= readPresence(got.value)?.name
      }
    }
    const held = holdings(S.todoFiles, S.agentRows, new Set(orchTickets.keys()), S.plannedTickets)
    const next = buildPresence(me, S.sessionName, root, held, now)
    // Each wait is timed with waitOver: after a clock set back it starts over from the new time and is not held until the old one.
    const written = waitOver(presenceAt, now, PRESENCE_EVERY_MS)
    presenceAt = written.from
    const retry = waitOver(presenceFailedAt, now, PRESENCE_EVERY_MS)
    presenceFailedAt = retry.from
    // Not written while the stored name was not read and none is known: the record would carry no name and replace the stored one.
    // After a failed write the retry waits PRESENCE_EVERY_MS, not one tick.
    if ((isNameRead || S.sessionName !== undefined) && (!samePresence(lastPresence, next) || written.isOver) && retry.isOver) {
      presenceAt = now
      await storeSet($, presenceKey(me), next).then(
        () => {
          lastPresence = next
          presenceFailedAt = undefined
        },
        () => {
          presenceFailedAt = now
        },
      )
    }
    const read = waitOver(peersAt, now, PEERS_EVERY_MS)
    peersAt = read.from
    if (!read.isOver) {
      return
    }
    peersAt = now
    const list = await tryGet($, 'sessions-recent')
    if (!list.ok) {
      return
    }
    const records = (await Promise.all(peerIds(list.value, me).map(async id => ({ id, got: await tryGet($, presenceKey(id)) })))).flatMap(one => (one.got.ok ? [{ id: one.id, value: one.got.value }] : []))
    const own = new Set([...held.tickets, ...held.agentTickets, ...held.planned])
    const found = peerHolds(records, me, root, now, own)
    // A ticket this session claims that a peer claims too: told once per peer claim.
    const both = peerHolds(records, me, root, now, new Set())
    for (const id of own) {
      const claim = both.get(id)
      if (claim !== undefined && !peerNoted.has(id)) {
        peerNoted.add(id)
        const item = itemOfTicket(id)
        if (item !== undefined) {
          S.pendingClaimed = [...S.pendingClaimed, peerClaimedLine(item.text, item.id, claim.name, root)]
        }
      }
    }
    // A session with no name (one that started before the rule existed) that holds a ticket or has a peer on its root is asked for it, once per load.
    if (!isNameAsked && isNameRead && S.sessionName === undefined && (own.size > 0 || records.some(one => readPresence(one.value)?.root === root))) {
      isNameAsked = true
      S.pendingClaimed = [...S.pendingClaimed, SESSION_NAME_NOTE]
    }
    for (const id of [...peerNoted]) {
      if (!both.has(id)) {
        peerNoted.delete(id)
      }
    }
    // Compared without seenAt, which moves at each refresh: a redraw is due when the claims, the names or the silent state change.
    const shape = (claims: ReadonlyMap<string, PeerClaim>) => JSON.stringify([...claims].map(([ticket, claim]) => [ticket, claim.name, claim.isPlanned === true, now - claim.seenAt > PEER_DIM_MS ? claim.seenAt : 0]))
    // Kept at every read, so each draw judges silence by the latest seenAt; a copy kept only on a change held the
    // first seenAt, and every peer read as silent 2 minutes later.
    S.peerHeld = found
    const nextShape = shape(found)
    if (nextShape !== peerShape) {
      peerShape = nextShape
      // The view's time moves up with this change: the silent state is worked out against it.
      S.clockMs = Math.max(S.clockMs, now)
      redraw($)
    }
  } finally {
    isPeerBusy = false
  }
}

/** A history entry for a main-conversation call: its summary, time and native detail. */
export async function orchestratorEntry($: EngineInterface, input: Record<string, unknown> & { tool: string }): Promise<OrchestratorEntry> {
  const line = callSummary(input.tool, input)
  const detail = callDetail(input.tool, input, line, S.repoRoot)

  return { id: (S.callCount += 1), line, at: await $.clock.now(), isRunning: true, ...(detail === undefined ? {} : { detail }) }
}
