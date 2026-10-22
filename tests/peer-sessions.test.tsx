import { expect, test } from 'claude-code/testing'

import type { AgentRow, TodoFile } from '../types'
import { buildPresence, holdings, MAX_NAME, MAX_PRESENCE_TICKETS, clockText, holderName, newlyQueued, peerHolds, peerIds, PEER_DIM_MS, PEER_IGNORE_MS, peerTip, plannedKey, prunePlanned, readPlanned, readPresence, samePresence, sanitizeSessionName, ticketId } from '../hooks/peer-sessions'

const ROOT = '/repo'
const NOW = 1_000_000
const record = (over: Record<string, unknown> = {}) => ({ v: 1, sessionId: 'a', name: 'Alpha', root: ROOT, tickets: ['/repo/.claude_todo/TODO.md\t#t1'], agentTickets: [], planned: [], seenAt: NOW, ...over })
const file = (over: Partial<TodoFile> = {}): TodoFile => ({ name: 'TODO.md', folder: '/repo/.claude_todo', mtimeMs: 0, items: [{ text: '#T1 one', status: 'in_progress', id: 'T1' }], ...over })

test('ticketId is the folder path, the file and the stored item key, the same for a primary and an other folder', () => {
  const item = { text: '#T1 one', id: 'T1' }
  expect(ticketId(file(), item)).toBe('/repo/.claude_todo/TODO.md\t#t1')
  // The folder-qualified display key of another session does not enter; the place number does not either.
  expect(ticketId(file({ isOther: true, rel: 'x/.claude_todo' }), item)).toBe('/repo/.claude_todo/TODO.md\t#t1')
  expect(ticketId(file(), { text: 'same words', nth: 2 })).toBe(ticketId(file(), { text: 'same words' }))
})

test('sanitizeSessionName cuts a trailing ref, control characters and markup, and caps the length', () => {
  expect(sanitizeSessionName('Fix the board [ab12]')).toBe('Fix the board')
  expect(sanitizeSessionName('  Fix [x] the board  [ab12] ')).toBe('Fix [x] the board')
  expect(sanitizeSessionName('A\x00B\nC\x7F')).toBe('A B C')
  expect(sanitizeSessionName('<b>bold</b> `code` & more')).toBe('bbold/b code more')
  expect(sanitizeSessionName('x'.repeat(200))?.length).toBe(MAX_NAME)
  expect(sanitizeSessionName('[ab12]')).toBeUndefined()
  expect(sanitizeSessionName('  ')).toBeUndefined()
  expect(sanitizeSessionName(42)).toBeUndefined()
})

test('readPresence accepts a well formed record and drops anything malformed', () => {
  expect(readPresence(record())).toEqual(record())
  expect(readPresence(record({ name: undefined }))).toEqual({ v: 1, sessionId: 'a', root: ROOT, tickets: record().tickets, agentTickets: [], planned: [], seenAt: NOW })
  for (const bad of [null, 'x', [], 3, record({ v: 2 }), record({ sessionId: '' }), record({ sessionId: 5 }), record({ root: '' }), record({ root: 'r'.repeat(2000) }), record({ tickets: 'x' }), record({ agentTickets: undefined }), record({ seenAt: 'now' }), record({ seenAt: Number.NaN })]) {
    expect(readPresence(bad)).toBeUndefined()
  }
})

test('readPresence caps the lists and the strings, and cleans the name', () => {
  const many = Array.from({ length: 500 }, (_, i) => `t${i}`)
  const read = readPresence(record({ tickets: [...many, 7, 'z'.repeat(2000)], name: 'N<script>\x00 [r]' }))
  expect(read?.tickets.length).toBe(MAX_PRESENCE_TICKETS)
  expect(read?.tickets.every(one => one.length < 600)).toBe(true)
  expect(read?.name).toBe('Nscript')
})

test('samePresence ignores the time, not the holdings or the name', () => {
  const a = buildPresence('a', 'Alpha', ROOT, { tickets: ['t'], agentTickets: [], planned: [] }, 1)
  expect(samePresence(a, buildPresence('a', 'Alpha', ROOT, { tickets: ['t'], agentTickets: [], planned: [] }, 9))).toBe(true)
  expect(samePresence(a, buildPresence('a', 'Beta', ROOT, { tickets: ['t'], agentTickets: [], planned: [] }, 1))).toBe(false)
  expect(samePresence(a, buildPresence('a', 'Alpha', ROOT, { tickets: [], agentTickets: ['t'], planned: [] }, 1))).toBe(false)
  expect(samePresence(undefined, a)).toBe(false)
})

test('peerHolds counts live peers of the same root, by name, tickets and agent tickets alike', () => {
  const held = peerHolds([{ id: 'a', value: record({ agentTickets: ['ag'] }) }], 'me', ROOT, NOW + 1000, new Set())
  expect([...held]).toEqual([
    ['/repo/.claude_todo/TODO.md\t#t1', { name: 'Alpha', seenAt: NOW }],
    ['ag', { name: 'Alpha', seenAt: NOW }],
  ])
  const unnamed = peerHolds([{ id: 'a', value: record({ name: undefined }) }], 'me', ROOT, NOW, new Set())
  expect(unnamed.get('/repo/.claude_todo/TODO.md\t#t1')).toEqual({ seenAt: NOW })
})

test('peerHolds skips this session, another root, a record gone for a day, a record of another key and the tickets this session holds', () => {
  const t = '/repo/.claude_todo/TODO.md\t#t1'
  expect(peerHolds([{ id: 'me', value: record({ sessionId: 'me' }) }], 'me', ROOT, NOW, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: record({ root: '/other' }) }], 'me', ROOT, NOW, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: record() }], 'me', ROOT, NOW + PEER_IGNORE_MS - 1, new Set()).size).toBe(1)
  expect(peerHolds([{ id: 'a', value: record() }], 'me', ROOT, NOW + PEER_IGNORE_MS, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: record({ seenAt: NOW + PEER_IGNORE_MS }) }], 'me', ROOT, NOW, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'b', value: record() }], 'me', ROOT, NOW, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: record() }], 'me', ROOT, NOW, new Set([t])).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: { junk: true } }, { id: 'c', value: null }], 'me', ROOT, NOW, new Set()).size).toBe(0)
})

test('of two peers on one ticket the one seen last names it', () => {
  const held = peerHolds([{ id: 'a', value: record({ seenAt: NOW - 5000 }) }, { id: 'b', value: record({ sessionId: 'b', name: 'Beta' }) }], 'me', ROOT, NOW, new Set())
  expect(held.get('/repo/.claude_todo/TODO.md\t#t1')?.name).toBe('Beta')
})

test('peerIds reads both forms of the session list, without this session, a repeat or an empty ID', () => {
  expect(peerIds(['a', ['b', 5], 'me', ['a', 9], '', 7, null], 'me')).toEqual(['a', 'b'])
  expect(peerIds('x', 'me')).toEqual([])
})

test('holderName names the holder, or a peer session', () => {
  expect(holderName('Alpha')).toBe('Alpha')
  expect(holderName(undefined)).toBe('An unnamed peer session')
})

test('holdings separates the orchestrator tickets from the live agents tickets and skips done tickets', () => {
  const list = [file({ items: [{ text: '#T1 one', status: 'in_progress', id: 'T1' }, { text: '#T2 two', status: 'in_progress', id: 'T2' }, { text: '#T3 three', status: 'completed', id: 'T3' }] })]
  const row = (over: Partial<AgentRow>): AgentRow => ({ id: 'g1', description: 'work #T2', type: 'general', status: 'running', startedAt: 1, toolCalls: 0, doing: '', brief: 'work #t2', ...over })
  const mine = holdings(list, [row({})], new Set(['#t1', '#t3']))
  expect(mine.tickets).toEqual(['/repo/.claude_todo/TODO.md\t#t1'])
  expect(mine.agentTickets).toEqual(['/repo/.claude_todo/TODO.md\t#t2'])
  expect(holdings(list, [row({ status: 'completed' })], new Set()).agentTickets).toEqual([])
  expect(holdings([file({ isArchived: true })], [], new Set(['#t1'])).tickets).toEqual([])
})

test('a record without planned (0.9.16) reads as empty; a planned that is not a list is a bad record; planned is capped', () => {
  const { planned: _gone, ...old } = record()
  expect(readPresence(old)?.planned).toEqual([])
  expect(readPresence(record({ planned: 'x' }))).toBeUndefined()
  expect(readPresence(record({ planned: Array.from({ length: 500 }, (_, i) => `p${i}`) }))?.planned.length).toBe(MAX_PRESENCE_TICKETS)
})

test('samePresence sees a change of the planned list; buildPresence carries it', () => {
  const a = buildPresence('a', 'Alpha', ROOT, { tickets: [], agentTickets: [], planned: ['p'] }, 1)
  expect(a.planned).toEqual(['p'])
  expect(samePresence(a, buildPresence('a', 'Alpha', ROOT, { tickets: [], agentTickets: [], planned: [] }, 1))).toBe(false)
})

test('peerHolds counts planned tickets of a peer, and a silent record still counts until PEER_IGNORE_MS', () => {
  const held = peerHolds([{ id: 'a', value: record({ tickets: [], planned: ['pl'] }) }], 'me', ROOT, NOW + PEER_DIM_MS * 5, new Set())
  expect([...held.keys()]).toEqual(['pl'])
  expect(held.get('pl')?.seenAt).toBe(NOW)
  expect(peerHolds([{ id: 'a', value: record({ tickets: [], planned: ['pl'] }) }], 'me', ROOT, NOW, new Set(['pl'])).size).toBe(0)
  expect(PEER_DIM_MS).toBe(120_000)
  expect(PEER_IGNORE_MS).toBe(86_400_000)
})

test('holdings: a claim lives only while the box is in progress or queued; planned tickets are held the same way', () => {
  const list = [file({ items: [
    { text: '#T1 one', status: 'queued', id: 'T1' },
    { text: '#T2 two', status: 'pending', id: 'T2' },
    { text: '#T3 three', status: 'completed', id: 'T3' },
    { text: '#T4 four', status: 'in_progress', id: 'T4' },
  ] })]
  const id = (n: number) => `/repo/.claude_todo/TODO.md\t#t${n}`
  const got = holdings(list, [], new Set(['#t1', '#t2', '#t3']), new Set([id(1), id(2), id(3), id(4), 'gone']))
  expect(got.tickets).toEqual([id(1)])
  expect(got.planned).toEqual([id(1), id(4)])
  expect(holdings(list, [], new Set()).planned).toEqual([])
})

test('prunePlanned drops a planned ticket whose box is open or done, or that left its file; it keeps one in a file not listed', () => {
  const list = [file({ items: [{ text: '#T1 one', status: 'queued', id: 'T1' }, { text: '#T2 two', status: 'in_progress', id: 'T2' }, { text: '#T3 three', status: 'pending', id: 'T3' }, { text: '#T4 four', status: 'completed', id: 'T4' }] })]
  const id = (n: number) => `/repo/.claude_todo/TODO.md\t#t${n}`
  const other = '/elsewhere/TODO.md\t#t9'
  const gone = id(8)
  const kept = prunePlanned(new Set([id(1), id(2), id(3), id(4), gone, other]), list)
  expect([...kept]).toEqual([id(1), id(2), other])
  // A queued ticket going to in progress stays claimed.
  expect(prunePlanned(new Set([id(1)]), [file({ items: [{ text: '#T1 one', status: 'in_progress', id: 'T1' }] })]).has(id(1))).toBe(true)
})

test('newlyQueued lists keys that are queued after an edit and were not before', () => {
  const before = new Map([['a', 'queued'], ['b', 'in_progress'], ['c', 'pending']])
  const after = new Map([['a', 'queued'], ['b', 'queued'], ['c', 'pending'], ['d', 'queued']])
  expect(newlyQueued(before, after)).toEqual(['b', 'd'])
})

test('readPlanned and plannedKey', () => {
  expect(readPlanned(['a', 3, ''])).toEqual(['a'])
  expect(readPlanned('x')).toEqual([])
  expect(plannedKey('s1')).toBe('planned:s1')
})

test('peerTip says owns, plans to work, and adds the inactive time in local 24-hour HH:MM', () => {
  expect(peerTip({ name: 'Alpha' })).toBe('Alpha owns this')
  expect(peerTip({ name: 'Alpha', isPlanned: true })).toBe('Alpha plans to work this')
  expect(peerTip({ isPlanned: true })).toBe('An unnamed peer session plans to work this')
  const at = new Date(2026, 9, 22, 7, 5).getTime()
  expect(clockText(at)).toBe('07:05')
  expect(peerTip({ name: 'Alpha', silentSince: at })).toBe('Alpha owns this (inactive since 07:05)')
  expect(peerTip({ name: 'Alpha', isPlanned: true, silentSince: new Date(2026, 9, 22, 23, 59).getTime() })).toBe('Alpha plans to work this (inactive since 23:59)')
})
