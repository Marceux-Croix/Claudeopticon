import { expect, mock, test } from 'claude-code/testing'

// engine tests for 235, 236, 237, 238 and 240, with their own fakes (a copy of the probe fake).
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

type L1Opts = {
  cwd: string
  root?: string
  listed?: string[]
  /** The REV_PARSE output; by default the real shape for `cwd` in `root`. */
  rev?: string
  home?: string
  env?: Record<string, string>
  /** A path (or a folder above it) and its real path: a symlink. The object may change during the test. */
  links?: Record<string, string>
  /** Folders that do not exist until the test removes them from the set. */
  hidden?: Set<string>
  /** A disk that ignores letter case (macOS, Windows): a path in any case finds the file, and the real path has the disk's case. */
  ci?: boolean
  /** The form the engine gives real paths in (backslashes on Windows). */
  realForm?: (path: string) => string
  /** The model's reply text for each call; it may change the disk, as a user does during a call. */
  reply?: () => string
  toasts?: string[]
  lsThrows?: boolean
  gitFails?: boolean
  failWrite?: (path: string) => boolean
  /** The exit code of every `git ls-files` (0 by default). */
  lsExit?: number
  /** The engine's stdout cap in bytes for `git ls-files` (it keeps the first `lsCap` bytes and still gives exit 0, as the real engine does at 4 MiB). */
  lsCap?: number
  /** The entries of the ignored listing (`--directory`). */
  ignored?: string[]
}

/**
 * A fake disk and git with a session folder (`cwd`). The test engine hands a relative path over made
 * absolute against its own folder; the fake reads such a path back as relative against `cwd` (as
 * g1Repo does). Every path goes through `links` to its real path, and with `ci` in any letter case.
 */
function l1Disk(on: On, files: Record<string, string>, opts: L1Opts) {
  const R = opts.root ?? opts.cwd
  const writes: string[] = []
  const calls: string[] = []
  const links = opts.links ?? {}
  const own = new Set([R, opts.cwd, ...Object.keys(files), ...Object.keys(links), ...Object.values(links), ...Object.values(opts.env ?? {}), opts.home ?? '/home/a', '/home/a'].map(path => segs(path)[0] ?? ''))
  let harness: string | undefined
  const map = (path: string) => {
    // On a Mac host the engine may prefix a Windows path with its own folder: keep it from the drive on.
    const win = /[A-Za-z]:\/.*$/.exec(path)?.[0]
    if (win !== undefined) {
      return win
    }
    const parts = segs(path)
    if (own.has(parts[0] ?? '')) {
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
  const key = (path: string) => (opts.ci === true ? path.toLowerCase() : path)
  const under = (path: string, dir: string) => key(path) === key(dir) || key(path).startsWith(`${key(dir)}/`)
  const linked = (path: string) => {
    const at = Object.keys(links).filter(one => under(path, one)).sort((a, b) => b.length - a.length)[0]

    return at === undefined ? path : `${links[at]}${path.slice(at.length)}`
  }
  const isHidden = (path: string) => [...(opts.hidden ?? [])].some(dir => under(path, dir))
  const fileAt = (path: string) => Object.keys(files).find(one => key(one) === key(path))
  const isDirAt = (path: string) => Object.keys(files).some(one => key(one).startsWith(`${key(path)}/`)) || key(path) === key(`${R}/.git`)
  /** The real path, in the disk's own case: a file's key, or the folder part of a file's key under it. */
  const real = (raw: string) => {
    const path = linked(raw)
    const file = fileAt(path)
    if (file !== undefined) {
      return file
    }
    const inside = Object.keys(files).find(one => key(one).startsWith(`${key(path)}/`))

    return inside === undefined ? path : inside.slice(0, path.length)
  }
  const exists = (raw: string) => !isHidden(real(raw)) && (fileAt(real(raw)) !== undefined || isDirAt(real(raw)))
  on('process.run', (_$, e) => {
    const { argv } = e as unknown as { argv: string[] }
    calls.push(argv.join(' '))
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      const value = argv[1] === 'HOME' ? (opts.home ?? '/home/a') : opts.env?.[argv[1]!]

      return value === undefined ? out('', 1) : out(`${value}\n`)
    }
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }
    if (argv[0] === 'git' && opts.gitFails === true) {
      return out('', 128)
    }
    if (argv[0] === 'git' && argv[1] === 'rev-parse') {
      const prefix = opts.cwd === R ? '' : `${opts.cwd.slice(R.length + 1)}/`

      return out(opts.rev ?? (prefix === '' ? `${R}\n.git\n.git\n\n` : `${R}\n${R}/.git\n${'../'.repeat(segs(prefix).length)}.git\n${prefix}\n`))
    }
    if (argv[0] === 'git' && argv[1] === 'worktree') {
      return out(`worktree ${R}\nHEAD a\nbranch refs/heads/main\n`)
    }
    if (argv[0] === 'git' && argv[1] === 'ls-files') {
      if (opts.lsThrows === true) {
        throw new Error('git: $.process.run(git) aborted: still running after 30000ms')
      }
      // A pathspec after `--` keeps only the entries with a `.claude_todo` segment in any case, as git's `:(icase,glob)` forms do.
      const specs = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : []
      const all = argv.includes('--directory') ? (opts.ignored ?? []) : (opts.listed ?? [])
      const kept = specs.length === 0 ? all : all.filter(entry => entry.split('/').some(part => part.toLowerCase() === '.claude_todo'))
      const text = kept.join('\0')
      const cap = opts.lsCap ?? Number.POSITIVE_INFINITY

      return { value: { exitCode: opts.lsExit ?? 0, stdout: text.slice(0, cap), stderr: '', isStdoutTruncated: text.length > cap, isStderrTruncated: false } } as never
    }
    if (argv[0] === '/usr/bin/trash') {
      delete files[argv[1]!]

      return out('')
    }
    if (['open', 'xdg-open', 'mkdir', 'rmdir'].includes(argv[0]!)) {
      return out('')
    }

    return out('', 1)
  })
  on('fs.exists', (_$, e) => ({ value: exists(map(e.path)) }))
  on('fs.stat', (_$, e) => {
    const path = map(e.path)
    if (!exists(path)) {
      throw new Error(`ENOENT ${path}`)
    }

    return { value: { kind: fileAt(real(path)) !== undefined ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: Object.keys(links).some(one => key(one) === key(path)), realPath: (opts.realForm ?? (one => one))(real(path)) } } as never
  })
  on('fs.list', (_$, e) => {
    const dir = real(map(e.path))
    const names = new Set<string>()
    for (const one of Object.keys(files)) {
      if (!isHidden(one) && key(one).startsWith(`${key(dir)}/`)) {
        names.add(one.slice(dir.length + 1).split('/')[0]!)
      }
    }

    return { value: [...names].map(name => ({ name, kind: fileAt(`${dir}/${name}`) !== undefined ? 'file' : 'dir', size: 1, mtimeMs: 2 + writes.length, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    const file = fileAt(real(map(e.path)))
    if (file === undefined || isHidden(file)) {
      throw new Error('ENOENT')
    }

    return { value: files[file]! }
  })
  on('fs.write', (_$, e) => {
    const path = real(map(e.path))
    if (opts.failWrite?.(path) === true) {
      throw new Error(`EACCES ${path}`)
    }
    const file = fileAt(path) ?? path
    writes.push(file)
    files[file] = e.text as string

    return { value: undefined } as never
  })
  on('ui.toast', (_$, e) => {
    opts.toasts?.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: opts.reply?.() ?? '{}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  const kept = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: kept.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    kept.set(e.key, e.value)

    return { value: undefined } as never
  })

  return { writes, calls }
}


const SORT = () => '{"categories": ["Billing"], "assign": {"1": "Billing"}}'
const run = async ($: Test, clock: { advance: (ms: number) => Promise<void> }, steps = 8) => {
  await open($)
  for (let i = 0; i < steps; i += 1) await clock.advance(3000)
  await settle()
}

// ---------------------------------------------------------------- 
// Property: the todo folder listing is either whole or a failure the user is told of; a folder past the
// engine's 4 MiB stdout cap is never dropped with no word, and a failed listing is never an empty one.

/** 90,002 index entries, 4.9 MB of output as git gives them for a `big` repo, with a todo folder that sorts after the 4 MiB cut. */
const bigListing = (): string[] => [
  '.claude_todo/TODO.md',
  ...Array.from({ length: 90_000 }, (_, i) => `packages/pkg-${String(i).padStart(5, '0')}/src/components/module-${String(i).padStart(5, '0')}.ts`),
  'zz-service/.claude_todo/TODO.md',
]
const ENGINE_CAP = 4_194_304

test('a todo folder past the 4 MiB cut of the whole listing is found, through the pathspec', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a', '/repo/zz-service/.claude_todo/TODO.md': '- [ ] #T0002 b\n- [ ] new in service' }
  const toasts: string[] = []
  const listed = bigListing()
  expect(listed.join('\0').length).toBeGreaterThan(ENGINE_CAP)
  const fake = l1Disk(on, files, { cwd: '/repo', root: '/repo', listed, lsCap: ENGINE_CAP, toasts })
  await run($, clock)
  // The folder past the cut is on the board: its new item is numbered above the root folder's ID.
  expect(files['/repo/zz-service/.claude_todo/TODO.md']).toMatch(/#T\w+ new in service/)
  expect(toasts.filter(one => one.includes('could not list the todo folders'))).toEqual([])
  // Both listings carry the todo pathspecs.
  for (const call of fake.calls.filter(one => one.startsWith('git ls-files'))) {
    expect(call).toContain('-- :(icase,glob)**/.claude_todo/** :(icase,glob)**/.claude_todo')
  }
})

for (const [name, opts] of [
  // False state 1, behind a valid first case: the listing is cut even with the pathspec (more todo entries than the cap).
  ['the tracked listing cut at the cap', { listed: ['.claude_todo/TODO.md', ...Array.from({ length: 60 }, (_, i) => `d${i}/.claude_todo/T.md`), 'zz/.claude_todo/TODO.md'], lsCap: 200 }],
  // False state 2, at the limit of the scanned range: the second (ignored) listing is the one cut, by one byte.
  ['the ignored listing cut by one byte', { listed: ['.claude_todo/TODO.md'], ignored: ['ign/.claude_todo/'], lsCap: 'ign/.claude_todo'.length }],
  // False state 3, inside the population the old code read as empty: ls-files fails with exit 128.
  ['ls-files failing with exit 128', { listed: ['.claude_todo/TODO.md', 'zz/.claude_todo/TODO.md'], lsExit: 128 }],
] as const) {
  test(`${name} is a discovery failure with one toast, never a short listing`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a', '/repo/zz/.claude_todo/TODO.md': '- [ ] #T0009 z' }
    const toasts: string[] = []
    l1Disk(on, files, { cwd: '/repo', root: '/repo', toasts, ...opts })
    await run($, clock)
    // The merged L3 toast names the failure; the L1 property is one toast and no short listing.
    const told = toasts.filter(one => one.includes('could not list the todo folders'))
    expect(told.length).toBe(1)
    expect(told[0]).toContain(name.includes('exit') ? 'exited 128' : 'cut at the size limit')
  })
}

// ---------------------------------------------------------------- 
// Property: a real path in backslashes (the engine's realpath on Windows), in either drive-letter case,
// is read in the mod's one spelling: outside a repo or with git failing, the session's own folder is
// numbered, and no claim folder is made at a cut path.

const winForms: [string, (path: string) => string][] = [
  ['backslashes', path => path.replace(/\//g, '\\')],
  ['backslashes and a lowercase drive', path => path.replace(/\//g, '\\').replace(/^C:/, 'c:')],
  ['forward slashes and a lowercase drive', path => path.replace(/^C:/, 'c:')],
]

for (const [form, realForm] of winForms) {
  test(`outside a repo (git fails) at C:/proj, real paths with ${form}: the own folder is numbered`, async ($, on) => {
    const clock = mock.clock(on)
    const T = 'C:/proj/.claude_todo/TODO.md'
    const files: Record<string, string> = { [T]: '- [ ] #T0001 a\n- [ ] new one' }
    const toasts: string[] = []
    const fake = l1Disk(on, files, { cwd: 'C:/proj', root: 'C:/proj', gitFails: true, toasts, realForm })
    await run($, clock)
    expect(files[T]).toMatch(/#T\w+ new one/)
    expect(fake.calls.filter(call => call.includes('\\') && call.startsWith('mkdir'))).toEqual([])
  })

  test(`git fails in C:/repo, real paths with ${form}: the claim goes to the repo's .git, no junk mkdir`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { 'C:/repo/.claude_todo/TODO.md': '- [ ] #T0001 a', 'C:/repo/.git/HEAD': 'ref: refs/heads/main' }
    const fake = l1Disk(on, files, { cwd: 'C:/repo', root: 'C:/repo', gitFails: true, realForm })
    await open($)
    await settle()
    await $.prompt.submit({ text: 'add a ticket' } as never).catch(() => undefined)
    await settle()
    const made = fake.calls.filter(call => call.startsWith('mkdir') || call.startsWith('powershell'))
    expect(made.some(call => call.includes('C:/repo/.git/claudeopticon/id-claims'))).toBe(true)
    expect(made.filter(call => call.includes('.claude_tod/') || call.includes('\\'))).toEqual([])
  })
}

test('a POSIX real path is unchanged (control)', async ($, on) => {
  const clock = mock.clock(on)
  const T = '/proj/.claude_todo/TODO.md'
  const files: Record<string, string> = { [T]: '- [ ] #T0001 a\n- [ ] new one' }
  l1Disk(on, files, { cwd: '/proj', root: '/proj', gitFails: true })
  await run($, clock)
  expect(files[T]).toMatch(/#T\w+ new one/)
})

// ---------------------------------------------------------------- 
// Property: a backup write of a damaged book that fails is named once in a toast, and is tried again
// only after a growing wait, never with every scan; once a write works the sort runs.

test('a backup write that fails always: one toast names the error, and the tries back off', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 pay vendor', '/repo/.claude_todo/categories.json': '{ not json' }
  const toasts: string[] = []
  let tries = 0
  const fake = l1Disk(on, files, { cwd: '/repo', root: '/repo', listed: ['.claude_todo/TODO.md', '.claude_todo/categories.json'], toasts, reply: SORT, failWrite: path => path.includes('.bak') && (tries += 1) > 0 })
  await run($, clock, 10)
  const told = toasts.filter(one => one.includes('backup could not be written'))
  expect(told.length).toBe(1)
  // The test engine gives a throwing hook's write as "no implementation for fs.write"; the toast names whatever the engine gave.
  expect(told[0]).toMatch(/backup could not be written \([^)]+\)/)
  // 30 s of scans every 3 s: the old code tried 11 times. With a 5 s first wait doubling, at most 4.
  expect(tries).toBeGreaterThan(0)
  expect(tries).toBeLessThanOrEqual(4)
  // The damaged book is never written over.
  expect(fake.writes).not.toContain('/repo/.claude_todo/categories.json')
  expect(files['/repo/.claude_todo/categories.json']).toBe('{ not json')
})

test('a backup write that fails twice then works: the retry after the wait makes the backup, and the sort runs', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 pay vendor', '/repo/.claude_todo/categories.json': '{ not json' }
  const toasts: string[] = []
  let tries = 0
  const fake = l1Disk(on, files, { cwd: '/repo', root: '/repo', listed: ['.claude_todo/TODO.md', '.claude_todo/categories.json'], toasts, reply: SORT, failWrite: path => path.includes('.bak') && (tries += 1) <= 2 })
  await run($, clock, 25)
  expect(toasts.filter(one => one.includes('backup could not be written')).length).toBe(1)
  expect(files['/repo/.claude_todo/categories.json.bak']).toBe('{ not json')
  expect(fake.writes).toContain('/repo/.claude_todo/categories.json')
})

test('control: a backup write that works makes one backup, with no write toast', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 pay vendor', '/repo/.claude_todo/categories.json': '{ not json' }
  const toasts: string[] = []
  const fake = l1Disk(on, files, { cwd: '/repo', root: '/repo', listed: ['.claude_todo/TODO.md', '.claude_todo/categories.json'], toasts, reply: SORT })
  await run($, clock)
  // The control: the backup is written once and the book is sorted.
  expect(fake.writes.filter(path => path.includes('.bak'))).toEqual(['/repo/.claude_todo/categories.json.bak'])
  expect(toasts.filter(one => one.includes('backup could not be written'))).toEqual([])
})

// ---------------------------------------------------------------- 
// Property: an archive folder spelled `Archive/` on a disk that ignores case is the archive folder:
// Consolidate moves its files, Delete empty todos trashes its empty ones, and no false symlink toast shows.

for (const dirName of ['archive', 'Archive', 'ARCHIVE']) {
  test(`Consolidate, source archive folder ${dirName}/ (case-ignoring disk): the archived ticket ends in one place, no symlink toast`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = {
      '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a',
      '/repo/b/.claude_todo/TODO.md': '- [ ] #T0002 b',
      [`/repo/b/.claude_todo/${dirName}/TODO.md`]: '- [x] #T0003 old done\n',
    }
    const toasts: string[] = []
    l1Disk(on, files, { cwd: '/repo', root: '/repo', ci: true, listed: ['.claude_todo/TODO.md', 'b/.claude_todo/TODO.md', `b/.claude_todo/${dirName}/TODO.md`], toasts })
    const ui = await open($)
    await settle()
    await ui.press({ key: 'todo-consolidate' }).catch((error: unknown) => toasts.push(`press failed ${String(error)}`))
    await settle()
    const holders = Object.entries(files).filter(([, text]) => text.includes('#T0003')).map(([path]) => path)
    expect(holders).toEqual(['/repo/.claude_todo/archive/TODO.md'])
    expect(files['/repo/.claude_todo/TODO.md']).toContain('#T0002 b')
    expect(toasts.filter(one => one.includes('symlink'))).toEqual([])
  })
}

test('Delete empty todos trashes an empty file in Archive/ on a case-ignoring disk, and removes the folder', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a', '/repo/.claude_todo/Archive/OLD.md': '  \n' }
  const toasts: string[] = []
  const fake = l1Disk(on, files, { cwd: '/repo', root: '/repo', ci: true, listed: ['.claude_todo/TODO.md', '.claude_todo/Archive/OLD.md'], toasts })
  const ui = await open($)
  await clock.advance(3000)
  await settle()
  await ui.press({ key: 'todo-delete-empty' }).catch((error: unknown) => toasts.push(`press failed ${String(error)}`))
  await settle()
  expect(fake.calls).toContain('/usr/bin/trash /repo/.claude_todo/Archive/OLD.md')
  expect(fake.calls).toContain('rmdir -- /repo/.claude_todo/Archive')
  expect(files['/repo/.claude_todo/Archive/OLD.md']).toBeUndefined()
  expect(toasts.filter(one => one.includes('Kept:') || one.includes('symlink'))).toEqual([])
})

// ---------------------------------------------------------------- 
// Property: a session at any depth below a repo root with no nearer `.claude_todo/` has the root's
// folder as its primary one: the book is written and sorting runs.
//
// The regression for depths past the old limit of 8 is in tests/repo-folders.test.tsx ("the
// nearest-folder walk ..."), on `findTodoDirWith` itself. An engine test cannot reach those depths: the
// test engine makes each relative path absolute against the test's own folder and folds its `..`, so
// past that folder's depth (5 in the main checkout) every walk step reads the file system root. These
// engine tests are the wiring control (the walk's depth from the engine's real path of `.`), at
// depths every checkout can hold.

for (const depth of [0, 2, 4]) {
  test(`depth ${depth} below the repo root: the root todo is the primary folder (book written)`, async ($, on) => {
    const clock = mock.clock(on)
    const parts = 'abcdefghijklmnop'.slice(0, depth).split('')
    const S = depth === 0 ? '/repo' : `/repo/${parts.join('/')}`
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 pay vendor\n- [ ] new one', [`${S}/x.txt`]: 'x' }
    const fake = l1Disk(on, files, { cwd: S, root: '/repo', listed: ['.claude_todo/TODO.md', depth === 0 ? 'x.txt' : `${parts.join('/')}/x.txt`], reply: SORT })
    await run($, clock)
    expect(fake.writes).toContain('/repo/.claude_todo/categories.json')
  })
}
