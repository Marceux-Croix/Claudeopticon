// Engine cases for folder discovery, the fs time limit and the session list in the store, through the fake engine.
// One responsibility: the behavior of the mod's start-up layer (folders, globals, the store's session list) under faults.

import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Api = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

type Opts = {
  /** The paths git lists as todo files (relative to the repo root). */
  listed: string[]
  /** What `git rev-parse` answers; undefined gives the usual repo at /repo. */
  rev?: () => { exitCode: number; stdout: string } | 'throws'
  /** A path to the real path the fake stat gives it (a symlink). */
  links?: Record<string, string>
  /** A directory whose list never answers (while the predicate holds). */
  hangList?: (path: string) => boolean
  /** A store call (`get` or `set`) that rejects. */
  storeFails?: (op: 'get' | 'set', key: string) => boolean
  /** The value of CLAUDE_CONFIG_DIR, when set. */
  configDir?: string
  /** Whether the session folder has a `.claude_todo` of its own that the nearest-folder rule finds (a repo at /repo). */
  hasNearest?: boolean
  /** The mtime the fake lists for every file: a test bumps it to make the scan read a changed file. */
  mtime?: () => number
}

/** A fake repo at /repo with the given files by absolute path, and a store that keeps what it is given. */
function repoWith(on: On, files: Record<string, string>, opts: Opts) {
  const R = '/repo'
  const reads: string[] = []
  const store = new Map<string, unknown>()
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('store.get', (_$, e) => {
    if (opts.storeFails?.('get', e.key) === true) {
      throw new Error('store get refused')
    }

    return { value: store.get(e.key) } as never
  })
  on('store.set', (_$, e) => {
    if (opts.storeFails?.('set', e.key) === true) {
      throw new Error('store set refused')
    }
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      if (argv[1] === 'HOME') {
        return out('/home/a\n')
      }

      return argv[1] === 'CLAUDE_CONFIG_DIR' && opts.configDir !== undefined ? out(`${opts.configDir}\n`) : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }
    if (argv[1] === 'rev-parse') {
      const answer = opts.rev?.() ?? { exitCode: 0, stdout: `${R}\n${R}/.git\n${R}/.git\n\n` }
      if (answer === 'throws') {
        throw new Error('spawn failed')
      }

      return { value: { exitCode: answer.exitCode, stdout: answer.stdout, stderr: '' } } as never
    }
    if (argv[1] === 'ls-files') {
      return out(argv.includes('--directory') ? '' : opts.listed.join('\0'))
    }

    return out('')
  })
  // The session folder is /repo; the engine hands its own relative paths over unchanged, so a path outside /repo is the nearest-folder rule's.
  const near = (path: string) => (inside(path) ? path : path.endsWith('.claude_todo') ? `${R}/.claude_todo` : `${R}/.claude_todo/${path.split('/').pop()}`)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.git') || (inside(e.path) && (e.path in files || Object.keys(files).some(path => path.startsWith(`${e.path}/`)))) || (!inside(e.path) && e.path.endsWith('.claude_todo') && opts.hasNearest !== false) }))
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/home/a/.claude') || (opts.configDir !== undefined && e.path.startsWith(opts.configDir))) {
      throw new Error('ENOENT')
    }

    return { value: { kind: e.path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.links?.[e.path] ?? (inside(e.path) ? e.path : e.path.endsWith('.claude_todo') ? near(e.path) : R) } } as never
  })
  on('fs.list', (_$, e) => {
    if (opts.hangList?.(e.path) === true) {
      return new Promise(() => undefined) as never
    }

    return { value: names(near(e.path)).map(name => ({ name, kind: 'file', size: 1, mtimeMs: opts.mtime?.() ?? 2, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    reads.push(e.path)

    return { value: files[near(e.path)] ?? '' } as never
  })
  on('fs.write', (_$, e) => {
    files[e.path] = e.text as string

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'sess-new' }) as never)

  return { reads, store }
}

const open = async ($: Api) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

/** Collects every toast text. */
function toastsOf(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)

  return toasts
}

const count = (list: readonly string[], part: string) => list.filter(one => one.includes(part)).length
const board = async (ui: Awaited<ReturnType<typeof open>>) => JSON.stringify(await ui.findAll({ type: 'Svg' }))

// ---------------------------------------------------------------- a tracked link out of the repo

/**
 * Property: a todo folder that git lists but that resolves outside the repo (a tracked symlink to another
 * directory) is not listed on the board and none of its files is read; the folder beside it is.
 */
test('a tracked .claude_todo link that resolves outside the repo is skipped, named once, and never read', { timeoutMs: 60_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Inside ticket',
    '/repo/link/.claude_todo/TODO.md': '- [ ] #T2 Outside secret ticket',
  }
  const { reads } = repoWith(on, files, { listed: ['.claude_todo/TODO.md', 'link/.claude_todo/TODO.md'], links: { '/repo/link/.claude_todo': '/outside/notes/.claude_todo' } })
  const toasts = toastsOf(on)
  const ui = await open($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  const drawn = await board(ui)
  expect(drawn).toContain('Inside ticket')
  expect(drawn).not.toContain('Outside secret')
  expect(reads.filter(path => path.startsWith('/repo/link/'))).toEqual([])
  expect(count(toasts, 'skips /repo/link/.claude_todo')).toBe(1)
})

// ---------------------------------------------------------------- the repo layout fails to read

/**
 * Property: a repo layout that cannot be read (git fails with a code other than 128, does not start, or
 * the search throws) is told once, and the board shows the nearest folder; outside a repo (exit 128) is
 * normal and silent.
 */
for (const [name, rev, isTold] of [
  ['git exits 2', () => ({ exitCode: 2, stdout: '' }), true],
  ['git does not start', () => 'throws' as const, true],
  ['rev-parse answers with no text', () => ({ exitCode: 0, stdout: undefined as unknown as string }), true],
  ['not a repo (exit 128)', () => ({ exitCode: 128, stdout: '' }), false],
] as const) {
  test(`a repo layout that fails to read (${name}) is ${isTold ? 'told once' : 'silent'}`, { timeoutMs: 60_000 } as never, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Inside ticket' }
    repoWith(on, files, { listed: ['.claude_todo/TODO.md'], rev })
    const toasts = toastsOf(on)
    const ui = await open($)
    for (let i = 0; i < 8; i += 1) {
      await clock.advance(3000)
    }
    expect(count(toasts, 'could not read the repo layout')).toBe(isTold ? 1 : 0)
    // The board still draws: the nearest folder, found by the old rule, is read.
    expect(await board(ui)).toContain('Inside ticket')
  })
}

// ---------------------------------------------------------------- a hung fs call

/**
 * Property: a folder list that never answers is a failed read, not a missing or an empty folder: the scan
 * ends after the call limit, the folder's tickets stay as last read, and a later change shows once the
 * disk answers again.
 */
test('a folder list that never answers ends the scan and keeps the tickets; the next scan reads the change', { timeoutMs: 120_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 First ticket' }
  const gate = { hang: false, version: 2 }
  repoWith(on, files, { listed: ['.claude_todo/TODO.md'], hangList: path => gate.hang && path === '/repo/.claude_todo', mtime: () => gate.version })
  const toasts = toastsOf(on)
  const ui = await open($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  expect(await board(ui)).toContain('First ticket')
  gate.hang = true
  files['/repo/.claude_todo/TODO.md'] = '- [ ] #T1 First ticket\n- [ ] #T2 Second ticket'
  gate.version = 3
  // A full resync is due every RESYNC_EVERY ticks; the hung list holds that scan until the limit passes.
  for (let i = 0; i < 90; i += 1) {
    await clock.advance(1000)
  }
  // The tickets as last read stay on the board while the list does not answer.
  expect(await board(ui)).toContain('First ticket')
  gate.hang = false
  for (let i = 0; i < 90; i += 1) {
    await clock.advance(1000)
  }
  expect(toasts).toEqual([])
  expect(await board(ui)).toContain('Second ticket')
})

// ---------------------------------------------------------------- a failed search leaves no root trusted

/**
 * Property: after a search that finds no repo (git fails at the second search), no root of the earlier
 * repo stays trusted: the buttons that need a central folder are off.
 */
test('a Consolidate search that finds no repo drops the central folder: Delete empty todos is off afterwards', { timeoutMs: 120_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/.claude_todo/EMPTY.md': '',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 Docs',
  }
  const gate = { fail: false }
  repoWith(on, files, {
    listed: ['.claude_todo/TODO.md', '.claude_todo/EMPTY.md', 'mods/x/.claude_todo/TODO.md'],
    rev: () => (gate.fail ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: '/repo\n/repo/.git\n/repo/.git\n\n' }),
  })
  const ui = await open($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  expect(await ui.find({ key: 'todo-delete-empty' })).toBeDefined()
  gate.fail = true
  let isDone = false
  void ui.press({ key: 'todo-consolidate' }).then(() => { isDone = true }, () => { isDone = true })
  for (let s = 0; s < 60 && !isDone; s += 1) {
    await clock.advance(1000)
  }
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(3000)
  }
  expect(isDone).toBe(true)
  expect(await ui.find({ key: 'todo-delete-empty' })).toBeUndefined()
})

// ---------------------------------------------------------------- the session list in the store

/** The store keys of a session that is not this one: it fell off the list, so its keys are cleared. */
const OLD = 'old-session'

/**
 * A session list of KEPT_SESSIONS other sessions with times, the oldest being OLD: this session's first
 * note adds it, and the oldest falls off.
 */
function fullList(): [string, number][] {
  // OLD noted itself long before the clock of the test: it is not live, so the first note drops it.
  const list: [string, number][] = [[OLD, -10_000_000]]
  for (let i = 0; i < 19; i += 1) {
    list.push([`s${i}`, 2 + i])
  }

  return list
}

/**
 * Property: five notes in a row that the store refuses are told in one toast, and a note that is stored
 * clears the count.
 */
test('five failed notes of the session list in a row give one toast', { timeoutMs: 120_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix' }
  repoWith(on, files, { listed: ['.claude_todo/TODO.md'], storeFails: (op, key) => op === 'get' && key === 'sessions-recent' })
  const toasts = toastsOf(on)
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  await open($)
  for (let s = 0; s < 20 * 12; s += 1) {
    await clock.advance(5000)
  }
  expect(count(toasts, 'cannot note this session in the store')).toBe(1)
})

/**
 * Property: a session that falls off the list keeps its keys reachable when the read of the queue of
 * dropped sessions fails at that note: they are cleared once the store answers again.
 */
test('a session dropped while the queue of dropped sessions cannot be read still has its keys cleared later', { timeoutMs: 180_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix' }
  const gate = { failQueue: true, hits: 0 }
  const { store } = repoWith(on, files, { listed: ['.claude_todo/TODO.md'], storeFails: (op, key) => op === 'get' && key === 'sessions-dropping' && gate.failQueue && (gate.hits += 1) > 0 })
  store.set('sessions-recent', fullList())
  store.set(`agents:${OLD}`, [{ id: 'x' }])
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  await open($)
  // The first note after the start meets the queue that does not read; the queue works from the next one.
  for (let s = 0; s < 40 && gate.hits === 0; s += 1) {
    await clock.advance(60_000)
  }
  expect(gate.hits).toBeGreaterThan(0)
  gate.failQueue = false
  // The queue is read again, the dropped session waits its confirm window, and a later note clears its keys.
  for (let s = 0; s < 60; s += 1) {
    await clock.advance(60_000)
  }
  expect(store.get(`agents:${OLD}`)).toBeNull()
})
