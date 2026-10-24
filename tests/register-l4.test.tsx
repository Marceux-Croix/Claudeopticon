// Engine tests store time limits (219), a re-spawned agent ID (220), the
// still-open note and burn throttles after a clock set back (221), a stopped row the list still
// shows running (222), stored progress past the write limits (223) and the book keys of an unread
// folder (127). Each test has its own fakes; nothing here is shared with register.test.tsx.
import { expect, mock, test } from 'claude-code/testing'

type Ctx = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Clock = ReturnType<typeof mock.clock>
type Listed = { id: string; description: string; type: string; status: string }
type Faults = { read?: (path: string) => boolean; list?: (path: string) => boolean }

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
const PROGRESS = 'mcp__claudeopticon__report_progress'
const T = { timeoutMs: 120_000 } as never
const USAGE = { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const openPane = async ($: Ctx) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

/**
 * A git repo at /repo with the given files; the store is a Map. `listed` is what git ls-files
 * gives, so a second folder (mods/x/.claude_todo) is found. Each fs call can fail by path.
 */
function rig(on: On, files: Record<string, string>, opts: { store?: Map<string, unknown>; agents?: () => Listed[]; listed?: string[]; faults?: Faults; isOwnStore?: boolean } = {}) {
  const R = '/repo'
  const store = opts.store ?? new Map<string, unknown>()
  const mtimes = new Map<string, number>()
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
  const at = (path: string) => (inside(path) ? path : !path.includes('.claude_todo') && !path.includes('.git') ? R : path.endsWith('.claude_todo') ? `${R}/.claude_todo` : `${R}/.claude_todo/${path.split('/').pop()}`)
  on('fs.exists', (_$, e) => {
    const path = at(e.path)

    return { value: e.path.endsWith('.git') || path in files || Object.keys(files).some(one => one.startsWith(`${path}/`)) }
  })
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/home/a')) {
      throw new Error('ENOENT')
    }
    const path = at(e.path)

    return { value: { kind: path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: path } } as never
  })
  on('fs.list', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.list?.(path) === true) {
      throw new Error('EIO list')
    }

    return { value: names(path).map(name => ({ name, kind: 'file', size: 1, mtimeMs: mtimes.get(`${path}/${name}`) ?? 2, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.read?.(path) === true) {
      throw new Error('EIO read')
    }

    return { value: files[path] ?? '' }
  })
  on('fs.write', (_$, e) => {
    const path = at(e.path)
    files[path] = e.text as string
    mtimes.set(path, (mtimes.get(path) ?? 2) + 1)

    return { value: undefined } as never
  })
  // A test that fakes its own store (`isOwnStore`) registers store.get and store.set itself.
  if (opts.isOwnStore !== true) {
    on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
    on('store.set', (_$, e) => {
      store.set(e.key, e.value)

      return { value: undefined } as never
    })
  }
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('agent.list', () => ({ value: opts.agents?.() ?? [] }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)

  return { store, files, mtimes }
}

/** True when `work` settles within `maxMs` of the test clock, stepped 1 s at a time. */
async function settles(clock: Clock, work: Promise<unknown>, maxMs: number): Promise<boolean> {
  let isDone = false
  void work.then(
    () => {
      isDone = true
    },
    () => {
      isDone = true
    },
  )
  for (let t = 0; t <= maxMs && !isDone; t += 1000) {
    await clock.advance(1000)
  }

  return isDone
}

/** One model request of `agentId` through turn.step, to its end. */
async function stepOf($: Ctx, agentId: string | undefined): Promise<void> {
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) } as never)) {
    // The stop chunk and the answer only.
  }
}

const rowsOf = (store: Map<string, unknown>) => (store.get('agents:sess-1') as { id: string; status: string; toolCalls: number; endedAt?: number; progress?: { done: number; total: number } }[] | undefined) ?? []

{
  /**
   * Property: a store call that never answers is a failed call after the store time
   * limit: session.start, agent.spawn, an agent's turn.complete and every turn.step return, and once
   * the store answers again the load runs (the shared `loading` promise was cleared).
   * The three states: every read hangs (the first key of the load), only the last group's key (the
   * series) hangs, and every write hangs while the reads answer (the population the read limit alone
   * would leave out).
   */
  for (const [label, hangGet, hangSet] of [
    ['every store read never answers', (_key: string) => true, (_key: string) => false],
    ['only the series key never answers', (key: string) => key.startsWith('series:'), (_key: string) => false],
    ['every store write never answers', (_key: string) => false, (_key: string) => true],
  ] as const) {
    test(`${label}: each hook returns, and a store that answers again loads`, T, async ($, on) => {
      const clock = mock.clock(on)
      let isHung = true
      const store = new Map<string, unknown>([['agents:sess-1', [{ id: 'k1', description: 'Kept', type: 'engineer', status: 'completed', brief: 'kept', startedAt: 1, toolCalls: 3 }]]])
      rig(on, { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 Build the parser' }, { store, isOwnStore: true, agents: () => [{ id: 'a1', description: 'T', type: 'engineer', status: 'running' }] })
      on('store.get', (_$, e) => (isHung && hangGet(e.key) ? (new Promise(() => undefined) as never) : ({ value: store.get(e.key) } as never)))
      on('store.set', (_$, e) => {
        if (isHung && hangSet(e.key)) {
          return new Promise(() => undefined) as never
        }
        store.set(e.key, e.value)

        return { value: undefined } as never
      })
      on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
      on('turn.complete', () => ({ text: '' }) as never)
      on('model.complete', () => ({ value: { isAnswered: false, text: '' } }) as never)
      on('ui.open', () => ({ value: undefined }) as never)
      on('turn.step', async function* (_$, e) {
        yield { kind: 'stop', stopReason: 'end_turn', usage: USAGE } as never

        return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
      })
      expect(await settles(clock, $.session.start({ cwd: '/repo' } as never), 60_000)).toBe(true)
      // These wait on no store call at all: they return within 1 s, well under STORE_LIMIT_MS (5 s).
      expect(await settles(clock, $.agent.spawn({ prompt: 'p', description: 'T', subagentType: 'engineer' } as never), 1000)).toBe(true)
      expect(await settles(clock, $.turn.complete({ agentId: 'a1', turnId: 't' } as never), 1000)).toBe(true)
      expect(await settles(clock, stepOf($, 'a1'), 1000)).toBe(true)
      expect(await settles(clock, stepOf($, undefined), 1000)).toBe(true)
      // The store answers again: the next refresh loads the kept row and stores the rows.
      isHung = false
      await openPane($)
      for (let i = 0; i < 20; i += 1) {
        await clock.advance(3000)
      }
      expect(rowsOf(store).map(row => row.id)).toEqual(['k1', 'a1'])
    })
  }
}

{
  /**
   * Property: an agent spawned again under a known ID keeps its row in place, with its
   * tool calls and tokens, takes the new brief, is matched to a ticket again, and its next end is
   * noted again.
   */
  test('a re-spawned agent ID keeps its place and counts, is matched again and its end noted again', T, async ($, on) => {
    const clock = mock.clock(on)
    const listed: Listed[] = []
    const { store } = rig(on, { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 Build the parser\n- [ ] #T0002 Ship the release' }, { agents: () => listed })
    let nextId = 'a1'
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: nextId }))
    on('tool.call', () => ({ result: 'ok' }) as never)
    const prompts: string[] = []
    on('model.complete', (_$, e) => {
      prompts.push(String((e as { prompt?: string }).prompt ?? ''))

      return { value: { isAnswered: true, text: '[]', usage: USAGE } } as never
    })
    const contexts: string[] = []
    on('prompt.submit', (_$, e) => {
      contexts.push(JSON.stringify(e.context ?? []))

      return { text: '' } as never
    })
    await openPane($)
    for (const id of ['a1', 'a2']) {
      nextId = id
      listed.push({ id, description: `Task ${id}`, type: 'engineer', status: 'running' })
      await $.agent.spawn({ prompt: `Work on #T0001 for ${id}`, description: `Task ${id}`, subagentType: 'engineer' } as never)
    }
    for (let i = 0; i < 7; i += 1) {
      await $.tool.call({ tool: 'Bash', command: 'ls', description: 'list', agentId: 'a1' } as never)
    }
    await clock.advance(6000)
    expect(rowsOf(store).map(row => `${row.id}:${row.toolCalls}`)).toEqual(['a1:7', 'a2:0'])
    // a1 ends: one note names it.
    listed[0]!.status = 'completed'
    await clock.advance(6000)
    await $.prompt.submit({ text: 'go', context: [] } as never)
    const ends = () => contexts.filter(one => /A1/.test(one) && /finished/.test(one)).length
    expect(ends()).toBe(1)
    // a1 is spawned again with a new task.
    const matchesBefore = prompts.filter(one => one.includes('again')).length
    nextId = 'a1'
    listed[0]!.status = 'running'
    await $.agent.spawn({ prompt: 'Work on #T0001 again', description: 'Task a1', subagentType: 'engineer' } as never)
    await clock.advance(6000)
    expect(rowsOf(store).map(row => `${row.id}:${row.toolCalls}:${row.status}`)).toEqual(['a1:7:running', 'a2:0:running'])
    expect(prompts.filter(one => one.includes('again')).length).toBeGreaterThan(matchesBefore)
    // Its second end is noted too.
    listed[0]!.status = 'completed'
    await clock.advance(6000)
    await $.prompt.submit({ text: 'go', context: [] } as never)
    expect(ends()).toBe(2)
  })
}

{
  /**
   * Property: after the clock is set back, a ticket still in progress is named again
   * NUDGE_REPEAT_MS (30 min) after the set-back, not after the set-back plus that; within 30 min of
   * the last naming it is not named. States: a 2 h set-back then 40 min (the defect behind a valid
   * first naming), a set-back of NUDGE_REPEAT_MS then 31 min (the limit: the old wait was 1 min), and no set-back with 20 min (the
   * population that must stay quiet).
   */
  for (const [label, back, wait, isNamed] of [
    ['a 2 h set-back, then 40 min', 2 * 3_600_000, 40 * 60_000, true],
    ['a 30 min set-back, then 31 min', 30 * 60_000, 31 * 60_000, true],
    ['no set-back, then 20 min', 0, 20 * 60_000, false],
  ] as const) {
    test(`the still-in-progress note after ${label}: ${isNamed ? 'named again' : 'not named'}`, T, async ($, on) => {
      let now = 10 * 3_600_000
      on('clock.now', () => ({ value: now }) as never)
      on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
      rig(on, { '/repo/.claude_todo/TODO.md': '- [~] #T0001 Build the parser' })
      on('tool.call', () => ({ result: 'ok' }) as never)
      on('prompt.submit', (_$, e) => ({ text: JSON.stringify(e.context ?? []) }) as never)
      await openPane($)
      await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T0001'] } as never)
      const named = async () => /T0001/.test(JSON.stringify(await $.prompt.submit({ text: 'go', context: [] } as never)))
      expect(await named()).toBe(true)
      now -= back
      expect(await named()).toBe(false)
      now += wait
      expect(await named()).toBe(isNamed)
    })
  }
}

{
  /**
   * Property: a row this session ended (a Stop press, a task notification) stays ended
   * while the agent list still says it runs; a list that says it ended is taken, and a row the list
   * itself ended follows the list (the population the guard leaves out).
   */
  for (const how of ['stop', 'notification'] as const) {
    test(`a row ended by a ${how} stays ended while the list still says running`, T, async ($, on) => {
      const clock = mock.clock(on)
      let status = 'running'
      const { store } = rig(on, { '/repo/.claude_todo/TODO.md': '- [~] #T0001 Build the parser' }, { agents: () => [{ id: 'a1', description: 'Work on #T0001', type: 'engineer', status }] })
      on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
      on('tool.call', () => ({ result: 'ok' }) as never)
      on('prompt.submit', () => ({ text: '' }) as never)
      on('turn.complete', () => ({ text: '' }) as never)
      on('model.complete', () => ({ value: { isAnswered: false, text: '' } }) as never)
      const ui = await openPane($)
      await $.agent.spawn({ prompt: 'Work on #T0001', description: 'Work on #T0001', subagentType: 'engineer' } as never)
      await clock.advance(6000)
      if (how === 'stop') {
        await ui.press({ key: 'agent-stop-a1' })
      } else {
        await $.prompt.submit({ text: '<task-notification><task-id>a1</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' } } as never)
      }
      await clock.advance(10)
      const endedAt = rowsOf(store)[0]?.endedAt
      expect(endedAt).toBeDefined()
      // The end of a turn forces a refresh, which reads the list that still says running.
      await $.turn.complete({ agentId: 'a1', turnId: 't' } as never)
      for (let i = 0; i < 4; i += 1) {
        await clock.advance(6000)
      }
      expect(rowsOf(store).map(row => row.status)).toEqual([how === 'stop' ? 'killed' : 'completed'])
      expect((await ui.findAll({ type: 'Button' })).some(one => JSON.stringify(one).includes('agent-stop-a1'))).toBe(false)
      // A list that says it ended is taken; the end time stays the one this session saw.
      status = 'killed'
      await $.turn.complete({ agentId: 'a1', turnId: 't' } as never)
      await clock.advance(6000)
      expect(rowsOf(store).map(row => `${row.status}@${row.endedAt}`)).toEqual([`killed@${endedAt}`])
    })
  }

  test('a row the list ended follows the list when it says running again', T, async ($, on) => {
    const clock = mock.clock(on)
    let status = 'running'
    const { store } = rig(on, {}, { agents: () => [{ id: 'a1', description: 'Task', type: 'engineer', status }] })
    on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
    on('turn.complete', () => ({ text: '' }) as never)
    await openPane($)
    await $.agent.spawn({ prompt: 'p', description: 'Task', subagentType: 'engineer' } as never)
    await clock.advance(6000)
    status = 'completed'
    await clock.advance(6000)
    expect(rowsOf(store).map(row => row.status)).toEqual(['completed'])
    status = 'running'
    await $.turn.complete({ agentId: 'a1', turnId: 't' } as never)
    await clock.advance(6000)
    expect(rowsOf(store).map(row => row.status)).toEqual(['running'])
  })
}

{
  /** Property: a stored row's progress is drawn within the write limits: never past 100%, never NaN%. */
  test('stored progress past the write limits draws within them', T, async ($, on) => {
    const clock = mock.clock(on)
    const store = new Map<string, unknown>([
      ['agents:sess-1', [
        { id: 'a1', description: 'Over', type: 'engineer', status: 'running', brief: '', startedAt: 1, toolCalls: 0, progress: { done: 9, total: 3 } },
        { id: 'a2', description: 'Zero', type: 'engineer', status: 'running', brief: '', startedAt: 1, toolCalls: 0, progress: { done: 0, total: 0 } },
      ]],
    ])
    rig(on, {}, { store, agents: () => [{ id: 'a1', description: 'Over', type: 'engineer', status: 'running' }, { id: 'a2', description: 'Zero', type: 'engineer', status: 'running' }] })
    const ui = await openPane($)
    await clock.advance(6000)
    const svgs = JSON.stringify(await ui.findAll({ type: 'Svg' }))
    expect(/300%/.test(svgs)).toBe(false)
    expect(/NaN%/.test(svgs)).toBe(false)
    expect(/Step 0 of 0/.test(svgs)).toBe(false)
  })
}

{
  /**
   * Property: a place that does not read keeps every book key of its own folder only; the
   * book keys of every other folder are pruned as usual. States: a file of the second folder does
   * not read (the primary folder's gone key goes), a file of the primary folder does not read (the
   * second folder's gone key goes), and the second folder's archive does not list (a folder-level
   * place, the limit of what the scan names). The control has nothing unread: both gone keys go.
   */
  const OTHER = '/repo/mods/x/.claude_todo'
  const OTHER_KEY = 'mods/x/.claude_todo::#t0008'
  for (const [label, faults, isPrimaryKept, isOtherKept] of [
    ['a file of the second folder does not read', { read: (p: string) => p === `${OTHER}/TODO.md` }, false, true],
    ['a file of the primary folder does not read', { read: (p: string) => p === '/repo/.claude_todo/OTHER.md' }, true, false],
    ["the second folder's archive does not list", { list: (p: string) => p === `${OTHER}/archive` }, false, true],
    ['nothing unread (control)', {}, false, false],
  ] as const) {
    test(`${label}: only that folder keeps its gone book keys`, T, async ($, on) => {
      const clock = mock.clock(on)
      const BOOK = '/repo/.claude_todo/categories.json'
      const files: Record<string, string> = {
        '/repo/.claude_todo/TODO.md': '- [ ] #T0001 alpha',
        '/repo/.claude_todo/OTHER.md': '- [ ] #T0005 kept by other',
        [`${OTHER}/TODO.md`]: '- [ ] #T0006 beta',
        [`${OTHER}/archive/TODO.md`]: '- [x] #T0007 archived',
        [BOOK]: JSON.stringify({ categories: ['Work'], items: { '#t0001': 'Work', '#t0005': 'Work', '#t0009': 'Work', 'mods/x/.claude_todo::#t0006': 'Work', [OTHER_KEY]: 'Work' } }, null, 2),
      }
      rig(on, files, { listed: ['.claude_todo/TODO.md', '.claude_todo/OTHER.md', 'mods/x/.claude_todo/TODO.md'], faults })
      on('model.complete', (_$, e) => {
        const n = (String((e as { prompt?: string }).prompt ?? '').match(/^\d+\. /gm) ?? []).length
        const assign = Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), 'Work']))

        return { value: { isAnswered: true, text: JSON.stringify({ categories: ['Work'], assign }), usage: USAGE } } as never
      })
      await openPane($)
      for (let i = 0; i < 4; i += 1) {
        await clock.advance(5000)
      }
      // A new ticket starts a sort, which writes the pruned book.
      files['/repo/.claude_todo/TODO.md'] = '- [ ] #T0001 alpha\n- [ ] #T0003 gamma'
      for (let i = 0; i < 30; i += 1) {
        await clock.advance(5000)
      }
      const items = (JSON.parse(files[BOOK]!) as { items: Record<string, string> }).items
      expect('#t0003' in items).toBe(true)
      expect('#t0009' in items).toBe(isPrimaryKept)
      expect(OTHER_KEY in items).toBe(isOtherKept)
    })
  }
}
