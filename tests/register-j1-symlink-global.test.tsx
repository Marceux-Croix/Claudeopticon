// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// Batch J1 (UCR loop 2): the global folder behind a symlink made after the start, a book
// changed on disk before a sort writes it, REV_PARSE output for a path with a line break
//, a case-only folder rename, an archive file in another letter case,
// and Windows real paths with backslashes in Consolidate. j1Disk is this block's own fake.
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

type J1Opts = {
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
}

/**
 * A fake disk and git with a session folder (`cwd`). The test engine hands a relative path over made
 * absolute against its own folder; the fake reads such a path back as relative against `cwd` (as
 * g1Repo does). Every path goes through `links` to its real path, and with `ci` in any letter case.
 */
function j1Disk(on: On, files: Record<string, string>, opts: J1Opts) {
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
    if (argv[0] === 'git' && argv[1] === 'rev-parse') {
      const prefix = opts.cwd === R ? '' : `${opts.cwd.slice(R.length + 1)}/`

      return out(opts.rev ?? (prefix === '' ? `${R}\n.git\n.git\n\n` : `${R}\n${R}/.git\n${'../'.repeat(segs(prefix).length)}.git\n${prefix}\n`))
    }
    if (argv[0] === 'git' && argv[1] === 'worktree') {
      return out(`worktree ${R}\nHEAD a\nbranch refs/heads/main\n`)
    }
    if (argv[0] === 'git' && argv[1] === 'ls-files') {
      return out(argv.includes('--directory') ? '' : (opts.listed ?? []).join('\0'))
    }
    if (['open', 'xdg-open', 'mkdir'].includes(argv[0]!)) {
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

// ---------------------------------------------------------------- 
// Property: the global todo folder is never written, also when `~/.claude`, HOME or CLAUDE_CONFIG_DIR
// is a symlink and `.claude_todo` is made after the start, or the symlink itself is made after the
// load. A project folder in the same repo is still numbered.

type GlobalState = { name: string; real: string; home?: string; env?: Record<string, string>; links: Record<string, string>; linkLater?: true }
const GLOBAL_STATES: GlobalState[] = [
  { name: 'a symlinked ~/.claude (stow)', real: '/home/a/dotfiles/claude', links: { '/home/a/.claude': '/home/a/dotfiles/claude' } },
  { name: 'a symlinked CLAUDE_CONFIG_DIR', real: '/data/cfg', env: { CLAUDE_CONFIG_DIR: '/home/a/cfg' }, links: { '/home/a/cfg': '/data/cfg' } },
  { name: 'a symlinked HOME', real: '/data/a/.claude', home: '/home/a', links: { '/home/a': '/data/a' } },
  { name: 'a ~/.claude symlink made after the load', real: '/home/a/dotfiles/claude', links: {}, linkLater: true },
]
for (const state of GLOBAL_STATES) {
  test(`${state.name}, .claude_todo made after the start: the global folder is never written`, async ($, on) => {
    const clock = mock.clock(on)
    const G = `${state.real}/.claude_todo`
    const files: Record<string, string> = { [`${state.real}/CLAUDE.md`]: '# x', [`${G}/TODO.md`]: '- [ ] #T0001 a\n- [ ] new one', [`${state.real}/proj/.claude_todo/TODO.md`]: '- [ ] #T0002 p\n- [ ] new proj' }
    const hidden = new Set([G])
    const links: Record<string, string> = { ...state.links }
    const fake = j1Disk(on, files, { cwd: state.real, listed: ['CLAUDE.md', 'proj/.claude_todo/TODO.md'], links, hidden, ...(state.home === undefined ? {} : { home: state.home }), ...(state.env === undefined ? {} : { env: state.env }) })
    await open($)
    await clock.advance(3000)
    if (state.linkLater === true) {
      links['/home/a/.claude'] = state.real
    }
    hidden.clear()
    for (let i = 0; i < 8; i += 1) {
      await clock.advance(3000)
    }
    await settle()
    expect(fake.writes.filter(path => path.startsWith(`${G}/`))).toEqual([])
    expect(files[`${G}/TODO.md`]).toBe('- [ ] #T0001 a\n- [ ] new one')
    // The project folder beside it is trusted as before.
    expect(files[`${state.real}/proj/.claude_todo/TODO.md`]).toMatch(/- \[ \] #T\w+ new proj/)
  })
}

// ---------------------------------------------------------------- 
// Property: a change to categories.json made after the book was read (an edit, a git pull, a branch
// switch, a delete) is never written over by a sort or by Recategorize.

const BOOK = '/repo/.claude_todo/categories.json'
const LIVE = '/repo/.claude_todo/OPEN.md'
type BookState = { name: string; atStart?: string; during?: (files: Record<string, string>) => void; after?: (files: Record<string, string>) => void; keeps: (book: string | undefined) => void }
const BOOK_STATES: BookState[] = [
  {
    name: 'an edit after the first sort',
    after: files => (files[BOOK] = '{\n  "categories": ["Money"],\n  "items": {"#t0001": "Money"}\n}\n'),
    keeps: book => expect(book).toContain('Money'),
  },
  {
    name: 'a delete after the first sort',
    after: files => delete files[BOOK],
    keeps: book => expect(book ?? '').not.toContain('Billing'),
  },
  {
    name: 'a book made during the first model call, with none at the load',
    during: files => (files[BOOK] = '{\n  "categories": ["Money"],\n  "items": {"#t0001": "Money"}\n}\n'),
    keeps: book => expect(book).toContain('Money'),
  },
]
for (const state of BOOK_STATES) {
  test(`${state.name}: the change survives the next sort`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [LIVE]: '- [ ] #T0001 pay vendor' }
    let calls = 0
    let reply = '{"categories": ["Billing"], "assign": {"1": "Billing"}}'
    j1Disk(on, files, {
      cwd: '/repo',
      listed: ['.claude_todo/OPEN.md'],
      reply: () => {
        calls += 1
        if (calls === 1) {
          state.during?.(files)
        }

        return reply
      },
    })
    await open($)
    for (let i = 0; i < 100 && calls === 0; i += 1) {
      await settle()
    }
    await settle()
    state.after?.(files)
    files[LIVE] = '- [ ] #T0001 pay vendor\n- [ ] #T0003 hire lawyer'
    reply = '{"categories": ["Legal"], "assign": {"1": "Legal", "2": "Legal"}}'
    for (let i = 0; i < 30; i += 1) {
      await clock.advance(3000)
    }
    await settle()
    expect(calls).toBeGreaterThan(1)
    state.keeps(files[BOOK])
  })
}

test('an edit during the Recategorize model call is kept, and the note says the file changed', async ($, on) => {
  mock.clock(on)
  const before = JSON.stringify({ categories: ['Code', 'Docs'], items: { '#t1': 'Code', '#t2': 'Code', '#t3': 'Docs', '#t4': 'Docs' } })
  const edited = JSON.stringify({ categories: ['Money'], items: { '#t1': 'Money' } })
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': ['- [ ] #T1 parser', '- [ ] #T2 lexer', '- [ ] #T3 guide', '- [ ] #T4 faq'].join('\n'), [BOOK]: before }
  let isPressed = false
  j1Disk(on, files, {
    cwd: '/repo',
    listed: ['.claude_todo/TODO.md'],
    reply: () => {
      if (isPressed) {
        files[BOOK] = edited
      }

      return JSON.stringify({ categories: ['Lexing', 'Parsing', 'Writing'], assign: { 1: 'Parsing', 2: 'Lexing', 3: 'Writing', 4: 'Writing' } })
    },
  })
  const ui = await open($)
  await settle()
  isPressed = true
  await ui.press({ key: 'todo-recategorize' })
  await settle()
  expect(files[BOOK]).toBe(edited)
  expect(await ui.find({ type: 'Text', text: /categories\.json changed on disk/ })).toBeDefined()
})

// ---------------------------------------------------------------- 
// Property: REV_PARSE output in which a line break or a CR in a path would move or cut a line never
// names another repo: such output takes the outside-a-repo path, a lone CR stays in the folder name,
// and no other repo's todo is written.

const NL_REPOS: [string, string, string, string][] = [
  // [name, session folder, the REV_PARSE output, the other repo's folder]
  ['a line break inside the folder name (the real git output)', '/w/nl\nx', '/w/nl\nx\n.git\n.git\n\n', '/w/nl'],
  ['a line break at the end of the folder name', '/w/nl\n', '/w/nl\n\n.git\n.git\n\n', '/w/nl'],
  ['a line break in the folder name of a linked worktree', '/w/wt\nx', '/w/wt\nx\n/w/m/.git/worktrees/wt\nx\n/w/m/.git\n\n', '/w/wt'],
  // A CR is no line break on POSIX: cut with it, the folder name would be the sibling's.
  ['a CR at the end of the folder name', '/w/nl\r', '/w/nl\r\n.git\n.git\n\n', '/w/nl'],
]
for (const [name, session, rev, other] of NL_REPOS) {
  test(`${name}: the todo of ${JSON.stringify(other)} is never written`, async ($, on) => {
    const clock = mock.clock(on)
    const T = `${other}/.claude_todo/TODO.md`
    const files: Record<string, string> = { [T]: '- [ ] #T0001 sibling ticket\n- [ ] sibling new line', [`${session}/README.md`]: '# own repo, no todo folder yet' }
    const fake = j1Disk(on, files, { cwd: session, root: other, rev, listed: ['.claude_todo/TODO.md'] })
    await open($)
    for (let i = 0; i < 6; i += 1) {
      await clock.advance(3000)
    }
    await settle()
    expect(files[T]).toBe('- [ ] #T0001 sibling ticket\n- [ ] sibling new line')
    expect(fake.writes).toEqual([])
    expect(fake.calls.some(one => one.startsWith('mkdir'))).toBe(false)
  })
}

test('control: a session in a subfolder, git output of the real shape, still numbers its repo', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a\n- [ ] new one', '/repo/sub/deep/x.txt': 'x' }
  j1Disk(on, files, { cwd: '/repo/sub/deep', root: '/repo', listed: ['.claude_todo/TODO.md', 'sub/deep/x.txt'] })
  await open($)
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(3000)
  }
  await settle()
  expect(files['/repo/.claude_todo/TODO.md']).toMatch(/- \[ \] #T\w+ new one/)
})

// ---------------------------------------------------------------- 
// Property: a todo folder that git lists in another letter case than the disk has (a case-only
// rename on a disk that ignores case) is trusted like any other; a listed folder whose real path is
// elsewhere stays untrusted.

const CASE_STATES: [string, string, string][] = [
  // [name, the path git lists, the path on disk]
  ['one folder renamed', 'Docs/.claude_todo/TODO.md', '/repo/docs/.claude_todo/TODO.md'],
  ['two folders renamed, deepest last', 'Mods/Alpha/.claude_todo/TODO.md', '/repo/mods/alpha/.claude_todo/TODO.md'],
  ['the folder right above .claude_todo renamed by one letter', 'mods/Beta/.claude_todo/TODO.md', '/repo/mods/beta/.claude_todo/TODO.md'],
]
for (const [name, listed, disk] of CASE_STATES) {
  test(`a case-only rename, ${name}: the folder is numbered`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a', [disk]: '- [ ] #T0002 b\n- [ ] new one' }
    j1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md', listed], ci: true })
    await open($)
    for (let i = 0; i < 6; i += 1) {
      await clock.advance(3000)
    }
    await settle()
    expect(files[disk]).toMatch(/- \[ \] #T\w+ new one/)
  })
}

test('the excluded population: a listed folder that is a symlink elsewhere, in another case, is never written', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a', '/elsewhere/docs/.claude_todo/TODO.md': '- [ ] #T0002 b\n- [ ] new one' }
  const fake = j1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md', 'Docs/.claude_todo/TODO.md'], ci: true, links: { '/repo/Docs': '/elsewhere/docs' } })
  await open($)
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(3000)
  }
  await settle()
  expect(files['/elsewhere/docs/.claude_todo/TODO.md']).toBe('- [ ] #T0002 b\n- [ ] new one')
  expect(fake.writes.filter(path => path.startsWith('/elsewhere/'))).toEqual([])
})

// ---------------------------------------------------------------- 
// Property: a closed ticket is archived into the archive file the folder has, in whatever letter case
// the disk keeps it; on a disk that keeps case apart, another file is never taken for it.

const ARCHIVE_STATES: [string, string, boolean][] = [
  // [name, the archive file on disk, whether the disk ignores case]
  ['all lower case', 'todo.md', true],
  ['mixed case at the extension', 'Todo.MD', true],
  ['only the first letter in upper case', 'Todo.md', true],
]
for (const [name, archive, ci] of ARCHIVE_STATES) {
  test(`an archive file spelled ${archive} (${name}) for TODO.md: the closed ticket is archived into it`, async ($, on) => {
    const clock = mock.clock(on)
    const T = '/repo/.claude_todo/TODO.md'
    const A = `/repo/.claude_todo/archive/${archive}`
    const files: Record<string, string> = { [T]: '- [ ] #T0001 open\n- [x] #T0002 done', [A]: '- [x] #T0000 older\n' }
    j1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md'], ci })
    await open($)
    for (let i = 0; i < 12; i += 1) {
      await clock.advance(3000)
    }
    await settle()
    expect(files[T]).toBe('- [ ] #T0001 open')
    expect(files[A]).toContain('#T0002 done')
    expect(Object.keys(files).filter(path => path.includes('/archive/'))).toEqual([A])
  })
}

test('the excluded population: on a disk that keeps case apart, archive/todo.md is left and archive/TODO.md is made', async ($, on) => {
  const clock = mock.clock(on)
  const T = '/repo/.claude_todo/TODO.md'
  const files: Record<string, string> = { [T]: '- [ ] #T0001 open\n- [x] #T0002 done', '/repo/.claude_todo/archive/todo.md': '- [x] #T0000 older\n' }
  j1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md'], ci: false })
  await open($)
  for (let i = 0; i < 12; i += 1) {
    await clock.advance(3000)
  }
  await settle()
  expect(files[T]).toBe('- [ ] #T0001 open')
  expect(files['/repo/.claude_todo/archive/todo.md']).toBe('- [x] #T0000 older\n')
  expect(files['/repo/.claude_todo/archive/TODO.md']).toContain('#T0002 done')
})

// ---------------------------------------------------------------- 
// Property: on Windows, Consolidate writes the central file when the engine gives real paths with
// backslashes (or a lower-case drive); a central archive folder that is a symlink is still refused.

const BACK = (path: string) => path.replace(/\//g, '\\')
const WIN_STATES: [string, (path: string) => string][] = [
  ['backslashes', BACK],
  ['backslashes and a lower-case drive', path => BACK(path).replace(/^C:/, 'c:')],
  ['forward slashes and a lower-case drive', path => path.replace(/^C:/, 'c:')],
]
for (const [name, form] of WIN_STATES) {
  test(`Windows real paths with ${name}: Consolidate writes the central file`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { 'C:/repo/.claude_todo/TODO.md': '- [ ] #T0001 a', 'C:/repo/mods/y/.claude_todo/TODO.md': '- [ ] #T0002 b' }
    const toasts: string[] = []
    j1Disk(on, files, { cwd: 'C:/repo', listed: ['.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md'], realForm: form, toasts })
    const ui = await open($)
    await clock.advance(3000)
    await settle()
    await ui.press({ key: 'todo-consolidate' })
    await settle()
    expect(files['C:/repo/.claude_todo/TODO.md']).toContain('#T0002 b')
    expect(toasts.join('\n')).not.toContain('symlink')
  })
}

test('the excluded population: a central archive folder that is a symlink, real paths with backslashes, is not written', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    'C:/repo/.claude_todo/TODO.md': '- [ ] #T0001 a',
    'C:/repo/mods/y/.claude_todo/TODO.md': '- [ ] #T0002 b',
    'C:/repo/mods/y/.claude_todo/archive/TODO.md': '- [x] #T0003 old',
    'D:/elsewhere/archive/keep.md': 'x',
  }
  const toasts: string[] = []
  const fake = j1Disk(on, files, { cwd: 'C:/repo', listed: ['.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md', 'mods/y/.claude_todo/archive/TODO.md'], realForm: BACK, links: { 'C:/repo/.claude_todo/archive': 'D:/elsewhere/archive' }, toasts })
  const ui = await open($)
  await clock.advance(3000)
  await settle()
  await ui.press({ key: 'todo-consolidate' })
  await settle()
  expect(fake.writes.filter(path => path.startsWith('D:/'))).toEqual([])
  expect(files['C:/repo/mods/y/.claude_todo/archive/TODO.md']).toBe('- [x] #T0003 old')
  expect(files['C:/repo/.claude_todo/TODO.md']).toContain('#T0002 b')
})
}

// ---------------------------------------------------------------- batch J3: todo write safety (167-176)
// The fault-injection runs of the same writes (R3-G, R3-H) are in register-write-faults.test.tsx: 132 engine runs would push
// this file further past the 600 s limit of one test file.
