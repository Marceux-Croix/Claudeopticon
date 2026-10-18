import { expect, test } from 'claude-code/testing'

import { matchPrompt, readMatchReply } from '../hooks/agent-match'

test('a match reply gives at most three in-range items, and nothing when unreadable', async () => {
  expect(readMatchReply('{"items": [2, 5, 2, 9, 1, 3]}', 5)).toEqual([1, 4, 0])
  expect(readMatchReply('Sure! {"items": []}', 5)).toEqual([])
  expect(readMatchReply('no json', 5)).toEqual([])
  expect(matchPrompt('fix the build memory', ['a', 'b'])).toContain('2. b')
})

/** True when a text holds half a surrogate pair. */
const hasLone = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)

test('the match prompt never cuts an emoji in half: the task at 2000 units, each item at 160', () => {
  // The defect at the limit of each cut, and behind a valid first item.
  const task = `${'t'.repeat(1999)}${'\u{1F600}'}tail`
  const items = ['plain item', `${'i'.repeat(159)}${'\u{1F600}'}more`]
  const prompt = matchPrompt(task, items)
  expect(hasLone(prompt)).toBe(false)
  expect(prompt).toContain('t'.repeat(1999))
  expect(prompt).toContain(`2. ${'i'.repeat(159)}\n`)
  // A text under the limit is kept whole, emoji and all.
  expect(matchPrompt(`go ${'\u{1F600}'}`, [])).toContain(`go ${'\u{1F600}'}`)
})
