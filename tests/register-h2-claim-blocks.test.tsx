// Engine cases through the fake engine, split from register.test.tsx (UCR 143) so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

import { blockIds, CLAIM_MS } from '../hooks/id-blocks'
import { ticketValue } from '../hooks/ticket-ids'

// Hook cases of batch H2 (UCR loop 1, tail): ID block claims (UCR-030, 041), files that never read (UCR-108),
// the cut folders' IDs (UCR-098), Delete duplicate tickets after numbering (UCR-105), the Consolidate record
// (UCR-014, 107), and the read layer (UCR 5c). Fakes of their own, ported from the verifier's G2 probes.
{
const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
type TestApi = Parameters<Parameters<typeof test>[1]>[0]
type OnApi = Parameters<Parameters<typeof test>[1]>[1]

const R = '/repo'
const CLAIMS = `${R}/.git/claudeopticon/id-claims`
const T = `${R}/.claude_todo/TODO.md`
const Y = `${R}/mods/y/.claude_todo/TODO.md`
const Y_LISTED = ['.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md']

type H2Opts = {
  listed: string[]
  /** The claim entries by path, with the clock ms each was made: shared with "another session". */
  claims?: Map<string, number>
  /** Runs right before a claim `mkdir`: another session may claim first. */
  beforeClaim?: (path: string) => void
  /** `claim`: every claim mkdir exits 1 with nothing made; `base`: the claim folder cannot be made. */
  mkdirFails?: 'claim' | 'base'
  fault?: (path: string, text: string) => void
  readHook?: (path: string) => void
  now?: () => number
}

/**
 * A fake repo at `/repo` with the given files by absolute path. `mkdir` makes claim entries in `claims`
 * atomically, as the OS does: one that is there already exits 1. Writes are kept in `writes`.
 */
function h2Repo(on: OnApi, files: Record<string, string>, opts: H2Opts) {
  const claims = opts.claims ?? new Map<string, number>()
  const writes: string[] = []
  const calls: string[] = []
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => [...new Set(Object.keys(files).filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0]!))]
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (argv[0] === 'printenv') {
      return argv[1] === 'HOME' ? out('/home/a\n') : out('', 1)
    }
    if (argv[0] === 'uname') {
      return out('Darwin\n')
    }
    if (argv[0] === 'mkdir') {
      if (argv[1] === '-p') {
        return out('', opts.mkdirFails === 'base' ? 1 : 0)
      }
      const path = argv[argv.length - 1]!
      opts.beforeClaim?.(path)
      if (opts.mkdirFails === 'claim' || claims.has(path)) {
        return out('', 1)
      }
      claims.set(path, opts.now?.() ?? 0)

      return out('')
    }
    if (argv[0] === 'git' && argv[1] === 'rev-parse') {
      return out(`${R}\n${R}/.git\n`)
    }

    return out(argv.includes('--directory') ? '' : opts.listed.join('\0'))
  })
  // The session folder's own paths (relative, as the nearest-folder rule asks) are the root todo folder's, as in the G2 probes.
  const own = (path: string) => (inside(path) ? path : `${R}/.claude_todo/${path.split('/').pop()}`)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.git') || claims.has(e.path) || (e.path.endsWith('.claude_todo') && !inside(e.path)) || (inside(e.path) && (e.path in files || Object.keys(files).some(path => path.startsWith(`${e.path}/`)))) }))
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/home/a/.claude')) {
      throw new Error('ENOENT')
    }

    return { value: { kind: e.path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: inside(e.path) ? e.path : !e.path.includes('.claude_todo') && !e.path.includes('.git') ? R : `${R}/.claude_todo` } } as never
  })
  on('fs.list', (_$, e) => {
    if (e.path === CLAIMS) {
      return { value: [...claims].map(([path, mtimeMs]) => ({ name: path.slice(CLAIMS.length + 1), kind: 'dir', size: 0, mtimeMs, isLink: false })) } as never
    }
    const dir = inside(e.path) ? e.path : `${R}/.claude_todo`

    return { value: names(dir).filter(name => name.endsWith('.md')).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2 + writes.length, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    const path = own(e.path)
    opts.readHook?.(path)

    return { value: files[path] ?? '' }
  })
  on('fs.write', (_$, e) => {
    const path = own(e.path)
    opts.fault?.(path, e.text as string)
    files[path] = e.text as string
    writes.push(path)

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { writes, calls, claims }
}

const open = async ($: TestApi) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function toastsOf(on: OnApi): string[] {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)

  return toasts
}

function promptOf(on: OnApi): { line: () => string | undefined } {
  let ctx: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    ctx = e.context ?? []

    return { text: e.text, context: e.context }
  })

  return { line: () => ctx.join('\n').split('\n').find(one => one.startsWith('Next free ticket IDs')) }
}

const offered = (line: string | undefined): string[] => (line === undefined ? [] : [...line.matchAll(/#(T\w+)/g)].map(m => m[1]!.toLowerCase()))

/**
 * A store shared with another session: `onGet` sees each read of a key, and may change the store right
 * after the read, as another session's write landing just after it would: the read gives the value before.
 */
function sharedStore(on: OnApi, shared: Map<string, unknown>, onGet: (key: string, value: unknown) => void = () => undefined) {
  on('store.get', (_$, e) => {
    const value = shared.get(e.key)
    onGet(e.key, value)

    return { value } as never
  })
  on('store.set', (_$, e) => {
    shared.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
}

// ---------------------------------------------------------------- UCR-030, UCR-041: ID block claims
// Property: an ID this session offers is never held by another session, even when the other session's
// store write lands right after this session's read-back; the IDs come from a block this session alone claimed.

test('UCR-030 the other session writes the store right after our read-back: its IDs and ours never meet', async ($, on) => {
  mock.clock(on)
  const shared = new Map<string, unknown>()
  const claims = new Map<string, number>()
  let isArmed = false
  let theirs: string[] = []
  // The other session: it claims a block the same way (block 0, else block 1) and stores its IDs from it, landing
  // just after our read-back saw our write (the overlap the store alone cannot stop).
  const otherSession = () => {
    const block = claims.has(`${CLAIMS}/0`) ? 1 : 0
    claims.set(`${CLAIMS}/${block}`, 0)
    theirs = blockIds(['t0001'], block, 3).map(id => id.toLowerCase())
    shared.set(`reserved:${R}`, theirs.map(id => [id, 9e15, 'sess-b', 'sess-b']))
  }
  sharedStore(on, shared, (key, value) => {
    if (isArmed && key === `reserved:${R}` && Array.isArray(value) && value.length >= 3) {
      isArmed = false
      otherSession()
    }
  })
  h2Repo(on, { [T]: '- [ ] #T1 a' }, { listed: ['.claude_todo/TODO.md'], claims })
  const prompt = promptOf(on)
  await open($)
  isArmed = true
  await $.prompt.submit({ text: 'go' } as never)
  const mine = offered(prompt.line())
  expect(mine.length).toBe(3)
  expect(theirs.length).toBe(3)
  expect(mine.filter(id => theirs.includes(id))).toEqual([])
  // The next prompt names the same IDs again: none was lost to the other session.
  await $.prompt.submit({ text: 'again' } as never)
  expect(offered(prompt.line())).toEqual(mine)
})

// Property: an offer is sent only when the store read and its read-back worked and a block was claimed.
const NO_OFFER_STATES: [string, (n: number) => boolean, H2Opts['mkdirFails']][] = [
  ['the first store read fails', n => n === 1, undefined],
  ['the read-back after the write fails', n => n >= 2, undefined],
  ['the claim mkdir fails with nothing made', () => false, 'claim'],
  ['the claim folder cannot be made', () => false, 'base'],
]
for (const [name, failsAt, mkdirFails] of NO_OFFER_STATES) {
  test(`UCR-030 no ID offer when ${name}`, async ($, on) => {
    mock.clock(on)
    const shared = new Map<string, unknown>()
    let n = 0
    let isCounting = false
    on('store.get', (_$, e) => {
      if (isCounting && e.key === `reserved:${R}`) {
        n += 1
        if (failsAt(n)) {
          throw new Error('EIO')
        }
      }

      return { value: shared.get(e.key) } as never
    })
    on('store.set', (_$, e) => (shared.set(e.key, e.value), { value: undefined }) as never)
    on('session.id', () => ({ value: 'sess-1' }) as never)
    const toasts = toastsOf(on)
    h2Repo(on, { [T]: '- [ ] #T1 a' }, { listed: ['.claude_todo/TODO.md'], mkdirFails })
    const prompt = promptOf(on)
    await open($)
    isCounting = true
    await $.prompt.submit({ text: 'go' } as never)
    expect(prompt.line()).toBeUndefined()
    if (mkdirFails !== undefined) {
      expect(toasts.filter(one => one.includes('names no new ticket IDs')).length).toBe(1)
    }
  })
}

test('UCR-030 the excluded population: a store that reads and a block another session holds still give an offer, from the next block', async ($, on) => {
  mock.clock(on)
  const claims = new Map<string, number>([[`${CLAIMS}/0`, 0]])
  sharedStore(on, new Map())
  const fake = h2Repo(on, { [T]: '- [ ] #T1 a' }, { listed: ['.claude_todo/TODO.md'], claims })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(offered(prompt.line())).toEqual(blockIds([], 1, 3).map(id => id.toLowerCase()))
  expect(fake.claims.has(`${CLAIMS}/1`)).toBe(true)
  // Made with mkdir and no -p: the one atomic create.
  expect(fake.calls).toContain(`mkdir -- ${CLAIMS}/1`)
})

test('UCR-030 a stale claim is taken over by its next generation; a live one is passed over', async ($, on) => {
  mock.clock(on)
  const claims = new Map<string, number>([[`${CLAIMS}/0`, -CLAIM_MS]])
  sharedStore(on, new Map())
  h2Repo(on, { [T]: '- [ ] #T1 a' }, { listed: ['.claude_todo/TODO.md'], claims })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(offered(prompt.line())).toEqual(['t0002', 't0003', 't0004'])
  expect(claims.has(`${CLAIMS}/0.1`)).toBe(true)
})

test('UCR-041 numbering and the prompt offer draw from one claimed block: no ID is given twice', async ($, on) => {
  const clock = mock.clock(on)
  sharedStore(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] #T1 a\n- [ ] new one' }
  const fake = h2Repo(on, files, { listed: ['.claude_todo/TODO.md'] })
  const prompt = promptOf(on)
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  const first = offered(prompt.line())
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(3000)
  }
  await sleep(20)
  const numbered = /#(T\w+) new one/.exec(files[T]!)?.[1]?.toLowerCase()
  expect(numbered).toBeDefined()
  expect(first).not.toContain(numbered)
  // One block served both: one claim.
  expect([...fake.claims.keys()]).toEqual([`${CLAIMS}/0`])
})

// ---------------------------------------------------------------- UCR-108: a file that never reads
// Property: a todo file that never reads is named itself, and after it failed the same way 3 passes in a
// row it is skipped with one toast; numbering and the offers go on, above every ID it held when it last read.

test('UCR-108 a file that never reads is named, then skipped: the other files are numbered above its IDs', async ($, on) => {
  const clock = mock.clock(on)
  sharedStore(on, new Map())
  const A = `${R}/.claude_todo/A.md`
  const B = `${R}/.claude_todo/B.md`
  const C = `${R}/.claude_todo/C.md`
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a', [B]: '- [ ] beta', [C]: '- [ ] #T0009 c' }
  let isBroken = false
  const toasts = toastsOf(on)
  h2Repo(on, files, { listed: ['.claude_todo/A.md', '.claude_todo/B.md', '.claude_todo/C.md'], readHook: path => {
    if (isBroken && path === C) {
      throw new Error('EACCES')
    }
  } })
  const prompt = promptOf(on)
  await open($)
  // C read once (its #T0009 is seen), then never again.
  isBroken = true
  for (let i = 0; i < 10; i += 1) {
    await clock.advance(3000)
  }
  await sleep(20)
  // The toast names C, never B, the file being numbered.
  expect(toasts.filter(one => one.includes('Could not number') && one.includes('B.md'))).toEqual([])
  expect(toasts.filter(one => one.includes('Could not number') && one.includes('C.md')).length).toBe(1)
  expect(toasts.filter(one => one.includes('C.md did not read 3 times in a row')).length).toBe(1)
  // B is numbered, above C's last seen ID.
  const id = /#(T\w+) beta/.exec(files[B]!)?.[1]
  expect(id).toBeDefined()
  expect(ticketValue(id!)!).toBeGreaterThan(ticketValue('T0009')!)
  await $.prompt.submit({ text: 'go' } as never)
  expect(offered(prompt.line()).every(one => ticketValue(one)! > ticketValue(id!)!)).toBe(true)
  expect(offered(prompt.line()).length).toBe(3)
})

test('UCR-108 before the third failing pass, no ID is given: the file still counts as unknown', async ($, on) => {
  const clock = mock.clock(on)
  sharedStore(on, new Map())
  const B = `${R}/.claude_todo/B.md`
  const C = `${R}/.claude_todo/C.md`
  const files: Record<string, string> = { [B]: '- [ ] #T0001 a', [C]: '- [ ] #T0009 c' }
  h2Repo(on, files, { listed: ['.claude_todo/B.md', '.claude_todo/C.md'], readHook: path => {
    if (path === C) {
      throw new Error('EACCES')
    }
  } })
  const prompt = promptOf(on)
  await open($)
  await clock.advance(3000)
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.line()).toBeUndefined()
})

// ---------------------------------------------------------------- UCR-098: the cut folders' IDs
// Property: a file of a cut folder that does not read keeps the IDs of its last good read; a new ID never repeats one.

test('UCR-098 a cut folder file that fails to read still counts its IDs', async ($, on) => {
  const clock = mock.clock(on)
  sharedStore(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] #T0001 a' }
  const listed = ['.claude_todo/TODO.md']
  // 21 folders: the last by path is cut from the pane (MAX_FOLDERS is 20).
  for (let i = 1; i <= 20; i += 1) {
    const rel = `mods/m${String(i).padStart(2, '0')}/.claude_todo/TODO.md`
    files[`${R}/${rel}`] = i === 20 ? '- [ ] #T0050 cut one' : `- [ ] #T000${(i % 9) + 1} x`
    listed.push(rel)
  }
  const CUT = `${R}/mods/m20/.claude_todo/TODO.md`
  let isBroken = false
  h2Repo(on, files, { listed, readHook: path => {
    if (isBroken && path === CUT) {
      throw new Error('EIO')
    }
  } })
  const prompt = promptOf(on)
  await open($)
  await clock.advance(3000)
  isBroken = true
  // A full resync rereads the cut folders.
  for (let i = 0; i < 25; i += 1) {
    await clock.advance(3000)
  }
  await $.prompt.submit({ text: 'go' } as never)
  const ids = offered(prompt.line())
  expect(ids.length).toBe(3)
  expect(ids.every(one => ticketValue(one)! > ticketValue('T0050')!)).toBe(true)
})

// ---------------------------------------------------------------- UCR-105: Delete duplicate tickets after numbering
// Property: two identical tickets that share a leading ID can still be removed after numbering gave the copy an ID.

test('UCR-105 a duplicate numbered as #T0007 #T0005 is still found and removed by Delete duplicate tickets', async ($, on) => {
  const clock = mock.clock(on)
  sharedStore(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] #T0005 Fix the parser\n- [ ] #T0005 Fix the parser\n- [ ] #T0006 Other' }
  const toasts = toastsOf(on)
  h2Repo(on, files, { listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(3000)
  }
  await sleep(20)
  expect(files[T]).toMatch(/^- \[ \] #T0005 Fix the parser\n- \[ \] #T\w+ #T0005 Fix the parser\n/)
  expect(await ui.find({ key: 'todo-delete-dup-tickets' })).toBeDefined()
  await ui.press({ key: 'todo-delete-dup-tickets' })
  await sleep(30)
  expect(files[T]).toBe('- [ ] #T0005 Fix the parser\n- [ ] #T0006 Other')
  expect(toasts.some(one => one.includes('Removed 1 duplicate ticket'))).toBe(true)
})

// ---------------------------------------------------------------- UCR-014, UCR-107: the Consolidate record
// Property: a source is never copied into the target twice, and an edit of the source after its copy is never lost.

test('UCR-107 a mark save that fails keeps the memory mark: the retry copies the source once', async ($, on) => {
  mock.clock(on)
  const shared = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: shared.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    if (String(e.key).startsWith('consolidate-marks')) {
      throw new Error('quota')
    }
    shared.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  const files: Record<string, string> = { [T]: '- [ ] #T1 Fix the parser', [Y]: '- [ ] #T7 Tune the cache' }
  let isBroken = true
  h2Repo(on, files, { listed: Y_LISTED, fault: (path, text) => {
    if (isBroken && path === Y && text === '') {
      throw new Error('EIO')
    }
  } })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  isBroken = false
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect((files[T]!.match(/Tune the cache/g) ?? []).length).toBe(1)
  expect(files[Y]).toBe('')
})

test('UCR-014 no record at all: a source whose copy the target holds is emptied, not copied again', async ($, on) => {
  mock.clock(on)
  sharedStore(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] #T1 Fix the parser\n\n## From mods/y/TODO.md\n\n- [ ] #T7 Tune the cache\n', [Y]: '- [ ] #T7 Tune the cache' }
  h2Repo(on, files, { listed: Y_LISTED })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect((files[T]!.match(/Tune the cache/g) ?? []).length).toBe(1)
  expect(files[Y]).toBe('')
})

test('UCR-014 an ID-only edit of the source after a failed empty is kept: the source is left and named', async ($, on) => {
  mock.clock(on)
  sharedStore(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] #T1 Fix the parser', [Y]: '- [ ] #T7 Tune the cache, after #T1' }
  const toasts = toastsOf(on)
  let isBroken = true
  h2Repo(on, files, { listed: Y_LISTED, fault: (path, text) => {
    if (isBroken && path === Y && text === '') {
      throw new Error('EIO')
    }
  } })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  isBroken = false
  files[Y] = '- [ ] #T7 Tune the cache, after #T8'
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files[Y]).toBe('- [ ] #T7 Tune the cache, after #T8')
  expect(toasts.some(one => one.includes('Not copied again, changed since an earlier copy') && one.includes(Y))).toBe(true)
})

// ---------------------------------------------------------------- UCR 5c: the read layer
// Property: a todo read that fails is never an empty or an absent file, on every path: with every todo file
// failing to read, the mod writes no todo file, names no ID and shows no Delete empty todos button.

test('UCR-5c every todo read fails: no todo file is written, no ID is named, no file counts as empty', async ($, on) => {
  const clock = mock.clock(on)
  sharedStore(on, new Map())
  const files: Record<string, string> = { [T]: '- [ ] #T1 a\n- [ ] new', [Y]: '- [x] #T2 done\n- [ ] new too', [`${R}/mods/y/.claude_todo/EMPTY.md`]: '' }
  const fake = h2Repo(on, files, { listed: [...Y_LISTED, 'mods/y/.claude_todo/EMPTY.md'], readHook: path => {
    if (path.endsWith('.md')) {
      throw new Error('EACCES')
    }
  } })
  const prompt = promptOf(on)
  const ui = await open($)
  for (let i = 0; i < 5; i += 1) {
    await clock.advance(3000)
  }
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.line()).toBeUndefined()
  expect(await ui.find({ key: 'todo-delete-empty' })).toBeUndefined()
  expect(fake.writes.filter(path => path.endsWith('.md') && !path.endsWith('/archive/TODO.md'))).toEqual([])
})
}
