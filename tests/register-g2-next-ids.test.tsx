// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { readKeptReserved } from '../hooks/kept-records'
import { parseTodo } from '../hooks/todo-markdown'

// Batch G2 (UCR loop 1): the next free IDs from the disk, shared reservations, numbering of duplicate
// leading IDs, and the Consolidate retry record. The fakes are copied from the block above.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
type TestApi = Parameters<Parameters<typeof test>[1]>[0]
type OnApi = Parameters<Parameters<typeof test>[1]>[1]

const mtimes: Record<string, number> = {}
const clearMtimes = () => {
  for (const key of Object.keys(mtimes)) {
    delete mtimes[key]
  }
}

/**
 * A fake repo at `/repo` with the given files by absolute path, as the block's: `fault` may throw
 * on a write, `readHook` may hold or throw on a read, `log` records stats, reads and writes. `rev` is what
 * `git rev-parse` answers (empty: no repo).
 */
function repoWith(on: OnApi, files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; rev?: string; log?: string[]; fault?: (path: string, text: string) => void; readHook?: (path: string) => Promise<void> | void }) {
  const R = '/repo'
  const writes: string[] = []
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }

    return argv[1] === 'rev-parse' ? out(opts.rev ?? `${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : opts.listed.join('\0'))
  })
  const abs = (path: string) => /[A-Za-z]:\/.*$/.exec(path)?.[0] ?? path
  const own = (path: string) => (inside(abs(path)) ? abs(path) : `${R}/.claude_todo/${abs(path).split('/').pop()}`)
  on('fs.exists', (_$, e) => ({ value: abs(e.path).endsWith('.git') || (abs(e.path).endsWith('.claude_todo') && !inside(abs(e.path)) && opts.hasNearest) || (inside(abs(e.path)) && (abs(e.path) in files || Object.keys(files).some(path => path.startsWith(`${abs(e.path)}/`)))) }))
  on('fs.stat', (_$, e) => {
    if (abs(e.path).startsWith('/home/a/.claude') && !inside(abs(e.path))) {
      throw new Error('ENOENT')
    }

    return (opts.log?.push(`stat:${abs(e.path)}`), { value: { kind: abs(e.path) in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: inside(abs(e.path)) ? abs(e.path) : !abs(e.path).includes('.claude_todo') && !abs(e.path).includes('.git') ? R : `${R}/.claude_todo` } }) as never
  })
  on('fs.list', (_$, e) => ({ value: (inside(abs(e.path)) ? names(abs(e.path)) : opts.hasNearest ? names(`${R}/.claude_todo`) : []).map(name => ({ name, kind: 'file', size: 1, mtimeMs: mtimes[`${abs(e.path)}/${name}`] ?? 2, isLink: false })) }))
  on('fs.read', async (_$, e) => {
    opts.log?.push(`read:${own(e.path)}`)
    const value = files[own(e.path)] ?? ''
    await opts.readHook?.(own(e.path))

    return { value }
  })
  on('fs.write', (_$, e) => {
    const path = own(e.path)
    opts.fault?.(path, e.text as string)
    opts.log?.push(`write:${path}`)
    files[path] = e.text as string
    writes.push(path)

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { writes }
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

function promptOf(on: OnApi): { ctx: () => string } {
  let ctx: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    ctx = e.context ?? []

    return { text: e.text, context: e.context }
  })

  return { ctx: () => ctx.join('\n') }
}

/** A store shared with "another session": `afterSet` runs right after each write lands, as another session's later write would. */
function sharedStore(on: OnApi, session: string, shared: Map<string, unknown>, afterSet: (key: string, value: unknown) => void = () => undefined) {
  on('store.get', (_$, e) => ({ value: shared.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    shared.set(e.key, e.value)
    afterSet(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: session }) as never)
}

const A = '/repo/.claude_todo/A.md'
const B = '/repo/.claude_todo/B.md'
const C = '/repo/.claude_todo/C.md'

// ---------------------------------------------------------------- the prompt's IDs come from the disk

test('the prompt names IDs free on the disk: an edit no scan has read yet counts', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  mock.store(on)
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md'] })
  const prompt = promptOf(on)
  await open($)
  // A Bash edit: the disk holds T0006, and no scan ran since.
  files[A] = '- [ ] #T0005 a\n- [ ] #T0006 b'
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0007, #T0008, #T0009')
})

test('an offered ID that Claude wrote into a file is never offered again, before any scan', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  mock.store(on)
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md'] })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0006, #T0007, #T0008')
  files[A] = '- [ ] #T0005 a\n- [ ] #T0006 b'
  await $.prompt.submit({ text: 'again' } as never)
  expect(prompt.ctx()).not.toContain('#T0006')
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0007, #T0008, #T0009')
})

test('a prompt while a scan still reads the new text names IDs from the disk', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  mock.store(on)
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a' }
  let gate: Promise<void> | undefined
  let release = () => {}
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md'], readHook: async path => {
    if (path === A && gate !== undefined) {
      const held = gate
      gate = undefined
      await held
    }
  } })
  const prompt = promptOf(on)
  await open($)
  files[A] = '- [ ] #T0005 a\n- [ ] #T0006 b'
  mtimes[A] = 3
  gate = new Promise<void>(resolve => { release = resolve })
  const scanning = $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await sleep(10)
  // The scan holds its read of A; the prompt comes now.
  expect(gate).toBeUndefined()
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).not.toContain('#T0006')
  expect(prompt.ctx()).toContain('#T0007')
  release()
  await scanning
})

test('a todo file that will not read: the prompt names no IDs rather than one that file may hold', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  mock.store(on)
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a', [C]: '- [ ] #T0006 c' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/C.md'], readHook: path => {
    if (path === C) {
      throw new Error('EIO')
    }
  } })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).not.toContain('#T0006')
  expect(prompt.ctx()).not.toContain('Next free ticket IDs')
})

test('numbering: a file that fails to read once is an error for the pass, never an empty file', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  mock.store(on)
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a', [B]: '- [ ] beta' }
  let isArmed = false
  let failC = false
  // C.md shows up after the scan listed the folder (at numbering's own stat of B.md), and its first read fails.
  const log = { push: (entry: string) => {
    if (isArmed && entry === `stat:${B}`) {
      isArmed = false
      failC = true
      files[C] = '- [ ] #T0006 c'
    }
    return 0
  } } as unknown as string[]
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md'], log, readHook: path => {
    if (path === C && failC) {
      failC = false
      throw new Error('EIO')
    }
  } })
  await open($)
  await clock.advance(3000)
  isArmed = true
  await clock.advance(3000)
  await clock.advance(6000)
  await clock.advance(6000)
  await sleep(20)
  // The failing read did happen, and B never took C's ID.
  expect(isArmed).toBe(false)
  expect(failC).toBe(false)
  expect(files[B]).not.toMatch(/#T0006\b/)
  expect(files[B]).toMatch(/^- \[ \] #T000[7-9A-Z] beta$/)
})

test('an ID another session took between numbering\'s pick and its store write is never written', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const shared = new Map<string, unknown>()
  let isTaken = false
  // Another session's write lands right after ours: it read the store before we wrote, and offered T0006 too.
  sharedStore(on, 'sess-1', shared, (key, value) => {
    if (!isTaken && key === 'reserved:/repo' && readKeptReserved(value).some(([id]) => id === 't0006')) {
      isTaken = true
      shared.set(key, [['t0006', 9e15, 'sess-b', 'sess-b']])
    }
  })
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a', [B]: '- [ ] beta' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md'] })
  await open($)
  for (let i = 0; i < 5; i += 1) {
    await clock.advance(3000)
  }
  await sleep(20)
  expect(isTaken).toBe(true)
  expect(files[B]).toBe('- [ ] #T0007 beta')
  // The other session's entry is still in the store: giving an ID back never drops another session's claim.
  expect(readKeptReserved(shared.get('reserved:/repo')).some(([id, one]) => id === 't0006' && one.by === 'sess-b')).toBe(true)
})

// ---------------------------------------------------------------- one reservation store per place, no lost writes

test('outside git, two sessions in one todo folder share one reservation key', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  // Session A of the same folder offered T0002 to T0004, stored under the folder's key.
  const shared = new Map<string, unknown>([['reserved:/repo/.claude_todo', [['t0002', 9e15, 'sess-a', 'sess-a'], ['t0003', 9e15, 'sess-a', 'sess-a'], ['t0004', 9e15, 'sess-a', 'sess-a']]]])
  sharedStore(on, 'sess-b', shared)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a' }
  repoWith(on, files, { hasNearest: true, listed: [], rev: '' })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0005, #T0006, #T0007')
  expect([...shared.keys()].some(key => key.startsWith('reserved:sess'))).toBe(false)
})

test('a write of another session that dropped this session\'s reservations is repaired at once', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const shared = new Map<string, unknown>()
  let isOverwritten = false
  sharedStore(on, 'sess-1', shared, key => {
    if (!isOverwritten && key === 'reserved:/repo') {
      isOverwritten = true
      shared.set(key, [['t0009', 9e15, 'sess-b', 'sess-b']])
    }
  })
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(isOverwritten).toBe(true)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0002, #T0003, #T0004')
  expect(readKeptReserved(shared.get('reserved:/repo')).map(([id]) => id).sort()).toEqual(['t0002', 't0003', 't0004', 't0009'])
})

for (const [name, taken, shown] of [
  ['behind a valid first ID', [['t0003', 9e15, 'sess-b', 'sess-b']], '#T0002, #T0004, #T0005'],
  ['the last ID offered', [['t0004', 9e15, 'sess-b', 'sess-b']], '#T0002, #T0003, #T0005'],
  ['an entry stored with no holder', [['t0002', 9e15, null, null]], '#T0003, #T0004, #T0005'],
] as const) {
  test(`an ID another session's overlapping write took is never offered: ${name}`, async ($, on) => {
    clearMtimes()
    mock.clock(on)
    const shared = new Map<string, unknown>()
    let isTaken = false
    sharedStore(on, 'sess-1', shared, key => {
      if (!isTaken && key === 'reserved:/repo') {
        isTaken = true
        shared.set(key, taken.map(one => [...one]))
      }
    })
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
    const prompt = promptOf(on)
    await open($)
    await $.prompt.submit({ text: 'go' } as never)
    expect(isTaken).toBe(true)
    expect(prompt.ctx()).toContain(`Next free ticket IDs: ${shown}`)
  })
}

// ---------------------------------------------------------------- numbering of a repeated leading ID

test('numbering gives the second of two lines that lead with one ID an ID of its own, and keeps the old word', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  mock.store(on)
  const T = '/repo/.claude_todo/TODO.md'
  const files: Record<string, string> = { [T]: ['- [ ] #T0005 First', '- [ ] #T0005 Second', '- [ ] #h264 Decoder', '- [ ] #h264 encoder crash'].join('\n') }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  await sleep(20)
  expect(files[T]).toBe(['- [ ] #T0005 First', '- [ ] #T0006 #T0005 Second', '- [ ] #h264 Decoder', '- [ ] #T0007 #h264 encoder crash'].join('\n'))
  expect(parseTodo(files[T]!).map(item => item.id)).toEqual(['T0005', 'T0006', 'h264', 'T0007'])
})

// ---------------------------------------------------------------- Consolidate

const TARGET = '/repo/.claude_todo/TODO.md'
const Y = '/repo/mods/y/.claude_todo/TODO.md'
const Y_LISTED = ['.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md']
const count = (text: string | undefined, what: string) => (text ?? '').split(what).length - 1

test('a source that changed after a failed empty is not copied again, and is named', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  mock.store(on)
  const files: Record<string, string> = { [TARGET]: '- [ ] #T1 Fix the parser', [Y]: '- [ ] #T7 Tune the cache' }
  const toasts = toastsOf(on)
  let isBroken = true
  repoWith(on, files, { hasNearest: true, listed: Y_LISTED, fault: (path, text) => {
    if (isBroken && path === Y && text === '') {
      throw new Error('EIO')
    }
  } })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(count(files[TARGET], 'Tune the cache')).toBe(1)
  // a write that failed is named as a failure, never as a change.
  expect(toasts.join('\n')).toContain('Not finished')
  expect(toasts.join('\n')).not.toContain('Left as they are')
  isBroken = false
  files[Y] = '- [ ] #T7 Tune the cache\n- [ ] #T9 Warm it at start'
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(count(files[TARGET], 'Tune the cache')).toBe(1)
  expect(files[Y]).toBe('- [ ] #T7 Tune the cache\n- [ ] #T9 Warm it at start')
  expect(toasts.join('\n')).toContain('Not copied again, changed since an earlier copy')
})

test('a retry after a reload only empties a source the stored record says was copied', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const section = '## From mods/y/TODO.md\n\n- [ ] #T7 Tune the cache\n'
  const files: Record<string, string> = { [TARGET]: `- [ ] #T1 Fix the parser\n\n${section}`, [Y]: '- [ ] #T7 Tune the cache' }
  // What the press before the reload stored before it wrote the target.
  mock.store(on, { 'consolidate-marks:/repo/.claude_todo': { [Y]: { heading: 'mods/y/TODO.md', lines: ['- [ ] #T7 Tune the cache'], sectionsBefore: 0, told: [], isTold: true } } })
  repoWith(on, files, { hasNearest: true, listed: Y_LISTED })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files[Y]).toBe('')
  expect(files[TARGET]).toBe(`- [ ] #T1 Fix the parser\n\n${section}`)
})

test('a copied section edited before the retry: the source is only emptied, the edit stays', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  mock.store(on)
  const files: Record<string, string> = { [TARGET]: '- [ ] #T1 Fix the parser', [Y]: '- [ ] #T7 Tune the cache' }
  let isBroken = true
  repoWith(on, files, { hasNearest: true, listed: Y_LISTED, fault: (path, text) => {
    if (isBroken && path === Y && text === '') {
      throw new Error('EIO')
    }
  } })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  isBroken = false
  files[TARGET] = files[TARGET]!.replace('- [ ] #T7 Tune the cache', '- [~] #T7 Tune the cache')
  const edited = files[TARGET]
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files[Y]).toBe('')
  expect(files[TARGET]).toBe(edited)
  expect(count(files[TARGET], 'Tune the cache')).toBe(1)
})

test('a read that fails at the empty step keeps the record: the retry only empties, and no toast says it changed', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  mock.store(on)
  const files: Record<string, string> = { [TARGET]: '- [ ] #T1 Fix the parser', [Y]: '- [ ] #T3 Docs' }
  const toasts = toastsOf(on)
  let reads = -1
  repoWith(on, files, { hasNearest: true, listed: Y_LISTED, readHook: path => {
    // After the open: the first read of the source is the copy, the second the empty step's.
    if (path === Y && reads >= 0) {
      reads += 1
      if (reads === 2) {
        throw new Error('EIO')
      }
    }
  } })
  const ui = await open($)
  reads = 0
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(reads).toBeGreaterThanOrEqual(2)
  expect(files[Y]).toBe('- [ ] #T3 Docs')
  expect(toasts.join('\n')).toContain('Not finished')
  expect(toasts.join('\n')).not.toContain('Left as they are')
  reads = -1
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files[Y]).toBe('')
  expect(count(files[TARGET], 'Docs')).toBe(1)
})

test('the rename map of a folder leaves the IDs in another file\'s code fence as they are', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  mock.store(on)
  const files: Record<string, string> = {
    [TARGET]: '- [ ] #T1 Fix the parser',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Write the docs',
    '/repo/mods/x/.claude_todo/NOTES.md': '# Notes\n\nsee #T1\n\n```sh\ngit log --grep "#T1"\n```',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/.claude_todo/NOTES.md'] })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  const docs = /#(T\w+) Write the docs/.exec(files[TARGET]!)?.[1]
  expect(docs).toBeDefined()
  expect(docs).not.toBe('T1')
  expect(files[TARGET]).toContain(`see #${docs}`)
  expect(files[TARGET]).toContain('git log --grep "#T1"')
})
}
