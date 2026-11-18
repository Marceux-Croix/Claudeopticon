// Engine cases through the fake engine, split from register.test.tsx: overlapping scans, numbering faults, Consolidate and its sources.

import { expect, mock, test } from 'claude-code/testing'

import { appendSections } from '../hooks/consolidate-text'
import { itemKey } from '../hooks/item-keys'
import { setBox } from '../hooks/ticket-boxes'
import { parseTodo } from '../hooks/todo-markdown'
import { mtimes, repoWith, open, sleep, toastsOf, promptOf, clearMtimes, type TestApi, type OnApi } from './fake-repo'

// ---------------------------------------------------------------- 

/** Two scans overlap: the first reads A.md slowly, the second reads it at once. Numbering then runs. */
async function overlappingScans($: TestApi, on: OnApi, extra: (files: Record<string, string>) => void = () => undefined) {
  clearMtimes()
  const clock = mock.clock(on)
  const A = '/repo/.claude_todo/A.md'
  const B = '/repo/.claude_todo/B.md'
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a', [B]: '- [ ] beta' }
  let gate: Promise<void> | undefined
  let release = () => {}
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md'], readHook: async path => {
    if (path === A && gate !== undefined) {
      const held = gate
      gate = undefined
      await held
    }
  } })
  const prompt = promptOf(on)
  await open($)
  files[A] = '- [ ] #T0005 a\n- [ ] #T0006 b'
  mtimes[A] = 3
  gate = new Promise<void>(resolve => { release = resolve })
  const s1 = $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await sleep(10)
  files[A] = '- [ ] #T0005 a\n- [ ] #T0006 b\n- [ ] #T0007 c'
  mtimes[A] = 4
  extra(files)
  // The second scan must not finish before the first, and must not leave the old board behind it.
  const s2 = $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await sleep(10)
  // B has been unnumbered for 5 s while the slow scan still holds its read; then it ends.
  const waiting = clock.advance(6000)
  await sleep(10)
  release()
  await Promise.all([s1, s2, waiting])
  await clock.advance(6000)
  await clock.advance(6000)
  await sleep(20)

  return { files, A, B, prompt }
}

test('a slow older scan does not put an old board back: numbering never reuses an ID of another file', async ($, on) => {
  const { files, B, prompt } = await overlappingScans($, on)
  // A holds T0005 to T0007: B takes the next one, not T0006 or T0007.
  expect(files[B]).toBe('- [ ] #T0008 beta')
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('#T0009')
})

test('after overlapping scans the prompt names IDs from the newest board', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const A = '/repo/.claude_todo/A.md'
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a' }
  let gate: Promise<void> | undefined
  let release = () => {}
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md'], readHook: async path => {
    if (path === A && gate !== undefined) {
      const held = gate
      gate = undefined
      await held
    }
  } })
  const prompt = promptOf(on)
  await open($)
  files[A] = '- [ ] #T0005 a\n- [ ] #T0006 b'
  mtimes[A] = 3
  gate = new Promise<void>(resolve => { release = resolve })
  const s1 = $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await sleep(10)
  files[A] = '- [ ] #T0005 a\n- [ ] #T0006 b\n- [ ] #T0007 c'
  mtimes[A] = 4
  const s2 = $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await sleep(10)
  release()
  await Promise.all([s1, s2])
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('Next free ticket IDs: #T0008')
})

test('numbering reads every file from the disk inside the lock: a file the board has not seen yet counts (top level)', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const A = '/repo/.claude_todo/A.md'
  const B = '/repo/.claude_todo/B.md'
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a', [B]: '- [ ] beta' }
  let isArmed = false
  // The file shows up on the disk after the scan listed the folders: the first stat of B.md is numbering's own check.
  const log = { push: (entry: string) => {
    if (isArmed && entry === `stat:${B}`) {
      isArmed = false
      files['/repo/.claude_todo/C.md'] = '- [ ] #T0006 c'
    }
    return 0
  } } as unknown as string[]
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md'], log })
  await open($)
  // One scan passes unarmed (B is first seen unnumbered at open); the armed scan after it numbers.
  await clock.advance(3000)
  isArmed = true
  await clock.advance(3000)
  await clock.advance(6000)
  await sleep(20)
  // The file did appear during the pass.
  expect(isArmed).toBe(false)
  expect(files[B]).not.toMatch(/#T0006\b/)
  expect(files[B]).toMatch(/^- \[ \] #T000[7-9A-Z] beta$/)
})

test('numbering reads every file from the disk inside the lock: a file the board has not seen yet counts (archive folder)', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  const A = '/repo/.claude_todo/A.md'
  const B = '/repo/.claude_todo/B.md'
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a', [B]: '- [ ] beta' }
  let isArmed = false
  // The file shows up on the disk after the scan listed the folders: the first stat of B.md is numbering's own check.
  const log = { push: (entry: string) => {
    if (isArmed && entry === `stat:${B}`) {
      isArmed = false
      files['/repo/.claude_todo/archive/C.md'] = '- [x] #T0006 c'
    }
    return 0
  } } as unknown as string[]
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md'], log })
  await open($)
  await clock.advance(3000)
  isArmed = true
  await clock.advance(3000)
  await clock.advance(6000)
  await sleep(20)
  // The file did appear during the pass.
  expect(isArmed).toBe(false)
  expect(files[B]).not.toMatch(/#T0006\b/)
  expect(files[B]).toMatch(/^- \[ \] #T000[7-9A-Z] beta$/)
})

test('the scan is single-flight: a call during a scan waits for a run that starts after it', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const A = '/repo/.claude_todo/A.md'
  const files: Record<string, string> = { [A]: '- [ ] #T0005 a' }
  let gate: Promise<void> | undefined
  let release = () => {}
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md'], readHook: async path => {
    if (path === A && gate !== undefined) {
      const held = gate
      gate = undefined
      await held
    }
  } })
  const ui = await open($)
  files[A] = '- [ ] #T0005 a\n- [ ] #T0006 b'
  mtimes[A] = 3
  gate = new Promise<void>(resolve => { release = resolve })
  const s1 = $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await sleep(10)
  files[A] = '- [ ] #T0005 a\n- [ ] #T0006 b\n- [ ] #T0007 c'
  mtimes[A] = 4
  const s2 = $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await sleep(10)
  release()
  await Promise.all([s1, s2])
  // The board shows the newest text, not the one the slow scan read first.
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('#T0007')
})

test('ID-like words are no IDs: two lines with #h264 keep two keys, and numbering gives each its own ID', async ($, on) => {
  const text = ['- [ ] Support #h264 decoding', '- [ ] Fix #utf8 and #es2015 handling', '- [ ] Fix #h264 encoder crash'].join('\n')
  expect(parseTodo(text).map(item => item.id)).toEqual([undefined, undefined, undefined])
  const moved = setBox(text, itemKey(parseTodo('- [ ] Fix #h264 encoder crash')[0]!), 'in_progress')
  expect(moved).toBe(['- [ ] Support #h264 decoding', '- [ ] Fix #utf8 and #es2015 handling', '- [~] Fix #h264 encoder crash'].join('\n'))
  // A leading ID stays an ID.
  expect(parseTodo('- [ ] #h264 Decoder')[0]?.id).toBe('h264')
  // Two lines naming the same T ID (no ticket leads with it) do not share it.
  expect(parseTodo(['- [ ] A, see #T7', '- [ ] B, see #T7'].join('\n')).map(item => item.id)).toEqual(['T7', undefined])
  clearMtimes()
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': text }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(6000)
  await clock.advance(6000)
  await sleep(20)
  expect(files['/repo/.claude_todo/TODO.md']).toBe(['- [ ] #T0001 Support #h264 decoding', '- [ ] #T0002 Fix #utf8 and #es2015 handling', '- [ ] #T0003 Fix #h264 encoder crash'].join('\n'))
})

// ---------------------------------------------------------------- 

/** Two or three unnumbered files; the writes to `bad` throw. Returns the files and what Claude heard. */
async function numberWithFault($: TestApi, on: OnApi, names: string[], bad: string[]) {
  clearMtimes()
  const clock = mock.clock(on)
  const files: Record<string, string> = {}
  for (const name of names) {
    files[`/repo/.claude_todo/${name}.md`] = `- [ ] ${name.toLowerCase()} item`
  }
  const toasts = toastsOf(on)
  repoWith(on, files, { hasNearest: true, listed: names.map(name => `.claude_todo/${name}.md`), fault: path => {
    if (bad.some(name => path.endsWith(`/${name}.md`))) {
      throw new Error('EACCES')
    }
  } })
  const prompt = promptOf(on)
  await open($)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(6000)
  }
  await sleep(20)
  await $.prompt.submit({ text: 'go' } as never)

  return { files, toasts, ctx: prompt.ctx() }
}

test('a failed write of the second file keeps the note of the first, and the failing file is named once', async ($, on) => {
  const { files, toasts, ctx } = await numberWithFault($, on, ['A', 'B'], ['B'])
  expect(files['/repo/.claude_todo/A.md']).toMatch(/^- \[ \] #T000\d a item$/)
  expect(ctx).toContain('A.md')
  expect(ctx).toContain('"a item"')
  expect(toasts.filter(one => one.includes('Could not number') && one.includes('B.md')).length).toBe(1)
})

test('a failing first file does not stop the files after it', async ($, on) => {
  const { files, toasts, ctx } = await numberWithFault($, on, ['A', 'B'], ['A'])
  expect(files['/repo/.claude_todo/B.md']).toMatch(/^- \[ \] #T000\d b item$/)
  expect(ctx).toContain('"b item"')
  expect(toasts.filter(one => one.includes('Could not number') && one.includes('A.md')).length).toBe(1)
})

test('a failing middle file: the first and the third are numbered and told', async ($, on) => {
  const { files, ctx } = await numberWithFault($, on, ['A', 'B', 'C'], ['B'])
  expect(files['/repo/.claude_todo/A.md']).toMatch(/#T000\d a item/)
  expect(files['/repo/.claude_todo/B.md']).toBe('- [ ] b item')
  expect(files['/repo/.claude_todo/C.md']).toMatch(/#T000\d c item/)
  expect(ctx).toContain('"a item"')
  expect(ctx).toContain('"c item"')
})

// ---------------------------------------------------------------- 

test('a Consolidate press that waits behind an archive move is not dropped', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  let release = () => {}
  const hold = new Promise<void>(resolve => {
    release = resolve
  })
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 Done\n- [ ] #T2 Open', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Elsewhere' }
  const log: string[] = []
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'], hold, log })
  const toasts = toastsOf(on)
  const ui = await open($)
  await clock.advance(3000)
  const moving = clock.advance(3000)
  const writesToArchive = () => log.filter(entry => entry === 'write:/repo/.claude_todo/archive/TODO.md').length
  for (let i = 0; i < 200 && writesToArchive() < 1; i += 1) {
    await sleep(5)
  }
  expect(writesToArchive()).toBe(1)
  await ui.press({ key: 'todo-consolidate' })
  release()
  await moving
  await sleep(30)
  // Either it ran after the move, or the user was told to try again: never nothing.
  const merged = files['/repo/mods/x/.claude_todo/TODO.md'] === ''
  const told = toasts.some(one => one.includes('Busy, try again in a moment'))
  expect(merged || told).toBe(true)
  expect(merged).toBe(true)
})

test('a Delete empty press that waits behind an archive move is not dropped', async ($, on) => {
  clearMtimes()
  const clock = mock.clock(on)
  let release = () => {}
  const hold = new Promise<void>(resolve => {
    release = resolve
  })
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 Done\n- [ ] #T2 Open', '/repo/.claude_todo/EMPTY.md': '' }
  const log: string[] = []
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/EMPTY.md'], hold, log })
  const toasts = toastsOf(on)
  const ui = await open($)
  await clock.advance(3000)
  const moving = clock.advance(3000)
  const writesToArchive = () => log.filter(entry => entry === 'write:/repo/.claude_todo/archive/TODO.md').length
  for (let i = 0; i < 200 && writesToArchive() < 1; i += 1) {
    await sleep(5)
  }
  await ui.press({ key: 'todo-delete-empty' }).catch(() => undefined)
  release()
  await moving
  await sleep(30)
  const removed = files['/repo/.claude_todo/EMPTY.md'] === undefined
  const told = toasts.some(one => one.includes('Busy, try again in a moment'))
  expect(removed || told).toBe(true)
})

// ---------------------------------------------------------------- Consolidate

const LISTED = ['.claude_todo/TODO.md', '.claude_todo/BACKLOG.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/.claude_todo/archive/OLD.md', '.claude_todo/archive/OLD.md', 'mods/y/.claude_todo/TODO.md']

test('Consolidate copies the moved text as written: blank lines and trailing spaces stay, only the blank ends are cut', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    // An inner blank line, a trailing-space line, and blank ends.
    '/repo/mods/x/.claude_todo/TODO.md': '\n\n# Plan  \n\n- [ ] #T5 Docs  \n   \n  note with  spaces   \n\n',
    // A source of one heading and a blank line inside a code fence.
    '/repo/mods/y/.claude_todo/TODO.md': '```\nkeep\n\n  this   \n```\n- [ ] #T6 Tune',
  }
  repoWith(on, files, { hasNearest: true, listed: LISTED })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix\n\n## From mods/x/TODO.md\n\n# Plan  \n\n- [ ] #T5 Docs  \n   \n  note with  spaces   \n\n## From mods/y/TODO.md\n\n```\nkeep\n\n  this   \n```\n- [ ] #T6 Tune\n')
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('')
  expect(files['/repo/mods/y/.claude_todo/TODO.md']).toBe('')
})

test('a renamed ticket of the source archive is followed by the references in its live file', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/.claude_todo/archive/OLD.md': '- [x] #T9 Old',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 Follow up on #T9',
    '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Done in x',
  }
  repoWith(on, files, { hasNearest: true, listed: LISTED })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  const archived = /#(T\w+) Done in x/.exec(files['/repo/.claude_todo/archive/OLD.md']!)?.[1]
  expect(archived).toBeDefined()
  expect(archived).not.toBe('T9')
  expect(files['/repo/.claude_todo/TODO.md']).toContain(`- [ ] #T2 Follow up on #${archived}`)
})

test('a renamed ticket of the live file is followed by the references in the source archive', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/.claude_todo/archive/OLD.md': '- [x] #T3 Other old',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Docs',
    '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T8 Done in x, came from #T1',
  }
  repoWith(on, files, { hasNearest: true, listed: LISTED })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  const docs = /#(T\w+) Docs/.exec(files['/repo/.claude_todo/TODO.md']!)?.[1]
  expect(docs).toBeDefined()
  expect(docs).not.toBe('T1')
  expect(files['/repo/.claude_todo/archive/OLD.md']).toContain(`came from #${docs}`)
})

test('a file that owns an ID itself keeps it when another file of its folder renamed the same ID', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/.claude_todo/archive/OLD.md': '- [x] #T9 Old',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T9 Own ticket, see #T9',
    '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Done in x',
  }
  repoWith(on, files, { hasNearest: true, listed: LISTED })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  // Both files of x own T9: each is renamed on its own, and neither is rewritten by the other's rename.
  const live = files['/repo/.claude_todo/TODO.md']!
  const own = /#(T\w+) Own ticket, see #(T\w+)/.exec(live)
  expect(own).not.toBeNull()
  expect(own![2]).toBe(own![1])
})

test('a source that fails to empty: the others are emptied, the notes are queued, a retry only empties it', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Write the docs',
    '/repo/mods/y/.claude_todo/TODO.md': '- [ ] #T7 Tune the cache',
  }
  const toasts = toastsOf(on)
  let isBroken = true
  repoWith(on, files, { hasNearest: true, listed: LISTED, fault: (path, text) => {
    if (isBroken && path.endsWith('mods/y/.claude_todo/TODO.md') && text === '') {
      throw new Error('EIO')
    }
  } })
  const prompt = promptOf(on)
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  const target = files['/repo/.claude_todo/TODO.md']!
  expect(target).toContain('Write the docs')
  expect(target).toContain('Tune the cache')
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('')
  expect(files['/repo/mods/y/.claude_todo/TODO.md']).toBe('- [ ] #T7 Tune the cache')
  const said = toasts.join('\n')
  expect(said).toContain('Not finished')
  expect(said).toContain('mods/y/.claude_todo/TODO.md')
  // The rename of x reaches Claude although y failed.
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('#T1 is now')
  // The retry empties y and copies nothing again.
  isBroken = false
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files['/repo/mods/y/.claude_todo/TODO.md']).toBe('')
  expect(files['/repo/.claude_todo/TODO.md']).toBe(target)
  expect((files['/repo/.claude_todo/TODO.md']!.match(/Tune the cache/g) ?? []).length).toBe(1)
})

test('the first source fails to empty: the later source is still emptied', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Write the docs',
    '/repo/mods/y/.claude_todo/TODO.md': '- [ ] #T7 Tune the cache',
  }
  repoWith(on, files, { hasNearest: true, listed: LISTED, fault: (path, text) => {
    if (path.endsWith('mods/x/.claude_todo/TODO.md') && text === '') {
      throw new Error('EIO')
    }
  } })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] #T1 Write the docs')
  expect(files['/repo/mods/y/.claude_todo/TODO.md']).toBe('')
})

test('a write that fails for the archive destination does not undo or hide the target that was written', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser',
    '/repo/.claude_todo/archive/OLD.md': '- [x] #T9 Old',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Write the docs',
    '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Done in x',
  }
  const toasts = toastsOf(on)
  repoWith(on, files, { hasNearest: true, listed: LISTED, fault: path => {
    if (path === '/repo/.claude_todo/archive/OLD.md') {
      throw new Error('ENOSPC')
    }
  } })
  const prompt = promptOf(on)
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files['/repo/.claude_todo/TODO.md']).toContain('Write the docs')
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('')
  expect(files['/repo/mods/x/.claude_todo/archive/OLD.md']).toBe('- [x] #T9 Done in x')
  const said = toasts.join('\n')
  expect(said).toContain('Not finished')
  expect(said).toContain('.claude_todo/TODO.md')
  await $.prompt.submit({ text: 'go' } as never)
  expect(prompt.ctx()).toContain('#T1 is now')
})

test('a source that will not list is named in a toast, with other sources still moved', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/.claude_todo/BACKLOG.md': '- [ ] #T2 Back',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Docs',
    '/repo/mods/y/.claude_todo/TODO.md': '- [ ] #T4 Cache',
  }
  const toasts = toastsOf(on)
  let isBroken = false
  repoWith(on, files, { hasNearest: true, listed: LISTED, listHook: path => {
    if (isBroken && path === '/repo/mods/x/.claude_todo') {
      throw new Error('EIO')
    }
  } })
  const ui = await open($)
  isBroken = true
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] #T3 Docs')
  expect(files['/repo/mods/y/.claude_todo/TODO.md']).toBe('')
  expect(toasts.join('\n')).toContain('Not read, left as they are: /repo/mods/x/.claude_todo')
})

test('a press whose only source will not list says so instead of doing nothing', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Docs',
  }
  const toasts = toastsOf(on)
  let isBroken = false
  repoWith(on, files, { hasNearest: true, listed: LISTED, listHook: path => {
    if (isBroken && path === '/repo/mods/x/.claude_todo') {
      throw new Error('EIO')
    }
  } })
  const ui = await open($)
  isBroken = true
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] #T3 Docs')
  expect(toasts.join('\n')).toContain('Not read, left as they are: /repo/mods/x/.claude_todo')
})

test('a source file behind a symlink is named too', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Docs',
    '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T4 Old',
  }
  const toasts = toastsOf(on)
  repoWith(on, files, { hasNearest: true, listed: LISTED, links: { '/repo/mods/x/.claude_todo/archive/OLD.md': '/home/a/.claude/.claude_todo/OLD.md' } })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  await sleep(30)
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] #T3 Docs')
  expect(toasts.join('\n')).toContain('Not read, left as they are: /repo/mods/x/.claude_todo/archive/OLD.md')
})

test('sections go into a CRLF target with CRLF line endings', async ($, on) => {
  // Unit: a CRLF target, a CRLF target with no final newline, and an LF target.
  expect(appendSections('- [ ] top\r\n', [{ place: 'a', lines: ['- [ ] b', 'c'] }])).toBe('- [ ] top\r\n\r\n## From a\r\n\r\n- [ ] b\r\nc\r\n')
  expect(appendSections('- [ ] top\r\n- [ ] two', [{ place: 'a', lines: ['- [ ] b'] }])).toBe('- [ ] top\r\n- [ ] two\r\n\r\n## From a\r\n\r\n- [ ] b\r\n')
  expect(appendSections('- [ ] top\n', [{ place: 'a', lines: ['- [ ] b'] }])).toBe('- [ ] top\n\n## From a\n\n- [ ] b\n')
  // Through the button.
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix\r\n',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Docs\r\n- [ ] #T4 More\r\n',
  }
  repoWith(on, files, { hasNearest: true, listed: LISTED })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix\r\n\r\n## From mods/x/TODO.md\r\n\r\n- [ ] #T3 Docs\r\n- [ ] #T4 More\r\n')
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('')
})
