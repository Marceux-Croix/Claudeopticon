// Engine case: an agent's color slot stays put when an idle agent wakes (the replay of a woken agent holds its slot from its start).

import { expect, mock, test } from 'claude-code/testing'

import { AGENT_COLORS } from '../hooks/agent-identity'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

test('an agent started while another was idle keeps its color when the idle one wakes', async ($, on) => {
  const clock = mock.clock(on)
  const spawned = ['a1', 'b1']
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: spawned.shift() ?? 'z' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Gate fixes', type: 'engineer', status: 'running' }, { id: 'b1', description: 'Docs pass', type: 'engineer', status: 'running' }] }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Fix the gate', description: 'Gate fixes', subagentType: 'engineer' } as never)
  await clock.advance(1000)
  // A1 goes idle, which frees its color; B1 starts after that and takes the same one.
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  await clock.advance(1000)
  await $.agent.spawn({ prompt: 'Write the docs', description: 'Docs pass', subagentType: 'engineer' } as never)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await clock.advance(6000)
  const second = AGENT_COLORS[1]!
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' })).includes(second)).toBe(false)
  // A1 works again: it holds its first color from its start, and B1 must not move to the second.
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List', agentId: 'a1' } as never)
  await clock.advance(6000)
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' })).includes(second)).toBe(false)
})
