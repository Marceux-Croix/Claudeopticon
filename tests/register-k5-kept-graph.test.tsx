// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// K5: the kept graph across a reload, the keys of elements, the Stop key.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Ctx = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Listed = { id: string; description: string; type: string; status: string }

const T5 = { timeoutMs: 120_000 } as never
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const hasControl = (text: string) => /[\x00-\x1F\x7F-\x9F]/.test(text)

/** A small fake repo (a trimmed copy of the J5 rig): files by absolute path, a store, a session ID and an agent list. */
function k5Rig(on: On, files: Record<string, string>, opts: { agents?: () => Listed[]; store?: Map<string, unknown> } = {}) {
  const R = '/repo'
  const store = opts.store ?? new Map<string, unknown>()
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

    return argv[1] === 'rev-parse' ? out(`${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : Object.keys(files).map(path => path.replace(`${R}/`, '')).join('\n'))
  })
  const at = (path: string) => (inside(path) ? path : path.endsWith('.claude_todo') ? `${R}/.claude_todo` : `${R}/.claude_todo/${path.split('/').pop()}`)
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
  on('fs.list', (_$, e) => ({ value: names(at(e.path)).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2, isLink: false })) }) as never)
  on('fs.read', (_$, e) => ({ value: files[at(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[at(e.path)] = e.text as string

    return { value: undefined } as never
  })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('agent.list', () => ({ value: opts.agents?.() ?? [] }))
  on('command.register', () => ({ value: undefined }) as never)

  return { store }
}

const EPOCH = 1_792_000_000_000
const TODO = '/repo/.claude_todo/TODO.md'
/** The series a session wrote before the reload: points over 160 s, at a real epoch time. */
const KEPT = {
  agents: [[EPOCH, 0], [EPOCH + 60_000, 1], [EPOCH + 120_000, 0]],
  tokens: [[EPOCH, 1000], [EPOCH + 40_000, 2000], [EPOCH + 80_000, 3000], [EPOCH + 120_000, 4000], [EPOCH + 160_000, 5000]],
  compacts: [],
}

function k5Step(on: On) {
  let next: unknown
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: next } as never
  })

  return async ($: Ctx, used: unknown) => {
    next = used
    for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) {
      // No chunks.
    }
  }
}

const settle = async () => {
  for (let i = 0; i < 40; i += 1) {
    await new Promise(r => setTimeout(r, 5))
  }
}
const storedTokens = (store: Map<string, unknown>) => ((store.get('series:sess-1') as { tokens?: [number, number][] } | undefined)?.tokens ?? []).map(point => point[0])

/**
 * Property: a plugin reload keeps the stored graph, whatever the first event is. Two
 * first events: the pane render (nothing has read the clock yet) and a model request (the load
 * ran before the clock was read). The kept points are still in the store after the reload.
 */
test('a reload whose first event is the pane render keeps the kept graph', T5, async ($, on) => {
  const clock = mock.clock(on)
  await clock.advance(EPOCH + 200_000)
  const store = new Map<string, unknown>([['series:sess-1', KEPT]])
  k5Rig(on, { [TODO]: '- [ ] #T1 Ship' }, { store })
  await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await settle()
  await clock.advance(31_000)
  await settle()
  expect(storedTokens(store)).toEqual(expect.arrayContaining([EPOCH, EPOCH + 40_000, EPOCH + 80_000, EPOCH + 120_000, EPOCH + 160_000]))
  expect((store.get('series:sess-1') as { agents: unknown[] }).agents.length).toBe(3)
})

test('a reload whose first event is a model request keeps the kept graph', T5, async ($, on) => {
  const clock = mock.clock(on)
  await clock.advance(EPOCH + 260_000)
  const store = new Map<string, unknown>([['series:sess-1', KEPT]])
  k5Rig(on, { [TODO]: '- [ ] #T1 Ship' }, { store })
  const step = k5Step(on)
  await step($, { ...ZERO, input_tokens: 700 })
  await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await settle()
  await clock.advance(31_000)
  await settle()
  expect(storedTokens(store)).toEqual(expect.arrayContaining([EPOCH, EPOCH + 40_000, EPOCH + 80_000, EPOCH + 120_000, EPOCH + 160_000]))
})

/**
 * Property: the Stop button is keyed by the agent ID, so a press by key from a tree
 * that is still shown after a redraw stops the agent of that card, not the one now at its index.
 */
test('the Stop button key is the agent ID, not its index', T5, async ($, on) => {
  mock.clock(on)
  const stops: string[] = []
  k5Rig(on, { [TODO]: '- [ ] #T1 Ship' }, { agents: () => [{ id: 'k1', description: 'One', type: 'engineer', status: 'running' }, { id: 'k2', description: 'Two', type: 'engineer', status: 'running' }] })
  on('tool.call', { tool: 'TaskStop' }, (_$, e) => {
    stops.push((e as { task_id?: string }).task_id!)

    return { result: { message: 'stopped', task_id: 'x', task_type: 'local_agent' } } as never
  })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `k${(n += 1)}` }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'One', description: 'One', subagentType: 'engineer' } as never)
  await $.agent.spawn({ prompt: 'Two', description: 'Two', subagentType: 'engineer' } as never)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const keys = (await ui.findAll({ type: 'Button' } as never)).map(button => String((button as { key?: string }).key)).filter(key => key.startsWith('agent-stop-'))
  expect(keys.sort()).toEqual(['agent-stop-k1', 'agent-stop-k2'])
  await ui.press({ key: 'agent-stop-k2' })
  expect(stops).toEqual(['k2'])
})

/** Every key in a drawn tree. */
type Node = { key?: unknown; props?: { key?: unknown }; children?: unknown }
function allKeys(tree: unknown, out: string[] = []): string[] {
  const node = tree as Node | Node[] | null | undefined
  if (Array.isArray(node)) {
    node.forEach(one => allKeys(one, out))
  } else if (typeof node === 'object' && node !== null) {
    const key = node.key ?? node.props?.key
    if (key !== undefined && key !== null) {
      out.push(String(key))
    }
    allKeys(node.children, out)
  }

  return out
}

/**
 * Property: no element key holds a control character, on the desktop and the terminal,
 * when a file name holds one. Three states: ESC, a line break, and a C1 character (the limit of the range).
 */
for (const [label, name] of [['ESC', 'TO\u001BDO.md'], ['a line break', 'TO\nDO.md'], ['a C1 character', 'TO\u009BDO.md']] as const) {
  test(`element keys hold no control character when a todo file name holds ${label}`, T5, async ($, on) => {
    mock.clock(on)
    k5Rig(on, { [`/repo/.claude_todo/${name}`]: '- [ ] #T1 Ship\n- [ ] #T2 Fix' })
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    const desk = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
    const term = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
    await settle()
    const deskKeys = allKeys(await (desk as never as { drawn: () => Promise<unknown> }).drawn())
    const termKeys = allKeys(await (term as never as { drawn: () => Promise<unknown> }).drawn())
    // The test sees keys at all (it would pass on an empty tree).
    expect(deskKeys.some(key => key.includes('TO%'))).toBe(true)
    expect(termKeys.some(key => key.startsWith('TO%'))).toBe(true)
    expect(deskKeys.filter(hasControl)).toEqual([])
    expect(termKeys.filter(hasControl)).toEqual([])
  })
}
}
