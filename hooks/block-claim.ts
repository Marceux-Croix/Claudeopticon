/**
 * The claim of one ID block across the repo's two claim folders (UCR-136), over a small file port, so
 * the engine and a race script of real processes run the same steps.
 *
 * Why two folders: a session claims in the git common dir, and in the repo's `.claude_work/` folder
 * only when the git folder cannot be made (UCR-118). Sessions of one repo can so claim in different
 * folders (one `mkdir -p` that failed once, a read-only `.git`, a session whose git call fails). A
 * claim is atomic inside one folder only, so a session lists both folders before it claims, and after
 * its own claim is made it lists the other folder again: when that folder now holds a claim on the
 * same block (a new name, or a live one), the session gives the block up (deletes its own claim) and
 * tries the next. Of two sessions that claim one block in two folders, each makes its claim before it
 * looks at the other folder, so at least one of them sees the other's claim: never both keep it. Both
 * may give it up; the block is then a gap in the numbers, never a duplicate.
 */

import { BLOCK_SIZE, blockOf, CLAIM_MS, CLAIM_SCAN, nextClaim, parseClaim } from './id-blocks'
import { VALUE_END } from './ticket-ids'

/** The first block past the end of the number line (UCR-197): it holds no ID value, so it is never claimed. */
export const END_BLOCK = blockOf(VALUE_END - 1) + 1

/** One entry of a claim folder: its name and when it was made (ms). */
export type ClaimEntry = { name: string; mtimeMs: number }

/** The file calls a claim makes. */
export type ClaimPort = {
  /** The folder's entries; undefined when it will not list. */
  list: (dir: string) => Promise<ClaimEntry[] | undefined>
  /** True when something stands at the path; a check that fails must say true. */
  exists: (path: string) => Promise<boolean>
  /** Makes the entry only if nothing stands at its name, atomically. */
  make: (path: string) => Promise<'made' | 'taken' | 'failed'>
  /** Deletes an entry this session made; true when it is gone. */
  remove: (path: string) => Promise<boolean>
}

/** A claim made: the block, and the path of its entry (to delete it when its IDs go unused). */
export type MadeClaim = { block: number; path: string }

/**
 * The entries of the other claim folder: none when there is no other folder or nothing stands at it
 * (no session made a claim there: its `mkdir -p` comes before its claim), undefined when it is there
 * and will not list (then no claim can be told safe).
 */
export async function otherEntries(port: ClaimPort, other: string | undefined): Promise<ClaimEntry[] | undefined> {
  if (other === undefined) {
    return []
  }
  const listed = await port.list(other)
  if (listed !== undefined) {
    return listed
  }

  return (await port.exists(other)) ? undefined : []
}

/**
 * True when the other folder (`now`) holds a claim on `block` this session must give way to: one whose
 * name the list before the claim (`before`) did not have, or one that is live at `time`.
 */
export function mustYield(now: readonly ClaimEntry[], before: readonly ClaimEntry[], block: number, time: number): boolean {
  const was = new Set(before.map(entry => entry.name))

  return now.some(entry => {
    const claim = parseClaim(entry.name)

    return claim !== undefined && claim.block === block && (!was.has(entry.name) || time - entry.mtimeMs < CLAIM_MS)
  })
}

/**
 * Claims the first block from `from` up that no live claim holds in either folder (`nextClaim` over
 * both lists): in `dir`, with `own` its entries (listed, pruned), and `other` the repo's other claim
 * folder. A block another session claimed first in `dir` is passed over; one the other folder shows
 * after the claim is given up (the claim deleted) and passed over. The scan stops at the end of the
 * number line (END_BLOCK, UCR-197): a block past it gives no ID, and claiming it made 64 entries per
 * pick for nothing. The claim made, or the reason as text when the other folder will not list, a claim
 * fails, every block scanned is held, or no block is left on the number line.
 */
export async function claimAcross(port: ClaimPort, dir: string, other: string | undefined, own: readonly ClaimEntry[], from: number, time: number): Promise<MadeClaim | string> {
  if (from >= END_BLOCK) {
    return 'the number line of ticket IDs is used up'
  }
  const before = await otherEntries(port, other)
  if (before === undefined) {
    return `could not list ${other!}`
  }
  const entries = [...own, ...before]
  for (let block = from; block < Math.min(from + CLAIM_SCAN, END_BLOCK); block += 1) {
    const name = nextClaim(entries, block, time)
    if (name === undefined) {
      continue
    }
    const path = `${dir}/${name}`
    const got = await port.make(path)
    if (got === 'taken') {
      continue
    }
    if (got === 'failed') {
      return `could not make ${path}`
    }
    const after = await otherEntries(port, other)
    if (after !== undefined && !mustYield(after, before, block, time)) {
      return { block, path }
    }
    // Given up: the other folder holds the block too, or cannot be told. A delete that fails leaves an unused block.
    await port.remove(path)
    if (after === undefined) {
      return `could not list ${other!}`
    }
    entries.push(...after)
  }

  return `every block from ${from * BLOCK_SIZE} on is claimed`
}
