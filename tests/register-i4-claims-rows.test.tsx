// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { KEPT_SESSIONS, readKeptTickets } from '../hooks/kept-records'

// ---------------------------------------------------------------- I4: UCR-074, 015, 122, 123 (ported probes of the H4 verifier)
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Ctx = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Faults = { exists?: (p: string) => boolean; list?: (p: string) => boolean; read?: (p: string) => boolean; write?: (p: string) => boolean; get?: (key: string) => boolean; set?: (key: string) => boolean }
type Listed = { id: string; description: string; type: string; status: string }

/**
 * The fake repo of the G3 block, copied: files by absolute path, a store, a session ID and an agent
 * list, each able to fail. Two more options: `real` gives a path's real path (default: the path),
 * and `badList` makes a folder list answer with no list at all, so the scan pass throws.
 */
function rig(on: On, files: Record<string, string>, opts: { faults?: Faults; session?: string; store?: Map<string, unknown>; agents?: () => Listed[]; listed?: string[]; real?: (path: string) => string; badList?: (path: string) => boolean } = {}) {
  const R = '/repo'
  const store = opts.store ?? new Map<string, unknown>()
  const sets: string[] = []
  const mtimes = new Map<string, number>()
  const bump = (path: string) => mtimes.set(path, (mtimes.get(path) ?? 2) + 1)
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

    return argv[1] === 'rev-parse' ? out(`${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : (opts.listed ?? ['.claude_todo/TODO.md']).join('\0'))
  })
  const fail = (what: string) => {
    throw new Error(`EIO ${what}`)
  }
  const at = (path: string) => (inside(path) ? path : !path.includes('.claude_todo') && !path.includes('.git') ? R : path.endsWith('.claude_todo') ? `${R}/.claude_todo` : `${R}/.claude_todo/${path.split('/').pop()}`)
  on('fs.exists', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.exists?.(path)) {
      fail('exists')
    }

    return { value: e.path.endsWith('.git') || path in files || Object.keys(files).some(one => one.startsWith(`${path}/`)) }
  })
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/home/a')) {
      throw new Error('ENOENT')
    }
    const path = at(e.path)

    return { value: { kind: path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.real?.(path) ?? path } } as never
  })
  on('fs.list', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.list?.(path)) {
      fail('list')
    }
    if (opts.badList?.(path)) {
      return { value: null } as never
    }

    return { value: names(path).map(name => ({ name, kind: 'file', size: 1, mtimeMs: mtimes.get(`${path}/${name}`) ?? 2, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.read?.(path)) {
      fail('read')
    }

    return { value: files[path] ?? '' }
  })
  on('fs.write', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.write?.(path)) {
      fail('write')
    }
    files[path] = e.text as string
    bump(path)

    return { value: undefined } as never
  })
  on('store.get', (_$, e) => (opts.faults?.get?.(e.key) ? fail('store') : 0, { value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    if (opts.faults?.set?.(e.key)) {
      fail('store')
    }
    store.set(e.key, e.value)
    sets.push(e.key)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: opts.session ?? 'sess-1' }) as never)
  on('agent.list', () => ({ value: opts.agents?.() ?? [] }))
  on('command.register', () => ({ value: undefined }) as never)

  return { store, sets, bump }
}

const openPane = async ($: Ctx) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}
const TODO = '/repo/.claude_todo/TODO.md'
const ARCHIVE = '/repo/.claude_todo/archive/TODO.md'
const RECORD = `archive-wrote:${ARCHIVE}`
const BOOK = '/repo/.claude_todo/categories.json'
const OTHER = '/repo/mods/x/.claude_todo'
const DONE = '- [x] #T1 Done parser\n  note under it'
const BLOCK = ['- [x] #T1 Done parser', '  note under it']
const LIVE: Listed = { id: 'a1', description: 'Long work', type: 'engineer', status: 'running' }
const turnOf = ($: Ctx, agentId: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t-${agentId}`, agentId } as never).catch(() => undefined)
const bookItems = (files: Record<string, string>) => (files[BOOK] === undefined ? {} : (JSON.parse(files[BOOK]!) as { items: Record<string, string> }).items)

/** A model that answers `reply(prompt)` and records every prompt. */
function fakeModel(on: On, reply: (prompt: string) => string) {
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)

    return { value: { isAnswered: true, text: reply(e.prompt), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })

  return prompts
}
const numbers = (prompt: string) => [...prompt.matchAll(/^(\d+)\. /gm)].map(match => match[1]!)
const assignAll = (name: string) => (prompt: string) => JSON.stringify({ categories: [name], assign: Object.fromEntries(numbers(prompt).map(n => [n, name])) })


/** A model with full control: 'empty' = isAnswered false, 'throw' = call fails, else text. */
function rawModel(on: On, reply: (prompt: string) => string) {
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    const out = reply(e.prompt)
    // Batch J4: 'throw' is a transport failure as the engine gives it (an unanswered api-error with no status), which only
    // waits (UCR-074). A real throw, or an HTTP 4xx, may be the items' fault and halves after two (see the J4 block).
    if (out === 'throw') { return { value: { isAnswered: false, reason: 'api-error', status: null, error: 'network', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never }
    if (out === 'empty') { return { value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never }
    return { value: { isAnswered: true, text: out, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  return prompts
}

// UCR-143 (loop 3): 300 s per test, half the 600 s per-file kill, so a hung test fails as itself
// and the other tests of the file still report; three times the slowest measured run (90 s, in a
// full suite at load 10). A larger clock step does not make these cheaper: the mod's 1 s ticker
// fires once per simulated second however the clock is moved (growth test: 81.4 s at 10 s steps,
// 81.0 s at 60 s steps, 72.8 s with clock.set jumps, 5.2 s with a 60 s tick). Typed, no cast (UCR-247).
const T = { timeoutMs: 300_000 }
const claimsOf = (store: Map<string, unknown>) => readKeptTickets(store.get('orchestrator:sess-1')).map(([key]) => key)
const rowsOf = (store: Map<string, unknown>) => (store.get('agents:sess-1') as { id: string; status: string }[] | undefined) ?? []
const sixtyOne = (poisonAt: number) => Array.from({ length: 61 }, (_, i) => `- [ ] #T${i + 1} ${i === poisonAt ? 'poison item' : `item ${i + 1}`}`).join('\n')

/** Property (UCR-074): a call that throws (API or network error) only waits longer: the batch stays the same size. */
test('UCR-074 a call that throws does not halve the batch', T, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: sixtyOne(0) }
  rig(on, files)
  const sizes: number[] = []
  rawModel(on, prompt => {
    sizes.push(numbers(prompt).length)

    return 'throw'
  })
  await openPane($)
  for (let i = 0; i < 600; i += 1) {
    await clock.advance(10_000)
  }
  expect(sizes.length).toBeGreaterThan(2)
  expect(sizes.every(size => size === 60)).toBe(true)
})

/**
 * Property (UCR-015): a claim on a ticket that is gone ends after 30 minutes also when no todo file
 * is left or none ever read. Two states: the only ticket is deleted (no file lists it any more), and
 * every folder has been unreadable since the load. A third, the limit, is the claim at 25 minutes,
 * which still stays.
 */
test('UCR-015 the only ticket is deleted: its claim ends within 40 minutes, not before 25', T, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [~] #T1 Ship the parser' }
  const { store, bump } = rig(on, files)
  await openPane($)
  await turnOf($, 'h1')
  await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 0, total: 1, items: ['#T1'] } as never)
  await clock.advance(6000)
  expect(claimsOf(store)).toEqual(['#t1'])
  files[TODO] = ''
  bump(TODO)
  for (let t = 0; t < 25 * 60_000; t += 3000) {
    await clock.advance(3000)
  }
  await turnOf($, 'h1')
  expect(claimsOf(store)).toEqual(['#t1'])
  for (let t = 0; t < 15 * 60_000; t += 3000) {
    await clock.advance(3000)
  }
  await turnOf($, 'h1')
  expect(claimsOf(store)).toEqual([])
})

test('UCR-015 every folder unreadable since the load: the claim ends within 40 minutes', T, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [~] #T1 Ship the parser' }
  const { store } = rig(on, files, { faults: { list: p => p === '/repo/.claude_todo' }, store: new Map<string, unknown>([['orchestrator:sess-1', [['#t1', true]]]]) })
  await openPane($)
  await turnOf($, 'h1')
  for (let t = 0; t < 25 * 60_000; t += 3000) {
    await clock.advance(3000)
  }
  await turnOf($, 'h1')
  expect(claimsOf(store)).toEqual(['#t1'])
  for (let t = 0; t < 15 * 60_000; t += 3000) {
    await clock.advance(3000)
  }
  await turnOf($, 'h1')
  expect(claimsOf(store)).toEqual([])
})

/**
 * Property (UCR-122): a cut row that returns in the same refresh as a new agent never pushes a live
 * row off the board. The cut row r31 ends and N is new in one refresh; every live row stays.
 */
test('UCR-122 a returning live row and a new agent in one refresh push out no live row', T, async ($, on) => {
  const clock = mock.clock(on)
  const listed: Listed[] = Array.from({ length: 230 }, (_, i) => ({ id: `r${i}`, description: `Row ${i}`, type: 'engineer', status: i === 30 ? 'completed' : 'running' }))
  const { store } = rig(on, {}, { agents: () => listed })
  await openPane($)
  await turnOf($, 'r229')
  for (let i = 0; i < 12; i += 1) {
    await clock.advance(1000)
  }
  listed[31] = { ...listed[31]!, status: 'completed' }
  await turnOf($, 'r31')
  listed.push({ id: 'N', description: 'New', type: 'engineer', status: 'running' })
  await turnOf($, 'N')
  for (let i = 0; i < 12; i += 1) {
    await clock.advance(1000)
  }
  const ids = rowsOf(store).map(row => row.id)
  expect(ids.includes('r32')).toBe(true)
  expect(ids.includes('N')).toBe(true)
})

/**
 * Property (UCR-123): a session that woke and noted itself while another read a stale list keeps its
 * keys, and the old sessions-seen key is cleared once after migration. The stale read lists A as old
 * and past the last KEPT_SESSIONS; the next read shows A live.
 */
test('UCR-123 a dropped session that is live in a second read keeps its keys; the old seen key is cleared', T, async ($, on) => {
  const clock = mock.clock(on)
  await clock.advance(4 * 60 * 60_000)
  const now = 4 * 60 * 60_000
  // The stale list is in the older form (plain IDs, times in sessions-seen), so the read also exercises the migration.
  const stale = ['A', ...Array.from({ length: 25 }, (_, i) => `s${i}`)]
  const fresh = [['A', now - 10], ...Array.from({ length: 25 }, (_, i) => [`s${i}`, now - 1000])]
  class Racing extends Map<string, unknown> {
    reads = 0
    override get(key: string) {
      if (key === 'sessions-recent') {
        this.reads += 1

        return this.reads === 1 ? stale : fresh
      }

      return super.get(key)
    }
  }
  const store = new Racing([['agents:A', [{ id: 'x' }]], ['sessions-seen', Object.fromEntries([['A', 0], ...Array.from({ length: 25 }, (_, i) => [`s${i}`, now - 1000])])], ['agents:s0', [{ id: 'y' }]]])
  rig(on, {}, { store, session: 'B' })
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  await clock.advance(5000)
  expect(store.reads).toBeGreaterThan(1)
  expect(store.get('agents:A')).toEqual([{ id: 'x' }])
  expect(store.get('sessions-seen')).toBeNull()
})

/** The excluded population of UCR-123: a dropped session that is not live in the second read loses its keys. */
test('UCR-123 a dropped session that stays old in the second read loses its keys', T, async ($, on) => {
  const clock = mock.clock(on)
  await clock.advance(4 * 60 * 60_000)
  const now = 4 * 60 * 60_000
  const stale = [['A', 0], ...Array.from({ length: 25 }, (_, i) => [`s${i}`, now - 1000])]
  const store = new Map<string, unknown>([['agents:A', [{ id: 'x' }]], ['sessions-recent', stale]])
  rig(on, {}, { store, session: 'B' })
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  await clock.advance(5000)
  // Batch J4 (UCR-123, two-step clear): found droppable, A waits; a note SESSION_DROP_CONFIRM_MS later that still finds it old clears it.
  expect(store.get('agents:A')).toEqual([{ id: 'x' }])
  for (let i = 0; i < 150; i += 1) {
    await clock.advance(10_000)
  }
  expect(store.get('agents:A')).toBeNull()
})
}
