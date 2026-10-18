import { expect, test } from 'claude-code/testing'

import { codeOnly } from './fs-scan'
import { unroutedReads } from './read-scan'
import { unroutedWrites } from './write-scan'

/** Property: the lexer blanks comments and string text only; template holes, regular expressions and line numbers stay. */
test('UCR-121 codeOnly blanks every comment and string text, and keeps all code where it was', () => {
  const src = "const a = 1 /* x */ + 2\n// line\nconst s = '// no comment' + `/* ${f('nor')} */`\nconst r = /\\/\\/|\\*/g\n  * 3"
  const code = codeOnly(src)
  expect(code.length).toBe(src.length)
  expect(code.split('\n')).toEqual(['const a = 1         + 2', '       ', "const s = '             ' + `   ${f('   ')}   `", 'const r = /\\/\\/|\\*/g', '  * 3'])
})

/**
 * Property (UCR-121 remainder): the read scan sees a todo read written in any form the language
 * allows: optional chaining, an alias of the fs under another handle name, a call after a block
 * comment on the same line, a call on a line that starts with `*`, and a call split over lines.
 */
test('UCR-121 the read scan has no gap for optional chaining, other handle names, block comments, star lines and split calls', () => {
  const scan = (body: string) => unroutedReads({ 'register.tsx': `async function markTicket($, e) {\n${body}\n}` })
  // The verifier's p121 forms, each behind a valid first line.
  expect(scan('  await $.fs.exists(p)\n  return $?.fs?.read(p)')).toEqual(['register.tsx:3: a read outside readTodo (in markTicket)'])
  expect(scan('  const f = e.fs\n  return f.read(p)')).toEqual(['register.tsx:2: the engine fs taken whole (an alias, a destructure or an argument) (in markTicket)'])
  expect(scan("  /* todo */ const t = await $.fs.read(p).catch(() => '')")).toEqual(['register.tsx:2: a failed read caught into an empty value outside readTodo (in markTicket)'])
  expect(scan('  const n = 2\n    * (await $.fs.read(p)).length')).toEqual(['register.tsx:3: a read outside readTodo (in markTicket)'])
  // At the limit: the call split over the last lines of the file, with its catch on the line after.
  expect(unroutedReads({ 'register.tsx': "async function markTicket($) {\n  return $.fs\n    .read(p)\n    .catch(() => '')" })).toEqual(['register.tsx:3: a failed read caught into an empty value outside readTodo (in markTicket)'])
  // The excluded population: a read in a comment, in a string, and a type that names the fs, are no reads.
  expect(scan("  // $.fs.read(p)\n  /* const f = e.fs */\n  const s = 'call $.fs.read(p) here'\n  type L = EngineInterface['fs']['list']")).toEqual([])
})

/**
 * Property (UCR 5c; UCR-167, 168, 169, 175): a todo write outside `writeIfUnchanged` is found, in every
 * form the read scan sees, and only the allowed writes of files that are no todo file pass.
 */
test('UCR-167 the write scan finds every write outside writeIfUnchanged', () => {
  const scan = (body: string) => unroutedWrites({ 'register.tsx': `async function markTicket($, e) {\n${body}\n}` })
  // The defect behind a valid first case: the layer's own write, then a raw write in another function.
  expect(unroutedWrites({ 'register.tsx': 'async function writeIfUnchanged($, path, expected, next) {\n  await $.fs.write(path, next)\n}\nasync function moveBlocks($) {\n  await $.fs.write(path, text)\n}' })).toEqual(['register.tsx:5: a write outside writeIfUnchanged (in moveBlocks)'])
  // At the limit: the last line of the file, split, with optional chaining.
  expect(unroutedWrites({ 'register.tsx': 'async function rollBack($) {\n  await $?.fs\n    ?.write(target, before)' })).toEqual(['register.tsx:3: a write outside writeIfUnchanged (in rollBack)'])
  // The ways around the text: an alias, a bound method, a lookup by name, a block comment before the call.
  expect(scan('  const f = e.fs\n  await f.write(p, t)')).toEqual(['register.tsx:2: the engine fs taken whole (an alias, a destructure or an argument) (in markTicket)'])
  expect(scan('  const w = $.fs.write.bind($.fs)')[0]).toContain('register.tsx:2: ')
  expect(scan("  await $.fs['write'](p, t)")).toEqual(['register.tsx:2: the engine fs taken whole (an alias, a destructure or an argument) (in markTicket)'])
  expect(scan('  /* a */ await $.fs.write(p, t)')).toEqual(['register.tsx:2: a write outside writeIfUnchanged (in markTicket)'])
  // Inside the excluded population: an allowed categories.json write moved into another function is not allowed.
  expect(unroutedWrites({ 'register.tsx': 'async function markTicket($) {\n  await $.fs.write(name, raw)\n}' })).toEqual(['register.tsx:2: a write outside writeIfUnchanged (in markTicket)'])
  // The allowed writes where they stand, and a read or a comment, pass.
  expect(unroutedWrites({ 'register.tsx': 'async function backUpBookNow($) {\n  await $.fs.write(name, raw)\n}\nasync function x($) {\n  // $.fs.write(p, t)\n  await $.fs.read(p)\n}' })).toEqual([])
})

// ---------------------------------------------------------------- batch K3: UCR-121 remainder (8 bypass forms of verify J3/J4)

/**
 * Property (UCR-121): a call that reaches the engine fs by Reflect, by a computed or escaped name, or
 * behind a column-0 comment that names the layer function, is found by both scans.
 */
test('UCR-121 VJ-121 Reflect, computed keys, escaped names and column-0 comments are found by both scans', () => {
  const both = (body: string) => [unroutedReads({ 'register.tsx': body }), unroutedWrites({ 'register.tsx': body })]
  const fn = (inner: string) => `export async function evil($: EngineInterface, p: string) {\n${inner}\n}`
  // F1, behind a valid first case: the layer's own read, then Reflect on the handle in another function.
  const f1 = `async function readTodo($, p) {\n  return $.fs.read(p)\n}\n${fn("  const t = await Reflect.get($, 'fs').read(p)\n  await Reflect.get($, 'fs').write(p, t + 'x')")}`
  for (const found of both(f1)) {
    expect(found).toEqual(['register.tsx:5: the engine handle read through Reflect or Object (in evil)', 'register.tsx:6: the engine handle read through Reflect or Object (in evil)'])
  }
  // F2 and F6: a computed key, cast or not, on the handle.
  for (const inner of ["  const t = await ($ as any)['f' + 's'].read(p)\n  await ($ as any)['f' + 's'].write(p, t)", "  const k = 'fs' as const\n  const t = await $[k].read(p)\n  await $?.[k].write(p, t)"]) {
    for (const found of both(fn(inner))) {
      expect(found.length).toBeGreaterThan(0)
      expect(found.every(one => one.includes('the engine handle looked up by a computed key (in evil)'))).toBe(true)
    }
  }
  // F3: an escaped identifier is the plain one.
  const [r3, w3] = both(fn('  const t = await $.f\\u0073.read(p)\n  await $.f\\u{73}.wr\\u0069te(p, t)'))
  expect(r3).toEqual(['register.tsx:2: a read outside readTodo (in evil)'])
  expect(w3).toEqual(['register.tsx:3: a write outside writeIfUnchanged (in evil)'])
  // F4, at the limit: a comment at column 0 that names the layer function, then the call on the last line of the file.
  expect(unroutedWrites({ 'register.tsx': "export async function evil($, p) {\n/*\nfunction writeIfUnchanged\n*/\n  await $.fs.write(p, 'x')" })).toEqual(['register.tsx:5: a write outside writeIfUnchanged (in evil)'])
  expect(unroutedReads({ 'register.tsx': "export async function evil($, p) {\n// function readTodo\n  return $.fs.read(p).catch(() => '')\n}" })).toEqual(['register.tsx:3: a failed read caught into an empty value outside readTodo (in evil)'])
  // F5 and F5b: a file in a subfolder and a JavaScript file are scanned as any other (the gates list them: scripts/hook-sources.ts).
  const sub = { 'sub/evil.ts': fn("  await $.fs.write(p, 'x')"), 'evil.js': fn('  return $.fs.read(p)') }
  expect(unroutedWrites(sub)).toEqual(['sub/evil.ts:2: a write outside writeIfUnchanged (in evil)'])
  expect(unroutedReads(sub)).toEqual(['evil.js:2: a read outside readTodo (in evil)'])
  // Inside the excluded population: a template hole, an escaped `\$[` in a regular expression, an escaped symbol, a
  // Reflect call on another object and an array index after a call pass; an allowed entry for a computed lookup passes.
  const clean = fn("  const s = `${[1][0]}`\n  const r = /^\\$[a-z]/\n  const g = '\\u2002'\n  Reflect.get(obj, 'x')\n  const n = f($)[0]\n  const m = $.fs.read")
  expect(unroutedReads({ 'register.tsx': clean })).toEqual(['register.tsx:7: the engine fs taken whole (an alias, a destructure or an argument) (in evil)'])
  const allowed = [{ file: 'register.tsx', fn: 'evil', line: 'const v = $[key]', reason: 'test' }]
  expect(unroutedReads({ 'register.tsx': fn('  const v = $[key]') }, allowed)).toEqual([])
})

// ---------------------------------------------------------------- batch L3: UCR-233 (scope by brackets, nested destructure, all sources)

const LAYER_FN = "async function writeIfUnchanged($: EngineInterface, path: string, expected: string, next: string, opts: { folder?: string } = {}): Promise<WriteOutcome> {\n  if (expected !== next) {\n    await $.fs.write(path, next)\n  }\n\n  return { kind: 'written' }\n}\n"
const EVIL_BODY = "  const t = await $.fs.read(p)\n  await $.fs.write(p, t + 'x')\n}"

/**
 * Property (UCR-233): a call is exempt as the layer's own only when it stands inside the layer
 * function's body, found by bracket matching; a declaration the old name rule did not know, placed
 * after the layer, is a scope of its own, and a nested destructure of the engine fs is found.
 */
test('UCR-233 run3 G16, G18, G19 after writeIfUnchanged and run2 G13 nested destructure are found by both scans', () => {
  // The layer alone passes (the control): the scope ends at its own closing brace.
  expect(unroutedWrites({ 'register.tsx': LAYER_FN })).toEqual([])
  for (const [label, head] of [
    ['G16 let arrow', 'let sneakyG16 = async ($: EngineInterface, p: string) => {'],
    ['G18 generator', 'async function* sneakyG18($: EngineInterface, p: string) {'],
    ['G19 default export', 'export default async function sneakyG19($: EngineInterface, p: string) {'],
  ] as const) {
    const source = `${LAYER_FN}${head}\n${EVIL_BODY}\n`
    const writes = unroutedWrites({ 'register.tsx': source })
    const reads = unroutedReads({ 'register.tsx': source })
    expect([label, writes.length, reads.length]).toEqual([label, 1, 1])
    expect(writes[0]).toContain('register.tsx:10: a write outside writeIfUnchanged')
  }
  // At the limit: code after the layer's closing brace on the same line is outside it.
  expect(unroutedWrites({ 'register.tsx': LAYER_FN.replace(/\}\n$/, "} ; const late = async ($: EngineInterface) => {\n  await $.fs.write(p, 'x')\n}\n") })).toEqual(['register.tsx:8: a write outside writeIfUnchanged (in writeIfUnchanged)'])
  // A layer whose brackets do not balance gives no exemption: the gate fails closed.
  expect(unroutedWrites({ 'register.tsx': LAYER_FN.replace(/\}\n$/, '') })).toEqual(['register.tsx:3: a write outside writeIfUnchanged (in writeIfUnchanged)'])
  // G13: the nested destructure, in a function and inside the layer too.
  const nested = 'export async function evilG13($: EngineInterface, p: string) {\n  const { fs: { read, write } } = $\n  const t = await read(p)\n  await write(p, t)\n}'
  expect(unroutedWrites({ 'register.tsx': nested })).toEqual(['register.tsx:2: the engine fs destructured from the handle (in evilG13)'])
  expect(unroutedReads({ 'register.tsx': nested })).toEqual(['register.tsx:2: the engine fs destructured from the handle (in evilG13)'])
  expect(unroutedWrites({ 'register.tsx': LAYER_FN.replace('  if (expected', '  const { fs: { write: w } } = $\n  if (expected') })).toEqual(['register.tsx:2: the engine fs destructured from the handle (in writeIfUnchanged)'])
})

/** Property (UCR-233): a source of any `[cm]?[jt]sx?` kind, inside or outside hooks/, is scanned by name, with no exemption. */
test('UCR-233 run2 G7, G8, G9 and run3 G21: .mts, .jsx, .cjs and a module outside hooks/ are found', () => {
  const body = "export async function evil(e: any, p: string) {\n  const t = await e.fs.read(p)\n  await e.fs.write(p, t + 'x')\n}"
  for (const name of ['evil.mts', 'evil.jsx', 'evil.cjs', '../lib/evil.ts']) {
    expect(unroutedWrites({ [name]: body })).toEqual([`${name}:3: a write outside writeIfUnchanged (in evil)`])
    expect(unroutedReads({ [name]: body })).toEqual([`${name}:2: a read outside readTodo (in evil)`])
  }
  // A file outside hooks/ named like the layer's file gets no exemption: the layer is hooks/register.tsx only.
  expect(unroutedWrites({ '../lib/register.tsx': LAYER_FN })).toEqual(['../lib/register.tsx:3: a write outside writeIfUnchanged (in writeIfUnchanged)'])
})

/** Property (UCR-233): JSX tags (`</Text>`, `<B onPress={f} />`) open no regular expression, so the bracket count of a .tsx file holds. */
test('UCR-233 a JSX closing tag or self-closing tag keeps the brackets of the line', () => {
  const src = "const a = (x: string) => <Box>{x !== '' && <Text>{x}</Text>}</Box>\nconst b = <Button onPress={go} />\nconst r = /\\(/"
  const code = codeOnly(src, false, true)
  expect(code.split('\n')[0]).toContain('</Text>}</Box>')
  expect(code.split('\n')[1]).toContain('{go} />')
  // A real regular expression is still blanked in this mode: its bracket opens nothing.
  expect(code.split('\n')[2]).toBe('const r = /  /')
})

// ---------------------------------------------------------------- batch M: UCR-233 (JSX text is text)

/**
 * Property (UCR-233, batch M): in a .tsx file, the text of a JSX element is text, as a string's is: a backtick, a
 * quote, `//` or `/*` in it opens no template, string or comment, so a raw call after it is found by both scans. The
 * verifier's final-v1 H2, H3 and H4 injections, and H1 and H5.
 */
test('UCR-233 run4 H2, H3, H4 a backtick, // or /* in JSX text hides no raw write or read from either scan', () => {
  const evil = (body: string) => `export function evil($: EngineInterface, p: string) {\n${body}\n}`
  const both = (body: string) => [unroutedWrites({ 'register.tsx': evil(body) }), unroutedReads({ 'register.tsx': evil(body) })]
  const found = (line: number) => [[`register.tsx:${line}: a write outside writeIfUnchanged (in evil)`], [`register.tsx:${line + 1}: a read outside readTodo (in evil)`]]
  // H2, H4, H1 and H5: the text opens a template, a comment or a string that a second element would close.
  for (const [a, b] of [['press ` here', 'then ` there'], ['/*', '*/'], ["it's", "it's"], ['say "hi', 'bye"']]) {
    expect([a, both(`  const a = <p>${a}</p>\n  void $.fs.write(p, 'x')\n  void $.fs.read(p)\n  const b = <p>${b}</p>\n  return [a, b]`)]).toEqual([a, found(3)])
  }
  // H3: `//` in the text, then the calls on the same line.
  expect(both("  const a = <a>http://x</a>; void $.fs.write(p, 'x')\n  void $.fs.read(p)\n  return a")).toEqual(found(2))
  // Behind a valid first case: a nested element with a `{}` hole and an attribute string, then the text that hid the calls.
  expect(both("  const a = <Box title=\"a`b\">{n > 0 && <Text>{`${n}`}</Text>}<Text>` and //</Text></Box>\n  void $.fs.write(p, 'x')\n  void $.fs.read(p)\n  return a")).toEqual(found(3))
  // At the limit: the text runs to the last line of the file, and a fragment `<>` holds it.
  const code = codeOnly("const a = <>/* `x</>\nvoid $.fs.write(p)", false, false, true)
  expect(code.split('\n')).toEqual(['const a = <>     </>', 'void $.fs.write(p)'])
  // The excluded population: a comparison, a generic call and a type parameter list are no JSX, and code in a hole stays.
  expect(codeOnly('const c = a < b && c > d // x', false, false, true)).toBe('const c = a < b && c > d     ')
  expect(codeOnly("const s = useState<string>('') /* y */", false, false, true)).toBe("const s = useState<string>('')        ")
  expect(codeOnly('const f = <T,>(x: T) => x // z', false, false, true)).toBe('const f = <T,>(x: T) => x     ')
  expect(codeOnly('const e = <p>{$.fs.read(p)}</p>', false, false, true)).toBe('const e = <p>{$.fs.read(p)}</p>')
})
