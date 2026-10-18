import { expect, test } from 'claude-code/testing'

import { bar, clip, textChildren } from '../hooks/terminal-text'

test('bar fills in proportion and always has the full width', async () => {
  expect(bar(1, 2, 10)).toBe('█████░░░░░')
  expect(bar(0, 4, 4)).toBe('░░░░')
  expect(bar(4, 4, 4)).toBe('████')
  expect(bar(1, 3, 6)).toBe('██░░░░')
})

test('bar with a total of zero is empty, and width zero is empty', async () => {
  expect(bar(0, 0, 5)).toBe('░░░░░')
  expect(bar(3, 0, 3)).toBe('░░░')
  expect(bar(1, 2, 0)).toBe('')
})

test('clip keeps text that fits, and cuts longer text to the width with three dots', async () => {
  expect(clip('abc', 3)).toBe('abc')
  expect(clip('', 5)).toBe('')
  expect(clip('abcdefghij', 8)).toBe('abcde...')
  expect(clip('abcdefghij', 8).length).toBe(8)
  expect(clip('line\r\nbreak is kept as text', 100)).toBe('line\r\nbreak is kept as text')
})

test('clip cuts accented text cleanly', async () => {
  expect(clip('äöüäöüäöü', 6)).toBe('äöü...')
})

test('bar keeps its width when done is above total or below zero', async () => {
  expect(bar(5, 4, 4)).toBe('████')
  expect(bar(9, 1, 3)).toBe('███')
  expect(bar(-2, 4, 4)).toBe('░░░░')
})

test('clip never returns more than the width, also at widths of three or less', async () => {
  expect(clip('abcdefghij', 2)).toBe('ab')
  expect(clip('abcdefghij', 3)).toBe('abc')
  expect(clip('abcdefghij', 0)).toBe('')
  expect(clip('abcdefghij', -5)).toBe('')
  expect(clip('abcdefghij', 4)).toBe('a...')
})

test('clip never cuts an emoji in half, with or without the three dots', () => {
  const text = `ab${'\u{1F600}'}cdefgh`
  // Room 6: three units and the dots; the cut at 3 falls inside the emoji.
  expect(clip(text, 6)).toBe('ab...')
  // Room 3, no dots: the cut at 3 falls inside the emoji too.
  expect(clip(text, 3)).toBe('ab')
  expect(clip(`ab${'\u{1F600}'}`, 4)).toBe(`ab${'\u{1F600}'}`)
})

test('textChildren makes every control character in a Text a space, at any depth, and leaves elements and numbers', () => {
  // C0, DEL and C1, the limits of each range; a tab and a line break part words.
  expect(textChildren('a\x01b\x1Fc\x7Fd\x85e\x9Ff')).toBe('a b c d e f')
  expect(textChildren('x\ty\nz')).toBe('x y z')
  // A lone surrogate goes; a whole pair stays; an indent stays.
  expect(textChildren(`  ok\uD800 ${'\u{1F600}'}`)).toBe(`  ok ${'\u{1F600}'}`)
  const element = { type: 'Text', props: {} }
  expect(textChildren(['  a\x1Bb', 3, element, ['c\x07']])).toEqual(['  a b', 3, element, ['c ']])
  expect(textChildren(undefined)).toBeUndefined()
})
