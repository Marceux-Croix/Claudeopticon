/** The ticket ID reservations this session holds, merged through the store. */

import type { EngineInterface } from 'claude-code'
import { readKeptReserved } from './kept-records'
import { heldBy, lostIds } from './ticket-ids'
import { nowSync } from './pane-clock'
import { S, reservedIds } from './state'
import { storeSet, tryGet } from './store-access'
import { projectIds } from './todo-io'

/**
 * The store key of the reservations: one per repo (the main checkout's root), so every session on it
 * shares one key. Outside git, the primary todo folder's real path stands in for the repo, so two
 * sessions in one folder still share a key; the session ID only when there is no folder.
 */
async function reservedKey($: EngineInterface): Promise<string> {
  const primary = S.todoFolders?.find(one => !one.isOther)

  return `reserved:${S.centralRoot ?? S.repoRoot ?? primary?.real ?? primary?.path ?? (await $.session.id())}`
}

/** This session's ID, as reservations name their holder. */
export function sessionOf($: EngineInterface): Promise<string> {
  return Promise.resolve().then(() => $.session.id()).catch(() => 'session')
}

/** Drops the reserved IDs that a file holds now (on the board, or in `held`: IDs just read from the disk), and the expired ones. */
export function pruneReserved(time = nowSync(), held: Iterable<string> = []): void {
  const all = new Set([...projectIds(), ...held])
  for (const [id, one] of reservedIds) {
    if (all.has(id) || one.until <= time) {
      reservedIds.delete(id)
    }
  }
}

/** The reservation writes of this session run one after another, so each read-modify-write sees the last. */
let reserveChain: Promise<unknown> = Promise.resolve()

/** Store rounds per sync: each writes, and the next reads back what another session may have written meanwhile. The last only reads. */
const SYNC_ROUNDS = 4

/**
 * Merges the repo's stored reservations into memory (an entry that is not expired, and not in
 * `removed` when this session holds it), prunes (`held`: IDs a file holds), then stores the union and
 * reads it back, until the store holds it (an overlapping write of another session that
 * dropped an entry is repaired). An ID this session held that the store gives to another session is
 * lost: the store's holder keeps it, and the ID leaves this session's hands. A failed read leaves the
 * store alone: it never writes over what it could not read. Resolves the lost IDs, or undefined when
 * a read of the store (the read-back after a write included) failed.
 *
 * The store has only get and set, with no compare-and-set across sessions, so this record alone
 * cannot keep two sessions off one ID: the ID block claims do (`freeIds`). The record keeps
 * the offers of this session across a reload, and the IDs of a session of an older build count.
 */
export function syncReserved($: EngineInterface, removed: readonly string[] = [], held: readonly string[] = []): Promise<string[] | undefined> {
  const job = async (): Promise<string[] | undefined> => {
    const me = await sessionOf($)
    const key = await reservedKey($)
    const gone = new Set(removed)
    const lost: string[] = []
    for (let round = 0; round < SYNC_ROUNDS; round += 1) {
      const got = await tryGet($, key)
      // A read that fails, the read-back after a write included, is no answer: the caller cannot tell what the store holds.
      if (!got.ok) {
        return undefined
      }
      const time = nowSync()
      // An ID given back is dropped from the store only while this session holds it there: never another session's entry.
      const stored = readKeptReserved(got.value).filter(([id, one]) => !(gone.has(id) && heldBy(one) === me))
      for (const id of lostIds(reservedIds, stored, me, time)) {
        reservedIds.delete(id)
        lost.push(id)
      }
      for (const [id, one] of stored) {
        if (one.until > time && !reservedIds.has(id)) {
          reservedIds.set(id, one)
        }
      }
      pruneReserved(time, held)
      const value = [...reservedIds].map(([id, one]) => [id, one.until, one.offeredTo ?? null, one.by ?? null])
      // Done when the store already holds exactly this; else written, and read back in the next round.
      if (JSON.stringify(value) === JSON.stringify(got.value ?? []) || round === SYNC_ROUNDS - 1) {
        return lost
      }
      await storeSet($, key, value)
    }

    return lost
  }
  const run = reserveChain.then(job, job).catch(() => undefined)
  reserveChain = run

  return run
}
