// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { nextTicketIds } from '../hooks/ticket-ids'

// Hook cases on a fake repo with a HOME and a git layout per case: the global folder, symlinks, archive opening, git roots, the folder cut and trash reasons.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Test = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

const open = async ($: Test) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

/**
 * A fake repo at `root` with `files` by absolute path (copied from work.test.tsx, cut to what these
 * tests need). `home`: what `printenv HOME` gives (null: the command fails; 'throw': it cannot start);
 * `config`: CLAUDE_CONFIG_DIR. `links` maps a path to the real path its stat gives. `rev` and
 * `worktrees` are what git answers. `exits` sets the exit code of a command by name; `missing` lists
 * commands that cannot start; `trashFile` says whether /usr/bin/trash exists.
 */
function repoWith(on: On, files: Record<string, string>, opts: { listed: string[]; root?: string; rev?: string; worktrees?: string; home?: string | null; config?: string; links?: Record<string, string>; uname?: string; exits?: Record<string, number>; missing?: string[]; trashFile?: boolean; dangling?: string[]; toasts?: string[]; isOldGit?: boolean }) {
  const R = opts.root ?? '/repo'
  const writes: string[] = []
  const calls: string[] = []
  let stamp = 0
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (opts.missing?.includes(argv[0]!)) {
      throw new Error(`spawn ${argv[0]} ENOENT`)
    }
    if (opts.exits?.[argv[0]!] !== undefined) {
      return out('', opts.exits[argv[0]!])
    }
    if (argv[0] === 'printenv') {
      if (argv[1] === 'HOME') {
        if (opts.home === 'throw') {
          throw new Error('spawn printenv ENOENT')
        }

        return opts.home === null ? out('', 1) : out(`${opts.home ?? '/home/a'}\n`)
      }

      return opts.config === undefined ? out('', 1) : out(`${opts.config}\n`)
    }
    if (argv[0] === 'uname') {
      return out(`${opts.uname ?? 'Darwin'}\n`)
    }
    if (['/usr/bin/trash', 'osascript', 'gio', 'trash-put', 'kioclient5'].includes(argv[0]!)) {
      return out('', 1)
    }
    if (['open', 'xdg-open'].includes(argv[0]!)) {
      return out('')
    }
    if (argv[1] === 'worktree') {
      return out(opts.worktrees ?? '')
    }
    if (argv[1] === 'rev-parse') {
      // Git before 2.31 (`isOldGit`) does not know --path-format and prints the argument back.
      if (argv.includes('--path-format=absolute')) {
        return opts.isOldGit === true ? out('--path-format=absolute\n') : out(opts.rev ?? `${R}\n${R}/.git\n`)
      }

      return out(opts.rev ?? `${R}\n.git\n.git\n`)
    }

    return out(argv.includes('--directory') ? '' : opts.listed.join('\0'))
  })
  // The engine hands the session folder's own `.claude_todo` over made absolute, outside the fake repo: it is the repo root one. A home folder's is not there.
  const isRel = (path: string) => !inside(path) && path.endsWith('.claude_todo') && !path.endsWith('/.claude/.claude_todo')
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.git') || (isRel(e.path) && e.path.endsWith('.claude_todo')) || (e.path === '/usr/bin/trash' && opts.trashFile === true) || (inside(e.path) && (e.path in files || Object.keys(files).some(path => path.startsWith(`${e.path}/`)))) }))
  // UCR-150 (batch K1): the engine hands `.` over as its own folder, outside the fake repo; that session folder is the repo root.
  const isSession = (path: string) => !inside(path) && !path.includes('.claude_todo') && !path.includes('.git') && !path.startsWith('/home/a') && !path.startsWith('/usr/')
  on('fs.stat', (_$, e) => {
    if (isSession(e.path) && opts.links?.[e.path] === undefined) {
      return { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: R } } as never
    }
    if (!isRel(e.path) && !inside(e.path) && opts.links?.[e.path] === undefined) {
      throw new Error('ENOENT')
    }

    return { value: { kind: e.path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.links?.[e.path] ?? (isRel(e.path) ? `${R}/.claude_todo` : e.path) } } as never
  })
  on('fs.list', (_$, e) => ({ value: [...(inside(e.path) ? names(e.path) : isRel(e.path) ? names(`${R}/.claude_todo`) : []), ...(opts.dangling ?? []).filter(path => path.slice(0, path.lastIndexOf('/')) === e.path).map(path => path.slice(path.lastIndexOf('/') + 1))].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2 + stamp, isLink: false })) }))
  on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', (_$, e) => {
    writes.push(e.path)
    files[e.path] = e.text as string
    stamp += 1

    return { value: undefined } as never
  })
  on('ui.toast', (_$, e) => {
    opts.toasts?.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { writes, calls }
}

const BOOK = '/repo/.claude_todo/categories.json'
const TODO = '/repo/.claude_todo/TODO.md'
const OPEN = '- [ ] #T1 pay vendor\n- [ ] #T2 sign lease'
const THREE = ['todo-consolidate', 'todo-delete-empty', 'todo-delete-dup-tickets']

// ---------------------------------------------------------------- UCR-023
// Property: a todo folder that is the global one (HOME/.claude/.claude_todo or
// CLAUDE_CONFIG_DIR/.claude_todo) is never read as a project and never written, wherever HOME is.

const GLOBAL_STATES: [string, { root: string; home?: string; config?: string }][] = [
  ['HOME under /var/home', { root: '/var/home/u/.claude', home: '/var/home/u' }],
  ['HOME /var/root (not /root)', { root: '/var/root/.claude', home: '/var/root' }],
  ['HOME nested deep, outside every usual prefix', { root: '/export/home/dept/u/.claude', home: '/export/home/dept/u' }],
  ['CLAUDE_CONFIG_DIR as the folder that holds .claude_todo', { root: '/opt/cfg', home: '/home/other', config: '/opt/cfg' }],
]
for (const [name, state] of GLOBAL_STATES) {
  test(`UCR-023 ${name}: the global folder is not written and the three buttons are off`, async ($, on) => {
    const clock = mock.clock(on)
    const folder = `${state.root}/.claude_todo`
    const files: Record<string, string> = { [`${folder}/TODO.md`]: '- [x] #T1 Done parser\n- [ ] no id yet', [`${state.root}/mods/x/.claude_todo/T.md`]: '- [ ] #T9 other' }
    const { writes } = repoWith(on, files, { root: state.root, home: state.home, ...(state.config === undefined ? {} : { config: state.config }), listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/T.md'] })
    const ui = await open($)
    await clock.advance(15000)
    expect(writes.filter(path => path.startsWith(folder))).toEqual([])
    expect(files[`${folder}/TODO.md`]).toBe('- [x] #T1 Done parser\n- [ ] no id yet')
    for (const key of THREE) {
      expect(await ui.find({ key })).toBeUndefined()
    }
  })
}

const NO_HOME: [string, string | null][] = [
  ['printenv exits 1', null],
  ['printenv cannot start', 'throw'],
  ['HOME is not an absolute path', 'home/a'],
]
for (const [name, home] of NO_HOME) {
  test(`UCR-023 fail closed, ${name}: nothing is written, the buttons are off, one toast`, async ($, on) => {
    const clock = mock.clock(on)
    const toasts: string[] = []
    const files: Record<string, string> = { [TODO]: '- [x] #T1 Done parser\n- [ ] no id yet', '/repo/mods/x/.claude_todo/T.md': '- [ ] #T9 other' }
    const before = { ...files }
    const { writes } = repoWith(on, files, { home, toasts, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/T.md'] })
    const ui = await open($)
    await clock.advance(15000)
    expect(writes).toEqual([])
    expect(files).toEqual(before)
    for (const key of THREE) {
      expect(await ui.find({ key })).toBeUndefined()
    }
    expect(toasts.filter(text => text.includes('HOME')).length).toBe(1)
  })
}

// ---------------------------------------------------------------- UCR-034
// Property: categories.json is read and written only when its folder is trusted and the file is
// not there or is a plain file; a symlink at that name is never followed.

const BOOK_STATES: [string, { links?: Record<string, string>; dangling?: string[] }][] = [
  ['the book is a symlink to another file', { links: { [BOOK]: '/home/a/.zshrc' } }],
  ['the book is a symlink to a file inside the repo', { links: { [BOOK]: '/repo/other.json' } }],
  ['the book is a dangling symlink', { dangling: [BOOK] }],
  // The case of a symlinked book folder is in batch G1's block (UCR-086): this fake read no items through it, so it passed with no check.
]
for (const [name, state] of BOOK_STATES) {
  test(`UCR-034 ${name}: the sorter calls no model and writes nothing`, async ($, on) => {
    mock.clock(on)
    let calls = 0
    on('model.complete', () => {
      calls += 1

      return { value: { isAnswered: true, text: '{"categories": ["Billing"], "assign": {"1": "Billing"}}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    const files: Record<string, string> = { [TODO]: OPEN, ...(state.dangling === undefined ? { [BOOK]: '{"categories":[],"items":{}}' } : {}) }
    const { writes } = repoWith(on, files, { ...state, listed: ['.claude_todo/TODO.md'] })
    await open($)
    for (let i = 0; i < 20; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(calls).toBe(0)
    expect(writes.filter(path => path.endsWith('categories.json'))).toEqual([])
  })
}

test('UCR-034 Recategorize does not write a book that became a symlink', async ($, on) => {
  mock.clock(on)
  // The first sort puts both tickets in X; Recategorize then wants A and B: a real change.
  let asked = 0
  on('model.complete', () => {
    asked += 1
    const reply = asked === 1 ? { categories: ['X'], assign: { 1: 'X', 2: 'X' } } : { categories: ['A', 'B'], assign: { 1: 'A', 2: 'B' } }

    return { value: { isAnswered: true, text: JSON.stringify(reply), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  const files: Record<string, string> = { [TODO]: OPEN }
  const links: Record<string, string> = {}
  const { writes } = repoWith(on, files, { links, listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  for (let i = 0; i < 20; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  // The book becomes a symlink after it was first read as a plain file (and the first sort wrote it).
  const before = writes.length
  links[BOOK] = '/home/a/.zshrc'
  await ui.press({ key: 'todo-recategorize' })
  expect(writes.slice(before)).toEqual([])
})

// ---------------------------------------------------------------- UCR-035 and UCR-042
// Property: Show completed opens only a plain .md file in a trusted folder; a missing file is made
// only by the press, under the write lock, never at a scan.

const ARCHIVE = '/repo/.claude_todo/archive/TODO.md'
const OPENERS = (calls: string[]) => calls.filter(call => call.startsWith('open ') || call.startsWith('xdg-open '))

const ARCHIVE_STATES: [string, { links: Record<string, string>; swap?: boolean }][] = [
  ['the archive file is a symlink to a script', { links: { [ARCHIVE]: '/home/a/run.command' } }],
  ['the archive file is a symlink to another .md file', { links: { [ARCHIVE]: '/home/a/other.md' } }],
  ['the archive folder is a symlink', { links: { '/repo/.claude_todo/archive': '/home/a/elsewhere' } }],
  ['the file is swapped for a symlink after the button was drawn', { links: {}, swap: true }],
]
for (const [name, state] of ARCHIVE_STATES) {
  test(`UCR-035 ${name}: nothing is opened`, async ($, on) => {
    mock.clock(on)
    const toasts: string[] = []
    const files: Record<string, string> = { [TODO]: '- [ ] #T1 open', [ARCHIVE]: '- [x] #T0 old' }
    const { calls } = repoWith(on, files, { links: state.links, toasts, listed: ['.claude_todo/TODO.md'] })
    const ui = await open($)
    if (state.swap === true) {
      state.links[ARCHIVE] = '/home/a/run.command'
    }
    if ((await ui.find({ key: 'todo-show-completed' })) !== undefined) {
      await ui.press({ key: 'todo-show-completed' })
      expect(toasts.join('\n')).toContain('Not opened')
    }
    expect(OPENERS(calls)).toEqual([])
  })
}

test('UCR-035 a plain archive file still opens', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [ ] #T1 open', [ARCHIVE]: '- [x] #T0 old' }
  const { calls } = repoWith(on, files, { listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  await ui.press({ key: 'todo-show-completed' })
  expect(OPENERS(calls)).toEqual([`open ${ARCHIVE}`])
})

test('UCR-042 no archive file is made at a scan, and a move that lands first is never overwritten by the press', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [ ] #T1 open' }
  const { calls, writes } = repoWith(on, files, { listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  await clock.advance(10000)
  expect(files[ARCHIVE]).toBeUndefined()
  expect(writes).toEqual([])
  // An archive move lands before the press.
  files[ARCHIVE] = '- [x] #T7 moved just now\n'
  await ui.press({ key: 'todo-show-completed' })
  expect(files[ARCHIVE]).toBe('- [x] #T7 moved just now\n')
  expect(writes).toEqual([])
  expect(OPENERS(calls)).toEqual([`open ${ARCHIVE}`])
})

test('UCR-042 the press makes a missing archive file, empty, once', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [ ] #T1 open' }
  const { writes } = repoWith(on, files, { listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  await ui.press({ key: 'todo-show-completed' })
  await ui.press({ key: 'todo-show-completed' })
  expect(files[ARCHIVE]).toBe('')
  expect(writes).toEqual([ARCHIVE])
})

// ---------------------------------------------------------------- UCR-036
// Property: the Mark buttons and move_ticket write a todo file only when its folder is trusted and
// the file is a plain file.

const MARK_STATES: [string, Record<string, string>][] = [
  ['the todo file is a symlink', { [TODO]: '/home/a/.zshrc' }],
  ['the todo file is a symlink to another file of the repo', { [TODO]: '/repo/other.md' }],
  ['the todo folder is a symlink', { '/repo/.claude_todo': '/home/a/elsewhere' }],
]
for (const [name, links] of MARK_STATES) {
  test(`UCR-036 ${name}: a Mark button writes nothing and says why`, async ($, on) => {
    mock.clock(on)
    const toasts: string[] = []
    const linked: Record<string, string> = {}
    const files: Record<string, string> = { [TODO]: '- [ ] #T1 Review the copy' }
    const { writes } = repoWith(on, files, { links: linked, toasts, listed: ['.claude_todo/TODO.md'] })
    const ui = await open($)
    Object.assign(linked, links)
    await ui.press({ key: 'ticket-start-TODO.md-#t1' })
    expect(writes).toEqual([])
    expect(files[TODO]).toBe('- [ ] #T1 Review the copy')
    expect(toasts.join('\n')).toContain('not safe to write')
  })
}

test('UCR-036 move_ticket refuses a todo file that is a symlink, even with the yes of the user', async ($, on) => {
  mock.clock(on)
  const linked: Record<string, string> = {}
  const files: Record<string, string> = { [TODO]: '- [x] #T1 Review the terms' }
  const { writes } = repoWith(on, files, { links: linked, listed: ['.claude_todo/TODO.md'] })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question

    return { result: { questions: [], answers: { [question]: 'Move it' } } } as never
  })
  await open($)
  linked[TODO] = '/home/a/.zshrc'
  const answer = JSON.stringify(await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'in_progress', reason: 'x' } as never))
  expect(answer).toContain('not safe to change')
  expect(writes).toEqual([])
})

// ---------------------------------------------------------------- UCR-057 and UCR-058
// Property: a linked worktree is told by its git dir differing from the common dir, whatever the
// shape of the common dir, with git of any age; its main checkout is the first worktree listed.

const LIST = 'worktree /main\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt\nHEAD def\n'

test('UCR-057 the buttons are off in a linked worktree of a separate-git-dir repo', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/main/.claude_todo/TODO.md': '- [ ] #T1 one\n- [ ] #T2 two', '/main/mods/x/.claude_todo/T.md': '- [ ] #T3 x', '/main/mods/y/.claude_todo/E.md': '' }
  repoWith(on, files, { root: '/main', rev: '/wt\n/sep/main.git/worktrees/wt\n/sep/main.git\n', worktrees: LIST, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/T.md', 'mods/y/.claude_todo/E.md'] })
  const ui = await open($)
  for (const key of THREE) {
    expect(await ui.find({ key })).toBeUndefined()
  }
})

const OLD_GIT: [string, string][] = [
  ['absolute dirs', '/repo\n/repo/.git\n/repo/.git\n'],
  ['relative dirs at the top folder', '/repo\n.git\n.git\n'],
  ['a dot-slash dir', '/repo\n./.git\n.git\n'],
]
for (const [name, rev] of OLD_GIT) {
  test(`UCR-058 git before 2.31 (no --path-format), ${name}: the folders and the buttons work`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 one', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 two' }
    const { calls } = repoWith(on, files, { rev, isOldGit: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
    const ui = await open($)
    expect(calls.some(call => call.includes('--path-format'))).toBe(false)
    expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
  })
}

// ---------------------------------------------------------------- UCR-059
// Property: folders cut from the pane are announced once, and their ticket IDs still count.

const CUT_FOLDERS = Array.from({ length: 22 }, (_, i) => `d${String(i).padStart(2, '0')}/.claude_todo`)

const CUT_STATES: [string, string][] = [
  ['the last cut folder', '/repo/d21/.claude_todo/TODO.md'],
  ['the first cut folder (the limit of the cut)', '/repo/d19/.claude_todo/TODO.md'],
  ['an archive file of a cut folder', '/repo/d20/.claude_todo/archive/OLD.md'],
]
for (const [name, where] of CUT_STATES) {
  test(`UCR-059 an ID in ${name} is never given again, and the cut is toasted once`, async ($, on) => {
    const clock = mock.clock(on)
    const toasts: string[] = []
    const files: Record<string, string> = { [TODO]: '- [ ] no id yet' }
    for (const rel of CUT_FOLDERS) {
      files[`/repo/${rel}/TODO.md`] = '- [ ] #T0001 filler'
    }
    files[where] = '- [x] #T0050 high'
    repoWith(on, files, { toasts, listed: ['.claude_todo/TODO.md', ...CUT_FOLDERS.map(rel => `${rel}/TODO.md`)] })
    await open($)
    await clock.advance(7000)
    const fresh = nextTicketIds(['t0050'], 1)[0]!
    expect(files[TODO]).toContain(`#${fresh} no id yet`)
    expect(toasts.filter(text => text.includes('todo folders') && text.includes('not shown')).length).toBe(1)
  })
}

// ---------------------------------------------------------------- UCR-062
// Property: a folder is trusted when its real path equals its path up to Unicode normalization.

const NFC = 'caf\u00e9'
const NFD = 'cafe\u0301'
const NFD_STATES: [string, string, string][] = [
  ['NFC path, NFD real path', `/repo/${NFC}/.claude_todo`, `/repo/${NFD}/.claude_todo`],
  ['NFD path, NFC real path', `/repo/${NFD}/.claude_todo`, `/repo/${NFC}/.claude_todo`],
  ['the accent in a middle folder of the path', `/repo/a/${NFC}/b/.claude_todo`, `/repo/a/${NFD}/b/.claude_todo`],
]
for (const [name, path, real] of NFD_STATES) {
  test(`UCR-062 ${name}: the folder is trusted, so its unnumbered ticket is numbered`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [TODO]: '- [ ] #T0001 root', [`${path}/TODO.md`]: '- [ ] no id yet' }
    const rel = path.slice('/repo/'.length)
    repoWith(on, files, { links: { [path]: real }, listed: ['.claude_todo/TODO.md', `${rel}/TODO.md`] })
    await open($)
    await clock.advance(7000)
    expect(files[`${path}/TODO.md`]).not.toBe('- [ ] no id yet')
    expect(files[`${path}/TODO.md`]).toContain('no id yet')
  })
}

// ---------------------------------------------------------------- UCR-022
// Property: the trash failure toast says, per command, whether it was not found or exited with a
// code; with no uname answer, macOS commands come first only when /usr/bin/trash exists.

async function trashToast($: Test, on: On, opts: { uname?: string; exits?: Record<string, number>; missing?: string[]; trashFile?: boolean }) {
  mock.clock(on)
  const toasts: string[] = []
  const files: Record<string, string> = { [TODO]: '- [ ] one', '/repo/mods/x/.claude_todo/OLD.md': '' }
  const { calls } = repoWith(on, files, { ...opts, toasts, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/OLD.md'] })
  const ui = await open($)
  await ui.press({ key: 'todo-delete-empty' })

  return { toasts: toasts.join('\n'), calls }
}

test('UCR-022 a trash command that exits with a code is named with that code', async ($, on) => {
  const { toasts } = await trashToast($, on, { uname: 'Linux', exits: { gio: 2, 'trash-put': 5, kioclient5: 127 } })
  expect(toasts).toContain('gio: exited 2; trash-put: exited 5; kioclient5: not found')
  expect(toasts).not.toContain('install gio')
})

test('UCR-022 a trash command that cannot start, or exits 127, is not found', async ($, on) => {
  const { toasts } = await trashToast($, on, { uname: 'Linux', missing: ['gio', 'trash-put'], exits: { kioclient5: 127 } })
  expect(toasts).toContain('gio: not found; trash-put: not found; kioclient5: not found; install gio or trash-cli')
})

test('UCR-022 on macOS the reason is the commands that ran, not a fixed sentence', async ($, on) => {
  const { toasts } = await trashToast($, on, { uname: 'Darwin', exits: { '/usr/bin/trash': 1 }, missing: ['osascript'] })
  expect(toasts).toContain('/usr/bin/trash: exited 1; osascript: not found')
})

// H3 (UCR-022): changed on purpose. It asserted that a lone /usr/bin/trash means macOS, but trash-cli
// installs that file on Linux. Now the Linux commands run and the file is no sign.
test('UCR-022 with no uname answer and only /usr/bin/trash present, the Linux commands run and the macOS ones do not', async ($, on) => {
  const { calls } = await trashToast($, on, { uname: '', trashFile: true })
  expect(calls.some(call => call.startsWith('/usr/bin/trash '))).toBe(false)
  expect(calls.some(call => call.startsWith('gio'))).toBe(true)
})

test('UCR-022 with no uname answer and no /usr/bin/trash, the toast says the platform is unknown', async ($, on) => {
  const { toasts } = await trashToast($, on, { uname: '', trashFile: false })
  expect(toasts).toContain('platform unknown')
  expect(toasts).not.toContain('osascript')
})
}
