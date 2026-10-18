import { expect, test } from 'claude-code/testing'

import { endsInExample } from '../hooks/example-end'

/**
 * Property: a text that ends inside an unclosed code fence or HTML comment is told
 * apart, so nothing is appended where it would stop being a ticket; a closed one is not.
 */
test('endsInExample finds an open fence or comment at the end of a text', () => {
  // The defect behind a valid first case: a closed fence and comment, then one left open.
  expect(endsInExample('- [ ] #T1 Fix\n```sh\nnpm test\n```\n<!-- a -->\n<!-- notes for later')).toBe(true)
  expect(endsInExample('- [ ] #T1 Fix\n<!-- a -->\n```sh\nnpm test')).toBe(true)
  // At the limit of the scanned range: the open start is the last line, with no line after it, and a CRLF end.
  expect(endsInExample('- [ ] #T1 Fix\n```')).toBe(true)
  expect(endsInExample('- [ ] #T1 Fix\r\n<!--\r\n')).toBe(true)
  // Inside the population the rule leaves alone: closed examples, a `<!--` in the middle of a ticket line, an empty text.
  expect(endsInExample('- [ ] #T1 Fix\n```sh\nnpm test\n```')).toBe(false)
  expect(endsInExample('- [ ] #T1 Fix\n<!-- note -->\n')).toBe(false)
  expect(endsInExample('- [ ] #T1 Strip <!-- markers')).toBe(false)
  expect(endsInExample('')).toBe(false)
})

/**
 * Property: an HTML block of types 1 to 5 left open at the end is an open example, as a comment is; a type 6
 * or 7 block (`<details>`, a lone tag) ends at the blank line that the next section starts behind, so it is none.
 */
test('endsInExample finds an open HTML block of types 1 to 5, and no type 6 or 7 block, at the end', () => {
  // The defect behind a valid first case, and at the limit (the start as the last line).
  expect(endsInExample('- [ ] #T1 Fix\n<!-- a -->\n<pre>\nsome')).toBe(true)
  expect(endsInExample('- [ ] #T1 Fix\n<?php')).toBe(true)
  expect(endsInExample('- [ ] #T1 Fix\n<![CDATA[')).toBe(true)
  // The excluded population: a closed type 1 block, a type 6 and a type 7 block (a blank line ends them), a block quote.
  expect(endsInExample('- [ ] #T1 Fix\n<pre>\nx\n</pre>')).toBe(false)
  expect(endsInExample('- [ ] #T1 Fix\n<details>\n- [ ] example\n</details>')).toBe(false)
  expect(endsInExample('- [ ] #T1 Fix\n\n<span>')).toBe(false)
  expect(endsInExample('- [ ] #T1 Fix\n\n> note')).toBe(false)
})
