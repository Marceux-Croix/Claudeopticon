/**
 * The ID blocks a session claims: the block of an ID value, the claim name to make
 * for a block, and the free IDs a claimed block gives.
 *
 * Why blocks: the engine store has only get and set, so two sessions that read the reservations before
 * either writes can both take one ID. A session instead claims a block of BLOCK_SIZE ID values by
 * making an entry named for the block in the repo's claim folder, with a create that fails when the
 * name is taken (`mkdir` without `-p`; on Windows a file opened CreateNew). The OS makes that atomic,
 * so one block has one holder, and its IDs are given out with no store round trip.
 *
 * A claim goes stale CLAIM_MS after it was made: a later session may then take the block over by
 * making the next generation's name (`<block>.<gen + 1>`), which is just as atomic. The holder gives
 * out new IDs from its block only for CLAIM_USE_MS, so every ID it named (reserved for RESERVE_MS)
 * stays covered by a live claim.
 */

import { nextTicketIds, RESERVE_MS, ticketValue, VALUE_END } from './ticket-ids'

/** ID values per block: small, since a block a session leaves half used is a gap in the numbers. */
export const BLOCK_SIZE = 8
/** How long a session gives out new IDs from a block after it claimed it. */
export const CLAIM_USE_MS = RESERVE_MS
/** How old a claim is when another session may take its block over: past every reservation its holder made. */
export const CLAIM_MS = CLAIM_USE_MS + RESERVE_MS
/** Blocks tried per claim, upward from the first free one, before the claim gives up. */
export const CLAIM_SCAN = 64

/** The block an ID value falls in. */
export const blockOf = (value: number): number => Math.floor(value / BLOCK_SIZE)

/** A claim entry's name: the block, and from the first takeover on, the generation. */
export const claimName = (block: number, gen: number): string => (gen === 0 ? `${block}` : `${block}.${gen}`)

/** The block and generation a claim entry's name gives; undefined for any other name. */
export function parseClaim(name: string): { block: number; gen: number } | undefined {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(name)

  return m === null ? undefined : { block: Number(m[1]), gen: m[2] === undefined ? 0 : Number(m[2]) }
}

/**
 * The name to make to claim `block`, given the claim folder's entries: the first generation when the
 * block has none, the next one when its newest claim is stale (older than CLAIM_MS at `now`), and
 * undefined while another claim on it is live.
 */
export function nextClaim(entries: readonly { name: string; mtimeMs: number }[], block: number, now: number): string | undefined {
  let newest: { gen: number; mtimeMs: number } | undefined
  for (const entry of entries) {
    const claim = parseClaim(entry.name)
    if (claim !== undefined && claim.block === block && (newest === undefined || claim.gen > newest.gen)) {
      newest = { gen: claim.gen, mtimeMs: entry.mtimeMs }
    }
  }
  if (newest === undefined) {
    return claimName(block, 0)
  }

  return now - newest.mtimeMs >= CLAIM_MS ? claimName(block, newest.gen + 1) : undefined
}

/** The block the next free ID above every one of `taken` falls in: where a new claim starts. */
export function firstBlock(taken: Iterable<string>): number {
  const next = nextTicketIds(taken, 1)[0]

  // Past the end of the number line: the block just past it, which gives no ID.
  return next === undefined ? blockOf(VALUE_END) : blockOf(ticketValue(next)!)
}

/**
 * Up to `count` free IDs of `block`, above every ID of `taken` that falls in the block or below it.
 * An ID of `taken` above the block (one another session gave from a later block) does not end it
 *: while the claim holds, the block is this session's alone, so its free values stay free.
 * So the rule "a new ID comes after the highest one in use" holds per new block: a block is claimed
 * at the first free value, and IDs go up inside it from the highest one in use in it. Fewer, or none,
 * when the block runs out.
 */
export function blockIds(taken: Iterable<string>, block: number, count: number): string[] {
  const start = block * BLOCK_SIZE
  const end = start + BLOCK_SIZE
  const inBlock = [...taken].filter(id => {
    const value = ticketValue(id)

    return value !== undefined && value < end
  })

  // The floor is the value just below the block, as a number: an ID form of it may not exist (one past
  // VALUE_END), and a floor that was dropped gave IDs from below the block.
  return nextTicketIds(inBlock, count, start - 1).filter(id => blockOf(ticketValue(id)!) === block)
}

/** The block a session gives IDs from, and when it claimed it (clock ms). */
export type HeldBlock = { block: number; claimedAt: number }

/**
 * True when the session must claim a new block before it gives an ID: it has none, its block ran out
 * (`isSpent`), or CLAIM_USE_MS passed since its claim. Never because another session's IDs passed
 * the block: that made every pick of two sessions taking turns claim a new block.
 */
export const needsBlock = (held: HeldBlock | undefined, isSpent: boolean, time: number): boolean => held === undefined || isSpent || time - held.claimedAt >= CLAIM_USE_MS

/** The block a new claim starts at: the first free one, and past the session's last block. */
export const claimFrom = (held: HeldBlock | undefined, first: number): number => (held === undefined ? first : Math.max(first, held.block + 1))

/** How often a session deletes the claims no one needs any more. */
export const CLAIM_PRUNE_MS = 60 * 60 * 1000

/**
 * The claim entries that can go: the older generations of a block below `first` (the block
 * of the next free ID: no new claim starts there, and every ID of it is used or passed) whose newest
 * claim is stale at `now` (its holder gives no new ID from it, and every reservation it made has
 * ended). A live claim, a block at or above `first`, and a name that is no claim are kept.
 *
 * The newest generation of a block is never deleted. The delete goes by name, from a list
 * made before it: had the newest name gone, another session could make that name again as a live
 * claim (the first generation of a block with no entries) between the list and the delete, and the
 * delete would end the live claim. While the newest name stays, every new claim of the block takes a
 * higher generation, so a deleted name is never made again. The cost: one empty entry stays per
 * block ever claimed (8 IDs each).
 */
export function prunableClaims(entries: readonly { name: string; mtimeMs: number }[], first: number, now: number): string[] {
  const newest = new Map<number, { gen: number; mtimeMs: number }>()
  for (const entry of entries) {
    const claim = parseClaim(entry.name)
    const was = claim === undefined ? undefined : newest.get(claim.block)
    if (claim !== undefined && (was === undefined || claim.gen > was.gen)) {
      newest.set(claim.block, { gen: claim.gen, mtimeMs: entry.mtimeMs })
    }
  }

  return entries
    .filter(entry => {
      const claim = parseClaim(entry.name)
      const top = claim === undefined ? undefined : newest.get(claim.block)

      return claim !== undefined && top !== undefined && claim.gen < top.gen && claim.block < first && now - top.mtimeMs >= CLAIM_MS
    })
    .map(entry => entry.name)
}

/** The claim folder inside a git common dir: per repo, shared by every worktree, never committed. */
export const gitClaimDir = (common: string): string => `${common}/claudeopticon/id-claims`

/** The claim folder in a folder's `.claude_work/`, which the export leaves out. */
export const workClaimDir = (base: string): string => `${base}/.claude_work/claudeopticon-id-claims`

/**
 * Where a session claims ID blocks. `main`: in the git common dir (absolute, from
 * `git rev-parse --git-common-dir`, or read from the `.git` entry when git fails), in every git layout
 * (a `.git` folder, a `.git` file of a separate git dir or a submodule, a linked worktree, a bare repo's
 * worktree), so every session of the repo claims in one folder.
 *
 * `fallback`: claimed in only when the main folder cannot be made (a read-only `.git`), and listed by
 * every claim either way (`claimAcross`). That check is sound only when every session of the
 * repo names the same fallback, so it comes from the common dir alone, never from the session's own
 * checkout: only a common dir `<root>/.git` gives one, `<root>/.claude_work/`. A bare repo, a separate
 * git dir or a submodule has no folder every worktree shares but the common dir, so it gets no fallback:
 * a session that cannot write its common dir names no IDs there. The per-worktree fallback
 * this replaces gave each worktree its own folder, and two sessions held one block.
 *
 * With no git at all, the primary todo folder's parent (`looseBase`) keys the one folder, never the
 * nearest todo folder of a session in a subfolder.
 */
export function claimDirs(where: { common?: string; looseBase?: string }): { main?: string; fallback?: string } {
  if (where.common !== undefined) {
    const common = where.common.replace(/\/+$/, '')
    const root = common.endsWith('/.git') ? common.slice(0, -'/.git'.length) : undefined

    return { main: gitClaimDir(common), ...(root === undefined || root === '' ? {} : { fallback: workClaimDir(root) }) }
  }

  return where.looseBase === undefined ? {} : { main: workClaimDir(where.looseBase) }
}
