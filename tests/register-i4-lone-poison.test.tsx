// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { KEPT_SESSIONS, readKeptTickets } from '../hooks/kept-records'

// ---------------------------------------------------------------- I4: UCR-074, 015, 122, 123 (ported probes of the H4 verifier)
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Ctx = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Faults = { exists?: (p: string) => boolean; list?: (p: string) => boolean; read?: (p: string) => boolean; write?: (p: string) => boolean; get?: (key: string) => boolean; set?: (key: string) => boolean }
type Listed = { id: string; description: string; type: string; status: string }

/**
 * The fake repo of the G3 block, copied: files by absolute path, a store, a session ID and an agent
 * list, each able to fail. Two more options: `real` gives a path's real path (default: the path),
 * and `badList` makes a folder list answer with no list at all, so the scan pass throws.
 */
function rig(on: On, files: Record<string, string>, opts: { faults?: Faults; session?: string; store?: Map<string, unknown>; agents?: () => Listed[]; listed?: string[]; real?: (path: string) => string; badList?: (path: string) => boolean } = {}) {
  const R = '/repo'
  const store = opts.store ?? new Map<string, unknown>()
  const sets: string[] = []
  const mtimes = new Map<string, number>()
  const bump = (path: string) => mtimes.set(path, (mtimes.get(path) ?? 2) + 1)
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }

    return argv[1] === 'rev-parse' ? out(`${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : (opts.listed ?? ['.claude_todo/TODO.md']).join('\0'))
  })
  const fail = (what: string) => {
    throw new Error(`EIO ${what}`)
  }
  const at = (path: string) => (inside(path) ? path : !path.includes('.claude_todo') && !path.includes('.git') ? R : path.endsWith('.claude_todo') ? `${R}/.claude_todo` : `${R}/.claude_todo/${path.split('/').pop()}`)
  on('fs.exists', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.exists?.(path)) {
      fail('exists')
    }

    return { value: e.path.endsWith('.git') || path in files || Object.keys(files).some(one => one.startsWith(`${path}/`)) }
  })
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/home/a')) {
      throw new Error('ENOENT')
    }
    const path = at(e.path)

    return { value: { kind: path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.real?.(path) ?? path } } as never
  })
  on('fs.list', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.list?.(path)) {
      fail('list')
    }
    if (opts.badList?.(path)) {
      return { value: null } as never
    }

    return { value: names(path).map(name => ({ name, kind: 'file', size: 1, mtimeMs: mtimes.get(`${path}/${name}`) ?? 2, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.read?.(path)) {
      fail('read')
    }

    return { value: files[path] ?? '' }
  })
  on('fs.write', (_$, e) => {
    const path = at(e.path)
    if (opts.faults?.write?.(path)) {
      fail('write')
    }
    files[path] = e.text as string
    bump(path)

    return { value: undefined } as never
  })
  on('store.get', (_$, e) => (opts.faults?.get?.(e.key) ? fail('store') : 0, { value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    if (opts.faults?.set?.(e.key)) {
      fail('store')
    }
    store.set(e.key, e.value)
    sets.push(e.key)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: opts.session ?? 'sess-1' }) as never)
  on('agent.list', () => ({ value: opts.agents?.() ?? [] }))
  on('command.register', () => ({ value: undefined }) as never)

  return { store, sets, bump }
}

const openPane = async ($: Ctx) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}
const TODO = '/repo/.claude_todo/TODO.md'
const ARCHIVE = '/repo/.claude_todo/archive/TODO.md'
const RECORD = `archive-wrote:${ARCHIVE}`
const BOOK = '/repo/.claude_todo/categories.json'
const OTHER = '/repo/mods/x/.claude_todo'
const DONE = '- [x] #T1 Done parser\n  note under it'
const BLOCK = ['- [x] #T1 Done parser', '  note under it']
const LIVE: Listed = { id: 'a1', description: 'Long work', type: 'engineer', status: 'running' }
const turnOf = ($: Ctx, agentId: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t-${agentId}`, agentId } as never).catch(() => undefined)
const bookItems = (files: Record<string, string>) => (files[BOOK] === undefined ? {} : (JSON.parse(files[BOOK]!) as { items: Record<string, string> }).items)

/** A model that answers `reply(prompt)` and records every prompt. */
function fakeModel(on: On, reply: (prompt: string) => string) {
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)

    return { value: { isAnswered: true, text: reply(e.prompt), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })

  return prompts
}
const numbers = (prompt: string) => [...prompt.matchAll(/^(\d+)\. /gm)].map(match => match[1]!)
const assignAll = (name: string) => (prompt: string) => JSON.stringify({ categories: [name], assign: Object.fromEntries(numbers(prompt).map(n => [n, name])) })


/** A model with full control: 'empty' = isAnswered false, 'throw' = call fails, else text. */
function rawModel(on: On, reply: (prompt: string) => string) {
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    const out = reply(e.prompt)
    // Batch J4: 'throw' is a transport failure as the engine gives it (an unanswered api-error with no status), which only
    // waits (UCR-074). A real throw, or an HTTP 4xx, may be the items' fault and halves after two (see the J4 block).
    if (out === 'throw') { return { value: { isAnswered: false, reason: 'api-error', status: null, error: 'network', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never }
    if (out === 'empty') { return { value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never }
    return { value: { isAnswered: true, text: out, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  return prompts
}

// UCR-143 (loop 3): 300 s per test, half the 600 s per-file kill, so a hung test fails as itself
// and the other tests of the file still report; three times the slowest measured run (90 s, in a
// full suite at load 10). A larger clock step does not make these cheaper: the mod's 1 s ticker
// fires once per simulated second however the clock is moved (growth test: 81.4 s at 10 s steps,
// 81.0 s at 60 s steps, 72.8 s with clock.set jumps, 5.2 s with a 60 s tick). Typed, no cast (UCR-247).
const T = { timeoutMs: 300_000 }
const claimsOf = (store: Map<string, unknown>) => readKeptTickets(store.get('orchestrator:sess-1')).map(([key]) => key)
const rowsOf = (store: Map<string, unknown>) => (store.get('agents:sess-1') as { id: string; status: string }[] | undefined) ?? []
const sixtyOne = (poisonAt: number) => Array.from({ length: 61 }, (_, i) => `- [ ] #T${i + 1} ${i === poisonAt ? 'poison item' : `item ${i + 1}`}`).join('\n')

/**
 * Property (UCR-074): a lone poison item that failed alone SORT_TRIES times is not sent again in
 * the session, and one toast says so. Three states: an empty reply, an unparsable reply, and (the
 * excluded population) a failed call, which never counts against the item.
 */
for (const [label, kind, isGivenUp] of [['empty reply', 'empty', true], ['unparsable reply', 'garbage', true], ['failed call', 'throw', false]] as const) {
  test(`UCR-074 a lone poison item with a ${label} ${isGivenUp ? 'is given up after SORT_TRIES calls, with one toast' : 'is retried and never given up'}`, T, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { [TODO]: '- [ ] #T1 poison item' }
    rig(on, files)
    const toasts: string[] = []
    on('ui.toast', (_$, e) => {
      toasts.push(JSON.stringify(e))

      return { value: undefined } as never
    })
    const prompts = rawModel(on, () => kind)
    await openPane($)
    for (let i = 0; i < 8640; i += 1) {
      await clock.advance(10_000)
    }
    if (isGivenUp) {
      expect(prompts.length).toBe(2)
      expect(toasts.filter(one => one.includes('Not sorted')).length).toBe(1)
    } else {
      expect(prompts.length).toBeGreaterThan(20)
      expect(toasts.filter(one => one.includes('Not sorted')).length).toBe(0)
    }
  })
}
}
