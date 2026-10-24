// Fault injection of the todo writes (from the R3-G and R3-H runners): each fs
// call (stat, read, write) and each store call of one archive pass, and of one Consolidate press, fails in
// turn; the retries then run with no fault. Engine tests of register.tsx, in a file of their own: the 150
// runs would push register.test.tsx further past the 600 s limit of one test file.

import { expect, mock, test } from 'claude-code/testing'

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


/** A failure injector: every logged fs call (stat, read, write) and every store call counts; call `failAt` throws. */
function injector(on: Parameters<Parameters<typeof test>[1]>[1], failAt: number | undefined) {
  const seq: string[] = []
  const state = { armed: false, n: 0, fired: '' }
  const tick = (label: string) => {
    if (!state.armed) {
      return
    }
    state.n += 1
    seq.push(label)
    if (state.n === failAt) {
      state.fired = label
      throw new Error(`injected at ${label}`)
    }
  }
  const kept = new Map<string, unknown>()
  on('store.get', (_$, e) => {
    tick(`store.get:${String(e.key).split(':')[0]}`)

    return { value: kept.get(e.key) } as never
  })
  on('store.set', (_$, e) => {
    tick(`store.set:${String(e.key).split(':')[0]}${e.value === null ? '=null' : ''}`)
    kept.set(e.key, e.value)

    return { value: undefined } as never
  })
  const log = { push: (...entries: string[]) => (entries.forEach(tick), 0) } as unknown as string[]

  return { seq, state, log }
}

const count = (text: string, part: string) => text.split(part).length - 1

/** Past the calls of one pass (70 since the rollback re-read and mkdir re-check add calls): the run with no fault checks the margin, so a sweep never stops short of the last call. */
const ARCH_N = 90
for (let k = 0; k <= ARCH_N; k += 1) {
  test(`the archive move ends with each block once in the archive and gone from the live file, a failure at call ${k}`, async ($, on) => {
    const clock = mock.clock(on)
    const live = '/repo/.claude_todo/TODO.md'
    const archive = '/repo/.claude_todo/archive/TODO.md'
    const files: Record<string, string> = { [live]: '## Core\n- [x] #T1 Done parser\n  note under it\n- [ ] #T2 Open', [archive]: '## Core\n\n- [x] #T0 Old\n' }
    const inj = injector(on, k === 0 ? undefined : k)
    repoWith(on, files, { hasNearest: true, store: false, log: inj.log, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/TODO.md'] })
    await open($)
    inj.state.armed = true
    await clock.advance(6000).catch(() => undefined)
    if (k === 0) {
      expect(inj.seq.length).toBeLessThan(ARCH_N)
    }
    inj.state.armed = false
    for (let i = 0; i < 4; i += 1) {
      await clock.advance(3000).catch(() => undefined)
    }
    const a = files[archive] ?? ''
    const l = files[live] ?? ''
    const verdict = count(a, '- [x] #T1 Done parser') === 1 && count(a, '  note under it') === 1 && count(l, '#T1') === 0 && a.includes('#T0 Old') && l.includes('- [ ] #T2 Open') ? 'OK' : 'BAD'
    expect(verdict).toBe('OK')
  })
}

/** Past the calls of one press (56 today), checked the same way. */
const CONS_N = 80
for (let k = 0; k <= CONS_N; k += 1) {
  test(`Consolidate ends with one copy of each line and the sources emptied, a failure at call ${k}`, async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = {
      '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
      '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Docs\n- [ ] #T2 Ship, after #T1',
      '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Done in x',
    }
    const inj = injector(on, k === 0 ? undefined : k)
    repoWith(on, files, { hasNearest: true, store: false, log: inj.log, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/.claude_todo/archive/OLD.md'] })
    const ui = await open($)
    inj.state.armed = true
    await ui.press({ key: 'todo-consolidate' }).catch(() => undefined)
    if (k === 0) {
      expect(inj.seq.length).toBeLessThan(CONS_N)
    }
    inj.state.armed = false
    // The retries the toast asks for: the button must be there while work is left.
    for (let i = 0; i < 2; i += 1) {
      const btn = await ui.find({ key: 'todo-consolidate' })
      if (btn !== undefined) {
        await ui.press({ key: 'todo-consolidate' }).catch(() => undefined)
      }
    }
    const all = Object.entries(files).map(([path, text]) => `${path}:\n${text}`).join('\n')
    const t = files['/repo/.claude_todo/TODO.md'] ?? ''
    const docsId = /#(T\w+) Docs/.exec(t)?.[1]
    const isRef = docsId !== undefined && t.includes(`Ship, after #${docsId}`)
    const verdict = count(all, 'Docs') === 1 && count(all, 'Ship') === 1 && count(all, 'Done in x') === 1 && count(all, 'Fix') === 1 && files['/repo/mods/x/.claude_todo/TODO.md'] === '' && files['/repo/mods/x/.claude_todo/archive/OLD.md'] === '' && isRef ? 'OK' : 'BAD'
    expect(verdict).toBe('OK')
  })
}
