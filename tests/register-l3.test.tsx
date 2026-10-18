import { expect, mock, test } from 'claude-code/testing'
import { addToArchive, closedBlocks, hasBlock, removeBlocks } from '../hooks/archive-blocks'
import { parseTodo } from '../hooks/todo-markdown'
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

const fromPs = (script: string) => String.fromCodePoint(...(/\[char\[\]\]\(([\d,]+)\)/.exec(script)![1]!.split(',').map(Number))).replace(/\\/g, '/')

// Engine tests of batch L3 (UCR run 2026-10-17-1, loop 3): the fakes below are this file's own, from the
// reviewer's probe head (scratchpad l3-r3/probes/head.tsx), with the shared store returned for a second session.

/**
 * A fake repo (at `/repo` unless `root` says) with the given files by absolute path; `hasNearest` says
 * whether the session folder has its own `.claude_todo`; `rev` is what `git rev-parse` answers;
 * `links` maps a path to the real path the fake stat gives it (a symlink). `uname` is what `uname -s`
 * answers; a trash command named in `failing` exits 1, and one named in `stays` exits 0 but leaves the
 * file. Any other trash command removes the file from `files`, as the real one would. `hang` makes a
 * command never return (or throw); `lsExit` gives a git ls-files an exit code.
 */
const mtimes: Record<string, number> = {}
function repoWith(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string>; uname?: string; failing?: string[]; stays?: string[]; exits?: Record<string, number>; log?: string[]; dangling?: string[]; hold?: Promise<void>; fault?: (path: string, text: string) => void; readHook?: (path: string) => Promise<void> | void; listHook?: (path: string) => Promise<void> | void; store?: false; hang?: (argv: string[]) => boolean; lsExit?: (argv: string[]) => number | undefined }) {
  const R = opts.root ?? '/repo'
  const state = { hasNearest: opts.hasNearest, listed: opts.listed }
  const writes: string[] = []
  const calls: string[] = []
  // The store every session shares (the archive record lives here): a second session's half of a test reads and writes it.
  const kept = new Map<string, unknown>()
  // The archive move needs a store that works (UCR-031: no record, no move); a test with a store of its own passes `store: false`.
  if (opts.store !== false) {
    on('store.get', (_$, e) => ({ value: kept.get(e.key) }) as never)
    on('store.set', (_$, e) => {
      kept.set(e.key, e.value)

      return { value: undefined } as never
    })
  }
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv.join(' '))
    if (opts.hang?.(argv) === true) {
      return new Promise(() => undefined) as never
    }
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never

    const fail = { value: { exitCode: 1, stdout: '', stderr: 'failed' } } as never
    const dirEmpty = (dir: string) => !Object.keys(files).some(path => path.startsWith(`${dir}/`))

    // The mod reads HOME to know the global todo folder; CLAUDE_CONFIG_DIR is unset.
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'uname') {
      return out(`${opts.uname ?? 'Darwin'}\n`)
    }
    if (['/usr/bin/trash', 'osascript', 'gio', 'trash-put', 'kioclient5', 'powershell.exe'].includes(argv[0]!)) {
      const script = argv[argv.length - 1]!
      if (argv[0] === 'powershell.exe' && script.startsWith('[System.IO.Directory]::Delete(')) {
        return dirEmpty(fromPs(script)) ? out('') : fail
      }
      if (opts.failing?.includes(argv[0]!)) {
        return fail
      }
      const path =
        argv[0] === 'osascript' ? /POSIX file "(.*)"$/.exec(script)![1]!.replace(/\\(.)/g, '$1')
        : argv[0] === 'powershell.exe' ? fromPs(script)
        : argv[0] === 'kioclient5' ? argv[2]!
        : argv[argv.length - 1]!
      if (!opts.stays?.includes(argv[0]!)) {
        delete files[path]
      }

      return out('')
    }
    if (['open', 'xdg-open', 'explorer.exe'].includes(argv[0]!)) {
      return opts.failing?.includes(argv[0]!) ? fail : ({ value: { exitCode: opts.exits?.[argv[0]!] ?? 0, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'rm') {
      delete files[argv[2]!]

      return out('')
    }
    if (argv[0] === 'rmdir') {
      return dirEmpty(argv[2]!) ? out('') : fail
    }

    // A git ls-files that exits with the code `lsExit` gives (UCR-228).
    const lsCode = argv.includes('ls-files') ? opts.lsExit?.(argv) : undefined
    if (lsCode !== undefined) {
      return { value: { exitCode: lsCode, stdout: '', stderr: 'fatal: bad index' } } as never
    }

    return argv[1] === 'rev-parse' ? out(opts.rev ?? `${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : state.listed.join('\0'))
  })
  // The engine may hand the session folder's own paths over made absolute: match by their ends.
  // It does the same to a Windows path (`C:/repo`), which `abs` hands back whole.
  const abs = (path: string) => /[A-Za-z]:\/.*$/.exec(path)?.[0] ?? path
  on('fs.exists', (_$, e) => ({ value: abs(e.path).endsWith('.git') || (abs(e.path).endsWith('.claude_todo') && !inside(abs(e.path)) && state.hasNearest) || (inside(abs(e.path)) && (abs(e.path) in files || Object.keys(files).some(path => path.startsWith(`${abs(e.path)}/`)))) }))
  on('fs.stat', (_$, e) => {
    // The home folder is outside the fake repo and does not exist there.
    if (abs(e.path).startsWith('/home/a/.claude') && !inside(abs(e.path))) {
      throw new Error('ENOENT')
    }

    return (opts.log?.push(`stat:${abs(e.path)}`), { value: { kind: abs(e.path) in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.links?.[abs(e.path)] ?? (inside(abs(e.path)) ? abs(e.path) : !abs(e.path).includes('.claude_todo') && !abs(e.path).includes('.git') ? R : `${R}/.claude_todo`) } }) as never
  })
  on('fs.list', async (_$, e) => {
    const result = { value: [...(inside(abs(e.path)) ? names(abs(e.path)) : state.hasNearest ? names(`${R}/.claude_todo`) : []), ...(opts.dangling ?? []).filter(path => path.slice(0, path.lastIndexOf('/')) === abs(e.path)).map(path => path.slice(path.lastIndexOf('/') + 1))].map(name => ({ name, kind: 'file', size: 1, mtimeMs: mtimes[`${abs(e.path)}/${name}`] ?? 2, isLink: false })) }
    await opts.listHook?.(abs(e.path))
    return result
  })
  on('fs.read', async (_$, e) => {
    opts.log?.push(`read:${abs(e.path)}`)
    const value = files[inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`] ?? ''
    await opts.readHook?.(abs(e.path))
    return { value }
  })
  on('fs.write', async (_$, e) => {
    const path = inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`
    opts.fault?.(path, e.text as string)
    opts.log?.push(`write:${path}`)
    // A held write: the test presses a button while this write is in flight.
    if (opts.hold !== undefined && e.text !== '') {
      await opts.hold
    }
    files[path] = e.text as string
    // Every write counts, the empty archive file that Show completed makes too (UCR-069): a test
    // that says nothing is written must see that one.
    writes.push(path)

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { state, writes, calls, kept }
}

const open = async ($: Parameters<Parameters<typeof test>[1]>[0]) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type TestApi = Parameters<Parameters<typeof test>[1]>[0]
type OnApi = Parameters<Parameters<typeof test>[1]>[1]

/** Collects every toast text. */
function toastsOf(on: OnApi): string[] {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)

  return toasts
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const count = (text: string, part: string) => text.split(part).length - 1
/** The move_ticket dialog answered yes. */
const sayYes = (on: OnApi) =>
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question

    return { result: { questions: [], answers: { [question]: 'Move it' } } } as never
  })

// ---------------------------------------------------------------- UCR-226: the cross-session archive race

/**
 * Property (UCR-226): a ticket that the archive move wrote to the archive is in exactly one of the two
 * files when the source changed before the cut: in the archive when it left the source (another session
 * cut it, or the user deleted it), in the source when it is still there. The probe L3R3-5, its three
 * states, a real second session's half (its own reads of the files and the shared record, the pure steps
 * the engine runs), and a mixed case with one block gone and one still there.
 */
for (const other of ['none', 'second session cut', 'user typed a line', 'second session, real interleaving', 'one block deleted by hand, one kept'] as const) {
  test(`UCR-226 L3R3-5 archive move, meanwhile: ${other}: each closed ticket is in one file`, { timeoutMs: 60_000 } as never, async ($, on) => {
    const clock = mock.clock(on)
    const live = '/repo/.claude_todo/TODO.md'
    const archive = '/repo/.claude_todo/archive/TODO.md'
    const isMixed = other === 'one block deleted by hand, one kept'
    const files: Record<string, string> = { [live]: `## Core\n- [x] #T1 Done parser\n  note under it\n${isMixed ? '- [x] #T4 Done lexer\n' : ''}- [ ] #T2 Open`, [archive]: '## Core\n\n- [x] #T0 Old\n' }
    const state = { archiveWritten: false, fired: false, bAdded: false }
    let kept: Map<string, unknown> = new Map()
    const log = {
      push: (...entries: string[]) => {
        for (const entry of entries) {
          if (entry === `write:${archive}`) {
            state.archiveWritten = true
          }
          // The window: after this session wrote the archive, at the first check of its cut.
          if (state.archiveWritten && !state.fired && entry === `stat:${live}`) {
            state.fired = true
            if (other === 'second session cut') {
              files[live] = '## Core\n- [ ] #T2 Open'
            } else if (other === 'user typed a line') {
              files[live] = `${files[live]}\n- [ ] #T3 Typed meanwhile`
            } else if (isMixed) {
              files[live] = files[live]!.replace('- [x] #T4 Done lexer\n', '')
            } else if (other === 'second session, real interleaving') {
              // Session B's whole move, as the engine runs it: the record from the shared store, the add that finds
              // every block in the archive and in the record, the confirm, the cut, the record cleared.
              const recordKey = [...kept.keys()].find(key => key.startsWith('archive-wrote:'))!
              const wrote = kept.get(recordKey) as string[][]
              const blocks = closedBlocks(files[live]!)
              const next = addToArchive(files[archive]!, blocks, wrote)
              state.bAdded = next !== files[archive]
              if (blocks.every(block => hasBlock(next.split('\n'), block.lines))) {
                files[live] = removeBlocks(files[live]!, blocks)
                kept.set(recordKey, null)
              }
            }
          }
        }

        return 0
      },
    } as unknown as string[]
    kept = repoWith(on, files, { hasNearest: true, log, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/TODO.md'] }).kept
    await open($)
    for (let i = 0; i < 6; i += 1) {
      await clock.advance(3000).catch(() => undefined)
    }
    expect(state.fired).toBe(true)
    expect(state.bAdded).toBe(false)
    const all = `${files[live]}\n${files[archive]}`
    expect([other, count(all, '#T1 Done parser'), count(all, 'note under it')]).toEqual([other, 1, 1])
    if (isMixed) {
      // The deleted one stays in the archive; the one still in the source comes out of the archive.
      expect(count(files[archive]!, '#T4 Done lexer')).toBe(1)
      expect(count(all, '#T4 Done lexer')).toBe(1)
    }
    if (other === 'user typed a line') {
      // The block went back to the source alone; a later pass moved it again, so it ends in the archive once.
      expect(files[live]).toContain('#T3 Typed meanwhile')
    }
    // No block stays recorded once it is in one place: the record is cleared (or never set).
    expect([...kept.entries()].filter(([key, value]) => key.startsWith('archive-wrote:') && value !== null && value !== undefined).length).toBe(0)
  })
}

// ---------------------------------------------------------------- UCR-227: a moved ticket never lands inside an archive comment

/** Property (UCR-227): the archive move puts a ticket where it is an item, or refuses: never under a heading inside an HTML comment. */
test('UCR-227 L3R3-2 archive into a file whose heading also stands inside an HTML comment', { timeoutMs: 60_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const live = '/repo/.claude_todo/TODO.md'
  const archive = '/repo/.claude_todo/archive/TODO.md'
  const files: Record<string, string> = { [live]: '## Work\n- [x] #T5 Ship the parser\n- [ ] #T6 Open', [archive]: '## Work\n- [x] #T1 Old\n\n<!--\n## Work\n## Notes\n-->\n' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/TODO.md'] })
  await open($)
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(3000).catch(() => undefined)
  }
  const items = parseTodo(files[archive]!).map(item => item.text)
  expect(items).toEqual(['#T1 Old', '#T5 Ship the parser'])
  expect(files[live]).toBe('## Work\n- [ ] #T6 Open')
})

// ---------------------------------------------------------------- UCR-228, UCR-230: the folder search after a Consolidate press

/**
 * Property (UCR-228, UCR-230): a git ls-files that throws, exits non-zero (also only the second call)
 * or never returns, at the search after a Consolidate press, is a failure: the folders the board had
 * stay, the source that stayed is still on the board, and one toast says why.
 */
for (const fault of ['throws', 'exits 1 on the ignored list only', 'never returns'] as const) {
  test(`UCR-228 L3R3-6 git ls-files ${fault} at the search after a Consolidate press: the folders stay`, { timeoutMs: 120_000 } as never, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = {
      '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
      '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 Docs',
      '/repo/mods/y/.claude_todo/TODO.md': '- [ ] #T3 Ship\n```\nopen fence',
    }
    const gate = { armed: false }
    const { calls } = repoWith(on, files, {
      hasNearest: true,
      listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md'],
      hang: argv => {
        const isList = gate.armed && argv[0] === 'git' && argv.includes('ls-files')
        if (isList && fault === 'throws') {
          throw new Error('fatal: index file corrupt')
        }

        return isList && fault === 'never returns'
      },
      lsExit: argv => (gate.armed && fault === 'exits 1 on the ignored list only' && argv.includes('--ignored') ? 1 : undefined),
    })
    const toasts = toastsOf(on)
    const ui = await open($)
    expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('Ship')
    gate.armed = true
    let isDone = false
    void ui.press({ key: 'todo-consolidate' }).then(() => { isDone = true }, () => { isDone = true })
    for (let s = 0; s < 90 && !isDone; s += 1) {
      await clock.advance(1000)
    }
    expect(isDone).toBe(true)
    // A search that timed out ends after the press freed the lock: its toast comes then.
    for (let s = 0; s < 40 && toasts.every(one => !one.includes('could not list the todo folders')); s += 1) {
      await clock.advance(1000)
    }
    expect(calls.filter(one => one.includes('ls-files')).length).toBeGreaterThan(2)
    const after = JSON.stringify(await ui.findAll({ type: 'Svg' }))
    expect([fault, after.includes('Ship')]).toEqual([fault, true])
    expect(toasts.filter(one => one.includes('could not list the todo folders')).length).toBe(1)
    expect(files['/repo/mods/y/.claude_todo/TODO.md']).toBe('- [ ] #T3 Ship\n```\nopen fence')
  })
}

/**
 * Property (UCR-230): after a Consolidate press whose git ls-files never returns, move_ticket still
 * answers and writes. The probe L3R3-3 with hang=true; the control (hang=false) answered before too.
 */
for (const isHang of [true, false]) {
  test(`UCR-230 L3R3-3 hang=${isHang}: move_ticket answers after a Consolidate press whose git ls-files never returns`, { timeoutMs: 180_000 } as never, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 Docs' }
    const gate = { armed: false }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'], hang: argv => isHang && gate.armed && argv[0] === 'git' && argv.includes('ls-files') })
    sayYes(on)
    const ui = await open($)
    gate.armed = true
    let isDone = false
    void ui.press({ key: 'todo-consolidate' }).then(() => { isDone = true }, () => { isDone = true })
    for (let s = 0; s < 90 && !isDone; s += 1) {
      await clock.advance(1000)
    }
    let answer: string | undefined
    void $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'in_progress', reason: 'x' } as never).then(r => { answer = JSON.stringify(r) }, e => { answer = `threw ${String(e)}` })
    for (let s = 0; s < 120 && answer === undefined; s += 1) {
      await clock.advance(1000)
    }
    expect(answer).toContain('is now in progress')
    expect(files['/repo/.claude_todo/TODO.md']).toContain('- [~] #T1 Fix')
  })
}

/** Property (UCR-230): a printenv that never returns at startup is a failure, told once; the mod fails closed and the pane still draws. */
test('UCR-230 a printenv that never returns at startup is told and taken as failed', { timeoutMs: 120_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], hang: argv => argv[0] === 'printenv' })
  const toasts = toastsOf(on)
  let ui: Awaited<ReturnType<typeof open>> | undefined
  void open($).then(one => { ui = one })
  for (let s = 0; s < 120 && toasts.every(one => !one.includes('printenv')); s += 1) {
    await clock.advance(1000)
  }
  expect(toasts.filter(one => one.includes('stopped waiting for `printenv`')).length).toBe(1)
  for (let s = 0; s < 60 && ui === undefined; s += 1) {
    await clock.advance(1000)
  }
  expect(ui).toBeDefined()
  // Without a home the global folder cannot be told: nothing is written (fail closed).
  expect(toasts.some(one => one.includes('cannot read the HOME folder'))).toBe(true)
})

/** Property (UCR-230): an opener that never returns makes the Show completed press end with a toast that names it. */
test('UCR-230 Show completed with an open command that never returns ends with a toast', { timeoutMs: 120_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', '/repo/.claude_todo/archive/TODO.md': '- [x] #T0 Old\n' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/TODO.md'], hang: argv => ['open', 'xdg-open', 'explorer.exe'].includes(argv[0]!) })
  const toasts = toastsOf(on)
  const ui = await open($)
  await ui.press({ key: 'todo-show-completed' })
  for (let s = 0; s < 60 && toasts.every(one => !one.includes('Could not open')); s += 1) {
    await clock.advance(1000)
  }
  expect(toasts.some(one => one.includes('Could not open /repo/.claude_todo/archive/TODO.md') && one.includes('did not return'))).toBe(true)
})

// ---------------------------------------------------------------- UCR-229: Delete duplicate tickets on a target that is not safe

/**
 * Property (UCR-229): the Delete duplicate tickets button shows only for a target the press can write,
 * and a press that cannot write says why. States: the target a symlink (no button), the folder a
 * symlink (no button), the target made a symlink after the board drew (a toast).
 */
for (const where of ['target', 'folder'] as const) {
  test(`UCR-229 L3R3-7 the ${where} is a symlink: no Delete duplicate tickets button`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser\n- [ ] #T2 Fix the parser' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], links: where === 'target' ? { '/repo/.claude_todo/TODO.md': '/elsewhere/TODO.md' } : { '/repo/.claude_todo': '/elsewhere/.claude_todo' } })
    const ui = await open($)
    expect(await ui.find({ key: 'todo-delete-dup-tickets' })).toBeUndefined()
    expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix the parser\n- [ ] #T2 Fix the parser')
  })
}

test('UCR-229 the target becomes a symlink after the board drew: the press says why, and the control writes', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser\n- [ ] #T2 Fix the parser' }
  const links: Record<string, string> = {}
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], links })
  const toasts = toastsOf(on)
  const ui = await open($)
  expect(await ui.find({ key: 'todo-delete-dup-tickets' })).toBeDefined()
  links['/repo/.claude_todo/TODO.md'] = '/elsewhere/TODO.md'
  await ui.press({ key: 'todo-delete-dup-tickets' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix the parser\n- [ ] #T2 Fix the parser')
  expect(toasts.some(one => one.includes('Not changed: .claude_todo/TODO.md (not safe: a symlink is in its path)'))).toBe(true)
})

// ---------------------------------------------------------------- UCR-231: places from the parse that drew the board

/**
 * Property (UCR-231): a press made while a scan has read the new text but the board still shows the
 * old one is checked against the board's own places, so the neighbor line is never written. The probe L3R3-1.
 */
test('UCR-231 L3R3-1 a press between the read of the new text and the redraw is refused', { timeoutMs: 60_000 } as never, async ($, on) => {
  mock.clock(on)
  const before = '## Tasks\n- [ ] Write tests\n  - note: jest\n## Tasks\n- [ ] Write tests\n  - note: pytest'
  const after = '## Tasks\n## Tasks\n- [ ] Write tests\n  - note: pytest'
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': before, '/repo/.claude_todo/Z.md': '- [ ] #T9 Other' }
  let release: () => void = () => undefined
  const gate = { armed: false, held: false }
  repoWith(on, files, {
    hasNearest: true,
    listed: ['.claude_todo/TODO.md', '.claude_todo/Z.md'],
    readHook: async path => {
      if (gate.armed && path === '/repo/.claude_todo/Z.md') {
        gate.held = true
        await new Promise<void>(resolve => {
          release = resolve
        })
      }
    },
  })
  const toasts = toastsOf(on)
  const ui = await open($)
  files['/repo/.claude_todo/TODO.md'] = after
  mtimes['/repo/.claude_todo/TODO.md'] = 50
  mtimes['/repo/.claude_todo/Z.md'] = 50
  gate.armed = true
  void $.tool.call({ tool: 'Write', file_path: '/repo/.claude_todo/TODO.md' } as never).catch(() => undefined)
  for (let i = 0; i < 200 && !gate.held; i += 1) {
    await tick()
  }
  expect(gate.held).toBe(true)
  // The board still draws both lines.
  expect(count(JSON.stringify(await ui.findAll({ type: 'Svg' })), 'Write tests')).toBe(6)
  void ui.press({ key: 'ticket-start-TODO.md-write tests' }).catch(() => undefined)
  for (let i = 0; i < 200; i += 1) {
    await tick()
  }
  expect(files['/repo/.claude_todo/TODO.md']).toBe(after)
  gate.armed = false
  release()
  for (let i = 0; i < 200; i += 1) {
    await tick()
  }
  expect(files['/repo/.claude_todo/TODO.md']).toBe(after)
  expect(toasts.some(one => one.includes('Not changed, the line changed in TODO.md since the board drew it'))).toBe(true)
})

// ---------------------------------------------------------------- UCR-232, UCR-234: the press checks of the engine

/** Property (UCR-232): the engine refuses a press on one of two identical lines when one moved under prose labels (L3R3-025m). */
test('UCR-232 L3R3-025m one identical line moved under prose labels: the press is refused', async ($, on) => {
  mock.clock(on)
  const before = 'Frontend:\n- [ ] Write tests\nBackend:\n- [ ] Write tests'
  const after = 'Frontend:\nBackend:\n- [ ] Write tests\nInfra:\n- [ ] Write tests'
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': before }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const toasts = toastsOf(on)
  const ui = await open($)
  files['/repo/.claude_todo/TODO.md'] = after
  await ui.press({ key: 'ticket-start-TODO.md-write tests' }).catch(() => undefined)
  expect(files['/repo/.claude_todo/TODO.md']).toBe(after)
  expect(toasts.some(one => one.includes('Not changed, the line changed in TODO.md'))).toBe(true)
})

/** Property (UCR-234): a parent heading added above a unique ticket does not refuse its press (L3R3-8b). */
test('UCR-234 L3R3-8b a line added above the ticket, then Start on the unique #T2: written', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '## Work\n- [ ] #T1 Fix\n- [ ] #T2 Docs' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  files['/repo/.claude_todo/TODO.md'] = '# Project\n## Work\n- [ ] #T1 Fix\n- [ ] #T2 Docs'
  await ui.press({ key: 'ticket-start-TODO.md-#t2' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('# Project\n## Work\n- [ ] #T1 Fix\n- [~] #T2 Docs')
})

/**
 * Property (UCR-234): the write never goes through a folder that `mkdir -p` found or made as a symlink:
 * the place is checked again after the mkdir (L3R3-4).
 */
test('UCR-234 L3R3-4 archive/ made by the write fallback as a symlink is not written through', { timeoutMs: 60_000 } as never, async ($, on) => {
  const clock = mock.clock(on)
  const live = '/repo/.claude_todo/TODO.md'
  const archive = '/repo/.claude_todo/archive/TODO.md'
  const files: Record<string, string> = { [live]: '## Core\n- [x] #T1 Done parser\n- [ ] #T2 Open' }
  const links: Record<string, string> = {}
  let isMade = false
  repoWith(on, files, {
    hasNearest: true,
    links,
    listed: ['.claude_todo/TODO.md'],
    fault: path => {
      if (path === archive && !isMade) {
        throw new Error('ENOENT: no such folder')
      }
    },
    hang: argv => {
      if (argv[0] === 'mkdir' && argv.includes('/repo/.claude_todo/archive')) {
        isMade = true
        // The folder appears, as a symlink to a place outside the repo.
        links['/repo/.claude_todo/archive'] = '/elsewhere/archive'
        files['/repo/.claude_todo/archive/.keep'] = ''
      }

      return false
    },
  })
  await open($)
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(3000).catch(() => undefined)
  }
  expect(isMade).toBe(true)
  expect(files[archive]).toBeUndefined()
  expect(files[live]).toBe('## Core\n- [x] #T1 Done parser\n- [ ] #T2 Open')
})

/** Property (UCR-234): a source whose name holds a format character (a bidi override) is not copied, and is named (L3R3-170X). */
test('UCR-234 L3R3-170X a source name with a bidi override and a zero-width joiner is refused', async ($, on) => {
  mock.clock(on)
  const name = 'a‮evil‍.md'
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', [`/repo/mods/x/.claude_todo/${name}`]: '- [ ] #T2 Docs', '/repo/mods/z/.claude_todo/TODO.md': '- [ ] #T3 Ship' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', `mods/x/.claude_todo/${name}`, 'mods/z/.claude_todo/TODO.md'] })
  const toasts = toastsOf(on)
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' }).catch(() => undefined)
  const target = files['/repo/.claude_todo/TODO.md']!
  expect(target).not.toContain('‮')
  expect(target).not.toContain('Docs')
  expect(target).toContain('#T3 Ship')
  expect(files[`/repo/mods/x/.claude_todo/${name}`]).toBe('- [ ] #T2 Docs')
  expect(toasts.some(one => one.includes('Not copied, left as they are'))).toBe(true)
})

// ---------------------------------------------------------------- #T003F: the Queued column

/** Property (#T003F, #T003I): the queue button writes `- [>]`, and a queued ticket offers open, start, done and send. */
test('#T003F the queue button writes [>], and a queued ticket offers back to open, start, done and send', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  await ui.press({ key: 'ticket-queue-TODO.md-#t1' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [>] #T1 Fix the parser')
  // The fake fs keeps mtimes by hand: a real write moves it, so the next scan reads the file again.
  mtimes['/repo/.claude_todo/TODO.md'] = (mtimes['/repo/.claude_todo/TODO.md'] ?? 0) + 10
  let drawn = ''
  for (let i = 0; i < 20 && !drawn.includes('ticket-reopen-TODO.md-#t1'); i += 1) {
    await clock.advance(3000).catch(() => undefined)
    drawn = JSON.stringify(await ui.findAll({ type: 'Button' }))
  }
  // The send button's key has no action name.
  for (const key of ['ticket-reopen-TODO.md-#t1', 'ticket-start-TODO.md-#t1', 'ticket-done-TODO.md-#t1', 'ticket-TODO.md-#t1']) {
    expect(drawn).toContain(`"${key}"`)
  }
  expect(drawn).not.toContain('ticket-queue-TODO.md-#t1')
})

/**
 * Property (#T003F): an edit of the main conversation that sets a ticket from in progress back to
 * open leaves it queued, and the tool result tells Claude so; a later edit from queued to open stays open.
 */
test('#T003F a ticket Claude sets from [~] back to [ ] is queued, and told; from [>] to [ ] it stays open', async ($, on) => {
  mock.clock(on)
  const path = '/repo/.claude_todo/TODO.md'
  const files: Record<string, string> = { [path]: '- [~] #T1 Fix the parser\n- [~] #T2 Ship it' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  let edit = (text: string) => text
  on('tool.call', () => {
    files[path] = edit(files[path]!)
    mtimes[path] = (mtimes[path] ?? 0) + 10

    return { result: 'ok' } as never
  })
  await open($)
  edit = text => text.replace('- [~] #T1', '- [ ] #T1').replace('- [~] #T2', '- [x] #T2')
  const ran = (await $.tool.call({ tool: 'Edit', file_path: path } as never)) as { context?: string[] }
  expect(files[path]).toBe('- [>] #T1 Fix the parser\n- [x] #T2 Ship it')
  expect((ran.context ?? []).join('\n')).toContain('wrote them as queued')
  edit = text => text.replace('- [>] #T1', '- [ ] #T1')
  await $.tool.call({ tool: 'Edit', file_path: path } as never)
  expect(files[path]).toBe('- [ ] #T1 Fix the parser\n- [x] #T2 Ship it')
})

/** Property (#T003F): a reply of the main conversation that puts an open ticket off until later gets a note at the next tool result, once. */
test('#T003F a reply that puts an open ticket off until later brings a deferred note, once', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser\n- [~] #T2 Ship it' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'I will open #T1 up for work after #T2 lands. ' } as never
    yield { kind: 'text', index: 0, text: 'Working on #T2 now.' } as never

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  await open($)
  const step = async () => {
    for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) {
      // Read to the end.
    }
  }
  await step()
  const first = (await $.tool.call({ tool: 'Read', file_path: '/repo/x.ts' } as never)) as { context?: string[] }
  const note = (first.context ?? []).join('\n')
  expect(note).toContain('put these open todo items off until later')
  expect(note).toContain('#T1 Fix the parser')
  expect(note).not.toContain('Ship it')
  await step()
  const second = (await $.tool.call({ tool: 'Read', file_path: '/repo/x.ts' } as never)) as { context?: string[] }
  expect((second.context ?? []).join('\n')).not.toContain('off until later')
})

/** Property (#T003I): an open ticket has a done button, which writes `- [x]`. */
test('#T003I an open ticket closes with its done button', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  await ui.press({ key: 'ticket-done-TODO.md-#t1' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [x] #T1 Fix the parser')
})

/** Property (#T003M): back moves a ticket one column, in progress to queued and queued to open; a card in progress has no queue button. */
test('#T003M back moves a ticket in progress to queued, then to open', async ($, on) => {
  const clock = mock.clock(on)
  const path = '/repo/.claude_todo/TODO.md'
  const files: Record<string, string> = { [path]: '- [~] #T1 Fix the parser' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  const buttons = async () => JSON.stringify(await ui.findAll({ type: 'Button' }))
  expect(await buttons()).not.toContain('ticket-queue-TODO.md-#t1')
  await ui.press({ key: 'ticket-unstart-TODO.md-#t1' })
  expect(files[path]).toBe('- [>] #T1 Fix the parser')
  mtimes[path] = (mtimes[path] ?? 0) + 10
  for (let i = 0; i < 20 && !(await buttons()).includes('ticket-reopen-TODO.md-#t1'); i += 1) {
    await clock.advance(3000).catch(() => undefined)
  }
  await ui.press({ key: 'ticket-reopen-TODO.md-#t1' })
  expect(files[path]).toBe('- [ ] #T1 Fix the parser')
})
