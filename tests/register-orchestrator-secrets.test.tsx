// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// Hook cases on the orchestrator fakes: a hidden secret through the hooks, and a ticket card that keeps its key.
{
// Batch F : secrets, SVG validity, code-point cuts, graph labels, counts, keys, link cost.

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Dollar = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

function orchSetup($: Dollar, on: On) {
  mock.clock(on)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: '- [ ] #T1 Ship the parser' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Helper', type: 'general-purpose', status: 'running' }] }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
}

test('a Bash call with a secret and no description shows nowhere on the card or in the terminal view', async ($, on) => {
  orchSetup($, on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', agentId: 'a1' } as never).catch(() => undefined)
  await $.tool.call({ tool: 'Bash', command: 'curl --password hunter2 u' } as never)
  await $.tool.call({ tool: 'Bash', command: 'PGPASSWORD=hunter2 psql' } as never)
  const desktop = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const cards = JSON.stringify(await desktop.findAll({ type: 'Svg' }))
  expect(cards).toContain('Bash: (hidden)')
  expect(cards).not.toContain('hunter')
  const terminal = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
  const text = JSON.stringify(await terminal.drawn())
  expect(text).toContain('(hidden)')
  expect(text).not.toContain('hunter')
})

// ---------------------------------------------------------------- 

test('a ticket card keeps its key when a ticket above it leaves', async ($, on) => {
  const clock = mock.clock(on)
  const state = { file: '- [ ] #T1 Alpha ticket\n- [ ] #T2 Beta ticket\n- [ ] #T3 Gamma ticket', mtime: 1 }
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: state.mtime, isLink: false }] }))
  on('fs.read', () => ({ value: state.file }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await clock.advance(3000)
  const alts = async () => (await ui.findAll({ type: 'Svg' })).map(node => (node as { props?: { alt?: string } }).props?.alt ?? '')
  // The key of each ticket's box: it has to name the ticket, not its place in the column.
  const keys = async () => (await ui.findAll({ type: 'Box' })).map(node => String((node as { key?: string }).key)).filter(key => key.startsWith('file-board-t-'))
  // The pane may open on the list view; the board view is the one with ticket cards.
  if (!(await alts()).some(alt => alt.includes('Alpha'))) {
    await ui.press({ key: 'todo-tickets' })
  }
  const before = await keys()
  expect(before.length).toBe(3)
  state.file = '- [ ] #T2 Beta ticket\n- [ ] #T3 Gamma ticket'
  state.mtime += 1
  await $.tool.call({ tool: 'Edit', file_path: '/repo/.claude_todo/OPEN.md' } as never)
  await clock.advance(5000)
  const after = await keys()
  expect(after.length).toBe(2)
  // The cards below the one that left keep their keys, so they do not remount.
  expect(after).toEqual(before.slice(1))
  expect(new Set(after).size).toBe(2)
})
}
