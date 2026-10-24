// Engine cases through the fake engine: a prompt that does not run leaves the pane idle, and a
// model request that its consumer stops ends the stream it took.

import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Dollar = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

function rig(on: On) {
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }) as never)
}

async function openPane($: Dollar) {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

/** Property: a prompt dropped beneath the mod runs no turn, so the pane never says "Working" for it. */
test('a prompt dropped beneath the mod leaves the orchestrator idle, not Working', async ($, on) => {
  rig(on)
  on('prompt.submit', () => ({ drop: 'blocked' }) as never)
  const ui = await openPane($)
  await $.prompt.submit({ text: 'go', asUser: true } as never)
  expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Idle, nothing done yet$/ })).toBeDefined()
})

/** Property: a prompt that throws beneath the mod leaves the orchestrator idle, not Working. */
test('a prompt that throws beneath the mod leaves the orchestrator idle, not Working', async ($, on) => {
  rig(on)
  on('prompt.submit', () => {
    throw new Error('refused below')
  })
  const ui = await openPane($)
  await $.prompt.submit({ text: 'go', asUser: true } as never).catch(() => undefined)
  expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Idle, nothing done yet$/ })).toBeDefined()
})

/** Property: a prompt that runs shows Working until its turn completes. */
test('a prompt that runs shows Working', async ($, on) => {
  rig(on)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  const ui = await openPane($)
  await $.prompt.submit({ text: 'go', asUser: true } as never)
  expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
})

/**
 * Property: when the consumer of a model request stops reading (return() at a yield), the stream the
 * mod took from below is returned too, so its own cleanup runs; the tokens count once. The test
 * engine also closes a stream below when the one above closes, so this case holds before the fix
 * too; it guards the property for an engine that does not.
 */
test('a consumer that stops a model request ends the upstream stream', async ($, on) => {
  rig(on)
  let upstreamEnded = false
  on('turn.step', async function* () {
    try {
      yield { kind: 'text', index: 0, text: 'one' } as never
      yield { kind: 'text', index: 0, text: 'two' } as never

      return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' } as never
    } finally {
      upstreamEnded = true
    }
  })
  await openPane($)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as never)
  const first = await stream.next()
  expect(first.done).toBe(false)
  expect(upstreamEnded).toBe(false)
  await stream.return(undefined as never)
  expect(upstreamEnded).toBe(true)
})

/** The excluded population: a stream that ends by itself is not returned a second time and still finishes. */
test('a model request read to its end finishes once and its upstream cleanup runs once', async ($, on) => {
  rig(on)
  let cleanups = 0
  on('turn.step', async function* () {
    try {
      yield { kind: 'text', index: 0, text: 'one' } as never

      return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' } as never
    } finally {
      cleanups += 1
    }
  })
  await openPane($)
  const seen: unknown[] = []
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as never)) {
    seen.push(chunk)
  }
  expect(seen).toHaveLength(1)
  expect(cleanups).toBe(1)
})
