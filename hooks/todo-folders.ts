/** The discovery of the todo folders of the repo and the follow of the session folder. */

import type { EngineInterface } from 'claude-code'
import { isAbsPath, isSameFolder, isWinPath, relIn, resolveAgainst, samePath } from './path-forms'
import { DIR, diskSpelling, gitCommonDir, isGlobalTodo, isInsideRoots, isMisspelledTodo, MAX_FOLDERS, pickFolders, REV_PARSE, repoRoots, sessionFolder } from './repo-folders'
import type { TodoFolder } from './repo-folders'
import { TIMED_OUT } from './time-limit'
import { refreshCutIds } from './cut-ids'
import { FolderListError, listFolders, noteListFailed } from './folder-listing'
import { boundedJob, fsBounded, noteTimedOut, realOf, runInTime } from './fs-bounds'
import { atHome, findTodoDir, loadGlobals } from './global-folders'
import { sessionHome, sessionPlace } from './session-places'
import { S, givenIds, reservedIds } from './state'
import { showToast } from './toasts'

/**
 * The session folder as an absolute path: from git in a repo (the top plus `--show-prefix`), else the
 * real path of `.`. A relative nearest folder is made absolute against it, so the trust check, which
 * takes only absolute paths, can pass it.
 */
let sessionDir: string | undefined

/**
 * A relative nearest folder as an absolute path against the session folder, when that path is its own
 * real path (no symlink at the folder). Undefined when this cannot be told: the folder then stays
 * relative, and so untrusted. An absolute path (a worktree's main checkout folder) is returned as it is.
 */
export function absNearest(near: string, real: string | undefined): string | undefined {
  if (isAbsPath(near)) {
    return near
  }
  const path = sessionDir === undefined ? undefined : resolveAgainst(sessionDir, near)

  return path !== undefined && real !== undefined && samePath(real, path) ? path : undefined
}

/** Says once that HOME cannot be read, unless the session works on a Windows path, which the text rule covers with no home. */
function noteNoHome($: EngineInterface, where: string | undefined): void {
  if (!S.globalsKnown && !S.globalsToasted && !(where !== undefined && isWinPath(where))) {
    S.globalsToasted = true
    showToast($, 'Claudeopticon cannot read the HOME folder, so it cannot tell the global todo folder from a project one. It changes no todo file and the tidy buttons are off.')
  }
}

/** The folders already named in an "outside the repo" toast: one toast each, per load of the module. */
const outsideToasted = new Set<string>()

/** Says once per folder that a listed todo folder resolves outside the repo, so the mod does not read it. */
function noteOutsideRepo($: EngineInterface, path: string, real: string): void {
  if (!outsideToasted.has(path)) {
    outsideToasted.add(path)
    showToast($, `Claudeopticon skips ${path}: it is a link to ${real}, outside the repo, so its files are not read.`)
  }
}

/** True once a failed read of the repo layout was told; a layout that reads clears it, so the next failure is told again. */
let layoutFailToasted = false

/** Tells once that the repo layout could not be read, and what the board does instead: it shows the nearest todo folder only. */
function noteLayoutFailed($: EngineInterface, reason: string): void {
  if (!layoutFailToasted) {
    layoutFailToasted = true
    showToast($, `Claudeopticon could not read the repo layout (${reason}). The board shows the nearest todo folder only until you press Consolidate todos or reload the mod.`)
  }
}

/** The folders already named in a "spelled in another letter case" toast: one toast each, per load of the module. */
const misspelledToasted = new Set<string>()

/** Says once per folder that a todo folder is spelled `.claude_todo` in another letter case, so the mod leaves it alone. */
function noteMisspelled($: EngineInterface, path: string): void {
  if (!misspelledToasted.has(path)) {
    misspelledToasted.add(path)
    showToast($, `Claudeopticon skips ${path}: the folder name must be ${DIR} in lowercase. Rename it to ${DIR} to have it read and numbered.`)
  }
}

/**
 * Finds every `.claude_todo/` folder of the repo (and of the main checkout, from a worktree) with
 * git. Outside a repo, or when git fails, only the nearest one by the old rule counts, by its
 * absolute path so it can be written. A path git lists but the disk no longer has (a
 * tracked file deleted) is dropped.
 */
async function discoverFolders($: EngineInterface, previous?: TodoFolder[]): Promise<TodoFolder[]> {
  await loadGlobals($)
  const nearest = await findTodoDir($).catch(() => undefined)
  const home = await sessionHome($)
  // The session folder: `.`, or the project root when a shell `cd` took `.` out of it.
  const place = home ?? (await realOf($, '.'))
  searchedIn = await sessionPlace($)
  const nearestReal = nearest === undefined ? undefined : await realOf($, atHome(home)(nearest))
  if (nearestReal !== undefined && isMisspelledTodo(nearestReal)) {
    // A disk that ignores case answers `.claude_todo` for `.Claude_todo`: the folder stays untrusted, so say why once.
    noteMisspelled($, nearestReal)
  }
  const alone = async (): Promise<TodoFolder[]> => {
    sessionDir = place
    S.looseRoot = sessionDir
    S.gitCommon = undefined
    // A search that finds no repo this time leaves no root of an earlier one trusted (a rediscover after a failed rev-parse).
    S.repoRoot = undefined
    S.centralRoot = undefined
    S.centralBlocked = false
    noteNoHome($, sessionDir)
    if (nearest === undefined) {
      return []
    }

    return [{ path: absNearest(nearest, nearestReal) ?? nearest, rel: nearest, isOther: false, ...(nearestReal === undefined ? {} : { real: nearestReal }) }]
  }
  try {
    // Bounded: a rev-parse that hangs is a failure, as one that fails is; one toast names it.
    // Git runs in the project root, not in `.`, which a shell `cd` moves.
    const inHome = home === undefined ? undefined : { cwd: home }
    const ran = await runInTime($, REV_PARSE, inHome)
    if (ran === TIMED_OUT) {
      noteTimedOut($, REV_PARSE)
    }
    const top = ran === TIMED_OUT || ran === undefined ? { exitCode: 1, stdout: '', stderr: '' } : ran
    // Exit 128 is git's answer outside a repo: normal. Any other failure to ask is told; a time-out already was.
    if (ran === undefined) {
      noteLayoutFailed($, 'git did not start')
    } else if (ran !== TIMED_OUT && top.exitCode !== 0 && top.exitCode !== 128) {
      noteLayoutFailed($, `git rev-parse exited ${top.exitCode}`)
    }
    let roots = top.exitCode === 0 ? repoRoots(top.stdout) : undefined
    if (roots !== undefined && (roots.isLinked === true || roots.main !== undefined)) {
      // The main checkout is the first entry of the worktree list, whatever the shape of the git dir; the common dir is the fallback only when the list fails.
      const listArgv = ['git', 'worktree', 'list', '--porcelain']
      const ranList = await runInTime($, listArgv, inHome)
      if (ranList === TIMED_OUT) {
        noteTimedOut($, listArgv)
      }
      const list = ranList === TIMED_OUT ? undefined : ranList
      roots = repoRoots(top.stdout, list?.exitCode === 0 ? list.stdout : '')
    }
    if (roots === undefined) {
      return await alone()
    }
    // Git must name the folder the session is in: GIT_DIR and GIT_WORK_TREE in the environment
    // (vcsh) or a core.worktree set elsewhere give well-formed output for another folder, whose todo and
    // `.git` this session must never write. Such a session takes the outside-a-repo path.
    if (!isSameFolder(sessionFolder(top.stdout), place)) {
      return await alone()
    }
    S.repoRoot = roots.root
    layoutFailToasted = false
    // The two worktree rules, both decided here. 1: a linked worktree whose main checkout git
    // names writes the main checkout's todo only; its own `.claude_todo/` is read but never written, as
    // it is outside `centralRoot`. 2: a worktree whose main checkout git cannot name (a separate git dir,
    // which `git worktree list` gives as the main entry) has none to defer to, so its own folder is the
    // central one; `isLinked` keeps Consolidate and Delete off there (`centralBlocked` below).
    S.centralRoot = roots.main ?? roots.root
    S.gitCommon = gitCommonDir(top.stdout)
    sessionDir = sessionFolder(top.stdout)
    S.looseRoot = undefined
    noteNoHome($, S.centralRoot)
    // Consolidate and Delete are off in a linked worktree (even one whose main checkout git did not name), when the main folder is the global one, and when HOME is unknown.
    const centralPath = `${S.centralRoot}/${DIR}`
    S.centralBlocked = roots.main !== undefined || roots.isLinked === true || !(S.globalsKnown || isWinPath(S.centralRoot)) || isGlobalTodo(centralPath) || isGlobalTodo((await realOf($, centralPath)) ?? centralPath)
    let listed: { path: string; rel: string }[]
    try {
      listed = [...(await listFolders($, roots.root)), ...(roots.main === undefined ? [] : await listFolders($, roots.main))]
      S.listFailToasted = false
    } catch (error) {
      if (!(error instanceof FolderListError)) {
        throw error
      }
      // A failed list is no list: a search after startup keeps the folders it had, so a folder that
      // stayed never leaves the board and its IDs still count. At startup there are none: the nearest one only.
      noteListFailed($, error, previous !== undefined)
      if (previous !== undefined) {
        return previous
      }
      listed = []
    }
    const found: { path: string; rel: string; real?: string }[] = []
    const globals = new Set<string>()
    let primary: string | undefined
    // The real paths of the checkouts git listed in: a folder that resolves outside them is a tracked symlink out of the repo.
    const realRoots = await Promise.all((roots.main === undefined ? [roots.root] : [roots.root, roots.main]).map(root => realOf($, root)))
    // Judged only when every root resolved: a root that did not leaves no basis to call a folder outside.
    const knownRoots = realRoots.every(one => one !== undefined) ? (realRoots as string[]) : []
    for (const listedOne of listed) {
      if (!(await fsBounded($, () => $.fs.exists(listedOne.path)).catch(() => false))) {
        continue
      }
      const real = await realOf($, listedOne.path)
      if (real !== undefined && knownRoots.length > 0 && !isGlobalTodo(real) && !isInsideRoots(real, knownRoots)) {
        noteOutsideRepo($, listedOne.path, real)
        continue
      }
      // Git's index spelling after a case-only rename (`Docs/` for `docs/`) is read in the disk's spelling, so the trust check, which compares by exact case, passes it.
      const one = diskSpelling(listedOne, real, roots.main === undefined ? [roots.root] : [roots.root, roots.main])
      // A folder spelled `.Claude_todo` on the disk is no todo folder: left out, and named once.
      if (isMisspelledTodo(one.path)) {
        noteMisspelled($, one.path)
        continue
      }
      found.push(real === undefined ? one : { ...one, real })
      if (isGlobalTodo(real ?? one.path)) {
        globals.add(one.path)
      }
      if (real !== undefined && real === nearestReal && primary === undefined) {
        primary = one.path
      }
    }
    if (nearest === undefined && primary === undefined && roots.main !== undefined) {
      // A linked worktree whose `.git` file the text rule could not read (a separate git dir): its main checkout's folder is the primary one.
      primary = found.find(one => one.path === `${roots.main}/${DIR}`)?.path
    }
    if (nearest !== undefined && primary === undefined) {
      // The nearest folder git did not list: keep it, named by its place in the repo when that shows, by its absolute path so it can be trusted.
      const path = absNearest(nearest, nearestReal) ?? nearest
      found.unshift({ path, rel: relIn(nearestReal, roots.root) ?? nearest, ...(nearestReal === undefined ? {} : { real: nearestReal }) })
      primary = path
    }

    const all = pickFolders(found, primary, globals, Infinity)
    S.cutFolders = all.slice(MAX_FOLDERS).map(one => one.path)
    await refreshCutIds($).catch(() => undefined)
    if (S.cutFolders.length > 0 && !S.cutToasted) {
      S.cutToasted = true
      showToast($, `This repo has ${all.length} todo folders. The pane shows ${MAX_FOLDERS}; the other ${S.cutFolders.length} are not shown, but their ticket IDs still count.`)
    }

    return all.slice(0, MAX_FOLDERS)
  } catch (error) {
    // Not a repo is a normal answer (exit 128 above); a throw is a failure to read the layout, told once.
    noteLayoutFailed($, error instanceof Error ? error.message : String(error))

    return alone()
  }
}

let folderSearch: Promise<TodoFolder[]> | undefined

/** Counts the folder searches after startup (`rediscoverFolders`): a late answer of an older one is dropped. */
let folderSearchRound = 0

/**
 * The folder search after a Consolidate press. The folders the board has stay until
 * the search ends: a scan meanwhile uses them and never waits on git. The search is bounded; on a time-out
 * the old folders stay, and a late answer is taken only while no newer search started. A failed list keeps
 * the old folders (`discoverFolders`).
 */
export async function rediscoverFolders($: EngineInterface): Promise<void> {
  const previous = S.todoFolders
  folderSearch = undefined
  S.nearestSeen = undefined
  folderSearchRound += 1
  const round = folderSearchRound
  const search = discoverFolders($, previous).then(found => {
    if (round === folderSearchRound) {
      S.todoFolders = found
    }
  })
  await boundedJob($, search.catch(() => undefined))
}

/** The real path of the session's project root when the last folder search started: a scan or prompt that finds another one searches again. A shell `cd` does not count (). */
let searchedIn: string | undefined

/**
 * Follows the session to another folder. The desktop app can start a session in one folder
 * (a spare inside one repo) and move it to another repo: the folders, roots and ID state of the first
 * repo then do not apply. When the session's project root (`sessionPlace`) is not the one the last
 * search started in, the search runs again from nothing (no earlier folders kept) and the ID state of
 * the old repo is dropped, so its block, reservations and IDs never count in the new one. A shell `cd`
 * moves `.` but not the root, so it moves nothing here. True when the folder moved.
 */
export async function followSessionFolder($: EngineInterface): Promise<boolean> {
  if (S.todoFolders === undefined || searchedIn === undefined) {
    return false
  }
  const here = await sessionPlace($)
  if (here === undefined || samePath(here, searchedIn)) {
    return false
  }
  S.todoFolders = undefined
  folderSearch = undefined
  S.nearestSeen = undefined
  // A rediscover still in flight for the old folder must not put its answer over the new one.
  folderSearchRound += 1
  S.cutFolders = []
  S.cutIds = []
  S.cutIdsByFile = new Map()
  S.cutUnknown = new Set()
  S.idBlock = undefined
  givenIds.clear()
  reservedIds.clear()
  await ensureFolders($)

  return true
}

export function ensureFolders($: EngineInterface): Promise<TodoFolder[]> {
  if (S.todoFolders !== undefined) {
    return Promise.resolve(S.todoFolders)
  }
  folderSearch ??= discoverFolders($).then(async found => {
    S.todoFolders = found

    return found
  })

  return folderSearch
}
