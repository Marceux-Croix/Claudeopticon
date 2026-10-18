// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { KEPT_SESSIONS, readKeptReserved, readKeptWrote, STORED_BRIEF, storedBrief } from '../hooks/kept-records'

// Hook cases on a fake store that can fail: the load and save of kept rows, briefs, sessions, archive records and ID reservations.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Ctx = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

const ROW = { id: 'old', description: 'Old work', type: 'engineer', status: 'completed', startedAt: 0, toolCalls: 3, brief: 'old work' }

/** A fake store with a log of its writes. `failGet` / `failSet` say when a call throws. */
function fakeStore(on: On, opts: { failGet?: (key: string) => boolean; failSet?: (key: string, n: number) => boolean; session?: string; initial?: Record<string, unknown>; hold?: { key: string; until: Promise<void> }; order?: string[] } = {}) {
  const store = new Map<string, unknown>(Object.entries(opts.initial ?? {}))
  const sets: { key: string; value: unknown }[] = []
  const attempts = new Map<string, number>()
  const reached: string[] = []
  on('store.get', async (_$, e) => {
    if (opts.hold?.key === e.key) {
      reached.push(e.key)
      await opts.hold.until
    }
    if (opts.failGet?.(e.key) === true) {
      throw new Error('store down')
    }

    return { value: store.get(e.key) } as never
  })
  on('store.set', (_$, e) => {
    if (e.key.startsWith('archive-wrote:')) {
      opts.order?.push(`record:${Object.keys((e.value ?? {}) as object).length}`)
    }
    attempts.set(e.key, (attempts.get(e.key) ?? 0) + 1)
    if (opts.failSet?.(e.key, attempts.get(e.key)!) === true) {
      throw new Error('store down')
    }
    store.set(e.key, e.value)
    sets.push({ key: e.key, value: e.value })

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: opts.session ?? 'sess-1' }) as never)

  return { store, sets, attempts, reached }
}

/** A fake repo at `/repo` (copied from work.test.tsx). */
const fromPs = (script: string) => String.fromCodePoint(...(/\[char\[\]\]\(([\d,]+)\)/.exec(script)![1]!.split(',').map(Number))).replace(/\\/g, '/')

/**
 * A fake repo (at `/repo` unless `root` says) with the given files by absolute path; `hasNearest` says
 * whether the session folder has its own `.claude_todo`; `rev` is what `git rev-parse` answers;
 * `links` maps a path to the real path the fake stat gives it (a symlink). `uname` is what `uname -s`
 * answers; a trash command named in `failing` exits 1, and one named in `stays` exits 0 but leaves the
 * file. Any other trash command removes the file from `files`, as the real one would.
 */
function repoWith(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string>; uname?: string; failing?: string[]; stays?: string[]; exits?: Record<string, number>; log?: string[]; dangling?: string[]; hold?: Promise<void> }) {
  const R = opts.root ?? '/repo'
  const state = { hasNearest: opts.hasNearest, listed: opts.listed }
  const writes: string[] = []
  const calls: string[] = []
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never

    const fail = { value: { exitCode: 1, stdout: '', stderr: 'failed' } } as never
    const dirEmpty = (dir: string) => !Object.keys(files).some(path => path.startsWith(`${dir}/`))

    // The mod reads HOME to know the global todo folder; CLAUDE_CONFIG_DIR is unset.
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'uname') {
      return out(`${opts.uname ?? 'Darwin'}\n`)
    }
    if (['/usr/bin/trash', 'osascript', 'gio', 'trash-put', 'kioclient5', 'powershell.exe'].includes(argv[0]!)) {
      const script = argv[argv.length - 1]!
      if (argv[0] === 'powershell.exe' && script.startsWith('[System.IO.Directory]::Delete(')) {
        return dirEmpty(fromPs(script)) ? out('') : fail
      }
      if (opts.failing?.includes(argv[0]!)) {
        return fail
      }
      const path =
        argv[0] === 'osascript' ? /POSIX file "(.*)"$/.exec(script)![1]!.replace(/\\(.)/g, '$1')
        : argv[0] === 'powershell.exe' ? fromPs(script)
        : argv[0] === 'kioclient5' ? argv[2]!
        : argv[argv.length - 1]!
      if (!opts.stays?.includes(argv[0]!)) {
        delete files[path]
      }

      return out('')
    }
    if (['open', 'xdg-open', 'explorer.exe'].includes(argv[0]!)) {
      return opts.failing?.includes(argv[0]!) ? fail : ({ value: { exitCode: opts.exits?.[argv[0]!] ?? 0, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'rm') {
      delete files[argv[2]!]

      return out('')
    }
    if (argv[0] === 'rmdir') {
      return dirEmpty(argv[2]!) ? out('') : fail
    }

    return argv[1] === 'rev-parse' ? out(opts.rev ?? `${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : state.listed.join('\0'))
  })
  // The engine may hand the session folder's own paths over made absolute: match by their ends.
  // It does the same to a Windows path (`C:/repo`), which `abs` hands back whole.
  const abs = (path: string) => /[A-Za-z]:\/.*$/.exec(path)?.[0] ?? path
  on('fs.exists', (_$, e) => ({ value: abs(e.path).endsWith('.git') || (abs(e.path).endsWith('.claude_todo') && !inside(abs(e.path)) && state.hasNearest) || (inside(abs(e.path)) && (abs(e.path) in files || Object.keys(files).some(path => path.startsWith(`${abs(e.path)}/`)))) }))
  on('fs.stat', (_$, e) => {
    // The home folder is outside the fake repo and does not exist there.
    if (abs(e.path).startsWith('/home/a/.claude') && !inside(abs(e.path))) {
      throw new Error('ENOENT')
    }

    return (opts.log?.push(`stat:${abs(e.path)}`), { value: { kind: abs(e.path) in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.links?.[abs(e.path)] ?? (inside(abs(e.path)) ? abs(e.path) : !abs(e.path).includes('.claude_todo') && !abs(e.path).includes('.git') ? R : `${R}/.claude_todo`) } }) as never
  })
  on('fs.list', (_$, e) => ({ value: [...(inside(abs(e.path)) ? names(abs(e.path)) : state.hasNearest ? names(`${R}/.claude_todo`) : []), ...(opts.dangling ?? []).filter(path => path.slice(0, path.lastIndexOf('/')) === abs(e.path)).map(path => path.slice(path.lastIndexOf('/') + 1))].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2, isLink: false })) }))
  on('fs.read', (_$, e) => (opts.log?.push(`read:${abs(e.path)}`), { value: files[inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`] ?? '' }))
  on('fs.write', async (_$, e) => {
    const path = inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`
    opts.log?.push(`write:${path}`)
    // A held write: the test presses a button while this write is in flight.
    if (opts.hold !== undefined && e.text !== '') {
      await opts.hold
    }
    files[path] = e.text as string
    // Every write counts, the empty archive file that Show completed makes too: a test
    // that says nothing is written must see that one.
    writes.push(path)

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { state, writes, calls }
}

const begin = async ($: Ctx) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', agentId: 'a1' } as never).catch(() => undefined)
}

const ids = (value: unknown) => (value as { id: string }[]).map(row => row.id)

// ---------------------------------------------------------------- 

/**
 * Property: a store read that fails never counts as an empty store. Until its read works, a key is
 * never written, so stored data is never replaced by empty state. A later load that works merges what
 * was stored. Since a failed key blocks only its own save (the rows with their base and cut
 * IDs as one): the archive record is no longer read at load (reads it per archive file).
 */
for (const failing of ['agents:sess-1', 'orchestrator:sess-1', 'series:sess-1']) {
  test(`a failed read of ${failing} blocks its own save, and the retry keeps the stored rows`, async ($, on) => {
    const clock = mock.clock(on)
    let isDown = true
    const { store, sets } = fakeStore(on, {
      failGet: key => isDown && key === failing,
      initial: { 'agents:sess-1': [ROW], 'orchestrator:sess-1': [['#t1', true]] },
    })
    on('fs.exists', () => ({ value: false }))
    on('agent.list', () => ({ value: [{ id: 'new', description: 'New', type: 'engineer', status: 'running' }] }))
    await begin($)
    await clock.advance(6000)
    await clock.advance(6000)
    const group = failing === 'agents:sess-1' ? ['agents:sess-1', 'agents-base:sess-1', 'agents-cut:sess-1'] : [failing]
    expect(sets.filter(one => group.includes(one.key))).toEqual([])
    isDown = false
    await clock.advance(6000)
    await clock.advance(6000)
    expect(ids(store.get('agents:sess-1'))).toEqual(['old', 'new'])
    expect(store.get('orchestrator:sess-1')).toEqual([['#t1', true]])
  })
}

// The harness queues the plugin's own calls behind a held read, so this guard test also passes on the old
// code; the failed-read tests above are the ones that fail there.
test('a redraw while the load is still reading saves nothing', async ($, on) => {
  const clock = mock.clock(on)
  let release = () => {}
  const hold = new Promise<void>(resolve => {
    release = resolve
  })
  // The agents read is held: the load is open while the redraws happen.
  const { store, sets, reached } = fakeStore(on, { initial: { 'agents:sess-1': [ROW], 'orchestrator:sess-1': [['#t1', true]] }, hold: { key: 'agents:sess-1', until: hold } })
  on('fs.exists', () => ({ value: false }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  on('agent.list', () => ({ value: [{ id: 'new', description: 'New', type: 'engineer', status: 'running' }] }))
  const first = begin($)
  // A prompt redraws the pane while the agents read is still out.
  await new Promise(resolve => setTimeout(resolve, 30))
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List files' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls -a', description: 'List all files' } as never)
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(reached).toEqual(['agents:sess-1'])
  expect(sets.filter(one => one.key.endsWith(':sess-1') && !one.key.startsWith('reserved:'))).toEqual([])
  release()
  await first
  await clock.advance(6000)
  expect(ids(store.get('agents:sess-1'))).toEqual(['old', 'new'])
  expect(store.get('orchestrator:sess-1')).toEqual([['#t1', true]])
})

test('a failed read of the token count is not stored over, and the count joins the stored one after', async ($, on) => {
  const clock = mock.clock(on)
  let isDown = true
  const { store, sets } = fakeStore(on, { failGet: key => isDown && key === 'tokens:sess-1', initial: { 'tokens:sess-1': { tokens: 1000, since: 5 } } })
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  // tokens come from each model request (turn.step), so the case runs steps.
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  const step = async () => {
    for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) {
      // No chunks: the result carries the usage.
    }
  }
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const usage = { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  await step()
  expect(sets.filter(one => one.key === 'tokens:sess-1')).toEqual([])
  expect(store.get('tokens:sess-1')).toEqual({ tokens: 1000, since: 5 })
  isDown = false
  await clock.advance(1000)
  await step()
  expect((store.get('tokens:sess-1') as { tokens: number }).tokens).toBe(1020)
})

// ---------------------------------------------------------------- 

test('a store write that failed once is tried again with the next redraw', async ($, on) => {
  const clock = mock.clock(on)
  const { store, attempts } = fakeStore(on, { failSet: (key, n) => key === 'agents:sess-1' && n === 1 })
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [{ id: 'new', description: 'New', type: 'engineer', status: 'running' }] }))
  await begin($)
  expect(store.get('agents:sess-1')).toBeUndefined()
  await clock.advance(6000)
  await clock.advance(6000)
  expect(attempts.get('agents:sess-1')).toBeGreaterThanOrEqual(2)
  expect(ids(store.get('agents:sess-1'))).toEqual(['new'])
})

test('a failed write of any other key is tried again too', async ($, on) => {
  const clock = mock.clock(on)
  const { store } = fakeStore(on, { failSet: (key, n) => key === 'agents-base:sess-1' && n === 1 })
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [{ id: 'new', description: 'New', type: 'engineer', status: 'running' }] }))
  await begin($)
  await clock.advance(6000)
  await clock.advance(6000)
  expect(store.get('agents-base:sess-1')).toBe(0)
})

test('the pane draws after a reload with damaged stored rows', async ($, on) => {
  mock.clock(on)
  fakeStore(on, { initial: { 'agents:sess-1': [{ ...ROW, id: 'a1', status: 'running', claims: 'x', autoClaims: 7, progress: { done: 'a', total: 1 }, tokens: 'many', toolCalls: 'NaN' }] } })
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Old work', type: 'engineer', status: 'running' }] }))
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('Old work')
})

// ---------------------------------------------------------------- 

test('the stored brief is cut to what linking needs, with the IDs from the cut-off part kept', async ($, on) => {
  const clock = mock.clock(on)
  const { store } = fakeStore(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Work', type: 'engineer', status: 'running' }] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const prompt = `${'x '.repeat(1500)}see #T0009 now`
  await $.agent.spawn({ prompt, description: 'Work', subagentType: 'engineer' } as never)
  await clock.advance(6000)
  const rows = store.get('agents:sess-1') as { brief: string }[]
  expect(rows[0]!.brief.length).toBeLessThan(STORED_BRIEF + 40)
  expect(rows[0]!.brief).toContain('#t0009')
  expect(storedBrief('short')).toBe('short')
})

for (const [name, input] of [
  ['the secret on the first line', { command: 'curl --password hunter2 host' }],
  ['the secret on a later line the pane would not show', { command: 'echo hi\ncurl -H "Authorization: Bearer hunter2" host' }],
  ['a tool that is not Bash', { url: 'https://x.test/?token=hunter2' }],
] as const) {
  test(`an agent's current call is stored hidden when it holds a secret: ${name}`, async ($, on) => {
    const clock = mock.clock(on)
    const { store } = fakeStore(on)
    on('fs.exists', () => ({ value: false }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'Work', type: 'engineer', status: 'running' }] }))
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    await $.agent.spawn({ prompt: 'Work', description: 'Work', subagentType: 'engineer' } as never)
    await $.tool.call({ tool: 'command' in input ? 'Bash' : 'WebFetch', agentId: 'a1', ...input } as never)
    await clock.advance(6000)
    await clock.advance(6000)
    const rows = store.get('agents:sess-1') as { doing?: string }[]
    expect(rows[0]!.doing).toContain('(hidden)')
    expect(JSON.stringify([...store.values()])).not.toContain('hunter2')
  })
}

test('only the last 20 sessions keep their keys; older ones are cleared', async ($, on) => {
  mock.clock(on)
  const initial: Record<string, unknown> = {}
  const old = Array.from({ length: KEPT_SESSIONS + 4 }, (_, i) => `s${i + 1}`)
  initial['sessions-recent'] = old
  for (const id of old) {
    initial[`agents:${id}`] = [ROW]
    initial[`tokens:${id}`] = { tokens: 1, since: 1 }
  }
  const { store } = fakeStore(on, { initial, session: 'sess-new' })
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  // Batch H4: each entry is [ID, time].
  const list = (store.get('sessions-recent') as [string, number][]).map(([id]) => id)
  expect(list.length).toBe(KEPT_SESSIONS)
  expect(list[list.length - 1]).toBe('sess-new')
  // 24 old + this one = 25: the first 5 fall off, the sixth stays.
  for (const id of ['s1', 's5']) {
    expect(store.get(`agents:${id}`)).toBeNull()
    expect(store.get(`tokens:${id}`)).toBeNull()
  }
  expect(store.get('agents:s6')).toEqual([ROW])
  expect(store.get('agents:s24')).toEqual([ROW])
})

test('a session already in the list is moved to the end, not added twice, and nothing is cleared', async ($, on) => {
  mock.clock(on)
  const old = Array.from({ length: KEPT_SESSIONS }, (_, i) => `s${i + 1}`)
  const { store } = fakeStore(on, { initial: { 'sessions-recent': old, 'agents:s1': [ROW] }, session: 's1' })
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  // Batch H4: each entry is [ID, time].
  const list = (store.get('sessions-recent') as [string, number][]).map(([id]) => id)
  expect(list.length).toBe(KEPT_SESSIONS)
  expect(list[list.length - 1]).toBe('s1')
  expect(store.get('agents:s1')).toEqual([ROW])
})

test('a list that cannot be read clears nothing', async ($, on) => {
  mock.clock(on)
  const old = Array.from({ length: KEPT_SESSIONS + 3 }, (_, i) => `s${i + 1}`)
  const { store } = fakeStore(on, { initial: { 'sessions-recent': old, 'agents:s1': [ROW] }, failGet: key => key === 'sessions-recent', session: 'sess-new' })
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  expect(store.get('agents:s1')).toEqual([ROW])
  expect(store.get('sessions-recent')).toEqual(old)
})

// ---------------------------------------------------------------- 

test('at most 200 rows stay in memory, the label base grows by the rows dropped, and an idle tick stores nothing more', async ($, on) => {
  const clock = mock.clock(on)
  const { store, attempts } = fakeStore(on)
  on('fs.exists', () => ({ value: false }))
  const listed = Array.from({ length: 230 }, (_, i) => ({ id: `r${i}`, description: `Row ${i}`, type: 'engineer', status: 'completed' }))
  on('agent.list', () => ({ value: listed }))
  await begin($)
  await clock.advance(6000)
  const rows = store.get('agents:sess-1') as { id: string }[]
  expect(rows.length).toBe(200)
  expect(rows[0]!.id).toBe('r30')
  expect(store.get('agents-base:sess-1')).toBe(30)
  const writes = attempts.get('agents:sess-1')
  await clock.advance(6000)
  await clock.advance(6000)
  expect(attempts.get('agents:sess-1')).toBe(writes)
})

// ---------------------------------------------------------------- 

const DONE = '- [x] #T1 Done parser\n  note under it'

for (const [name, archive] of [
  ['the block is the whole archive', `${DONE}\n`],
  ['the block sits after other text', `# Old\n\n- [x] #T0 Older\n\n${DONE}\n`],
  ['the block sits under a heading', `## Core\n\n${DONE}\n`],
] as const) {
  test(`a retry after a reload does not add a block twice: ${name}`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': `${DONE}\n- [ ] #T2 Open`, '/repo/.claude_todo/archive/TODO.md': archive }
    // The record the first run stored before it wrote the archive, then the reload.
    const wrote = [['- [x] #T1 Done parser', '  note under it']]
    fakeStore(on, { initial: { 'archive-wrote:sess-1': { '/repo/.claude_todo/archive/TODO.md': wrote } } })
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    await clock.advance(3000)
    await clock.advance(3000)
    await clock.advance(3000)
    const text = files['/repo/.claude_todo/archive/TODO.md']!
    expect(text.split('- [x] #T1 Done parser').length - 1).toBe(1)
    expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T2 Open')
  })
}

test('the record is stored before the archive is written, and removed after the source is cut', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': `${DONE}\n- [ ] #T2 Open` }
  const order: string[] = []
  fakeStore(on, { order })
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], log: order })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await clock.advance(3000)
  await clock.advance(3000)
  await clock.advance(3000)
  const record = order.indexOf('record:1')
  expect(record).toBeGreaterThan(-1)
  expect(record).toBeLessThan(order.indexOf('write:/repo/.claude_todo/archive/TODO.md', record))
  expect(order.filter(one => one.startsWith('record:')).pop()).toBe('record:0')
  expect(order.indexOf('record:0')).toBeGreaterThan(order.indexOf('write:/repo/.claude_todo/TODO.md'))
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T2 Open')
  expect(readKeptWrote({ a: [['x']], b: 'no', c: [[1]] }).size).toBe(2)
})

// ---------------------------------------------------------------- and 

const prompts = async ($: Ctx, on: On, session: string, shared: Map<string, unknown>) => {
  on('store.get', (_$, e) => ({ value: shared.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    shared.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: session }) as never)
  const contexts: string[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push((e.context ?? []).join('\n'))

    return { text: e.text, context: e.context }
  })
  await begin($)

  return contexts
}

test('a session reads the IDs another session of the repo reserved, and names the next ones', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  // Written by another process: session A offered 2-4, numbering there holds 5 (no owner).
  const shared = new Map<string, unknown>([['reserved:/repo', [['t0002', 9e15, 'sess-a'], ['t0003', 9e15, 'sess-a'], ['t0004', 9e15, 'sess-a'], ['t0005', 9e15, null]]]])
  const b = await prompts($, on, 'sess-b', shared)
  await $.prompt.submit({ text: 'go' } as never)
  expect(b[0]).toContain('Next free ticket IDs: #T0006, #T0007, #T0008')
  // The store keeps both sessions' entries, under the repo key and no session key.
  const keep = readKeptReserved(shared.get('reserved:/repo')).map(([id]) => id)
  expect(keep).toEqual(['t0002', 't0003', 't0004', 't0005', 't0006', 't0007', 't0008'])
  expect([...shared.keys()].some(key => key.startsWith('reserved:sess'))).toBe(false)
})

test('a reservation that expired is free again, and a damaged entry is ignored', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  // t0002 expired long ago, t0003 is live, the other entries are damaged.
  const shared = new Map<string, unknown>([['reserved:/repo', [['t0002', 1, 'other'], ['t0003', 9e15, 'other'], ['t0004', 'x'], 'bad', [7]]]])
  const a = await prompts($, on, 'sess-a', shared)
  await $.prompt.submit({ text: 'go' } as never)
  expect(a[0]).toContain('Next free ticket IDs: #T0004, #T0005, #T0006')
  expect(readKeptReserved([['t0002', 1, null], ['t0003', 5], 'bad']).length).toBe(2)
})

test('a reservation store that cannot be read is not written over', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const shared = new Map<string, unknown>([['reserved:/repo', [['t0002', 9e15, 'other']]]])
  const contexts: string[] = []
  on('store.get', (_$, e) => {
    if (e.key.startsWith('reserved:')) {
      throw new Error('store down')
    }

    return { value: shared.get(e.key) } as never
  })
  on('store.set', (_$, e) => {
    shared.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-a' }) as never)
  on('prompt.submit', (_$, e) => {
    contexts.push((e.context ?? []).join('\n'))

    return { text: e.text, context: e.context }
  })
  await begin($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(shared.get('reserved:/repo')).toEqual([['t0002', 9e15, 'other']])
})

test('the same IDs are offered again until a file uses one, then only the shortfall is new', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const shared = new Map<string, unknown>()
  const c = await prompts($, on, 'sess-a', shared)
  for (let i = 0; i < 5; i += 1) {
    await $.prompt.submit({ text: `go ${i}` } as never)
  }
  for (const one of c) {
    expect(one).toContain('Next free ticket IDs: #T0002, #T0003, #T0004')
  }
  // A file uses it leaves the offer, one new ID tops it up to three.
  files['/repo/.claude_todo/TODO.md'] += '\n- [ ] #T0003 mine'
  await clock.advance(60000)
  await $.prompt.submit({ text: 'again' } as never)
  expect(c[5]).toContain('Next free ticket IDs: #T0002, #T0004, #T0005')
})
}
