// The archive move tells the user about a cause that lasts (a symlinked archive, a write that always fails,
// a write that does not show on the disk), once per cause, and a failed archive write leaves no record that
// hides a later equal ticket. Engine cases through the fake engine, one fake disk per case.

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
function repoWith(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string>; uname?: string; failing?: string[]; stays?: string[]; exits?: Record<string, number>; log?: string[]; dangling?: string[]; hold?: Promise<void>; store?: false; hang?: string[]; failOnce?: string[]; failWrite?: (path: string) => boolean; staleRead?: string[]; toasts?: string[] }) {
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
  // A path in `staleRead` always reads as it did at the start: a write that lands is not seen by a read.
  const first: Record<string, string> = Object.fromEntries((opts.staleRead ?? []).map(path => [path, files[path] ?? '']))
  on('fs.read', (_$, e) => (opts.log?.push(`read:${abs(e.path)}`), { value: abs(e.path) in first ? first[abs(e.path)] : (files[inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`] ?? '') }))
  on('ui.toast', (_$, e) => {
    opts.toasts?.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('fs.write', async (_$, e) => {
    const path = inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`
    opts.log?.push(`write:${path}`)
    if (opts.failWrite?.(path) === true) {
      throw new Error('EACCES')
    }
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
const settle = async (clock: ReturnType<typeof mock.clock>) => {
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000).catch(() => undefined)
  }
}

const LIVE = '/repo/.claude_todo/TODO.md'
const ARCHIVE = '/repo/.claude_todo/archive/TODO.md'
const LISTED = ['.claude_todo/TODO.md', '.claude_todo/archive/TODO.md']
const archiveToasts = (toasts: string[]) => toasts.filter(toast => toast.includes('archive'))

// ---------------------------------------------------------------- persistent refusals are told once

/** Property: when a closed ticket cannot be archived for a cause that lasts, the user is told once, naming the archive file, and the ticket stays in the todo file. */
const CAUSES: { name: string; opts: Parameters<typeof repoWith>[2] extends infer O ? Partial<O> : never }[] = [
  { name: 'the archive folder is a symlink', opts: { links: { '/repo/.claude_todo/archive': '/elsewhere/archive' } } },
  { name: 'the archive file is a symlink', opts: { links: { [ARCHIVE]: '/elsewhere/TODO.md' } } },
  { name: 'every write of the archive throws EACCES', opts: { failWrite: path => path === ARCHIVE } },
  { name: 'a write of the archive does not show on the disk', opts: { staleRead: [ARCHIVE] } },
]
for (const cause of CAUSES) {
  test(`the archive move tells once, naming the archive, when ${cause.name}; the ticket stays`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [LIVE]: '## Core\n- [x] #T0001 Done parser\n- [ ] #T0002 Open', [ARCHIVE]: '## Core\n\n- [x] #T0000 Old\n' }
    const toasts: string[] = []
    repoWith(on, files, { hasNearest: true, listed: LISTED, toasts, ...cause.opts } as never)
    await open($)
    await settle(clock)
    await settle(clock)
    expect(archiveToasts(toasts).length).toBe(1)
    expect(archiveToasts(toasts)[0]).toContain('/repo/.claude_todo/archive')
    expect(files[LIVE]).toContain('- [x] #T0001 Done parser')
  })
}

test('the archive move tells nothing when it works, and moves the ticket', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [LIVE]: '## Core\n- [x] #T0001 Done parser\n- [ ] #T0002 Open', [ARCHIVE]: '## Core\n\n- [x] #T0000 Old\n' }
  const toasts: string[] = []
  repoWith(on, files, { hasNearest: true, listed: LISTED, toasts })
  await open($)
  await settle(clock)
  expect(archiveToasts(toasts)).toEqual([])
  expect(files[LIVE]).not.toContain('#T0001')
  expect(files[ARCHIVE]).toContain('#T0001 Done parser')
})

// ---------------------------------------------------------------- a failed archive write leaves no record

/**
 * Property: a ticket whose archive write failed is archived on a later pass, though the archive already
 * holds an equal older ticket under the same heading (a recurring ticket); no entry is lost.
 */
test('a failed archive write does not make the retry skip an equal ticket: both entries are in the archive', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [LIVE]: '## Daily\n- [x] #T0005 Water the plants', [ARCHIVE]: '## Daily\n\n- [x] #T0005 Water the plants\n' }
  repoWith(on, files, { hasNearest: true, listed: LISTED, failOnce: [ARCHIVE] })
  await open($)
  await settle(clock)
  await settle(clock)
  expect(files[LIVE]).not.toContain('#T0005')
  expect((files[ARCHIVE] ?? '').split('#T0005 Water the plants').length - 1).toBe(2)
})
