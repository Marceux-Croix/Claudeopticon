// A tick whose work keeps throwing says so once, through the fake engine.

import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

test('ticks whose agent refresh keeps throwing bring one toast after the third in a row, and a tick that works resets the count', async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const state = { isBroken: false }
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => {
    if (state.isBroken) throw new Error('list failed')

    return { value: [{ id: 'a1', description: 'Gate fixes', type: 'engineer', status: 'running' }] } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: undefined }) as never)
  const failedToasts = () => toasts.filter(text => text.includes('could not refresh'))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Fix the gate', description: 'Gate fixes', subagentType: 'engineer' } as never)
  await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await clock.advance(2000)
  expect(failedToasts()).toEqual([])
  state.isBroken = true
  // Two failing ticks: nothing yet.
  await clock.advance(2000)
  expect(failedToasts()).toEqual([])
  // Past the third: one toast, and no second one however long it goes on.
  await clock.advance(10_000)
  expect(failedToasts()).toHaveLength(1)
  await clock.advance(10_000)
  expect(failedToasts()).toHaveLength(1)
  // A tick that works resets the count: the next three failures bring one more.
  state.isBroken = false
  await clock.advance(3000)
  state.isBroken = true
  await clock.advance(10_000)
  expect(failedToasts()).toHaveLength(2)
})

/**
 * Property: an agent list that never answers fails each refresh after RUN_LIMIT_MS, so the ticks go on and the failure is
 * told once, instead of one hung call holding every later tick with no word (-015).
 */
test('an agent list that never answers fails the refresh in time, and the third failure brings one toast', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const state = { isHung: false }
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => (state.isHung ? (new Promise(() => undefined) as never) : ({ value: [{ id: 'a1', description: 'Gate fixes', type: 'engineer', status: 'running' }] } as never)))
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: undefined }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Fix the gate', description: 'Gate fixes', subagentType: 'engineer' } as never)
  await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await clock.advance(2000)
  state.isHung = true
  for (let i = 0; i < 8; i += 1) {
    await clock.advance(21_000)
  }
  expect(toasts.filter(text => text.includes('could not refresh'))).toHaveLength(1)
})
