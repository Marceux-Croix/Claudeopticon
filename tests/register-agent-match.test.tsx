// The model match of a new agent to todo items, through the fake engine.

import { expect, mock, test } from 'claude-code/testing'

test('a queued ticket is offered to the model match of an agent that names no ticket', async ($, on) => {
  const clock = mock.clock(on)
  const asked: string[] = []
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: '- [>] Cache cleanup: close every open database connection\n- [ ] Something unrelated' }))
  on('agent.list', () => ({ value: [{ id: 'm1', description: 'Close database connections', type: 'engineer', status: 'running' }] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'm1' }))
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)

    return { value: { isAnswered: true, text: '{"items": [1]}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Close every open database connection', description: 'Close database connections', subagentType: 'engineer' } as never)
  for (let i = 0; i < 5; i += 1) {
    await clock.advance(2000)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${i}`, agentId: 'm1' } as never).catch(() => undefined)
  }
  const prompt = asked.find(one => one.startsWith('An agent was started')) ?? ''
  expect(prompt).toContain('Cache cleanup')
  // Queued tickets come before open ones.
  expect(prompt.indexOf('Cache cleanup')).toBeLessThan(prompt.indexOf('Something unrelated'))
})
