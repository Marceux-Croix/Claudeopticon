// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { psPath } from '../hooks/path-forms'
import { parseTodo } from '../hooks/todo-markdown'

// ---------------------------------------------------------------- batch K3: UCR-170, 176, 025, 127, 128 remainders (verify J3/J4 probes)
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
    // The archive move needs a store that works (UCR-031: no record, no move); a test with a store of its own passes `store: false`.
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

      // UCR-150 (batch K1): the engine hands `.` over as its own folder, outside the fake repo; that session folder is the repo root.
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
      // Every write counts, the empty archive file that Show completed makes too (UCR-069): a test
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


  // UCR-170 remainder (VJ-170N, VJ-170F): a name with a line break never reaches a `## From` heading.
  /** The items of a todo text, as text. */
  const itemTexts = (text: string) => parseTodo(text).map(item => item.text)

  /** Property: a source whose file or folder name holds a line break or a control character is not copied and not emptied, with a toast. */
  test('UCR-170 VJ-170N a source file name with a line break is refused; a sound source of the same press moves', async ($, on) => {
    mock.clock(on)
    const name = 'a\n- [ ] #T5 Ghost\n<!--.md'
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', '/repo/mods/w/.claude_todo/TODO.md': '- [ ] #T3 Good', [`/repo/mods/x/.claude_todo/${name}`]: '- [ ] #T2 Docs' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/w/.claude_todo/TODO.md', `mods/x/.claude_todo/${name}`] })
    const toasts = toastsOf(on)
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    const target = files['/repo/.claude_todo/TODO.md']!
    // The valid first case moves; the bad name adds no item and opens no comment.
    expect(itemTexts(target)).toEqual(['#T1 Fix', '#T3 Good'])
    expect(target).not.toContain('Ghost')
    expect(files['/repo/mods/w/.claude_todo/TODO.md']).toBe('')
    expect(files[`/repo/mods/x/.claude_todo/${name}`]).toBe('- [ ] #T2 Docs')
    expect(toasts.some(one => one.includes('the name holds a line break, a control character or a format character'))).toBe(true)
  })

  test('UCR-170 VJ-170F a source folder name with a line break is refused', async ($, on) => {
    mock.clock(on)
    const dir = 'mods/y\n- [ ] #T5 Ghost\n<!--'
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', [`/repo/${dir}/.claude_todo/TODO.md`]: '- [ ] #T2 Docs' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', `${dir}/.claude_todo/TODO.md`] })
    const toasts = toastsOf(on)
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix')
    expect(files[`/repo/${dir}/.claude_todo/TODO.md`]).toBe('- [ ] #T2 Docs')
    expect(toasts.some(one => one.includes('the name holds a line break, a control character or a format character'))).toBe(true)
    expect(toasts.some(one => one.includes('Moved 1 file'))).toBe(false)
  })

  test('UCR-170 a central file merged into the target, and a name with a Unicode line separator, are refused too', async ($, on) => {
    mock.clock(on)
    // The excluded population of the source check: the central folder's own other files; and a separator that is no \n.
    const central = 'B\r- [ ] #T7 Ghost.md'
    const sep = 'c - [ ] #T8 Ghost.md'
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', [`/repo/.claude_todo/${central}`]: '- [ ] #T2 Docs', [`/repo/mods/z/.claude_todo/${sep}`]: '- [ ] #T3 More' }
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', `.claude_todo/${central}`, `mods/z/.claude_todo/${sep}`] })
    const toasts = toastsOf(on)
    const ui = await open($)
    await ui.press({ key: 'todo-consolidate' })
    expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix')
    expect(files[`/repo/.claude_todo/${central}`]).toBe('- [ ] #T2 Docs')
    expect(files[`/repo/mods/z/.claude_todo/${sep}`]).toBe('- [ ] #T3 More')
    expect(toasts.filter(one => one.includes('the name holds a line break, a control character or a format character')).length).toBe(1)
  })

  // UCR-176 remainder (VJ-176b): the ID-claim and git process calls under the writer lock are bounded.
  /** Property: a claim mkdir that never returns frees the writer lock within the time limit, with one toast, and a later Start press writes. */
  test('UCR-176 VJ-176b an ID-claim mkdir that never returns frees the lock: a Start press writes, one toast', { timeoutMs: 120_000 } as never, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] Fix the lexer\n- [ ] #T2 Docs' }
    const { calls } = repoWith(on, files, { hasNearest: true, hang: ['mkdir'], listed: ['.claude_todo/TODO.md'] })
    const toasts = toastsOf(on)
    const ui = await open($)
    for (let s = 0; s < 15; s += 1) {
      await clock.advance(1000)
    }
    // The press queues its write behind the writer lock that the claim holds: the clock runs until the write lands.
    await ui.press({ key: 'ticket-start-TODO.md-#t2' })
    const isWritten = () => files['/repo/.claude_todo/TODO.md']!.includes('- [~] #T2 Docs')
    let waited = 0
    for (; waited < 120 && !isWritten(); waited += 1) {
      await clock.advance(1000)
    }
    expect(isWritten()).toBe(true)
    // Within the claim's time limits (two folders, 20 s each), not after the 120 s the test allows.
    expect(waited).toBeLessThan(60)
    // No ID was given from a claim that did not finish.
    expect(files['/repo/.claude_todo/TODO.md']).toContain('- [ ] Fix the lexer')
    expect(calls.filter(one => one.startsWith('mkdir')).length).toBeGreaterThan(0)
    expect(toasts.filter(one => one.includes('stopped waiting for') && one.includes('mkdir')).length).toBe(1)
  })

  test('UCR-176 a git rev-parse that never returns ends discovery as a failure, with one toast', { timeoutMs: 120_000 } as never, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix' }
    let isHung = true
    const toasts = toastsOf(on)
    // rev-parse hangs while `isHung`; every other call is the shared fake's.
    repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], hangWhen: argv => isHung && argv[1] === 'rev-parse' })
    // The discovery runs while the pane opens: the clock runs while it waits.
    let isOpen = false
    const opening = open($).then(ui => {
      isOpen = true

      return ui
    })
    for (let s = 0; s < 30 && !isOpen; s += 1) {
      await clock.advance(1000)
    }
    expect(isOpen).toBe(true)
    const ui = await opening
    isHung = false
    await ui.press({ key: 'ticket-start-TODO.md-#t1' })
    const isAnswered = () => toasts.some(one => one.includes('#T1 Fix'))
    for (let s = 0; s < 60 && !isAnswered(); s += 1) {
      await clock.advance(1000)
    }
    // Discovery fell back to the session folder alone, as when git fails, and the press got its answer under the
    // lock (this fake's folder is not trusted without git, so the answer is a refusal; the old code never answered).
    expect(isAnswered()).toBe(true)
    expect(toasts.filter(one => one.includes('stopped waiting for') && one.includes('git rev-parse')).length).toBe(1)
  })

  // UCR-025 remainder (VJ-025a, VJ-025b): a stale press never writes another section's identical line.
  for (const [label, before, after] of [
    ['VJ-025a the same heading text', '## Tasks\n- [ ] Write tests\n  - note: jest\n## Tasks\n- [ ] Write tests\n  - note: pytest', '## Tasks\n## Tasks\n- [ ] Write tests\n  - note: pytest'],
    ['VJ-025b sections marked by prose lines', 'Frontend:\n- [ ] Write tests\nBackend:\n- [ ] Write tests', 'Frontend:\nBackend:\n- [ ] Write tests'],
  ] as const) {
    /** Property: a press from a board drawn before the first of two identical lines went is refused, with a toast. */
    test(`UCR-025 ${label}: a stale press is refused`, async ($, on) => {
      mock.clock(on)
      const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': before }
      repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
      const toasts = toastsOf(on)
      const ui = await open($)
      files['/repo/.claude_todo/TODO.md'] = after
      await ui.press({ key: 'ticket-start-TODO.md-write tests' }).catch(() => undefined)
      expect(files['/repo/.claude_todo/TODO.md']).toBe(after)
      expect(toasts.some(one => one.includes('Marked in progress'))).toBe(false)
      expect(toasts.some(one => one.includes('since the board drew it'))).toBe(true)
    })
  }

  // UCR-127 remainder (VJ-127): a folder left out of discovery keeps its book keys.
  const OTHER_KEY = 'mods/x/.claude_todo::#t2'
  for (const variant of ['control', 'git-fails', 'other-is-link', 'other-exists-fails'] as const) {
    /** Property: a book write drops a key only when its folder read and does not hold it; a folder this discovery left out keeps its keys. */
    test(`UCR-127 VJ-127 ${variant}: the keys of a folder left out stay; stale keys of folders that read go`, { timeoutMs: 120_000 } as never, async ($, on) => {
      const clock = mock.clock(on)
      const store = new Map<string, unknown>()
      on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
      on('store.set', (_$, e) => {
        store.set(e.key, e.value)

        return { value: undefined } as never
      })
      on('session.id', () => ({ value: 'sess-1' }) as never)
      const BOOK = '/repo/.claude_todo/categories.json'
      const OTHER = '/repo/mods/x/.claude_todo/TODO.md'
      // `#t9` and the `::#t8` key name tickets that are gone from folders that read: they go in every variant but git-fails's other folder.
      const files: Record<string, string> = {
        '/repo/.claude_todo/OPEN.md': '- [ ] #T1 alpha',
        [OTHER]: '- [ ] #T2 beta',
        [BOOK]: JSON.stringify({ categories: ['Work'], items: { '#t1': 'Work', '#t9': 'Work', [OTHER_KEY]: 'Work', 'mods/x/.claude_todo::#t8': 'Work' } }, null, 2),
      }
      const R = '/repo'
      const inside = (p: string) => p === R || p.startsWith(`${R}/`)
      const at = (p: string) => (inside(p) ? p : p.endsWith('.claude_todo') ? `${R}/.claude_todo` : `${R}/.claude_todo/${p.split('/').pop()}`)
      let stamp = 2
      on('process.run', (_$, e) => {
        const argv = (e as unknown as { argv: string[] }).argv
        const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
        if (argv[0] === 'printenv') {
          return argv[1] === 'HOME' ? out('/home/a\n') : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
        }
        if (argv[0] === 'uname') {
          return out('Darwin\n')
        }
        if (variant === 'git-fails' && argv[1] === 'ls-files') {
          return { value: { exitCode: 128, stdout: '', stderr: 'fatal' } } as never
        }

        return argv[1] === 'rev-parse' ? out(`${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : ['.claude_todo/OPEN.md', 'mods/x/.claude_todo/TODO.md'].join('\0'))
      })
      on('fs.exists', (_$, e) => {
        if (variant === 'other-exists-fails' && at(e.path) === '/repo/mods/x/.claude_todo') {
          throw new Error('EIO')
        }

        return { value: e.path.endsWith('.git') || at(e.path) in files || Object.keys(files).some(one => one.startsWith(`${at(e.path)}/`)) }
      })
      on('fs.stat', (_$, e) => {
        if (e.path.startsWith('/home/a')) {
          throw new Error('ENOENT')
        }

        return { value: { kind: at(e.path) in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: !inside(e.path) && !e.path.includes('.claude_todo') && !e.path.includes('.git') ? R : at(e.path) } } as never
      })
      on('fs.list', (_$, e) => {
        const dir = at(e.path)
        const isLinked = (p: string) => variant === 'other-is-link' && p === OTHER

        return { value: Object.keys(files).filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map(p => ({ name: p.slice(dir.length + 1), kind: isLinked(p) ? 'link' : 'file', size: 1, mtimeMs: stamp, isLink: isLinked(p) })) } as never
      })
      on('fs.read', (_$, e) => ({ value: files[at(e.path)] ?? '' }))
      on('fs.write', (_$, e) => {
        files[at(e.path)] = e.text as string
        stamp += 1

        return { value: undefined } as never
      })
      on('agent.list', () => ({ value: [] }))
      on('model.complete', (_$, e) => {
        const n = (e.prompt.match(/^\d+\. /gm) ?? []).length
        const assign = Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), 'Work']))

        return { value: { isAnswered: true, text: JSON.stringify({ categories: ['Work'], assign }), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
      })
      await open($)
      for (let i = 0; i < 6; i += 1) {
        await clock.advance(5000)
      }
      // A new ticket in the primary folder makes the next sort write the book.
      files['/repo/.claude_todo/OPEN.md'] = '- [ ] #T1 alpha\n- [ ] #T3 gamma'
      stamp += 1
      for (let i = 0; i < 40; i += 1) {
        await clock.advance(5000)
      }
      const items = (JSON.parse(files[BOOK]!) as { items: Record<string, string> }).items
      // The book was written (the new ticket is in it), and the other folder's live key stays in every variant.
      expect('#t3' in items).toBe(true)
      expect(OTHER_KEY in items).toBe(true)
      // The primary folder read in every variant: its stale key goes.
      expect('#t9' in items).toBe(false)
      // The other folder's stale key goes only where that folder read whole.
      expect('mods/x/.claude_todo::#t8' in items).toBe(variant !== 'control')
    })
  }

  // UCR-128 remainder: a failed session note waits for its retry time.
  /** Property: after a failed session note, the next try waits SESSION_RETRY_MS (one minute), not the next redraw. */
  test('UCR-128 a failed session note is tried again once a minute, not at every redraw', { timeoutMs: 300_000 } as never, async ($, on) => {
    const clock = mock.clock(on)
    let sets = 0
    let isBroken = true
    const byKey = new Map<string, number>()
    const kept = new Map<string, unknown>()
    on('store.get', (_$, e) => ({ value: kept.get(e.key) }) as never)
    on('store.set', (_$, e) => {
      sets += 1
      const key = String(e.key).split(':')[0]!
      if (isBroken) {
        byKey.set(key, (byKey.get(key) ?? 0) + 1)
        throw new Error('EIO')
      }
      kept.set(e.key, e.value)

      return { value: undefined } as never
    })
    on('session.id', () => ({ value: 'sess-1' }) as never)
    on('fs.exists', () => ({ value: false }))
    on('agent.list', () => ({ value: [] }))
    on('tool.call', () => ({ result: 'ok' }) as never)
    toastsOf(on)
    await open($)
    // 30 minutes of a store that fails, with a redraw every 10 s.
    for (let minute = 1; minute <= 30; minute += 1) {
      for (let s = 0; s < 6; s += 1) {
        await $.tool.call({ tool: 'Bash', command: 'ls', description: `call ${minute}.${s}` } as never)
        await clock.advance(10_000)
      }
    }
    // About one try a minute (30), never one per redraw (180): the old code made 179 in the last 20 minutes alone.
    expect(byKey.get('sessions-recent') ?? 0).toBeLessThanOrEqual(35)
    expect(byKey.get('sessions-recent') ?? 0).toBeGreaterThanOrEqual(20)
    isBroken = false
    for (let s = 0; s < 12; s += 1) {
      await $.tool.call({ tool: 'Bash', command: 'ls', description: `after ${s}` } as never)
      await clock.advance(10_000)
    }
    // Recovered: the note is stored within the retry time.
    expect(kept.has('sessions-recent')).toBe(true)
    void sets
  })
}
