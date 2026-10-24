// move_ticket and the confirmation dialog, through the fake engine: a dialog that could not be shown is not the user's "keep".

import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

const MOVE = { tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'queued', reason: 'order the work' } as never

test('a move_ticket whose confirmation dialog cannot be shown says the user has not decided, not that the user kept the ticket', async ($, on) => {
  mock.clock(on)
  const state = { answer: 'throw' as string }
  const written: string[] = []
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return out('/repo\n/repo/.git\n')
    if (argv[0] === 'git' && argv[1] === 'worktree') return out('worktree /repo\nHEAD a\nbranch refs/heads/main\n')
    if (argv[0] === 'git' && argv[1] === 'ls-files') return out('.claude_todo/OPEN.md\0')
    if (argv[0] === 'printenv') return argv[1] === 'HOME' ? out('/home/a\n') : out('', 1)
    if (argv[0] === 'uname') return out('Darwin\n')

    return out('', 1)
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  on('fs.stat', (_$, e) => ({ value: { kind: e.path.endsWith('.md') ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: e.path.startsWith('/') ? e.path : `/repo/${e.path === '.' ? '' : e.path}`.replace(/\/$/, '') } }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') || e.path.endsWith('OPEN.md') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }) as never)
  on('fs.read', () => ({ value: '- [ ] #T1 Ship the parser' }))
  on('fs.write', (_$, e) => {
    written.push(String(e.text))

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: undefined }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    if (state.answer === 'throw') throw new Error('no dialog')
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question

    return { result: { questions: [], answers: { [question]: state.answer } } } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const move = async () => String(((await $.tool.call(MOVE)) as { result?: unknown }).result)
  // The dialog cannot be shown: no decision, nothing written, and not the words of a user who kept the ticket.
  const failed = await move()
  expect(failed).toContain('could not be shown')
  expect(failed).not.toContain('the user kept')
  expect(written).toEqual([])
  // The user keeps the ticket: the old refusal.
  state.answer = 'Keep it where it is'
  expect(await move()).toContain('the user kept')
  // The user agrees: it moves.
  state.answer = 'Move it'
  await move()
  expect(written.join('\n')).toContain('- [>] #T1')
})
