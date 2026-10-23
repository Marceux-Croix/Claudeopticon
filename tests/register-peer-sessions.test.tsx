// Peer sessions through the fake engine: this session stores its presence record, reads its
// peers' records from the shared store, and marks their tickets on its board.

import { expect, mock, test } from 'claude-code/testing'

import { clockText, PEER_DIM_MS, PEER_IGNORE_MS } from '../hooks/peer-sessions'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
type Dollar = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
const PROGRESS = 'mcp__claudeopticon__report_progress'

/** A pane over one todo file and a shared store the test also writes to, as another session would. */
/** The todo file the fake fs serves: tests change `text` and bump `mtime`, as a write would. */
/** The prompts the mod submitted, as the engine saw them. */
const submitted: string[] = []
let edit = (text: string) => text
const todo = { text: '- [ ] #T1 Ship the parser\n- [ ] #T2 Review the copy', mtime: 1 }
const setTodo = (text: string) => {
  todo.text = text
  todo.mtime += 10
}

function setup($: Dollar, on: On) {
  edit = text => text
  submitted.length = 0
  setTodo('- [ ] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return out('/repo\n/repo/.git\n')
    if (argv[0] === 'git' && argv[1] === 'worktree') return out('worktree /repo\nHEAD a\nbranch refs/heads/main\n')
    if (argv[0] === 'git' && argv[1] === 'ls-files') return out('.claude_todo/OPEN.md\0')
    if (argv[0] === 'printenv') return argv[1] === 'HOME' ? out('/home/a\n') : out('', 1)
    if (argv[0] === 'uname') return out('Darwin\n')

    return out('', 1)
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  // The session runs in /repo: relative paths resolve there.
  on('fs.stat', (_$, e) => ({ value: { kind: e.path.endsWith('.md') ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: e.path.startsWith('/') ? e.path : `/repo/${e.path === '.' ? '' : e.path}`.replace(/\/$/, '') } }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') || e.path.endsWith('OPEN.md') }))
  on('fs.list', (_$, e) => {
    if (e.path.endsWith('.claude_todo')) folder = e.path

    return { value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: todo.mtime, isLink: false }] } as never
  })
  on('fs.read', () => ({ value: todo.text }))
  on('fs.write', (_$, e) => {
    setTodo(e.text as string)

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)

    return { text: e.text, context: e.context }
  })
  // Only the calls the tests make: a move_ticket must reach the mod's own handler.
  for (const tool of ['Edit', 'Read']) {
    on('tool.call', { tool }, () => {
      setTodo(edit(todo.text))

      return { result: 'ok' } as never
    })
  }
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: undefined }) as never)

  return { clock, store }
}

const open = async ($: Dollar) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}
const run = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    await clock.advance(1000)
    await settle()
  }
}
const cards = async (ui: Awaited<ReturnType<typeof open>>) => (await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg))
const keys = async (ui: Awaited<ReturnType<typeof open>>) => (await ui.findAll({ type: 'Button' })).map(button => String((button as { key?: string }).key))

/** The record another session stores; the folder and the root are this session's, read from its own record. */
type Mine = { root: string; tickets: string[]; agentTickets: string[]; planned: string[]; name?: string; seenAt: number }
const peerRecord = (mine: Mine, over: Record<string, unknown> = {}) => ({ v: 1, sessionId: 'peer-a', name: 'Fix the board', root: mine.root, tickets: [ticketOf(mine, '#t1')], agentTickets: [], planned: [], seenAt: 0, ...over })
/** The ticket identity of an item of the test file: the todo folder is the one the mod lists, noted by the fs.list fake. */
let folder = ''
const ticketOf = (_mine: Mine, key: string) => `${folder}/OPEN.md\t${key}`

test('a session stores its presence record: root, held tickets and the name Claude reported, cleaned', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [~] #T2 Review the copy')
  const ui = await open($)
  await run(clock, 6)
  const first = store.get('presence:sess-1') as Mine & { v: number; sessionId: string }
  expect(first).toMatchObject({ v: 1, sessionId: 'sess-1', tickets: [], agentTickets: [], planned: [] })
  expect(first.root).not.toBe('')
  await $.prompt.submit({ text: 'go' } as never)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T2'], session: 'My session [ab12]' } as never)
  await run(clock, 2)
  const next = store.get('presence:sess-1') as Mine
  expect(next.tickets).toEqual([ticketOf(next, '#t2')])
  expect(next.name).toBe('My session')
  // A heartbeat: the record is stored again 5 s later with a newer time.
  await run(clock, 6)
  expect((store.get('presence:sess-1') as Mine).seenAt).toBeGreaterThan(next.seenAt)
  expect(ui).toBeDefined()
})

test(' a ticket a peer holds shows in In progress with the owner tag and Send, on an open box too, as on the peer\'s own board; the claim ends when the ticket is done', async ($, on) => {
  const { clock, store } = setup($, on)
  const ui = await open($)
  await run(clock, 6)
  const mine = store.get('presence:sess-1') as Mine
  const refresh = () => (store.get('presence:sess-1') as Mine).seenAt
  // Before the peer: the ticket is open, with its Send button.
  expect((await cards(ui)).find(svg => svg.includes('#T1 Ship'))).toContain('Open: #T1')
  expect(await keys(ui)).toContain('ticket-OPEN.md-#t1')
  // The peer is in the session list and holds #T1 on an open box: its own board shows it in In progress, and so does this one.
  store.set('sessions-recent', [['peer-a', 1]])
  store.set('presence:peer-a', peerRecord(mine, { seenAt: refresh() }))
  await run(clock, 6)
  store.set('presence:peer-a', peerRecord(mine, { seenAt: refresh() }))
  await run(clock, 6)
  const onOpen = (await cards(ui)).find(svg => svg.includes('#T1 Ship'))!
  expect(onOpen).toContain('In progress: #T1')
  expect(onOpen).toContain('Peer owned')
  // The box goes to in progress: the tag, the tip, no Send.
  setTodo('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  store.set('presence:peer-a', peerRecord(mine, { seenAt: refresh() }))
  await run(clock, 6)
  store.set('presence:peer-a', peerRecord(mine, { seenAt: refresh() }))
  await run(clock, 6)
  const held = (await cards(ui)).find(svg => svg.includes('#T1 Ship'))!
  expect(held).toContain('In progress: #T1')
  expect(held).toContain('Fix the board owns this')
  expect(held).not.toContain('opacity=\\".5\\"')
  expect(held).toContain('>Peer owned</text>')
  const buttons = await keys(ui)
  // Send stays on a peer-claimed ticket: the tag means check in with the owner.
  expect(buttons).toContain('ticket-OPEN.md-#t1')
  expect(buttons).toContain('ticket-done-OPEN.md-#t1')
  expect(buttons).toContain('ticket-status-OPEN.md-#t1')
  // The other ticket is not the peer's.
  expect(buttons).toContain('ticket-OPEN.md-#t2')
  // The peer never gave its name.
  store.set('presence:peer-a', peerRecord(mine, { name: undefined, seenAt: refresh() }))
  await run(clock, 6)
  const unnamed = (await cards(ui)).find(svg => svg.includes('#T1 Ship'))!
  expect(unnamed).toContain('An unnamed peer session owns this')
  // The ticket is done: the claim ends.
  setTodo('- [x] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  store.set('presence:peer-a', peerRecord(mine, { seenAt: refresh() }))
  await run(clock, 6)
  expect((await cards(ui)).join('')).not.toContain('owns this')
})

test('a peer silent past 2 minutes still counts: its tag is dimmed and its tip says when it went inactive; a record older than 24 hours is ignored', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  const ui = await open($)
  await run(clock, 6)
  const mine = store.get('presence:sess-1') as Mine
  store.set('sessions-recent', [['peer-a', 1]])
  const seen = mine.seenAt
  store.set('presence:peer-a', peerRecord(mine, { seenAt: seen }))
  await run(clock, 6)
  expect((await cards(ui)).find(svg => svg.includes('#T1 Ship'))).not.toContain('opacity=\\".5\\"')
  // 125 s with no refresh of the peer record: past the 2 minutes.
  await run(clock, 125)
  const dim = (await cards(ui)).find(svg => svg.includes('#T1 Ship'))!
  expect(dim).toContain('opacity=\\".5\\"')
  expect(dim).toContain(`Fix the board owns this (inactive since ${clockText(seen)})`)
  expect(PEER_DIM_MS).toBe(120_000)
  // A record a day old is gone.
  store.set('presence:peer-a', peerRecord(mine, { seenAt: (store.get('presence:sess-1') as Mine).seenAt - PEER_IGNORE_MS - 1 }))
  await run(clock, 6)
  expect((await cards(ui)).find(svg => svg.includes('#T1 Ship'))).not.toContain('owns this')
})

test('a peer that refreshes its record every 5 seconds is never dimmed, however long it runs', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  const ui = await open($)
  await run(clock, 6)
  const mine = store.get('presence:sess-1') as Mine
  store.set('sessions-recent', [['peer-a', 1]])
  // 3 minutes of refreshes: the claims never change, so only the seenAt moves.
  for (let i = 0; i < 36; i += 1) {
    store.set('presence:peer-a', peerRecord(mine, { seenAt: (store.get('presence:sess-1') as Mine).seenAt }))
    await run(clock, 5)
  }
  const card = (await cards(ui)).find(svg => svg.includes('#T1 Ship'))!
  expect(card).toContain('Fix the board owns this')
  expect(card).not.toContain('inactive since')
  expect(card).not.toContain('opacity=\\".5\\"')
})

test('a ticket a peer plans stays in Queued with the Peer owned tag and "plans to work this", and no Send; it moves to In progress when the box does', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [>] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  const ui = await open($)
  await run(clock, 6)
  const mine = store.get('presence:sess-1') as Mine
  store.set('sessions-recent', [['peer-a', 1]])
  const plan = () => peerRecord(mine, { tickets: [], planned: [ticketOf(mine, '#t1')], seenAt: (store.get('presence:sess-1') as Mine).seenAt })
  store.set('presence:peer-a', plan())
  await run(clock, 6)
  store.set('presence:peer-a', plan())
  await run(clock, 6)
  const planned = (await cards(ui)).find(svg => svg.includes('#T1 Ship'))!
  expect(planned).toContain('Queued: #T1')
  expect(planned).toContain('Fix the board plans to work this')
  expect(planned).toContain('>Peer owned</text>')
  expect(await keys(ui)).toContain('ticket-OPEN.md-#t1')
  // A planned ticket whose box goes [>] to [~] stays claimed.
  setTodo('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  store.set('presence:peer-a', plan())
  await run(clock, 6)
  const started = (await cards(ui)).find(svg => svg.includes('#T1 Ship'))!
  expect(started).toContain('In progress: #T1')
  expect(started).toContain('Fix the board owns this')
  // Back to open: the claim ends.
  setTodo('- [ ] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  store.set('presence:peer-a', plan())
  await run(clock, 6)
  expect((await cards(ui)).find(svg => svg.includes('#T1 Ship'))).not.toContain('Peer owned')
})

test('an edit of the main conversation that sets a box to [>] plans the ticket; a [~] to [ ] edit is queued by the mod and planned; a hand move and a helper edit plan nothing; the claim ends with the box', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy\n- [ ] #T3 Third')
  const ui = await open($)
  await run(clock, 6)
  const planned = () => (store.get('presence:sess-1') as Mine).planned
  const path = '/repo/.claude_todo/OPEN.md'
  const id = (n: number) => `${folder}/OPEN.md\t#t${n}`
  expect(planned()).toEqual([])
  // The main conversation queues #T2 itself.
  edit = text => text.replace('- [ ] #T2', '- [>] #T2')
  await $.tool.call({ tool: 'Edit', file_path: path } as never)
  await run(clock, 6)
  expect(planned()).toEqual([id(2)])
  expect((store.get('planned:sess-1') as string[])).toEqual([id(2)])
  // A helper's edit queues #T3: not planned here.
  edit = text => text.replace('- [ ] #T3', '- [>] #T3')
  await $.tool.call({ tool: 'Edit', file_path: path, agentId: 'h1' } as never)
  await run(clock, 6)
  expect(planned()).toEqual([id(2)])
  // The main conversation sets #T1 back to open: the mod queues it, and it is planned.
  edit = text => text.replace('- [~] #T1', '- [ ] #T1')
  await $.tool.call({ tool: 'Edit', file_path: path } as never)
  await run(clock, 6)
  expect(todo.text).toContain('- [>] #T1')
  expect(planned()).toEqual([id(1), id(2)])
  // The box of #T2 goes to done: its claim ends. #T1 goes to in progress: it stays.
  edit = text => text.replace('- [>] #T2', '- [x] #T2').replace('- [>] #T1', '- [~] #T1')
  await $.tool.call({ tool: 'Edit', file_path: path } as never)
  await run(clock, 6)
  expect(planned()).toEqual([id(1)])
  expect((store.get('planned:sess-1') as string[])).toEqual([id(1)])
  // Open ends it too.
  edit = text => text.replace('- [~] #T1', '- [ ] #T1')
  setTodo(edit(todo.text))
  await run(clock, 6)
  expect(planned()).toEqual([])
  expect(ui).toBeDefined()
})

test('a board move to queued by hand plans nothing', async ($, on) => {
  const { clock, store } = setup($, on)
  const ui = await open($)
  await run(clock, 6)
  await ui.press({ key: 'ticket-queue-OPEN.md-#t1' })
  await run(clock, 6)
  expect(todo.text).toContain('- [>] #T1')
  expect((store.get('presence:sess-1') as Mine).planned).toEqual([])
})

test('a peer on another repo root, or with a malformed record, marks nothing; this session claim wins over a peer claim', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [~] #T2 Review the copy')
  const ui = await open($)
  await run(clock, 6)
  const mine = store.get('presence:sess-1') as Mine
  store.set('sessions-recent', [['peer-a', 1], ['peer-b', 1], ['peer-c', 1]])
  const refresh = () => (store.get('presence:sess-1') as Mine).seenAt
  store.set('presence:peer-a', peerRecord(mine, { root: '/elsewhere', seenAt: refresh() }))
  store.set('presence:peer-b', { v: 1, tickets: 'x' })
  store.set('presence:peer-c', 'junk')
  await run(clock, 6)
  expect((await cards(ui)).join('')).not.toContain('owns this')
  // The peer holds #T2, and this session claims #T2: the claim is this session's, with no tag.
  store.set('presence:peer-a', peerRecord(mine, { sessionId: 'peer-a', tickets: [ticketOf(mine, '#t2')], seenAt: refresh() }))
  await $.prompt.submit({ text: 'go' } as never)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T2'] } as never)
  await run(clock, 6)
  expect((await cards(ui)).join('')).not.toContain('owns this')
})

/** The notes the next main-conversation tool result carries. */
const notesOf = async ($: Dollar): Promise<string> => ((((await $.tool.call({ tool: 'Read', file_path: '/repo/x.ts' } as never)) as { context?: string[] }).context ?? []).join('\n'))

test('a planned claim brings one note, once; release drops the claim, and a second release changes nothing', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  await open($)
  await run(clock, 6)
  edit = text => text.replace('- [ ] #T2', '- [>] #T2')
  // The note rides on the result of the edit itself, or on the next call.
  const ran = (await $.tool.call({ tool: 'Edit', file_path: '/repo/.claude_todo/OPEN.md' } as never)) as { context?: string[] }
  await run(clock, 6)
  const note = `${(ran.context ?? []).join('\n')}\n${await notesOf($)}`
  expect(note).toContain('#T2 is now claimed by this session as planned work.')
  expect(note).toContain('report_progress with release: ["#T2"]')
  // Told once.
  expect(await notesOf($)).not.toContain('planned work')
  expect((store.get('presence:sess-1') as Mine).planned.length).toBe(1)
  // Release it by ID: the claim goes, the box stays queued, and nothing claims it again.
  edit = text => text
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, release: ['#T2'] } as never)
  await run(clock, 12)
  expect((store.get('presence:sess-1') as Mine).planned).toEqual([])
  expect((store.get('planned:sess-1') as string[])).toEqual([])
  expect(todo.text).toContain('- [>] #T2')
  // A helper's release changes nothing.
  edit = text => text.replace('- [>] #T2', '- [ ] #T2')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/.claude_todo/OPEN.md' } as never)
  edit = text => text.replace('- [ ] #T2', '- [>] #T2')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/.claude_todo/OPEN.md' } as never)
  await run(clock, 6)
  expect((store.get('presence:sess-1') as Mine).planned.length).toBe(1)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, release: ['#T2'], agentId: 'h1' } as never)
  await run(clock, 6)
  expect((store.get('presence:sess-1') as Mine).planned.length).toBe(1)
})

test('release drops an own claim (report_progress items) as well', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [~] #T2 Review the copy')
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T1', '#T2'] } as never)
  await run(clock, 6)
  expect((store.get('presence:sess-1') as Mine).tickets.length).toBe(2)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, release: ['#T1'] } as never)
  await run(clock, 6)
  expect((store.get('presence:sess-1') as Mine).tickets).toEqual([ticketOf(undefined as never, '#t2')])
})

test('an approved move_ticket to queued by the main conversation plans the ticket; a refused one does not', async ($, on) => {
  const { clock, store } = setup($, on)
  let answer = 'Keep it where it is'
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question

    return { result: { questions: [], answers: { [question]: answer } } } as never
  })
  await open($)
  await run(clock, 6)
  const move = () => $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'queued', reason: 'order the work' } as never)
  await move()
  await run(clock, 6)
  expect((store.get('presence:sess-1') as Mine).planned).toEqual([])
  answer = 'Move it'
  await move()
  await run(clock, 6)
  expect(todo.text).toContain('- [>] #T1')
  expect((store.get('presence:sess-1') as Mine).planned).toEqual([ticketOf(undefined as never, '#t1')])
  expect(await notesOf($)).toContain('#T1 is now claimed by this session as planned work.')
})

test('Send on a peer-claimed ticket asks the owner first (named: SendMessage to the name; unnamed: ListAgents and the repo root); it claims nothing', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  const ui = await open($)
  await run(clock, 6)
  const mine = store.get('presence:sess-1') as Mine
  store.set('sessions-recent', [['peer-a', 1]])
  const hold = (over: Record<string, unknown> = {}) => store.set('presence:peer-a', peerRecord(mine, { seenAt: (store.get('presence:sess-1') as Mine).seenAt, ...over }))
  hold()
  await run(clock, 6)
  hold()
  await run(clock, 6)
  submitted.length = 0
  await ui.press({ key: 'ticket-OPEN.md-#t1' })
  await run(clock, 2)
  const named = submitted[submitted.length - 1]!
  expect(named).toContain('is claimed by session "Fix the board"')
  expect(named).toContain('SendMessage (to: "Fix the board"')
  expect(named).toContain('the user tells you to take it anyway')
  expect(named).not.toContain('Process this todo item')
  expect((store.get('presence:sess-1') as Mine).tickets).toEqual([])
  // An unnamed owner: ask every other session.
  setTodo('- [ ] #T1 Ship the parser\n- [~] #T2 Review the copy')
  hold({ name: undefined, tickets: [ticketOf(mine, '#t2')] })
  await run(clock, 6)
  hold({ name: undefined, tickets: [ticketOf(mine, '#t2')] })
  await run(clock, 6)
  await ui.press({ key: 'ticket-OPEN.md-#t2' })
  await run(clock, 2)
  const unnamed = submitted[submitted.length - 1]!
  expect(unnamed).toContain('claimed by an unnamed peer session')
  expect(unnamed).toContain('Call ListAgents and send one SendMessage to each other session')
  expect(unnamed).toContain(`root path "${mine.root}"`)
  expect(unnamed).toContain('Do you claim this ticket?')
  expect(unnamed).toContain('Start once the "Peer owned" tag')
})

test('a ticket this session claims that a peer claims too brings one note per peer claim; the peer name is quoted', async ($, on) => {
  const { clock, store } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [~] #T2 Review the copy')
  await open($)
  await run(clock, 6)
  const mine = store.get('presence:sess-1') as Mine
  store.set('sessions-recent', [['peer-a', 1], ['peer-b', 1]])
  store.set('presence:peer-a', peerRecord(mine, { seenAt: mine.seenAt }))
  store.set('presence:peer-b', peerRecord(mine, { sessionId: 'peer-b', name: undefined, tickets: [ticketOf(mine, '#t2')], seenAt: mine.seenAt }))
  await $.prompt.submit({ text: 'go' } as never)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T1', '#T2'] } as never)
  for (let i = 0; i < 3; i += 1) {
    store.set('presence:peer-a', peerRecord(mine, { seenAt: (store.get('presence:sess-1') as Mine).seenAt }))
    store.set('presence:peer-b', peerRecord(mine, { sessionId: 'peer-b', name: undefined, tickets: [ticketOf(mine, '#t2')], seenAt: (store.get('presence:sess-1') as Mine).seenAt }))
    await run(clock, 6)
  }
  const note = await notesOf($)
  expect(note).toContain('#T1 is claimed by session "Fix the board". Check in with that session (SendMessage) before you work on it; it releases the ticket with report_progress release.')
  expect(note).toContain('#T2 is claimed by an unnamed peer session. Before you work on it, call ListAgents')
  // Once per peer claim.
  expect(await notesOf($)).not.toContain('is claimed by')
})

test('a session with no name that holds a ticket is asked once to send it; none is asked after a name arrives', async ($, on) => {
  const { clock } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  await open($)
  await run(clock, 6)
  // No ticket held and no peer: nothing is asked.
  expect(await notesOf($)).not.toContain("Send this session's name")
  await $.prompt.submit({ text: 'go' } as never)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T1'] } as never)
  await run(clock, 12)
  const note = await notesOf($)
  expect(note).toContain('Send this session\'s name: call mcp__claudeopticon__report_progress with session set to the name ListAgents shows after "This session is", without the bracketed ref.')
  expect(await notesOf($)).not.toContain("Send this session's name")
})

test('a session with no name and a peer on its root is asked; a session that sent its name is not', async ($, on) => {
  const { clock, store } = setup($, on)
  await open($)
  await run(clock, 6)
  const mine = store.get('presence:sess-1') as Mine
  store.set('sessions-recent', [['peer-a', 1]])
  store.set('presence:peer-a', peerRecord(mine, { tickets: [], seenAt: mine.seenAt }))
  await run(clock, 12)
  expect(await notesOf($)).toContain("Send this session's name")
})

test('a session that already sent its name is not asked', async ($, on) => {
  const { clock } = setup($, on)
  setTodo('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy')
  await open($)
  await $.prompt.submit({ text: 'go' } as never)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T1'], session: 'My session' } as never)
  await run(clock, 12)
  expect(await notesOf($)).not.toContain("Send this session's name")
})
