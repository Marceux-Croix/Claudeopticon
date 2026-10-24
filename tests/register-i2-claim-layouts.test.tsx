// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { blockIds, CLAIM_MS } from '../hooks/id-blocks'
import { ticketValue } from '../hooks/ticket-ids'

// Engine cases: the claim folder in every git layout, a read-only
// `.git`, Consolidate's renumbering from the claimed block, claim pruning, a press
// from an out-of-date board, and a cut folder file whose first read fails. Fakes of their own,
// ported from the H2 probes (probe-h2v).
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
type TestApi = Parameters<Parameters<typeof test>[1]>[0]
type OnApi = Parameters<Parameters<typeof test>[1]>[1]

const R = '/repo'
const T = `${R}/.claude_todo/TODO.md`
const Y = `${R}/mods/y/.claude_todo/TODO.md`
const Y_LISTED = ['.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md']
const GIT_CLAIMS = `${R}/.git/claudeopticon/id-claims`
const WORK_CLAIMS = `${R}/.claude_work/claudeopticon-id-claims`

type I2Opts = {
  listed: string[]
  /** The claim entries by path, with the clock ms each was made: shared with "another session". */
  claims?: Map<string, number>
  /** The git common dir git names; with `gitIsFile`, `/repo/.git` is a file (a separate git dir). */
  common?: string
  gitIsFile?: boolean
  /** The session's nearest todo folder (where its relative paths land). */
  near?: string
  /** True for a folder `mkdir -p` cannot make (a read-only `.git`). */
  baseFails?: (dir: string) => boolean
  hold?: (path: string) => Promise<void> | void
  readHook?: (path: string) => void
  /** Runs right before a claim `mkdir`. */
  beforeClaim?: (path: string) => void
}

/**
 * A fake repo at `/repo`: `mkdir` makes claim entries in `claims` atomically (one that is there exits 1),
 * `rmdir` deletes one, and a claim folder anywhere lists its entries. Writes may be held.
 */
function i2Repo(on: OnApi, files: Record<string, string>, opts: I2Opts) {
  const claims = opts.claims ?? new Map<string, number>()
  const calls: string[] = []
  const writes: string[] = []
  const near = opts.near ?? `${R}/.claude_todo`
  const common = opts.common ?? `${R}/.git`
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => [...new Set(Object.keys(files).filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0]!))]
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : out('', 1)
    }
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }
    if (argv[0] === 'mkdir') {
      const path = argv[argv.length - 1]!
      if (argv[1] === '-p') {
        return out('', opts.baseFails?.(path) === true ? 1 : 0)
      }
      opts.beforeClaim?.(path)
      if (claims.has(path)) {
        return out('', 1)
      }
      claims.set(path, 0)

      return out('')
    }
    if (argv[0] === 'rmdir') {
      const path = argv[argv.length - 1]!

      return out('', claims.delete(path) ? 0 : 1)
    }
    if (argv[0] === 'git' && argv[1] === 'rev-parse') {
      return out(`${R}\n${common}\n${common}\n\n`)
    }

    return out(argv.includes('--directory') ? '' : opts.listed.join('\0'))
  })
  const own = (path: string) => (inside(path) ? path : `${near}/${path.split('/').pop()}`)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.git') || claims.has(e.path) || (e.path.endsWith('.claude_todo') && !inside(e.path)) || (inside(e.path) && (e.path in files || Object.keys(files).some(path => path.startsWith(`${e.path}/`)))) }))
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/home/a/.claude')) {
      throw new Error('ENOENT')
    }
    const isFile = e.path in files || (opts.gitIsFile === true && e.path === `${R}/.git`)

    return { value: { kind: isFile ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: inside(e.path) ? e.path : !e.path.includes('.claude_todo') && !e.path.includes('.git') ? R : near } } as never
  })
  on('fs.list', (_$, e) => {
    if (e.path.includes('id-claims')) {
      return { value: [...claims].filter(([path]) => path.startsWith(`${e.path}/`)).map(([path, mtimeMs]) => ({ name: path.slice(e.path.length + 1), kind: 'dir', size: 0, mtimeMs, isLink: false })) } as never
    }
    const dir = inside(e.path) ? e.path : near

    return { value: names(dir).filter(name => name.endsWith('.md')).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2 + writes.length, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    const path = own(e.path)
    opts.readHook?.(path)

    return { value: files[path] ?? '' }
  })
  on('fs.write', async (_$, e) => {
    const path = own(e.path)
    await opts.hold?.(path)
    files[path] = e.text as string
    writes.push(path)

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { calls, claims, writes }
}

const open = async ($: TestApi) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function toastsOf(on: OnApi): string[] {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)

  return toasts
}

function promptOf(on: OnApi): { line: () => string | undefined } {
  let ctx: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    ctx = e.context ?? []

    return { text: e.text, context: e.context }
  })

  return { line: () => ctx.join('\n').split('\n').find(one => one.startsWith('Next free ticket IDs')) }
}

function store(on: OnApi, shared: Map<string, unknown>, session = 'sess-1') {
  on('store.get', (_$, e) => ({ value: shared.get(e.key) }) as never)
  on('store.set', (_$, e) => (shared.set(e.key, e.value), { value: undefined }) as never)
  on('session.id', () => ({ value: session }) as never)
}

const offered = (line: string | undefined): string[] => (line === undefined ? [] : [...line.matchAll(/#(T\w+)/g)].map(m => m[1]!.toLowerCase()))
const claimMkdirs = (calls: readonly string[]) => calls.filter(one => one.startsWith('mkdir -- '))

// ---------------------------------------------------------------- remainder: a `.git` file
// Property: every session of a repo claims in the git common dir, in every git layout and from any working
// folder, so two sessions never hold one block in two folders.

for (const near of [`${R}/.claude_todo`, `${R}/mods/y/.claude_todo`]) {
  test(`a .git file (separate git dir): the claim is in the common dir, from nearest ${near.slice(R.length + 1)}`, async ($, on) => {
    mock.clock(on)
    store(on, new Map())
    const COMMON = '/store/repo.git/claudeopticon/id-claims'
    // The other session already holds block 0, in the one claim folder of the repo.
    const claims = new Map<string, number>([[`${COMMON}/0`, 0]])
    const fake = i2Repo(on, { [T]: '- [ ] #T0001 a', [Y]: '- [ ] #T0002 b' }, { listed: Y_LISTED, claims, common: '/store/repo.git', gitIsFile: true, near })
    const prompt = promptOf(on)
    await open($)
    await $.prompt.submit({ text: 'go' } as never)
    // Never block 0, never a folder beside a todo folder.
    expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${COMMON}/1`])
    expect(offered(prompt.line())).toEqual(blockIds([], 1, 3).map(id => id.toLowerCase()))
  })
}

// ---------------------------------------------------------------- a read-only .git
// Property: a `.git` the claim folder cannot be made in does not stop numbering: the claims go to the repo's
// `.claude_work/` folder, with one toast, and the claims the `.git` folder lists still count as held.

test('a read-only .git: numbering and offers go on from the .claude_work claim folder, with one toast', async ($, on) => {
  const clock = mock.clock(on)
  store(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] #T0001 a\n- [ ] new one' }
  const toasts = toastsOf(on)
  // Another session made block 0 before the folder went read-only: it lists, so block 0 stays its own.
  const claims = new Map<string, number>([[`${GIT_CLAIMS}/0`, 0]])
  const fake = i2Repo(on, files, { listed: ['.claude_todo/TODO.md'], claims, baseFails: dir => dir === GIT_CLAIMS })
  const prompt = promptOf(on)
  await open($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  await sleep(20)
  await $.prompt.submit({ text: 'go' } as never)
  // The state: after the wait the new line has an ID, and the prompt names IDs.
  expect(files[T]).toMatch(/^- \[ \] #T0001 a\n- \[ \] #T\w+ new one$/)
  expect(offered(prompt.line()).length).toBe(3)
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${WORK_CLAIMS}/1`])
  expect(toasts.filter(one => one.includes(`cannot write ${GIT_CLAIMS}`)).length).toBe(1)
  expect(toasts.filter(one => one.includes('names no new ticket IDs'))).toEqual([])
})

test('the limits: a writable .git never uses the fallback; with no folder at all no ID is named, with one toast', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  const toasts = toastsOf(on)
  const fake = i2Repo(on, { [T]: '- [ ] #T0001 a' }, { listed: ['.claude_todo/TODO.md'], baseFails: () => true })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.line()).toBeUndefined()
  expect(claimMkdirs(fake.calls)).toEqual([])
  expect(toasts.filter(one => one.includes('names no new ticket IDs')).length).toBe(1)
})

test('the excluded population: a writable .git claims there and never toasts the fallback', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  const toasts = toastsOf(on)
  const fake = i2Repo(on, { [T]: '- [ ] #T0001 a' }, { listed: ['.claude_todo/TODO.md'] })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(offered(prompt.line())).toEqual(['t0002', 't0003', 't0004'])
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${GIT_CLAIMS}/0`])
  expect(toasts.filter(one => one.includes('claims new ticket IDs in'))).toEqual([])
})

// ---------------------------------------------------------------- Consolidate's renumbering
// Property: an ID Consolidate's renumbering writes comes from this session's claimed block and is recorded
// before the write, so a prompt during the press never names it.

test('a prompt during a Consolidate press never names the ID the renumbering writes', async ($, on) => {
  mock.clock(on)
  const shared = new Map<string, unknown>()
  store(on, shared)
  const files: Record<string, string> = { [T]: '- [ ] #T0001 Fix the parser', [Y]: '- [ ] #T0001 Tune the cache' }
  let release: () => void = () => undefined
  let isHeld = false
  i2Repo(on, files, { listed: Y_LISTED, hold: async path => {
    if (path === T && !isHeld) {
      isHeld = true
      await new Promise<void>(resolve => {
        release = resolve
      })
    }
  } })
  const prompt = promptOf(on)
  const ui = await open($)
  const press = ui.press({ key: 'todo-consolidate' })
  for (let i = 0; i < 100 && !isHeld; i += 1) {
    await sleep(5)
  }
  expect(isHeld).toBe(true)
  // The V117 state: the target write is held, and a prompt comes in.
  await $.prompt.submit({ text: 'go' } as never)
  const mine = offered(prompt.line())
  // The ID is in the store's reservations before the write lands, for another session too.
  const stored = (shared.get(`reserved:${R}`) as [string, number, string | null, string | null][] | undefined) ?? []
  release()
  await press
  await sleep(30)
  const written = [...files[T]!.matchAll(/#(T\w+) Tune the cache/g)].map(m => m[1]!.toLowerCase())
  expect(written.length).toBe(1)
  expect(written[0]).not.toBe('t0001')
  expect(mine.length).toBe(3)
  expect(mine.filter(id => written.includes(id))).toEqual([])
  expect(stored.map(one => one[0])).toContain(written[0])
})

// ---------------------------------------------------------------- claims that are used up
// Property: the claims no one needs (stale, below the first free block) are deleted, at most once per hour; a live
// claim and the blocks at or above the first free one stay.

test('stale, used claims are deleted at the first claim, live ones stay, and not again within the hour', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  // IDs up to T000U (value 30): the first free block is 3 (values 24 to 31), and it has one free value.
  // Changed later: the newest generation name of a block is never deleted, so blocks 0 and 1 have
  // an older generation that goes (`0`, `1`) and a newest one that stays (`0.1`, `1.1`).
  const claims = new Map<string, number>([
    [`${GIT_CLAIMS}/0`, -2 * CLAIM_MS],
    [`${GIT_CLAIMS}/0.1`, -CLAIM_MS],
    [`${GIT_CLAIMS}/1`, -2 * CLAIM_MS],
    [`${GIT_CLAIMS}/1.1`, -2 * CLAIM_MS],
    [`${GIT_CLAIMS}/2`, 0],
  ])
  let isFirst = true
  // Right at the first claim, another stale used claim shows up: the second claim of this offer must leave it.
  const fake = i2Repo(on, { [T]: '- [ ] #T000U a' }, { listed: ['.claude_todo/TODO.md'], claims, beforeClaim: () => {
    if (isFirst) {
      isFirst = false
      claims.set(`${GIT_CLAIMS}/1.2`, -2 * CLAIM_MS)
    }
  } })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(offered(prompt.line()).length).toBe(3)
  const removed = fake.calls.filter(one => one.startsWith('rmdir -- '))
  expect(removed).toEqual([`rmdir -- ${GIT_CLAIMS}/0`, `rmdir -- ${GIT_CLAIMS}/1`])
  // The live claim of block 2 stays, and so does the newest name of each block; the stale one made after the first
  // pruning waits for the next hour.
  expect(claims.has(`${GIT_CLAIMS}/2`)).toBe(true)
  expect(claims.has(`${GIT_CLAIMS}/0.1`)).toBe(true)
  expect(claims.has(`${GIT_CLAIMS}/1.1`)).toBe(true)
  expect(claims.has(`${GIT_CLAIMS}/1.2`)).toBe(true)
  // Two claims this offer (block 3 ran out after one ID), one pruning.
  expect(claimMkdirs(fake.calls).length).toBe(2)
})

// ---------------------------------------------------------------- remainder: a press from an out-of-date board
// Property: a press writes only the line the board drew; when the line its key names has another box or text
// now, nothing is written and a toast says so.

test('a Mark done from an out-of-date board is refused with a toast, never written to the neighbor line', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] Fix it\n- [~] Fix it\n- [ ] Fix it' }
  const toasts = toastsOf(on)
  const fake = i2Repo(on, files, { listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  // The P025 state: the first line goes on the disk; the board (no new mtime) still draws the old lines.
  files[T] = '- [~] Fix it\n- [ ] Fix it'
  await ui.press({ key: 'ticket-done-TODO.md-fix it%092' })
  await sleep(30)
  expect(files[T]).toBe('- [~] Fix it\n- [ ] Fix it')
  expect(fake.writes).toEqual([])
  expect(toasts.filter(one => one.includes('changed in TODO.md since the board drew it')).length).toBe(1)
})

test('the excluded population: a press from a current board writes the line it drew', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] Fix it\n- [~] Fix it\n- [ ] Fix it' }
  i2Repo(on, files, { listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  await ui.press({ key: 'ticket-done-TODO.md-fix it%092' })
  await sleep(30)
  expect(files[T]).toBe('- [ ] Fix it\n- [x] Fix it\n- [ ] Fix it')
})

// ---------------------------------------------------------------- remainder: a first read that fails
// Property: a cut folder's file that never read is unknown, not empty: no new ID is named while it is unknown, a
// toast names it once, and once it reads the new IDs go above its IDs.

test('a cut folder file whose first read fails stops new IDs, with one toast, until it reads', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] #T0001 a' }
  const listed = ['.claude_todo/TODO.md']
  // 21 folders: the last by path is cut from the pane (MAX_FOLDERS is 20).
  for (let i = 1; i <= 20; i += 1) {
    const rel = `mods/m${String(i).padStart(2, '0')}/.claude_todo/TODO.md`
    files[`${R}/${rel}`] = i === 20 ? '- [ ] #T0050 cut one' : `- [ ] #T000${(i % 9) + 1} x`
    listed.push(rel)
  }
  const CUT = `${R}/mods/m20/.claude_todo/TODO.md`
  let isBroken = true
  const toasts = toastsOf(on)
  i2Repo(on, files, { listed, readHook: path => {
    if (isBroken && path === CUT) {
      throw new Error('EIO')
    }
  } })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.line()).toBeUndefined()
  expect(toasts.filter(one => one.includes(CUT) && one.includes('did not read')).length).toBe(1)
  // Once it reads, the IDs go above its.
  isBroken = false
  await $.prompt.submit({ text: 'again' } as never)
  const ids = offered(prompt.line())
  expect(ids.length).toBe(3)
  expect(ids.every(one => ticketValue(one)! > ticketValue('T0050')!)).toBe(true)
  expect(toasts.filter(one => one.includes(CUT) && one.includes('did not read')).length).toBe(1)
})
}
