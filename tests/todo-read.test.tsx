import { expect, test } from 'claude-code/testing'

import { readReason, reasonOf, TodoReadError } from '../hooks/todo-read'
import { ALLOWED, unroutedReads } from './read-scan'

// ---------------------------------------------------------------- read-layer closure

test('a todo read that failed names its file and its reason', () => {
  const error = new TodoReadError('/repo/.claude_todo/C.md', 'EACCES')
  expect(error.message).toBe('/repo/.claude_todo/C.md did not read: EACCES')
  expect(error.path).toBe('/repo/.claude_todo/C.md')
  expect(readReason({ kind: 'missing' })).toBe('no such file')
  expect(readReason({ kind: 'failed', reason: 'EIO' })).toBe('EIO')
  expect(reasonOf(new Error('x'))).toBe('x')
  expect(reasonOf('y')).toBe('y')
})

const LAYER_SRC = ['async function readTodo($: EngineInterface, path: string): Promise<TodoRead> {', '  text = await $.fs.read(path)', '}'].join('\n')

/**
 * Property: a todo read outside the read layer is found by the scan, a read that catches its
 * failure into an empty value is named as such, and only the allowed reads of files that are no todo file pass.
 * The harness cannot read the real hooks (no file access in a test), so the same scan runs on them outside it.
 */
test('the read-layer scan finds every read outside readTodo, and only the allowed non-todo reads pass', () => {
  // The layer's own read, and every allowed read where it stands, pass.
  const allowedSrc: Record<string, string> = {}
  for (const one of ALLOWED) {
    allowedSrc[one.file] = `${allowedSrc[one.file] ?? ''}async function ${one.fn}() {\n  ${one.line}\n}\n`
  }
  allowedSrc['register.tsx'] = `${LAYER_SRC}\n${allowedSrc['register.tsx']}`
  expect(unroutedReads(allowedSrc)).toEqual([])
  // The defect behind a valid first case: the layer, then a function that catches a failed read into ''.
  const behind = { 'register.tsx': `${LAYER_SRC}\nasync function refreshCutIds($) {\n  const text = await $.fs.read(path).catch(() => '')\n}` }
  expect(unroutedReads(behind)).toEqual(['register.tsx:5: a failed read caught into an empty value outside readTodo (in refreshCutIds)'])
  // At the limit of the scanned range: the last line of a file, with spaces in the call, caught into undefined.
  expect(unroutedReads({ 'todo-cards.ts': 'export async function f(fs) {\nreturn fs.read (p).catch(( ) => undefined)' })).toEqual(['todo-cards.ts:2: a failed read caught into an empty value outside readTodo (in f)'])
  // Inside the excluded population: an allowed line moved into another function, or a copy of the layer's line elsewhere.
  const moved = ALLOWED[0]!
  expect(unroutedReads({ [moved.file]: `async function scanOnce() {\n  ${moved.line}\n}` })).toEqual([`${moved.file}:2: a failed read caught into an empty value outside readTodo (in scanOnce)`])
  expect(unroutedReads({ 'repo-folders.ts': LAYER_SRC })).toEqual(['repo-folders.ts:2: a read outside readTodo (in readTodo)'])
  // A read that does not swallow, but skips the layer, is found too.
  expect(unroutedReads({ 'register.tsx': 'async function markTicket($) {\n  const text = await $.fs.read(path)\n}' })).toEqual(['register.tsx:2: a read outside readTodo (in markTicket)'])
  // Every allowed read says why it is no todo read.
  expect(ALLOWED.every(one => one.reason.includes('no todo file'))).toBe(true)
})

// ---------------------------------------------------------------- 

/**
 * Property: the scan sees every read of the engine fs, also those that do not use the `fs.read(` text:
 * an alias of `$.fs`, a destructured or bound read, and a lookup by name, in the layer or out of it.
 */
test('the read scan finds reads that do not use the fs.read( text', () => {
  const scan = (body: string) => unroutedReads({ 'register.tsx': `async function markTicket($) {\n${body}\n}` })
  // The state: an alias of $.fs, then a read through it under another name.
  expect(scan('  const f = $.fs\n  const text = await f.read(path)')).toEqual(['register.tsx:2: the engine fs taken whole (an alias, a destructure or an argument) (in markTicket)'])
  // A destructured read, a bound read, and a lookup by name.
  expect(scan('  const { read } = $.fs')).toEqual(['register.tsx:2: the engine fs taken whole (an alias, a destructure or an argument) (in markTicket)'])
  expect(scan('  const r = $.fs.read.bind($.fs)')[0]).toContain('register.tsx:2: ')
  expect(scan("  const text = await $['fs'].read(path)")).toEqual(['register.tsx:2: the engine fs looked up by name (in markTicket)'])
  expect(scan('  const { fs } = $')).toEqual(['register.tsx:2: the engine fs destructured from the handle (in markTicket)'])
  expect(scan("  const text = await $.fs['read'](path)")).toEqual(['register.tsx:2: the engine fs taken whole (an alias, a destructure or an argument) (in markTicket)'])
  // At the limit: inside the layer's own function a bypass is still named (the scan cannot see what it reads).
  expect(unroutedReads({ 'register.tsx': 'async function readTodo($, path) {\n  const f = $.fs\n}' })).toEqual(['register.tsx:2: the engine fs taken whole (an alias, a destructure or an argument) (in readTodo)'])
  // The excluded population: a direct call of another fs method, a comment line, and the layer's own read.
  expect(scan('  await $.fs.write(path, text)\n  // an alias of $.fs is refused\n  const ok = await $.fs.exists(path)')).toEqual([])
  expect(unroutedReads({ 'register.tsx': 'async function readTodo($, path) {\n  const text = await $.fs.read(path)\n}' })).toEqual([])
})
