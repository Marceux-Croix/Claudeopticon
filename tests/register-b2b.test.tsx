// Engine cases through the fake engine: Consolidate, numbering, the waiting renumbering notes and Delete duplicate tickets.
// One responsibility, the end-to-end cases of the consolidate-and-numbering fixes named by the comments below.

import { expect, mock, test } from 'claude-code/testing'

import { parseTodo } from '../hooks/todo-markdown'

// ---------------------------------------------------------------- consolidate, numbering, notes
{
  const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

  /** The path a PowerShell script names through `psPath`, with forward slashes. */
  const fromPs = (script: string) => String.fromCodePoint(...(/\[char\[\]\]\(([\d,]+)\)/.exec(script)![1]!.split(',').map(Number))).replace(/\\/g, '/')

  /**
   * A fake repo (at `/repo` unless `root` says) with the given files by absolute path; `hasNearest` says
   * whether the session folder has its own `.claude_todo`; `rev` is what `git rev-parse` answers;
   * `links` maps a path to the real path the fake stat gives it (a symlink). `uname` is what `uname -s`
   * answers; a trash command named in `failing` exits 1, and one named in `stays` exits 0 but leaves the
   * file. Any other trash command removes the file from `files`, as the real one would.
   */
  function repoWith(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string>; uname?: string; failing?: string[]; stays?: string[]; exits?: Record<string, number>; log?: string[]; dangling?: string[]; hold?: Promise<void>; store?: false; hang?: string[]; hangWhen?: (argv: string[]) => boolean }) {
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
      if (opts.hang?.includes(argv[0]!) || opts.hangWhen?.(argv) === true) {
        return new Promise(() => undefined) as never
      }
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
    on('fs.exists', (_$, e) => (opts.log?.push(`exists:${abs(e.path)}`), { value: abs(e.path).endsWith('.git') || (abs(e.path).endsWith('.claude_todo') && !inside(abs(e.path)) && state.hasNearest) || (inside(abs(e.path)) && (abs(e.path) in files || Object.keys(files).some(path => path.startsWith(`${abs(e.path)}/`)))) }) as never)
    on('fs.stat', (_$, e) => {
      // The home folder is outside the fake repo and does not exist there.
      if (abs(e.path).startsWith('/home/a/.claude') && !inside(abs(e.path))) {
        throw new Error('ENOENT')
      }

      // the engine hands `.` over as its own folder, outside the fake repo; that session folder is the repo root.
      return (opts.log?.push(`stat:${abs(e.path)}`), { value: { kind: abs(e.path) in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.links?.[abs(e.path)] ?? (inside(abs(e.path)) ? abs(e.path) : !abs(e.path).includes('.claude_todo') && !abs(e.path).includes('.git') ? R : `${R}/.claude_todo`) } }) as never
    })
    on('fs.list', (_$, e) => ({ value: [...(inside(abs(e.path)) ? names(abs(e.path)) : state.hasNearest ? names(`${R}/.claude_todo`) : []), ...(opts.dangling ?? []).filter(path => path.slice(0, path.lastIndexOf('/')) === abs(e.path)).map(path => path.slice(path.lastIndexOf('/') + 1))].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2 + stamp, isLink: false })) }))
    on('fs.read', (_$, e) => (opts.log?.push(`read:${abs(e.path)}`), { value: files[inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`] ?? '' }))
    on('fs.write', async (_$, e) => {
      const path = inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`
      opts.log?.push(`write:${path}`)
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



  /** A store in memory; `get` may answer something other than the map (another session's write between two reads). */
  function memStore(on: Parameters<Parameters<typeof test>[1]>[1], initial: Record<string, unknown> = {}, get?: (key: string, n: number) => unknown) {
    const kept = new Map<string, unknown>(Object.entries(initial))
    const reads = new Map<string, number>()
    on('store.get', (_$, e) => {
      reads.set(e.key, (reads.get(e.key) ?? 0) + 1)

      return { value: get?.(e.key, reads.get(e.key)!) ?? kept.get(e.key) } as never
    })
    on('store.set', (_$, e) => {
      kept.set(e.key, e.value)

      return { value: undefined } as never
    })
    on('session.id', () => ({ value: 'sess-1' }) as never)

    return kept
  }
  const MARKS = 'consolidate-marks:/repo/.claude_todo'
  const other = { heading: 'mods/z/.claude_todo/TODO.md', lines: ['- [ ] #T9 Other'], sectionsBefore: 0, told: [], isTold: false }

  /** Property: a mark another session stored while this press ran is still in the store after the press saves its own. */
  test('saveMarks keeps a mark another session stored since the last read', async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', '/repo/mods/w/.claude_todo/TODO.md': '- [ ] #T3 Good' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/w/.claude_todo/TODO.md'], store: false })
    // The first read finds no marks; from the second on another session's mark is there.
    const kept = memStore(on, {}, (key, n) => (key === MARKS && n > 1 ? { '/repo/mods/z/.claude_todo/TODO.md': other } : undefined))
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    expect(files['/repo/mods/w/.claude_todo/TODO.md']).toBe('')
    expect(Object.keys(kept.get(MARKS) as object)).toContain('/repo/mods/z/.claude_todo/TODO.md')
  })

  /** Property: one unreadable file in a source folder leaves the marks of that folder's healthy files in the store. */
  test('an unreadable file does not drop the mark of a healthy sibling', async ($, on) => {
    mock.clock(on)
    const sibling = '/repo/mods/w/.claude_todo/A.md'
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', [sibling]: '- [ ] #T9 Other', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Good' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/w/.claude_todo/A.md', 'mods/x/.claude_todo/TODO.md'], dangling: ['/repo/mods/w/.claude_todo/B.md'], store: false })
    const kept = memStore(on, { [MARKS]: { [sibling]: other } })
    const toasts = toastsOf(on)
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    // The healthy folder of the same press moved; the folder with the unreadable file stayed whole, mark included.
    expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('')
    expect(files[sibling]).toBe('- [ ] #T9 Other')
    expect(toasts.some(one => one.includes('Not read, left as they are'))).toBe(true)
    expect(Object.keys(kept.get(MARKS) as object)).toContain(sibling)
  })

  /** Property: a press with more clashing IDs than one pick can give still renumbers them all. */
  test('600 clashing IDs are renumbered in one press', { timeoutMs: 120_000 } as never, async ($, on) => {
    mock.clock(on)
    const ids = Array.from({ length: 600 }, (_, at) => `T${(at + 1).toString(36).toUpperCase().padStart(4, '0')}`)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': ids.map(id => `- [ ] #${id} central ${id}`).join('\n'), '/repo/mods/w/.claude_todo/TODO.md': ids.map(id => `- [ ] #${id} source ${id}`).join('\n') }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/w/.claude_todo/TODO.md'] })
    const toasts = toastsOf(on)
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    const items = parseTodo(files['/repo/.claude_todo/TODO.md']!)
    expect(files['/repo/mods/w/.claude_todo/TODO.md']).toBe('')
    expect(items.length).toBe(1200)
    expect(new Set(items.map(item => item.id?.toLowerCase())).size).toBe(1200)
    expect(toasts.some(one => one.includes('could not be claimed'))).toBe(false)
  })

  /** Property: one press gives one toast, holding every refusal and the result. */
  test('a press with three refusals shows one toast', async ($, on) => {
    mock.clock(on)
    const name = 'a\n- [ ] #T5 Ghost\n<!--.md'
    const files: Record<string, string> = {
      '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
      '/repo/mods/w/.claude_todo/TODO.md': '- [ ] #T3 Good',
      [`/repo/mods/x/.claude_todo/${name}`]: '- [ ] #T2 Docs',
      '/repo/mods/y/.claude_todo/TODO.md': '```\n- [ ] #T4 open',
    }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/w/.claude_todo/TODO.md', `mods/x/.claude_todo/${name}`, 'mods/y/.claude_todo/TODO.md'], dangling: ['/repo/mods/z/.claude_todo/B.md'] })
    const toasts = toastsOf(on)
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    const press = toasts.filter(one => one.includes('Not copied') || one.includes('Moved'))
    expect(press.length).toBe(1)
    expect(press[0]).toContain('the name holds a line break')
    expect(press[0]).toContain('ends inside an unclosed code block')
    expect(press[0]).toContain('Moved 1 file')
  })

  /** Property: the renumbering notes a reload interrupted are told with the next prompt. */
  test('a stored renumbering note is told after a reload', async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T0009 Fix' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], store: false })
    const kept = memStore(on, { 'told-notes:sess-1': { renames: ['- mods/w: #T7 is now #T0009'], numbered: [], removed: [] } })
    let context: readonly string[] = []
    on('prompt.submit', (_$, e) => {
      context = e.context ?? []

      return { text: e.text, context: e.context }
    })
    await open($)
    await $.prompt.submit({ text: 'go' } as never)
    expect(context.join('\n')).toContain('#T7 is now #T0009')
    // Told once: the store no longer holds it.
    expect((kept.get('told-notes:sess-1') as { renames: string[] }).renames).toEqual([])
  })

  /** Property: a failed reference fix in a central archive file is tried again by the next press, which needs no duplicate. */
  test('Delete duplicate tickets tries a failed archive reference fix again', async ($, on) => {
    mock.clock(on)
    const archive = '/repo/.claude_todo/archive/TODO.md'
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser\n- [ ] #T2 Fix the parser', [archive]: '- [x] #T3 Done, after #T2' }
    // The archive file is a link out of the repo at first: not safe to change.
    const links: Record<string, string> = { [archive]: '/elsewhere/TODO.md' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/TODO.md'], links })
    const toasts = toastsOf(on)
    const ui = await open($)
    await ui.press({ key: 'todo-delete-dup-tickets' })
    expect(toasts.some(one => one.includes('References not fixed'))).toBe(true)
    expect(files[archive]).toBe('- [x] #T3 Done, after #T2')
    delete links[archive]
    // No duplicate is left, yet the button is still there and the press fixes the references.
    await ui.press({ key: 'todo-delete-dup-tickets' })
    expect(files[archive]).toBe('- [x] #T3 Done, after #T1')
  })

  /** Property: numbering reads the disk's IDs once per pass, so the reads of one file do not grow with the number of files that need numbers. */
  test('numbering reads each todo file a bounded number of times however many files need numbers', async ($, on) => {
    const clock = mock.clock(on)
    const count = 16
    const files: Record<string, string> = {}
    const listed: string[] = []
    for (let at = 0; at < count; at += 1) {
      files[`/repo/.claude_todo/F${at}.md`] = '- [ ] needs a number'
      listed.push(`.claude_todo/F${at}.md`)
    }
    const log: string[] = []
    repoWith(on, files, { hasNearest: true, listed, log })
    await open($)
    for (let s = 0; s < 40; s += 1) {
      await clock.advance(1000)
    }
    expect(Object.values(files).filter(text => /#T[0-9A-Z]{4}/.test(text)).length).toBe(count)
    const reads = log.filter(line => line === 'read:/repo/.claude_todo/F0.md').length
    // The scans read each file about once per pass; a disk read for every file adds one read of F0 per file on top of that.
    expect(reads).toBeLessThan(count * 2 - 2)
  })
}
