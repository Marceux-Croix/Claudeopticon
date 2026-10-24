import { expect, mock, test } from 'claude-code/testing'
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
  /** ui.toast throws. */
  toastThrows?: boolean
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
    if (opts.toastThrows === true) {
      throw new Error('toast down')
    }

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


// ---------------------------------------------------------------- the engine paths of to 
// The rig above is a copy of the claim-folder rig; these tests own it.

const T = '/repo/.claude_todo/TODO.md'
/** A session in `/repo` with one todo file holding `text`, after the scans and numbering have run. */
const run = async ($: TestApi, on: On, text: string, extra: Partial<K1Opts> = {}) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [T]: text }
  const fake = k1Disk(on, files, { cwd: '/repo', listed: ['.claude_todo/TODO.md'], dirs: ['/repo/.git'], ...extra })
  await open($)
  await settle(clock, 8)

  return { files, fake, clock }
}

/** Property: a lazy line under a ticket ends no item, so numbering reaches a child ticket after it. */
test('a lazy line in the parent, then a blank line: the child ticket at 4 spaces is numbered', async ($, on) => {
  // The L3R2-U2 state (it failed on the code before this fix).
  const { files } = await run($, on, '- [ ] #T0001 parent\nwrapped note\n\n    - [ ] child task')
  expect(files[T]).toMatch(/\n {4}- \[ \] #T\w+ child task$/)
})

test('control: no lazy line, the child at 4 spaces after a blank line is numbered', async ($, on) => {
  const { files } = await run($, on, '- [ ] #T0001 parent\n  wrapped note\n\n    - [ ] child task')
  expect(files[T]).toMatch(/\n {4}- \[ \] #T\w+ child task$/)
})

/** Property: an unclosed comment in a list item ends with the item, so the tickets after it are numbered. */
test('an unclosed comment in an item: the next item at column 0 is numbered', async ($, on) => {
  // The L3R2-U1 state.
  const { files } = await run($, on, '- [ ] #T0001 parent\n  <!-- draft note\n- [ ] new ticket')
  expect(files[T]).toMatch(/\n- \[ \] #T\w+ new ticket$/)
  expect(files[T]).toContain('\n  <!-- draft note\n')
})

/** Property: an example in indented code is never numbered, and never takes a real ticket's ID. */
test('indented code right after a heading: the example line is never numbered', async ($, on) => {
  // The L3R2-198 state.
  const { files } = await run($, on, '- [ ] #T0001 a\n## Examples of the format\n    - [ ] example line')
  expect(files[T]).toBe('- [ ] #T0001 a\n## Examples of the format\n    - [ ] example line')
})

test('an indented-code example under a heading that reuses a real ticket\'s ID never renames the ticket', async ($, on) => {
  // The L3R2-198b state: the old reading wrote `- [ ] Fix the parser`.
  const text = '## Format of a ticket\n    - [ ] #T0001 Fix the parser\n\n## Work\n- [ ] #T0001 Fix the parser\n- [ ] #T0002 other'
  const { files } = await run($, on, text)
  expect(files[T]).toBe(text)
})

/** Property: a checkbox line holding U+2028 is an item: numbering gives it an ID. */
test('a checkbox line holding U+2028 is numbered as an item', async ($, on) => {
  const ls = String.fromCharCode(0x2028)
  const { files } = await run($, on, `- [ ] #T0001 a\n- [ ] Fix${ls}the parser`)
  expect(files[T]).toMatch(new RegExp(`\\n- \\[ \\] #T\\w+ Fix${ls}the parser$`))
})

/** Property: the used-up toast names the checkbox line that holds the end ID, never a prose line before it. */
test('the used-up toast names the checkbox line with the ID, not a prose line that names it first', async ($, on) => {
  // The prompt hook goes in before the first engine call.
  const clock = mock.clock(on)
  const fake = k1Disk(on, { [T]: '- [ ] #T0001 a\nThe highest form is #T1ZZZZ.\n- [ ] #T1ZZZZ last example' }, { cwd: '/repo', listed: ['.claude_todo/TODO.md'], dirs: ['/repo/.git'] })
  const prompt = promptOf(on)
  await open($)
  await settle(clock, 8)
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.line()).toBeUndefined()
  const told = fake.toasts.filter(one => one.includes('used up'))
  expect(told.length).toBe(1)
  expect(told[0]).toContain('the line \\"- [ ] #T1ZZZZ last example\\"')
  expect(told[0]).not.toContain('highest form')
})

/**
 * Property: a session whose git fails takes the common dir from the git dir's `commondir` file, as git does,
 * so it claims in the folder git sessions claim in, whatever a path segment is called. The s6 and s7.
 */
test('git fails in a checkout whose separate git dir is under a folder named worktrees: the claim is in that git dir', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/wproj/.claude_todo/TODO.md': '- [ ] #T0001 a', '/wproj/.git': 'gitdir: /store/worktrees/proj.git\n' }
  const fake = k1Disk(on, files, { cwd: '/wproj', gitFails: true, dirs: ['/store/worktrees/proj.git'] })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  // The old cut at `/worktrees/` claimed in `/store/claudeopticon/id-claims`, outside the repo, where no git session lists.
  expect(claimMkdirs(fake.calls)).toEqual(['mkdir -- /store/worktrees/proj.git/claudeopticon/id-claims/0'])
  expect(fake.calls.filter(one => one.includes('/store/claudeopticon'))).toEqual([])
  expect(offered(prompt.line()).length).toBe(3)
})

test('git fails in a nested submodule of a submodule named worktrees: the claim is in its own git dir', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/super/worktrees/inner/.claude_todo/TODO.md': '- [ ] #T0001 a', '/super/worktrees/inner/.git': 'gitdir: ../../.git/modules/worktrees/modules/inner\n' }
  const fake = k1Disk(on, files, { cwd: '/super/worktrees/inner', gitFails: true, dirs: ['/super/.git/modules/worktrees/modules/inner'] })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(claimMkdirs(fake.calls)).toEqual(['mkdir -- /super/.git/modules/worktrees/modules/inner/claudeopticon/id-claims/0'])
  expect(offered(prompt.line()).length).toBe(3)
})

test('git fails in a linked worktree: commondir names the common dir, as before', async ($, on) => {
  mock.clock(on)
  // The excluded population: a real linked worktree, whose git dir holds `commondir` (`../..`).
  const files: Record<string, string> = { '/wt/.claude_todo/TODO.md': '- [ ] #T0001 a', '/wt/.git': 'gitdir: /main/.git/worktrees/wt\n', '/main/.git/worktrees/wt/commondir': '../..\n' }
  const fake = k1Disk(on, files, { cwd: '/wt', gitFails: true, dirs: ['/main/.git'] })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(claimMkdirs(fake.calls)).toEqual(['mkdir -- /main/.git/claudeopticon/id-claims/0'])
  expect(offered(prompt.line()).length).toBe(3)
})
