// Engine cases through the fake engine: a session that moves to another folder after it started.
// One responsibility, the end-to-end cases of following the session folder.

import { expect, mock, test } from 'claude-code/testing'

{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Test = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

const open = async ($: Test) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

const segs = (path: string) => path.split('/').filter(part => part !== '')
/** A path made absolute against `base`, with `.` and `..` folded. */
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

  return `/${out.join('/')}`
}

/** One repo of the fake disk: its root and the todo files git lists, relative to the root. */
type Repo = { root: string; listed: string[] }

/**
 * A fake disk and git whose session folder (`where.cwd`) the test can change, with the session's project
 * root (`where.root`), which follows `where.cwd` unless a test sets it apart (a shell `cd`,). The test engine hands a
 * relative path over made absolute against its own folder; the fake reads such a path back as relative
 * and resolves it against the session folder of the moment. Git answers for the repo that holds the
 * session folder, and as outside a repo when none does.
 */
function movingDisk(on: On, files: Record<string, string>, repos: Repo[], where: { cwd: string; root?: string }) {
  const own = new Set([...Object.keys(files), ...repos.map(repo => repo.root), where.cwd, '/home/a', '/loose'].map(path => segs(path)[0] ?? ''))
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

    return resolveIn(where.cwd, [...Array.from({ length: h.length - k }, () => '..'), ...parts.slice(k)].join('/') || '.')
  }
  const repoOf = (path: string) => repos.find(repo => path === repo.root || path.startsWith(`${repo.root}/`))
  const exists = (path: string) => path in files || Object.keys(files).some(key => key.startsWith(`${path}/`)) || repos.some(repo => path === `${repo.root}/.git`) || path === where.cwd
  const named = (dir: string) => [...new Set(Object.keys(files).filter(key => key.startsWith(`${dir}/`) && !key.slice(dir.length + 1).includes('/')).map(key => key.slice(dir.length + 1)))]
  on('process.run', (_$, e) => {
    const { argv, cwd } = e as unknown as { argv: string[]; cwd?: string }
    // Git runs where the call names, else in the session folder of the moment.
    const dir = cwd ?? where.cwd
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : out('', 1)
    }
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }
    if (argv[0] === 'git') {
      const repo = repoOf(dir)
      if (repo === undefined) {
        return out('', 128)
      }
      if (argv[1] === 'rev-parse') {
        const prefix = dir === repo.root ? '' : `${dir.slice(repo.root.length + 1)}/`
        const depth = segs(prefix).length

        return out(depth === 0 ? `${repo.root}\n.git\n.git\n\n` : `${repo.root}\n${repo.root}/.git\n${'../'.repeat(depth)}.git\n${prefix}\n`)
      }
      if (argv[1] === 'worktree') {
        return out(`worktree ${repo.root}\nHEAD a\nbranch refs/heads/main\n`)
      }
      if (argv[1] === 'ls-files') {
        return out(argv.includes('--directory') ? '' : repo.listed.join('\0'))
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
    if (!exists(path)) {
      throw new Error('ENOENT')
    }

    return { value: { kind: path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: path } } as never
  })
  on('fs.list', (_$, e) => ({ value: named(map(e.path)).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2, isLink: false })) }))
  on('fs.read', (_$, e) => {
    const path = map(e.path)
    if (!exists(path)) {
      throw new Error('ENOENT')
    }

    return { value: files[path] ?? '' }
  })
  on('fs.write', (_$, e) => {
    files[map(e.path)] = e.text as string

    return { value: undefined } as never
  })
  on('session.root', () => ({ value: where.root ?? where.cwd }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.list', () => ({ value: [] }))
  mock.store(on)
}

function promptOf(on: On): { ctx: () => string } {
  let ctx: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    ctx = e.context ?? []

    return { text: e.text, context: e.context }
  })

  return { ctx: () => ctx.join('\n') }
}

// The session starts in a spare folder inside one repo (`/a/home`, as `~/.claude`), then moves.
const START = '/a/home/spares/s1'
const HOME_REPO: Repo = { root: '/a/home', listed: ['mods/x/.claude_todo/TODO.md'] }
const APP_REPO: Repo = { root: '/w/app', listed: ['.claude_todo/TODO.md'] }
const startFiles = (): Record<string, string> => ({
  '/a/home/mods/x/.claude_todo/TODO.md': '- [ ] #T0050 mod ticket',
  '/w/app/.claude_todo/TODO.md': '- [ ] #T0003 app ticket',
  '/loose/.claude_todo/TODO.md': '- [ ] #T0007 loose ticket',
})

test('a session moved to another repo shows only that repo\'s folders and counts only its IDs', async ($, on) => {
  const clock = mock.clock(on)
  const where = { cwd: START }
  const files = startFiles()
  movingDisk(on, files, [HOME_REPO, APP_REPO], where)
  const prompt = promptOf(on)
  const ui = await open($)
  await clock.advance(15000)
  expect(JSON.stringify(await ui.findAll({}))).toContain('mod ticket')
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0051')

  where.cwd = '/w/app'
  await $.prompt.submit({ text: 'moved' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0004, #T0005, #T0006')
  await clock.advance(15000)
  const board = JSON.stringify(await ui.findAll({}))
  expect(board).toContain('app ticket')
  expect(board).not.toContain('mod ticket')
  // Nothing of the old repo was written on the way.
  expect(files['/a/home/mods/x/.claude_todo/TODO.md']).toBe('- [ ] #T0050 mod ticket')
})

test('a session that leaves a repo drops its folders and counts only the folder it is in', async ($, on) => {
  const clock = mock.clock(on)
  const where = { cwd: START }
  const files = startFiles()
  movingDisk(on, files, [HOME_REPO, APP_REPO], where)
  const prompt = promptOf(on)
  const ui = await open($)
  await clock.advance(15000)
  expect(JSON.stringify(await ui.findAll({}))).toContain('mod ticket')

  where.cwd = '/loose'
  await $.prompt.submit({ text: 'moved' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0008, #T0009, #T000A')
  await clock.advance(15000)
  const board = JSON.stringify(await ui.findAll({}))
  expect(board).toContain('loose ticket')
  expect(board).not.toContain('mod ticket')
})

test('a shell cd to a folder outside the repo leaves the board and the IDs on the session\'s repo', async ($, on) => {
  const clock = mock.clock(on)
  const where: { cwd: string; root?: string } = { cwd: '/w/app' }
  const files = startFiles()
  movingDisk(on, files, [HOME_REPO, APP_REPO], where)
  const prompt = promptOf(on)
  const ui = await open($)
  await clock.advance(15000)
  expect(JSON.stringify(await ui.findAll({}))).toContain('app ticket')

  // Claude runs `cd /loose` in the shell: `.` moves, the project root stays.
  where.root = '/w/app'
  where.cwd = '/loose'
  await $.prompt.submit({ text: 'after a cd' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0004')
  await clock.advance(15000)
  const board = JSON.stringify(await ui.findAll({}))
  expect(board).toContain('app ticket')
  expect(board).not.toContain('loose ticket')
  expect(board).not.toContain('No checkbox items')

  // A Consolidate-style search again while the shell is still away finds the repo's folder, not the shell's.
  await $.prompt.submit({ text: 'still away' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0004')
})
}
