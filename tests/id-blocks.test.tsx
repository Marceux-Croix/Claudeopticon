import { expect, test } from 'claude-code/testing'

import { BLOCK_SIZE, blockIds, blockOf, CLAIM_MS, CLAIM_PRUNE_MS, CLAIM_SCAN, CLAIM_USE_MS, claimDirs, claimFrom, claimName, firstBlock, needsBlock, nextClaim, parseClaim, prunableClaims } from '../hooks/id-blocks'
import type { HeldBlock } from '../hooks/id-blocks'
import { RESERVE_MS, ticketValue, VALUE_END } from '../hooks/ticket-ids'

// ---------------------------------------------------------------- (batch H2): ID blocks

test('a claim outlives every reservation its holder made from it', () => {
  // The holder names new IDs for CLAIM_USE_MS; each lasts RESERVE_MS; the claim goes stale only after both.
  expect(CLAIM_MS).toBeGreaterThanOrEqual(CLAIM_USE_MS + RESERVE_MS)
})

/** Property: a block has one live claim; a stale one is taken over by the next generation's name, never by the same name. */
test('nextClaim: the first name for a free block, none while a claim is live, the next generation once it is stale', () => {
  const now = 10 * CLAIM_MS
  expect(nextClaim([], 3, now)).toBe('3')
  // Behind a valid first case (block 2 is held, block 3 is free), the held block gives no name.
  const entries = [{ name: '2', mtimeMs: now - 1 }, { name: 'TODO.md', mtimeMs: 0 }]
  expect(nextClaim(entries, 3, now)).toBe('3')
  expect(nextClaim(entries, 2, now)).toBeUndefined()
  // At the limit: a claim just under CLAIM_MS old is live; at CLAIM_MS it is stale.
  expect(nextClaim([{ name: '2', mtimeMs: now - CLAIM_MS + 1 }], 2, now)).toBeUndefined()
  expect(nextClaim([{ name: '2', mtimeMs: now - CLAIM_MS }], 2, now)).toBe('2.1')
  // The newest generation decides: an old stale generation does not free a block a newer claim holds.
  expect(nextClaim([{ name: '2', mtimeMs: 0 }, { name: '2.1', mtimeMs: now - 5 }], 2, now)).toBeUndefined()
  expect(nextClaim([{ name: '2', mtimeMs: 0 }, { name: '2.1', mtimeMs: 0 }], 2, now)).toBe('2.2')
  expect(parseClaim('2.1')).toEqual({ block: 2, gen: 1 })
  expect(parseClaim('x2')).toBeUndefined()
  expect(claimName(4, 0)).toBe('4')
})

/** Property: a block gives only its own IDs, each above every taken one in it or below it (batch I2: an ID above the block no longer ends it). */
test('blockIds and firstBlock: IDs of the block only, above every taken ID in or below the block', () => {
  // T0001 taken: the next free value is 2, in block 0.
  expect(firstBlock(['t0001'])).toBe(0)
  expect(blockIds(['t0001'], 0, 3)).toEqual(['T0002', 'T0003', 'T0004'])
  // The block runs out at its last value: fewer than asked.
  expect(blockIds(['t0005'], 0, 5)).toEqual(['T0006', 'T0007'])
  // A higher block starts at its first value, though taken is far below it.
  expect(blockIds(['t0001'], 2, 2).map(id => ticketValue(id))).toEqual([2 * BLOCK_SIZE, 2 * BLOCK_SIZE + 1])
  // Batch I2 changed this from none: an ID above the block (another session's, from a later block) does not end
  // it; the block gives its free values above the highest ID in use inside it.
  expect(blockIds(['t000z'], 1, 3)).toEqual(['T0008', 'T0009', 'T000A'])
  expect(blockIds(['t000z', 't0009'], 1, 3)).toEqual(['T000A', 'T000B', 'T000C'])
  expect(firstBlock(['t000z'])).toBe(blockOf(36))
  // A block whose start in base 36 begins with a letter (value 10 is `a`) still floors right.
  expect(blockIds([], blockOf(10 * BLOCK_SIZE), 1).map(id => ticketValue(id))).toEqual([10 * BLOCK_SIZE])
})

// ---------------------------------------------------------------- batch I2: remainder

/**
 * A model of `freeIds` (register.tsx) with the real block rules, ported from the verifier's
 * nodeprobe/gaps.ts: each session keeps its block and its given IDs; one claim folder, made with an
 * atomic create; every ID given is seen by the other session at once (a store sync or a file).
 */
function gapModel() {
  const claims = new Map<string, number>()
  const taken = new Set<string>(['t0001'])
  type Session = { held?: HeldBlock; given: Set<string> }
  const pick = (s: Session, count: number, time = 0): string[] => {
    const out: string[] = []
    let isSpent = false
    for (let round = 0; round < CLAIM_SCAN && out.length < count; round += 1) {
      const first = firstBlock([...taken, ...s.given])
      if (needsBlock(s.held, isSpent, time)) {
        const from = claimFrom(s.held, first)
        const entries = [...claims].map(([name, mtimeMs]) => ({ name, mtimeMs }))
        for (let block = from; block < from + CLAIM_SCAN; block += 1) {
          const name = nextClaim(entries, block, time)
          if (name !== undefined && !claims.has(name)) {
            claims.set(name, time)
            s.held = { block, claimedAt: time }
            break
          }
        }
      }
      const got = blockIds([...taken, ...s.given], s.held!.block, count - out.length).map(id => id.toLowerCase())
      got.forEach(id => s.given.add(id))
      out.push(...got)
      isSpent = out.length < count
    }
    out.forEach(id => taken.add(id))

    return out
  }
  const highest = () => Math.max(...[...taken].map(id => ticketValue(id)!))

  return { pick, highest, claims, taken }
}

/** Property: two sessions taking turns use about one value per ID: the gaps grow once per block, never once per pick. */
test('two sessions taking turns: 30 IDs use at most 40 values, and no ID is given twice', () => {
  const model = gapModel()
  const a = { given: new Set<string>() }
  const b = { given: new Set<string>() }
  const before = model.highest()
  const all: string[] = []
  for (let i = 0; i < 30; i += 1) {
    all.push(...model.pick(i % 2 === 0 ? a : b, 1))
  }
  expect(all.length).toBe(30)
  expect(new Set(all).size).toBe(30)
  // The verifier measured 233 values for these 30 IDs before the fix.
  expect(model.highest() - before).toBeLessThanOrEqual(40)
  // At the limit: picks of 3 taking turns, 90 IDs; each session's blocks hold only its own IDs.
  const big = gapModel()
  const c = { given: new Set<string>() }
  const d = { given: new Set<string>() }
  const many: string[] = []
  for (let i = 0; i < 30; i += 1) {
    many.push(...big.pick(i % 2 === 0 ? c : d, 3))
  }
  expect(new Set(many).size).toBe(90)
  expect(big.highest() - 1).toBeLessThanOrEqual(90 + 2 * BLOCK_SIZE)
  expect([...c.given].some(id => d.given.has(id))).toBe(false)
  // The excluded population: one session alone still gives one value after the other.
  const alone = gapModel()
  const e = { given: new Set<string>() }
  for (let i = 0; i < 30; i += 1) {
    alone.pick(e, 1)
  }
  expect(alone.highest()).toBe(31)
})

/** Property: another session's IDs above the block do not end it; the block's own IDs and its end still do. */
test('needsBlock: a new block only with none, a spent one, or after CLAIM_USE_MS', () => {
  const held = { block: 2, claimedAt: 1000 }
  expect(needsBlock(undefined, false, 0)).toBe(true)
  expect(needsBlock(held, false, 1000)).toBe(false)
  expect(needsBlock(held, true, 1000)).toBe(true)
  // At the limit of the use window.
  expect(needsBlock(held, false, 1000 + CLAIM_USE_MS - 1)).toBe(false)
  expect(needsBlock(held, false, 1000 + CLAIM_USE_MS)).toBe(true)
  // A new claim starts at the first free block, past the session's last one.
  expect(claimFrom(undefined, 5)).toBe(5)
  expect(claimFrom(held, 1)).toBe(3)
  expect(claimFrom(held, 9)).toBe(9)
  // The block's own highest ID moves the start; one far above it (another session's) does not.
  expect(blockIds(['t000h', 't00zz'], 2, 2)).toEqual(['T000I', 'T000J'])
  expect(blockIds(['t000n', 't00zz'], 2, 2)).toEqual([])
})

/** Property: a claim entry is deleted only when its block is below the first free one and its newest claim is stale. */
test('prunableClaims: stale and fully used claims go, every other entry stays', () => {
  const now = 10 * CLAIM_MS
  const stale = now - CLAIM_MS
  const entries = [
    { name: '0', mtimeMs: 0 },
    { name: '0.1', mtimeMs: stale },
    { name: '1', mtimeMs: stale },
    { name: '2', mtimeMs: 0 },
    { name: '2.1', mtimeMs: now - 1 },
    { name: '3', mtimeMs: 0 },
    { name: 'notes', mtimeMs: 0 },
  ]
  // Block 3 is the first free one: blocks 0 and 1 are stale and used. Their older generations go; the newest name of
  // each block stays (changed by batch J2: it was ['0', '0.1', '1']).
  expect(prunableClaims(entries, 3, now)).toEqual(['0'])
  // Behind a valid first case: block 2's newest generation is live, so its stale first generation stays too.
  expect(prunableClaims(entries, 3, now)).not.toContain('2')
  // At the limit: just under CLAIM_MS old is live; the first free block itself is never deleted, stale or not.
  expect(prunableClaims([{ name: '1', mtimeMs: now - CLAIM_MS + 1 }], 3, now)).toEqual([])
  expect(prunableClaims([{ name: '3', mtimeMs: 0 }], 3, now)).toEqual([])
  // The excluded population: a name that is no claim, and a block above the first free one.
  expect(prunableClaims([{ name: 'notes', mtimeMs: 0 }, { name: '7', mtimeMs: 0 }], 3, now)).toEqual([])
  expect(CLAIM_PRUNE_MS).toBe(60 * 60 * 1000)
})

/** Property: every session of one repo claims in one folder, in every git layout; the fallback is per repo, never per session folder. */
test('claimDirs: the git common dir in every layout, the repo fallback, and the primary folder only with no git', () => {
  // A `.git` folder, a separate git dir (a `.git` file), a submodule: each the common dir git names.
  // changed the input: no root any more, the fallback comes from the common dir alone.
  expect(claimDirs({ common: '/repo/.git' })).toEqual({ main: '/repo/.git/claudeopticon/id-claims', fallback: '/repo/.claude_work/claudeopticon-id-claims' })
  expect(claimDirs({ common: '/store/repo.git', looseBase: '/repo/mods/y' }).main).toBe('/store/repo.git/claudeopticon/id-claims')
  expect(claimDirs({ common: '/super/.git/modules/sub' }).main).toBe('/super/.git/modules/sub/claudeopticon/id-claims')
  // At the limit: a session in a subfolder with its own todo folder (`looseBase`) still claims in the repo's folders.
  expect(claimDirs({ common: '/repo/.git', looseBase: '/repo/mods/y' }).fallback).toBe('/repo/.claude_work/claudeopticon-id-claims')
  // The excluded population: no git at all keys the folder by the primary todo folder's parent; nothing known, no folder.
  expect(claimDirs({ looseBase: '/home/a/notes' })).toEqual({ main: '/home/a/notes/.claude_work/claudeopticon-id-claims' })
  expect(claimDirs({})).toEqual({})
})

/**
 * Property: every session of a repo names the same claim folders, so a block has one holder: the
 * fallback comes from the common dir alone, and only a common dir `<root>/.git` has one.
 */
test('claimDirs gives a fallback only for a common dir that ends in /.git, the same for every worktree', () => {
  // Behind a valid first case: a `.git` folder's common dir gives its root's fallback; a trailing slash names the same.
  expect(claimDirs({ common: '/repo/.git' }).fallback).toBe('/repo/.claude_work/claudeopticon-id-claims')
  expect(claimDirs({ common: '/repo/.git/' })).toEqual(claimDirs({ common: '/repo/.git' }))
  // The reviewer's layouts: a bare repo with worktrees, a separate git dir with a linked worktree, a submodule. One folder, no fallback.
  expect(claimDirs({ common: '/srv/bare.git' })).toEqual({ main: '/srv/bare.git/claudeopticon/id-claims' })
  expect(claimDirs({ common: '/store/sep.git' })).toEqual({ main: '/store/sep.git/claudeopticon/id-claims' })
  expect(claimDirs({ common: '/super/.git/modules/sub' })).toEqual({ main: '/super/.git/modules/sub/claudeopticon/id-claims' })
  // At the limit: a common dir `/.git` has no root to hold a fallback; one named `x.git` is no `<root>/.git`.
  expect(claimDirs({ common: '/.git' }).fallback).toBeUndefined()
  expect(claimDirs({ common: '/repo/x.git' }).fallback).toBeUndefined()
  // The excluded population: the session's own folder (`looseBase`) never keys a fallback when there is a common dir.
  expect(claimDirs({ common: '/srv/bare.git', looseBase: '/wt/one' })).toEqual(claimDirs({ common: '/srv/bare.git', looseBase: '/wt/two' }))
})

// ---------------------------------------------------------------- batch J2

/** Property: the newest generation name of a block is never deleted, so a deleted name is never made again as a live claim. */
test('prunableClaims never names the newest generation of a block; only lower ones go', () => {
  const now = 10 * CLAIM_MS
  const stale = now - CLAIM_MS
  // The race state: block 0 has one stale entry. Deleting it would let a session make `0` again, live, before the delete.
  expect(prunableClaims([{ name: '0', mtimeMs: 0 }], 5, now)).toEqual([])
  // Behind a valid first case: block 1's lower generations go, its newest (`1.2`) stays.
  expect(prunableClaims([{ name: '0', mtimeMs: 0 }, { name: '1', mtimeMs: 0 }, { name: '1.1', mtimeMs: 0 }, { name: '1.2', mtimeMs: stale }], 5, now)).toEqual(['1', '1.1'])
  // At the limit: the newest in a list out of order (`2.1` before `2`) is still kept.
  expect(prunableClaims([{ name: '2.1', mtimeMs: stale }, { name: '2', mtimeMs: 0 }], 5, now)).toEqual(['2'])
  // The excluded population: a live newest keeps every generation, as before.
  expect(prunableClaims([{ name: '3', mtimeMs: 0 }, { name: '3.1', mtimeMs: now - 1 }], 5, now)).toEqual([])
  // Every next claim of a block whose newest name stays takes a higher generation: the deleted names never come back.
  expect(nextClaim([{ name: '1.2', mtimeMs: stale }], 1, now)).toBe('1.3')
})

/** Property: a block's IDs are its own values, wherever the block is on the number line. */
test('blockIds keeps to its block above every ID form, and firstBlock stops at the end of the line', () => {
  // The reviewer's state: a big taken value, a block above it. The floor was a 7-character form, dropped, and IDs came from below.
  const big = 'T2024100512'
  const above = firstBlock([big]) + 1
  expect(blockIds([big], above, 3).every(id => blockOf(ticketValue(id)!) === above)).toBe(true)
  expect(blockIds([big], above, 3).length).toBe(3)
  // Behind a valid first case: a block of 5-character values, the first one past 4 characters.
  // moved the end of the line from 9ZZZZZ to VALUE_END (T20000), so this case and the limit below moved with it.
  const five = blockOf(36 ** 4)
  expect(blockIds([], five, 2).map(id => ticketValue(id))).toEqual([five * BLOCK_SIZE, five * BLOCK_SIZE + 1])
  // At the limit: the last block of the number line gives its last value, then none; firstBlock past it gives none.
  const last = blockOf(ticketValue('T1ZZZZ')!)
  expect(blockIds(['T1ZZZY'], last, 3)).toEqual(['T1ZZZZ'])
  expect(firstBlock(['T1ZZZZ'])).toBe(blockOf(VALUE_END))
  expect(blockIds([], firstBlock(['T1ZZZZ']), 3)).toEqual([])
  // The excluded population: a block in the letter-first values (no ID form) gives none, never one from below it.
  expect(blockIds([], blockOf(10 * 36 ** 3), 3)).toEqual([])
})
