// The presence step through the fake engine: when this session writes its record and reads its peers'.

import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
type Dollar = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

const KEY = 'presence:sess-1'

/** A pane over one todo file and a shared store. `failGet` and `failSet` make the reads and writes of the presence key reject. */
function setup(on: On) {
  const fail = { get: false, set: false }
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  const log = { sets: [] as unknown[], gets: [] as string[] }
    on('store.get', (_$, e) => {
    log.gets.push(e.key)
    if (fail.get && e.key === KEY) throw new Error('store unavailable')

    return { value: store.get(e.key) } as never
  })
  on('store.set', (_$, e) => {
    if (e.key === KEY) {
      log.sets.push(e.value)
      if (fail.set) throw new Error('store full')
    }
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
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
  on('fs.stat', (_$, e) => ({ value: { kind: e.path.endsWith('.md') ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: e.path.startsWith('/') ? e.path : `/repo/${e.path === '.' ? '' : e.path}`.replace(/\/$/, '') } }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') || e.path.endsWith('OPEN.md') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }) as never)
  on('fs.read', () => ({ value: '- [ ] #T1 Ship the parser' }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: undefined }) as never)

  return { clock, store, log, fail }
}

const open = async ($: Dollar) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}
const run = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    await clock.advance(1000)
    await settle()
  }
}

test('no record without a name is written while the stored name could not be read; the stored name is kept after the read works', async ($, on) => {
  const { clock, store, log, fail } = setup(on)
  store.set(KEY, { v: 1, sessionId: 'sess-1', name: 'Kept name', root: '/repo', tickets: [], agentTickets: [], planned: [], seenAt: 1 })
  fail.get = true
  await open($)
  await run(clock, 8)
  expect(log.sets).toEqual([])
  fail.get = false
  await run(clock, 8)
  expect(log.sets.length).toBeGreaterThan(0)
  expect(log.sets.every(record => (record as { name?: string }).name === 'Kept name')).toBe(true)
})

test('a presence write that fails is tried again after the heartbeat wait, not on every tick', async ($, on) => {
  const { clock, log, fail } = setup(on)
  fail.set = true
  await open($)
  await run(clock, 4)
  // The first tick tries once; the next ticks within the wait do not.
  expect(log.sets.length).toBe(1)
  await run(clock, 10)
  expect(log.sets.length).toBeGreaterThan(1)
  expect(log.sets.length).toBeLessThanOrEqual(4)
})
