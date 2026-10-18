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
