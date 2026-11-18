import { expect, test } from 'claude-code/testing'

import type { TodoFile } from '../types'
import { isOwnNudge, MAX_BLOCKS, nudgeText, offenders, createFoundIssues, shouldNudge, snapshot } from '../hooks/found-issues'
import type { Snapshot } from '../hooks/found-issues'
import { parseTodo } from '../hooks/todo-markdown'

const OLD = '- [ ] #T0001 old open item\n'

/** A todo file from its text, in the folder `rel` (the primary one when it is `.claude_todo`). */
function file(text: string, name = 'TODO.md', rel = '.claude_todo'): TodoFile {
  return { name, folder: `/repo/${rel}`, rel, ...(rel === '.claude_todo' ? {} : { isOther: true as const }), mtimeMs: 0, items: parseTodo(text) }
}

/** A fixture: the files at the prompt. */
function world(prompt = 'fix the parser') {
  const files = [file(OLD)]
  const snap = snapshot(files, prompt)

  return { snap, files }
}

const names = (found: ReturnType<typeof offenders>) => found.map(one => one.label)

test('a new open item is an offender in every open box', () => {
  for (const box of [' ', '>', '~']) {
    const { snap, files } = world()
    const found = offenders(snap, [...files, file(`- [${box}] #T0002 new item`, 'NEW.md')])
    expect(names(found)).toEqual(['#T0002'])
    expect(shouldNudge(snap, found, 'answer')).toBe(true)
    expect(nudgeText(found)).toContain('#T0002')
  }
})

test('an in-flight agent item is allowed', () => {
  const { snap, files } = world()
  expect(offenders(snap, [...files, file('- [~] #T0002 new item (agent engineer, due 04:08 UTC)', 'N.md')])).toEqual([])
})

test('an agent note does not excuse an item that is not in progress', () => {
  const { snap, files } = world()
  expect(names(offenders(snap, [...files, file('- [ ] #T0002 new item (agent engineer, due 04:08 UTC)', 'N.md')]))).toEqual(['#T0002'])
})

test('a planning prompt never nudges', () => {
  for (const text of ['add a ticket for the export bug', 'put these in the backlog', 'make tickets for each finding', 'order the open tickets']) {
    const { files } = world()
    const snap = snapshot(files, text)
    expect(snap.planning).toBe(true)
    const found = offenders(snap, [...files, file('- [ ] #T0002 new item', 'N.md')])
    expect(shouldNudge(snap, found, 'answer')).toBe(false)
  }
})

test('a work prompt that names a ticket still checks', () => {
  for (const text of ['work ticket #T0001', 'fix #T0001 and ship it', 'execute the next ticket']) {
    const { files } = world()
    const snap = snapshot(files, text)
    expect(snap.planning).toBe(false)
    expect(shouldNudge(snap, offenders(snap, [...files, file('- [ ] #T0002 found on the way', 'N.md')]), 'answer')).toBe(true)
  }
})

test('a new done item is allowed', () => {
  const { snap, files } = world()
  expect(offenders(snap, [...files, file('- [x] #T0002 new item', 'N.md')])).toEqual([])
})

test('blocked, arch and noted markers allow, in any case', () => {
  const { snap, files } = world()
  expect(offenders(snap, [...files, file('- [ ] #T0002 a (blocked: needs X)\n- [>] #T0003 b (ARCH: new subsystem)\n- [ ] #T0004 c (noted: not modular)', 'N.md')])).toEqual([])
})

test('an item that was there at the prompt never offends', () => {
  const { snap, files } = world()
  expect(offenders(snap, files)).toEqual([])
})

test('a new item with no ID is named by its quoted text', () => {
  const { snap, files } = world()
  const found = offenders(snap, [...files, file('- [ ] item without an id', 'N.md')])
  expect(nudgeText(found)).toContain('"item without an id"')
})

test('a third block is not allowed', () => {
  const { snap, files } = world()
  const found = offenders(snap, [...files, file('- [ ] #T0002 new item', 'N.md')])
  const at = (blocks: number): Snapshot => ({ ...snap, blocks })
  expect(shouldNudge(at(0), found, 'answer')).toBe(true)
  expect(shouldNudge(at(MAX_BLOCKS - 1), found, 'answer')).toBe(true)
  expect(shouldNudge(at(MAX_BLOCKS), found, 'answer')).toBe(false)
})

test('the next user prompt snapshots the item and resets the count', () => {
  const { files } = world()
  const now = [...files, file('- [ ] #T0002 new item', 'N.md')]
  const again = snapshot(now, 'fix the parser')
  expect(again.blocks).toBe(0)
  expect(offenders(again, now)).toEqual([])
})

test('a nested mod todo folder counts and is named by its path from the repo', () => {
  const { snap, files } = world()
  const found = offenders(snap, [...files, file('- [ ] #T0009 nested', 'TODO.md', 'mods/x/.claude_todo')])
  expect(names(found)).toEqual(['#T0009'])
  expect(nudgeText(found)).toContain('mods/x/.claude_todo/TODO.md')
})

test('the same ID in another folder is a different item', () => {
  const { snap, files } = world()
  expect(names(offenders(snap, [...files, file('- [ ] #T0001 same ID, other folder', 'TODO.md', 'mods/x/.claude_todo')]))).toEqual(['#T0001'])
})

test('a .html todo file counts', () => {
  const { snap, files } = world()
  const found = offenders(snap, [...files, file('- [ ] #T0002 new item', 'PLAN.html')])
  expect(shouldNudge(snap, found, 'answer')).toBe(true)
  expect(nudgeText(found)).toContain('PLAN.html')
})

test('an archive file does not count', () => {
  const { snap, files } = world()
  expect(offenders(snap, [...files, file('- [ ] #T0009 archived', 'archive/OLD.md')])).toEqual([])
  expect(offenders(snap, [...files, { ...file('- [ ] #T0009 archived', 'OLD.md'), isArchived: true }])).toEqual([])
})

test('no offenders means no nudge', () => {
  const { snap } = world()
  expect(shouldNudge(snap, [], 'answer')).toBe(false)
})

test('at most eight are named, then the count of the rest', () => {
  const { snap, files } = world()
  const lines = Array.from({ length: 12 }, (_, n) => `- [ ] #T01${String(n).padStart(2, '0')} item`).join('\n')
  const text = nudgeText(offenders(snap, [...files, file(lines, 'N.md')]))
  expect(text.split('[ ] in').length - 1).toBe(8)
  expect(text).toContain('(and 4 more)')
})

test('a duplicate key is named once', () => {
  const { snap, files } = world()
  expect(offenders(snap, [...files, file('- [ ] #T0002 a', 'N.md'), file('- [ ] #T0002 a copy', 'M.md')])).toHaveLength(1)
})

test('an interrupted turn, a refusal and an error do not nudge', () => {
  const { snap, files } = world()
  const found = offenders(snap, [...files, file('- [ ] #T0002 new item', 'N.md')])
  for (const reason of ['aborted', 'refusal', 'error'] as const) {
    expect(shouldNudge(snap, found, reason)).toBe(false)
  }
})

test('only the mod nudge is its own prompt', () => {
  const text = nudgeText([{ key: 'k', label: '#T1', box: ' ', path: 'p' }])
  expect(isOwnNudge({ text, origin: { kind: 'plugin', name: 'claudeopticon' } })).toBe(true)
  // the prefix alone decides, so the cap holds whatever origin the engine gives the nudge.
  expect(isOwnNudge({ text })).toBe(true)
  expect(isOwnNudge({ text, origin: { kind: 'composer' } })).toBe(true)
  expect(isOwnNudge({ text, origin: { kind: 'plugin', name: 'other' } })).toBe(true)
  expect(isOwnNudge({ text: 'work #T1', origin: { kind: 'plugin', name: 'claudeopticon' } })).toBe(false)
})

// ---------------------------------------------------------------- controller

const $ = {} as never

/**
 * The controller on a scripted list of files, wired as register.tsx wires it: a failed read gives
 * `undefined`, and each nudge text is what the hook submits; `sent` holds them.
 */
function rig(enabled = true, read: () => Promise<TodoFile[]> = () => Promise.resolve(state.files)) {
  const sent: string[] = []
  const c = createFoundIssues({ enabled })
  const found = {
    onPrompt: async (_$: unknown, e: Parameters<typeof c.onPrompt>[0]) => {
      if (c.takesPrompt(e)) {
        c.onPrompt(e, await read().catch(() => undefined))
      }
    },
    onTurnEnd: async (_$: unknown, e: Parameters<typeof c.onTurnEnd>[0]) => {
      if (c.takesTurn(e)) {
        const nudge = c.onTurnEnd(e, await read().catch(() => undefined))
        if (nudge !== undefined) {
          sent.push(nudge)
        }
      }
    },
  }

  return { found, sent }
}

const state = { files: [file(OLD)] }
const withNew = (extra: string) => [file(OLD + extra)]
const answer = { reason: 'answer' as const }
const user = (text = 'fix the parser') => ({ text, origin: { kind: 'composer' } })
const mod = { text: 'work #T0001', origin: { kind: 'plugin', name: 'claudeopticon' } }
/** The nudge is submitted without being awaited: let its promise chain run. */
const settle = async () => {
  for (let n = 0; n < 20; n++) {
    await Promise.resolve()
  }
}

test('a turn that leaves a new open item submits a nudge, twice at most', async () => {
  state.files = [file(OLD)]
  const { found, sent } = rig()
  await found.onPrompt($, user())
  state.files = withNew('- [ ] #T0002 new item\n')
  for (let n = 0; n < 3; n++) {
    await found.onTurnEnd($, answer)
    await settle()
  }
  expect(sent).toHaveLength(2)
  expect(sent[0]).toContain('#T0002')
})

test('a prompt the mod submitted as a nudge keeps the snapshot and the count; a user prompt resets both', async () => {
  state.files = [file(OLD)]
  const { found, sent } = rig()
  await found.onPrompt($, user())
  state.files = withNew('- [ ] #T0002 new item\n')
  await found.onTurnEnd($, answer)
  await found.onTurnEnd($, answer)
  await settle()
  expect(sent).toHaveLength(2)
  // The nudge runs as a turn of its own: it must not take a new snapshot (that would hold) or reset the count.
  await found.onPrompt($, { text: sent[0]!, origin: { kind: 'plugin', name: 'claudeopticon' } })
  await found.onTurnEnd($, answer)
  await settle()
  expect(sent).toHaveLength(2)
  // A user prompt snapshots and resets the count.
  await found.onPrompt($, user('next task'))
  state.files = withNew('- [ ] #T0002 new item\n- [ ] #T0003 other\n')
  await found.onTurnEnd($, answer)
  await settle()
  expect(sent).toHaveLength(3)
  expect(sent[2]).toContain('#T0003')
  expect(sent[2]).not.toContain('#T0002')
})

test('another prompt of the mod (a ticket button) or a user prompt resets; a notification does not', async () => {
  state.files = [file(OLD)]
  const { found, sent } = rig()
  await found.onPrompt($, user())
  state.files = withNew('- [ ] #T0002 new item\n')
  await found.onPrompt($, { text: '<task-notification>', origin: { kind: 'task-notification' } })
  await found.onTurnEnd($, answer)
  await settle()
  expect(sent).toHaveLength(1)
  await found.onPrompt($, mod)
  await found.onTurnEnd($, answer)
  await settle()
  expect(sent).toHaveLength(1)
})

test('an interrupted turn submits no nudge', async () => {
  state.files = [file(OLD)]
  const { found, sent } = rig()
  await found.onPrompt($, user())
  state.files = withNew('- [ ] #T0002 new item\n')
  await found.onTurnEnd($, { reason: 'aborted' })
  await found.onTurnEnd($, { reason: 'error' })
  await settle()
  expect(sent).toHaveLength(0)
})

test('an agent turn, the option off and no snapshot submit no nudge', async () => {
  state.files = [file(OLD)]
  const off = rig(false)
  await off.found.onPrompt($, user())
  state.files = withNew('- [ ] #T0002 new item\n')
  await off.found.onTurnEnd($, answer)
  const on = rig()
  await on.found.onTurnEnd($, answer)
  await on.found.onPrompt($, user())
  state.files = withNew('- [ ] #T0003 newer\n')
  await on.found.onTurnEnd($, { reason: 'answer', agentId: 'a1' })
  await settle()
  expect(off.sent).toHaveLength(0)
  expect(on.sent).toHaveLength(0)
})

test('a read that fails lets the turn end', async () => {
  const { found, sent } = rig(true, () => Promise.reject(new Error('disk')))
  await found.onPrompt($, user())
  await found.onTurnEnd($, answer)
  await settle()
  expect(sent).toHaveLength(0)
})

// Property: an item with no ID at the prompt that the mod numbers during the turn is the same item.
test('an item numbered during the turn is not a new item', () => {
  const snap = snapshot([file(OLD + '- [ ] plain item without id\n')], 'fix the parser')
  expect(offenders(snap, [file(OLD + '- [ ] #T0003 plain item without id\n')])).toEqual([])
  // A new item with an ID of its own is still found.
  expect(offenders(snap, [file(OLD + '- [ ] #T0003 plain item without id\n- [ ] #T0004 new\n')]).map(one => one.label)).toEqual(['#T0004'])
})

