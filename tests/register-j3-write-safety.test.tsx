// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { psPath } from '../hooks/path-forms'
import { parseTodo } from '../hooks/todo-markdown'

{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

/** The path a PowerShell script names through `psPath`, with forward slashes. */
const fromPs = (script: string) => String.fromCodePoint(...(/\[char\[\]\]\(([\d,]+)\)/.exec(script)![1]!.split(',').map(Number))).replace(/\\/g, '/')

/**
 * A fake repo (at `/repo` unless `root` says) with the given files by absolute path; `hasNearest` says
 * whether the session folder has its own `.claude_todo`; `rev` is what `git rev-parse` answers;
 * `links` maps a path to the real path the fake stat gives it (a symlink). `uname` is what `uname -s`
 * answers; a trash command named in `failing` exits 1, and one named in `stays` exits 0 but leaves the
 * file; one named in `hang` never returns. Any other trash command removes the file from `files`, as the
 * real one would. A path in `failOnce` fails its next write.
 */
function repoWith(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string>; uname?: string; failing?: string[]; stays?: string[]; exits?: Record<string, number>; log?: string[]; dangling?: string[]; hold?: Promise<void>; store?: false; hang?: string[]; failOnce?: string[] }) {
  const R = opts.root ?? '/repo'
  const state = { hasNearest: opts.hasNearest, listed: opts.listed }
  const writes: string[] = []
  const calls: string[] = []
  // The archive move needs a store that works (no record, no move); a test with a store of its own passes `store: false`.
  if (opts.store !== false) {
    const kept = new Map<string, unknown>()
    on('store.get', (_$, e) => ({ value: kept.get(e.key) }) as never)
    on('store.set', (_$, e) => {
      kept.set(e.key, e.value)

      return { value: undefined } as never
    })
  }
  // Every write moves every file's mtime on, as a real disk would, so a rescan reads the new text.
  let stamp = 0
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never

    const fail = { value: { exitCode: 1, stdout: '', stderr: 'failed' } } as never
    const dirEmpty = (dir: string) => !Object.keys(files).some(path => path.startsWith(`${dir}/`))

    if (argv[0] === 'uname') {
      return out(`${opts.uname ?? 'Darwin'}\n`)
    }
    // The mod reads HOME to know the global todo folder; CLAUDE_CONFIG_DIR is unset.
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : fail
    }
    if (['/usr/bin/trash', 'osascript', 'gio', 'trash-put', 'kioclient5', 'powershell.exe'].includes(argv[0]!)) {
      const script = argv[argv.length - 1]!
      if (argv[0] === 'powershell.exe' && script.startsWith('[System.IO.Directory]::Delete(')) {
        return dirEmpty(fromPs(script)) ? out('') : fail
      }
      if (opts.failing?.includes(argv[0]!)) {
        return fail
      }
      // A trash command that never returns: a Finder permission dialog left open.
      if (opts.hang?.includes(argv[0]!)) {
        return new Promise(() => undefined) as never
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
  on('fs.list', (_$, e) => ({ value: [...(inside(abs(e.path)) ? names(abs(e.path)) : state.hasNearest ? names(`${R}/.claude_todo`) : []), ...(opts.dangling ?? []).filter(path => path.slice(0, path.lastIndexOf('/')) === abs(e.path)).map(path => path.slice(path.lastIndexOf('/') + 1))].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2 + stamp, isLink: false })) }))
  on('fs.read', (_$, e) => (opts.log?.push(`read:${abs(e.path)}`), { value: files[inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`] ?? '' }))
  on('fs.write', async (_$, e) => {
    const path = inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`
    opts.log?.push(`write:${path}`)
    // A write that fails once for each listed path.
    const once = opts.failOnce?.indexOf(path) ?? -1
    if (once >= 0) {
      opts.failOnce!.splice(once, 1)
      throw new Error('EIO')
    }
    // A held write: the test presses a button while this write is in flight.
    if (opts.hold !== undefined && e.text !== '') {
      await opts.hold
    }
    files[path] = e.text as string
    stamp += 1
    // Every write counts, the empty archive file that Show completed makes too: a test
    // that says nothing is written must see that one.
    writes.push(path)

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { state, writes, calls }
}
const open = async ($: Parameters<Parameters<typeof test>[1]>[0]) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

const toastsOf = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })

  return toasts
}

const hookLog = (fn: (entry: string) => void): string[] => ({ push: (...entries: string[]) => (entries.forEach(fn), 0) }) as unknown as string[]


const itemTexts = (text: string) => parseTodo(text).map(item => item.text)
const CENTRAL = '/repo/.claude_todo/TODO.md'
const SOURCE = '/repo/mods/x/.claude_todo/TODO.md'
const BOTH = ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md']

/**
 * Property: a line added to a Consolidate source while the press checks it (between its
 * last read and the emptying write) is never lost: the source is left, named, and keeps the line.
 */
// Each state: the file edited the first time its stat runs after the target holds the copy.
const STATES_167: [string, Record<string, string>, string[], string][] = [
    // The reviewer's R3-B state, behind a valid first case (the target write landed).
    ['source', { [CENTRAL]: '- [ ] #T1 Fix', [SOURCE]: '- [ ] #T2 Docs' }, BOTH, SOURCE],
    // At the limit: the last source of the press, an archive file of the source folder.
    ['archive', { [CENTRAL]: '- [ ] #T1 Fix', [SOURCE]: '- [ ] #T2 Docs', '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Old' }, [...BOTH, 'mods/x/.claude_todo/archive/OLD.md'], '/repo/mods/x/.claude_todo/archive/OLD.md'],
    // Inside the central folder: an extra central file merged into the target.
    ['central extra', { [CENTRAL]: '- [ ] #T1 Fix', '/repo/.claude_todo/MORE.md': '- [ ] #T2 Docs' }, ['.claude_todo/TODO.md', '.claude_todo/MORE.md'], '/repo/.claude_todo/MORE.md'],
]
for (const [name, start, listed, edited] of STATES_167) {
  test(`Consolidate never empties a source that changed while it was checked (${name})`, async ($, on) => {
    const files = { ...start }
    let isTyped = false
    const log = hookLog(entry => {
      if (!isTyped && entry === `stat:${edited}` && files[CENTRAL]!.includes('## From') && (!edited.includes('/archive/') || (files['/repo/.claude_todo/archive/OLD.md'] ?? '').includes('## From'))) {
        isTyped = true
        files[edited] = `${files[edited]}\n- [ ] #T0099 Typed meanwhile`
      }
    })
    repoWith(on, files, { hasNearest: true, log, listed })
    const toasts = toastsOf(on)
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    expect([name, isTyped]).toEqual([name, true])
    expect([name, files[edited]]).toEqual([name, `${start[edited]}\n- [ ] #T0099 Typed meanwhile`])
    expect([name, toasts.join('\n').includes('changed since the copy')]).toEqual([name, true])
  })
}

/**
 * Property: an edit to a Consolidate destination that lands while the press stores its
 * marks is never written over: the destination keeps the edit, the sources stay, and the marks go.
 */
const STATES_168: [string, Record<string, string>, string[], string, string][] = [
    // The reviewer's R3-A state: Claude closes #T1 in the target during the store write.
    ['target', { [CENTRAL]: '- [ ] #T1 Fix', [SOURCE]: '- [ ] #T2 Docs' }, BOTH, CENTRAL, '- [x] #T1 Fix'],
    // At the limit: the last destination, the central archive file a source archive goes to.
    ['archive', { [CENTRAL]: '- [ ] #T1 Fix', '/repo/.claude_todo/archive/OLD.md': '- [x] #T0 Old', '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Done in x' }, ['.claude_todo/TODO.md', '.claude_todo/archive/OLD.md', 'mods/x/.claude_todo/archive/OLD.md', 'mods/x/.claude_todo/TODO.md'], '/repo/.claude_todo/archive/OLD.md', '- [x] #T0 Old\n- [x] #T7 Pasted'],
    // The missing-file population: the target does not exist yet, and the user creates it during the store write.
    ['created', { '/repo/.claude_todo/NOTES.md': 'prose', [SOURCE]: '- [ ] #T2 Docs', '/repo/mods/y/.claude_todo/TODO.md': '- [ ] #T3 Ship' }, ['.claude_todo/NOTES.md', 'mods/x/.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md'], CENTRAL, '- [ ] #T5 Mine'],
]
for (const [name, start, listed, dest, edit] of STATES_168) {
  test(`Consolidate never writes over a destination edited during the marks store write (${name})`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { ...start }
    if (name === 'archive') {
      files[SOURCE] = '- [ ] #T4 Live'
    }
    const kept = new Map<string, unknown>()
    let isEdited = false
    on('store.get', (_$, e) => ({ value: kept.get(e.key) }) as never)
    on('store.set', (_$, e) => {
      if (!isEdited && String(e.key).startsWith('consolidate-marks:') && Object.keys((e.value ?? {}) as object).some(path => name !== 'archive' || path.includes('/archive/'))) {
        isEdited = true
        files[dest] = edit
      }
      kept.set(e.key, e.value)

      return { value: undefined } as never
    })
    repoWith(on, files, { hasNearest: true, store: false, listed })
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    expect([name, isEdited]).toEqual([name, true])
    expect([name, files[dest]]).toEqual([name, edit])
    // The sources of that destination were not emptied.
    for (const [path, text] of Object.entries(start)) {
      if (path.includes('/mods/') && (name !== 'archive' || path.includes('/archive/'))) {
        expect([name, path, files[path]]).toEqual([name, path, text])
      }
    }
  })
}

/**
 * Property: an edit to an archive file that lands while the archive step stores its record
 * is never written over: the archive keeps the edit, and the live file keeps its ticket until a later pass.
 */
const ARCHIVE = '/repo/.claude_todo/archive/TODO.md'
const STATES_169: [string, string | undefined, string][] = [
    // The reviewer's R3-C state: a line pasted into the archive during the store write.
    ['pasted', '- [x] #T0 Old\n', '- [x] #T0 Old\n- [x] #T7 Pasted by the user\n'],
    // At the limit: the archive file is missing, and the user creates it during the store write.
    ['created', undefined, '- [x] #T7 Made by the user\n'],
    // Inside the population a check could skip: an edit that leaves the archive empty.
    ['emptied', '- [x] #T0 Old\n', ''],
]
for (const [name, archive, edit] of STATES_169) {
  test(`the archive step never writes over an archive edited during the record store (${name})`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [CENTRAL]: '- [x] #T1 Done parser\n- [ ] #T2 Open', ...(archive === undefined ? {} : { [ARCHIVE]: archive }) }
    const kept = new Map<string, unknown>()
    let isEdited = false
    on('store.get', (_$, e) => ({ value: kept.get(e.key) }) as never)
    on('store.set', (_$, e) => {
      if (!isEdited && String(e.key).startsWith('archive-wrote:') && e.value !== null) {
        isEdited = true
        files[ARCHIVE] = edit
      }
      kept.set(e.key, e.value)

      return { value: undefined } as never
    })
    repoWith(on, files, { hasNearest: true, store: false, listed: ['.claude_todo/TODO.md', ...(archive === undefined ? [] : ['.claude_todo/archive/TODO.md'])] })
    await open($)
    await clock.advance(6000)
    expect([name, isEdited]).toEqual([name, true])
    // The edit is there (each line it added, and none it took out); the moved ticket is in one place, once.
    const editLines = edit.split('\n').filter(line => line !== '')
    const cut = (archive ?? '').split('\n').filter(line => line !== '' && !editLines.includes(line))
    expect([name, editLines.every(line => files[ARCHIVE]!.includes(line)), cut.some(line => files[ARCHIVE]!.includes(line))]).toEqual([name, true, false])
    expect([name, `${files[ARCHIVE]}\n${files[CENTRAL]}`.split('#T1 Done parser').length - 1]).toEqual([name, 1])
  })
}

/**
 * Property: Consolidate never appends tickets where they stop being tickets: a target that
 * ends inside an unclosed code block or HTML comment is not written, a source whose copy ends open is
 * not copied, and every source copied is an item of the result before any source is emptied.
 */
for (const [kind, tail] of [['fence', '\n```sh\nnpm test'], ['comment', '\n<!-- notes for later']] as const) {
  // The reviewer's R3-J state: the target ends open; behind a valid first line.
  test(`Consolidate refuses a target that ends inside an open ${kind}`, async ($, on) => {
    mock.clock(on)
    const target: Record<string, string> = { [CENTRAL]: `- [ ] #T1 Fix${tail}`, [SOURCE]: '- [ ] #T2 Docs' }
    repoWith(on, target, { hasNearest: true, listed: BOTH })
    const toasts = toastsOf(on)
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    expect([kind, target[CENTRAL]]).toEqual([kind, `- [ ] #T1 Fix${tail}`])
    expect([kind, target[SOURCE]]).toEqual([kind, '- [ ] #T2 Docs'])
    expect([kind, toasts.join('\n').includes('unclosed code block or HTML block')]).toEqual([kind, true])
  })
  // The reviewer's R3-K state, at the limit: the first source ends open and would swallow the last one.
  test(`Consolidate does not copy a source that ends inside an open ${kind}`, async ($, on) => {
    mock.clock(on)
    const sources: Record<string, string> = { [CENTRAL]: '- [ ] #T1 Fix', '/repo/mods/a/.claude_todo/TODO.md': `- [ ] #T2 Docs${tail}`, '/repo/mods/b/.claude_todo/TODO.md': '- [ ] #T3 Ship' }
    repoWith(on, sources, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/a/.claude_todo/TODO.md', 'mods/b/.claude_todo/TODO.md'] })
    const ui2 = await open($)
    await ui2.press({ key: 'todo-consolidate' })
    expect([kind, itemTexts(sources[CENTRAL]!).includes('#T3 Ship')]).toEqual([kind, true])
    expect([kind, sources['/repo/mods/a/.claude_todo/TODO.md']]).toEqual([kind, `- [ ] #T2 Docs${tail}`])
    expect([kind, sources['/repo/mods/b/.claude_todo/TODO.md']]).toEqual([kind, ''])
  })
}
// The excluded population: a target whose fence and comment are closed is written as before.
test('Consolidate writes a target whose fence and comment are closed', async ($, on) => {
  mock.clock(on)
  const closed: Record<string, string> = { [CENTRAL]: '- [ ] #T1 Fix\n```sh\nnpm test\n```\n<!-- a -->', [SOURCE]: '- [ ] #T2 Docs' }
  repoWith(on, closed, { hasNearest: true, listed: BOTH })
  const ui3 = await open($)
  await ui3.press({ key: 'todo-consolidate' })
  expect(itemTexts(closed[CENTRAL]!)).toContain('#T2 Docs')
  expect(closed[SOURCE]).toBe('')
})

/**
 * Property: the archive step never appends to an archive file that ends inside an unclosed
 * code block or HTML comment: the ticket stays in the live file, and the user is told once.
 */
// The reviewer's R3-M states (fence and comment), and at the limit an open comment on the last line with no line end.
for (const tail of ['\n```sh\nnpm test\n', '\n<!-- notes for later\n', '\n<!--']) {
  test(`the archive step waits on an archive that ends inside an open fence or comment (${JSON.stringify(tail)})`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [CENTRAL]: '- [x] #T1 Done\n- [ ] #T2 Open', [ARCHIVE]: `- [x] #T0 Old${tail}` }
    const toasts = toastsOf(on)
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/TODO.md'] })
    await open($)
    await clock.advance(6000)
    await clock.advance(3000)
    expect([tail, files[ARCHIVE]]).toEqual([tail, `- [x] #T0 Old${tail}`])
    expect([tail, files[CENTRAL]]).toEqual([tail, '- [x] #T1 Done\n- [ ] #T2 Open'])
    expect([tail, toasts.join('\n').includes('unclosed code block or HTML block')]).toEqual([tail, true])
  })
}
// The excluded population: a closed comment at the end lets the move go on.
test('the archive step moves into an archive whose comment is closed', async ($, on) => {
  const clock = mock.clock(on)
  const closed: Record<string, string> = { [CENTRAL]: '- [x] #T1 Done\n- [ ] #T2 Open', [ARCHIVE]: '- [x] #T0 Old\n<!-- note -->\n' }
  repoWith(on, closed, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/TODO.md'] })
  await open($)
  await clock.advance(6000)
  await clock.advance(3000)
  expect(itemTexts(closed[ARCHIVE]!)).toContain('#T1 Done')
  expect(closed[CENTRAL]).toBe('- [ ] #T2 Open')
})

/** Property: the archive step never cuts a done line out of an HTML comment, also when the file has a real closed ticket. */
test('the archive step leaves a done line inside an HTML comment where it is', async ($, on) => {
  const clock = mock.clock(on)
  const text = ['# Plan', '<!-- Example of the format:', '- [x] #T0001 Example done item', '-->', '- [x] #T2 Real done', '- [ ] #T3 Open'].join('\n')
  const files: Record<string, string> = { [CENTRAL]: text }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(6000)
  await clock.advance(3000)
  expect(files[CENTRAL]).toBe(['# Plan', '<!-- Example of the format:', '- [x] #T0001 Example done item', '-->', '- [ ] #T3 Open'].join('\n'))
  expect(files['/repo/.claude_todo/archive/TODO.md']).not.toContain('#T0001')
  expect(files['/repo/.claude_todo/archive/TODO.md']).toContain('- [x] #T2 Real done')
})

/**
 * Property: once Delete duplicate tickets wrote the target, Claude is told and the toast says
 * so, whatever happens to the archive files after; an archive file that fails is named on its own.
 */
test('Delete duplicate tickets tells Claude of a written target when an archive file fails', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [CENTRAL]: '- [ ] #T1 Fix the parser\n- [ ] #T2 Fix the parser\n- [ ] see #T2', '/repo/.claude_todo/archive/A.md': '- [x] #T8 done, after #T2' }
  // The reviewer's R3-E state, at the limit of the archive loop: the last archive file fails its read once the press runs.
  let archiveReads = 0
  Object.defineProperty(files, '/repo/.claude_todo/archive/OLD.md', {
    enumerable: true,
    configurable: true,
    get: () => {
      archiveReads += 1
      if (archiveReads > 1) {
        throw new Error('EIO')
      }

      return '- [x] #T9 done, after #T2'
    },
    set: () => undefined,
  })
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/A.md', '.claude_todo/archive/OLD.md'] })
  const toasts = toastsOf(on)
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }) as never)
  const ui = await open($)
  archiveReads = 1
  await ui.press({ key: 'todo-delete-dup-tickets' })
  expect(files[CENTRAL]).toBe('- [ ] #T1 Fix the parser\n- [ ] see #T1')
  // The archive file before the failing one was fixed; the failing one is named, not the whole press.
  expect(files['/repo/.claude_todo/archive/A.md']).toBe('- [x] #T8 done, after #T1')
  const said = toasts.join('\n')
  expect(said).toContain('Removed 1 duplicate ticket')
  expect(said).toContain('References not fixed in archive/OLD.md')
  expect(said).not.toContain('Could not remove duplicate tickets')
  const note = JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x' } as never))
  expect(note).toContain('#T2 is now #T1')
})

/**
 * Property: the Consolidate todos button stays while a press left work: a source archive
 * file that was copied but not emptied, so the "press Consolidate todos again" of the toast can be done.
 */
test('the Consolidate button stays while a source archive file is left, and the next press finishes', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [CENTRAL]: '- [ ] #T1 Fix', [SOURCE]: '- [ ] #T1 Docs\n- [ ] #T2 Ship, after #T1', '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Done in x' }
  // The reviewer's R3-H k=38 state: the emptying write of the source archive fails once.
  repoWith(on, files, { hasNearest: true, failOnce: ['/repo/mods/x/.claude_todo/archive/OLD.md'], listed: [...BOTH, 'mods/x/.claude_todo/archive/OLD.md'] })
  const toasts = toastsOf(on)
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  expect(files[SOURCE]).toBe('')
  expect(files['/repo/mods/x/.claude_todo/archive/OLD.md']).toBe('- [x] #T9 Done in x')
  expect(toasts.join('\n')).toContain('Press Consolidate todos again to finish')
  expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/mods/x/.claude_todo/archive/OLD.md']).toBe('')
  expect(files['/repo/.claude_todo/archive/OLD.md']!.split('Done in x').length - 1).toBe(1)
  // Done: no work is left, and the button goes.
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
})

/**
 * Property: a check that could not run is reported as such, never as a symlink or as a
 * change: the toast names the failed check.
 */
const OLD_174 = '/repo/mods/x/.claude_todo/archive/OLD.md'
// Each state: the path whose stat fails, the stat count (from the press) at which it starts to fail, and the words the toast must have.
const STATES_174: [string, string, number, string][] = [
    // Behind a valid first case: the source archive's check right before its emptying (the R3-H k=36 state).
    ['source archive', OLD_174, 3, `${OLD_174} (not safe: it could not be checked (the stat failed))`],
    // At the limit: the central folder's repo check of the last destination (the R3-H k=30 state).
    ['destination', '/repo', 3, "archive/OLD.md (the repo's real path could not be read)"],
    // The population a folder check covers: the source folder itself, at the start of the press.
    ['source folder', '/repo/mods/x/.claude_todo', 1, '/repo/mods/x/.claude_todo (not safe: its real path could not be read)'],
]
for (const [name, path, from, words] of STATES_174) {
  test(`Consolidate names a check that failed, not a symlink or a change (${name})`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { [CENTRAL]: '- [ ] #T1 Fix', [SOURCE]: '- [ ] #T2 Docs', [OLD_174]: '- [x] #T9 Done in x' }
    const seen = { isArmed: false, count: 0 }
    const log = hookLog(entry => {
      if (seen.isArmed && entry === `stat:${path}`) {
        seen.count += 1
        if (seen.count >= from) {
          throw new Error('EIO')
        }
      }
    })
    repoWith(on, files, { hasNearest: true, log, listed: [...BOTH, 'mods/x/.claude_todo/archive/OLD.md'] })
    const toasts = toastsOf(on)
    const ui = await open($)
    seen.isArmed = true
    await ui.press({ key: 'todo-consolidate' })
    const said = toasts.join('\n')
    expect([name, said.includes(words)]).toEqual([name, true])
    expect([name, said.includes('symlink')]).toEqual([name, false])
    expect([name, said.includes('changed since the copy')]).toEqual([name, false])
  })
}

/**
 * Property: an archive file edited while Delete duplicate tickets checks it keeps the edit:
 * the reference fix is not written over it.
 */
test('Delete duplicate tickets never writes over an archive file edited during its check', async ($, on) => {
  mock.clock(on)
  const OLD = '/repo/.claude_todo/archive/OLD.md'
  const files: Record<string, string> = { [CENTRAL]: '- [ ] #T1 Fix the parser\n- [ ] #T2 Fix the parser', [OLD]: '- [x] #T9 done, after #T2' }
  let isEdited = false
  const log = hookLog(entry => {
    if (!isEdited && entry === `stat:${OLD}` && files[CENTRAL] === '- [ ] #T1 Fix the parser') {
      isEdited = true
      files[OLD] = '- [x] #T9 done, after #T2\n- [x] #T7 Pasted by the user'
    }
  })
  repoWith(on, files, { hasNearest: true, log, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/OLD.md'] })
  const toasts = toastsOf(on)
  const ui = await open($)
  await ui.press({ key: 'todo-delete-dup-tickets' })
  expect(isEdited).toBe(true)
  expect(files[OLD]).toBe('- [x] #T9 done, after #T2\n- [x] #T7 Pasted by the user')
  expect(toasts.join('\n')).toContain('References not fixed in archive/OLD.md (changed meanwhile)')
})

/**
 * Property: a trash command that never returns does not hold the writer lock for good: after
 * the time limit the press ends, names the command that timed out, and the next todo write runs.
 */
test('Delete empty todos ends when a trash command never returns', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [CENTRAL]: '- [ ] #T1 Fix', '/repo/.claude_todo/EMPTY.md': '' }
  repoWith(on, files, { hasNearest: true, hang: ['/usr/bin/trash'], listed: ['.claude_todo/TODO.md', '.claude_todo/EMPTY.md'] })
  const toasts = toastsOf(on)
  const ui = await open($)
  let isDone = false
  const press = ui.press({ key: 'todo-delete-empty' }).then(() => {
    isDone = true
  })
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve()
  }
  await clock.advance(25_000)
  await press
  expect(isDone).toBe(true)
  expect(toasts.join('\n')).toContain('/usr/bin/trash: timed out after 20 s')
  // The lock is free: a box press writes at once.
  await ui.press({ key: 'ticket-start-TODO.md-#t1' })
  expect(files[CENTRAL]).toBe('- [~] #T1 Fix')
})

/**
 * Property (remainder): a press from an out-of-date board on identical lines in two sections
 * never writes the line of the other section: it is refused and the user is told.
 */
test('a stale press on identical lines in two sections writes nothing', async ($, on) => {
  mock.clock(on)
  const before = '- [ ] Write tests\n## Frontend\n- [ ] Write tests\n  - note: jest\n## Backend\n- [ ] Write tests\n  - note: pytest'
  const files: Record<string, string> = { [CENTRAL]: before }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const toasts = toastsOf(on)
  const ui = await open($)
  // The verifier's HI-025 state: the top line goes behind the board's back; the board still shows the Frontend line second.
  files[CENTRAL] = before.split('\n').slice(1).join('\n')
  await ui.press({ key: 'ticket-start-TODO.md-write tests%092' })
  expect(files[CENTRAL]).toBe(before.split('\n').slice(1).join('\n'))
  expect(toasts.join('\n')).toContain('since the board drew it')
})
}
