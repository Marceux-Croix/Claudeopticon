/** The ID block claims: folders in git that keep two sessions off one ID. */

import type { EngineInterface } from 'claude-code'
import { clock } from './card-format'
import { NEXT_IDS_SHOWN, nextIdsLine } from './claude-notes'
import { blockIds, blockOf, CLAIM_PRUNE_MS, CLAIM_SCAN, claimDirs, claimFrom, firstBlock, needsBlock, prunableClaims } from './id-blocks'
import type { HeldBlock } from './id-blocks'
import { claimAcross, END_BLOCK } from './block-claim'
import type { ClaimPort } from './block-claim'
import { gitWhereUp } from './git-file'
import type { GitFs } from './git-file'
import { lineHolding } from './numbering'
import { todoKind } from './todo-file-names'
import { isAbsPath, isWinPath, psPath } from './path-forms'
import { highestId, RESERVE_MS, ticketValue } from './ticket-ids'
import { TIMED_OUT } from './time-limit'
import { diskIds } from './disk-ids'
import { commandName, fsBounded, noteTimedOut, runInTime } from './fs-bounds'
import { pruneReserved, sessionOf, syncReserved } from './id-reservations'
import { nowSync } from './pane-clock'
import { S, givenIds, reservedIds, seenIdsOf, timedOutTold } from './state'
import { showToast } from './toasts'
import { projectIds, readTodo } from './todo-io'

/** One entry of a folder list, as the engine gives it. */
type ListEntry = Awaited<ReturnType<EngineInterface['fs']['list']>>[number]

/** True once a toast said that no block could be claimed: once per load. */
let claimToasted = false

/** True once a toast said that the claims went to the fallback folder: once per load. */
let fallbackToasted = false

/** When this session last deleted the claims no one needs, clock ms; undefined before the first time. */
let claimsPrunedAt: number | undefined

/** The `.git` walk's file calls (`gitWhereUp`), through the engine. A call that fails gives undefined. */
function gitFs($: EngineInterface): GitFs {
  return {
    exists: path => fsBounded($, () => $.fs.exists(path)).catch(() => undefined),
    kind: path => fsBounded($, () => $.fs.stat(path)).then(stat => stat.kind as string, () => undefined),
    read: path => $.fs.read(path).catch(() => undefined),
  }
}

/**
 * The repo's claim folders (`claimDirs`): `main` in the git common dir in every git layout,
 * `fallback` only for a common dir `<root>/.git`, in that root's `.claude_work/`. Both come from the
 * common dir alone, so every session of the repo, in any worktree, names the same two. A
 * session with no common dir from git (its git call failed) reads it from the `.git` entry on the disk,
 * walking up from the primary todo folder's parent, so it claims where the git sessions do; with no
 * `.git` at all, that parent keys the one folder. Worked out from the session state each time, never
 * kept from a check that failed.
 */
async function claimFolders($: EngineInterface): Promise<{ main?: string; fallback?: string }> {
  const primary = S.todoFolders?.find(one => !one.isOther)
  const base = primary?.real ?? primary?.path
  const looseBase = base !== undefined && isAbsPath(base) ? base.slice(0, base.lastIndexOf('/')) : undefined
  const common = S.gitCommon !== undefined && isAbsPath(S.gitCommon) ? S.gitCommon : undefined
  if (common !== undefined) {
    return claimDirs({ common })
  }
  const from = looseBase ?? S.centralRoot
  const found = from === undefined ? undefined : await gitWhereUp(gitFs($), from)
  if (found === 'unknown') {
    return {}
  }

  return claimDirs(found !== undefined ? { common: found.common } : looseBase === undefined ? {} : { looseBase })
}

/**
 * Runs a program (no shell); where it cannot start on a Windows path (no MSYS or Git for Windows
 * tools), the PowerShell statement instead, as `envPath` falls back from `printenv`. Undefined when
 * neither starts.
 */
async function runOrPowerShell($: EngineInterface, argv: string[], path: string, script: string): Promise<{ exitCode: number } | undefined | typeof TIMED_OUT> {
  // Bounded: this runs under the writer lock, while numbering or a prompt claims IDs. A time-out is a
  // failure, told once; the command may still finish later, so PowerShell is not tried after it.
  const bounded = async (one: string[]) => {
    const done = await runInTime($, one)
    if (done === TIMED_OUT) {
      noteTimedOut($, one)
    } else if (done !== undefined) {
      timedOutTold.delete(commandName(one))
    }

    return done
  }
  const done = await bounded(argv)
  if (done !== undefined || !isWinPath(path)) {
    return done
  }

  return bounded(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script])
}

/** Makes a claim folder and its parents (`mkdir -p`); true when it is there. */
async function makeClaimDir($: EngineInterface, dir: string): Promise<boolean> {
  const made = await runOrPowerShell($, ['mkdir', '-p', '--', dir], dir, `try { [System.IO.Directory]::CreateDirectory(${psPath(dir)}) | Out-Null; exit 0 } catch { exit 1 }`)

  return made !== TIMED_OUT && made?.exitCode === 0
}

/**
 * Makes a claim entry only if nothing stands at its name, in one atomic step of the OS: `mkdir` with
 * no `-p` (no shell); on Windows with no `mkdir` program, a file opened CreateNew through PowerShell,
 * just as atomic. `made`; `taken` when another session made it first; `failed` when it cannot be told.
 */
async function makeClaim($: EngineInterface, path: string): Promise<'made' | 'taken' | 'failed'> {
  const done = await runOrPowerShell($, ['mkdir', '--', path], path, `try { [System.IO.File]::Open(${psPath(path)}, 'CreateNew').Close(); exit 0 } catch { exit 1 }`)
  // A time-out is a failure: the entry may still appear later, so it is never read as another session's.
  if (done === TIMED_OUT) {
    return 'failed'
  }
  if (done?.exitCode === 0) {
    return 'made'
  }

  return (await fsBounded($, () => $.fs.exists(path)).catch(() => false)) ? 'taken' : 'failed'
}

/**
 * Deletes the claim entries of `dir` no one needs any more (`prunableClaims`: stale, below the first
 * free block), at most once per CLAIM_PRUNE_MS, so the folder does not grow with every
 * block. `rmdir` (an empty folder only), else a .NET delete on Windows. A delete that fails is left
 * for the next time. The entries left, for the claim that follows.
 */
async function pruneClaims($: EngineInterface, dir: string, entries: readonly ListEntry[], first: number, time: number): Promise<ListEntry[]> {
  if (claimsPrunedAt !== undefined && time - claimsPrunedAt < CLAIM_PRUNE_MS) {
    return [...entries]
  }
  claimsPrunedAt = time
  const gone = new Set<string>()
  for (const name of prunableClaims(entries, first, time)) {
    if (await removeClaim($, `${dir}/${name}`)) {
      gone.add(name)
    }
  }

  return entries.filter(entry => !gone.has(entry.name))
}

/** Deletes one claim entry: `rmdir` (an empty folder only), else a .NET delete on Windows. True when it went. */
async function removeClaim($: EngineInterface, path: string): Promise<boolean> {
  const done = await runOrPowerShell($, ['rmdir', '--', path], path, `try { $p = ${psPath(path)}; if ([System.IO.Directory]::Exists($p)) { [System.IO.Directory]::Delete($p) } else { [System.IO.File]::Delete($p) }; exit 0 } catch { exit 1 }`)

  return done !== TIMED_OUT && done?.exitCode === 0
}

/** The file calls of a block claim (`claimAcross`), through the engine. A presence check that fails counts as there. */
function claimPort($: EngineInterface): ClaimPort {
  return {
    list: dir => fsBounded($, () => $.fs.list(dir)).then(
      entries => entries.map(entry => ({ name: entry.name, mtimeMs: entry.mtimeMs })),
      () => undefined,
    ),
    exists: path => fsBounded($, () => $.fs.exists(path)).catch(() => true),
    make: path => makeClaim($, path),
    remove: path => removeClaim($, path),
  }
}

/** A block this session claimed: the block it holds, and the path of its claim entry. */
type Claimed = { held: HeldBlock; path: string }

/**
 * Claims the first block from `from` up that no live claim holds in either claim folder of the repo
 * (`claimAcross`): the claim folder is made first (`mkdir -p`, the one step that may find it
 * there), then the block's entry, atomically; then the other folder is listed again, and the block is
 * given up when it shows a claim there too. When the git claim folder cannot be made (a read-only
 * `.git`), the claim goes to the fallback folder, with one toast; either way the claims of
 * the other folder count as held. The reason, as text, when no folder can be made, a list or a claim
 * fails, or every block scanned is held: then no ID is given. `first`: the first free block, for the pruning.
 */
async function claimBlock($: EngineInterface, from: number, first: number): Promise<Claimed | string> {
  const dirs = await claimFolders($)
  if (dirs.main === undefined) {
    return 'no folder to claim IDs in'
  }
  let dir = dirs.main
  let other = dirs.fallback
  if (!(await makeClaimDir($, dir))) {
    if (dirs.fallback === undefined || !(await makeClaimDir($, dirs.fallback))) {
      return `could not make ${dir}`
    }
    if (!fallbackToasted) {
      fallbackToasted = true
      showToast($, `Claudeopticon cannot write ${dir}, so it claims new ticket IDs in ${dirs.fallback} instead.`)
    }
    other = dir
    dir = dirs.fallback
  }
  const listed = await fsBounded($, () => $.fs.list(dir)).catch(() => undefined)
  if (listed === undefined) {
    return `could not list ${dir}`
  }
  const time = await $.clock.now()
  const own = await pruneClaims($, dir, listed, first, time)
  const made = await claimAcross(claimPort($), dir, other, own, from, time)

  return typeof made === 'string' ? made : { held: { block: made.block, claimedAt: time }, path: made.path }
}

/** True once a toast said that a pick found fewer free IDs than it needed: once per load. */
let shortToasted = false

/**
 * `count` free ticket IDs, above every ID of `taken` in this session's block, from this session's
 * claimed block: the one source of new IDs for the prompt offers, numbering and Consolidate's
 * renumbering. A new block is claimed when the session has none, when its
 * block ran out, or CLAIM_USE_MS after its claim (`needsBlock`); never only because another session's
 * IDs passed it, so two sessions taking turns leave no gap per pick. No store round trip:
 * the claim alone keeps another session off these IDs. Each pick and its record in `givenIds` come
 * with no await between, so two picks of this session never give one ID. Undefined when no block can
 * be claimed, or CLAIM_SCAN blocks give fewer than `count`: then no ID is given, and a toast says so
 * once. A pick that comes back short is undone: its IDs go back, the session holds the
 * block it held before, and each claim it made is deleted unless an ID of this session (another pick
 * that ran meanwhile) is from that block, so a failed pick wastes no block.
 */
export async function freeIds($: EngineInterface, taken: readonly string[], count: number): Promise<string[] | undefined> {
  const out: string[] = []
  const heldBefore = S.idBlock
  const made: Claimed[] = []
  let failure: string | undefined
  let isSpent = false
  let isFull = false
  for (let round = 0; round < CLAIM_SCAN && out.length < count; round += 1) {
    const first = firstBlock([...taken, ...givenIds])
    if (needsBlock(S.idBlock, isSpent, nowSync())) {
      // The number line is used up: no block is claimed, not one claim folder is touched.
      if (claimFrom(S.idBlock, first) >= END_BLOCK) {
        isFull = true
        break
      }
      const claimed = await claimBlock($, claimFrom(S.idBlock, first), first)
      if (typeof claimed === 'string') {
        failure = claimed
        break
      }
      S.idBlock = claimed.held
      made.push(claimed)
    }
    // From here to the record, no await: the pick sees every ID this session gave.
    const got = blockIds([...taken, ...givenIds], S.idBlock!.block, count - out.length).map(id => id.toLowerCase())
    got.forEach(id => givenIds.add(id))
    out.push(...got)
    isSpent = out.length < count
  }
  if (out.length === count) {
    return out.map(id => id.toUpperCase())
  }
  // Undone. From here to the restore, no await: another pick of this session sees it whole.
  out.forEach(id => givenIds.delete(id))
  if (made.length > 0 && S.idBlock === made[made.length - 1]!.held) {
    S.idBlock = heldBefore
  }
  const inUse = new Set([...givenIds].flatMap(id => (ticketValue(id) === undefined ? [] : [blockOf(ticketValue(id)!)])))
  for (const one of made) {
    if (!inUse.has(one.held.block) && one.held !== S.idBlock) {
      await removeClaim($, one.path)
    }
  }
  if (isFull) {
    await noteLineFull($, [...taken, ...givenIds])
  } else if (failure !== undefined) {
    if (!claimToasted) {
      claimToasted = true
      showToast($, `Claudeopticon names no new ticket IDs: ${failure}.`)
    }
  } else if (!shortToasted) {
    shortToasted = true
    showToast($, `Claudeopticon found only ${out.length} of the ${count} free ticket IDs it needs in ${CLAIM_SCAN} blocks, so it names none of them now.`)
  }

  return undefined
}

/** True once a toast said that the number line of ticket IDs is used up: once per load. */
let fullToasted = false

/**
 * Says once that no ticket ID is left on the number line, naming the ID at its end and the
 * line that holds it, so the user can find the stray tag (often in an example) and change it.
 * The line is looked up in the files the last ID read saw (`seenIdsOf`); a read that fails leaves the ID alone named.
 */
async function noteLineFull($: EngineInterface, ids: readonly string[]): Promise<void> {
  if (fullToasted) {
    return
  }
  fullToasted = true
  const top = highestId(ids)?.toLowerCase()
  const path = top === undefined ? undefined : [...seenIdsOf].find(([, held]) => held.has(top))?.[0]
  const read = path === undefined ? undefined : await readTodo($, path).catch(() => undefined)
  const line = top === undefined || read?.kind !== 'ok' ? undefined : lineHolding(read.text, top, todoKind(path ?? ''))
  const where = path === undefined ? '' : ` in ${path}${line === undefined ? '' : `, the line "${line}"`}`
  showToast($, `Claudeopticon names no new ticket IDs: the number line of ticket IDs is used up by #${top?.toUpperCase() ?? '?'}${where}. IDs count up to #T1ZZZZ; change or remove that ID to free the line.`)
}

/** Picks per offer: a pick that loses an ID to another session's store write picks again. */
const OFFER_ROUNDS = 3

/**
 * The "Next free ticket IDs" line for a prompt; undefined when a todo file or folder cannot be read,
 * since an ID in it could be named again (numbering gives such items IDs later instead). The IDs are
 * free on the disk as it is now, not only on the board, which may be behind it: a Bash or hand edit,
 * or a scan still in flight, whose text is on the disk already, so the scan is not awaited.
 * The board, the disk and every reservation of the repo count as taken. The IDs this session named
 * before and no file holds yet are named again, so the numbers do not climb with each prompt; only
 * the shortfall to NEXT_IDS_SHOWN is new. Each new ID is stored with the repo's reservations; one that
 * another session's write took is given up and another is picked.
 */
export async function offerIds($: EngineInterface): Promise<string | undefined> {
  const me = await sessionOf($)
  S.wallMs = await $.clock.now()
  const onDisk = await diskIds($).catch(() => undefined)
  if (onDisk === undefined) {
    return undefined
  }
  // The IDs other sessions of this repo reserved count as taken; a store that does not read names no ID.
  if ((await syncReserved($, [], onDisk)) === undefined) {
    return undefined
  }
  let shown: string[] = []
  for (let round = 0; round < OFFER_ROUNDS; round += 1) {
    pruneReserved(nowSync(), onDisk)
    const kept = [...reservedIds].filter(([, one]) => one.offeredTo === me).map(([id]) => id).sort((a, b) => (ticketValue(a) ?? 0) - (ticketValue(b) ?? 0))
    // The new IDs come from this session's claimed block, as numbering's do: no block, no offer.
    const picked = await freeIds($, [...projectIds(), ...onDisk, ...reservedIds.keys()], Math.max(0, NEXT_IDS_SHOWN - kept.length))
    if (picked === undefined) {
      return undefined
    }
    const fresh = picked.map(id => id.toLowerCase())
    for (const id of fresh) {
      reservedIds.set(id, { until: nowSync() + RESERVE_MS, offeredTo: me, by: me })
    }
    shown = [...kept, ...fresh].slice(0, NEXT_IDS_SHOWN)
    if (fresh.length === 0) {
      break
    }
    const lost = await syncReserved($, [], onDisk)
    // A read-back that fails sends no offer: the IDs are not known to be stored.
    if (lost === undefined) {
      return undefined
    }
    if (!shown.some(id => lost.includes(id))) {
      break
    }
    // Another session holds some of them now: they are its, and never named here.
    shown = shown.filter(id => !lost.includes(id))
  }

  return nextIdsLine(shown)
}
