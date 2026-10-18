// Engine cases through the fake engine, split from register.test.tsx so no test file passes the runner limit.
// One responsibility, the end-to-end cases of the block named by the comment below.

import { expect, mock, test } from 'claude-code/testing'

// Hook cases on a fake model: a damaged category book, Recategorize faults and the sort retry limits.
{
// UCR loop 1, batch D: categories book.

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Test = Parameters<typeof test>[1]
type Dollar = Parameters<Test>[0]
type On = Parameters<Test>[1]

const fromPs = (script: string) => String.fromCodePoint(...(/\[char\[\]\]\(([\d,]+)\)/.exec(script)![1]!.split(',').map(Number))).replace(/\\/g, '/')

function repoWith(on: On, files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string>; uname?: string; failing?: string[]; stays?: string[]; exits?: Record<string, number>; log?: string[]; dangling?: string[]; hold?: Promise<void> }) {
  const R = opts.root ?? '/repo'
  const state = { hasNearest: opts.hasNearest, listed: opts.listed }
  const writes: string[] = []
  const calls: string[] = []
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv.join(' '))
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
  on('fs.list', (_$, e) => ({ value: [...(inside(abs(e.path)) ? names(abs(e.path)) : state.hasNearest ? names(`${R}/.claude_todo`) : []), ...(opts.dangling ?? []).filter(path => path.slice(0, path.lastIndexOf('/')) === abs(e.path)).map(path => path.slice(path.lastIndexOf('/') + 1))].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2, isLink: false })) }))
  on('fs.read', (_$, e) => (opts.log?.push(`read:${abs(e.path)}`), { value: files[inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`] ?? '' }))
  on('fs.write', async (_$, e) => {
    const path = inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`
    opts.log?.push(`write:${path}`)
    // A held write: the test presses a button while this write is in flight.
    if (opts.hold !== undefined && e.text !== '') {
      await opts.hold
    }
    files[path] = e.text as string
    // Every write counts, the empty archive file that Show completed makes too: a test
    // that says nothing is written must see that one.
    writes.push(path)

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { state, writes, calls }
}

const open = async ($: Dollar) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

const BOOK = '/repo/.claude_todo/categories.json'
const TODO = '/repo/.claude_todo/TODO.md'

/** A model that answers `reply(prompt, call)` (undefined: not answered; 'throw': the call fails; a string: raw text), and records every prompt. */
function fakeModel(on: On, reply: (prompt: string, call: number) => unknown) {
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    const out = reply(e.prompt, prompts.length)
    if (out === 'throw') {
      throw new Error('model down')
    }

    return { value: out === undefined ? { isAnswered: false, text: '' } : { isAnswered: true, text: typeof out === 'string' ? out : JSON.stringify(out), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })

  return prompts
}

/** The item texts a sort prompt lists, numbered from 1. */
const listed = (prompt: string) => [...prompt.matchAll(/^(\d+)\. (.*)$/gm)].map(match => ({ n: match[1]!, text: match[2]! }))

/** A reply that gives every listed item to `name`, except the ones whose text holds `skip`. */
const assignAll = (name: string, skip?: string) => (prompt: string) => ({
  categories: [name],
  assign: Object.fromEntries(listed(prompt).filter(one => skip === undefined || !one.text.includes(skip)).map(one => [one.n, name])),
})

/** A file in `files` whose reads and writes the test controls. Returns what it holds. */
function controlled(files: Record<string, string>, path: string, first: string, control: { failReads: () => boolean; failWrites?: () => boolean }) {
  let stored = first
  Object.defineProperty(files, path, {
    enumerable: true,
    configurable: true,
    get: () => {
      if (control.failReads()) {
        throw new Error('EIO')
      }

      return stored
    },
    set: (value: string) => {
      if (control.failWrites?.() === true) {
        throw new Error('disk full')
      }
      stored = value
    },
  })

  return () => stored
}

// ---------------------------------------------------------------- 

const GOOD_BOOK = JSON.stringify({ categories: ['Code'], items: { '#t1': 'Code', '#t2': 'Code' } })
const TWO_OPEN = '- [ ] #T1 parser\n- [ ] #T2 lexer'

test('a categories.json that cannot be read is not treated as empty: no sort, no write, and the next scans retry', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: TWO_OPEN }
  let reads = 0
  const stored = controlled(files, BOOK, GOOD_BOOK, { failReads: () => (reads += 1) <= 3 })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const prompts = fakeModel(on, assignAll('Other'))
  await open($)
  // The first read fails, and so do the next two (the retry limit): still nothing.
  for (let i = 0; i < 12; i += 1) {
    await clock.advance(10_000)
  }
  expect(reads).toBeGreaterThan(3)
  expect(writes.filter(path => path.includes('categories.json'))).toEqual([])
  // The read works at last: the book is the user's own, so nothing is asked either.
  expect(stored()).toBe(GOOD_BOOK)
  expect(prompts).toEqual([])
})

test('a categories.json that reads but does not parse is copied to categories.json.bak, then the book starts over', async ($, on) => {
  const clock = mock.clock(on)
  const damaged = '{"categories": ["Code"], "items": {"#t1"'
  const files: Record<string, string> = { [TODO]: TWO_OPEN, [BOOK]: damaged }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  fakeModel(on, assignAll('Fresh'))
  await open($)
  await clock.advance(10_000)
  expect(files[`${BOOK}.bak`]).toBe(damaged)
  expect(JSON.parse(files[BOOK]!)).toEqual({ categories: ['Fresh'], items: { '#t1': 'Fresh', '#t2': 'Fresh' } })
  // The copy comes before the overwrite.
  expect(writes.indexOf(`${BOOK}.bak`)).toBeLessThan(writes.indexOf(BOOK))
})

test('a damaged file whose copy cannot be written is left alone and nothing is sorted', async ($, on) => {
  const clock = mock.clock(on)
  const damaged = '{"categories": ['
  const files: Record<string, string> = { [TODO]: TWO_OPEN, [BOOK]: damaged }
  controlled(files, `${BOOK}.bak`, '', { failReads: () => false, failWrites: () => true })
  // Not listed, so the copy is tried at categories.json.bak (an existing backup is never written over, G1) and that write fails.
  Object.defineProperty(files, `${BOOK}.bak`, { enumerable: false })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const prompts = fakeModel(on, assignAll('Fresh'))
  await open($)
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(10_000)
  }
  expect(files[BOOK]).toBe(damaged)
  expect(writes).not.toContain(BOOK)
  expect(prompts).toEqual([])
})

test('an empty categories.json is a book to start, with no copy of nothing', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: TWO_OPEN, [BOOK]: '' }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  fakeModel(on, assignAll('Fresh'))
  await open($)
  await clock.advance(10_000)
  expect(writes).not.toContain(`${BOOK}.bak`)
  expect(JSON.parse(files[BOOK]!).categories).toEqual(['Fresh'])
})

// ---------------------------------------------------------------- 

/** Four open tickets sorted Code/Docs; the model's reply is `reply`; writes of the book fail while `failWrites()`. */
async function recatSetup($: Dollar, on: On, reply: (prompt: string, call: number) => unknown, failWrites: () => boolean = () => false) {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    [TODO]: ['- [ ] #T1 parser', '- [ ] #T2 lexer', '- [ ] #T3 guide', '- [ ] #T4 faq'].join('\n'),
  }
  const first = JSON.stringify({ categories: ['Code', 'Docs'], items: { '#t1': 'Code', '#t2': 'Code', '#t3': 'Docs', '#t4': 'Docs' } })
  const stored = controlled(files, BOOK, first, { failReads: () => false, failWrites })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const prompts = fakeModel(on, reply)
  const ui = await open($)

  return { clock, files, stored, first, writes, prompts, ui }
}

const REAL_CHANGE = { categories: ['Lexing', 'Parsing', 'Writing'], assign: { 1: 'Parsing', 2: 'Lexing', 3: 'Writing', 4: 'Writing' } }
const svgText = async (ui: { findAll: (q: { type: string }) => Promise<unknown> }) => JSON.stringify(await ui.findAll({ type: 'Svg' }))

test('a failed write in Recategorize leaves the groups on the pane and in memory as they were, and the note says why', async ($, on) => {
  let isFailing = false
  const { first, stored, ui } = await recatSetup($, on, () => REAL_CHANGE, () => isFailing)
  expect(await svgText(ui)).toContain('Docs')
  isFailing = true
  await ui.press({ key: 'todo-recategorize' })
  expect(await ui.find({ type: 'Text', text: /Could not recategorize: no implementation for fs\.write/ })).toBeDefined()
  expect(stored()).toBe(first)
  const shown = await svgText(ui)
  expect(shown).toContain('Docs')
  expect(shown).not.toContain('Parsing')
})

// ---------------------------------------------------------------- 

const GOOD_AND_POISON = ['- [ ] #T1 good one', '- [ ] #T2 poison item'].join('\n')

test('an item the model leaves unsorted is sent twice at most, behind a good item, however long the session runs', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: GOOD_AND_POISON }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const prompts = fakeModel(on, assignAll('Code', 'poison'))
  await open($)
  for (let i = 0; i < 120; i += 1) {
    await clock.advance(5_000)
  }
  // Ten simulated minutes: the first sort sends both, the second only the poison item, then nothing.
  expect(prompts.length).toBe(2)
  expect(prompts[0]).toContain('good one')
  expect(prompts[1]).not.toContain('good one')
  expect(prompts[1]).toContain('poison item')
})

test('at the limit: one failed attempt is retried, the second failure stops it', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: '- [ ] #T2 poison item' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const prompts = fakeModel(on, assignAll('Code', 'poison'))
  await open($)
  await clock.advance(5_000)
  expect(prompts.length).toBe(1)
  await clock.advance(30_000)
  expect(prompts.length).toBe(2)
  for (let i = 0; i < 40; i += 1) {
    await clock.advance(30_000)
  }
  expect(prompts.length).toBe(2)
})

// Changed by an unreadable reply was counted against every item and stopped the sort for the
// session. It now backs off like a failed call and counts against no item.
test('an unreadable reply backs off, counts against no item, and a later readable one sorts them', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: GOOD_AND_POISON }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  let isReadable = false
  const readable = assignAll('Code')
  const prompts = fakeModel(on, (prompt, call) => (isReadable ? readable(prompt, call) : 'not json at all'))
  await open($)
  // Changed by (I4): 200 s, not 800 s. An item that fails alone SORT_TRIES times is given up for the session (see the I4 block).
  for (let i = 0; i < 20; i += 1) {
    await clock.advance(10_000)
  }
  // 200 s with 30, 60, 120 s waits: more than two tries, at most five.
  expect(prompts.length).toBeGreaterThan(2)
  expect(prompts.length).toBeLessThanOrEqual(5)
  isReadable = true
  for (let i = 0; i < 120; i += 1) {
    await clock.advance(10_000)
  }
  expect(Object.keys(JSON.parse(files[BOOK]!).items).length).toBe(2)
})

test('a model call that fails backs off, doubling the wait, and does not count against the items', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TODO]: GOOD_AND_POISON }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const prompts = fakeModel(on, () => 'throw')
  await open($)
  for (let i = 0; i < 120; i += 1) {
    await clock.advance(5_000)
  }
  // Without backoff: 21 calls in ten minutes. With 30, 60, 120, 240 s waits: 5 at most.
  expect(prompts.length).toBeGreaterThan(1)
  expect(prompts.length).toBeLessThanOrEqual(5)
})

// ---------------------------------------------------------------- 

/** `count` open tickets, all sorted into the one category Old (so only Recategorize asks the model). */
async function bigSetup($: Dollar, on: On, count: number, reply: (prompt: string, call: number) => unknown) {
  const clock = mock.clock(on)
  const ids = Array.from({ length: count }, (_, i) => `T${String(i + 1).padStart(4, '0')}`)
  const files: Record<string, string> = {
    [TODO]: ids.map(id => `- [ ] #${id} item ${id}`).join('\n'),
    [BOOK]: JSON.stringify({ categories: ['Old'], items: Object.fromEntries(ids.map(id => [`#${id.toLowerCase()}`, 'Old'])) }),
  }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const prompts = fakeModel(on, reply)
  const ui = await open($)

  return { clock, files, writes, prompts, ui }
}

const SPLIT = (prompt: string) => ({ categories: ['One', 'Two'], assign: Object.fromEntries(listed(prompt).map((one, i) => [one.n, i % 2 === 0 ? 'One' : 'Two'])) })

test('Recategorize asks for SORT_BATCHES batches at most, however many tickets are open', async ($, on) => {
  const { files, prompts, ui } = await bigSetup($, on, 400, SPLIT)
  await ui.press({ key: 'todo-recategorize' })
  expect(prompts.length).toBe(5)
  const book = JSON.parse(files[BOOK]!) as { categories: string[]; items: Record<string, string> }
  expect(book.categories).toEqual(['One', 'Two'])
  expect(Object.keys(book.items).length).toBe(300)
})

test('a batch with one bad reply is asked again once, and the run goes on', async ($, on) => {
  const { files, prompts, ui } = await bigSetup($, on, 130, (prompt, call) => (call === 2 ? 'garbage' : SPLIT(prompt)))
  await ui.press({ key: 'todo-recategorize' })
  // Three batches (60, 60, 10) plus one retry.
  expect(prompts.length).toBe(4)
  expect(Object.keys(JSON.parse(files[BOOK]!).items).length).toBe(130)
})

test('a batch that fails twice writes nothing and says why', async ($, on) => {
  const { files, writes, prompts, ui } = await bigSetup($, on, 130, (prompt, call) => (call >= 2 ? undefined : SPLIT(prompt)))
  const before = files[BOOK]
  await ui.press({ key: 'todo-recategorize' })
  expect(prompts.length).toBe(3)
  expect(files[BOOK]).toBe(before)
  expect(writes.filter(path => path === BOOK)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /Could not recategorize: no answer from the model/ })).toBeDefined()
})

test('a model call that throws on a batch is asked again once, then the reason shows', async ($, on) => {
  const { prompts, ui } = await bigSetup($, on, 70, (prompt, call) => (call >= 2 ? 'throw' : SPLIT(prompt)))
  await ui.press({ key: 'todo-recategorize' })
  expect(prompts.length).toBe(3)
  expect(await ui.find({ type: 'Text', text: /Could not recategorize: no implementation for model\.complete/ })).toBeDefined()
})
}
