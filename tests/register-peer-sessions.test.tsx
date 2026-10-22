// Peer sessions through the fake engine (#T008R): this session stores its presence record, reads its
// peers' records from the shared store, and marks their tickets on its board.

import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }
type Dollar = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
const PROGRESS = 'mcp__claudeopticon__report_progress'

/** A pane over one todo file and a shared store the test also writes to, as another session would. */
function setup($: Dollar, on: On) {
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
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return out('/repo\n.git\n.git\n\n')
    if (argv[0] === 'git' && argv[1] === 'worktree') return out('worktree /repo\nHEAD a\nbranch refs/heads/main\n')
    if (argv[0] === 'git' && argv[1] === 'ls-files') return out('.claude_todo/OPEN.md\0')
    if (argv[0] === 'uname') return out('Darwin\n')

    return out('', 1)
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  // The session runs in /repo: relative paths resolve there.
  on('fs.stat', (_$, e) => ({ value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: e.path.startsWith('/') ? e.path : `/repo/${e.path === '.' ? '' : e.path}`.replace(/\/$/, '') } }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', (_$, e) => {
    folder = e.path

    return { value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] } as never
  })
  on('fs.read', () => ({ value: '- [ ] #T1 Ship the parser\n- [ ] #T2 Review the copy' }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
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
type Mine = { root: string; tickets: string[]; agentTickets: string[]; name?: string; seenAt: number }
const peerRecord = (mine: Mine, over: Record<string, unknown> = {}) => ({ v: 1, sessionId: 'peer-a', name: 'Fix the board', root: mine.root, tickets: [ticketOf(mine, '#t1')], agentTickets: [], seenAt: 0, ...over })
/** The ticket identity of an item of the test file: the todo folder is the one the mod lists, noted by the fs.list fake. */
let folder = ''
const ticketOf = (_mine: Mine, key: string) => `${folder}/OPEN.md\t${key}`

test('#T008R a session stores its presence record: root, held tickets and the name Claude reported, cleaned', async ($, on) => {
  const { clock, store } = setup($, on)
  const ui = await open($)
  await run(clock, 6)
  const first = store.get('presence:sess-1') as Mine & { v: number; sessionId: string }
  expect(first).toMatchObject({ v: 1, sessionId: 'sess-1', tickets: [], agentTickets: [] })
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

test('#T008R a ticket a peer holds shows in In progress with the owner tag and no Send; it goes with the peer, by staleness', async ($, on) => {
  const { clock, store } = setup($, on)
  const ui = await open($)
  await run(clock, 6)
  const mine = store.get('presence:sess-1') as Mine
  // Before the peer: the ticket is open, with its Send button.
  expect((await cards(ui)).find(svg => svg.includes('#T1 Ship'))).toContain('Open: #T1')
  expect(await keys(ui)).toContain('ticket-OPEN.md-#t1')
  // The peer is in the session list and holds #T1.
  store.set('sessions-recent', [['peer-a', 1]])
  const now = (store.get('presence:sess-1') as Mine).seenAt
  store.set('presence:peer-a', peerRecord(mine, { seenAt: now }))
  await run(clock, 6)
  store.set('presence:peer-a', peerRecord(mine, { seenAt: (store.get('presence:sess-1') as Mine).seenAt }))
  await run(clock, 6)
  const held = (await cards(ui)).find(svg => svg.includes('#T1 Ship'))!
  expect(held).toContain('In progress: #T1')
  expect(held).toContain('Fix the board owns this')
  expect(held).toContain('>Peer owned</text>')
  const buttons = await keys(ui)
  expect(buttons).not.toContain('ticket-OPEN.md-#t1')
  expect(buttons).toContain('ticket-done-OPEN.md-#t1')
  expect(buttons).toContain('ticket-status-OPEN.md-#t1')
  // The other ticket is not the peer's.
  expect(buttons).toContain('ticket-OPEN.md-#t2')
  // The peer never gave its name.
  store.set('presence:peer-a', peerRecord(mine, { name: undefined, seenAt: (store.get('presence:sess-1') as Mine).seenAt }))
  await run(clock, 6)
  const unnamed = (await cards(ui)).find(svg => svg.includes('#T1 Ship'))!
  expect(unnamed).toContain('An unnamed peer session owns this')
  expect(unnamed).not.toContain('Fix the board owns this')
  // The peer stops refreshing: after the staleness bound the ticket is open again, with Send.
  await run(clock, 125)
  expect((await cards(ui)).find(svg => svg.includes('#T1 Ship'))).not.toContain('owns this')
  expect(await keys(ui)).toContain('ticket-OPEN.md-#t1')
})

test('#T008R a peer on another repo root, or with a malformed record, marks nothing; this session claim wins over a peer claim', async ($, on) => {
  const { clock, store } = setup($, on)
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
