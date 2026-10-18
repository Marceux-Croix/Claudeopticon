import { expect, test } from 'claude-code/testing'

import { claimAcross, END_BLOCK, mustYield, otherEntries } from '../hooks/block-claim'
import type { ClaimEntry, ClaimPort } from '../hooks/block-claim'
import { blockOf, CLAIM_MS, CLAIM_SCAN } from '../hooks/id-blocks'
import { VALUE_END } from '../hooks/ticket-ids'

const GIT = '/repo/.git/claudeopticon/id-claims'
const WORK = '/repo/.claude_work/claudeopticon-id-claims'

/**
 * A fake file system of claim folders: `claims` maps a path to its mtime. `make` is atomic (a path that is there is
 * `taken`). `before` runs before each call, so a test can let another session act between two steps. Each call
 * awaits once, so two claims started together take turns step by step.
 */
function fakePort(claims: Map<string, number>, opts: { now: number; before?: (op: string, path: string) => void; unlisted?: Set<string>; missing?: Set<string> }): ClaimPort & { calls: string[] } {
  const calls: string[] = []
  const step = async (op: string, path: string) => {
    calls.push(`${op} ${path}`)
    opts.before?.(op, path)
    await Promise.resolve()
  }

  return {
    calls,
    list: async dir => {
      await step('list', dir)
      if (opts.unlisted?.has(dir) === true || opts.missing?.has(dir) === true) {
        return undefined
      }

      return [...claims].filter(([path]) => path.startsWith(`${dir}/`)).map(([path, mtimeMs]): ClaimEntry => ({ name: path.slice(dir.length + 1), mtimeMs }))
    },
    exists: async path => {
      await step('exists', path)

      return opts.missing?.has(path) !== true
    },
    make: async path => {
      await step('make', path)
      if (claims.has(path)) {
        return 'taken'
      }
      claims.set(path, opts.now)

      return 'made'
    },
    remove: async path => {
      await step('remove', path)

      return claims.delete(path)
    },
  }
}

const own = (claims: Map<string, number>, dir: string): ClaimEntry[] => [...claims].filter(([path]) => path.startsWith(`${dir}/`)).map(([path, mtimeMs]) => ({ name: path.slice(dir.length + 1), mtimeMs }))

/** Property: a block is never claimed while the repo's other claim folder holds a claim on it. */
test('a claim passes over a block the other claim folder holds, before and after its own claim', async () => {
  const now = 10 * CLAIM_MS
  // The reviewer's PD state: the fallback folder holds block 0, live; a session of the git folder claims block 1.
  const claims = new Map([[`${WORK}/0`, now]])
  expect(await claimAcross(fakePort(claims, { now }), GIT, WORK, [], 0, now)).toEqual({ block: 1, path: `${GIT}/1` })
  // PD2, the other way round: the git folder holds block 0; a session claiming in the fallback folder takes block 1.
  const back = new Map([[`${GIT}/0`, now]])
  expect(await claimAcross(fakePort(back, { now }), WORK, GIT, [], 0, now)).toEqual({ block: 1, path: `${WORK}/1` })
  // Behind a valid first case: block 0 is free in both; block 1 shows in the other folder only after this claim's list.
  const late = new Map<string, number>()
  const port = fakePort(late, { now, before: (op, path) => {
    if (op === 'make' && path === `${GIT}/0`) {
      late.set(`${GIT}/0`, now)
    }
    if (op === 'make' && path === `${GIT}/1`) {
      late.set(`${WORK}/1`, now)
    }
  } })
  // `${GIT}/0` is taken at the make (another git session), so block 1 is made, then given up when the fallback shows it.
  expect(await claimAcross(port, GIT, WORK, [], 0, now)).toEqual({ block: 2, path: `${GIT}/2` })
  expect(late.has(`${GIT}/1`)).toBe(false)
  expect(port.calls).toContain(`remove ${GIT}/1`)
  // At the limit of the scan: every block but the last held here, the last held in the other folder: no claim at all.
  const full = new Map<string, number>([[`${WORK}/${CLAIM_SCAN - 1}`, now]])
  for (let block = 0; block < CLAIM_SCAN - 1; block += 1) {
    full.set(`${GIT}/${block}`, now)
  }
  expect(await claimAcross(fakePort(full, { now }), GIT, WORK, own(full, GIT), 0, now)).toBe(`every block from 0 on is claimed`)
  // Inside the population the check lets through (a stale claim in the other folder may be taken over): another
  // session takes it over there first, with a new generation, between this list and this claim: given up.
  const stale = new Map([[`${WORK}/0`, now - CLAIM_MS]])
  const over = fakePort(stale, { now, before: (op, path) => {
    if (op === 'make' && path === `${GIT}/0.1`) {
      stale.set(`${WORK}/0.1`, now)
    }
  } })
  expect(await claimAcross(over, GIT, WORK, [], 0, now)).toEqual({ block: 1, path: `${GIT}/1` })
  expect(stale.has(`${GIT}/0.1`)).toBe(false)
})

/** Property: of two sessions that claim one block in the two folders at once, never both keep it. */
test('two sessions racing for one block in the two folders: at most one holds it, in every interleaving', async () => {
  const now = 10 * CLAIM_MS
  for (let delay = 0; delay < 12; delay += 1) {
    const claims = new Map<string, number>()
    const a = fakePort(claims, { now })
    const b = fakePort(claims, { now })
    const late = async () => {
      for (let i = 0; i < delay; i += 1) {
        await Promise.resolve()
      }

      return claimAcross(b, WORK, GIT, [], 0, now)
    }
    const [x, y] = await Promise.all([claimAcross(a, GIT, WORK, [], 0, now), late()])
    const blocks = [x, y].flatMap(one => (typeof one === 'string' ? [] : [one.block]))
    expect(new Set(blocks).size).toBe(blocks.length)
    // Every claim a session keeps is still on the disk; every one it gave up is gone.
    for (const one of [x, y]) {
      if (typeof one !== 'string') {
        expect(claims.has(one.path)).toBe(true)
      }
    }
  }
})

test('the other folder: missing is empty, there but unlisted stops the claim, and only new or live names yield', async () => {
  const now = 10 * CLAIM_MS
  expect(await otherEntries(fakePort(new Map(), { now, missing: new Set([WORK]) }), WORK)).toEqual([])
  expect(await otherEntries(fakePort(new Map(), { now, unlisted: new Set([WORK]) }), WORK)).toBeUndefined()
  expect(await otherEntries(fakePort(new Map(), { now }), undefined)).toEqual([])
  expect(await claimAcross(fakePort(new Map(), { now, unlisted: new Set([WORK]) }), GIT, WORK, [], 0, now)).toBe(`could not list ${WORK}`)
  // A stale name seen before the claim does not yield; a new name, or a live one, does; another block never does.
  expect(mustYield([{ name: '0', mtimeMs: 0 }], [{ name: '0', mtimeMs: 0 }], 0, now)).toBe(false)
  expect(mustYield([{ name: '0.1', mtimeMs: 0 }], [{ name: '0', mtimeMs: 0 }], 0, now)).toBe(true)
  expect(mustYield([{ name: '0', mtimeMs: now }], [{ name: '0', mtimeMs: now }], 0, now)).toBe(true)
  expect(mustYield([{ name: '1', mtimeMs: now }, { name: 'notes', mtimeMs: now }], [], 0, now)).toBe(false)
})

// ---------------------------------------------------------------- (batch K1)

/** Property: no block past the end of the number line is ever claimed: such a block gives no ID. */
test('claimAcross claims no block at or past END_BLOCK, and makes no entry there', async () => {
  const now = 10 * CLAIM_MS
  expect(END_BLOCK).toBe(blockOf(VALUE_END))
  // The verifier's N1 state: the first free block is past the end (an ID at the end of the line). No call at all.
  const past = fakePort(new Map(), { now })
  expect(await claimAcross(past, GIT, WORK, [], END_BLOCK, now)).toBe('the number line of ticket IDs is used up')
  expect(past.calls).toEqual([])
  // At the limit: the last block is claimed; with the last block held, the scan stops there, never past it.
  const last = fakePort(new Map(), { now })
  expect(await claimAcross(last, GIT, WORK, [], END_BLOCK - 1, now)).toEqual({ block: END_BLOCK - 1, path: `${GIT}/${END_BLOCK - 1}` })
  const held = new Map([[`${WORK}/${END_BLOCK - 1}`, now]])
  const full = fakePort(held, { now })
  expect(typeof (await claimAcross(full, GIT, WORK, [], END_BLOCK - 1, now))).toBe('string')
  expect(full.calls.filter(call => call.startsWith('make '))).toEqual([])
  // Behind a valid first case and in the excluded population: a scan that starts low still covers CLAIM_SCAN blocks.
  const low = fakePort(new Map([[`${GIT}/0`, now]]), { now })
  expect(await claimAcross(low, GIT, WORK, [{ name: '0', mtimeMs: now }], 0, now)).toEqual({ block: 1, path: `${GIT}/1` })
  expect(CLAIM_SCAN).toBeGreaterThan(1)
})
