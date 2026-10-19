// Engine tests of UCR loop 3, batch L5: the categories book read with own keys,
// the search Input value, turn.step counted on every way out and the Stop toast
//. Every engine call is faked here; the rig is a trimmed copy of the repoWith rig of
// tests/register.test.tsx.
import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Test = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

const T5 = { timeoutMs: 120_000 } as never
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const TODO = '/repo/.claude_todo/TODO.md'
const BOOK = '/repo/.claude_todo/categories.json'

/** A fake repo at /repo with a primary .claude_todo folder: files by path, a store, a session ID, toasts and model replies. */
function l5Rig(on: On, files: Record<string, string>, opts: { reply?: (prompt: string) => string; hasToast?: false; agents?: () => unknown[] } = {}) {
  const R = '/repo'
  const store = new Map<string, unknown>()
  const writes: string[] = []
  const prompts: string[] = []
  const toasts: string[] = []
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : ({ value: { exitCode: 1, stdout: '', stderr: 'failed' } } as never)
    }

    return argv[1] === 'rev-parse' ? out(`${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : Object.keys(files).filter(path => path.endsWith('.md')).map(path => path.replace(`${R}/`, '')).join('\0'))
  })
  // The engine may hand the session folder's paths over in other forms: a path outside /repo is the primary folder's, by its name.
  const at = (path: string) => (inside(path) ? path : path.endsWith('.claude_todo') ? `${R}/.claude_todo` : `${R}/.claude_todo/${path.split('/').pop()}`)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.git') || at(e.path) in files || Object.keys(files).some(path => path.startsWith(`${at(e.path)}/`)) }))
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/home/a')) {
      throw new Error('ENOENT')
    }
    const path = inside(e.path) ? e.path : !e.path.includes('.claude_todo') && !e.path.includes('.git') ? R : at(e.path)

    return { value: { kind: path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: path } } as never
  })
  let stamp = 0
  on('fs.list', (_$, e) => ({ value: names(at(e.path)).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2 + stamp, isLink: false })) }) as never)
  on('fs.read', (_$, e) => ({ value: files[at(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[at(e.path)] = e.text as string
    stamp += 1
    writes.push(at(e.path))

    return { value: undefined } as never
  })
  // Without a toast hook (hasToast false), $.ui.toast has no implementation and throws to the caller.
  if (opts.hasToast !== false) {
    on('ui.toast', (_$, e) => {
      toasts.push(String((e as unknown as { text?: unknown }).text ?? JSON.stringify(e)))

      return { value: undefined } as never
    })
  }
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('agent.list', () => ({ value: opts.agents?.() ?? [] }) as never)
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)

    return { value: { isAnswered: true, text: opts.reply?.(e.prompt) ?? '{}', usage: ZERO } } as never
  })

  return { store, writes, prompts, toasts }
}

const open = async ($: Test, surface: 'desktop' | 'terminal' = 'desktop') => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface, ...PANE })
}

const settle = async (until: () => boolean = () => false, rounds = 400) => {
  for (let i = 0; i < rounds && !until(); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

// ---------------------------------------------------------------- the categories book

/** Each prototype name as a todo line, and the text the board shows for it (the parser drops the emphasis marks). */
const PROTO: [string, string][] = [
  ['constructor', 'constructor'],
  ['Constructor', 'Constructor'],
  ['**constructor**', 'constructor'],
  ['__proto__', 'proto'],
  ['toString', 'toString'],
  ['hasOwnProperty', 'hasOwnProperty'],
]

for (const [line, shown] of PROTO) {
  test(`the ticket view draws with an open no-ID item "${line}"`, T5, async ($, on) => {
    mock.clock(on)
    l5Rig(on, { [TODO]: `- [ ] ${line}\n- [ ] #T2 Fix the parser` })
    // The old code threw in ui.render ("text.replace is not a function") for a "constructor" key: the mount failed.
    const ui = await open($)
    const drawn = JSON.stringify(await ui.findAll({ type: 'Svg' }))
    expect(drawn).toContain(`>${shown}<`)
    expect(drawn).toContain('Fix the parser')
  })
}

test('the list view by category and the terminal draw an item "constructor" under Uncategorized', T5, async ($, on) => {
  mock.clock(on)
  l5Rig(on, { [TODO]: '- [ ] constructor\n- [ ] #T2 Fix the parser', [BOOK]: '{"categories":["Work"],"items":{"#t2":"Work"}}' })
  const ui = await open($)
  await ui.press({ key: 'todo-tickets' })
  await ui.press({ key: 'todo-sort' })
  const drawn = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(drawn).toContain('>constructor<')
  expect(drawn).toContain('Uncategorized')
  // The filter offers Uncategorized: the old code read "constructor" as sorted (Object is not undefined).
  expect(JSON.stringify(await ui.findAll({ type: 'Button' }))).toContain('Uncategorized')
  const term = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
  expect(JSON.stringify(await term.findAll({ type: 'Text' }))).toContain('constructor')
})

test('the sort sends a no-ID ticket "constructor" to the model and keeps its category', T5, async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [ ] #T1 Pay the vendor\n- [ ] constructor' }
  const { prompts, writes } = l5Rig(on, files, { reply: () => '{"categories":["Work"],"assign":{"1":"Work","2":"Work"}}' })
  await open($)
  await settle(() => writes.includes(BOOK))
  // The old code never sent it: book.items["constructor"] was Object, so the ticket read as sorted.
  expect(prompts.length).toBeGreaterThan(0)
  expect(prompts[0]).toContain('. constructor')
  expect(JSON.parse(files[BOOK] ?? '{}').items).toEqual({ '#t1': 'Work', constructor: 'Work' })
})

test('Recategorize sorts and keeps a no-ID ticket "constructor"', T5, async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [ ] #T1 Pay the vendor\n- [ ] constructor', [BOOK]: '{"categories":["Work"],"items":{"#t1":"Work","constructor":"Work"}}' }
  const { writes } = l5Rig(on, files, { reply: () => '{"categories":["Money","Code"],"assign":{"1":"Money","2":"Code"}}' })
  const ui = await open($)
  await ui.press({ key: 'todo-recategorize' })
  await settle(() => writes.includes(BOOK))
  // The old code dropped it: the fresh book's "constructor" lookup read Object, so it was never assigned.
  expect(JSON.parse(files[BOOK] ?? '{}')).toEqual({ categories: ['Money', 'Code'], items: { '#t1': 'Money', constructor: 'Code' } })
})

// ---------------------------------------------------------------- the search Input value

test('a search value with a control character is cleaned before it is kept, and the pane still draws', T5, async ($, on) => {
  mock.clock(on)
  l5Rig(on, { [TODO]: '- [ ] #T1 Ship the build\n- [ ] #T2 Fix the parser' })
  const ui = await open($)
  const input = async () => (await ui.find({ type: 'Input' })) as unknown as { props: { value: string } }
  // State 1, the reported value: ESC inside it (a pasted line). The old code stored it and the engine refused the pane.
  await ui.input({ key: 'todo-search', text: 'Sh\u001b[2Jip', kind: 'change' } as never)
  expect((await input()).props.value).toBe('Sh [2Jip')
  // The pane draws (the top card and the search line): the engine took the tree.
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('total session tokens')
  expect(await ui.find({ type: 'Text', text: /0 matching items/ })).toBeDefined()
  // State 2, the limit: a C1 control (U+009F) as the last character, and a tab and a line break, on submit too.
  await ui.input({ key: 'todo-search', text: 'ship\t\n\u009f', kind: 'submit' } as never)
  expect((await input()).props.value).toBe('ship ')
  expect(await ui.find({ type: 'Text', text: /1 matching items/ })).toBeDefined()
  // State 3, the population left alone: a value with no control character is kept as typed, spaces and all.
  await ui.input({ key: 'todo-search', text: '  fix  parser ', kind: 'change' } as never)
  expect((await input()).props.value).toBe('  fix  parser ')
  expect(await ui.find({ type: 'Text', text: /1 matching items/ })).toBeDefined()
  await ui.press({ key: 'search-clear' })
  expect((await input()).props.value).toBe('')
})

// ---------------------------------------------------------------- turn.step counted on every way out

test('a step whose consumer stops reading after the stop chunk is counted once, in three constructed states', T5, async ($, on) => {
  mock.clock(on)
  const { store } = l5Rig(on, { [TODO]: '- [ ] #T1 Ship' })
  on('turn.complete', () => ({ text: '' }) as never)
  let chunks: unknown[] = []
  on('turn.step', async function* (_$, e) {
    for (const chunk of chunks) {
      yield chunk as never
    }

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...ZERO, input_tokens: 9000 } } as never
  })
  const counted = () => (store.get('tokens:sess-1') as { tokens: number } | undefined)?.tokens ?? 0
  const step = (index: number) => $.turn.step({ turnId: 't', index, model: 'm', messageCount: 1 } as never)
  await open($)
  // A first full step, so the kept count is loaded: 9000.
  for await (const _chunk of step(0)) {
    // Drained.
  }
  await settle(() => counted() === 9000, 100)
  expect(counted()).toBe(9000)
  // State 1, the reported defect: the consumer returns at the yield after the stop chunk (an interrupt). The old code added 0.
  chunks = [{ kind: 'stop', stopReason: 'end_turn', usage: { ...ZERO, input_tokens: 4000 } }, { kind: 'text', index: 0, text: 'more' }]
  for await (const _chunk of step(1)) {
    break
  }
  await settle(() => counted() === 13_000, 100)
  expect(counted()).toBe(13_000)
  // State 2, the limit: the consumer returns before any stop chunk; nothing is known used, so nothing is added and nothing throws.
  chunks = [{ kind: 'text', index: 0, text: 'first' }, { kind: 'stop', stopReason: 'end_turn', usage: { ...ZERO, input_tokens: 4000 } }]
  for await (const _chunk of step(2)) {
    break
  }
  await settle(undefined, 20)
  expect(counted()).toBe(13_000)
  // State 3, the population already counted: a drained step counts its result once, never also in the finally.
  chunks = [{ kind: 'stop', stopReason: 'end_turn', usage: { ...ZERO, input_tokens: 4000 } }]
  for await (const _chunk of step(3)) {
    // Drained.
  }
  await settle(() => counted() === 22_000, 100)
  await settle(undefined, 20)
  expect(counted()).toBe(22_000)
})

// ---------------------------------------------------------------- the Stop toast

/** A live agent a1 and its Stop button, with TaskStop answered by `answer`. */
async function stopRig($: Test, on: On, answer: () => unknown, hasToast?: false): Promise<ReturnType<typeof l5Rig> & { pressError: unknown; drawn: string }> {
  mock.clock(on)
  let status = 'running'
  const rig = l5Rig(on, { [TODO]: '- [ ] #T1 Ship' }, { ...(hasToast === false ? { hasToast } : {}), agents: () => [{ id: 'a1', description: 'Parser', type: 'engineer', status }] })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('tool.call', { tool: 'TaskStop' }, () => {
    const out = answer() as { result?: unknown }
    if (out.result !== undefined) {
      status = 'killed'
    }

    return out as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Fix the parser', description: 'Parser', subagentType: 'engineer' } as never)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  let pressError: unknown
  await ui.press({ key: 'agent-stop-a1' }).catch((error: unknown) => {
    pressError = error
  })
  await settle(undefined, 20)
  await ui.press({ key: 'agents-toggle' }).catch(() => undefined)

  return { ...rig, pressError, drawn: JSON.stringify(await ui.findAll({ type: 'Svg' })) }
}

test('a success toast that throws after a stop that worked does not fail the stop, and the card shows Stopped', T5, async ($, on) => {
  // No toast hook of the test. A guard of the property only: this engine skips a toast hook that throws and answers
  // ui.toast itself, so no fake here makes $.ui.toast throw to the mod, and the old code passes too (UNVERIFIED, as in the review).
  const { pressError, drawn } = await stopRig($, on, () => ({ result: { message: 'stopped', task_id: 'a1', task_type: 'local_agent' } }), false)
  expect(pressError).toBeUndefined()
  expect(drawn).toContain('>Stopped<')
})

test('the Stop toasts: a stop that worked says Stopped, a denied stop says Could not stop', T5, async ($, on) => {
  const { toasts } = await stopRig($, on, () => ({ result: { message: 'stopped', task_id: 'a1', task_type: 'local_agent' } }))
  expect(toasts.some(text => text.startsWith('Stopped'))).toBe(true)
  expect(toasts.some(text => text.startsWith('Could not stop'))).toBe(false)
})

test('a denied TaskStop still says Could not stop', T5, async ($, on) => {
  const { toasts } = await stopRig($, on, () => ({ deny: 'Denied by the user' }))
  expect(toasts.some(text => text.startsWith('Could not stop') && text.includes('Denied by the user'))).toBe(true)
  expect(toasts.some(text => text.startsWith('Stopped'))).toBe(false)
})
