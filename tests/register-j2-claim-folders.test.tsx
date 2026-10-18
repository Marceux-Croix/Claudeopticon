// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { blockIds, CLAIM_MS } from '../hooks/id-blocks'
import { ticketValue } from '../hooks/ticket-ids'

// Batch J2 (UCR-136 to UCR-147): claims across the two claim folders, numbering of many lines, files that never
// read, a store that does not read, fences and tabs in list items, and claim pruning. The fakes are a copy of the
// I2 fake repo, with a git call that may fail and a `mkdir -p` that may fail a set number of times.
{
type TestApi = Parameters<Parameters<typeof test>[1]>[0]
type OnApi = Parameters<Parameters<typeof test>[1]>[1]
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
const R = '/repo'
const T = `${R}/.claude_todo/TODO.md`
const GIT_CLAIMS = `${R}/.git/claudeopticon/id-claims`
const WORK_CLAIMS = `${R}/.claude_work/claudeopticon-id-claims`

type J2Opts = {
  listed: string[]
  /** The claim entries by path, with the clock ms each was made: shared with "another session". */
  claims?: Map<string, number>
  /** How many more times `mkdir -p` of a folder fails (a read-only `.git` is Infinity). */
  baseFails?: Map<string, number>
  readHook?: (path: string) => void
  /** Runs right before a claim `mkdir`. */
  beforeClaim?: (path: string) => void
  /** `git rev-parse` exits 128, as for a repo of "dubious ownership". */
  revFails?: boolean
}

/**
 * A fake repo at `/repo` with a `.git` folder: `mkdir` makes claim entries in `claims` atomically (one that is
 * there exits 1), `rmdir` deletes one, and a claim folder anywhere lists its entries.
 */
function j2Repo(on: OnApi, files: Record<string, string>, opts: J2Opts) {
  const claims = opts.claims ?? new Map<string, number>()
  const calls: string[] = []
  const near = `${R}/.claude_todo`
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
        const left = opts.baseFails?.get(path) ?? 0
        if (left > 0) {
          opts.baseFails!.set(path, left - 1)

          return out('', 1)
        }

        return out('')
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
    if (argv[0] === 'git' && opts.revFails === true) {
      return out('', 128)
    }
    if (argv[0] === 'git' && argv[1] === 'rev-parse') {
      return out(`${R}\n${R}/.git\n${R}/.git\n\n`)
    }

    return out(argv.includes('--directory') ? '' : opts.listed.join('\0'))
  })
  const own = (path: string) => (inside(path) ? path : `${near}/${path.split('/').pop()}`)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.git') || claims.has(e.path) || (e.path.endsWith('.claude_todo') && !inside(e.path)) || (inside(e.path) && (e.path in files || Object.keys(files).some(path => path.startsWith(`${e.path}/`)))) }))
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/home/a/.claude')) {
      throw new Error('ENOENT')
    }

    return { value: { kind: e.path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: inside(e.path) ? e.path : !e.path.includes('.claude_todo') && !e.path.includes('.git') ? R : near } } as never
  })
  on('fs.list', (_$, e) => {
    if (e.path.includes('id-claims')) {
      return { value: [...claims].filter(([path]) => path.startsWith(`${e.path}/`)).map(([path, mtimeMs]) => ({ name: path.slice(e.path.length + 1), kind: 'dir', size: 0, mtimeMs, isLink: false })) } as never
    }
    const dir = inside(e.path) ? e.path : near

    return { value: names(dir).filter(name => name.endsWith('.md')).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    const path = own(e.path)
    opts.readHook?.(path)

    return { value: files[path] ?? '' }
  })
  on('fs.write', (_$, e) => {
    files[own(e.path)] = e.text as string

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { calls, claims }
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
const removed = (calls: readonly string[]) => calls.filter(one => one.startsWith('rmdir -- '))

const settle = async (clock: { advance: (ms: number) => Promise<unknown> }) => {
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  await sleep(30)
}

// ---------------------------------------------------------------- UCR-136: claims across the two folders
// Property: no session claims a block that a claim in the repo's other claim folder holds, whichever folder it
// claims in and whether or not its git call works.

test('UCR-136 a session with a writable .git never claims a block another session holds in the fallback folder', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  // The reviewer's PD state: session B's `mkdir -p` of the git folder failed once, so it holds block 0 in the fallback.
  const claims = new Map<string, number>([[`${WORK_CLAIMS}/0`, 0]])
  const fake = j2Repo(on, { [T]: '- [ ] #T0001 a' }, { listed: ['.claude_todo/TODO.md'], claims })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${GIT_CLAIMS}/1`])
  expect(offered(prompt.line())).toEqual(blockIds([], 1, 3).map(id => id.toLowerCase()))
})

test('UCR-136 a session whose git call fails (exit 128) claims in the git folder and passes over its held block', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  // The reviewer's PD2 state: session A (git works) holds block 0 in the git common dir; this session's rev-parse exits 128.
  const claims = new Map<string, number>([[`${GIT_CLAIMS}/0`, 0]])
  const fake = j2Repo(on, { [T]: '- [ ] #T0001 a' }, { listed: ['.claude_todo/TODO.md'], claims, revFails: true })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  // It finds the git folder from the `.git` on the disk, as the git sessions use it.
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${GIT_CLAIMS}/1`])
  expect(offered(prompt.line())).toEqual(blockIds([], 1, 3).map(id => id.toLowerCase()))
})

test('UCR-136 one failed mkdir -p: the claim in the fallback folder passes over the block the git folder holds', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  const toasts = toastsOf(on)
  // At the limit: the git folder fails once only; the session claims in the fallback, never block 0.
  const claims = new Map<string, number>([[`${GIT_CLAIMS}/0`, 0]])
  const fake = j2Repo(on, { [T]: '- [ ] #T0001 a' }, { listed: ['.claude_todo/TODO.md'], claims, baseFails: new Map([[GIT_CLAIMS, 1]]) })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${WORK_CLAIMS}/1`])
  expect(offered(prompt.line()).length).toBe(3)
  expect(toasts.filter(one => one.includes(`cannot write ${GIT_CLAIMS}`)).length).toBe(1)
})

test('UCR-136 a read-only .git: a claim the git folder shows after the fallback claim is made wins, and the fallback one is given up', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  // UCR-118's read-only `.git`; another session claims block 0 in the git folder between this list and this claim.
  const claims = new Map<string, number>()
  const fake = j2Repo(on, { [T]: '- [ ] #T0001 a' }, { listed: ['.claude_todo/TODO.md'], claims, baseFails: new Map([[GIT_CLAIMS, Infinity]]), beforeClaim: path => {
    if (path === `${WORK_CLAIMS}/0`) {
      claims.set(`${GIT_CLAIMS}/0`, 0)
    }
  } })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${WORK_CLAIMS}/0`, `mkdir -- ${WORK_CLAIMS}/1`])
  expect(removed(fake.calls)).toEqual([`rmdir -- ${WORK_CLAIMS}/0`])
  expect(claims.has(`${WORK_CLAIMS}/0`)).toBe(false)
  expect(offered(prompt.line())).toEqual(blockIds([], 1, 3).map(id => id.toLowerCase()))
})

test('UCR-136 git fails and the .git file does not read: the claim folders are unknown, so no ID is named, with one toast', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  const toasts = toastsOf(on)
  // A `.git` file (a linked worktree or a separate git dir) whose read throws: its common dir cannot be named.
  const files: Record<string, string> = { [T]: '- [ ] #T0001 a', [`${R}/.git`]: 'gitdir: /store/repo.git' }
  const fake = j2Repo(on, files, { listed: ['.claude_todo/TODO.md'], revFails: true, readHook: path => {
    if (path === `${R}/.git`) {
      throw new Error('EACCES')
    }
  } })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.line()).toBeUndefined()
  expect(claimMkdirs(fake.calls)).toEqual([])
  expect(toasts.filter(one => one.includes('no folder to claim IDs in')).length).toBe(1)
})

test('UCR-136 the excluded population: with nothing in the other folder, a session claims block 0 and gives nothing up', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  const fake = j2Repo(on, { [T]: '- [ ] #T0001 a' }, { listed: ['.claude_todo/TODO.md'] })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${GIT_CLAIMS}/0`])
  expect(removed(fake.calls)).toEqual([])
  expect(offered(prompt.line())).toEqual(['t0002', 't0003', 't0004'])
})

// ---------------------------------------------------------------- UCR-137: many new lines
// Property: a file with more new lines than one pick gives is numbered over a few passes, with no block wasted,
// and a pick that comes back short gives its IDs and claims back, with a toast.

test('UCR-137 a file with 600 new lines gets 600 different IDs over a few passes, with about one claim per block', async ($, on) => {
  const clock = mock.clock(on)
  store(on, new Map())
  const toasts = toastsOf(on)
  const lines = Array.from({ length: 600 }, (_, i) => `- [ ] task ${i}`)
  const files: Record<string, string> = { [T]: `- [ ] #T0001 a\n${lines.join('\n')}` }
  const fake = j2Repo(on, files, { listed: ['.claude_todo/TODO.md'] })
  for (let i = 0; i < 12 && (files[T]!.match(/#T\w+/g) ?? []).length < 601; i += 1) {
    if (i === 0) {
      await open($)
    }
    await settle(clock)
  }
  const ids = files[T]!.match(/#T\w+/g) ?? []
  expect(ids.length).toBe(601)
  expect(new Set(ids).size).toBe(601)
  // 600 IDs from blocks of 8 (block 0 gives 7): 76 blocks, and no block thrown away.
  expect(claimMkdirs(fake.calls).length).toBeLessThanOrEqual(Math.ceil(601 / 8) + 1)
  expect(Math.max(...ids.map(id => ticketValue(id.slice(1))!))).toBe(601)
  expect(toasts.filter(one => one.includes('names no new ticket IDs') || one.includes('found only'))).toEqual([])
})

test('UCR-137 a pick that cannot claim enough blocks gives its IDs and its claim back, with one toast', async ($, on) => {
  const clock = mock.clock(on)
  store(on, new Map())
  const toasts = toastsOf(on)
  // Block 0 is free (6 IDs), blocks 1 to 64 are held by another session: 20 new lines need a second block, which fails.
  const claims = new Map<string, number>(Array.from({ length: 64 }, (_, i) => [`${GIT_CLAIMS}/${i + 1}`, 0]))
  const lines = Array.from({ length: 20 }, (_, i) => `- [ ] task ${i}`)
  const text = `- [ ] #T0001 a\n${lines.join('\n')}`
  const files: Record<string, string> = { [T]: text }
  const fake = j2Repo(on, files, { listed: ['.claude_todo/TODO.md'], claims })
  await open($)
  await settle(clock)
  await settle(clock)
  expect(files[T]).toBe(text)
  // The claim of block 0 that gave 6 unused IDs is deleted, each pass; the toast is once.
  expect(claimMkdirs(fake.calls).filter(one => one.endsWith(`${GIT_CLAIMS}/0`)).length).toBeGreaterThan(0)
  expect(removed(fake.calls).every(one => one === `rmdir -- ${GIT_CLAIMS}/0`)).toBe(true)
  expect(removed(fake.calls).length).toBe(claimMkdirs(fake.calls).filter(one => one.endsWith(`${GIT_CLAIMS}/0`)).length)
  expect(claims.has(`${GIT_CLAIMS}/0`)).toBe(false)
  expect(toasts.filter(one => one.includes('names no new ticket IDs')).length).toBe(1)
})

// ---------------------------------------------------------------- UCR-138: a file that never read in this load
// Property: a file with no good read in this load is never skipped, so the IDs it holds are never offered or written.

test('UCR-138 a todo file that never read in this load is never skipped: its IDs are never offered, and the toast says so', async ($, on) => {
  const clock = mock.clock(on)
  store(on, new Map())
  const toasts = toastsOf(on)
  const U = `${R}/.claude_todo/LOCKED.md`
  const files: Record<string, string> = { [T]: '- [ ] #T0001 a', [U]: '- [ ] #T0002 held in a file that will not read\n- [ ] #T0003 b' }
  j2Repo(on, files, { listed: ['.claude_todo/TODO.md', '.claude_todo/LOCKED.md'], readHook: path => {
    if (path === U) {
      throw new Error('EACCES: permission denied')
    }
  } })
  const prompt = promptOf(on)
  await open($)
  const lines: (string | undefined)[] = []
  for (let i = 0; i < 5; i += 1) {
    await settle(clock)
    await $.prompt.submit({ text: 'go' } as never)
    lines.push(prompt.line())
  }
  // The reviewer's PE state: after 3 passes the offer named #T0002, #T0003, #T0004.
  expect(lines).toEqual([undefined, undefined, undefined, undefined, undefined])
  const locked = toasts.filter(one => one.includes('LOCKED.md did not read'))
  expect(locked.length).toBe(1)
  expect(locked[0]).toContain('has not read since Claudeopticon loaded')
  expect(locked[0]).not.toContain('chosen without it')
})

// ---------------------------------------------------------------- UCR-144: a store that does not read
// Property (the stated choice): while the store of reservations does not read, numbering still writes, and only an ID
// of this session's own claimed block, never one of a block another session's claim holds; the offers name none.

test('UCR-144 a store that cannot be read: numbering writes from its own claimed block only, and the offer names nothing', async ($, on) => {
  const clock = mock.clock(on)
  on('store.get', () => {
    throw new Error('store down')
  })
  on('store.set', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  // Another session (a current build) holds block 0 in the git folder, and gives T0002 from it.
  const claims = new Map<string, number>([[`${GIT_CLAIMS}/0`, 0]])
  const files: Record<string, string> = { [T]: '- [ ] #T0001 a\n- [ ] new one' }
  const fake = j2Repo(on, files, { listed: ['.claude_todo/TODO.md'], claims })
  const prompt = promptOf(on)
  await open($)
  await settle(clock)
  // The reviewer's PF state wrote `#T0002`; the ID now comes from block 1, the one this session claimed.
  const id = /#(T\w+) new one/.exec(files[T]!)?.[1]
  expect(id).toBe(blockIds([], 1, 1)[0])
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${GIT_CLAIMS}/1`])
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.line()).toBeUndefined()
})

// ---------------------------------------------------------------- UCR-140, UCR-141: examples in list items
// Property: numbering never writes into a code fence or an HTML comment inside a list item, tab-indented or not.

for (const [label, text] of [
  ['UCR-140 a 4-space fence', '- [ ] #T0001 Document the grammar\n    ```md\n    - [ ] example line\n    ```\n'],
  ['UCR-141 a tab-indented comment', '- [ ] #T0001 parent\n\t<!--\n\t- [ ] commented out\n\t-->\n'],
  ['UCR-141 a tab-indented fence', '- [ ] #T0001 parent\n\t```\n\t- [ ] example\n\t```\n'],
] as const) {
  test(`${label} inside a list item is never numbered`, async ($, on) => {
    const clock = mock.clock(on)
    store(on, new Map())
    const files: Record<string, string> = { [T]: text }
    j2Repo(on, files, { listed: ['.claude_todo/TODO.md'] })
    await open($)
    await settle(clock)
    expect(files[T]).toBe(text)
  })
}

test('UCR-140 the excluded population: a new line after the fenced item is numbered', async ($, on) => {
  const clock = mock.clock(on)
  store(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] #T0001 doc\n    ```\n    - [ ] example\n    ```\n- [ ] real one' }
  j2Repo(on, files, { listed: ['.claude_todo/TODO.md'] })
  await open($)
  await settle(clock)
  expect(files[T]).toMatch(/^- \[ \] #T0001 doc\n {4}```\n {4}- \[ \] example\n {4}```\n- \[ \] #T\w+ real one$/)
})

// ---------------------------------------------------------------- UCR-147: pruning keeps the newest name
// Property: pruning never deletes the newest generation name of a block, so no live claim made under that name
// between the list and the delete is ended.

test('UCR-147 pruning deletes the older generations of a used block and keeps its newest name', async ($, on) => {
  mock.clock(on)
  store(on, new Map())
  // IDs up to T000U (value 30): the first free block is 3. Block 0 has two generations, block 1 one: both stale.
  const claims = new Map<string, number>([
    [`${GIT_CLAIMS}/0`, -2 * CLAIM_MS],
    [`${GIT_CLAIMS}/0.1`, -CLAIM_MS],
    [`${GIT_CLAIMS}/1`, -2 * CLAIM_MS],
  ])
  const fake = j2Repo(on, { [T]: '- [ ] #T000U a' }, { listed: ['.claude_todo/TODO.md'], claims })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(offered(prompt.line()).length).toBe(3)
  expect(removed(fake.calls)).toEqual([`rmdir -- ${GIT_CLAIMS}/0`])
  expect(claims.has(`${GIT_CLAIMS}/0.1`)).toBe(true)
  expect(claims.has(`${GIT_CLAIMS}/1`)).toBe(true)
})
}
