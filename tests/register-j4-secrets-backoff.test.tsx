// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// Secrets in a step, claim or name (124, 134), the
// Orchestrator call count (125), match retries (126), no-pick matches (131), the book prune (127),
// store write backoff (128), the cut high-water mark and the base cap (129), a clock set back (130),
// a throw that may be the items' fault (074), and the two-step clear of dropped sessions (123).
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
type Ctx = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
const T = { timeoutMs: 300_000 } as never
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const PROGRESS = 'mcp__claudeopticon__report_progress'

const open = async ($: Ctx) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}
const turn = ($: Ctx, agentId: string, n: number) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, agentId } as never).catch(() => undefined)

/** A working store, a session ID and the toasts. */
function storeOn(on: On, store: Map<string, unknown>, session = 'sess-1') {
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: session }) as never)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })

  return toasts
}

/** One todo file with `todo`, and an agent list of `listed`. */
function boardOn(on: On, todo: string, listed: () => unknown[]) {
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: todo }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: listed() }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
}

/** A git repo at /repo whose files are `files` by absolute path; a file in `unreadable` fails to read. */
function repoOn(on: On, files: Record<string, string>, unreadable: Set<string> = new Set()) {
  const R = '/repo'
  let stamp = 2
  const inside = (p: string) => p === R || p.startsWith(`${R}/`)
  const at = (p: string) => (inside(p) ? p : !p.includes('.claude_todo') && !p.includes('.git') ? R : p.endsWith('.claude_todo') ? `${R}/.claude_todo` : `${R}/.claude_todo/${p.split('/').pop()}`)
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }

    return argv[1] === 'rev-parse' ? out(`${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : Object.keys(files).map(p => p.slice(R.length + 1)).join('\0'))
  })
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.git') || at(e.path) in files || Object.keys(files).some(one => one.startsWith(`${at(e.path)}/`)) }))
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/home/a')) {
      throw new Error('ENOENT')
    }

    return { value: { kind: at(e.path) in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: at(e.path) } } as never
  })
  on('fs.list', (_$, e) => {
    const dir = at(e.path)

    return { value: Object.keys(files).filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map(p => ({ name: p.slice(dir.length + 1), kind: 'file', size: 1, mtimeMs: stamp, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    if (unreadable.has(at(e.path))) {
      throw new Error('EIO read')
    }

    return { value: files[at(e.path)] ?? '' }
  })
  on('fs.write', (_$, e) => {
    files[at(e.path)] = e.text as string
    stamp += 1

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as never)

  return { touch: () => (stamp += 1) }
}

const numbers = (prompt: string) => [...prompt.matchAll(/^(\d+)\. /gm)].map(match => match[1]!)
const sortAll = (prompt: string) => ({ value: { isAnswered: true, text: JSON.stringify({ categories: ['Work'], assign: Object.fromEntries(numbers(prompt).map(n => [n, 'Work'])) }), usage: USAGE } })
const BOOK = '/repo/.claude_todo/categories.json'
const bookItems = (files: Record<string, string>) => (files[BOOK] === undefined ? {} : (JSON.parse(files[BOOK]!) as { items: Record<string, string> }).items)

// ---------------------------------------------------------------- 

const SECRET_STEP = 'export DB_PASSWORD=Hunter2xyz'
const SECRET_CLAIM = 'psql postgres://admin:Hunter2xyz@db/x #T0037'
const SECRET_NAME = 'PGPASSWORD=Hunter2xyz'

/**
 * Property: an agent's step, claims and name are never drawn or stored with a
 * secret, by any path that sets them. Three states: the first report holds it (and the list gives
 * the name), a clean report comes first and a later one holds it (the update path), and a row stored
 * by an older version holds all three (the load path).
 */
for (const [label, reports, stored] of [
  ['in the first report', [{ step: SECRET_STEP, items: [SECRET_CLAIM] }], undefined],
  ['in a later report after a clean one', [{ step: 'Run tests', items: ['#T0037'] }, { step: SECRET_STEP, items: [SECRET_CLAIM] }], undefined],
  ['in a row stored by an older version', [], [{ id: 'a1', description: 'Deploy', type: 'engineer', status: 'running', startedAt: 0, toolCalls: 0, brief: 'deploy #t0037', name: SECRET_NAME, progress: { done: 1, total: 3, step: SECRET_STEP }, claims: [SECRET_CLAIM] }]],
] as const) {
  test(`a step, claim or name with a secret shows nowhere: ${label}`, async ($, on) => {
    const clock = mock.clock(on)
    const store = new Map<string, unknown>(stored === undefined ? [] : [['agents:sess-1', stored]])
    const toasts = storeOn(on, store)
    boardOn(on, '- [~] #T0037 Ship the parser', () => [{ id: 'a1', type: 'engineer', description: 'Deploy', status: 'running', ...(stored === undefined ? { name: SECRET_NAME } : {}) }])
    const ui = await open($)
    if (stored === undefined) {
      await $.agent.spawn({ prompt: 'Work on #T0037', description: 'Deploy', subagentType: 'engineer' } as never)
    }
    for (const report of reports) {
      await $.tool.call({ tool: PROGRESS, agentId: 'a1', done: 1, total: 3, ...report } as never)
      await clock.advance(6000)
    }
    await turn($, 'a1', 1)
    await clock.advance(6000)
    const term = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
    const seen = [JSON.stringify(await ui.findAll({ type: 'Svg' })), JSON.stringify(await term.drawn()), JSON.stringify([...store.values()]), toasts.join('\n')].join('\n')
    expect(seen).not.toMatch(/hunter2/i)
    const row = (store.get('agents:sess-1') as { claims?: string[]; progress?: { step?: string } }[])[0]!
    // The claim keeps its ticket ID, so the link still forms.
    expect(row.claims).toEqual(['(hidden) #T0037'])
    expect(row.progress?.step).toBe('(hidden)')
  })
}

// ---------------------------------------------------------------- 

/** Property: the Orchestrator card and its pager count every call of the session, not only the 1000 kept. */
test('after 1200 main-conversation calls the card says 1200 tool calls and the pager of 1200', T, async ($, on) => {
  mock.clock(on)
  storeOn(on, new Map())
  boardOn(on, '- [~] #T0026 Ship the parser', () => [])
  on('tool.call', () => ({ result: 'ok' }) as never)
  const ui = await open($)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T0026'] } as never)
  for (let i = 0; i < 1200; i += 1) {
    await $.tool.call({ tool: 'Bash', command: 'ls', description: `call ${i}` } as never)
  }
  const svg = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(svg).toMatch(/1,?200 tool calls/)
  expect(svg).not.toMatch(/\b1,?000 tool calls/)
  expect(JSON.stringify(await ui.drawn())).toMatch(/Newest 5 of 1,?200/)
})

// ---------------------------------------------------------------- 

/** A model whose match calls answer `reply(call)`: 'throw' throws, 'unanswered' is not answered, else the reply text. */
function matchModel(on: On, reply: (call: number) => string) {
  let calls = 0
  on('model.complete', (_$, e) => {
    if (!e.prompt.startsWith('An agent was started')) {
      return { value: { isAnswered: true, text: '{}', usage: USAGE } } as never
    }
    calls += 1
    const out = reply(calls)
    if (out === 'throw') {
      throw new Error('overloaded')
    }

    return { value: out === 'unanswered' ? { isAnswered: false, reason: 'api-error', text: '' } : { isAnswered: true, text: out, usage: USAGE } } as never
  })

  return () => calls
}

/**
 * Property: a match call that throws or is not answered is tried again after a wait, at
 * most 3 times, then one toast says so. Three states: one throw then an answer (linked on the second
 * call, not before the 30 s wait), one unanswered reply then an answer, and a model that always
 * throws (3 calls, one toast, none after).
 */
for (const [label, reply, calls, isLinked, toastCount] of [
  ['a throw, then an answer', (n: number) => (n === 1 ? 'throw' : '{"items": [1]}'), 2, true, 0],
  ['an unanswered reply, then an answer', (n: number) => (n === 1 ? 'unanswered' : '{"items": [1]}'), 2, true, 0],
  ['a model that always throws', () => 'throw', 3, false, 1],
] as const) {
  test(`a failed match is retried with a wait, at most 3 times: ${label}`, T, async ($, on) => {
    const clock = mock.clock(on)
    const store = new Map<string, unknown>()
    const toasts = storeOn(on, store)
    boardOn(on, '- [ ] Rewrite the lexer for speed', () => [{ id: 'a1', type: 'engineer', description: 'Speed work', status: 'running' }])
    const count = matchModel(on, reply)
    await open($)
    await $.agent.spawn({ prompt: 'Make it faster', description: 'Speed work', subagentType: 'engineer' } as never)
    await clock.advance(6000)
    await turn($, 'a1', 0)
    // At the limit: inside the first 30 s wait there is no second call.
    expect(count()).toBe(1)
    for (let i = 1; i <= 60; i += 1) {
      await clock.advance(6000)
      await turn($, 'a1', i)
    }
    expect(count()).toBe(calls)
    const row = (store.get('agents:sess-1') as { autoClaims?: string[] }[])[0]!
    expect(row.autoClaims).toEqual(isLinked ? ['Rewrite the lexer for speed'] : undefined)
    expect(toasts.filter(one => one.includes('Could not match')).length).toBe(toastCount)
  })
}

/** Property: a match answered with no pick is stored as no pick, so a reload never runs it again. */
test('a no-pick match stores autoClaims [], so the stored row marks the agent matched', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  storeOn(on, store)
  boardOn(on, '- [ ] Rewrite the lexer for speed', () => [{ id: 'a1', type: 'engineer', description: 'Docs', status: 'running' }])
  const count = matchModel(on, () => '{"items": []}')
  await open($)
  await $.agent.spawn({ prompt: 'Write docs', description: 'Docs', subagentType: 'engineer' } as never)
  await clock.advance(6000)
  expect(count()).toBe(1)
  expect((store.get('agents:sess-1') as { autoClaims?: string[] }[])[0]!.autoClaims).toEqual([])
})

/** The load half of a stored row with autoClaims [] (what a no-pick match now stores) makes no match call after a reload. */
test('a stored no-pick row makes no match call after a reload', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>([['agents:sess-1', [{ id: 'a1', description: 'Docs', type: 'engineer', status: 'running', startedAt: 0, toolCalls: 0, brief: 'write docs', autoClaims: [] }]]])
  storeOn(on, store)
  boardOn(on, '- [ ] Rewrite the lexer for speed', () => [{ id: 'a1', type: 'engineer', description: 'Docs', status: 'running' }])
  const count = matchModel(on, () => '{"items": []}')
  await open($)
  await turn($, 'a1', 0)
  await clock.advance(6000)
  expect(count()).toBe(0)
})

// ---------------------------------------------------------------- 

/**
 * Property: a book write drops the item of a ticket deleted from every file, and drops
 * nothing a file that did not read could hold. Three states: the ticket is deleted (dropped), the
 * ticket moves to the archive (kept: an archived file that read), and the ticket moves to a file
 * that does not read (kept: the prune is skipped).
 */
for (const [label, move, isKept] of [
  ['deleted from every file', 'delete', false],
  ['moved to an archive file that reads', 'archive', true],
  ['moved to a file that does not read', 'unread', true],
] as const) {
  test(`a sorted ticket ${label} is ${isKept ? 'kept in' : 'dropped from'} categories.json by the next write`, T, async ($, on) => {
    const clock = mock.clock(on)
    storeOn(on, new Map())
    const OPEN = '/repo/.claude_todo/OPEN.md'
    const files: Record<string, string> = { [OPEN]: '- [ ] private salary review for Bob' }
    const unreadable = new Set<string>()
    const { touch } = repoOn(on, files, unreadable)
    on('model.complete', (_$, e) => sortAll(e.prompt) as never)
    await open($)
    for (let i = 0; i < 40 && files[BOOK] === undefined; i += 1) {
      await clock.advance(5000)
    }
    expect(bookItems(files)['private salary review for bob']).toBe('Work')
    files[OPEN] = '- [ ] ship the release'
    if (move === 'archive') {
      files['/repo/.claude_todo/archive/OPEN.md'] = '- [x] private salary review for Bob'
    } else if (move === 'unread') {
      files['/repo/.claude_todo/OTHER.md'] = '- [ ] private salary review for Bob'
      unreadable.add('/repo/.claude_todo/OTHER.md')
    }
    touch()
    // The new ticket gets an ID from the numbering, so its key is the ID.
    const isNewSorted = () => Object.keys(bookItems(files)).some(key => key !== 'private salary review for bob')
    for (let i = 0; i < 40 && !isNewSorted(); i += 1) {
      await clock.advance(5000)
    }
    // The new ticket was sorted, so the book was written again.
    expect(isNewSorted()).toBe(true)
    expect(bookItems(files)['private salary review for bob']).toBe(isKept ? 'Work' : undefined)
  })
}

// ---------------------------------------------------------------- 

/**
 * Property: a store that rejects every write gets each key again only after a wait that
 * doubles from 1 s, and one toast says nothing is kept. States: 200 calls with no time passing make
 * at most one write per key (not 5 per redraw), the wait doubles, and the toast is shown once only.
 */
test('a store that rejects every write backs off per key and toasts once', T, async ($, on) => {
  const clock = mock.clock(on)
  const sets: string[] = []
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', (_$, e) => {
    sets.push(e.key)
    throw new Error('EIO')
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  await open($)
  const before = sets.filter(key => key.startsWith('series:')).length
  for (let i = 0; i < 200; i += 1) {
    await $.tool.call({ tool: 'Bash', command: 'ls', description: `call ${i}` } as never)
  }
  // The old code wrote 5 keys per redraw: 1000 writes. Now each key waits for its retry time.
  expect(sets.filter(key => key.startsWith('series:')).length - before).toBeLessThanOrEqual(1)
  for (let i = 0; i < 600; i += 1) {
    await clock.advance(1000)
    await $.tool.call({ tool: 'Bash', command: 'ls', description: `later ${i}` } as never)
  }
  // 10 min of a redraw every second: waits of 1, 2, 4 ... 256 s give about 10 tries per key, not 600.
  const series = sets.filter(key => key.startsWith('series:')).length
  expect(series).toBeGreaterThan(5)
  expect(series).toBeLessThan(15)
  expect(toasts.filter(one => one.includes('cannot save to the store')).length).toBe(1)
})

// ---------------------------------------------------------------- 

/** The rows the store holds after each of `refreshes` refreshes of a list of `listed`, and the base. */
async function refreshRows($: Ctx, on: On, listed: { id: string; description: string; type: string; status: string }[], refreshes: number, store = new Map<string, unknown>()) {
  let now = 1_000_000
  on('clock.now', () => ({ value: now }) as never)
  on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
  const toasts = storeOn(on, store)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: listed }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await open($)
  const seen: { ids: string; base: unknown }[] = []
  for (let i = 0; i < refreshes; i += 1) {
    now += 6000
    await turn($, 'g0', i)
    await new Promise(resolve => setTimeout(resolve, 20))
    seen.push({ ids: ((store.get('agents:sess-1') as { id: string }[] | undefined) ?? []).map(row => row.id).join(','), base: store.get('agents-base:sess-1') })
  }

  return { seen, toasts }
}

const ended = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `g${from + i}`, description: `job ${from + i}`, type: 'engineer', status: 'completed' }))

/**
 * Property: past KEPT_AGENTS + KEPT_CUT ended agents, the rows and the base stay the same
 * from refresh to refresh. Three states: 5300 ended agents (100 past the cap), exactly 5200 (the
 * limit), and a live agent among the forgotten ones, which still comes back (the excluded population).
 */
for (const [label, listed, live] of [
  ['5300 ended agents', ended(5300), undefined],
  ['5200 ended agents, the limit', ended(5200), undefined],
  ['5300 agents, one live among the oldest', ended(5300).map(one => (one.id === 'g5' ? { ...one, status: 'running' } : one)), 'g5'],
] as const) {
  test(`the rows and base do not churn: ${label}`, T, async ($, on) => {
    const { seen } = await refreshRows($, on, [...listed], 5)
    // After the first refresh settles (a live agent takes one place), every refresh keeps the same rows and base.
    const settled = seen.slice(live === undefined ? 0 : 1)
    expect(new Set(settled.map(one => one.ids)).size).toBe(1)
    expect(new Set(settled.map(one => one.base)).size).toBe(1)
    expect(settled[0]!.ids.split(',').length).toBe(200)
    if (live !== undefined) {
      expect(settled[0]!.ids.split(',')).toContain(live)
    }
  })
}

/** Property: the label base never passes MAX_BASE, so a reload never resets it to 0, and one toast says so. */
test('the label base stops at MAX_BASE with one toast', T, async ($, on) => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, description: `r ${i}`, type: 'engineer', status: 'completed', startedAt: 0, toolCalls: 0, brief: `r ${i}` }))
  const store = new Map<string, unknown>([['agents:sess-1', rows], ['agents-base:sess-1', 998_950]])
  const listed = [...rows.map(({ id, description, type, status }) => ({ id, description, type, status })), ...ended(100, 9000)]
  const { seen, toasts } = await refreshRows($, on, listed, 3, store)
  expect(seen[seen.length - 1]!.base).toBe(999_000)
  expect(toasts.filter(one => one.includes('Agent labels reached A999000')).length).toBe(1)
})

// ---------------------------------------------------------------- 

/** Property: after the clock goes back 2 h, the session notes itself again within SESSION_TOUCH_MS, not after 2 h. */
test('a clock set back 2 h does not stop the session notes', T, async ($, on) => {
  let now = 10_000_000_000
  on('clock.now', () => ({ value: now }) as never)
  on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
  const store = new Map<string, unknown>()
  storeOn(on, store)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Long', type: 'engineer', status: 'running' }] }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  const mine = () => (store.get('sessions-recent') as [string, number][]).find(([id]) => id === 'sess-1')?.[1]
  const t0 = mine()!
  now -= 2 * 3_600_000
  let noteAt: number | undefined
  for (let minute = 1; minute <= 30 && noteAt === undefined; minute += 1) {
    now += 60_000
    await turn($, 'a1', minute)
    await new Promise(resolve => setTimeout(resolve, 2))
    if (mine() !== t0) {
      noteAt = minute
    }
  }
  // The old code noted again at minute 130; now at the first save 10 min after the set-back.
  expect(noteAt).toBeDefined()
  expect(noteAt!).toBeLessThanOrEqual(11)
})

/** Property: after the clock goes back 2 h, the claim check of report_progress still comes 10 min later. */
test('a clock set back 2 h does not stop the claim check', async ($, on) => {
  let now = 10_000_000_000
  on('clock.now', () => ({ value: now }) as never)
  on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
  storeOn(on, new Map())
  boardOn(on, '- [~] #T0037 Ship the parser', () => [{ id: 'a1', type: 'engineer', description: 'Work', status: 'running' }])
  await open($)
  await turn($, 'a1', 0)
  const report = async (input: Record<string, unknown>) => ((await $.tool.call({ tool: PROGRESS, agentId: 'a1', done: 1, total: 3, ...input } as never)) as { result?: string }).result ?? ''
  expect(await report({ items: ['#T0037'] })).toBe('Noted.')
  now -= 2 * 3_600_000
  expect(await report({})).toBe('Noted.')
  now += 9 * 60_000
  expect(await report({})).toBe('Noted.')
  now += 60_000
  expect(await report({})).toContain('You said you handle')
})

// ---------------------------------------------------------------- (J4)

/**
 * Property: a batch whose call fails in a way that may be the items' fault is halved after
 * the second such failure, so the queue moves past the poison item and every good item is sorted.
 * Three states: the call throws (verify-HI P074-2), the engine answers an HTTP 400 api-error, and
 * (the excluded population) a transport failure with no status, which only waits: the batch stays 60.
 */
for (const [label, fail, isHalved] of [
  ['the call throws', 'throw', true],
  ['the engine answers HTTP 400', 400, true],
  ['a transport failure with no status', null, false],
] as const) {
  test(`a poison batch where ${label} ${isHalved ? 'is halved after two failures: the 60 good items are sorted' : 'only waits: the batch stays 60'}`, T, async ($, on) => {
    const clock = mock.clock(on)
    storeOn(on, new Map())
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': Array.from({ length: 61 }, (_, i) => `- [ ] #T${i + 1} ${i === 0 ? 'poison item' : `item ${i + 1}`}`).join('\n') }
    repoOn(on, files)
    const sizes: number[] = []
    on('model.complete', (_$, e) => {
      sizes.push(numbers(e.prompt).length)
      if (!e.prompt.includes('poison item')) {
        return sortAll(e.prompt) as never
      }
      if (fail === 'throw') {
        throw new Error('HTTP 400 invalid request')
      }

      return { value: { isAnswered: false, reason: 'api-error', status: fail, error: fail === null ? 'network' : 'invalid_request', usage: USAGE } } as never
    })
    await open($)
    for (let i = 0; i < 8640 && (isHalved ? Object.keys(bookItems(files)).length < 60 : sizes.length < 6); i += 1) {
      await clock.advance(10_000)
    }
    if (isHalved) {
      expect(Object.keys(bookItems(files)).length).toBe(60)
      // The first two calls carry the same 60; the third carries half.
      expect(sizes.slice(0, 3)).toEqual([60, 60, 30])
    } else {
      expect(sizes.slice(0, 6)).toEqual([60, 60, 60, 60, 60, 60])
      expect(Object.keys(bookItems(files)).length).toBe(0)
    }
  })
}

// ---------------------------------------------------------------- (J4)

/**
 * Property: a live session whose fresh note another session overwrote (it read the list
 * before the note and wrote after it) keeps its keys: the keys are cleared only by a later note that
 * still finds it old. States: the race of verify-HI (A's fresh note in the store, B's first read
 * stale): A keeps its keys and stays listed as waiting; A notes again within SESSION_TOUCH_MS: A is
 * never cleared; a session that stays old is cleared only after SESSION_DROP_CONFIRM_MS (the I4 block).
 */
test('a session whose note was overwritten in the read-write race keeps its keys', T, async ($, on) => {
  const clock = mock.clock(on)
  await clock.advance(4 * 60 * 60_000)
  const now = 4 * 60 * 60_000
  const stale = [['A', 0], ...Array.from({ length: 25 }, (_, i) => [`s${i}`, now - 1000])]
  const fresh = [...Array.from({ length: 25 }, (_, i) => [`s${i}`, now - 1000]), ['A', now - 10]]
  class Racing extends Map<string, unknown> {
    reads = 0
    override get(key: string) {
      if (key === 'sessions-recent') {
        this.reads += 1
        if (this.reads === 1) {
          return stale
        }
      }

      return super.get(key)
    }
  }
  const store = new Racing([['agents:A', [{ id: 'x' }]], ['sessions-recent', fresh]])
  storeOn(on, store, 'B')
  repoOn(on, {})
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  await clock.advance(5000)
  expect(store.get('agents:A')).toEqual([{ id: 'x' }])
  expect((store.get('sessions-dropping') as [string, number][]).map(([id]) => id)).toContain('A')
  // A notes itself again (its next note, within SESSION_TOUCH_MS): its wait is cancelled, and B's later notes never clear it.
  const list = store.get('sessions-recent') as [string, number][]
  store.set('sessions-recent', [...list, ['A', now + 9 * 60_000]])
  for (let i = 0; i < 150; i += 1) {
    await clock.advance(10_000)
  }
  expect(store.get('agents:A')).toEqual([{ id: 'x' }])
})
}
