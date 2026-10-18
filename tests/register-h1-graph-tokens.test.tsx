// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import type { Series } from '../hooks/series'

// Batch H1 (UCR loop 1 tail): graph, tokens, terminal text.
{
const h1FromPs = (script: string) => String.fromCodePoint(...(/\[char\[\]\]\(([\d,]+)\)/.exec(script)![1]!.split(',').map(Number))).replace(/\\/g, '/')

/**
 * A fake repo (at `/repo` unless `root` says) with the given files by absolute path; `hasNearest` says
 * whether the session folder has its own `.claude_todo`; `rev` is what `git rev-parse` answers;
 * `links` maps a path to the real path the fake stat gives it (a symlink). `uname` is what `uname -s`
 * answers; a trash command named in `failing` exits 1, and one named in `stays` exits 0 but leaves the
 * file. Any other trash command removes the file from `files`, as the real one would.
 */
function h1RepoWith(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string>; uname?: string; failing?: string[]; stays?: string[]; exits?: Record<string, number>; log?: string[]; dangling?: string[]; hold?: Promise<void> }) {
  const R = opts.root ?? '/repo'
  const state = { hasNearest: opts.hasNearest, listed: opts.listed }
  const writes: string[] = []
  const calls: string[] = []
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
        return dirEmpty(h1FromPs(script)) ? out('') : fail
      }
      if (opts.failing?.includes(argv[0]!)) {
        return fail
      }
      const path =
        argv[0] === 'osascript' ? /POSIX file "(.*)"$/.exec(script)![1]!.replace(/\\(.)/g, '$1')
        : argv[0] === 'powershell.exe' ? h1FromPs(script)
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
    // A held write: the test presses a button while this write is in flight.
    if (opts.hold !== undefined && e.text !== '') {
      await opts.hold
    }
    files[path] = e.text as string
    stamp += 1
    // The mod makes an empty archive/TODO.md for the Show completed link: not one of the writes a test counts.
    if (!(path.endsWith('/archive/TODO.md') && e.text === '')) {
      writes.push(path)
    }

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { state, writes, calls }
}

// ---------------------------------------------------------------- UCR-110, UCR-084 B2: the per-step count and the series seed

const H1_PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 120, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
const H1_SID = 'sess-1'
const h1Used = (n: number) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: n, cache_creation_input_tokens: 0, model: 'm' })
type H1Used = ReturnType<typeof h1Used>

/** A fake engine with a store, and a model step whose stop chunk, result and break the test plans. */
function h1Engine($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], store: Map<string, unknown>) {
  const clock = mock.clock(on)
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: H1_SID }) as never)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  let plan: { stop?: H1Used; result?: H1Used; throwAfterStop?: boolean } = {}
  on('turn.step', async function* (_$, e) {
    if (plan.stop !== undefined) {
      yield { kind: 'stop', stopReason: 'tool_use', usage: plan.stop } as never
    }
    if (plan.throwAfterStop) {
      throw new Error('stream broke')
    }

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', ...(plan.result === undefined ? {} : { usage: plan.result }) } as never
  })
  /** Runs one step; returns the error the caller saw, if any. */
  const step = async (next: typeof plan, agentId?: string): Promise<string | undefined> => {
    plan = next
    try {
      for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) } as never)) {
        // drain
      }
    } catch (error) {
      return String(error)
    }

    return undefined
  }
  const total = () => (store.get(`tokens:${H1_SID}`) as { tokens: number } | undefined)?.tokens ?? 0

  return { clock, step, total }
}

test('UCR-110 a step result of all zeros does not hide its stop chunk, and a stream that breaks after its stop chunk still counts it', async ($, on) => {
  const store = new Map<string, unknown>()
  const { step, total } = h1Engine($, on, store)
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  const added = async (plan: Parameters<typeof step>[0], agentId?: string) => {
    const before = total()
    const error = await step(plan, agentId)

    return { n: total() - before, error }
  }
  // The defect states: a zero result over a stop chunk (main loop and agent), and a break after the stop chunk.
  expect((await added({ stop: h1Used(5000), result: h1Used(0) })).n).toBe(5000)
  expect((await added({ stop: h1Used(4000), result: h1Used(0) }, 'a1')).n).toBe(4000)
  const broke = await added({ stop: h1Used(7000), throwAfterStop: true })
  expect(broke.n).toBe(7000)
  // The break still reaches the caller (the engine reports it as the chain's error).
  expect(broke.error).toBeDefined()
  // Unchanged: a result with usage wins over the stop chunk (one request, never both), a stop chunk alone counts, no usage adds 0.
  expect((await added({ stop: h1Used(1000), result: h1Used(1200) }, 'a1')).n).toBe(1200)
  expect((await added({ stop: h1Used(3000) })).n).toBe(3000)
  expect((await added({})).n).toBe(0)
  // A break before any stop chunk counts nothing.
  expect((await added({ throwAfterStop: true })).n).toBe(0)
})

test('UCR-084 B2 a reload with the kept series behind the kept count ends the trace at the count, with no false tokens-per-minute spike', async ($, on) => {
  const now = 100 * 60_000
  // The count says 1.00M since the compaction; the series, stored only at a redraw, ends at 900k.
  const store = new Map<string, unknown>([
    [`tokens:${H1_SID}`, { tokens: 2_000_000, since: 0, atCompact: 1_000_000 }],
    [`series:${H1_SID}`, { agents: [], tokens: [[now - 120_000, 900_000]], compacts: [] }],
  ])
  const { clock, step } = h1Engine($, on, store)
  await clock.advance(now)
  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve()
  }
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...H1_PANE })
  const hero = async () => (((await ui.findAll({ type: 'Svg' })) as { props?: { source?: string } }[])[0]?.props?.source ?? '')
  const label = (source: string, cls: string) => [...source.matchAll(new RegExp(`class="${cls}" font-weight="600">([^<]+)<`, 'g'))].map(m => m[1]).join(',')
  const first = await hero()
  expect(label(first, 'ft')).toBe('1.00M')
  expect(label(first, 'fr')).toBe('0')
  await step({ result: h1Used(1_000) })
  await clock.advance(31_000)
  const second = await hero()
  expect(label(second, 'ft')).toBe('1.00M')
  // The 100k of the gap is no usage: the minute holds the 1k step alone (it read 101.0k/min).
  expect(label(second, 'fr')).toBe('1.0k')
  // The seed is stored with the series, so the next reload counts it as no usage too.
  expect((store.get(`series:${H1_SID}`) as Series).seeds?.length).toBe(1)
})

// ---------------------------------------------------------------- UCR-038: control characters on the terminal surface


const H1_TERM = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

// Each control character the verifier found, in each place it reaches a terminal Text: a ticket, a
// todo file name and a Bash command (the defect behind a valid first case: "_" draws; the limits of
// C0, DEL and C1: \x01, \x1B, \x7F, \x85, \x9B).
for (const bad of ['\x01', '\x07', '\x0B', '\x1B', '\x7F', '\x85', '\x9B']) {
  for (const where of ['ticket', 'file', 'bash'] as const) {
    test(`UCR-038 the terminal pane draws with ${JSON.stringify(bad)} in a ${where}`, async ($, on) => {
      mock.clock(on)
      const name = where === 'file' ? `OPEN${bad}.md` : 'OPEN.md'
      const files: Record<string, string> = { [`/repo/.claude_todo/${name}`]: `- [~] #T1 Ship${where === 'ticket' ? bad : ' '}the parser\n- [ ] #T2 Review copy` }
      h1RepoWith(on, files, { hasNearest: true, listed: [`.claude_todo/${name}`] })
      on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
      await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
      await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 0, total: 1, items: ['#T1'] } as never).catch(() => undefined)
      if (where === 'bash') {
        await $.tool.call({ tool: 'Bash', command: `echo a${bad}b` } as never).catch(() => undefined)
      }
      const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...H1_TERM })
      const text = JSON.stringify(await ui.findAll({ type: 'Text' }))
      // The words are there, with the control character made a space.
      expect(text).toContain(where === 'file' ? 'OPEN .md' : 'Ship the parser')
      // No control character is left: JSON writes a C0 one as \u00XX, and leaves DEL and C1 as they are.
      expect(/\\u00[01][0-9a-f]/i.test(text) || /[\x7f-\x9f]/.test(text)).toBe(false)
    })
  }
}
}
