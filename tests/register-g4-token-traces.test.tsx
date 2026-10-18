// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import type { Series } from '../hooks/series'

// Batch G4 (UCR loop 1): the token traces counted per model request, the seed on load, control characters in alts.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Dollar = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Used = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

const used = (n: number): Used => ({ input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })

/** A session over a store the test can seed: one todo file, the agents listed, and a model whose steps report what each call asks. */
function setup(on: On, initial: Record<string, unknown> = {}, todo = '- [ ] #T1 Ship the parser', agents: { id: string; description: string }[] = []) {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>(Object.entries(initial))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: todo }))
  on('agent.list', () => ({ value: agents.map(one => ({ ...one, type: 'general-purpose', status: 'running' })) }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.compact', (_$, e) => ({ messages: e.messages }) as never)
  // Each step: a stop chunk with `stop` usage when given, and a result with `result` usage when given.
  let plan: { stop?: Used; result?: Used } = {}
  on('turn.step', async function* (_$, e) {
    if (plan.stop !== undefined) {
      yield { kind: 'stop', stopReason: 'end_turn', usage: plan.stop } as never
    }

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', ...(plan.result === undefined ? {} : { usage: plan.result }) } as never
  })
  const step = async ($: Dollar, next: { stop?: Used; result?: Used }, agentId?: string) => {
    plan = next
    for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) } as never)) {
      // The stop chunk, when the plan has one.
    }
  }

  return { clock, store, step }
}

const heroOf = async ($: Dollar) => {
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const svgs = (await ui.findAll({ type: 'Svg' })) as { props?: { source?: string; alt?: string } }[]

  return { ui, hero: svgs[0]?.props?.source ?? '', alts: svgs.map(one => one.props?.alt ?? '') }
}

// ---------------------------------------------------------------- UCR-084

// Three states where the trace was empty after a load although the mod held a count: no series key at
// all (the live case), a series key with agent points only, and a compaction just outside the window.
for (const [name, series, minutesAgo, isMarked] of [
  ['no series key', undefined, 5, true],
  ['a series with agent points only', { agents: [[0, 3]], tokens: [], compacts: [] }, 29, true],
  ['a compaction outside the window', undefined, 31, false],
] as const) {
  test(`UCR-084 a load with ${name} draws the trace from the kept count, and the Compacted marker when it is in the window`, async ($, on) => {
    const now = 100 * 60_000
    const compactAt = now - minutesAgo * 60_000
    const { clock, store } = setup(on, { 'tokens:sess-1': { tokens: 603_133_622, since: 0, atCompact: 602_397_694, compactAt }, ...(series === undefined ? {} : { 'series:sess-1': series }) })
    await clock.advance(now)
    // A load that no session.start follows, as after a plugin reload, with no live agent: the command, then the pane.
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
    await clock.advance(1000)
    const hero = ((await ui.findAll({ type: 'Svg' })) as { props?: { source?: string } }[])[0]?.props?.source ?? ''
    // The end label of the token trace holds the count since the compaction, before any model request.
    expect(hero).toContain('>735.9k</tspan>')
    expect(hero.includes('>Compacted<')).toBe(isMarked)
    await clock.advance(6_000)
    const kept = store.get('series:sess-1') as Series
    expect(kept.tokens[kept.tokens.length - 1]?.[1]).toBe(735_928)
    expect(kept.compacts.includes(compactAt)).toBe(isMarked)
  })
}

test('UCR-084 main-loop model requests put points on the trace while the turn runs, before turn.complete', async ($, on) => {
  const { clock, store, step } = setup(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.prompt.submit({ text: 'go' } as never).catch(() => undefined)
  for (let i = 0; i < 3; i += 1) {
    await step($, { result: used(100_000) })
    await clock.advance(31_000)
  }
  expect((store.get('tokens:sess-1') as { tokens: number }).tokens).toBe(300_000)
  const kept = store.get('series:sess-1') as Series
  // A base point of 0 sits under the first request, so its tokens count in tokens per minute (UCR-157).
  expect(kept.tokens.map(point => point[1])).toEqual([0, 100_000, 200_000, 300_000])
  expect((await heroOf($)).hero).toContain('>300.0k</tspan>')
})

// ---------------------------------------------------------------- UCR-092

test('UCR-092 an agent whose run straddles a compaction adds only its later requests to "since compact", and its whole run never again at its end', async ($, on) => {
  const { clock, step } = setup(on, {}, '- [ ] #T1 Ship the parser', [{ id: 'a1', description: 'Long run' }, { id: 'a2', description: 'Short run' }])
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  // Before the compaction: a1 uses 9M, the main loop 1M.
  await step($, { result: used(9_000_000) }, 'a1')
  await step($, { result: used(1_000_000) })
  await clock.advance(31_000)
  await $.session.compact({ messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never).catch(() => undefined)
  await clock.advance(31_000)
  // After it: a1 uses 500k more, a2 runs whole, 250k.
  await step($, { result: used(500_000) }, 'a1')
  await step($, { result: used(250_000) }, 'a2')
  // Each run ends, and the engine reports its whole usage once more (a1: 9.5M, a2: 250k).
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', usage: used(9_500_000) } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a2', usage: used(250_000) } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't3', usage: used(1_000_000) } as never).catch(() => undefined)
  const terminal = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
  expect(await terminal.find({ type: 'Text', text: /Tokens: 750\.0k since compact, 10\.75M total session tokens\./ })).toBeDefined()
  const { hero } = await heroOf($)
  expect(hero).toContain('>750.0k</tspan>')
  expect(hero).toContain('>All tokens since compact<')
})

// ---------------------------------------------------------------- UCR-093

test('UCR-093 every usage is counted once, at its model request: a log of each source against the total', async ($, on) => {
  const { store, step } = setup(on, {}, '- [ ] #T1 Ship the parser', [{ id: 'a1', description: 'Helper' }])
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const log: { source: string; tokens: number; counted: number }[] = []
  const total = () => (store.get('tokens:sess-1') as { tokens: number } | undefined)?.tokens ?? 0
  const run = async (source: string, tokens: number, act: () => Promise<unknown>) => {
    const before = total()
    await act()
    log.push({ source, tokens, counted: total() - before })
  }
  await run('main step, result usage', 1000, () => step($, { result: used(1000) }))
  await run('main step, stop chunk only', 2000, () => step($, { stop: used(2000) }))
  await run('main step, stop chunk and result (the result wins)', 4000, () => step($, { stop: used(3999), result: used(4000) }))
  await run('agent step, result usage', 8000, () => step($, { result: used(8000) }, 'a1'))
  await run('agent step, stop chunk only', 16_000, () => step($, { stop: used(16_000) }, 'a1'))
  await run('main step with no usage', 0, () => step($, {}))
  await run('agent turn.complete, whole-run usage', 0, () => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', usage: used(24_000) } as never).catch(() => undefined))
  await run('main turn.complete, turn usage', 0, () => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', usage: used(7000) } as never).catch(() => undefined))
  console.log(log.map(one => `${one.source.padEnd(52)} ${String(one.tokens).padStart(7)} ${String(one.counted).padStart(7)}`).join('\n'))
  for (const one of log) {
    expect(one.counted).toBe(one.tokens)
  }
  expect(total()).toBe(31_000)
})

// ---------------------------------------------------------------- UCR-038 (narrowed)

// The verifier's characters in a ticket text, in a todo file name and in a Bash command of the main conversation.
for (const bad of ['\x01', '\x07', '\x0B', '\x1B', '\x7F', '\x85', '\x9B']) {
  test(`UCR-038 a control character U+${bad.charCodeAt(0).toString(16).padStart(4, '0')} in a ticket, a file name or a command does not stop the pane drawing`, async ($, on) => {
    mock.clock(on)
    on('store.get', () => ({ value: undefined }) as never)
    on('store.set', () => ({ value: undefined }) as never)
    on('session.id', () => ({ value: 'sess-1' }) as never)
    on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
    on('fs.list', () => ({ value: [{ name: `OPEN${bad}.md`, kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
    on('fs.read', () => ({ value: `- [~] #T1 Ship${bad}the parser\n- [ ] #T2 Review${bad} copy` }))
    on('agent.list', () => ({ value: [] }))
    on('turn.complete', () => ({ text: '' }) as never)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    // The main conversation takes the ticket and runs a command: the orchestrator card shows the command.
    await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 0, total: 1, items: ['#T1'] } as never).catch(() => undefined)
    await $.tool.call({ tool: 'Bash', command: `echo a${bad}b` } as never).catch(() => undefined)
    const { ui, alts } = await heroOf($)
    await ui.press({ key: 'todo-tickets' })
    const again = ((await ui.findAll({ type: 'Svg' })) as { props?: { alt?: string } }[]).map(one => one.props?.alt ?? '')
    // Both views drew, the ticket cards among them, and no alt holds a control character.
    expect(alts.length).toBeGreaterThan(2)
    expect(again.length).toBeGreaterThan(2)
    expect([...alts, ...again].some(alt => /Review ?copy/.test(alt))).toBe(true)
    for (const alt of [...alts, ...again]) {
      expect(alt).not.toMatch(/[\x00-\x1F\x7F-\x9F]/)
    }
  })
}

// ---------------------------------------------------------------- UCR-111

test('UCR-111 a turn that began before the load adds its uncounted steps at its end; a turn seen from its first step adds nothing there', async ($, on) => {
  const { store, step } = setup(on, {}, '- [ ] #T1 Ship the parser', [{ id: 'a1', description: 'Helper' }])
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const total = () => (store.get('tokens:sess-1') as { tokens: number } | undefined)?.tokens ?? 0
  const lateStep = async (turnId: string, index: number, agentId?: string) => {
    for await (const _chunk of $.turn.step({ turnId, index, model: 'm', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) } as never)) {
      // No chunks.
    }
  }
  // The setup's model reports no usage unless planned: plan 1000 a step through one planned step first.
  await step($, { result: used(1000) }, 'a1')
  expect(total()).toBe(1000)
  // Turn L of a1 is first seen at its step 3: steps 0 to 2 ran before the load. One step of 1000 is counted now.
  await lateStep('L', 3, 'a1')
  expect(total()).toBe(2000)
  // Its end reports 4000 for the whole turn: the 3000 never counted go in, once.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'L', agentId: 'a1', usage: used(4000) } as never).catch(() => undefined)
  expect(total()).toBe(5000)
  // The same for the main loop, and a second end of the same turn adds nothing.
  await lateStep('M', 1)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'M', usage: used(2000) } as never).catch(() => undefined)
  expect(total()).toBe(7000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'M', usage: used(2000) } as never).catch(() => undefined)
  expect(total()).toBe(7000)
  // A turn seen from its first step ('t', index 0) adds nothing at its end.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1', usage: used(9000) } as never).catch(() => undefined)
  expect(total()).toBe(7000)
})
}
