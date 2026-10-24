// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { readKeptTickets } from '../hooks/kept-records'

// Engine cases:on a fake repo, store and model that can fail: per-key store loads, the archive record, session pruning, cut rows, the unlisted grace, orchestrator claims, move_ticket, the scan wait and the sort.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Ctx = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Faults = { exists?: (p: string) => boolean; list?: (p: string) => boolean; read?: (p: string) => boolean; write?: (p: string) => boolean; get?: (key: string) => boolean; set?: (key: string) => boolean }
type Listed = { id: string; description: string; type: string; status: string }

/**
 * A fake repo at `/repo` with the given files by absolute path, a store, a session ID and an agent
 * list (copied from the fault block, plus faults for exists and the store, a held list, and an mtime
 * that moves on with each write, as a real disk's would).
 */
function rig(on: On, files: Record<string, string>, opts: { faults?: Faults; session?: string; store?: Map<string, unknown>; agents?: () => Listed[]; listGate?: (path: string) => Promise<void> | void; listed?: string[] } = {}) {
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
  // The session folder's own paths (relative, or outside the repo) are its `.claude_todo`, as the engine hands them over.
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

    return { value: { kind: path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: path } } as never
  })
  on('fs.list', async (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.list?.(path)) {
      fail('list')
    }
    await opts.listGate?.(path)

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
const usage = { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
/** The end of an agent's turn: a forced refresh of the agent list, which also loads the kept data. */
const turnOf = ($: Ctx, agentId: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t-${agentId}`, agentId } as never).catch(() => undefined)
const kept = (store: Map<string, unknown>, key: string) => store.get(key) as { id: string; status: string }[] | undefined

// ---------------------------------------------------------------- 

/**
 * Property: each per-session key loads and saves on its own. A key that cannot be read is never
 * written; every other key still loads and is saved, so the series survives a reload.
 * Three states: the first key read (the rows), a middle one (the title, P7's case), the last one
 * (the series itself: the excluded population, whose own save must stay blocked).
 */
for (const failing of ['agents:sess-1', 'orchestrator-title:sess-1', 'series:sess-1']) {
  test(`a failed read of ${failing} blocks only its own save; the series and the rest are stored`, async ($, on) => {
    const clock = mock.clock(on)
    const { store, sets } = rig(on, {}, {
      faults: { get: key => key === failing },
      store: new Map<string, unknown>([['series:sess-1', { agents: [[1, 2]], tokens: [[1, 500]], compacts: [] }], ['agents:sess-1', [{ id: 'old', description: 'Old', type: 'engineer', status: 'completed', startedAt: 0, toolCalls: 1, brief: 'old' }]]]),
      agents: () => [{ id: 'new', description: 'New', type: 'engineer', status: 'running' }],
    })
    on('turn.complete', () => ({ text: '' }) as never)
    // Model requests are the one source of token counts (G4), so the token point comes from a main-loop step.
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
    })
    await openPane($)
    await turnOf($, 'new')
    await clock.advance(2000)
    for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as never)) {
      // A step with no chunks: its result carries the usage.
    }
    await clock.advance(6000)
    const group = failing === 'agents:sess-1' ? ['agents:sess-1', 'agents-base:sess-1', 'agents-cut:sess-1'] : [failing]
    expect(sets.filter(key => group.includes(key))).toEqual([])
    if (failing === 'series:sess-1') {
      expect(kept(store, 'agents:sess-1')?.map(row => row.id)).toEqual(['old', 'new'])
    } else {
      const series = store.get('series:sess-1') as { tokens: [number, number][] }
      expect(series.tokens.length).toBeGreaterThan(1)
      expect(series.tokens[0]).toEqual([1, 500])
    }
    if (failing === 'agents:sess-1') {
      expect(kept(store, 'agents:sess-1')?.map(row => row.id)).toEqual(['old'])
    }
  })
}

// ---------------------------------------------------------------- and 

const DONE = '- [x] #T1 Done parser\n  note under it'
const BLOCK = ['- [x] #T1 Done parser', '  note under it']

/**
 * Property: the archive record is never written over a value that was not read; a move
 * whose record cannot be read waits. The record is per archive file now, so this checks every
 * archive-wrote key.
 */
test('an archive record that cannot be read is not written over, and the move waits until it reads', async ($, on) => {
  const clock = mock.clock(on)
  let isDown = true
  const files: Record<string, string> = { [TODO]: `${DONE}\n- [ ] #T2 Open` }
  const { sets } = rig(on, files, { faults: { get: key => isDown && key.startsWith('archive-wrote:') } })
  await openPane($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  expect(sets.filter(key => key.startsWith('archive-wrote:'))).toEqual([])
  expect(files[ARCHIVE]).toBeUndefined()
  expect(files[TODO]).toBe(`${DONE}\n- [ ] #T2 Open`)
  isDown = false
  for (let i = 0; i < 3; i += 1) {
    await clock.advance(3000)
  }
  expect(files[ARCHIVE]).toBe(`${DONE}\n`)
  expect(files[TODO]).toBe('- [ ] #T2 Open')
})

/**
 * Property: a block is added to the archive once, whatever retries the move: a new
 * session, a record that cannot be written, a record that cannot be read.
 */
test('a retry from a new session does not add the block twice', async ($, on) => {
  const clock = mock.clock(on)
  // Session A wrote its record and the archive, then stopped before it cut the source.
  const files: Record<string, string> = { [TODO]: `${DONE}\n- [ ] #T2 Open`, [ARCHIVE]: `${DONE}\n` }
  rig(on, files, { session: 'sess-b', store: new Map<string, unknown>([[RECORD, [BLOCK]]]) })
  await openPane($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  expect(files[ARCHIVE]!.split('- [x] #T1 Done parser').length - 1).toBe(1)
  expect(files[TODO]).toBe('- [ ] #T2 Open')
})

test('a record that cannot be written stops the move before the archive is written', async ($, on) => {
  const clock = mock.clock(on)
  let isDown = true
  const files: Record<string, string> = { [TODO]: `${DONE}\n- [ ] #T2 Open` }
  const { store } = rig(on, files, { faults: { set: key => isDown && key.startsWith('archive-wrote:') } })
  await openPane($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  expect(files[ARCHIVE]).toBeUndefined()
  expect(files[TODO]).toBe(`${DONE}\n- [ ] #T2 Open`)
  isDown = false
  for (let i = 0; i < 3; i += 1) {
    await clock.advance(3000)
  }
  expect(files[ARCHIVE]).toBe(`${DONE}\n`)
  expect(store.get(RECORD)).toBeNull()
})

test('a record that cannot be read stops the move, even with the archive holding the block', async ($, on) => {
  const clock = mock.clock(on)
  let isDown = true
  const files: Record<string, string> = { [TODO]: `${DONE}\n- [ ] #T2 Open`, [ARCHIVE]: `${DONE}\n` }
  rig(on, files, { faults: { get: key => isDown && key.startsWith('archive-wrote:') }, store: new Map<string, unknown>([[RECORD, [BLOCK]]]) })
  await openPane($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  expect(files[ARCHIVE]).toBe(`${DONE}\n`)
  isDown = false
  for (let i = 0; i < 3; i += 1) {
    await clock.advance(3000)
  }
  expect(files[ARCHIVE]!.split('- [x] #T1 Done parser').length - 1).toBe(1)
  expect(files[TODO]).toBe('- [ ] #T2 Open')
})

// ---------------------------------------------------------------- 

const LIVE: Listed = { id: 'a1', description: 'Long work', type: 'engineer', status: 'running' }

/**
 * Property: a session that runs notes itself in the session list again every SESSION_TOUCH_MS, and
 * one that finds itself pruned while it runs stores its keys again, so its data is never lost.
 */
test('a running session notes itself again in the session list, moving to its end', { timeoutMs: 120_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const { store } = rig(on, {}, { agents: () => [LIVE] })
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  // the time is in the list entry itself, [ID, time], not in sessions-seen.
  const recent = () => store.get('sessions-recent') as [string, number][]
  const first = recent().find(([id]) => id === 'sess-1')![1]
  // Others start after it.
  store.set('sessions-recent', [['sess-1', first], ...Array.from({ length: 5 }, (_, i): [string, number] => [`n${i}`, first])])
  for (let i = 0; i < 11 * 6; i += 1) {
    await clock.advance(10_000)
  }
  const list = recent()
  expect(list[list.length - 1]![0]).toBe('sess-1')
  expect(list[list.length - 1]![1]).toBeGreaterThan(first)
})

test('a session pruned while it runs stores its rows again', async ($, on) => {
  const clock = mock.clock(on)
  const { store } = rig(on, {}, { agents: () => [LIVE] })
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  await clock.advance(6000)
  expect(kept(store, 'agents:sess-1')?.map(row => row.id)).toEqual(['a1'])
  // Another session's start pruned this one: the list lost it and its keys are null.
  store.set('sessions-recent', Array.from({ length: 20 }, (_, i) => `n${i}`))
  store.set('agents:sess-1', null)
  store.set('agents-base:sess-1', null)
  for (let i = 0; i < 11 * 6; i += 1) {
    await clock.advance(10_000)
  }
  expect(kept(store, 'agents:sess-1')?.map(row => row.id)).toEqual(['a1'])
  expect(store.get('agents-base:sess-1')).toBe(0)
})

test('a session list that cannot be read is not written, and nothing is cleared', async ($, on) => {
  const clock = mock.clock(on)
  const old = Array.from({ length: 24 }, (_, i) => `s${i}`)
  const { store } = rig(on, {}, { agents: () => [LIVE], faults: { get: key => key === 'sessions-seen' }, store: new Map<string, unknown>([['sessions-recent', old], ['agents:s0', []]]) })
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  for (let i = 0; i < 11 * 6; i += 1) {
    await clock.advance(10_000)
  }
  expect(store.get('sessions-recent')).toEqual(old)
  expect(store.get('agents:s0')).toEqual([])
})

// ---------------------------------------------------------------- 

/**
 * Property: past KEPT_AGENTS rows, a cut row that ended stays cut: the agent list never adds it back
 * as a new row, so labels, the label base and the stored rows stay as they were from tick to tick.
 * Three states: the cut rows ended, a cut row still live in the list, and after a reload. A cut row
 * still live comes back once, in the place of an ended row (this case expected it
 * to stay cut, so its agent left the board while it worked); the base then moves on by that one row
 * and stays put as before.
 */
const many = (live: (i: number) => boolean) => Array.from({ length: 230 }, (_, i) => ({ id: `r${i}`, description: `Row ${i}`, type: 'engineer', status: live(i) ? 'running' : 'completed' }))
for (const [label, live, base] of [['the cut rows ended', (i: number) => i === 229, 30], ['a cut row is still live', (i: number) => i === 0 || i === 229, 31]] as const) {
  test(`past 200 rows, ${label}: the base and the rows stay put from tick to tick`, async ($, on) => {
    const clock = mock.clock(on)
    const listed = many(live)
    const { store } = rig(on, {}, { agents: () => listed })
    await openPane($)
    await turnOf($, 'r229')
    await clock.advance(6000)
    expect(store.get('agents-base:sess-1')).toBe(base)
    const first = kept(store, 'agents:sess-1')![0]!.id
    for (let i = 0; i < 10; i += 1) {
      await clock.advance(1000)
    }
    await clock.advance(6000)
    expect(store.get('agents-base:sess-1')).toBe(base)
    expect(kept(store, 'agents:sess-1')![0]!.id).toBe(first)
    expect(kept(store, 'agents:sess-1')!.length).toBe(200)
    expect(kept(store, 'agents:sess-1')!.some(row => row.id === 'r0')).toBe(base === 31)
  })
}

test('after a reload, the rows cut before it are not added back', async ($, on) => {
  const clock = mock.clock(on)
  const listed = many(i => i === 229)
  const rows = listed.slice(30).map(one => ({ ...one, startedAt: 0, toolCalls: 4, brief: one.description.toLowerCase() }))
  const { store } = rig(on, {}, {
    agents: () => listed,
    store: new Map<string, unknown>([['agents:sess-1', rows], ['agents-base:sess-1', 30], ['agents-cut:sess-1', listed.slice(0, 30).map(one => one.id)]]),
  })
  await openPane($)
  await turnOf($, 'r229')
  for (let i = 0; i < 8; i += 1) {
    await clock.advance(1000)
  }
  expect(store.get('agents-base:sess-1')).toBe(30)
  expect(kept(store, 'agents:sess-1')![0]!.id).toBe('r30')
  expect((kept(store, 'agents:sess-1')![0] as unknown as { toolCalls: number }).toolCalls).toBe(4)
})

// ---------------------------------------------------------------- 

test('a stored base out of range draws A1, and a repeated stored row ID is one row', async ($, on) => {
  mock.clock(on)
  const row = { id: 'a1', description: 'Parser work', type: 'engineer', status: 'running', startedAt: 0, toolCalls: 1, brief: 'parser' }
  const { store } = rig(on, {}, { agents: () => [{ ...LIVE, description: 'Parser work' }], store: new Map<string, unknown>([['agents:sess-1', [row, { ...row, toolCalls: 9 }]], ['agents-base:sess-1', 1e300]]) })
  const ui = await openPane($)
  await turnOf($, 'a1')
  const drawn = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(drawn).not.toContain('e+300')
  expect(drawn).toContain('A1, Parser work')
  expect(kept(store, 'agents:sess-1')?.map(one => one.id)).toEqual(['a1'])
})

// ---------------------------------------------------------------- 

/**
 * Property: a live agent that leaves the engine's list ends UNLISTED_MS after it left, not
 * UNLISTED_MS after it started.
 */
test('an agent that ran for ten minutes and drops from the list is not ended at the first refresh', async ($, on) => {
  const clock = mock.clock(on)
  let isListed = true
  const { store } = rig(on, {}, { agents: () => (isListed ? [LIVE] : []) })
  await openPane($)
  await turnOf($, 'a1')
  for (let i = 0; i < 60; i += 1) {
    await clock.advance(10_000)
  }
  isListed = false
  await clock.advance(2000)
  await clock.advance(6000)
  expect(kept(store, 'agents:sess-1')?.[0]?.status).toBe('running')
  for (let i = 0; i < 20; i += 1) {
    await clock.advance(1000)
  }
  expect(kept(store, 'agents:sess-1')?.[0]?.status).toBe('ended')
})

// ---------------------------------------------------------------- 

/**
 * Property: an edit by the main conversation claims only the tickets that edit set in progress;
 * a ticket a helper set in progress just before, still unseen by any scan, is not claimed.
 * Three states: the helper's ticket on the first line, on the last line, and a Write in place of an Edit.
 */
for (const [label, helperLine, tool] of [['first line', 0, 'Edit'], ['last line', 2, 'Edit'], ['a Write', 0, 'Write']] as const) {
  test(`a helper's in-progress ticket on the ${label} is not claimed by the main edit after it (${tool})`, async ($, on) => {
    const clock = mock.clock(on)
    const lines = ['- [ ] #T1 Ship the parser', '- [ ] #T2 Review the copy', '- [ ] #T3 Check the invoice']
    const files: Record<string, string> = { [TODO]: lines.join('\n') }
    const { store, bump } = rig(on, files)
    let pending: string | undefined
    on('tool.call', { tool }, () => {
      if (pending !== undefined) {
        files[TODO] = pending
        bump(TODO)
        pending = undefined
      }

      return { result: {} } as never
    })
    await openPane($)
    await turnOf($, 'h1')
    await clock.advance(3000)
    // The helper's Bash edit: no file path in the call, so no scan sees it.
    const helper = [...lines]
    helper[helperLine] = helper[helperLine]!.replace('[ ]', '[~]')
    files[TODO] = helper.join('\n')
    bump(TODO)
    // Within the 3 s scan, the main conversation sets #T2 in progress.
    pending = helper.map((line, i) => (i === 1 ? line.replace('[ ]', '[~]') : line)).join('\n')
    await $.tool.call({ tool, file_path: TODO } as never)
    await clock.advance(6000)
    expect(readKeptTickets(store.get('orchestrator:sess-1')).map(([key]) => key)).toEqual(['#t2'])
  })
}

// ---------------------------------------------------------------- 

/**
 * Property: a folder that cannot be listed, or whose check fails, is not empty: its files stay as
 * last read and the orchestrator's claims on their tickets stay, while another folder still reads.
 * Three states: the list fails, the exists check fails, and (the population the fix excludes) the
 * ticket is really gone, which still ends the claim.
 */
const OTHER = '/repo/mods/x/.claude_todo'
for (const [label, faults, gone] of [
  ['the folder list fails', { list: (p: string) => p === OTHER }, false],
  ['the folder check fails', { exists: (p: string) => p === OTHER }, false],
  ['the ticket is gone', {}, true],
] as const) {
  test(`${label}: the claim ${gone ? 'ends' : 'stays'}`, async ($, on) => {
    const clock = mock.clock(on)
    let isFaulty = false
    const files: Record<string, string> = { [TODO]: '- [ ] #T2 Other', [`${OTHER}/TODO.md`]: '- [~] #T1 Ship the parser' }
    const f = faults as Faults
    const { store, bump } = rig(on, files, { listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'], faults: { list: p => isFaulty && (f.list?.(p) ?? false), exists: p => isFaulty && (f.exists?.(p) ?? false) } })
    await openPane($)
    await turnOf($, 'h1')
    await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 0, total: 1, items: ['#T1'] } as never)
    await clock.advance(6000)
    const claims = () => readKeptTickets(store.get('orchestrator:sess-1')).map(([key]) => key)
    expect(claims().length).toBe(1)
    isFaulty = true
    if (gone) {
      files[`${OTHER}/TODO.md`] = '- [ ] #T3 Else'
      bump(`${OTHER}/TODO.md`)
    }
    for (let i = 0; i < 4; i += 1) {
      await clock.advance(3000)
    }
    expect(claims().length).toBe(gone ? 0 : 1)
  })
}

// ---------------------------------------------------------------- 

/**
 * Property: move_ticket says it could not read when a folder or file did not read, never that no
 * item matches; and a failed write after the approval is an answer, not a tool error.
 * Three states: the folder list fails, the file never read since the load, the write fails.
 */
for (const [label, faults] of [
  ['the folder list fails', { list: (p: string) => p === '/repo/.claude_todo' }],
  ['the file never read', { read: (p: string) => p === TODO }],
] as const) {
  test(`move_ticket when ${label} says it could not read, not "no match"`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { [TODO]: '- [ ] #T1 Fix the parser' }
    rig(on, files, { faults: faults as Faults })
    await openPane($)
    const out = JSON.stringify(await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'done', reason: 'r' } as never))
    expect(out).toContain('could not read')
    expect(out).not.toContain('no live todo item matches')
    expect(files[TODO]).toBe('- [ ] #T1 Fix the parser')
  })
}

test('move_ticket whose approved write fails answers that the write failed', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [ ] #T1 Fix the parser' }
  rig(on, files, { faults: { write: p => p === TODO } })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question

    return { result: { questions: [], answers: { [question]: 'Move it' } } } as never
  })
  await openPane($)
  const ran = (await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'done', reason: 'r' } as never)) as { result?: unknown; isError?: boolean }
  expect(typeof ran.result).toBe('string')
  expect(String(ran.result)).toContain('could not be written (')
  expect(files[TODO]).toBe('- [ ] #T1 Fix the parser')
})

// ---------------------------------------------------------------- 

/**
 * Property: a caller of the scan waits for the pass in flight and one more at most, never for the
 * follow-up passes other callers ask for after it.
 */
test('move_ticket returns after the pass in flight and one more, while other scans keep asking', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [x] #T1 Fix the parser' }
  let isGated = false
  const gates: (() => void)[] = []
  rig(on, files, { listGate: path => (isGated && path === '/repo/.claude_todo' ? new Promise<void>(resolve => gates.push(resolve)) : undefined) })
  on('tool.call', { tool: 'Read' }, () => ({ result: {} }) as never)
  await openPane($)
  await clock.advance(1000)
  isGated = true
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))
  const open = () => gates.splice(0).forEach(resolve => resolve())
  // A helper's read of the todo file starts a pass, which waits on the list.
  void $.tool.call({ tool: 'Read', file_path: TODO, agentId: 'h1' } as never)
  await settle()
  let isDone = false
  // move_ticket to the box the ticket has: it needs only a fresh board.
  void $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'done', reason: 'r' } as never).then(() => {
    isDone = true
  })
  await settle()
  // More reads keep asking for passes while each pass runs: one ask before each held list call is let go.
  // A pass lists the folder a few times (the scan, the duplicate check, numbering), so 12 steps cover
  // the pass in flight and the next one, while the asks never stop.
  let opened = 0
  for (let step = 0; step < 12; step += 1) {
    void $.tool.call({ tool: 'Read', file_path: TODO, agentId: 'h1' } as never)
    await settle()
    opened += gates.length
    open()
    await settle()
  }
  expect(opened).toBeGreaterThan(2)
  expect(isDone).toBe(true)
  isGated = false
  for (let i = 0; i < 5; i += 1) {
    open()
    await settle()
  }
})

// ---------------------------------------------------------------- and 

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

/**
 * Property: a reply that does not parse is the model's failure: it backs off and counts
 * against no item, so a later readable reply sorts every item. Three states: no braces, braces with
 * bad JSON, and (the population the fix excludes) a reply that parses but leaves the items out,
 * which still counts against them and stops after two tries.
 */
for (const [label, bad, isCounted] of [['no braces', 'not json at all', false], ['braces with bad JSON', '{"categories": [', false], ['parses but leaves them out', '{"categories": ["Code"], "assign": {}}', true]] as const) {
  test(`a reply that ${label}: ${isCounted ? 'counts against the items' : 'backs off and the items are sorted later'}`, { timeoutMs: 120_000 }, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [TODO]: '- [ ] #T1 good one\n- [ ] #T2 other one' }
    rig(on, files)
    let isReadable = false
    const prompts = fakeModel(on, prompt => (isReadable ? assignAll('Code')(prompt) : bad))
    await openPane($)
    // Changed by (I4): an item that fails alone SORT_TRIES times is given up for the session, so the unreadable phase of a model that
    // recovers is 200 s (three calls, each item alone at most once). A longer one is the poison-item case, tested in the I4 block.
    for (let i = 0; i < (isCounted ? 100 : 20); i += 1) {
      await clock.advance(10_000)
    }
    const tries = prompts.length
    expect(tries).toBeGreaterThan(isCounted ? 1 : 2)
    if (isCounted) {
      expect(tries).toBe(2)
    }
    isReadable = true
    for (let i = 0; i < 200; i += 1) {
      await clock.advance(10_000)
    }
    const items = files[BOOK] === undefined ? {} : (JSON.parse(files[BOOK]!) as { items: Record<string, string> }).items
    expect(Object.keys(items).length).toBe(isCounted ? 0 : 2)
  })
}

/**
 * Property: Recategorize past the tickets it covers keeps the saved category of the
 * others. Three states: the first ticket past the cover, the last ticket, and (excluded) a ticket
 * whose old category the fresh sort no longer has, which is left for the normal sort.
 */
test('Recategorize over 310 tickets keeps the saved categories of the tickets past 300', async ($, on) => {
  const clock = mock.clock(on)
  const ids = Array.from({ length: 310 }, (_, i) => `t${String(i + 1).padStart(4, '0')}`)
  const items: Record<string, string> = Object.fromEntries(ids.map((id, i) => [`#${id}`, i === 309 ? 'Gone' : 'Old']))
  const files: Record<string, string> = {
    [TODO]: ids.map(id => `- [ ] #${id.toUpperCase()} item ${id}`).join('\n'),
    [BOOK]: JSON.stringify({ categories: ['Old', 'Gone'], items }),
  }
  rig(on, files)
  // The fresh sort: half the covered tickets stay Old, half go to New.
  fakeModel(on, prompt => JSON.stringify({ categories: ['Old', 'New'], assign: Object.fromEntries(numbers(prompt).map(n => [n, Number(n) % 2 === 0 ? 'New' : 'Old'])) }))
  const ui = await openPane($)
  await clock.advance(3000)
  await ui.press({ key: 'todo-recategorize' })
  await clock.advance(1000)
  const book = JSON.parse(files[BOOK]!) as { categories: string[]; items: Record<string, string> }
  expect(book.categories).toEqual(['Old', 'New'])
  expect(book.items['#t0301']).toBe('Old')
  expect(book.items['#t0309']).toBe('Old')
  expect(book.items['#t0310']).not.toBe('Gone')
  expect(Object.values(book.items).filter(name => name === 'New').length).toBe(150)
})
}
