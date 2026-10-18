import { expect, test } from 'claude-code/testing'

import { applySortReply, BOOK_BACKUPS, bookBackups, bookItems, bookKeptBy, categoryGroups, categoryOf, emptyBook, filterNames, groupOf, isSubstantialChange, mergeRecategorized, pruneBookItems, readBook, sortPrompt, UNSORTED, usedCategories, withoutHidden } from '../hooks/categories'
import { itemKey } from '../hooks/item-keys'
import { fileCards } from '../hooks/todo-cards'
import { parseTodo } from '../hooks/todo-markdown'
import { buildView, todoLedger } from '../hooks/view-model'
import type { TodoFile } from '../types'

test('a sort reply keeps old categories and assignments, adds new ones only up to five, and drops strays', async () => {
  const current = { categories: ['Billing', 'Legal'], items: { '#t1': 'Billing' } }
  const reply = 'Sure: {"categories": ["Billing", "Legal", "Data", "Infra", "Docs", "Extra"], "assign": {"1": "Legal", "2": "Data", "3": "Extra", "4": "Docs"}}'
  const next = applySortReply(current, ['#t1', 'second item', 'third item', 'fourth item'], reply)
  expect(next?.categories).toEqual(['Billing', 'Legal', 'Data', 'Infra', 'Docs'])
  expect(next?.items).toEqual({ '#t1': 'Billing', 'second item': 'Data', 'fourth item': 'Docs' })
  expect(applySortReply(current, ['x'], 'no json here')).toBeUndefined()
  expect(sortPrompt(['Billing'], ['Do a thing'])).toContain('Existing categories, which you must keep: ["Billing"]')
  expect(itemKey({ text: 'Fix #T12 now', id: 'T12' })).toBe('#t12')
  expect(itemKey({ text: '  Fix **the**  parser ' })).toBe('fix the parser')
})

test('category view keeps one card per file, its items grouped under category headings', async () => {
  const list: TodoFile[] = [
    { name: 'A.md', folder: '.claude_todo', mtimeMs: 2, items: parseTodo('- [ ] #T1 pay vendor\n- [x] #T2 sign lease\n- [ ] #T3 new thing\n- [ ] #T5 bill client') },
    { name: 'B.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] #T4 refund flow') },
  ]
  const view = buildView(list, [], 0)
  const book = { categories: ['Legal', 'Billing'], items: { '#t1': 'Billing', '#t2': 'Legal', '#t4': 'Billing', '#t5': 'Billing' } }
  const files = categoryGroups(todoLedger(view, true), book)
  expect(files.map(file => file.name)).toEqual(['A.md', 'B.md'])
  expect(files[0]?.items.map(item => item.text)).toEqual(['#T2 sign lease', '#T1 pay vendor', '#T5 bill client', '#T3 new thing'])
  expect(files[0]?.groups).toEqual([
    { name: 'Legal', from: 0, count: 1 },
    { name: 'Billing', from: 1, count: 2 },
    { name: 'Not sorted yet', from: 3, count: 1 },
  ])
  expect(files[1]?.groups).toEqual([{ name: 'Billing', from: 0, count: 1 }])
  const card = fileCards(files[0]!, view, 12)[0]?.source ?? ''
  expect(card.indexOf('>Legal<')).toBeLessThan(card.indexOf('sign lease'))
  expect(card.indexOf('>Billing<')).toBeLessThan(card.indexOf('pay vendor'))
  expect(card).toContain('>Not sorted yet<')
})

test('hidden categories leave the views, a file left with nothing drops out, and the filter lists the names', async () => {
  const list: TodoFile[] = [
    { name: 'A.md', folder: '.claude_todo', mtimeMs: 2, items: parseTodo('- [ ] #T1 pay vendor\n- [ ] #T2 sign lease\n- [ ] #T3 unsorted thing') },
    { name: 'B.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] #T4 refund flow') },
  ]
  const view = buildView(list, [], 0)
  const book = { categories: ['Legal', 'Billing'], items: { '#t1': 'Billing', '#t2': 'Legal', '#t4': 'Billing' } }
  const files = todoLedger(view, false)
  expect(filterNames(files, book)).toEqual(['Legal', 'Billing', 'Not sorted yet'])
  expect(filterNames(files, { categories: [], items: {} })).toEqual([])
  const shown = withoutHidden(files, book, new Set(['Billing']))
  expect(shown.map(file => file.name)).toEqual(['A.md'])
  expect(shown[0]?.items.map(item => item.key)).toEqual(['#t2', '#t3'])
  expect(withoutHidden(files, book, new Set())).toEqual(files)
})

// ---------------------------------------------------------------- Recategorize

test('isSubstantialChange: a different number of groups, or a quarter of the tickets in a group that does not map', () => {
  const old = { categories: ['A', 'B'], items: { t1: 'A', t2: 'A', t3: 'B', t4: 'B', t5: 'B' } }
  const keys = ['t1', 't2', 't3', 't4', 't5']
  const next = (items: Record<string, string>) => ({ categories: [...new Set(Object.values(items))], items })
  // Renamed groups, same split: nothing moves.
  expect(isSubstantialChange(old, next({ t1: 'X', t2: 'X', t3: 'Y', t4: 'Y', t5: 'Y' }), keys)).toBe(false)
  // One of five (20%) moves: not enough.
  expect(isSubstantialChange(old, next({ t1: 'X', t2: 'X', t3: 'X', t4: 'Y', t5: 'Y' }), keys)).toBe(false)
  // Two of five (40%) move.
  expect(isSubstantialChange(old, next({ t1: 'X', t2: 'Y', t3: 'Y', t4: 'X', t5: 'Y' }), keys)).toBe(true)
  // Exactly a quarter: four tickets, one moves.
  expect(isSubstantialChange({ categories: ['A', 'B'], items: { t1: 'A', t2: 'A', t3: 'B', t4: 'B' } }, next({ t1: 'X', t2: 'X', t3: 'X', t4: 'Y' }), keys.slice(0, 4))).toBe(true)
  // A different number of groups counts at once.
  expect(isSubstantialChange(old, next({ t1: 'X', t2: 'X', t3: 'Y', t4: 'Y', t5: 'Z' }), keys)).toBe(true)
  // Tickets with no old category are an old group of their own: they all move when the new group is not that one.
  expect(isSubstantialChange({ categories: [], items: {} }, next({ t1: 'X', t2: 'Y' }), ['t1', 't2'])).toBe(true)
})

// ---------------------------------------------------------------- UCR-045

test('UCR-045 isSubstantialChange matches groups one to one: a split group is a change in three constructed states', () => {
  const make = (groups: Record<string, string[]>) => Object.fromEntries(Object.entries(groups).flatMap(([name, keys]) => keys.map(key => [key, name])))
  const next = (groups: Record<string, string[]>) => ({ categories: Object.keys(groups), items: make(groups) })
  const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`)
  // 1. The reported case, behind a valid first group: Parser (20) splits in two, Docs (2) is folded in.
  const parser = range('p', 1, 20)
  const docs = range('d', 1, 2)
  expect(isSubstantialChange(next({ Parser: parser, Docs: docs }), next({ Lexer: [...parser.slice(0, 10), ...docs], Grammar: parser.slice(10) }), [...parser, ...docs])).toBe(true)
  // 2. The limit: exactly a quarter (4 of 16) lands in a group that has no old group left; the old matching counted 3 of 16.
  const a = range('a', 1, 13)
  const b = range('b', 1, 3)
  expect(isSubstantialChange(next({ A: a, B: b }), next({ X: a.slice(4), Y: [...a.slice(0, 4), ...b] }), [...a, ...b])).toBe(true)
  // 3. The middle of three new groups: Y has no old group of its own, and the small old group C is folded into Z.
  const big = range('a', 1, 8)
  const mid = range('b', 1, 6)
  expect(isSubstantialChange(next({ A: big, B: mid, C: ['c1'] }), next({ X: big.slice(0, 4), Y: big.slice(4), Z: [...mid, 'c1'] }), [...big, ...mid, 'c1'])).toBe(true)
  // Controls: a rename, and a one-ticket drift, are still no change.
  expect(isSubstantialChange(next({ A: a, B: b }), next({ X: a, Y: b }), [...a, ...b])).toBe(false)
  expect(isSubstantialChange(next({ A: a, B: b }), next({ X: a.slice(1), Y: [a[0]!, ...b] }), [...a, ...b])).toBe(false)
})

// ---------------------------------------------------------------- UCR-012 (G1)
// Property: only a file of the book's shape is read as the book; any other JSON is damaged, so a copy
// is kept before it is written over, and an older copy is never the one written over.

const WRONG_SHAPES: [string, string][] = [
  ['a list', '[]'],
  ['a string', '"Billing"'],
  ['a key spelled wrong', '{"categorys": ["A"], "items": {}}'],
  ['categories not a list', '{"categories": "A", "items": {}}'],
  ['a category that is not a name', '{"categories": ["A", 3], "items": {}}'],
  ['items a list', '{"categories": ["A"], "items": ["A"]}'],
  ['an item that is not a name', '{"categories": ["A"], "items": {"#t1": 1}}'],
  ['null', 'null'],
]
for (const [name, raw] of WRONG_SHAPES) {
  test(`UCR-012 readBook gives no book for JSON of another shape: ${name}`, () => {
    expect(readBook(raw)).toBeUndefined()
  })
}

test('UCR-012 readBook reads a book, cut to five categories, and no book from text that is not JSON', () => {
  expect(readBook('{"categories": ["A"], "items": {"#t1": "A"}}')).toEqual({ categories: ['A'], items: { '#t1': 'A' } })
  expect(readBook('{"categories": ["A","B","C","D","E","F"], "items": {}, "extra": 1}')).toEqual({ categories: ['A', 'B', 'C', 'D', 'E'], items: {} })
  expect(readBook('{"categories": [')).toBeUndefined()
})

test('UCR-012 bookBackups names categories.json.bak first, then numbered copies, never the same name twice', () => {
  const names = bookBackups('/repo/.claude_todo/categories.json')
  expect(names.length).toBe(BOOK_BACKUPS)
  expect(names[0]).toBe('/repo/.claude_todo/categories.json.bak')
  expect(names[1]).toBe('/repo/.claude_todo/categories.json.bak.2')
  expect(new Set(names).size).toBe(names.length)
})

// ---------------------------------------------------------------- UCR-075

/**
 * Property: a Recategorize that covers only some tickets keeps the saved category of every ticket it
 * did not cover, while that category still exists; it never drops them from the book.
 */
test('UCR-075 the tickets a Recategorize did not cover keep their saved category in three constructed states', () => {
  const old = { categories: ['Code', 'Docs'], items: { '#t1': 'Code', '#t2': 'Docs', '#t301': 'Code', '#t400': 'Docs', '#t9': 'Gone' } }
  const fresh = { categories: ['Code', 'Docs', 'Infra'], items: { '#t1': 'Infra', '#t2': 'Docs' } }
  const covered = ['#t1', '#t2']
  const merged = mergeRecategorized(old, fresh, covered)
  // Behind a valid first case (the covered ones take the fresh sort), the first ticket past the cover keeps its category.
  expect(merged.items['#t1']).toBe('Infra')
  expect(merged.items['#t301']).toBe('Code')
  // At the end of the range: the last ticket keeps its category too.
  expect(merged.items['#t400']).toBe('Docs')
  // Inside the excluded population: a category that no longer exists is not kept, so the ticket is sorted again.
  expect(merged.items['#t9']).toBeUndefined()
  expect(merged.categories).toEqual(['Code', 'Docs', 'Infra'])
  // A covered ticket the fresh sort left out is not given its old category back.
  expect(mergeRecategorized(old, { categories: ['Code'], items: {} }, ['#t1']).items['#t1']).toBeUndefined()
})

test('UCR-088 the sort prompt and a new category name never cut an emoji in half', () => {
  const hasLone = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)
  // Each item at 160 units: the defect behind a valid first item, and at the limit.
  const prompt = sortPrompt([], ['plain item', `${'i'.repeat(159)}${'\u{1F600}'}more`])
  expect(hasLone(prompt)).toBe(false)
  expect(prompt).toContain(`2. ${'i'.repeat(159)}\n`)
  // A category name at 40 units.
  const name = `${'C'.repeat(39)}${'\u{1F600}'}x`
  const book = applySortReply({ categories: [], items: {} }, ['#t1'], JSON.stringify({ categories: [name], assign: { '1': 'C'.repeat(39) } }))
  expect(book?.categories).toEqual(['C'.repeat(39)])
  expect(book!.categories.some(hasLone)).toBe(false)
})

// ---------------------------------------------------------------- UCR-075, batch H4

/**
 * Property (UCR-075): a Recategorize keeps every category the fresh sort names that some ticket
 * still holds, the tickets past the covered ones included. Three states where the old filter lost a
 * category: one held only by the first ticket past the cover, one held only by the last open ticket,
 * and (excluded) one the fresh sort does not name, which is still dropped.
 */
test('UCR-075 usedCategories keeps a category held only by tickets past the covered ones, in three constructed states', () => {
  const old = { categories: ['Old', 'Late', 'Gone'], items: { '#t1': 'Old', '#t2': 'Old', '#t301': 'Late', '#t310': 'Gone', '#t9': 'Stale' } }
  const fresh = { categories: ['Old', 'New', 'Late', 'Spare'], items: { '#t1': 'Old', '#t2': 'New' } }
  // The first ticket past the cover holds Late; Spare is held by nobody.
  expect(usedCategories(old, fresh, ['#t1', '#t2'], ['#t301'])).toEqual(['Old', 'New', 'Late'])
  // Only the last open ticket holds it.
  expect(usedCategories(old, { ...fresh, categories: ['Late', 'Old', 'New'] }, ['#t1', '#t2'], ['#t305', '#t310', '#t301'])).toEqual(['Late', 'Old', 'New'])
  // Excluded: Gone is held past the cover but the fresh sort does not name it, and a closed ticket (#t9) is not in `rest`.
  expect(usedCategories(old, fresh, ['#t1', '#t2'], ['#t310'])).toEqual(['Old', 'New'])
  const merged = mergeRecategorized(old, { ...fresh, categories: usedCategories(old, fresh, ['#t1', '#t2'], ['#t301', '#t310']) }, ['#t1', '#t2'])
  expect(merged.items['#t301']).toBe('Late')
  expect(merged.items['#t310']).toBeUndefined()
})

// ---------------------------------------------------------------- loop 2, batch J5

/** Whether a string holds a character the engine refuses in a Button label. */
const hasControl = (text: string) => /[\x00-\x1F\x7F-\x9F]/.test(text)

test('UCR-154 readBook cleans control characters out of category names and of the names the items hold', () => {
  const dirty = 'Bil\u0007ling\u001B[31m'
  const clean = 'Bil ling [31m'
  // State 1: a control character in the middle of a name (the defect behind a valid first case).
  const book = readBook(JSON.stringify({ categories: [dirty, 'Legal'], items: { '#t1': dirty, '#t2': 'Legal' } }))
  expect(book).toEqual({ categories: [clean, 'Legal'], items: { '#t1': clean, '#t2': 'Legal' } })
  // State 2: the fifth name, the limit of the range, and a line break and a C1 character.
  const fifth = readBook(JSON.stringify({ categories: ['A', 'B', 'C', 'D', 'E\nF\u009Bx', 'G'], items: {} }))
  expect(fifth?.categories).toEqual(['A', 'B', 'C', 'D', 'E F x'])
  // State 3: the population the fix excludes: a name of control characters only is dropped, with the items that hold it; a name that cleans to a held one is not repeated.
  const gone = readBook(JSON.stringify({ categories: ['\u0007\u0007', 'A', 'A\u0007'], items: { '#t1': '\u0007', '#t2': 'A' } }))
  expect(gone).toEqual({ categories: ['A'], items: { '#t2': 'A' } })
  for (const name of [...(book?.categories ?? []), ...(fifth?.categories ?? []), ...Object.values(book?.items ?? {})]) {
    expect(hasControl(name)).toBe(false)
  }
})

test('UCR-154 applySortReply cleans a category name the model sends, and the assignments that name it', () => {
  const current = { categories: [] as string[], items: {} as Record<string, string> }
  for (const dirty of ['Bil\u0007ling', 'Bil\u001B[2Jling'.replace('[2J', ''), 'Bil\tling']) {
    const reply = JSON.stringify({ categories: [dirty], assign: { '1': dirty } })
    const next = applySortReply(current, ['#t1'], reply)
    expect(next?.categories.length).toBe(1)
    expect(hasControl(next!.categories[0]!)).toBe(false)
    expect(next?.items).toEqual({ '#t1': next!.categories[0] })
  }
  // The fortieth character is the limit of the cut: a name of 45 characters with a control character at 39 is cut after cleaning.
  const long = `${'x'.repeat(38)}\u0007${'y'.repeat(6)}`
  const cut = applySortReply(current, ['#t1'], JSON.stringify({ categories: [long], assign: { '1': long } }))
  expect(cut?.categories[0]).toBe(`${'x'.repeat(38)} y`)
  expect(hasControl(cut!.categories[0]!)).toBe(false)
  // A name of control characters only is no name.
  expect(applySortReply(current, ['#t1'], JSON.stringify({ categories: ['\u0007'], assign: { '1': '\u0007' } }))).toEqual({ categories: [], items: {} })
})

// ---------------------------------------------------------------- UCR-127 (J4)

/** Property: a book write keeps only the items of tickets still in a file that read, and drops nothing when a place did not read. */
test('UCR-127 pruneBookItems drops the keys of gone tickets, in three states', () => {
  const book = { categories: ['Work', 'Home'], items: { '#t1': 'Work', 'private salary review for bob': 'Home', '#t9': 'Work' } }
  const live = new Set(['#t1', '#t9'])
  // Behind a valid first case: two live keys stay, the deleted ticket's text goes; the categories stay.
  expect(pruneBookItems(book, key => live.has(key))).toEqual({ categories: ['Work', 'Home'], items: { '#t1': 'Work', '#t9': 'Work' } })
  // At the limit: every key live gives the same book back; no key live empties the items.
  expect(pruneBookItems(book, () => true)).toBe(book)
  expect(pruneBookItems(book, () => false).items).toEqual({})
  // The excluded population: a place that did not read (no keep test) drops nothing.
  expect(pruneBookItems(book, undefined)).toBe(book)
})

// ---------------------------------------------------------------- batch K3: UCR-127 remainder (folders left out of discovery)

/** Property: a book key is dropped only when its folder read this scan and does not hold it. */
test('UCR-127 VJ-127 bookKeptBy keeps the keys of folders left out, and drops stale keys of folders that read', () => {
  const held = new Set(['#t1', 'mods/x/.claude_todo::#t2'])
  const keep = bookKeptBy(held, { others: ['mods/x/.claude_todo'], hasPrimary: true })
  // Behind a valid first key: a held key stays, a stale key of a folder that read goes.
  expect(['#t1', 'mods/x/.claude_todo::#t2', '#t9', 'mods/x/.claude_todo::#t8'].map(keep)).toEqual([true, true, false, false])
  // A folder this discovery left out (git failed, an exists check failed): its keys stay, a root-level one too.
  expect(keep('mods/y/.claude_todo::#t4')).toBe(true)
  expect(keep('.claude_todo::#t4')).toBe(true)
  // The primary folder left out (or listing a linked file): its unqualified keys stay; a folder that read still prunes.
  const noPrimary = bookKeptBy(held, { others: ['mods/x/.claude_todo'], hasPrimary: false })
  expect([noPrimary('#t9'), noPrimary('mods/x/.claude_todo::#t8')]).toEqual([true, false])
  // Inside the excluded population: an unqualified key whose text holds `::` is the primary folder's, not a folder's.
  expect(keep('fix a::b in the parser')).toBe(false)
  expect(pruneBookItems({ categories: ['Work'], items: { '#t1': 'Work', '#t9': 'Work', 'mods/y/.claude_todo::#t4': 'Work' } }, keep).items).toEqual({ '#t1': 'Work', 'mods/y/.claude_todo::#t4': 'Work' })
})

// ---------------------------------------------------------------- loop 3, batch L5: UCR-210 and UCR-199 (prototype names in the book)

/** No-ID tickets named after Object.prototype members, with two plain ones (keys: constructor, proto, tostring, hasownproperty). */
const PROTO_TEXTS = ['Fix the parser', 'constructor', 'Constructor', '**constructor**', '__proto__', 'toString', 'hasOwnProperty', 'Ship it']
const protoFiles = () => todoLedger(buildView([{ name: 'TODO.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo(PROTO_TEXTS.map(text => `- [ ] ${text}`).join('\n')) }], [], 0), true)

test('categoryGroups orders each group linked, in progress, queued, open, done', () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] #T1 done\n- [ ] #T2 open\n- [>] #T3 queued\n- [~] #T4 working') }]
  const view = buildView(list, [], 0)
  const files = categoryGroups(todoLedger(view, true), { categories: [], items: {} })
  expect(files[0]?.items.map(item => item.status)).toEqual(['in_progress', 'queued', 'pending', 'completed'])
})

test('UCR-199 UCR-210 categoryGroups draws every ticket named after a prototype member, sorted or not, and filterNames offers Not sorted yet', () => {
  for (const book of [emptyBook(), { categories: ['Parser'], items: { 'fix the parser': 'Parser' } }]) {
    const out = categoryGroups(protoFiles(), book)[0]!
    // The old code drew 3 of 5 in the verifier's probe: "constructor" read Object as its category, which no group holds.
    expect(out.items.length).toBe(PROTO_TEXTS.length)
    expect(out.items.map(item => item.text).sort()).toEqual(protoFiles()[0]!.items.map(item => item.text).sort())
    expect(withoutHidden(protoFiles(), book, new Set(['Parser']))[0]!.items.length).toBe(book.categories.length === 0 ? PROTO_TEXTS.length : PROTO_TEXTS.length - 1)
  }
  // The old code saw "constructor" as sorted (Object is not undefined), so Not sorted yet was not offered with only it unsorted.
  const sorted = { categories: ['Work'], items: { 'fix the parser': 'Work', proto: 'Work', tostring: 'Work', hasownproperty: 'Work', 'ship it': 'Work' } }
  expect(filterNames(protoFiles(), sorted)).toEqual(['Work', UNSORTED])
})

test('UCR-210 categoryOf reads own string entries only, in three constructed states', () => {
  // State 1, behind a valid first key: "constructor" with no entry reads no category (the old lookup gave Object).
  const book = { categories: ['Work'], items: bookItems([['fix the parser', 'Work']]) }
  expect(categoryOf(book, 'fix the parser')).toBe('Work')
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(categoryOf(book, key)).toBeUndefined()
    expect(groupOf(book, key)).toBe(UNSORTED)
  }
  // A plain-object book (as a caller may still build one) is read the same way.
  expect(categoryOf({ categories: [], items: {} }, 'constructor')).toBeUndefined()
  // State 2, the limit: a book file whose keys are "__proto__" and "constructor" keeps both as entries (JSON.parse makes them
  // own keys; the old plain object took "__proto__" as its prototype and lost it), and they write back.
  const read = readBook('{"categories":["Work"],"items":{"__proto__":"Work","constructor":"Work"}}')!
  expect(categoryOf(read, '__proto__')).toBe('Work')
  expect(categoryOf(read, 'constructor')).toBe('Work')
  expect(Object.keys(read.items).sort()).toEqual(['__proto__', 'constructor'])
  expect(JSON.parse(JSON.stringify(read)).items).toEqual(JSON.parse('{"__proto__":"Work","constructor":"Work"}'))
  // State 3, the population the guard excludes: an entry that is not a string, or names no listed category, is no group.
  expect(categoryOf({ categories: [], items: { odd: 5 } as never }, 'odd')).toBeUndefined()
  expect(groupOf({ categories: ['Work'], items: { gone: 'Old' } }, 'gone')).toBe(UNSORTED)
})

test('UCR-210 the sort and Recategorize assign, keep and prune prototype-named tickets like any other', () => {
  const keys = ['constructor', 'proto', 'tostring', 'hasownproperty', '__proto__']
  const reply = '{"categories":["Work"],"assign":{"1":"Work","2":"Work","3":"Work","4":"Work","5":"Work"}}'
  const sorted = applySortReply(emptyBook(), keys, reply)!
  // The old code never assigned "constructor": items["constructor"] was Object, not undefined.
  for (const key of keys) {
    expect(categoryOf(sorted, key)).toBe('Work')
  }
  // A reply that assigns nothing leaves "constructor" unsorted, for the next sort.
  expect(categoryOf(applySortReply(emptyBook(), ['constructor'], '{"categories":["Work"],"assign":{}}')!, 'constructor')).toBeUndefined()
  // Recategorize: the fresh sort covers "constructor"; "__proto__" is past the covered ones and keeps its category.
  const old = { categories: ['Work'], items: bookItems([['__proto__', 'Work'], ['constructor', 'Old']]) }
  const fresh = { categories: ['Work', 'New'], items: bookItems([['constructor', 'New']]) }
  const merged = mergeRecategorized(old, fresh, ['constructor'])
  expect(categoryOf(merged, 'constructor')).toBe('New')
  expect(categoryOf(merged, '__proto__')).toBe('Work')
  expect(usedCategories(old, fresh, ['constructor'], ['__proto__'])).toEqual(['Work', 'New'])
  expect(isSubstantialChange(old, fresh, ['constructor'])).toBe(true)
  // Pruning keeps an own "__proto__" key that is still held, and drops a gone "constructor".
  const pruned = pruneBookItems(merged, key => key === '__proto__')
  expect(Object.keys(pruned.items)).toEqual(['__proto__'])
  expect(categoryOf(pruned, 'constructor')).toBeUndefined()
})
