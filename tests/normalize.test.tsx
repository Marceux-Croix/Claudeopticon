import { expect, test } from 'claude-code/testing'

import { normalize } from '../hooks/normalize'

test('normalize lowercases, drops Markdown marks, and collapses white space', async () => {
  expect(normalize('  Fix **The** `Parser`_now_ [x](y)  ')).toBe('fix the parsernow xy')
  expect(normalize('a\t\n b\r\n  c')).toBe('a b c')
  expect(normalize('ÄÖ Straße')).toBe('äö straße')
})

test('normalize of empty or mark-only text is empty, and plain text is unchanged', async () => {
  expect(normalize('')).toBe('')
  expect(normalize('  *_`[]()  ')).toBe('')
  expect(normalize('already plain')).toBe('already plain')
  expect(normalize('keep-dash #T001 a.b')).toBe('keep-dash #t001 a.b')
})
