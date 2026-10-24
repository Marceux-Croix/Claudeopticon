// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// Hook cases on a fake repo whose fs calls can fail: kept claims, ticket button faults, Delete empty todos and move_ticket.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type F = { list?: (p: string) => boolean; read?: (p: string) => boolean; write?: (p: string, t: string) => boolean }
type Ctx = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

/**
 * A fake repo at `/repo` with the given files by absolute path (copied from work.test.tsx, plus
 * `faults`: a path predicate per call that makes the fake fs throw).
 */
function repoWith(on: On, files: Record<string, string>, opts: { faults?: F; hasNearest: boolean; listed: string[] }) {
  const R = '/repo'
  const state = { hasNearest: opts.hasNearest, listed: opts.listed }
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    // The mod reads HOME to know the global todo folder; CLAUDE_CONFIG_DIR is unset.
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }
    if (['/usr/bin/trash', 'osascript', 'gio', 'trash-put', 'kioclient5'].includes(argv[0]!)) {
      const script = argv[argv.length - 1]!
      const path = argv[0] === 'osascript' ? /POSIX file "(.*)"$/.exec(script)![1]!.replace(/\\(.)/g, '$1') : argv[argv.length - 1]!
      delete files[path]

      return out('')
    }
    if (argv[0] === 'rmdir') {
      return Object.keys(files).some(path => path.startsWith(`${argv[2]}/`)) ? ({ value: { exitCode: 1, stdout: '', stderr: 'failed' } } as never) : out('')
    }

    return argv[1] === 'rev-parse' ? out(`${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : state.listed.join('\0'))
  })
  const abs = (path: string) => path
  on('fs.exists', (_$, e) => ({ value: abs(e.path).endsWith('.git') || (abs(e.path).endsWith('.claude_todo') && !inside(abs(e.path)) && state.hasNearest) || (inside(abs(e.path)) && (abs(e.path) in files || Object.keys(files).some(path => path.startsWith(`${abs(e.path)}/`)))) }))
  on('fs.stat', (_$, e) => {
    // The home folder is outside the fake repo and does not exist there.
    if (abs(e.path).startsWith('/home/a/.claude') && !inside(abs(e.path))) {
      throw new Error('ENOENT')
    }

    return { value: { kind: abs(e.path) in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: inside(abs(e.path)) ? abs(e.path) : !abs(e.path).includes('.claude_todo') && !abs(e.path).includes('.git') ? R : `${R}/.claude_todo` } } as never
  })
  on('fs.list', (_$, e) => (opts.faults?.list?.(abs(e.path)) ? (() => { throw new Error('EIO list') })() : 0, { value: (inside(abs(e.path)) ? names(abs(e.path)) : state.hasNearest ? names(`${R}/.claude_todo`) : []).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2, isLink: false })) }))
  on('fs.read', (_$, e) => (opts.faults?.read?.(abs(e.path)) ? (() => { throw new Error('EIO read') })() : 0, { value: files[inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`] ?? '' }))
  on('fs.write', (_$, e) => {
    const path = inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`
    if (opts.faults?.write?.(path, e.text as string)) { throw new Error('EACCES write') }
    files[path] = e.text as string

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return state
}

const toastsOf = (on: On) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(JSON.stringify(e)); return { value: undefined } as never })

  return toasts
}
const openPane = async ($: Ctx) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}
const storeOf = (on: On, seed: [string, unknown][] = []) => {
  const store = new Map<string, unknown>(seed)
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => { store.set(e.key, e.value); return { value: undefined } as never })
  on('session.id', () => ({ value: 'sess-1' }) as never)

  return store
}

// a failed read of one todo file keeps the last good parse, so the orchestrator's claims survive.
// Three states: the first file in the list, the last file in the list, and two failures in a row.
for (const [label, failing, rounds] of [['first file', 'A.md', 1], ['last file', 'C.md', 1], ['two failures in a row', 'A.md', 2]] as const) {
  test(`a failed read of the ${label} keeps the orchestrator claims`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/A.md': '- [~] #T1 Ship the parser', '/repo/.claude_todo/B.md': '- [ ] #T3 Other', '/repo/.claude_todo/C.md': '- [~] #T2 Ship the docs' }
    let fail = false
    repoWith(on, files, { faults: { read: p => fail && p.endsWith(`/${failing}`) }, hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md', '.claude_todo/C.md'] })
    // The orchestrator already claims both in-progress tickets (kept from the store).
    const store = storeOf(on, [['orchestrator:sess-1', [['#t1', true], ['#t2', true]]]])
    const ui = await openPane($)
    await clock.advance(4_000)
    // The claims are stored when the pane draws.
    await ui.drawn()
    // The ticket of the file that will fail: its words are on the drawn board while the read works, and while it fails.
    const ticket = failing === 'A.md' ? 'Ship the parser' : 'Ship the docs'
    const shown = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
    expect(await shown()).toContain(ticket)
    const before = JSON.stringify([['#t1', true], ['#t2', true]])
    expect(JSON.stringify(store.get('orchestrator:sess-1'))).toBe(before)
    for (let i = 0; i < rounds; i += 1) {
      fail = true
      await clock.advance(61_000)
      await ui.drawn()
      // A failed read keeps the last good parse: the file's ticket stays on the board, not dropped as if the file were gone.
      expect(await shown()).toContain(ticket)
    }
    expect(JSON.stringify(store.get('orchestrator:sess-1'))).toBe(before)
    fail = false
    await clock.advance(61_000)
    await ui.drawn()
    expect(JSON.stringify(store.get('orchestrator:sess-1'))).toBe(before)
  })
}

// a manual ticket move that cannot be written or read tells the user why.
for (const [label, key, text, faults] of [
  ['write fails on Start', 'ticket-start-TODO.md-#t1', '- [ ] #T1 Fix the parser', { write: () => true }],
  ['write fails on Done', 'ticket-done-TODO.md-#t1', '- [~] #T1 Fix the parser', { write: () => true }],
  ['read fails on Start', 'ticket-start-TODO.md-#t1', '- [ ] #T1 Fix the parser', { read: () => true }],
] as const) {
  test(`${label}: the ticket button toasts the reason`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': text }
    let isOn = false
    const gated: F = { write: faults.write === undefined ? undefined : p => isOn && faults.write(), read: faults.read === undefined ? undefined : p => isOn && faults.read() }
    repoWith(on, files, { faults: gated, hasNearest: true, listed: ['.claude_todo/TODO.md'] })
    const toasts = toastsOf(on)
    const ui = await openPane($)
    isOn = true
    await ui.press({ key })
    expect(files['/repo/.claude_todo/TODO.md']).toBe(text)
    const joined = toasts.join(' | ')
    expect(joined).toContain('Could not move')
    expect(joined).toContain('Fix the parser')
    expect(joined).toMatch(/Could not move .*Fix the parser: \S/)
  })
}

// Delete empty todos tells the user why when anything throws.
// Three states: one todo file that will not read, another one, and every file. (A throwing folder list is absorbed by the existing mdFiles catch, so it is no failure state.)
for (const [label, faults] of [
  ['file B will not read', { read: (p: string) => p.endsWith('/B.md') }],
  ['file A will not read', { read: (p: string) => p.endsWith('/A.md') }],
  ['every file will not read', { read: () => true }],
] as const) {
  test(`Delete empty todos: ${label}`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/A.md': '- [ ] #T1 a', '/repo/.claude_todo/B.md': '- [ ] #T2 b', '/repo/.claude_todo/E.md': '' }
    let isOn = false
    const gated: F = { read: faults.read === undefined ? undefined : p => isOn && faults.read(p), list: faults.list === undefined ? undefined : p => isOn && faults.list(p) }
    repoWith(on, files, { faults: gated, hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md', '.claude_todo/E.md'] })
    const toasts = toastsOf(on)
    const ui = await openPane($)
    expect(await ui.find({ key: 'todo-delete-empty' })).toBeDefined()
    isOn = true
    await ui.press({ key: 'todo-delete-empty' })
    expect(toasts.join(' | ')).toMatch(/Could not delete empty todos: \S/)
  })
}

// move_ticket, approved and then the file will not read, says the read failed, not that the line is gone.
// Three states: to done, to in progress, back to open.
for (const [to, text] of [['done', '- [ ] #T1 Fix the parser'], ['in_progress', '- [ ] #T1 Fix the parser'], ['open', '- [~] #T1 Fix the parser']] as const) {
  test(`move_ticket to ${to}: a failed read is not "line not found"`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': text }
    let fail = false
    repoWith(on, files, { faults: { read: () => fail }, hasNearest: true, listed: ['.claude_todo/TODO.md'] })
    on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
      const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
      fail = true

      return { result: { questions: [], answers: { [question]: 'Move it' } } } as never
    })
    await openPane($)
    const out = JSON.stringify(await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to, reason: 'r' } as never))
    expect(out).toContain('could not be read')
    expect(out).toMatch(/could not be read \(\S/)
    expect(out).not.toContain('was not found')
    expect(files['/repo/.claude_todo/TODO.md']).toBe(text)
  })
}
}
