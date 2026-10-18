// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { psPath } from '../hooks/path-forms'

// Hook cases of batch G5 (UCR loop 1): the guards a mutation got past, on a fake repo
// that can change a file right after a read, lose or change a write, fail a write, and fail mkdir.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Dollar = Parameters<Parameters<typeof test>[1]>[0]

/** The path a PowerShell script names through `psPath`, with forward slashes. */
const fromPs = (script: string) => String.fromCodePoint(...(/\[char\[\]\]\(([\d,]+)\)/.exec(script)![1]!.split(',').map(Number))).replace(/\\/g, '/')

/**
 * The fake repo of the first suite (copied), plus: `afterRead` runs right after each read (a test
 * changes a file there, as another writer would); `onWrite` gives the text the disk keeps (a lost or
 * changed write); `failWrite` makes a write throw; `mkdirExit` is the exit code of `mkdir -p`.
 */
function repoWith(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string>; uname?: string; failing?: string[]; stays?: string[]; exits?: Record<string, number>; log?: string[]; dangling?: string[]; hold?: Promise<void>; afterRead?: (path: string) => void; onWrite?: (path: string, text: string) => string | undefined; failWrite?: (path: string) => boolean; mkdirExit?: number }) {
  const R = opts.root ?? '/repo'
  const state = { hasNearest: opts.hasNearest, listed: opts.listed }
  const writes: string[] = []
  const calls: string[] = []
  // Every write moves every file's mtime on, as a real disk would, so a rescan reads the new text.
  let stamp = 0
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never

    const fail = { value: { exitCode: 1, stdout: '', stderr: 'failed' } } as never
    const dirEmpty = (dir: string) => !Object.keys(files).some(path => path.startsWith(`${dir}/`))

    if (argv[0] === 'uname') {
      return out(`${opts.uname ?? 'Darwin'}\n`)
    }
    // The mod reads HOME to know the global todo folder; CLAUDE_CONFIG_DIR is unset.
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : fail
    }
    if (['/usr/bin/trash', 'osascript', 'gio', 'trash-put', 'kioclient5', 'powershell.exe'].includes(argv[0]!)) {
      const script = argv[argv.length - 1]!
      if (argv[0] === 'powershell.exe' && script.startsWith('[System.IO.Directory]::Delete(')) {
        return dirEmpty(fromPs(script)) ? out('') : fail
      }
      if (opts.failing?.includes(argv[0]!)) {
        return fail
      }
      const path =
        argv[0] === 'osascript' ? /POSIX file "(.*)"$/.exec(script)![1]!.replace(/\\(.)/g, '$1')
        : argv[0] === 'powershell.exe' ? fromPs(script)
        : argv[0] === 'kioclient5' ? argv[2]!
        : argv[argv.length - 1]!
      if (!opts.stays?.includes(argv[0]!)) {
        delete files[path]
      }

      return out('')
    }
    if (['open', 'xdg-open', 'explorer.exe'].includes(argv[0]!)) {
      return opts.failing?.includes(argv[0]!) ? fail : ({ value: { exitCode: opts.exits?.[argv[0]!] ?? 0, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'rm') {
      delete files[argv[2]!]

      return out('')
    }
    if (argv[0] === 'mkdir') {
      return { value: { exitCode: opts.mkdirExit ?? 0, stdout: '', stderr: '' } } as never
    }
    if (argv[0] === 'rmdir') {
      return dirEmpty(argv[2]!) ? out('') : fail
    }

    return argv[1] === 'rev-parse' ? out(opts.rev ?? `${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : state.listed.join('\0'))
  })
  // The engine may hand the session folder's own paths over made absolute: match by their ends.
  // It does the same to a Windows path (`C:/repo`), which `abs` hands back whole.
  const abs = (path: string) => /[A-Za-z]:\/.*$/.exec(path)?.[0] ?? path
  on('fs.exists', (_$, e) => ({ value: abs(e.path).endsWith('.git') || (abs(e.path).endsWith('.claude_todo') && !inside(abs(e.path)) && state.hasNearest) || (inside(abs(e.path)) && (abs(e.path) in files || Object.keys(files).some(path => path.startsWith(`${abs(e.path)}/`)))) }))
  on('fs.stat', (_$, e) => {
    // The home folder is outside the fake repo and does not exist there.
    if (abs(e.path).startsWith('/home/a/.claude') && !inside(abs(e.path))) {
      throw new Error('ENOENT')
    }

    return (opts.log?.push(`stat:${abs(e.path)}`), { value: { kind: abs(e.path) in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.links?.[abs(e.path)] ?? (inside(abs(e.path)) ? abs(e.path) : !abs(e.path).includes('.claude_todo') && !abs(e.path).includes('.git') ? R : `${R}/.claude_todo`) } }) as never
  })
  on('fs.list', (_$, e) => ({ value: [...(inside(abs(e.path)) ? names(abs(e.path)) : state.hasNearest ? names(`${R}/.claude_todo`) : []), ...(opts.dangling ?? []).filter(path => path.slice(0, path.lastIndexOf('/')) === abs(e.path)).map(path => path.slice(path.lastIndexOf('/') + 1))].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2 + stamp, isLink: false })) }))
  on('fs.read', (_$, e) => {
    opts.log?.push(`read:${abs(e.path)}`)
    const value = files[inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`] ?? ''
    // Another writer acts right after this read, before the mod's next call.
    opts.afterRead?.(abs(e.path))

    return { value }
  })
  on('fs.write', async (_$, e) => {
    const path = inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`
    opts.log?.push(`write:${path}`)
    // A held write: the test presses a button while this write is in flight.
    if (opts.hold !== undefined && e.text !== '') {
      await opts.hold
    }
    if (opts.failWrite?.(path) === true) {
      throw new Error(`ENOENT: ${path}`)
    }
    files[path] = opts.onWrite?.(path, e.text as string) ?? (e.text as string)
    stamp += 1
    // Every write counts, the empty archive file that Show completed makes too: a test
    // that says nothing is written must see that one.
    writes.push(path)

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  // A working store: the archive move waits while its record cannot be read (G3).
  const kept = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: kept.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    kept.set(e.key, e.value)

    return { value: undefined } as never
  })

  return { state, writes, calls }
}


const LIVE = '/repo/.claude_todo/TODO.md'
const ARCHIVE = '/repo/.claude_todo/archive/TODO.md'

const rmCalls = (calls: string[]) => calls.filter(call => call.startsWith('rm'))
const trashed = (calls: string[]) => calls.filter(call => call.startsWith('/usr/bin/trash ')).sort()

const open = async ($: Dollar) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

const keysOf = async (ui: Awaited<ReturnType<typeof open>>) => (await ui.findAll({ type: 'Button' })).map(button => String((button as { key?: string }).key))

// ---------------------------------------------------------------- the archive move

for (const [name, change, check] of [
  [
    'the archive gained a line',
    (files: Record<string, string>) => {
      files[ARCHIVE] = `${files[ARCHIVE]}- [x] #T5 Added by hand\n`
    },
    (files: Record<string, string>) => {
      expect(files[ARCHIVE]).toContain('#T5 Added by hand')
      expect(`${files[ARCHIVE]}${files[LIVE]}`).toContain('#T1 Done')
    },
  ],
  [
    'the archive became a symlink',
    (_files: Record<string, string>, links: Record<string, string>) => {
      links[ARCHIVE] = '/home/a/other/TODO.md'
    },
    (files: Record<string, string>) => {
      expect(files[ARCHIVE]).toBe('- [x] #T0 Old\n')
      expect(files[LIVE]).toContain('#T1 Done')
    },
  ],
  [
    'the archive was removed',
    (files: Record<string, string>) => {
      delete files[ARCHIVE]
    },
    (files: Record<string, string>) => {
      expect(files[ARCHIVE] ?? '').not.toContain('#T0 Old')
      expect(`${files[ARCHIVE] ?? ''}${files[LIVE]}`).toContain('#T1 Done')
    },
  ],
] as const) {
  test(`the archive move compares the archive last before its write: ${name} after the first read stops it`, async ($, on) => {
    const clock = mock.clock(on)
    const log: string[] = []
    const links: Record<string, string> = {}
    const files: Record<string, string> = { [LIVE]: '- [x] #T1 Done\n- [ ] #T2 Open', [ARCHIVE]: '- [x] #T0 Old\n' }
    let isChanged = false
    repoWith(on, files, {
      hasNearest: true,
      listed: ['.claude_todo/TODO.md'],
      log,
      links,
      // The move's first read of the archive comes right after its stat (the scan's read does not).
      afterRead: path => {
        if (!isChanged && path === ARCHIVE && log[log.length - 2] === `stat:${ARCHIVE}`) {
          isChanged = true
          change(files, links)
        }
      },
    })
    await open($)
    await clock.advance(12000)
    expect(isChanged).toBe(true)
    check(files)
  })
}

for (const [name, keep] of [
  ['the write was lost', (_text: string, before: string) => before],
  ['the write lost one of two blocks', (text: string) => text.replace('- [x] #T3 Also done\n', '')],
  ['the write landed changed', (text: string) => text.replace('#T1 Done', '#T1 Dome')],
] as const) {
  test(`the archive move confirms the blocks on disk before it cuts the source: ${name}`, async ($, on) => {
    const clock = mock.clock(on)
    const text = '- [x] #T1 Done\n- [ ] #T2 Open\n- [x] #T3 Also done'
    const files: Record<string, string> = { [LIVE]: text, [ARCHIVE]: '- [x] #T0 Old\n' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], onWrite: (path, next) => (path === ARCHIVE ? keep(next, files[ARCHIVE] ?? '') : undefined) })
    await open($)
    await clock.advance(12000)
    // Not confirmed: the source keeps both closed tickets.
    expect(files[LIVE]).toBe(text)
  })
}

// ---------------------------------------------------------------- Consolidate

for (const [name, keep] of [
  ['the write was lost', (_text: string, before: string) => before],
  ['the write lost one of two sections', (text: string) => text.replace('\n## From mods/x/TODO.md\n\n- [ ] #T3 Docs\n', '')],
  ['the write landed changed', (text: string) => text.replace('## From BACKLOG.md', '## From BACKLOG')],
] as const) {
  test(`Consolidate confirms the target on disk before it empties a source: ${name}`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = {
      [LIVE]: '- [ ] #T1 Fix',
      '/repo/.claude_todo/BACKLOG.md': '- [ ] #T2 Backlog item',
      '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Docs',
    }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/BACKLOG.md', 'mods/x/.claude_todo/TODO.md'], onWrite: (path, next) => (path === LIVE ? keep(next, files[LIVE] ?? '') : undefined) })
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    expect(files['/repo/.claude_todo/BACKLOG.md']).toBe('- [ ] #T2 Backlog item')
    expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] #T3 Docs')
  })
}

// ---------------------------------------------------------------- Delete empty todos

for (const [name, path, link] of [
  ['a file that became a symlink', '/repo/.claude_todo/BACKLOG.md', '/repo/.claude_todo/BACKLOG.md'],
  ['an archive file that became a symlink', '/repo/.claude_todo/archive/EMPTY.md', '/repo/.claude_todo/archive/EMPTY.md'],
  ['a file whose folder became a symlink', '/repo/mods/y/.claude_todo/NOTES.md', '/repo/mods/y/.claude_todo'],
] as const) {
  test(`Delete empty todos checks each file again at the press: ${name} after the scan is kept`, async ($, on) => {
    mock.clock(on)
    const links: Record<string, string> = {}
    const files: Record<string, string> = {
      [LIVE]: '- [ ] #T1 stays',
      '/repo/.claude_todo/BACKLOG.md': '',
      '/repo/.claude_todo/archive/EMPTY.md': '',
      '/repo/mods/y/.claude_todo/NOTES.md': '',
    }
    const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/BACKLOG.md', '.claude_todo/archive/EMPTY.md', 'mods/y/.claude_todo/NOTES.md'], links })
    const ui = await open($)
    expect(await keysOf(ui)).toContain('todo-delete-empty')
    links[link] = '/home/a/elsewhere'
    await ui.press({ key: 'todo-delete-empty' })
    expect(trashed(calls)).not.toContain(`/usr/bin/trash ${path}`)
    expect(files[path]).toBe('')
    // The other empty files still go.
    expect(trashed(calls).length).toBe(2)
    expect(rmCalls(calls).filter(call => call.startsWith('rm --'))).toEqual([])
  })
}

// ---------------------------------------------------------------- writeFile makes a missing folder

for (const [name, exit, isWritten] of [
  ['mkdir works', 0, true],
  ['mkdir fails', 1, false],
  ['mkdir is not found', 127, false],
] as const) {
  test(`a write into a missing archive folder makes it with mkdir -p and writes again: ${name}`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [LIVE]: '- [x] #T1 Done\n- [ ] #T2 Open' }
    const holder: { calls: string[] } = { calls: [] }
    const made = () => exit === 0 && holder.calls.includes('mkdir -p /repo/.claude_todo/archive')
    const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], mkdirExit: exit, failWrite: path => path === ARCHIVE && !made() })
    holder.calls = calls
    await open($)
    await clock.advance(12000)
    expect(calls).toContain('mkdir -p /repo/.claude_todo/archive')
    if (isWritten) {
      expect(files[ARCHIVE]).toBe('- [x] #T1 Done\n')
      expect(files[LIVE]).toBe('- [ ] #T2 Open')
    } else {
      expect(files[ARCHIVE]).toBeUndefined()
      expect(files[LIVE]).toBe('- [x] #T1 Done\n- [ ] #T2 Open')
    }
  })
}

// ---------------------------------------------------------------- agents

function idleSetup(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const clock = mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Gate fixes', type: 'engineer', status: 'running' }] }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })

  return clock
}

for (const [name, act] of [
  ['a tool call', ($: Dollar) => $.tool.call({ tool: 'Bash', command: 'ls', description: 'List', agentId: 'a1' } as never)],
  ['a model request', async ($: Dollar) => {
    for await (const _chunk of $.turn.step({ turnId: 't2', index: 0, model: 'm', messageCount: 1, agentId: 'a1' } as never)) {
      // The base hook yields no chunks.
    }
  }],
] as const) {
  test(`${name} of an idle agent makes it live again`, async ($, on) => {
    const clock = idleSetup(on)
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    await $.agent.spawn({ prompt: 'Fix the gate', description: 'Gate fixes', subagentType: 'engineer' } as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
    const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
    expect(JSON.stringify(await ui.findAll({ type: 'Svg' })).includes('>Idle<')).toBe(true)
    await act($)
    // The next redraw is at most CLOCK_MS (5 s) away.
    await clock.advance(6000)
    const svgs = JSON.stringify(await ui.findAll({ type: 'Svg' }))
    expect(svgs.includes('>Idle<')).toBe(false)
    expect(svgs.includes('Agents: 1 live')).toBe(true)
  })
}

for (const [name, isSpawned] of [
  ['an agent the mod started', true],
  ['an agent first seen in the list', false],
] as const) {
  test(`${name} is matched to its tickets by the model once, however many refreshes see it`, async ($, on) => {
    const clock = mock.clock(on)
    const asked: string[] = []
    on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
    on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
    on('fs.read', () => ({ value: '- [~] Cache cleanup: close every open database connection\n- [ ] Something unrelated' }))
    on('agent.list', () => ({ value: [{ id: 'm1', description: 'Close database connections', type: 'engineer', status: 'running' }] }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'm1' }))
    on('model.complete', (_$, e) => {
      asked.push(e.prompt)

      return { value: { isAnswered: true, text: '{"items": [1]}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    if (isSpawned) {
      await $.agent.spawn({ prompt: 'Close every open database connection', description: 'Close database connections', subagentType: 'engineer' } as never)
    }
    for (let i = 0; i < 5; i += 1) {
      await clock.advance(2000)
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${i}`, agentId: 'm1' } as never).catch(() => undefined)
    }
    expect(asked.filter(prompt => prompt.startsWith('An agent was started')).length).toBe(1)
  })
}

for (const [name, answer] of [
  ['TaskStop is denied', () => ({ deny: 'Denied by the user' })],
  ['TaskStop reports an error', () => ({ result: 'no such task', isError: true })],
  ['TaskStop throws', () => {
    throw new Error('engine down')
  }],
] as const) {
  test(`Stop leaves the agent running and says why when ${name}`, async ($, on) => {
    mock.clock(on)
    on('fs.exists', () => ({ value: false }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'Parser', type: 'engineer', status: 'running' }] }) as never)
    on('tool.call', { tool: 'TaskStop' }, answer as never)
    const toasts: string[] = []
    on('ui.toast', (_$, e) => {
      toasts.push(JSON.stringify(e))

      return { value: undefined } as never
    })
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    await $.agent.spawn({ prompt: 'Fix the parser', description: 'Parser', subagentType: 'engineer' } as never)
    const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
    await ui.press({ key: 'agent-stop-a1' })
    expect(toasts.join('\n')).toContain('Could not stop A1')
    expect(toasts.join('\n')).not.toContain('Stopped A1')
    const svgs = JSON.stringify(await ui.findAll({ type: 'Svg' }))
    expect(svgs.includes('>Running<')).toBe(true)
    expect(svgs.includes('>Stopped<')).toBe(false)
  })
}

test('a helper is asked to confirm or name its items every 10 minutes, in the reply to a report it makes anyway', async ($, on) => {
  let now = 1_000_000
  on('clock.now', () => ({ value: now }) as never)
  on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Parser', type: 'engineer', status: 'running' }] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Fix the parser', description: 'Parser', subagentType: 'engineer' } as never)
  const report = async (extra: Record<string, unknown> = {}) => String(((await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 1, total: 3, agentId: 'a1', ...extra } as never)) as { result?: unknown }).result)
  expect(await report()).toContain('Noted.')
  now += 9 * 60_000
  expect(await report()).not.toContain('pass them as items')
  // State 1: no claims, 10 minutes after the first report: asked to name them.
  now += 60_000
  expect(await report()).toContain('pass them as items in your next report')
  // State 2: right after a check: not asked again.
  expect(await report()).not.toContain('pass them as items')
  // State 3: claims made, then 10 minutes with reports that name none: asked to confirm them.
  await report({ items: ['#T2 Review the copy'] })
  now += 10 * 60_000
  expect(await report()).toContain('You said you handle: "#T2 Review the copy"')
})

// ---------------------------------------------------------------- the orchestrator

const ORCH_FILE = '- [ ] #T1 Ship the parser\n- [ ] #T2 Review the copy\n- [~] #T3 Check the invoice'
const PROGRESS = 'mcp__claudeopticon__report_progress'

/** A pane over one todo file, with a helper a1; `contexts` are the prompt contexts, `edit` changes the file as the main conversation. */
function orchSetup($: Dollar, on: Parameters<Parameters<typeof test>[1]>[1], file = ORCH_FILE) {
  const state = { file, mtime: 1, status: 'running' }
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: state.mtime, isLink: false }] }))
  on('fs.read', () => ({ value: state.file }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Helper #T0026', type: 'general-purpose', status: state.status }] }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} }) as never)
  const contexts: string[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push((e.context ?? []).join('\n'))

    return { text: e.text, context: e.context }
  })
  const edit = (next: string) => {
    state.file = next
    state.mtime += 1

    return $.tool.call({ tool: 'Edit', file_path: '/repo/.claude_todo/OPEN.md' } as never)
  }

  return { state, clock, edit, contexts }
}

async function begin($: Dollar): Promise<void> {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', agentId: 'a1' } as never).catch(() => undefined)
}

const orchCardOf = async (ui: Awaited<ReturnType<typeof open>>) => (await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg)).find(svg => svg.includes('O, Orchestrator')) ?? ''

for (const [name, extra] of [
  ['with items', { items: ['#T2'] }],
  ['with no items', {}],
] as const) {
  test(`a helper's report_progress title never titles the orchestrator card while it owns a ticket: ${name}`, async ($, on) => {
    orchSetup($, on)
    await begin($)
    const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
    await $.tool.call({ tool: PROGRESS, done: 0, total: 2, items: ['#T2'], title: 'Main headline' } as never)
    expect(await orchCardOf(ui)).toContain('>Main headline<')
    await $.tool.call({ tool: PROGRESS, done: 1, total: 2, title: 'Helper headline', agentId: 'a1', ...extra } as never)
    const card = await orchCardOf(ui)
    expect(card).toContain('>Main headline<')
    expect(card).not.toContain('Helper headline')
  })
}

test('a note for Claude waits for a main-conversation tool call that runs: a denied call does not take it', async ($, on) => {
  const { state } = orchSetup($, on, '- [~] #T0026 Ship the parser')
  on('tool.call', { tool: 'Bash' }, () => ({ deny: 'Denied by the user' }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }) as never)
  await begin($)
  await $.agent.spawn({ prompt: 'Work on #T0026', description: 'Helper #T0026', subagentType: 'general-purpose' } as never)
  state.status = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as never).catch(() => undefined)
  const denied = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'ls' } as never))
  expect(denied).toContain('Denied by the user')
  expect(denied).not.toContain('A1 finished')
  // A helper's call never takes the main conversation's notes either.
  expect(JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x', agentId: 'a2' } as never))).not.toContain('A1 finished')
  // the ticket text is quoted as JSON, so it reads as \" inside the stringified result.
  expect(JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x' } as never))).toContain('A1 finished. Its tickets are still open or in progress: \\"#T0026 Ship the parser\\".')
})

test('an agent the list shows running again after it ended gets no second note', async ($, on) => {
  const { state, clock, contexts } = orchSetup($, on, '- [~] #T0026 Ship the parser')
  await begin($)
  await $.agent.spawn({ prompt: 'Work on #T0026', description: 'Helper #T0026', subagentType: 'general-purpose' } as never)
  state.status = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as never).catch(() => undefined)
  await $.prompt.submit({ text: 'go' } as never)
  expect(contexts[0] ?? '').toContain('A1 finished')
  state.status = 'running'
  await clock.advance(6000)
  state.status = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1' } as never).catch(() => undefined)
  await $.prompt.submit({ text: 'again' } as never)
  expect(contexts[1] ?? '').not.toContain('A1 finished')
})

// The 31 minutes on the mock clock run every scan the session would make: past 5 s on a busy machine.
test('with the rules off, no prompt carries the still-in-progress line', { options: { rules: false }, timeoutMs: 60_000 } as never, async ($, on) => {
  const { clock, edit, contexts } = orchSetup($, on)
  await begin($)
  await edit('- [~] #T0026 Ship the parser\n- [ ] #T2 Review the copy\n- [~] #T3 Check the invoice')
  await $.prompt.submit({ text: 'one' } as never)
  await clock.advance(31 * 60 * 1000)
  await $.prompt.submit({ text: 'two' } as never)
  expect(contexts.length).toBe(2)
  for (const context of contexts) {
    expect(context).not.toContain('Still in progress')
  }
})

test('the rules block is added once: a context that holds one already keeps only that one', async ($, on) => {
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }) as never)
  const context = await $.prompt.context({ blocks: [{ name: 'claudeopticon', text: 'kept' }, { name: 'claudeMd', text: 'mine' }] } as never)
  expect(context.blocks.map(block => block.name)).toEqual(['claudeopticon', 'claudeMd'])
  expect(context.blocks[0]?.text).toBe('kept')
})

for (const [name, final] of [
  ['the result has no usage', { usage: null }],
  ['the result leaves usage out', {}],
] as const) {
  test(`an agent request's tokens count from its stop chunk when ${name}`, async ($, on) => {
    mock.clock(on)
    on('fs.exists', () => ({ value: false }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'Parser', type: 'engineer', status: 'running' }] }))
    const used = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 600_000, cache_creation_input_tokens: 0, model: 'm' }
    on('turn.step', async function* (_$, e) {
      yield { kind: 'stop', stopReason: 'end_turn', usage: used } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', ...final } as never
    })
    on('turn.complete', () => ({ text: '' }) as never)
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    await $.agent.spawn({ prompt: 'Fix the parser', description: 'Parser', subagentType: 'engineer' } as never)
    for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, agentId: 'a1' } as never)) {
      // The step yields its stop chunk.
    }
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
    const text = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
    expect(await text.find({ type: 'Text', text: /601\.5k tokens/ })).toBeDefined()
  })
}

// ---------------------------------------------------------------- the trust checks behind Show completed

for (const [name, files, opts] of [
  ['a todo folder that is a symlink', { [LIVE]: '- [x] #T0 Old' }, { links: { '/repo/.claude_todo': '/home/a/elsewhere' } }],
  ['an archive folder that is a symlink', { [LIVE]: '- [ ] #T1 Open', '/repo/.claude_todo/archive/OTHER.md': '- [x] #T0 Old' }, { links: { '/repo/.claude_todo/archive': '/home/a/elsewhere' } }],
  ['the global folder', { '/home/a/.claude/.claude_todo/TODO.md': '- [ ] #T1 Open' }, { root: '/home/a/.claude' }],
] as const) {
  test(`Show completed is never offered, and no archive file is made, in ${name}`, async ($, on) => {
    const clock = mock.clock(on)
    const disk: Record<string, string> = { ...files }
    const { writes } = repoWith(on, disk, { hasNearest: true, listed: ['.claude_todo/TODO.md'], ...opts })
    const ui = await open($)
    await clock.advance(3000)
    expect(await keysOf(ui)).not.toContain('todo-show-completed')
    expect(writes).toEqual([])
  })
}

// ---------------------------------------------------------------- the brief in the store

for (const [name, prompt] of [
  ['on the first line', 'export DB_PWD=hunter2 and fix #T0037'],
  ['on a later line', 'Fix #T0037\nRun: PGPASSWORD=hunter2 psql app'],
  ['past the 600 characters a stored brief keeps', `Fix #T0037\n${'x '.repeat(400)}\ncurl -u admin:hunter2 https://x.test #T0040`],
] as const) {
  test(`an agent's brief is stored with its secret hidden and its ticket IDs kept: the secret ${name}`, async ($, on) => {
    const clock = mock.clock(on)
    const store = new Map<string, unknown>()
    on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
    on('store.set', (_$, e) => {
      store.set(e.key, e.value)

      return { value: undefined } as never
    })
    on('session.id', () => ({ value: 'sess-1' }) as never)
    on('fs.exists', () => ({ value: false }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'Work', type: 'engineer', status: 'running' }] }))
    await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
    await $.agent.spawn({ prompt, description: 'Work', subagentType: 'engineer' } as never)
    await clock.advance(6000)
    const rows = store.get('agents:sess-1') as { brief: string }[]
    expect(rows[0]!.brief).toContain('#t0037')
    expect(rows[0]!.brief.length).toBeLessThanOrEqual(600)
    expect(JSON.stringify([...store.values()])).not.toContain('hunter2')
  })
}

// ---------------------------------------------------------------- the fake disk counts every write

test('the empty archive file that Show completed makes is a write the fake disk counts', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [LIVE]: '- [ ] #T1 Open' }
  const { writes, calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  expect(writes).toEqual([])
  await ui.press({ key: 'todo-show-completed' })
  expect(files[ARCHIVE]).toBe('')
  expect(writes).toEqual([ARCHIVE])
  expect(calls.some(call => call.startsWith('open '))).toBe(true)
})

test('a short brief kept by an older version with a secret in it is stored again without it', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>([['agents:sess-1', [{ id: 'a1', description: 'Work', type: 'engineer', status: 'running', startedAt: 0, toolCalls: 0, brief: 'work on #t0037 with pgpassword=hunter2' }]]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Work', type: 'engineer', status: 'running' }, { id: 'a2', description: 'More', type: 'engineer', status: 'running' }] }))
  on('turn.complete', () => ({ text: '' }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  // The end of a turn refreshes the rows at once, and a2 is new: the rows are stored again.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  await clock.advance(6000)
  const rows = store.get('agents:sess-1') as { id: string; brief: string }[]
  expect(rows.map(row => row.id)).toEqual(['a1', 'a2'])
  expect(rows[0]!.brief).toBe('(hidden) #t0037')
})
}
