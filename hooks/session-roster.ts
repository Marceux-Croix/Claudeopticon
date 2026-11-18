/** The list of recent sessions in the store and this session's note in it. */

import type { EngineInterface } from 'claude-code'
import { clock } from './card-format'
import { isOldSessionList, KEPT_DROPPING, liveSessionIds, nextDropping, nextSessions, readDropping, SESSION_PREFIXES } from './kept-records'
import { SAVE_FAILS_TOAST } from './pane-constants'
import { S, saved } from './state'
import { storeSet, tryGet } from './store-access'
import { showToast } from './toasts'

/** The notes that failed in a row, and whether the toast that says so is shown (it clears with the next note that is stored). */
let touchFailures = 0

let isTouchToastShown = false

/**
 * Notes this session in the store's list of the last KEPT_SESSIONS sessions, with the time, and
 * clears the keys of the sessions that fell off it. The session start calls it, and so does the save
 * every SESSION_TOUCH_MS, so a session that runs for days stays in the list: a session that
 * noted itself in the last SESSION_LIVE_MS is never cleared. The times are in the list itself, one
 * key and one write; the old `sessions-seen` key is only read, for a list in the older form. The
 * store has no delete, so a key is overwritten with null; every reader treats null as absent. The
 * list is written first. A failed read of the list (or of the old times a list in the older form
 * needs) clears nothing. A note that is not stored is tried again after SESSION_RETRY_MS. A session
 * that finds itself gone from the list (cleared while it was asleep) writes every key again with its
 * next save.
 */
export async function pruneSessions($: EngineInterface): Promise<void> {
  const time = await $.clock.now()
  try {
    await noteSession($, time)
    S.lastTouch = time
    S.touchFailedAt = undefined
    touchFailures = 0
    isTouchToastShown = false
  } catch (error) {
    S.touchFailedAt = time
    touchFailures += 1
    // Like a failing save (saveKey): one toast after SAVE_FAILS_TOAST failures in a row. Until a note is stored, other sessions may clear this session's keys.
    if (touchFailures >= SAVE_FAILS_TOAST && !isTouchToastShown) {
      isTouchToastShown = true
      try {
        showToast($, `Claudeopticon cannot note this session in the store: ${touchFailures} notes in a row failed. Another session may clear what this session saved.`)
      } catch {
        // A toast that fails must not hide the failed note.
      }
    }
    throw error
  }
}

/** One note of this session in the session list; throws when the list is not read or not stored. */
async function noteSession($: EngineInterface, time: number): Promise<void> {
  const me = await $.session.id()
  const [got, seenGot] = await Promise.all([tryGet($, 'sessions-recent'), tryGet($, 'sessions-seen')])
  if (!got.ok || (!seenGot.ok && isOldSessionList(got.value))) {
    throw new Error('session list read failed')
  }
  S.wallMs = Math.max(S.wallMs, time)
  const { list, dropped, untimed, isListed } = nextSessions(got.value, seenGot.ok ? seenGot.value : undefined, me, time)
  // A session the list forgets is queued in `sessions-dropping` first: once the list no longer names it, no later note finds it dropped, so its keys would never be cleared. A queue that is not read or not stored throws before the list is written, and the next note starts from the same list.
  const droppedTimed = dropped.filter(one => !untimed.includes(one))
  if (droppedTimed.length > 0) {
    const queued = await tryGet($, 'sessions-dropping')
    if (!queued.ok) {
      throw new Error('session list read failed')
    }
    const held = readDropping(queued.value)
    const queue = new Map(held)
    for (const id of droppedTimed) {
      if (!queue.has(id)) {
        queue.set(id, time)
      }
    }
    if (queue.size !== held.size) {
      await storeSet($, 'sessions-dropping', [...queue].slice(-KEPT_DROPPING))
    }
  }
  await storeSet($, 'sessions-recent', list)
  if (isOldSessionList(got.value)) {
    // The list is in the new form now; the old times key is not read again.
    await storeSet($, 'sessions-seen', null).catch(() => undefined)
  }
  if (!isListed) {
    saved.clear()
    saved.set('title', undefined)
  }
  // A dropped session that noted itself while this call read a stale list is live: it keeps its keys.
  // A session with a time is cleared only in two steps: found droppable now, it waits in
  // `sessions-dropping`, and a note SESSION_DROP_CONFIRM_MS later clears its keys only when a read of
  // the list made then still shows it not live. One read cannot tell a dead session from a live one
  // whose note this write just overwrote (it read the list before that note and wrote after it); the
  // live one notes itself again within SESSION_TOUCH_MS, so the second step sees it.
  const timed = droppedTimed
  const pendingGot = await tryGet($, 'sessions-dropping')
  const pendingBefore = pendingGot.ok ? readDropping(pendingGot.value) : new Map<string, number>()
  const fresh = untimed.length === 0 && timed.length === 0 && pendingBefore.size === 0 ? undefined : await tryGet($, 'sessions-recent')
  const live = fresh?.ok === true ? new Set([...liveSessionIds(fresh.value, time), ...liveSessionIds(list, time)]) : liveSessionIds(list, time)
  // With the pending list or the fresh read missing, no timed session is cleared: the step waits for a note that reads both.
  const step = pendingGot.ok && fresh?.ok === true ? nextDropping(pendingBefore, timed, live, time) : undefined
  if (step !== undefined && JSON.stringify([...step.pending]) !== JSON.stringify([...pendingBefore])) {
    await storeSet($, 'sessions-dropping', [...step.pending]).catch(() => undefined)
  }
  const clear = [...untimed.filter(one => !live.has(one)), ...(step?.confirmed ?? [])]
  for (const id of clear) {
    for (const prefix of SESSION_PREFIXES) {
      await storeSet($, `${prefix}:${id}`, null).catch(() => undefined)
    }
  }
}
