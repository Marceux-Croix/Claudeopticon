import { expect, test } from 'claude-code/testing'

import type { AgentRow, TodoFile } from '../types'
import { buildPresence, holdings, MAX_NAME, MAX_PRESENCE_TICKETS, holderName, peerHolds, peerIds, PEER_STALE_MS, readPresence, samePresence, sanitizeSessionName, ticketId } from '../hooks/peer-sessions'

const ROOT = '/repo'
const NOW = 1_000_000
const record = (over: Record<string, unknown> = {}) => ({ v: 1, sessionId: 'a', name: 'Alpha', root: ROOT, tickets: ['/repo/.claude_todo/TODO.md\t#t1'], agentTickets: [], seenAt: NOW, ...over })
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
  expect(readPresence(record({ name: undefined }))).toEqual({ v: 1, sessionId: 'a', root: ROOT, tickets: record().tickets, agentTickets: [], seenAt: NOW })
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
  const a = buildPresence('a', 'Alpha', ROOT, { tickets: ['t'], agentTickets: [] }, 1)
  expect(samePresence(a, buildPresence('a', 'Alpha', ROOT, { tickets: ['t'], agentTickets: [] }, 9))).toBe(true)
  expect(samePresence(a, buildPresence('a', 'Beta', ROOT, { tickets: ['t'], agentTickets: [] }, 1))).toBe(false)
  expect(samePresence(a, buildPresence('a', 'Alpha', ROOT, { tickets: [], agentTickets: ['t'] }, 1))).toBe(false)
  expect(samePresence(undefined, a)).toBe(false)
})

test('peerHolds counts live peers of the same root, by name, tickets and agent tickets alike', () => {
  const held = peerHolds([{ id: 'a', value: record({ agentTickets: ['ag'] }) }], 'me', ROOT, NOW + 1000, new Set())
  expect([...held]).toEqual([
    ['/repo/.claude_todo/TODO.md\t#t1', 'Alpha'],
    ['ag', 'Alpha'],
  ])
  const unnamed = peerHolds([{ id: 'a', value: record({ name: undefined }) }], 'me', ROOT, NOW, new Set())
  expect(unnamed.get('/repo/.claude_todo/TODO.md\t#t1')).toBeUndefined()
  expect(unnamed.has('/repo/.claude_todo/TODO.md\t#t1')).toBe(true)
})

test('peerHolds skips this session, another root, a stale record, a record of another key and the tickets this session holds', () => {
  const t = '/repo/.claude_todo/TODO.md\t#t1'
  expect(peerHolds([{ id: 'me', value: record({ sessionId: 'me' }) }], 'me', ROOT, NOW, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: record({ root: '/other' }) }], 'me', ROOT, NOW, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: record() }], 'me', ROOT, NOW + PEER_STALE_MS - 1, new Set()).size).toBe(1)
  expect(peerHolds([{ id: 'a', value: record() }], 'me', ROOT, NOW + PEER_STALE_MS, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: record({ seenAt: NOW + PEER_STALE_MS }) }], 'me', ROOT, NOW, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'b', value: record() }], 'me', ROOT, NOW, new Set()).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: record() }], 'me', ROOT, NOW, new Set([t])).size).toBe(0)
  expect(peerHolds([{ id: 'a', value: { junk: true } }, { id: 'c', value: null }], 'me', ROOT, NOW, new Set()).size).toBe(0)
})

test('of two peers on one ticket the one seen last names it', () => {
  const held = peerHolds([{ id: 'a', value: record({ seenAt: NOW - 5000 }) }, { id: 'b', value: record({ sessionId: 'b', name: 'Beta' }) }], 'me', ROOT, NOW, new Set())
  expect(held.get('/repo/.claude_todo/TODO.md\t#t1')).toBe('Beta')
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
