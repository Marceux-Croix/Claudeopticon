import { expect, test } from 'claude-code/testing'

import { fileId, filePath, itemKey, keptKey, qualifiedKey, storedKey } from '../hooks/item-keys'
import { parseTodo } from '../hooks/todo-markdown'

test('fileId joins folder and name; filePath prefers rel', async () => {
  expect(fileId({ folder: '/repo/.claude_todo', name: 'A.md' })).toBe('/repo/.claude_todo/A.md')
  expect(filePath({ folder: '/repo/.claude_todo', rel: 'mods/x/.claude_todo', name: 'TODO.md' })).toBe('mods/x/.claude_todo/TODO.md')
  expect(filePath({ folder: '/repo/.claude_todo', name: 'TODO.md' })).toBe('/repo/.claude_todo/TODO.md')
})

test('itemKey uses the lowercase ID, else the normalized text cut at 200 characters', async () => {
  expect(itemKey({ text: 'x', id: 'T002B' })).toBe('#t002b')
  expect(itemKey({ text: '  Fix **The**   Parser ' })).toBe('fix the parser')
  expect(itemKey({ text: 'a'.repeat(300) }).length).toBe(200)
  expect(itemKey({ text: '' })).toBe('')
  // Same text, different case and marks, same key; different text, different key.
  expect(itemKey({ text: 'Fix X' })).toBe(itemKey({ text: 'fix *x*' }))
  expect(itemKey({ text: 'Fix X' })).not.toBe(itemKey({ text: 'Fix Y' }))
})

test('qualifiedKey adds the folder only for files outside the primary folder', async () => {
  const item = { text: 'Fix x', id: 'T0001' }
  expect(qualifiedKey({ folder: '/repo/.claude_todo' }, item)).toBe('#t0001')
  expect(qualifiedKey({ folder: '/repo/a/.claude_todo', rel: 'a/.claude_todo', isOther: true }, item)).toBe('a/.claude_todo::#t0001')
  expect(qualifiedKey({ folder: '/repo/a/.claude_todo', isOther: true }, item)).toBe('/repo/a/.claude_todo::#t0001')
})

test('an item key without an ID never ends in half an emoji', () => {
  const key = itemKey({ text: `${'k'.repeat(199)}${'\u{1F600}'} more` })
  expect(key).toBe('k'.repeat(199))
  expect(itemKey({ text: `${'k'.repeat(198)}${'\u{1F600}'} more` })).toBe(`${'k'.repeat(198)}${'\u{1F600}'}`)
})

// ---------------------------------------------------------------- batch I2: remainder

/**
 * Property: a stored key never holds a place number, so identical lines share one stored key (that of
 * the first of them), and a line added or removed above them, or a reload, never moves a stored
 * category or claim to another line.
 */
test('stored keys are first-place keys: identical lines share one, and it does not move when a line above goes', () => {
  const keys = (text: string) => parseTodo(text).map(item => keptKey({ folder: '/r/.claude_todo' }, item))
  // The verifier's state: three identical lines, then the first removed.
  expect(keys('- [ ] Fix it\n- [~] Fix it\n- [ ] Fix it')).toEqual(['fix it', 'fix it', 'fix it'])
  expect(keys('- [~] Fix it\n- [ ] Fix it')).toEqual(['fix it', 'fix it'])
  // At the limit: an ID key with a place, in another folder.
  const other = { folder: '/r/mods/y/.claude_todo', rel: 'mods/y/.claude_todo', isOther: true as const }
  expect(keptKey(other, { text: '#T5 x', id: 'T5', nth: 3 })).toBe('mods/y/.claude_todo::#t5')
  expect(storedKey('mods/y/.claude_todo::#t5\t3')).toBe('mods/y/.claude_todo::#t5')
  // The excluded population: a key with no place stays as it is, and the live key (presses) keeps its place.
  expect(storedKey('fix it')).toBe('fix it')
  expect(itemKey({ text: 'Fix it', nth: 2 })).toBe('fix it\t2')
})
