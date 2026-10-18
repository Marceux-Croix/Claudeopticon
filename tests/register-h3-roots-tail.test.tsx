// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// Batch H3 (UCR loop 1 tail): the G1 remainder. Fakes copied from the G1 block above.
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


/** A model that puts every item in one category, counting its calls. */
function sortModel(on: On, name = 'Billing') {
  const asked = { count: 0 }
  on('model.complete', () => {
    asked.count += 1
    const assign = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i + 1), name]))

    return { value: { isAnswered: true, text: JSON.stringify({ categories: [name], assign }), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })

  return asked
}

// ---------------------------------------------------------------- UCR-023 (H3)
// Property: where printenv is not found (exit 127, as the trash code reads it), the environment is
// read through PowerShell, so a CLAUDE_CONFIG_DIR todo folder on Windows is never written.

const NOT_FOUND_STATES: [string, { cwd: string; listed: string[]; files: Record<string, string> }][] = [
  ['the config folder is the repo root', { cwd: 'D:/cfg', listed: ['.claude_todo/TODO.md'], files: { 'D:/cfg/.claude_todo/TODO.md': '- [x] #T1 Done parser\n- [ ] no id yet' } }],
  ['the config folder is a subfolder of the session (the edge of the scan)', { cwd: 'D:/cfg', listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/T.md'], files: { 'D:/cfg/.claude_todo/TODO.md': '- [ ] #T1 a\n- [ ] no id yet', 'D:/cfg/mods/x/.claude_todo/T.md': '- [ ] #T9 other' } }],
  ['the archive of the config folder already exists', { cwd: 'D:/cfg', listed: ['.claude_todo/TODO.md'], files: { 'D:/cfg/.claude_todo/TODO.md': '- [x] #T1 Done parser\n- [ ] no id yet', 'D:/cfg/.claude_todo/archive/TODO.md': '- [x] #T0 old' } }],
]
for (const [name, state] of NOT_FOUND_STATES) {
  test(`UCR-023 printenv exits 127, PowerShell has CLAUDE_CONFIG_DIR=D:\\cfg, ${name}: D:/cfg/.claude_todo is never written`, async ($, on) => {
    const clock = mock.clock(on)
    const fake = g1Repo(on, { ...state.files }, { root: 'D:/cfg', cwd: state.cwd, listed: state.listed, printenvExit: 127, psEnv: { USERPROFILE: 'C:\\Users\\me', CLAUDE_CONFIG_DIR: 'D:\\cfg' } })
    const ui = await open($)
    await clock.advance(15000)
    expect(fake.writes.filter(path => path.startsWith('D:/cfg/.claude_todo'))).toEqual([])
    expect(fake.calls.some(call => call.startsWith('powershell.exe'))).toBe(true)
    for (const key of THREE) {
      expect(await ui.find({ key })).toBeUndefined()
    }
  })
}

// ---------------------------------------------------------------- UCR-022 (H3)
// Property: /usr/bin/trash (trash-cli, on Linux) is no sign of macOS: with no uname answer, the Linux
// opener and the Linux trash commands run.

test('UCR-022 no uname answer and only /usr/bin/trash is there (trash-cli on Linux): xdg-open, not open', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 open', '/repo/.claude_todo/archive/TODO.md': '- [x] #T0 old', '/repo/mods/x/.claude_todo/OLD.md': '' }
  const fake = g1Repo(on, files, { root: '/repo', cwd: '/repo', uname: '', present: ['/usr/bin/trash'], listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/OLD.md'] })
  const ui = await open($)
  await settle()
  await ui.press({ key: 'todo-show-completed' })
  await ui.press({ key: 'todo-delete-empty' })
  expect(fake.calls).toContain('xdg-open /repo/.claude_todo/archive/TODO.md')
  expect(fake.calls.some(call => call.startsWith('open '))).toBe(false)
  expect(fake.calls.some(call => call.startsWith('gio'))).toBe(true)
})

// ---------------------------------------------------------------- UCR-099 and UCR-100 (H3)
// Property 099: a repo with a symlinked .git is a plain repo from a subfolder, so Consolidate is on
// as from the top. Property 100: a repo folder name with a trailing space is the root, whole.

for (const [name, cwd, rev] of [
  ['one folder down', '/repo/sub', '/repo\n/store/repo.git\n../.git\nsub/\n'],
  ['two folders down', '/repo/sub/deep', '/repo\n/store/repo.git\n../../.git\nsub/deep/\n'],
  ['at the top', '/repo', '/repo\n.git\n.git\n\n'],
] as const) {
  test(`UCR-099 a symlinked .git, session ${name}: the repo is plain and Consolidate shows`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a\n- [ ] no id yet', '/repo/mods/x/.claude_todo/T.md': '- [ ] #T9 other' }
    const fake = g1Repo(on, files, { root: '/repo', cwd, rev, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/T.md'] })
    const ui = await open($)
    await clock.advance(10000)
    expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
    expect(files['/repo/.claude_todo/TODO.md']).toMatch(/#T\w+ no id yet/)
    expect(fake.lsCwds.every(dir => dir === '/repo')).toBe(true)
  })
}

test('UCR-100 a repo folder name with a trailing space is the root, whole: its todo is numbered there', async ($, on) => {
  const clock = mock.clock(on)
  const TODO = '/home/a/tr /.claude_todo/TODO.md'
  const files: Record<string, string> = { [TODO]: '- [ ] #T1 a\n- [ ] no id yet' }
  const fake = g1Repo(on, files, { root: '/home/a/tr ', cwd: '/home/a/tr ', listed: ['.claude_todo/TODO.md'], rev: '/home/a/tr \n.git\n.git\n\n', gitDirs: ['/home/a/tr /.git'] })
  await open($)
  await clock.advance(10000)
  expect(files[TODO]).toMatch(/#T\w+ no id yet/)
  expect(fake.lsCwds.every(dir => dir === '/home/a/tr ')).toBe(true)
})

// ---------------------------------------------------------------- UCR-059 (H3, UCR-101)
// The third state of the G1 test (a closer folder when a primary shows) passed without the cut-ID
// code, because the cut folder did not hold the highest ID. Here it does: only the cut-ID code can
// keep the next ID above it.

test('UCR-101 a closer folder is cut while a primary shows: its highest ID still counts for the next number', async ($, on) => {
  const clock = mock.clock(on)
  const hidden = new Set(['/repo/sub/.claude_todo'])
  const limit = Array.from({ length: 20 }, (_, i) => `d${String(i).padStart(2, '0')}/.claude_todo`)
  const files: Record<string, string> = { '/repo/sub/.claude_todo/TODO.md': '- [ ] #T0009 in the closer folder', '/repo/.claude_todo/TODO.md': '- [ ] #T0003 in the primary' }
  for (const rel of limit) {
    files[`/repo/${rel}/TODO.md`] = '- [ ] #T0001 filler'
  }
  g1Repo(on, files, { root: '/repo', cwd: '/repo/sub', hidden, listed: ['.claude_todo/TODO.md', ...limit.slice(0, 19)].map(rel => `${rel}/TODO.md`) })
  await open($)
  await clock.advance(4000)
  hidden.clear()
  await clock.advance(4000)
  files['/repo/d00/.claude_todo/NEW.md'] = '- [ ] no id yet'
  for (let i = 0; i < 3; i += 1) {
    await clock.advance(4000)
  }
  expect(/#(T\w+) no id yet/.exec(files['/repo/d00/.claude_todo/NEW.md']!)?.[1]?.toLowerCase()).toBe('t000a')
})

// ---------------------------------------------------------------- UCR-102 (H3)
// Property: when the folder of a damaged book cannot be listed, the toast says that, not that the
// backup names are taken; nothing is written and nothing is sorted.

test('UCR-102 a damaged book in a folder that cannot be listed: the toast names the listing, not the backup names', async ($, on) => {
  const clock = mock.clock(on)
  const asked = sortModel(on)
  const toasts: string[] = []
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 pay vendor', '/repo/.claude_todo/categories.json': '[]' }
  const before = { ...files }
  const fake = g1Repo(on, files, { root: '/repo', cwd: '/repo', toasts, noList: ['/repo/.claude_todo'], listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(20000)
  const text = toasts.join('\n')
  expect(text).toContain('cannot be listed')
  expect(text).not.toContain('backup names are taken')
  expect(fake.writes.filter(path => path.includes('categories'))).toEqual([])
  expect(files['/repo/.claude_todo/categories.json']).toBe(before['/repo/.claude_todo/categories.json'])
  expect(asked.count).toBe(0)
})

// ---------------------------------------------------------------- UCR-104 (H3)
// Property: a linked worktree writes the todo of its main checkout, never its own folder, when git
// names the main checkout. When it cannot (a separate git dir), there is no main checkout to defer
// to, so the worktree's own folder is the central one. Both layouts are pinned here.

test('UCR-104 an ordinary linked worktree writes the main checkout\'s todo only', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/main/.claude_todo/TODO.md': '- [ ] #T1 a\n- [ ] no id main', '/wt/.claude_todo/TODO.md': '- [ ] #T2 b\n- [ ] no id wt' }
  const fake = g1Repo(on, files, { root: '/wt', cwd: '/wt', rev: '/wt\n/main/.git/worktrees/wt\n/main/.git\n\n', worktrees: 'worktree /main\nHEAD a\nbranch refs/heads/main\n\nworktree /wt\nHEAD b\n', gitDirs: ['/wt/.git', '/main/.git'], listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  await clock.advance(15000)
  expect(fake.writes.filter(path => path.startsWith('/wt/'))).toEqual([])
  expect(files['/wt/.claude_todo/TODO.md']).toBe('- [ ] #T2 b\n- [ ] no id wt')
  for (const key of THREE) {
    expect(await ui.find({ key })).toBeUndefined()
  }
})

test('UCR-104 a separate-git-dir worktree, whose main checkout git does not name, writes its own folder, with the buttons off', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/sepwt/.claude_todo/TODO.md': '- [ ] #T2 b\n- [ ] no id wt' }
  const fake = g1Repo(on, files, { root: '/sepwt', cwd: '/sepwt', rev: '/sepwt\n/sep.git/worktrees/sepwt\n/sep.git\n\n', worktrees: 'worktree /sep.git\nHEAD a\nbranch refs/heads/master\n\nworktree /sepwt\nHEAD b\n', listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  await clock.advance(15000)
  expect(fake.writes.every(path => path.startsWith('/sepwt/.claude_todo'))).toBe(true)
  expect(files['/sepwt/.claude_todo/TODO.md']).toMatch(/#T\w+ no id wt/)
  for (const key of THREE) {
    expect(await ui.find({ key })).toBeUndefined()
  }
})
}
