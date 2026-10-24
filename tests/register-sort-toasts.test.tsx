// A sort that keeps failing says so once, through the fake engine: a model call that throws, a reply that cannot be read, a book that cannot be written.

import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
type Dollar = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

/** These tests run simulated minutes of ticks, so a loaded machine needs more than the default time. */
const T = { timeoutMs: 120_000 }

const ASSIGN_ALL = JSON.stringify({ categories: ['Code'], assign: { 1: 'Code', 2: 'Code' } })

/** One todo file with two open tickets and no categories.json; `model` answers (or throws) each sort call, `failWrite` makes the categories.json write reject. */
function setup(on: On, model: (call: number) => string | 'throw' | 'blank') {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const calls = { model: 0, writes: 0 }
  const control = { failWrite: true }
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
  on('fs.stat', (_$, e) => ({ value: { kind: e.path.endsWith('.md') || e.path.endsWith('.json') ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: e.path.startsWith('/') ? e.path : `/repo/${e.path === '.' ? '' : e.path}`.replace(/\/$/, '') } }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') || e.path.endsWith('OPEN.md') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }) as never)
  on('fs.read', () => ({ value: '- [ ] #T1 Ship the parser\n- [ ] #T2 Review the copy' }))
  on('fs.write', (_$, e) => {
    if (String(e.path).endsWith('categories.json')) {
      calls.writes += 1
      if (control.failWrite) throw new Error('disk full')
    }

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as unknown as { text?: string; message?: string }).text ?? (e as unknown as { message?: string }).message ?? JSON.stringify(e)))

    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: undefined }) as never)
  on('model.complete', () => {
    calls.model += 1
    const out = model(calls.model)
    if (out === 'throw') throw new Error('model down')

    return { value: out === 'blank' ? { isAnswered: false, text: '' } : { isAnswered: true, text: out, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })

  return { clock, toasts, calls, control }
}

const open = async ($: Dollar) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

/** Ticks of 5 s until the sort has tried `attempts` times (the wait doubles after each failure), at most ten simulated hours. */
async function untilAttempts(clock: { advance: (ms: number) => Promise<void> }, attempts: () => number, count: number) {
  for (let i = 0; i < 7200 && attempts() < count; i += 1) {
    await clock.advance(5000)
  }
}

const sortToasts = (toasts: string[]) => toasts.filter(text => text.includes('Sorting into categories failed'))

test('a categories.json write that keeps failing brings one toast naming the write, after the third failure and not before', T, async ($, on) => {
  const { clock, toasts, calls } = setup(on, () => ASSIGN_ALL)
  await open($)
  await untilAttempts(clock, () => calls.writes, 1)
  await clock.advance(1000)
  expect(calls.writes).toBe(1)
  expect(sortToasts(toasts)).toEqual([])
  await untilAttempts(clock, () => calls.writes, 3)
  await clock.advance(1000)
  expect(calls.writes).toBe(3)
  expect(sortToasts(toasts)).toHaveLength(1)
  expect(sortToasts(toasts)[0]).toContain('categories.json could not be written')
  // A fourth failure does not say it again.
  await untilAttempts(clock, () => calls.writes, 4)
  await clock.advance(1000)
  expect(sortToasts(toasts)).toHaveLength(1)
})

test('a model call that keeps throwing brings one toast with the error, after the third failure', T, async ($, on) => {
  const { clock, toasts, calls } = setup(on, () => 'throw')
  await open($)
  await untilAttempts(clock, () => calls.model, 2)
  await clock.advance(1000)
  expect(sortToasts(toasts)).toEqual([])
  await untilAttempts(clock, () => calls.model, 3)
  await clock.advance(1000)
  expect(sortToasts(toasts)).toHaveLength(1)
  expect(sortToasts(toasts)[0]).toContain('failed 3 times in a row')
})

test('a sort that is written after failures resets the count, so two more failures say nothing', T, async ($, on) => {
  const { clock, toasts, calls, control } = setup(on, () => ASSIGN_ALL)
  await open($)
  await untilAttempts(clock, () => calls.writes, 2)
  control.failWrite = false
  await untilAttempts(clock, () => calls.writes, 3)
  await clock.advance(1000)
  expect(sortToasts(toasts)).toEqual([])
})
