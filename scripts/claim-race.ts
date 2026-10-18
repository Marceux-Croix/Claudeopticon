/**
 * The cross-folder claim race (UCR-136), with real processes, real `mkdir`, real `rmdir` and real mtimes. The
 * plugin test harness cannot start processes, so this runs with plain node, from the mod folder:
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/claim-race.ts [rounds] [--old]
 *     node --import ./scripts/ts-resolve.mjs scripts/claim-race.ts --layouts [rounds] [--no-fallback]
 *
 * Two folders: WORKERS node processes, half claiming in a stand-in for the git claim folder and half in one for the
 * `.claude_work` fallback, each makes its share of `rounds` claims with `claimAcross` (the engine's own steps), all
 * starting at one moment and each starting its scan at the lowest block neither folder holds, so they fight for the
 * same blocks. `--old` runs the steps before UCR-136 (each process looks at its own folder only), to show that the
 * check finds the defect.
 *
 * `--layouts`: real git repos of every layout whose claim folders differ (a `.git` folder with a linked worktree,
 * a bare repo with two worktrees, a separate git dir with a linked worktree), and two whose path holds a folder
 * named `worktrees` that is no linked worktree (UCR-202: a separate git dir under `store/worktrees/proj.git`, and a
 * nested submodule in a submodule named `worktrees`). In each, sessions in every checkout
 * work out their claim folders as the engine does (`git rev-parse`, the session-folder check, else the `.git` walk
 * with git failing), some with git failing (`GIT_DIR` set to a missing folder) and some whose `mkdir -p` of the git
 * claim folder fails half the time, over stale claims left in both folders. It checks that every session of a repo
 * names the same claim folders (UCR-136: the fallback comes from the common dir alone) and that no block has two
 * holders, `rounds` claims per layout (default 1000). A layout with a fallback folder (a `.git` folder) must
 * keep claims in both its folders (UCR-206: a race in which no session claims in the fallback checks nothing of
 * it). `--no-fallback` runs workers that never claim in the fallback, to show that the check finds that.
 *
 * Both modes check that every claim a process kept is still on the disk, and exit 1 when one is not or a block has
 * two holders, or when a mode, a layout, a folder (two-folder mode) or a session kept no claim at all (UCR-206: a
 * race that claims nothing checks nothing).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claimAcross } from '../hooks/block-claim.ts'
import type { ClaimEntry, ClaimPort } from '../hooks/block-claim.ts'
import { gitWhereUp } from '../hooks/git-file.ts'
import type { GitFs } from '../hooks/git-file.ts'
import { CLAIM_MS, claimDirs, parseClaim, prunableClaims } from '../hooks/id-blocks.ts'
import { isSameFolder } from '../hooks/path-forms.ts'
import { gitCommonDir, REV_PARSE, repoRoots, sessionFolder } from '../hooks/repo-folders.ts'

const WORKERS = 10

/** The claim calls on the real file system. */
const realPort: ClaimPort = {
  list: async dir => {
    try {
      return readdirSync(dir).map((name): ClaimEntry => ({ name, mtimeMs: statSync(`${dir}/${name}`).mtimeMs }))
    } catch {
      return undefined
    }
  },
  exists: async path => existsSync(path),
  make: async path => {
    try {
      mkdirSync(path)

      return 'made'
    } catch (error) {
      return (error as { code?: string }).code === 'EEXIST' ? 'taken' : 'failed'
    }
  },
  remove: async path => {
    try {
      rmdirSync(path)

      return true
    } catch {
      return false
    }
  },
}

/** The `.git` walk's calls on the real file system. */
const realGitFs: GitFs = {
  exists: async path => existsSync(path),
  kind: async path => {
    try {
      return statSync(path).isDirectory() ? 'dir' : 'file'
    } catch {
      return undefined
    }
  },
  read: async path => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
}

/** The live claims of a folder (younger than CLAIM_MS), as blocks; none for a folder that is missing or undefined. */
function liveBlocks(dir: string | undefined): number[] {
  if (dir === undefined || !existsSync(dir)) {
    return []
  }

  return readdirSync(dir).flatMap(name => {
    const claim = parseClaim(name)
    // An entry given up between the list and the stat is gone: no claim.
    const mtimeMs = claim === undefined ? undefined : (() => {
      try {
        return statSync(`${dir}/${name}`).mtimeMs
      } catch {
        return undefined
      }
    })()

    return claim !== undefined && mtimeMs !== undefined && Date.now() - mtimeMs < CLAIM_MS ? [claim.block] : []
  })
}

/** The lowest block that no folder of `dirs` holds a live claim on. */
function lowestFree(dirs: (string | undefined)[]): number {
  const held = new Set(dirs.flatMap(liveBlocks))
  let block = 0
  while (held.has(block)) {
    block += 1
  }

  return block
}

// ---------------------------------------------------------------- two folders

async function worker(dir: string, other: string, out: string, go: string, claims: number, me: string, isOld: boolean): Promise<void> {
  while (!existsSync(go)) {
    await new Promise(done => setTimeout(done, 1))
  }
  let kept = 0
  for (let tries = 0; kept < claims && tries < claims * 20; tries += 1) {
    const now = Date.now()
    const listed = (await realPort.list(dir)) ?? []
    const got = await claimAcross(realPort, dir, isOld ? undefined : other, listed, lowestFree([dir, other]), now)
    if (typeof got !== 'string') {
      appendFileSync(out, `${me} ${got.block} ${got.path}\n`)
      kept += 1
    }
  }
}

/**
 * The claims the workers kept (`out`), checked: blocks with two holders, kept claims gone from the disk, and the
 * workers `p0` to `p<workers - 1>` that kept none (UCR-206: a race in which a worker never claims looks at nothing,
 * so it must fail, not pass).
 */
function tally(out: string, workers: number): { won: string[][]; blocks: number; twice: [string, string[]][]; gone: string[][]; idle: string[] } {
  const won = readFileSync(out, 'utf8').split('\n').filter(line => line !== '').map(line => line.split(' '))
  const byBlock = new Map<string, string[]>()
  for (const [me, block, path] of won) {
    byBlock.set(block!, [...(byBlock.get(block!) ?? []), `${me}:${path}`])
  }
  const kept = new Set(won.map(([me]) => me))
  const idle = Array.from({ length: workers }, (_, i) => `p${i}`).filter(me => !kept.has(me))

  return { won, blocks: byBlock.size, twice: [...byBlock].filter(([, holders]) => holders.length > 1), gone: won.filter(([, , path]) => !existsSync(path!)), idle }
}

/** Starts the worker processes with `argvs`, then lets them all go at one moment, once all have loaded. */
async function race(argvs: string[][], go: string): Promise<void> {
  const here = fileURLToPath(import.meta.url)
  const loader = resolve(dirname(here), 'ts-resolve.mjs')
  const runs = argvs.map(argv => {
    const child = spawn(process.execPath, ['--import', loader, here, ...argv], { stdio: 'inherit' })

    return new Promise<void>(done => child.on('exit', () => done()))
  })
  await new Promise(done => setTimeout(done, 2000))
  writeFileSync(go, '')
  await Promise.all(runs)
}

async function driver(rounds: number, isOld: boolean): Promise<void> {
  const root = mkdtempSync(`${tmpdir()}/claim-race-`)
  const git = `${root}/git/id-claims`
  const work = `${root}/work/id-claims`
  mkdirSync(git, { recursive: true })
  mkdirSync(work, { recursive: true })
  const out = `${root}/won`
  const go = `${root}/go`
  writeFileSync(out, '')
  const per = Math.ceil(rounds / WORKERS)
  await race(
    Array.from({ length: WORKERS }, (_, i) => {
      const [dir, other] = i % 2 === 0 ? [git, work] : [work, git]

      return ['worker', dir!, other!, out, go, String(per), `p${i}`, isOld ? 'old' : 'new']
    }),
    go,
  )
  const { won, blocks, twice, gone, idle } = tally(out, WORKERS)
  const inGit = won.filter(([, , path]) => path!.startsWith(git)).length
  console.log(`claim-race (${isOld ? 'old steps, no cross-folder check' : 'claimAcross'}): ${won.length} claims kept (${inGit} in the git folder, ${won.length - inGit} in the fallback), ${blocks} blocks, ${twice.length} blocks with two holders, ${gone.length} kept claims missing, ${idle.length} workers with no claim${idle.length > 0 ? ` (${idle.join(' ')})` : ''}`)
  for (const [block, holders] of twice.slice(0, 5)) {
    console.log(`  block ${block}: ${holders.join(', ')}`)
  }
  rmSync(root, { recursive: true, force: true })
  // UCR-206: no claim in a folder (git or fallback) or by a worker is a race that checked nothing: a failure.
  process.exit(twice.length > 0 || gone.length > 0 || idle.length > 0 || inGit === 0 || inGit === won.length ? 1 : 0)
}

// ---------------------------------------------------------------- real git layouts

/** One session of a layout: its folder, whether its git call fails, and how often its `mkdir -p` of the git claim folder fails. */
type Role = { cwd: string; gitFail?: boolean; failRate?: number }

/** The environment of a git call: no GIT_ variable of the shell that runs this, and `GIT_DIR` at a missing folder when git must fail. */
function gitEnv(isFail: boolean): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))

  return isFail ? { ...env, GIT_DIR: '/nonexistent-claim-race-git-dir' } : env
}

/**
 * The claim folders of a session, by the engine's steps (`discoverFolders`, `claimFolders`): git's common dir when
 * `git rev-parse` works and names the session's own folder (UCR-150); else the common dir read from the `.git`
 * entry up from the session folder (the primary todo folder is at its top here); else that folder's own.
 */
async function sessionFolders(role: Role): Promise<{ main?: string; fallback?: string }> {
  const here = realpathSync(role.cwd)
  const top = spawnSync(REV_PARSE[0]!, REV_PARSE.slice(1), { cwd: role.cwd, env: gitEnv(role.gitFail === true), encoding: 'utf8' })
  const roots = top.status === 0 ? repoRoots(top.stdout) : undefined
  const common = roots !== undefined && isSameFolder(sessionFolder(top.stdout), here) ? gitCommonDir(top.stdout) : undefined
  if (common !== undefined) {
    return claimDirs({ common })
  }
  const found = await gitWhereUp(realGitFs, here)
  if (found === 'unknown') {
    return {}
  }

  return claimDirs(found !== undefined ? { common: found.common } : { looseBase: here })
}

async function layoutWorker(role: Role, out: string, go: string, claims: number, me: string, isNoFallback = false): Promise<void> {
  const dirs = await sessionFolders(role)
  appendFileSync(`${out}.roles`, `${me} ${JSON.stringify(role)} ${JSON.stringify(dirs)}\n`)
  while (!existsSync(go)) {
    await new Promise(done => setTimeout(done, 1))
  }
  if (dirs.main === undefined) {
    return
  }
  let isPruned = false
  let kept = 0
  for (let tries = 0; kept < claims && tries < claims * 20; tries += 1) {
    // As `claimBlock`: the git claim folder first; the fallback only when that `mkdir -p` fails and there is one.
    let dir = dirs.main
    let other = dirs.fallback
    const isMainMade = !(role.failRate !== undefined && Math.random() < role.failRate) && spawnSync('mkdir', ['-p', '--', dir]).status === 0
    if (!isMainMade) {
      // `--no-fallback`, the self-test of UCR-206: a worker that never claims in the fallback.
      if (dirs.fallback === undefined || isNoFallback || spawnSync('mkdir', ['-p', '--', dirs.fallback]).status !== 0) {
        await new Promise(done => setTimeout(done, 2))
        continue
      }
      other = dir
      dir = dirs.fallback
    }
    const listed = await realPort.list(dir)
    if (listed === undefined) {
      continue
    }
    const time = Date.now()
    const from = lowestFree([dir, other])
    let own = listed
    if (!isPruned) {
      isPruned = true
      for (const name of prunableClaims(listed, from, time)) {
        if (await realPort.remove(`${dir}/${name}`)) {
          own = own.filter(entry => entry.name !== name)
        }
      }
    }
    const got = await claimAcross(realPort, dir, other, own, from, time)
    if (typeof got !== 'string') {
      appendFileSync(out, `${me} ${got.block} ${got.path}\n`)
      kept += 1
    }
  }
}

/** Runs git with a fixed identity and branch name, no GIT_ variable of the shell. */
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=claim-race', '-c', 'user.email=claim-race@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv(false), stdio: 'ignore' })
}

/** Stale claims (older than CLAIM_MS) on blocks 0 to 2, so the race also takes blocks over by generation. */
function seedStale(dir: string | undefined): void {
  if (dir === undefined) {
    return
  }
  mkdirSync(dir, { recursive: true })
  const old = (Date.now() - 2 * CLAIM_MS) / 1000
  for (const name of ['0', '1.1', '2']) {
    mkdirSync(`${dir}/${name}`, { recursive: true })
    utimesSync(`${dir}/${name}`, old, old)
  }
}

/** The layouts, made under `root`: each with the sessions that race in it. Every checkout has its own `.claude_todo/`. */
function makeLayouts(root: string): { name: string; roles: Role[] }[] {
  const todo = (checkout: string) => mkdirSync(`${checkout}/.claude_todo`, { recursive: true })
  mkdirSync(`${root}/plain`)
  git(`${root}/plain`, 'init', '-q')
  git(`${root}/plain`, 'commit', '-q', '--allow-empty', '-m', 'first')
  git(`${root}/plain`, 'worktree', 'add', '-q', '-b', 'wt', '../wt')
  git(root, 'clone', '-q', '--bare', 'plain', 'bare.git')
  git(`${root}/bare.git`, 'worktree', 'add', '-q', '-b', 'b1', '../bwt')
  git(`${root}/bare.git`, 'worktree', 'add', '-q', '-b', 'b2', '../bwt2')
  git(root, 'init', '-q', '--separate-git-dir=sep.git', 'sep')
  git(`${root}/sep`, 'commit', '-q', '--allow-empty', '-m', 'first')
  git(`${root}/sep`, 'worktree', 'add', '-q', '-b', 's1', '../sepwt')
  // UCR-202 s6: a separate git dir under a folder named `worktrees`, which is not a linked worktree's git dir.
  mkdirSync(`${root}/store/worktrees`, { recursive: true })
  git(root, 'init', '-q', '--separate-git-dir=store/worktrees/proj.git', 'wproj')
  git(`${root}/wproj`, 'commit', '-q', '--allow-empty', '-m', 'first')
  // UCR-202 s7: a submodule named `worktrees` with a nested submodule `inner`, whose git dir is
  // `super/.git/modules/worktrees/modules/inner`.
  const allowFile = ['-c', 'protocol.file.allow=always']
  for (const source of ['src-inner', 'src-mid', 'super']) {
    mkdirSync(`${root}/${source}`)
    git(`${root}/${source}`, 'init', '-q')
    git(`${root}/${source}`, 'commit', '-q', '--allow-empty', '-m', 'first')
  }
  git(`${root}/src-mid`, ...allowFile, 'submodule', 'add', '-q', `${root}/src-inner`, 'inner')
  git(`${root}/src-mid`, 'commit', '-q', '-m', 'inner')
  git(`${root}/super`, ...allowFile, 'submodule', 'add', '-q', `${root}/src-mid`, 'worktrees')
  git(`${root}/super`, 'commit', '-q', '-m', 'worktrees')
  git(`${root}/super`, ...allowFile, 'submodule', 'update', '-q', '--init', '--recursive')
  for (const checkout of ['plain', 'wt', 'bwt', 'bwt2', 'sep', 'sepwt', 'wproj', 'super/worktrees/inner']) {
    todo(`${root}/${checkout}`)
  }
  const mix = (a: string, b: string): Role[] => [
    { cwd: `${root}/${a}` },
    { cwd: `${root}/${b}` },
    { cwd: `${root}/${a}`, failRate: 0.5 },
    { cwd: `${root}/${b}`, failRate: 0.5 },
    { cwd: `${root}/${a}`, gitFail: true },
    { cwd: `${root}/${b}`, gitFail: true },
    { cwd: `${root}/${a}`, gitFail: true, failRate: 0.5 },
    { cwd: `${root}/${b}`, gitFail: true, failRate: 0.5 },
    { cwd: `${root}/${a}`, failRate: 0.9 },
    { cwd: `${root}/${b}`, gitFail: true, failRate: 0.9 },
  ]

  return [
    { name: 'a .git folder and a linked worktree', roles: mix('plain', 'wt') },
    { name: 'a bare repo and two worktrees', roles: mix('bwt', 'bwt2') },
    { name: 'a separate git dir and a linked worktree', roles: mix('sep', 'sepwt') },
    { name: 'a separate git dir under a folder named worktrees (s6)', roles: mix('wproj', 'wproj') },
    { name: 'a nested submodule in a submodule named worktrees (s7)', roles: mix('super/worktrees/inner', 'super/worktrees/inner') },
  ]
}

async function layoutDriver(rounds: number, isNoFallback: boolean): Promise<void> {
  // Sessions start from the path as given (on macOS a symlink, /var to /private/var), as a shell's folder can be; git and the walk print real paths.
  const root = mkdtempSync(`${tmpdir()}/claim-race-layouts-`)
  const shown = realpathSync(root)
  let isBad = false
  for (const layout of makeLayouts(root)) {
    const out = `${root}/won-${layout.roles[0]!.cwd.split('/').pop()}`
    const go = `${out}.go`
    writeFileSync(out, '')
    const per = Math.ceil(rounds / layout.roles.length)
    // The folders are seeded once, by the first session's view of them, before the race.
    const first = await sessionFolders(layout.roles[0]!)
    seedStale(first.main)
    seedStale(first.fallback)
    await race(
      layout.roles.map((role, i) => ['layout-worker', JSON.stringify(role), out, go, String(per), `p${i}`, ...(isNoFallback ? ['no-fallback'] : [])]),
      go,
    )
    const named = readFileSync(`${out}.roles`, 'utf8').split('\n').filter(line => line !== '')
    const views = new Set(named.map(line => line.slice(line.lastIndexOf(' {') + 1)))
    const { won, blocks, twice, gone, idle } = tally(out, layout.roles.length)
    const byDir = new Map<string, number>()
    for (const [, , path] of won) {
      const dir = path!.slice(0, path!.lastIndexOf('/')).replace(shown, '<root>')
      byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
    }
    console.log(`claim-race layout, ${layout.name}: ${won.length} claims kept, ${blocks} blocks, ${twice.length} blocks with two holders, ${gone.length} kept claims missing, ${idle.length} roles with no claim${idle.length > 0 ? ` (${idle.join(' ')})` : ''}, ${views.size} claim-folder view(s): ${[...views].map(view => view.replaceAll(shown, '<root>')).join(' | ')}`)
    // The claims kept in each of the layout's claim folders: both must hold some when it has a fallback (UCR-206).
    const inMain = won.filter(([, , path]) => dirname(path!) === first.main).length
    const inFallback = won.filter(([, , path]) => dirname(path!) === first.fallback).length
    const isOneFolderOnly = inMain === 0 || (first.fallback !== undefined && inFallback === 0)
    console.log(`  by folder: ${JSON.stringify([...byDir])}${first.fallback === undefined ? ' (no fallback)' : `, ${inFallback} in the fallback`}${isOneFolderOnly ? ' FAIL: a claim folder kept no claim' : ''}`)
    for (const [block, holders] of twice.slice(0, 3)) {
      console.log(`  block ${block}: ${holders.join(', ')}`)
    }
    // UCR-206: a layout or a role that kept no claim checked nothing: a failure, never a pass.
    isBad ||= twice.length > 0 || gone.length > 0 || views.size !== 1 || idle.length > 0 || won.length === 0 || isOneFolderOnly
  }
  rmSync(root, { recursive: true, force: true })
  process.exit(isBad ? 1 : 0)
}

const args = process.argv.slice(2)
const rounds = Number(args.find(one => /^\d+$/.test(one)) ?? 1000)
if (args[0] === 'worker') {
  const [, dir, other, out, go, claims, me, mode] = args
  await worker(dir!, other!, out!, go!, Number(claims), me!, mode === 'old')
} else if (args[0] === 'layout-worker') {
  const [, role, out, go, claims, me, mode] = args
  await layoutWorker(JSON.parse(role!) as Role, out!, go!, Number(claims), me!, mode === 'no-fallback')
} else if (args.includes('--layouts')) {
  await layoutDriver(rounds, args.includes('--no-fallback'))
} else {
  await driver(rounds, args.includes('--old'))
}
