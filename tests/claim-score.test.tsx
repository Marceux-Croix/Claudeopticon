import { expect, test } from 'claude-code/testing'

import { claimScore } from '../hooks/claim-score'
import { linkAgents } from '../hooks/links'
import { readClaims } from '../hooks/progress-report'
import { parseTodo } from '../hooks/todo-markdown'
import type { AgentRow, TodoFile } from '../types'

const row = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1', description: 'x', type: 'Explore', status: 'running', startedAt: 0, toolCalls: 0, brief: '', ...over,
})

test('an agent marks its own items by quote, paraphrase or ID, with no ID in its prompt', async () => {
  const items = parseTodo([
    '- [ ] Ship the new parser and run one real import, then roll it back.',
    '- [ ] Add the new contributors to the credits page.',
    '- [ ] #T9 Rotate the test signing key',
    '- [x] Finished thing about parser import rollback ship',
  ].join('\n'))
  expect(claimScore('Ship the new parser and run one real import', items[0]!)).toBe(1)
  expect(claimScore('ship new parser, real import then roll back', items[0]!)).toBeGreaterThan(0)
  expect(claimScore('#T9', items[2]!)).toBe(1)
  expect(claimScore('#T9', items[0]!)).toBe(0)
  expect(claimScore('credits', items[1]!)).toBe(0)
  const list: TodoFile[] = [{ name: 'OPEN.md', folder: '.claude_todo', mtimeMs: 1, items }]
  const links = linkAgents(list, [row({ id: 'a', brief: 'make imports work', claims: ['ship new parser, real import then roll back', 'new contributors on the credits page', '#T9'] })])
  expect(links.get('a')?.map(link => link.index)).toEqual([0, 1, 2])
  expect(readClaims({ items: ['  one ', '', 3, 'two'] })).toEqual(['one', 'two'])
  expect(readClaims({ items: [] })).toBeUndefined()
  expect(readClaims({})).toBeUndefined()
})

const itemOf = (text: string) => parseTodo(`- [ ] ${text}`)[0]!

test('a claim that is part of the item text counts from 12 characters: 11 do not, 12 and 13 do', () => {
  const item = itemOf('internationalization pipeline')
  expect(claimScore('internation', item)).toBe(0)
  expect(claimScore('internationa', item)).toBe(1)
  expect(claimScore('internationali', item)).toBe(1)
  // The item may be the shorter text: an item of 11 characters inside the claim does not count, 12 does.
  expect(claimScore('see internationa then', itemOf('internation'))).toBe(0)
  expect(claimScore('see internationa then', itemOf('internationa'))).toBe(1)
})

test('shared words count from 3: 2 shared words give nothing, 3 and 4 give the share', () => {
  const item = itemOf('alpha bravo charlie delta')
  // Each claim is out of order, so it is no part of the item text.
  expect(claimScore('bravo alpha', item)).toBe(0)
  expect(claimScore('charlie bravo alpha', item)).toBeGreaterThan(0)
  expect(claimScore('delta charlie bravo alpha', item)).toBeGreaterThan(0)
})

test('a paraphrase counts from a 70% share of the shorter word set: 6 of 10 give nothing, 7 and 8 give their share', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `w0${i}`)
  const item = itemOf(ten.join(' '))
  // k shared words in reverse order (so no part of the item text), then words the item lacks, 10 words in all.
  const claim = (k: number) => [...ten.slice(0, k).reverse(), ...Array.from({ length: 10 - k }, (_, i) => `x0${i}`)].join(' ')
  expect(claimScore(claim(6), item)).toBe(0)
  expect(claimScore(claim(7), item)).toBe(0.7)
  expect(claimScore(claim(8), item)).toBe(0.8)
})
