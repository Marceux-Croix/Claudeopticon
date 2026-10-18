// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// Batch H5 (UCR loop 1 tail): secrets in agent descriptions and titles (UCR-115), rows stored by an
// older version (UCR-029), the still-in-progress line with the rules off (V3), an ended agent brought
// back (N62), and the trust guards behind writes (UCR-067, 070). g1Repo is copied from the H3 block.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Test = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

const open = async ($: Test) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}
const segs = (path: string) => path.split('/').filter(part => part !== '')
/** A path made absolute against `base`, with `.` and `..` folded (a copy of the mod's resolveAgainst, so this block owns its fakes). */
function resolveIn(base: string, path: string): string {
  const parts = (path.startsWith('/') || /^[A-Za-z]:\//.test(path) ? path : `${base}/${path}`).split('/')
  const out: string[] = []
  for (const part of parts.slice(1)) {
    if (part === '..') {
      out.pop()
    } else if (part !== '' && part !== '.') {
      out.push(part)
    }
  }

  return `${parts[0]}/${out.join('/')}`
}

type G1Opts = {
  root?: string
  cwd: string
  listed?: string[]
  noGit?: boolean
  rev?: string
  worktrees?: string
  gitDirs?: string[]
  home?: string | null
  env?: Record<string, string>
  printenvMissing?: boolean
  /** printenv starts but exits with this code for every name (127: the program was not found). */
  printenvExit?: number
  /** Folders whose listing throws. */
  noList?: string[]
  psEnv?: Record<string, string>
  uname?: string
  present?: string[]
  links?: Record<string, string>
  dangling?: string[]
  hidden?: Set<string>
  toasts?: string[]
}

/**
 * A fake disk and git with a session folder (`cwd`). The test engine hands a relative path over made
 * absolute against its own folder; the fake reads such a path back as relative and resolves it against
 * `cwd`, so `.`, `.claude_todo` and `../.claude_todo` land where a real session would put them. `links`
 * maps a path (or a folder above it) to its real path; `hidden` holds folders that do not exist until
 * the test removes them from the set; `present` names other paths that exist (such as /usr/bin/osascript).
 * `env` and `psEnv` are what printenv and PowerShell give per variable.
 */
function g1Repo(on: On, files: Record<string, string>, opts: G1Opts) {
  const R = opts.root ?? opts.cwd
  const writes: string[] = []
  const realWrites: string[] = []
  const calls: string[] = []
  const lsCwds: string[] = []
  const links = opts.links ?? {}
  // The first folder names the test's own paths use: a path under any other is one the engine made absolute against its own folder.
  const own = new Set([R, opts.cwd, ...Object.keys(files), ...Object.keys(links), ...Object.values(links), ...(opts.present ?? []), ...(opts.gitDirs ?? []), ...Object.values(opts.env ?? {}), ...(typeof opts.home === 'string' ? [opts.home] : []), '/home/a', '/usr/bin'].map(path => segs(path)[0] ?? ''))
  let harness: string | undefined
  const map = (path: string) => {
    const parts = segs(path)
    if (/^[A-Za-z]:\//.test(path) || own.has(parts[0] ?? '')) {
      return path
    }
    if (harness === undefined && path.endsWith('/.claude_todo')) {
      harness = path.slice(0, -'/.claude_todo'.length)
    }
    if (harness === undefined) {
      return path
    }
    const h = segs(harness)
    let k = 0
    while (k < h.length && k < parts.length && h[k] === parts[k]) {
      k += 1
    }

    return resolveIn(opts.cwd, [...Array.from({ length: h.length - k }, () => '..'), ...parts.slice(k)].join('/') || '.')
  }
  const gitDirs = new Set(opts.noGit === true ? [] : (opts.gitDirs ?? [`${R}/.git`]))
  const isHidden = (path: string) => [...(opts.hidden ?? [])].some(dir => path === dir || path.startsWith(`${dir}/`))
  const linkOf = (path: string) => Object.keys(links).filter(key => path === key || path.startsWith(`${key}/`)).sort((a, b) => b.length - a.length)[0]
  const realOf = (path: string) => {
    const key = linkOf(path)

    return key === undefined ? path : `${links[key]}${path.slice(key.length)}`
  }
  // UCR-150 (batch K1): the session folder exists, so the real path of `.` (the engine's own folder, read back as `cwd`) resolves.
  const exists = (path: string) => !isHidden(path) && (path in files || Object.keys(files).some(key => key.startsWith(`${path}/`)) || gitDirs.has(path) || (opts.present ?? []).includes(path) || path === opts.cwd)
  const named = (dir: string) => {
    const names = new Set<string>()
    for (const key of [...Object.keys(files).filter(one => one in files && !isHidden(one)), ...(opts.dangling ?? [])]) {
      if (key.startsWith(`${dir}/`) && !key.slice(dir.length + 1).includes('/')) {
        names.add(key.slice(dir.length + 1))
      }
    }

    return [...names]
  }
  on('process.run', (_$, e) => {
    const { argv, init } = e as unknown as { argv: string[]; init?: { cwd?: string } }
    calls.push(argv.join(' '))
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      if (opts.printenvMissing === true) {
        throw new Error('spawn printenv ENOENT')
      }
      if (opts.printenvExit !== undefined) {
        return out('', opts.printenvExit)
      }
      const value = argv[1] === 'HOME' ? (opts.home === undefined ? '/home/a' : opts.home) : opts.env?.[argv[1]!]

      return value === null || value === undefined ? out('', 1) : out(`${value}\n`)
    }
    if (argv[0] === 'powershell.exe' && argv[argv.length - 1]!.includes('GetEnvironmentVariable')) {
      if (opts.psEnv === undefined) {
        throw new Error('spawn powershell.exe ENOENT')
      }

      return out(`${opts.psEnv[/GetEnvironmentVariable\('(\w+)'\)/.exec(argv[argv.length - 1]!)![1]!] ?? ''}\n`)
    }
    if (argv[0] === 'uname') {
      return out(`${opts.uname ?? 'Darwin'}\n`)
    }
    if (argv[0] === 'git') {
      if (opts.noGit === true) {
        return out('', 128)
      }
      if (argv[1] === 'rev-parse') {
        const prefix = opts.cwd === R ? '' : `${opts.cwd.slice(R.length + 1)}/`
        const depth = segs(prefix).length

        return out(opts.rev ?? (depth === 0 ? `${R}\n.git\n.git\n\n` : `${R}\n${R}/.git\n${'../'.repeat(depth)}.git\n${prefix}\n`))
      }
      if (argv[1] === 'worktree') {
        return out(opts.worktrees ?? `worktree ${R}\nHEAD a\nbranch refs/heads/main\n`)
      }
      if (argv[1] === 'ls-files') {
        lsCwds.push(init?.cwd ?? '')

        return out(argv.includes('--directory') ? '' : (opts.listed ?? []).join('\0'))
      }
    }
    if (['open', 'xdg-open', 'mkdir'].includes(argv[0]!)) {
      return out('')
    }

    return out('', 1)
  })
  on('fs.exists', (_$, e) => ({ value: exists(map(e.path)) }))
  on('fs.stat', (_$, e) => {
    const path = map(e.path)
    if (!exists(path) && links[path] === undefined) {
      throw new Error('ENOENT')
    }

    return { value: { kind: path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: links[path] !== undefined, realPath: realOf(path) } } as never
  })
  on('fs.list', (_$, e) => {
    if ((opts.noList ?? []).includes(map(e.path))) {
      throw new Error('EACCES')
    }

    return { value: named(map(e.path)).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2 + writes.length, isLink: false })) }
  })
  on('fs.read', (_$, e) => {
    const path = map(e.path)
    if (!exists(path)) {
      throw new Error('ENOENT')
    }

    return { value: files[path] ?? '' }
  })
  on('fs.write', (_$, e) => {
    const path = map(e.path)
    writes.push(path)
    realWrites.push(realOf(path))
    files[path] = e.text as string

    return { value: undefined } as never
  })
  on('ui.toast', (_$, e) => {
    opts.toasts?.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  // A working store: the archive move waits while its record cannot be read (G3, UCR-013).
  const kept = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: kept.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    kept.set(e.key, e.value)

    return { value: undefined } as never
  })

  return { writes, realWrites, calls, lsCwds }
}

// ---------------------------------------------------------------- UCR-115 (H5)
// Property: a secret in an agent's description or in the orchestrator's title is never drawn, stored
// or toasted, by any path that sets one: the spawn, the agent list, a row or a title stored before.

/** A pane over one todo file with a working store, an agent list that says `listed` of a1, a TaskStop that works, and the toasts. */
function agentSetup(on: On, listed: { description: string; status: string }, store = new Map<string, unknown>()) {
  const clock = mock.clock(on)
  const toasts: string[] = []
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: '- [~] #T0037 Ship the parser' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', type: 'engineer', ...listed }] }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: 'stopped' }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })

  return { clock, toasts, store }
}

/** Every place a secret could show: the cards, the terminal view, the store and the toasts. */
async function everywhere($: Test, desk: Awaited<ReturnType<typeof open>>, store: Map<string, unknown>, toasts: string[]): Promise<string> {
  const term = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })

  return [JSON.stringify(await desk.findAll({ type: 'Svg' })), JSON.stringify(await term.drawn()), JSON.stringify([...store.values()]), toasts.join('\n')].join('\n')
}

const SECRET_DESCRIPTION = 'Deploy with DB_PASSWORD=Hunter2xyz #T0037'

for (const [name, spawned, listed, stored] of [
  // State 1: the spawn gives the description, the list repeats it.
  ['given at the spawn', SECRET_DESCRIPTION, SECRET_DESCRIPTION, undefined],
  // State 2: the spawn gives a clean one; the list gives one with a secret later (the refresh path).
  ['given by the agent list after a clean spawn', 'Deploy', SECRET_DESCRIPTION, undefined],
  // State 3: a row stored by an older version holds it, and the list gives none, so the stored one is kept.
  ['kept in a row stored by an older version', undefined, '', SECRET_DESCRIPTION],
] as const) {
  test(`UCR-115 an agent's description with a secret shows nowhere, the Stop toast included: ${name}`, async ($, on) => {
    const store = new Map<string, unknown>(stored === undefined ? [] : [['agents:sess-1', [{ id: 'a1', description: stored, type: 'engineer', status: 'running', startedAt: 0, toolCalls: 0, brief: 'deploy' }]]])
    const { clock, toasts } = agentSetup(on, { description: listed, status: 'running' }, store)
    const ui = await open($)
    if (spawned !== undefined) {
      await $.agent.spawn({ prompt: 'Work on #T0037', description: spawned, subagentType: 'engineer' } as never)
    }
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as never).catch(() => undefined)
    await clock.advance(6000)
    // The card is drawn with the description hidden, its ticket ID kept.
    expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('(hidden) #T0037')
    await ui.press({ key: 'agent-stop-a1' })
    expect(toasts.join('\n')).toContain('Stopped A1')
    expect(await everywhere($, ui, store, toasts)).not.toMatch(/hunter2/i)
  })
}

const ORCH_TODO = '- [~] #T0026 Ship the parser\n- [ ] #T2 Review the copy'
const PROGRESS = 'mcp__claudeopticon__report_progress'

/** A pane over one todo file, a working store, and the prompt contexts; the main conversation claims #T0026 through report_progress. */
function orchOwner(on: On, store = new Map<string, unknown>()) {
  const clock = mock.clock(on)
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: ORCH_TODO }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }) as never)
  const contexts: string[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push((e.context ?? []).join('\n'))

    return { text: e.text, context: e.context }
  })

  return { clock, contexts, store }
}

const orchCard = async (ui: Awaited<ReturnType<typeof open>>) => (await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg)).find(svg => svg.includes('O, Orchestrator')) ?? ''

test('UCR-115 a report_progress title with a secret is drawn and stored hidden, its ticket ID kept', async ($, on) => {
  const { clock, store } = orchOwner(on)
  const ui = await open($)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T0026'], title: 'Ship with PGPASSWORD=Hunter2xyz #T0026' } as never)
  await clock.advance(6000)
  const card = await orchCard(ui)
  expect(card).toContain('(hidden) #T0026')
  expect(card).not.toMatch(/hunter2/i)
  expect(JSON.stringify([...store.values()])).not.toMatch(/hunter2/i)
})

test('UCR-115 a title stored by an older version with a secret is hidden when it is loaded', async ($, on) => {
  // The stored claim keeps the title: a title is kept only while the orchestrator owns a ticket.
  const store = new Map<string, unknown>([['orchestrator-title:sess-1', 'Ship with PGPASSWORD=Hunter2xyz'], ['orchestrator:sess-1', [['#t0026', true]]]])
  const { clock } = orchOwner(on, store)
  const ui = await open($)
  await clock.advance(6000)
  const card = await orchCard(ui)
  expect(card).toContain('(hidden)')
  expect(card).not.toMatch(/hunter2/i)
})

// ---------------------------------------------------------------- UCR-029 (H5)
// Property: a row an older version stored is shown and stored again with no secret in its current
// call, description or brief, the brief checked in its normalized form.

test('UCR-029 an old stored row\'s current call, description and brief are cleaned on load, on the cards and in the store', async ($, on) => {
  const store = new Map<string, unknown>([['agents:sess-1', [{ id: 'a1', description: 'Login PGPASSWORD=Hunter2xyz', type: 'engineer', status: 'running', startedAt: 0, toolCalls: 1, doing: 'Bash: curl --password Hunter2xyz u', brief: 'login with mysqlpwd=hunter2xyz #t0037' }]]])
  const { clock, toasts } = agentSetup(on, { description: '', status: 'running' }, store)
  const ui = await open($)
  // A turn end refreshes the rows at once; the first save after the load writes them again.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as never).catch(() => undefined)
  await clock.advance(6000)
  const rows = store.get('agents:sess-1') as { doing?: string; description: string; brief: string }[]
  expect([rows[0]!.doing, rows[0]!.description, rows[0]!.brief]).toEqual(['Bash: (hidden)', '(hidden)', '(hidden) #t0037'])
  expect(await everywhere($, ui, store, toasts)).not.toMatch(/hunter2/i)
})

// ---------------------------------------------------------------- UCR-067 V3 (H5)
// Property: with the rules option off, no prompt carries the still-in-progress line, even when the
// orchestrator owns an in-progress ticket; with the rules on, the same steps carry it.

for (const [name, rules] of [
  ['with the rules on (the control: the line is there)', true],
  ['with the rules off', false],
] as const) {
  // The 31 minutes on the mock clock run every scan the session would make: past 5 s on a busy machine (#T003G).
  test(`UCR-067 the orchestrator owns #T0026 in progress, ${name}`, { options: { rules }, timeoutMs: 60_000 } as never, async ($, on) => {
    const { clock, contexts, store } = orchOwner(on)
    await open($)
    await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T0026'] } as never)
    await clock.advance(6000)
    // The orchestrator owns the ticket: the store holds its claim.
    expect(JSON.stringify(store.get('orchestrator:sess-1') ?? [])).toContain('t0026')
    await $.prompt.submit({ text: 'one' } as never)
    await clock.advance(31 * 60 * 1000)
    await $.prompt.submit({ text: 'two' } as never)
    expect(contexts.length).toBe(2)
    expect(contexts.some(context => context.includes('Still in progress from earlier: "#T0026 Ship the parser"'))).toBe(rules)
  })
}

// ---------------------------------------------------------------- UCR-067 N62 (H5)
// Property: an agent ends once as far as the notes go: brought back by a forced refresh (the list is
// the truth, so a resumed agent is live again) and ended again, it gets no second note.

test('UCR-067 an ended agent brought back by a forced refresh, then ended again, gets no second note', async ($, on) => {
  const clock = mock.clock(on)
  const state = { status: 'running' }
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: '- [~] #T0026 Ship the parser' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Helper #T0026', type: 'general-purpose', status: state.status }] }))
  on('turn.complete', () => ({ text: '' }) as never)
  const contexts: string[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push((e.context ?? []).join('\n'))

    return { text: e.text, context: e.context }
  })
  await open($)
  await $.agent.spawn({ prompt: 'Work on #T0026', description: 'Helper #T0026', subagentType: 'general-purpose' } as never)
  state.status = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as never).catch(() => undefined)
  await $.prompt.submit({ text: 'go' } as never)
  expect(contexts[0] ?? '').toContain('A1 finished')
  // The list says running again: a forced refresh (a turn end) brings the row back live.
  state.status = 'running'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1' } as never).catch(() => undefined)
  await clock.advance(6000)
  expect((store.get('agents:sess-1') as { status: string }[])[0]!.status).toBe('running')
  state.status = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't3', agentId: 'a1' } as never).catch(() => undefined)
  await $.prompt.submit({ text: 'again' } as never)
  expect(contexts[1] ?? '').not.toContain('A1 finished')
})

// ---------------------------------------------------------------- UCR-067, 070: trust guards (H5)
// Property: the mod writes a todo folder only when it is its own real path inside the checkout:
// never through a symlink, even one to another folder of the same repo (M03), and never by a path
// with `..` in it. The writes that only this check guards are the ones that make a new file in
// the folder: the sorter's categories.json and the archive file Show completed makes. (A write to a
// file that exists also passes isPlainFile, which a symlinked folder fails as well.)

/** A model that puts every item in one category, counting its calls (copied from the H3 block). */
function sortModel(on: On, name = 'Billing') {
  const asked = { count: 0 }
  on('model.complete', () => {
    asked.count += 1
    const assign = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i + 1), name]))

    return { value: { isAnswered: true, text: JSON.stringify({ categories: [name], assign }), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })

  return asked
}

const GUARD_TEXT = '- [ ] #T0001 pay vendor\n- [ ] #T0002 sign lease\n- [x] #T0003 shipped'

for (const [name, root, links, isWritten] of [
  // M03: the primary folder is a symlink to another folder inside the same repo, so its real path is inside too.
  ['a primary todo folder that is a symlink to another folder of the same repo', '/repo', { '/repo/.claude_todo': '/repo/real/.claude_todo' }, false],
  // A root with `..` in it. The engine folds the `..` before the fake disk sees it, so the real path
  // differs from the text and the real-path check refuses it with or without the `..` check (M43):
  // no state through the engine reaches that check alone. This pins the behavior, not that guard.
  ['a repo root named with ..', '/repo/x/..', {}, false],
  // The control: the same repo with neither, so the guards are what stops the two above.
  ['a plain repo (the control)', '/repo', {}, true],
] as const) {
  test(`UCR-070 ${name}: the sorter's book and Show completed ${isWritten ? 'write' : 'write nothing'}`, async ($, on) => {
    const clock = mock.clock(on)
    sortModel(on)
    const disk: Record<string, string> = { [`${root}/.claude_todo/TODO.md`]: GUARD_TEXT }
    const fake = g1Repo(on, disk, { root, cwd: root, listed: ['.claude_todo/TODO.md'], links: { ...links } })
    const ui = await open($)
    await clock.advance(15000)
    const show = await ui.find({ key: 'todo-show-completed' })
    if (show !== undefined) {
      await ui.press({ key: 'todo-show-completed' })
    }
    expect(show !== undefined).toBe(isWritten)
    expect(fake.writes.length > 0).toBe(isWritten)
    if (!isWritten) {
      expect(disk).toEqual({ [`${root}/.claude_todo/TODO.md`]: GUARD_TEXT })
    }
  })
}
}
