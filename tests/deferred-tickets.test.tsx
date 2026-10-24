import { expect, test } from 'claude-code/testing'

import { deferredIds } from '../hooks/deferred-tickets'

test('deferredIds names a ticket in a sentence that puts it off until later', () => {
  expect(deferredIds('I will open #T0042 up for work after the parser fix lands.')).toEqual(['T0042'])
  expect(deferredIds('Next, #t003f. Then the docs.')).toEqual(['T003F'])
  expect(deferredIds('Once the build is green I take #T0007 and #T0008.')).toEqual(['T0007', 'T0008'])
})

test('deferredIds ignores a ticket in a sentence with no word that puts work off', () => {
  expect(deferredIds('I fixed #T0042. The tests pass.')).toEqual([])
  expect(deferredIds('Later I will look at it. #T0042 is done.')).toEqual([])
})

test('deferredIds names each ticket once, and needs the # of a ticket ID', () => {
  expect(deferredIds('After lunch, #T0042. After that, #T0042 again.')).toEqual(['T0042'])
  expect(deferredIds('After this, T0042 comes next.')).toEqual([])
})

test('a dot inside a file name does not end the sentence', () => {
  expect(deferredIds('After parser.ts is fixed, take #T0042.')).toEqual(['T0042'])
  expect(deferredIds('Once parser.ts and lexer.ts land I take #T0007 next to a.b.')).toEqual(['T0007'])
  // A dot that ends the sentence still does.
  expect(deferredIds('The parser.ts is fine. #T0042 is done.')).toEqual([])
  // The limit: the name ends the text.
  expect(deferredIds('Next #T0042 for parser.ts')).toEqual(['T0042'])
})
