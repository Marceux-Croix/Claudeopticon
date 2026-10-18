// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// UCR run 2026-10-17-1, loop 2, batch J5: the pane and the counts through the fake engine (findings 154 to 166).
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Ctx = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Listed = { id: string; description: string; type: string; status: string }

/** The runner's 5 s default is too short for these cases on a loaded machine. */
const T5 = { timeoutMs: 120_000 } as never
const TODO = '/repo/.claude_todo/TODO.md'
const BOOK = '/repo/.claude_todo/categories.json'
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
/** Characters the engine refuses in a pane's text or a Button label. */
const hasControl = (text: string) => /[\x00-\x1F\x7F-\x9F]/.test(text)

/** A small fake repo: files by absolute path, a store, a session ID and an agent list (a trimmed copy of the G3 rig). */
function j5Rig(on: On, files: Record<string, string>, opts: { agents?: () => Listed[]; toasts?: string[]; store?: Map<string, unknown> } = {}) {
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

    return argv[1] === 'rev-parse' ? out(`${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : '.claude_todo/TODO.md')
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
  on('ui.toast', (_$, e) => {
    opts.toasts?.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('agent.list', () => ({ value: opts.agents?.() ?? [] }))
  on('command.register', () => ({ value: undefined }) as never)

  return { store }
}

/** A model that gives every item of a prompt the same category. */
function sorter(on: On, name: string) {
  on('model.complete', (_$, e) => {
    const nums = [...e.prompt.matchAll(/^(\d+)\. /gm)].map(match => match[1]!)

    return { value: { isAnswered: true, text: JSON.stringify({ categories: [name], assign: Object.fromEntries(nums.map(n => [n, name])) }), usage: ZERO } } as never
  })
}

const openJ5 = async ($: Ctx) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}
const labelsOf = async (ui: { findAll: (q: never) => Promise<unknown[]> }) => (await ui.findAll({ type: 'Button' } as never)).map(button => String((button as { props?: { label?: string } }).props?.label))

/**
 * Property (UCR-154): a category name with a control character never reaches a Button label raw,
 * so the engine never refuses the pane. Three states: a name the model sends, a name read from
 * categories.json (also what a committed file gives a clone), and (the excluded population) a name
 * whose only characters are control characters, which is no name.
 */
for (const [label, name] of [['a BEL and an ESC sequence in the middle', 'Bil\u0007ling\u001B[31m'], ['a line break and a tab', 'Bil\nling\t2'], ['a C1 control character at the end of the name', 'Billing\u009B']] as const) {
  test(`UCR-154 a category name from the model with ${label} is cleaned: the pane draws, on the desktop and the terminal, and the book holds the clean name`, T5, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [TODO]: '- [ ] #T1 pay vendor\n- [ ] #T2 sign lease' }
    j5Rig(on, files)
    sorter(on, name)
    const ui = await openJ5($)
    for (let i = 0; i < 12; i += 1) {
      await clock.advance(10_000)
    }
    const book = JSON.parse(files[BOOK] ?? '{"categories":[]}') as { categories: string[] }
    expect(book.categories.length).toBe(1)
    expect(book.categories.some(hasControl)).toBe(false)
    const labels = await labelsOf(ui)
    expect(labels.some(hasControl)).toBe(false)
    expect(labels.some(text => text.includes(book.categories[0]!))).toBe(true)
    const term = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
    expect((await labelsOf(term)).some(hasControl)).toBe(false)
  })
}

for (const [label, stored, shown] of [
  ['a control character in the first name', JSON.stringify({ categories: ['Bil\u0007ling', 'Legal'], items: { '#t1': 'Bil\u0007ling', '#t2': 'Legal' } }), 'Bil ling'],
  ['an ESC sequence in the fifth name (the limit of the kept names)', JSON.stringify({ categories: ['A', 'B', 'C', 'D', 'E\u001B[2J'], items: { '#t1': 'E\u001B[2J', '#t2': 'A' } }), 'E [2J'],
  ['control characters only in a name that an item holds (it is dropped)', JSON.stringify({ categories: ['\u0007', 'Legal'], items: { '#t1': '\u0007', '#t2': 'Legal' } }), 'Legal'],
] as const) {
  test(`UCR-154 a categories.json with ${label} draws the pane with clean button labels`, T5, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [TODO]: '- [ ] #T1 pay vendor\n- [ ] #T2 sign lease', [BOOK]: stored }
    j5Rig(on, files)
    sorter(on, 'Legal')
    const ui = await openJ5($)
    for (let i = 0; i < 3; i += 1) {
      await clock.advance(10_000)
    }
    const labels = await labelsOf(ui)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.some(hasControl)).toBe(false)
    expect(labels).toContain(shown)
    const term = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
    expect((await labelsOf(term)).some(hasControl)).toBe(false)
  })
}

/**
 * Property (UCR-154, the open question of the report): a toast never carries a control character
 * from a ticket's text, a file name or an error. Three states: BEL and ESC in a ticket moved by
 * the user, an ESC clear-screen sequence, and a line break.
 */
for (const [label, text] of [['BEL and ESC', 'pay\u0007 vendor\u001B[2J'], ['an ESC clear-screen sequence at the end', 'pay vendor\u001B[2J'], ['a line break and a carriage return', 'pay\r\nvendor']] as const) {
  test(`UCR-154 the toast for a ticket moved by hand has no control character: ${label}`, T5, async ($, on) => {
    mock.clock(on)
    const toasts: string[] = []
    const files: Record<string, string> = { [TODO]: `- [ ] #T1 ${text}` }
    j5Rig(on, files, { toasts })
    on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: ZERO } }) as never)
    const ui = await openJ5($)
    const buttons = await ui.findAll({ type: 'Button' } as never)
    const start = buttons.map(button => (button as { key?: string }).key ?? (button as { props?: { key?: string } }).props?.key).find(key => String(key).includes('ticket-start'))
    expect(start).toBeDefined()
    await ui.press({ key: start } as never)
    expect(toasts.length).toBeGreaterThan(0)
    for (const toast of toasts) {
      expect(hasControl(String((JSON.parse(toast) as { message?: string; text?: string }).message ?? (JSON.parse(toast) as { text?: string }).text ?? toast))).toBe(false)
    }
  })
}

/** The fake step of the main loop: it answers with the usage in `next`, whatever shape that has. */
function stepper(on: On) {
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
const GOOD = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const altOf = async (ui: { findAll: (q: never) => Promise<unknown[]> }) => JSON.stringify(await ui.findAll({ type: 'Svg' } as never)).match(/Last 30 minutes[^"]*/)?.[0] ?? ''

/**
 * Property (UCR-155): a usage with a field left out, null or not a number adds only the tokens it
 * has, so the session total stays a finite number, is stored as one, and is drawn as one. Three
 * states: the cache fields left out, a null field, and a text field (the excluded population: a
 * usage whose fields are all good still counts in full).
 */
for (const [label, usage] of [
  ['the cache fields left out', { input_tokens: 1000, output_tokens: 500 }],
  ['a null cache field', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: null, cache_creation_input_tokens: 0 }],
  ['a text field in the last place', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 'many' }],
  ['every field good', GOOD],
] as const) {
  test(`UCR-155 a usage with ${label} counts 1500 tokens, never NaN, in the store, on the card and in the terminal`, T5, async ($, on) => {
    mock.clock(on)
    const store = new Map<string, unknown>()
    j5Rig(on, { [TODO]: '- [ ] #T1 Ship the parser' }, { store })
    const step = stepper(on)
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0' } as never).catch(() => undefined)
    await step($, GOOD)
    await step($, usage)
    await step($, GOOD)
    const kept = store.get('tokens:sess-1') as { tokens: number | null }
    expect(kept.tokens).toBe(4500)
    const ui = await openJ5($)
    expect(await altOf(ui)).not.toMatch(/NaN|null|Infinity|e\+/)
    expect(JSON.stringify(await ui.findAll({ type: 'Svg' } as never))).not.toContain('NaN')
    const term = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
    const line = JSON.stringify(await term.find({ type: 'Text', text: /Tokens:/ } as never))
    expect(line).not.toContain('NaN')
    expect(line).toContain('Tokens:')
  })
}

/**
 * Property (UCR-157): the first request of a session counts in tokens per minute, so three
 * requests inside one minute read their sum. Three states: three requests (1000, 2000, 500), one
 * request alone, and (the excluded population) a session that starts from a kept count, whose
 * seeded first point is no usage.
 */
test('UCR-157 three requests inside one minute read 3.5k tokens per minute: the first request counts', T5, async ($, on) => {
  const clock = mock.clock(on)
  j5Rig(on, { [TODO]: '- [ ] #T1 Ship the parser' })
  const step = stepper(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0' } as never).catch(() => undefined)
  await step($, { ...ZERO, input_tokens: 1000 })
  await clock.advance(10_000)
  await step($, { ...ZERO, input_tokens: 2000 })
  await clock.advance(10_000)
  await step($, { ...ZERO, input_tokens: 500 })
  await clock.advance(31_000)
  const ui = await openJ5($)
  expect(await altOf(ui)).toContain('Tokens per minute: 3.5k.')
})

test('UCR-157 one request alone reads its own tokens per minute', T5, async ($, on) => {
  const clock = mock.clock(on)
  j5Rig(on, { [TODO]: '- [ ] #T1 Ship the parser' })
  const step = stepper(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0' } as never).catch(() => undefined)
  await step($, { ...ZERO, input_tokens: 4000 })
  await clock.advance(31_000)
  const ui = await openJ5($)
  expect(await altOf(ui)).toContain('Tokens per minute: 4.0k.')
})

test('UCR-157 a session that starts from a kept count does not count the kept count as usage', T5, async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>([['tokens:sess-1', { tokens: 900_000, since: 0 }]])
  j5Rig(on, { [TODO]: '- [ ] #T1 Ship the parser' }, { store })
  const step = stepper(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0' } as never).catch(() => undefined)
  await step($, { ...ZERO, input_tokens: 1000 })
  await clock.advance(31_000)
  const ui = await openJ5($)
  expect(await altOf(ui)).toContain('Tokens per minute: 1.0k.')
})

/**
 * Property (UCR-156): a press on Stop stops the agent whose card it was drawn on, even when the
 * rows shifted since the draw (a cut past 200 rows takes the oldest from the front). Three states:
 * the card of the second agent, the first card, and the last card (the limit of the rows).
 */
for (const [label, press, stopped] of [['the second card', 1, ['a1']], ['the first card (its agent was cut: nothing is stopped, not its neighbor)', 0, []], ['the last card', 199, ['a199']]] as const) {
  test(`UCR-156 Stop on ${label} stops that card's agent after a 201st agent cut the first row`, T5, async ($, on) => {
    mock.clock(on)
    const stops: string[] = []
    on('fs.exists', () => ({ value: false }))
    on('agent.list', () => ({ value: [] }))
    on('ui.toast', () => ({ value: undefined }) as never)
    on('tool.call', { tool: 'TaskStop' }, (_$, e) => {
      stops.push((e as { task_id?: string }).task_id!)

      return { result: { message: 'stopped', task_id: 'x', task_type: 'local_agent' } } as never
    })
    let spawned = 0
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${spawned++}` }))
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    for (let i = 0; i < 200; i += 1) {
      await $.agent.spawn({ prompt: `Fix ${i}`, description: `Job ${i}`, subagentType: 'engineer' } as never)
    }
    const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
    // The 201st agent cuts the first row: every index shifts by one before the pane draws again.
    await $.agent.spawn({ prompt: 'Fix 200', description: 'Job 200', subagentType: 'engineer' } as never)
    await ui.press({ key: `agent-stop-a${press}` })
    expect(stops).toEqual(stopped)
  })
}

/**
 * Property (UCR-154, toasts): the toast that tells why a Stop failed has no control character from
 * the error text. Three states: BEL, an ESC clear-screen sequence and a line break.
 */
for (const [label, reason] of [['BEL', 'denied\u0007 by policy'], ['an ESC clear-screen sequence', 'denied\u001B[2J'], ['a line break', 'denied\nby\r\npolicy']] as const) {
  test(`UCR-154 the toast for a failed Stop carries no control character: ${label}`, T5, async ($, on) => {
    mock.clock(on)
    const toasts: string[] = []
    on('fs.exists', () => ({ value: false }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'Parser', type: 'engineer', status: 'running' }] }) as never)
    on('tool.call', { tool: 'TaskStop' }, () => ({ deny: reason }) as never)
    on('ui.toast', (_$, e) => {
      toasts.push((e as unknown as { text: string }).text)

      return { value: undefined } as never
    })
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    await $.agent.spawn({ prompt: 'Fix the parser', description: 'Parser', subagentType: 'engineer' } as never)
    const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
    await ui.press({ key: 'agent-stop-a1' })
    const failed = toasts.filter(text => text.startsWith('Could not stop'))
    expect(failed.length).toBe(1)
    expect(failed[0]).toContain('Could not stop A1: denied')
    expect(toasts.some(hasControl)).toBe(false)
  })
}

/**
 * Property (UCR-166): the terminal pane keys an agent by its ID, a todo item by its key, and
 * the links of an agent by their place, so an insert or a cut does not remount every row below it
 * and two links with the same text do not share a key.
 */
test('UCR-166 the terminal pane keys agents by ID and items by their key, and two links of one text get two keys', T5, async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [ ] #T1 Fix the parser\n- [ ] #T2 Fix the parser\n- [ ] #T3 Ship it' }
  j5Rig(on, files, { agents: () => [{ id: 'a1', description: 'Fix the parser', type: 'engineer', status: 'running' }] })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: ZERO } }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Work on #T1 and #T2', description: 'Fix the parser', subagentType: 'engineer' } as never)
  await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 0, total: 2, items: ['#T1', '#T2'] } as never).catch(() => undefined)
  const term = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
  const keys = (await term.findAll({} as never)).map(one => String((one as { key?: string }).key)).filter(key => key !== 'undefined')
  expect(keys).toContain('a-a1')
  expect(keys).not.toContain('a-0')
  expect(keys.filter(key => key.startsWith('TODO.md:')).sort()).toEqual(['TODO.md:#t1', 'TODO.md:#t2', 'TODO.md:#t3'])
  // The two links of the agent follow its key in the tree: two keys, by place (they were one key, the text, when the texts matched).
  const at = keys.indexOf('a-a1')
  expect(keys.slice(at + 1, at + 3)).toEqual(['link-0', 'link-1'])
})
}
