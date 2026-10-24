// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { readKeptTickets } from '../hooks/kept-records'

// Engine cases:the sort queue past a poison item, Recategorize
// past 300, a failed rollback, the archive record by real path, claims and unread folders, a
// move_ticket whose scan throws, a failed session note, and the label base.
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

// ---------------------------------------------------------------- regression

/**
 * Property: one item whose reply never parses, or a reply cut off at the token limit,
 * never stops the sort of the items behind it. Three states: the poison item first (
 * V074, behind nothing), the poison item last (the end of the queue), and a reply that is cut off
 * whenever a call carries more than 8 items (no item at fault: the excluded population, which the
 * halving sorts whole). A reply that fails once and then parses counts against nothing: the 
 * cases of the G3 block.
 */
for (const [label, lines, isBad, sorted] of [
  ['the poison item is first', 61, (prompt: string) => prompt.includes('poison item'), 60],
  ['the poison item is last', 61, (prompt: string) => prompt.includes('poison item'), 60],
  ['every reply to more than 8 items is cut off', 40, (prompt: string) => numbers(prompt).length > 8, 40],
] as const) {
  test(`${label}: the queue moves past it and the other items are sorted`, { timeoutMs: 120_000 }, async ($, on) => {
    const clock = mock.clock(on)
    const poisonAt = label.endsWith('last') ? lines - 1 : 0
    const text = Array.from({ length: lines }, (_, i) => `- [ ] #T${i + 1} ${i === poisonAt && sorted < lines ? 'poison item' : `item ${i + 1}`}`)
    const files: Record<string, string> = { [TODO]: text.join('\n') }
    rig(on, files)
    const prompts = fakeModel(on, prompt => (isBad(prompt) ? `${assignAll('Code')(prompt).slice(0, 30)}` : assignAll('Code')(prompt)))
    await openPane($)
    for (let i = 0; i < 1000; i += 1) {
      await clock.advance(10_000)
    }
    const items = bookItems(files)
    expect(Object.keys(items).length).toBe(sorted)
    expect(Object.keys(items).some(key => key === `#t${poisonAt + 1}`)).toBe(sorted === lines)
    // Bounded: the backoff still holds, so the model is not called in a loop.
    expect(prompts.length).toBeLessThan(40)
  })
}

// ---------------------------------------------------------------- regression

/** Property: a category that the fresh sort names and only tickets past 300 hold is kept, with their assignments (the V075). */
test('Recategorize keeps a category the model names, held only by tickets past 300', async ($, on) => {
  const clock = mock.clock(on)
  const ids = Array.from({ length: 310 }, (_, i) => `t${String(i + 1).padStart(4, '0')}`)
  const items: Record<string, string> = Object.fromEntries(ids.map((id, i) => [`#${id}`, i >= 300 ? 'Late' : 'Old']))
  const files: Record<string, string> = {
    [TODO]: ids.map(id => `- [ ] #${id.toUpperCase()} item ${id}`).join('\n'),
    [BOOK]: JSON.stringify({ categories: ['Old', 'Late'], items }),
  }
  rig(on, files)
  fakeModel(on, prompt => JSON.stringify({ categories: ['Old', 'New', 'Late'], assign: Object.fromEntries(numbers(prompt).map(n => [n, Number(n) % 2 === 0 ? 'New' : 'Old'])) }))
  const ui = await openPane($)
  await clock.advance(3000)
  await ui.press({ key: 'todo-recategorize' })
  await clock.advance(1000)
  const book = JSON.parse(files[BOOK]!) as { categories: string[]; items: Record<string, string> }
  expect(book.categories).toEqual(['Old', 'New', 'Late'])
  expect(book.items['#t0301']).toBe('Late')
  expect(book.items['#t0310']).toBe('Late')
})

// ---------------------------------------------------------------- regression

/** Property: a rollback whose write fails keeps the record, so the next pass does not add the block again (the V031). */
test('a failed rollback write does not lead to the block twice in the archive', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: `${DONE}\n- [ ] #T2 Open` }
  let archiveWrites = 0
  const { store } = rig(on, files, { faults: { write: (p: string) => {
    if (p !== ARCHIVE) {
      return false
    }
    archiveWrites += 1
    // The source changes right after the archive write, so the move rolls back; the rollback write fails.
    if (archiveWrites === 1) {
      files[TODO] = `${DONE}\n- [ ] #T2 Open\n- [ ] #T3 Added by someone`
    }

    return archiveWrites === 2
  } } })
  await openPane($)
  for (let i = 0; i < 12; i += 1) {
    await clock.advance(3000)
  }
  expect(archiveWrites).toBeGreaterThan(1)
  expect(files[ARCHIVE]!.split('- [x] #T1 Done parser').length - 1).toBe(1)
  expect(files[TODO]).toBe('- [ ] #T2 Open\n- [ ] #T3 Added by someone')
  expect(store.get(RECORD)).toBeNull()
})

// ---------------------------------------------------------------- (c) regression

/**
 * Property: the archive record is keyed by the archive's real path in one spelling, so a
 * session that reaches the folder by another spelling (here NFD, where the real path is NFC) finds
 * the record another session wrote, and does not add the block twice.
 */
test('a record written under the real path is found by a session that sees the folder in another spelling', async ($, on) => {
  const clock = mock.clock(on)
  const nfd = '/repo/mods/café/.claude_todo'
  const nfc = nfd.normalize('NFC')
  // Session A wrote its record (by the real path) and the archive, then stopped before it cut the source.
  const files: Record<string, string> = { [`${nfd}/TODO.md`]: `${DONE}\n- [ ] #T2 Open`, [`${nfd}/archive/TODO.md`]: `${DONE}\n` }
  const { store } = rig(on, files, {
    session: 'sess-b',
    listed: ['mods/café/.claude_todo/TODO.md'],
    real: path => path.normalize('NFC'),
    store: new Map<string, unknown>([[`archive-wrote:${nfc}/archive/TODO.md`, [BLOCK]]]),
  })
  await openPane($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  expect(files[`${nfd}/archive/TODO.md`]!.split('- [x] #T1 Done parser').length - 1).toBe(1)
  expect(files[`${nfd}/TODO.md`]).toBe('- [ ] #T2 Open')
  expect(store.get(`archive-wrote:${nfc}/archive/TODO.md`)).toBeNull()
})

// ---------------------------------------------------------------- regression

/**
 * Property: a claim on a ticket that is gone stays only while the folder that could hold
 * it did not read, and at most MISSING_CLAIM_MS. Three states: an unrelated folder will not list
 * (the V015: the claim ends), the claim's own folder will not list for longer than the
 * bound (it ends), and (the kept population) its own folder will not list inside the bound (it stays).
 */
test('the ticket is gone from a folder that reads and an unrelated folder will not list: the claim ends', async ($, on) => {
  const clock = mock.clock(on)
  let isFaulty = false
  const files: Record<string, string> = { [TODO]: '- [ ] #T2 Other', [`${OTHER}/TODO.md`]: '- [~] #T1 Ship the parser' }
  const { store, bump } = rig(on, files, { listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'], faults: { list: p => isFaulty && p === '/repo/.claude_todo' } })
  await openPane($)
  await turnOf($, 'h1')
  await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 0, total: 1, items: ['#T1'] } as never)
  await clock.advance(6000)
  const claims = () => readKeptTickets(store.get('orchestrator:sess-1')).map(([key]) => key)
  expect(claims()).toEqual(['mods/x/.claude_todo::#t1'])
  isFaulty = true
  files[`${OTHER}/TODO.md`] = '- [ ] #T3 Else'
  bump(`${OTHER}/TODO.md`)
  for (let i = 0; i < 40; i += 1) {
    await clock.advance(3000)
  }
  expect(claims()).toEqual([])
})

// A claim kept from before a reload, on a ticket of a folder that has not listed since: not found,
// and its own folder is unread. It stays inside the bound and ends past it.
for (const [label, waitMs, isKept] of [
  ['for 31 minutes', 31 * 60_000, false],
  ['for 2 minutes', 120_000, true],
] as const) {
  test(`the claim's own folder will not list ${label}: the claim ${isKept ? 'stays' : 'ends'}`, { timeoutMs: 120_000 } as never, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [TODO]: '- [ ] #T2 Other', [`${OTHER}/TODO.md`]: '- [~] #T1 Ship the parser' }
    const { store } = rig(on, files, {
      listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'],
      faults: { list: p => p === OTHER },
      store: new Map<string, unknown>([['orchestrator:sess-1', [['mods/x/.claude_todo::#t1', true]]]]),
    })
    await openPane($)
    await turnOf($, 'h1')
    const claims = () => readKeptTickets(store.get('orchestrator:sess-1')).map(([key]) => key)
    for (let t = 0; t < waitMs; t += 3000) {
      await clock.advance(3000)
    }
    await turnOf($, 'h1')
    await clock.advance(3000)
    expect(claims()).toEqual(isKept ? ['mods/x/.claude_todo::#t1'] : [])
  })
}

// ---------------------------------------------------------------- residual

/**
 * Property: a move_ticket whose scan throws answers that it could not read, never that no
 * item matches: the unread places of an older pass say nothing about this one.
 */
test('move_ticket whose scan throws says it could not read, not "no match"', async ($, on) => {
  const clock = mock.clock(on)
  let isBad = false
  const files: Record<string, string> = { [TODO]: '- [ ] #T2 Other' }
  rig(on, files, { badList: p => isBad && p === '/repo/.claude_todo' })
  await openPane($)
  await clock.advance(3000)
  // Added since the last good pass, and the next pass throws.
  files[TODO] = '- [ ] #T2 Other\n- [ ] #T1 Fix the parser'
  isBad = true
  const out = JSON.stringify(await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'done', reason: 'r' } as never))
  expect(out).toContain('could not read')
  expect(out).not.toContain('no live todo item matches')
  expect(files[TODO]).toBe('- [ ] #T2 Other\n- [ ] #T1 Fix the parser')
})

// ---------------------------------------------------------------- regression

/**
 * Property: a session note that is not stored is not a note: the session tries again after
 * SESSION_RETRY_MS, not SESSION_TOUCH_MS later, so it is listed (with its time) within a minute or two.
 */
test('a session note whose write fails is tried again within SESSION_RETRY_MS', async ($, on) => {
  const clock = mock.clock(on)
  let fails = 1
  const { store } = rig(on, {}, { agents: () => [LIVE], faults: { set: key => key === 'sessions-recent' && fails-- > 0 } })
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  expect(store.get('sessions-recent')).toBeUndefined()
  for (let i = 0; i < 9; i += 1) {
    await clock.advance(10_000)
  }
  const list = store.get('sessions-recent') as [string, number][] | undefined
  expect(list?.map(([id]) => id)).toEqual(['sess-1'])
  expect(typeof list?.[0]?.[1]).toBe('number')
})

// ---------------------------------------------------------------- (b) regression

/**
 * Property: the label base never goes down. Rows cut while the rows group would not load
 * moved it on; the stored base read later is lower, and is not taken.
 */
test('a rows load after cuts moved the base on never lowers the base', async ($, on) => {
  const clock = mock.clock(on)
  let isDown = true
  const listed = Array.from({ length: 230 }, (_, i) => ({ id: `r${i}`, description: `Row ${i}`, type: 'engineer', status: i === 229 ? 'running' : 'completed' }))
  const stored = Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, description: `Kept ${i}`, type: 'engineer', status: 'completed', startedAt: 0, toolCalls: 1, brief: `kept ${i}` }))
  const { store } = rig(on, {}, {
    agents: () => listed,
    faults: { get: key => isDown && key === 'agents:sess-1' },
    store: new Map<string, unknown>([['agents:sess-1', stored], ['agents-base:sess-1', 10]]),
  })
  await openPane($)
  await turnOf($, 'r229')
  await clock.advance(3000)
  isDown = false
  await turnOf($, 'r229')
  for (let i = 0; i < 8; i += 1) {
    await clock.advance(1000)
  }
  expect(store.get('agents-base:sess-1')).toBe(35)
})
}
