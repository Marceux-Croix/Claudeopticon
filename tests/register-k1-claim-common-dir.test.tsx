// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// Claim folders from the common dir alone in every git layout (136), git
// output that names another folder (150), a symlink at the global `.claude_todo` itself (148), a case change in the
// `.claude_todo` segment (151) and in `archive/` (152), the end of the number line (142, 197), indented code (198).
// The fake is a copy of the J1 disk (a session folder, links, a disk that ignores case), with claim entries made
// atomically, a git call that may fail, a `mkdir` that may fail per path, and the worktree list as an option.
{
type On = Parameters<Parameters<typeof test>[1]>[1]
type TestApi = Parameters<Parameters<typeof test>[1]>[0]
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

const segs = (path: string) => path.split('/').filter(part => part !== '')

function resolveIn(base: string, path: string): string {
  const parts = (path.startsWith('/') ? path : `${base}/${path}`).split('/')
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

type K1Opts = {
  cwd: string
  root?: string
  listed?: string[]
  /** The REV_PARSE output; by default the real shape for `cwd` in `root`. */
  rev?: string
  /** `git` exits 128 for every call, as for a repo of "dubious ownership". */
  gitFails?: boolean
  /** The `git worktree list --porcelain` output. */
  worktrees?: string
  /** Folders that exist with nothing in them (a bare repo's common dir). */
  dirs?: string[]
  /** A path (or a folder above it) and its real path: a symlink. The object may change during the test. */
  links?: Record<string, string>
  /** A disk that ignores letter case: a path in any case finds the file, and the real path has the disk's case. */
  ci?: boolean
  /** True for a folder `mkdir` (with or without `-p`) cannot make: a read-only common dir. */
  mkdirFails?: (path: string) => boolean
}

/**
 * A fake disk and git with a session folder (`cwd`). The test engine hands a relative path over made absolute
 * against its own folder (`.` is that folder itself); the fake reads such a path back as relative against `cwd`,
 * learning the engine's folder from the first `.claude_todo` it is asked about. `mkdir` without `-p` makes a claim
 * entry atomically (one that is there exits 1).
 */
function k1Disk(on: On, files: Record<string, string>, opts: K1Opts) {
  const R = opts.root ?? opts.cwd
  const writes: string[] = []
  const calls: string[] = []
  const toasts: string[] = []
  const claims = new Set<string>()
  const links = opts.links ?? {}
  const own = new Set([R, opts.cwd, ...Object.keys(files), ...Object.keys(links), ...Object.values(links), ...(opts.dirs ?? []), '/home/a'].map(path => segs(path)[0] ?? ''))
  let harness: string | undefined
  const map = (path: string) => {
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
  const fileAt = (path: string) => Object.keys(files).find(one => key(one) === key(path))
  const isDirAt = (path: string) => Object.keys(files).some(one => key(one).startsWith(`${key(path)}/`)) || (opts.dirs ?? []).some(one => key(one) === key(path)) || claims.has(key(path))
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
  const exists = (raw: string) => fileAt(real(raw)) !== undefined || isDirAt(real(raw))
  on('process.run', (_$, e) => {
    const { argv } = e as unknown as { argv: string[] }
    calls.push(argv.join(' '))
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : out('', 1)
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
      return out(opts.worktrees ?? `worktree ${R}\nHEAD a\nbranch refs/heads/main\n`)
    }
    if (argv[0] === 'git' && argv[1] === 'ls-files') {
      return out(argv.includes('--directory') ? '' : (opts.listed ?? []).join('\0'))
    }
    if (argv[0] === 'mkdir') {
      const path = argv[argv.length - 1]!
      if (opts.mkdirFails?.(path) === true) {
        return out('', 1)
      }
      if (argv[1] === '-p') {
        return out('')
      }
      if (claims.has(key(path))) {
        return out('', 1)
      }
      claims.add(key(path))

      return out('')
    }
    if (argv[0] === 'rmdir') {
      return out('', claims.delete(key(argv[argv.length - 1]!)) ? 0 : 1)
    }
    if (['open', 'xdg-open'].includes(argv[0]!)) {
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

    return { value: { kind: fileAt(real(path)) !== undefined ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: Object.keys(links).some(one => key(one) === key(path)), realPath: real(path) } } as never
  })
  on('fs.list', (_$, e) => {
    const dir = real(map(e.path))
    const names = new Set<string>()
    for (const one of Object.keys(files)) {
      if (key(one).startsWith(`${key(dir)}/`)) {
        names.add(one.slice(dir.length + 1).split('/')[0]!)
      }
    }
    for (const one of claims) {
      if (one.startsWith(`${key(dir)}/`)) {
        names.add(one.slice(dir.length + 1).split('/')[0]!)
      }
    }

    return { value: [...names].map(name => ({ name, kind: fileAt(`${dir}/${name}`) !== undefined ? 'file' : 'dir', size: 1, mtimeMs: 2 + writes.length, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    const file = fileAt(real(map(e.path)))
    if (file === undefined) {
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
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'sess-k1' }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '{}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  const kept = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: kept.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    kept.set(e.key, e.value)

    return { value: undefined } as never
  })

  return { writes, calls, toasts, claims }
}

const open = async ($: TestApi) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function promptOf(on: On): { line: () => string | undefined } {
  let ctx: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    ctx = e.context ?? []

    return { text: e.text, context: e.context }
  })

  return { line: () => ctx.join('\n').split('\n').find(one => one.startsWith('Next free ticket IDs')) }
}

const settle = async (clock: { advance: (ms: number) => Promise<unknown> }, rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    await clock.advance(3000)
  }
  await sleep(40)
}

const claimMkdirs = (calls: readonly string[]) => calls.filter(one => one.startsWith('mkdir -- '))
const offered = (line: string | undefined): string[] => (line === undefined ? [] : [...line.matchAll(/#(T\w+)/g)].map(m => m[1]!))

// ---------------------------------------------------------------- the claim folders of every git layout
// Property: every session of a repo names the same claim folders, so no block has two holders: the fallback comes
// from the common dir alone (only `<root>/.git` gives one), and a session whose git fails reaches the same folders.

const BARE = '/srv/bare.git'
const BARE_CLAIMS = `${BARE}/claudeopticon/id-claims`
// a linked worktree's git dir holds `commondir` (`../..`), as `git worktree add` writes it; the walk reads it.
const bareFiles = (wt: string): Record<string, string> => ({ [`${wt}/.claude_todo/TODO.md`]: '- [ ] #T0001 a', [`${wt}/.git`]: `gitdir: ${BARE}/worktrees/${wt.split('/').pop()}\n`, [`${BARE}/worktrees/${wt.split('/').pop()}/commondir`]: '../..\n' })
const bareOpts = (wt: string): K1Opts => ({
  cwd: wt,
  rev: `${wt}\n${BARE}/worktrees/${wt.split('/').pop()}\n${BARE}\n\n`,
  worktrees: `worktree ${BARE}\nbare\n\nworktree ${wt}\nHEAD a\nbranch refs/heads/one\n`,
  listed: ['.claude_todo/TODO.md'],
  dirs: [BARE, `${BARE}/worktrees`],
})

test('a bare repo worktree whose common dir cannot be written names no IDs, never claiming in its own .claude_work', async ($, on) => {
  mock.clock(on)
  // The s3 state: the common dir is read-only; the old fallback was this worktree's own `.claude_work`, which no other worktree lists.
  const fake = k1Disk(on, bareFiles('/wt/one'), { ...bareOpts('/wt/one'), mkdirFails: path => path.startsWith(BARE) })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  await $.prompt.submit({ text: 'again' } as never)
  expect(prompt.line()).toBeUndefined()
  expect(fake.calls.filter(one => one.startsWith('mkdir') && one.includes('.claude_work'))).toEqual([])
  expect(fake.toasts.filter(one => one.includes(`could not make ${BARE_CLAIMS}`)).length).toBe(1)
})

test('a bare repo worktree with a writable common dir claims there, as every other worktree does', async ($, on) => {
  mock.clock(on)
  // Behind a valid first case: the same layout, common dir writable; the claim is in the common dir.
  const fake = k1Disk(on, bareFiles('/wt/two'), bareOpts('/wt/two'))
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${BARE_CLAIMS}/0`])
  expect(offered(prompt.line())).toEqual(['T0002', 'T0003', 'T0004'])
})

test('git fails in a bare repo worktree: the .git file names the common dir, and the claim goes there', async ($, on) => {
  mock.clock(on)
  // The excluded population of the git check: no git at all; the `.git` file is the only source of the common dir.
  const fake = k1Disk(on, bareFiles('/wt/one'), { ...bareOpts('/wt/one'), gitFails: true })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(claimMkdirs(fake.calls)).toEqual([`mkdir -- ${BARE_CLAIMS}/0`])
  expect(offered(prompt.line()).length).toBe(3)
})

test('git fails with the todo folder 12 folders below the repo root: the claim is still in the git folder', async ($, on) => {
  mock.clock(on)
  // At the limit of the walk: the edge case 2. The old walk stopped after 9 folders and claimed in this folder's `.claude_work`.
  const deep = `/repo/${Array.from({ length: 12 }, (_, i) => `d${i}`).join('/')}`
  const files: Record<string, string> = { [`${deep}/.claude_todo/TODO.md`]: '- [ ] #T0001 a', '/repo/README.md': 'x' }
  const fake = k1Disk(on, files, { cwd: deep, root: '/repo', gitFails: true, dirs: ['/repo/.git'] })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(claimMkdirs(fake.calls)).toEqual(['mkdir -- /repo/.git/claudeopticon/id-claims/0'])
  expect(offered(prompt.line()).length).toBe(3)
})

// ---------------------------------------------------------------- git output that names another folder
// Property: the mod reads git's output only when the session folder it names is the session's own folder (the
// real path of `.`); else the session takes the outside-a-repo path and never writes the folder git named.

for (const [label, rev] of [
  ['GIT_DIR and GIT_WORK_TREE in the environment (vcsh)', '/w/plain\n/w/plain/.git\n/w/plain/.git\n\n'],
  ['core.worktree set to another folder', '/w/other\n.git\n.git\n\n'],
  ['a subfolder git names as the top, with no prefix', '/w/proj/sub\n.git\n.git\n\n'],
] as const) {
  test(`${label}: a session in /w/proj never writes the todo or the .git of the folder git names`, async ($, on) => {
    const clock = mock.clock(on)
    const top = rev.split('\n')[0]!
    const files: Record<string, string> = { '/w/proj/CLAUDE.md': '# x', [`${top}/.claude_todo/TODO.md`]: '- [ ] #T0001 named\n- [ ] new line there' }
    const fake = k1Disk(on, files, { cwd: '/w/proj', rev, listed: ['.claude_todo/TODO.md'], dirs: [`${top}/.git`] })
    await open($)
    await settle(clock, 8)
    expect(fake.writes.filter(one => one.startsWith(`${top}/`))).toEqual([])
    expect(fake.calls.filter(one => one.startsWith('mkdir') && one.includes(top))).toEqual([])
    expect(files[`${top}/.claude_todo/TODO.md`]).toBe('- [ ] #T0001 named\n- [ ] new line there')
  })
}

test('the control: a session inside the repo git names still numbers its todo', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/w/proj/.claude_todo/TODO.md': '- [ ] #T0001 named\n- [ ] new line here' }
  const fake = k1Disk(on, files, { cwd: '/w/proj', listed: ['.claude_todo/TODO.md'], dirs: ['/w/proj/.git'] })
  await open($)
  await settle(clock, 8)
  expect(files['/w/proj/.claude_todo/TODO.md']).toMatch(/^- \[ \] #T0001 named\n- \[ \] #T\w+ new line here$/)
  expect(fake.writes).toContain('/w/proj/.claude_todo/TODO.md')
})

// ---------------------------------------------------------------- a symlink at the global .claude_todo itself
// Property: the global todo folder is never written, also when `~/.claude/.claude_todo` itself becomes a symlink
// to a project folder after the load.

test('~/.claude/.claude_todo made a symlink to the project folder after the load: that folder is no longer written', async ($, on) => {
  const clock = mock.clock(on)
  const T = '/repo/.claude_todo/TODO.md'
  const files: Record<string, string> = { [T]: '- [ ] #T0001 a\n- [ ] first new', '/home/a/.claude/settings.json': '{}' }
  const links: Record<string, string> = {}
  const fake = k1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md'], dirs: ['/repo/.git'], links })
  await open($)
  await settle(clock)
  // Behind a valid first case: before the link the project folder is numbered.
  expect(files[T]).toMatch(/#T\w+ first new/)
  const before = fake.writes.length
  links['/home/a/.claude/.claude_todo'] = '/repo/.claude_todo'
  files[T] += '\n- [ ] after the link'
  await settle(clock, 8)
  expect(fake.writes.slice(before).filter(one => one.startsWith('/repo/.claude_todo/'))).toEqual([])
  expect(files[T]).toMatch(/\n- \[ \] after the link$/)
})

// ---------------------------------------------------------------- a case change in the .claude_todo segment
// Property: a todo folder whose `.claude_todo` segment git lists in another case is found and numbered; one the disk
// spells in another case is named in one toast, never left out silently.

test('git lists docs/.Claude_todo after a case-only rename of the folder itself: the folder is numbered', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a', '/repo/docs/.claude_todo/TODO.md': '- [ ] #T0002 b\n- [ ] new one' }
  k1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md', 'docs/.Claude_todo/TODO.md'], ci: true, dirs: ['/repo/.git'] })
  await open($)
  await settle(clock)
  expect(files['/repo/docs/.claude_todo/TODO.md']).toMatch(/- \[ \] #T\w+ new one/)
})

test('the disk spells the folder docs/.Claude_todo: it is named once in a toast and never written', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a', '/repo/docs/.Claude_todo/TODO.md': '- [ ] #T0002 b\n- [ ] new one' }
  const fake = k1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md', 'docs/.Claude_todo/TODO.md'], dirs: ['/repo/.git'] })
  await open($)
  await settle(clock)
  await settle(clock)
  expect(fake.toasts.filter(one => one.includes('/repo/docs/.Claude_todo') && one.includes('lowercase')).length).toBe(1)
  expect(fake.writes.filter(one => one.includes('.Claude_todo'))).toEqual([])
})

// ---------------------------------------------------------------- the archive folder in another case
// Property: a closed ticket is archived when the folder's archive is spelled `Archive/` or `ARCHIVE/` on a disk that
// ignores case, into that folder.

for (const dirName of ['Archive', 'ARCHIVE']) {
  test(`the archive folder spelled ${dirName} on a disk that ignores case: a closed ticket is archived into it`, async ($, on) => {
    const clock = mock.clock(on)
    const T = '/repo/.claude_todo/TODO.md'
    const A = `/repo/.claude_todo/${dirName}/TODO.md`
    const files: Record<string, string> = { [T]: '- [ ] #T0001 open\n- [x] #T0002 done', [A]: '- [x] #T0000 older\n' }
    k1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md'], ci: true, dirs: ['/repo/.git'] })
    await open($)
    await settle(clock, 12)
    expect(files[T]).toBe('- [ ] #T0001 open')
    expect(files[A]).toContain('#T0002 done')
    expect(Object.keys(files).filter(one => one.toLowerCase() === A.toLowerCase())).toEqual([A])
  })
}

// ---------------------------------------------------------------- the end of the number line
// Property: a stray `#T` tag in an example never moves the next IDs and never stops them; only an ID at the end of
// the line (T1ZZZZ) fills it, and then no block is claimed and one toast names the line.

for (const tag of ['#T202410', '#T9ZZZZZ', '#T20241']) {
  test(`an example line with ${tag} leaves the next ID at T0002`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': `- [ ] #T0001 a\n\`\`\`md\n- [ ] ${tag} an example line\n\`\`\`` }
    const fake = k1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md'], dirs: ['/repo/.git'] })
    const prompt = promptOf(on)
    await open($)
    await settle(clock, 3)
    await $.prompt.submit({ text: 'go' } as never)
    expect(offered(prompt.line())).toEqual(['T0002', 'T0003', 'T0004'])
    expect(claimMkdirs(fake.calls)).toEqual(['mkdir -- /repo/.git/claudeopticon/id-claims/0'])
  })
}

test('an ID at the end of the line (, in an example): no block is claimed, and one toast names the line', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a\n```md\n- [ ] #T1ZZZZ last example\n```\n- [ ] new one' }
  const fake = k1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md'], dirs: ['/repo/.git'] })
  const prompt = promptOf(on)
  await open($)
  await settle(clock, 8)
  await $.prompt.submit({ text: 'go' } as never)
  await $.prompt.submit({ text: 'again' } as never)
  expect(claimMkdirs(fake.calls)).toEqual([])
  expect(fake.calls.filter(one => one.startsWith('mkdir -p'))).toEqual([])
  expect(prompt.line()).toBeUndefined()
  const full = fake.toasts.filter(one => one.includes('used up by #T1ZZZZ'))
  expect(full.length).toBe(1)
  expect(full[0]).toContain('/repo/.claude_todo/TODO.md')
  expect(full[0]).toContain('- [ ] #T1ZZZZ last example')
})

// ---------------------------------------------------------------- indented code blocks
// Property: a checkbox line in an indented code block is an example: never numbered, never a ticket.

test('a checkbox line in an indented code block is not numbered; a new ticket line is', async ($, on) => {
  const clock = mock.clock(on)
  const T = '/repo/.claude_todo/TODO.md'
  const files: Record<string, string> = { [T]: '- [ ] #T0001 a\n\n      - [ ] example in the item\n\nNotes:\n\n    - [ ] example at the top level\n\n- [ ] new one' }
  k1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md'], dirs: ['/repo/.git'] })
  await open($)
  await settle(clock, 8)
  expect(files[T]).toMatch(/\n- \[ \] #T\w+ new one$/)
  expect(files[T]).toContain('\n      - [ ] example in the item\n')
  expect(files[T]).toContain('\n    - [ ] example at the top level\n')
})
}
