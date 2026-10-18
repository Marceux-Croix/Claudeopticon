import { expect, test } from 'claude-code/testing'

import { agentSvg, timelineSvg } from '../hooks/agent-cards'
import { ORCH } from '../hooks/agent-identity'
import type { View } from '../hooks/card-types'
import { readTitle } from '../hooks/progress-report'
import { fileCards } from '../hooks/todo-cards'
import { parseTodo } from '../hooks/todo-markdown'
import { buildView, columnsThatFit, ledger, orchestratorTitle, searchTodo, ticketColumns, todoLedger } from '../hooks/view-model'
import { readBook } from '../hooks/categories'
import { storedKey } from '../hooks/item-keys'
import type { AgentRow, TodoFile } from '../types'

const row = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1', description: 'x', type: 'Explore', status: 'running', startedAt: 0, toolCalls: 0, brief: '', ...over,
})

test('every item and every file is in the view, open files first, done items last', async () => {
  const many = (open: number, done: number) =>
    parseTodo([...Array.from({ length: done }, (_, i) => `- [x] Done ${i}`), ...Array.from({ length: open }, (_, i) => `- [ ] #T${i} Open item number ${i} with a long description`)].join('\n'))
  const list: TodoFile[] = [
    ...Array.from({ length: 9 }, (_, i) => ({ name: `DONE-${i}.md`, folder: '.claude_todo', mtimeMs: 100 + i, items: many(0, 30) })),
    ...Array.from({ length: 12 }, (_, i) => ({ name: `OPEN-${i}.md`, folder: '.claude_todo', mtimeMs: i, items: many(300, 20) })),
  ]
  const view = buildView(list, [row({ brief: '#t7' })], 60_000)
  expect(view.files.length).toBe(21)
  expect(view.files[0]?.name.startsWith('OPEN')).toBe(true)
  expect(view.files[20]?.name.startsWith('DONE')).toBe(true)
  const first = view.files[0]
  if (first === undefined) {
    throw new Error('no file')
  }
  expect(first.items.length).toBe(320)
  expect(first.items[0]?.text).toContain('#T7')
  expect(first.items[319]?.status).toBe('completed')
  const collapsed = fileCards(first, view, 12)
  expect(collapsed.length).toBe(1)
  const expanded = fileCards(first, view, first.items.length)
  expect(expanded.length).toBe(8)
  for (const card of expanded) {
    expect(card.source.length).toBeLessThan(100_000)
  }
})

test('the ledger keeps checked items, complete files and the archive; the counts include the archive', async () => {
  const list: TodoFile[] = [
    { name: 'OPEN.md', folder: '.claude_todo', mtimeMs: 3, items: parseTodo('- [ ] next\n- [x] shipped') },
    { name: 'DONE.md', folder: '.claude_todo', mtimeMs: 2, items: parseTodo('- [x] a\n- [x] b') },
    { name: 'archive/OLD.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] c\n- [x] d\n- [x] e'), isArchived: true },
  ]
  const view = buildView(list, [], 0)
  // OLD.md has no live file, so the board shows no row for it; the heading counts only what the board shows.
  expect([view.done, view.total, view.archived]).toEqual([3, 4, 3])
  const open = todoLedger(view, false)
  expect(open.map(file => file.name)).toEqual(['OPEN.md'])
  expect(open[0]?.items.map(item => item.text)).toEqual(['next'])
  const all = todoLedger(view, true)
  expect(all.map(file => file.name)).toEqual(['OPEN.md', 'DONE.md', 'archive/OLD.md'])
  expect(all[0]?.items.map(item => item.text)).toEqual(['next', 'shipped'])
  const shippedCard = fileCards(all[0]!, view, 12)[0]?.source ?? ''
  expect(shippedCard).toContain('text-decoration="line-through"')
  expect(fileCards(all[2]!, view, 12)[0]?.source).toContain('<g opacity=".55">')
})

// search covers open, queued and in-progress tickets only; done and archived ones are left to Show completed.
test('search finds open, queued and in-progress items by every word, never done or archived ones, and nothing for an empty query', async () => {
  const list: TodoFile[] = [
    { name: 'OPEN.md', folder: '.claude_todo', mtimeMs: 2, items: parseTodo('- [ ] Ship the new parser\n- [x] Parser test fixtures updated\n- [~] Parser speed work\n- [>] Parser error codes') },
    { name: 'archive/OLD.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] Parser fuzz run verified'), isArchived: true },
  ]
  const view = buildView(list, [], 0)
  const hits = searchTodo(view.files, 'parser')
  expect(hits.flatMap(file => file.items.map(item => item.text)).sort()).toEqual(['Parser error codes', 'Parser speed work', 'Ship the new parser'])
  expect(hits.map(file => file.name)).toEqual(['OPEN.md'])
  expect(searchTodo(view.files, 'parser ship').flatMap(file => file.items.map(item => item.text))).toEqual(['Ship the new parser'])
  expect(searchTodo(view.files, '   ')).toEqual([])
})

// the board has no Done column in any state.
test('ticket columns: In progress (with open and queued tickets a live agent works on), Queued and Open, never Done; linked first, then by category, then file order', async () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo([
    '- [ ] #T1 plain open',
    '- [ ] #T2 billing open',
    '- [~] #T3 working',
    '- [ ] #T4 legal open',
    '- [x] #T5 done one',
    '- [ ] #T6 linked open',
    '- [>] #T7 queued',
    '- [>] #T8 legal queued',
    '- [>] #T9 linked queued',
  ].join('\n')) }]
  const view = buildView(list, [row({ id: 'a', brief: '#t6 #t9' })], 0)
  const book = { categories: ['Legal', 'Billing'], items: { '#t2': 'Billing', '#t4': 'Legal', '#t8': 'Legal' } }
  const items = todoLedger(view, true)[0]!.items
  const columns = ticketColumns(items, book)
  expect(columns.map(column => column.name)).toEqual(['In progress', 'Queued', 'Open'])
  expect(columns[0]?.items.map(item => [item.key, item.status, item.heldFrom])).toEqual([['#t6', 'in_progress', 'pending'], ['#t9', 'in_progress', 'queued'], ['#t3', 'in_progress', undefined]])
  expect(columns[1]?.items.map(item => item.key)).toEqual(['#t8', '#t7'])
  expect(columns[2]?.items.map(item => item.key)).toEqual(['#t4', '#t2', '#t1'])
  expect(columns.flatMap(column => column.items).some(item => item.status === 'completed')).toBe(false)
})


test('files of one name in different folders stay two files, and each item keeps its source', async () => {
  const items = parseTodo('- [ ] #T1 Same ID\n- [x] Done thing')
  const list: TodoFile[] = [
    { name: 'TODO.md', folder: '/r/mods/x/.claude_todo', rel: 'mods/x/.claude_todo', isOther: true, mtimeMs: 5, items: parseTodo('- [~] #T1 Same ID') },
    { name: 'TODO.md', folder: '/r/.claude_todo', rel: '.claude_todo', mtimeMs: 2, items },
    { name: 'OTHER.md', folder: '/r/mods/x/.claude_todo', rel: 'mods/x/.claude_todo', isOther: true, mtimeMs: 1, items: parseTodo('- [ ] Alone') },
  ]
  const view = buildView(list, [], 0)
  expect(view.files.map(file => file.name).sort()).toEqual(['OTHER.md', 'TODO.md', 'TODO.md'])
  const mine = view.files.find(file => file.name === 'TODO.md' && file.place === '')!
  const other = view.files.find(file => file.name === 'TODO.md' && file.place === 'mods/x')!
  expect(mine.id).not.toBe(other.id)
  expect([mine.total, mine.done, mine.active]).toEqual([2, 1, 0])
  expect([other.total, other.done, other.active]).toEqual([1, 0, 1])
  expect(other.mtimeMs).toBe(5)
  expect(mine.items.map(item => item.key)).toEqual(['#t1', 'done thing'])
  expect(other.items.map(item => item.key)).toEqual(['mods/x/.claude_todo::#t1'])
  expect(mine.items.map(item => item.path)).toEqual(['.claude_todo/TODO.md', '.claude_todo/TODO.md'])
  expect(other.items.map(item => item.path)).toEqual(['mods/x/.claude_todo/TODO.md'])
  expect(other.items[0]?.folder).toBe('/r/mods/x/.claude_todo')
  expect(view.total).toBe(4)
  // A name that is unique keeps the plain name as its ID.
  expect(view.files.find(file => file.name === 'OTHER.md')?.id).toBe('OTHER.md')
  // The list view's card for one file names no folder.
  const svg = fileCards(mine, view, 12).map(card => card.source).join('')
  expect(svg).not.toContain('mods/x')
  expect(svg).toContain('>TODO.md<')
})

test('the view gives the orchestrator an owner slot after the agents, no timeline row and no share of the agent count', () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] #T1 Ship the parser\n- [~] #T3 Check the invoice') }]
  const rows = [row({ id: 'a', brief: '#t3' })]
  const running = buildView(list, rows, 0, { keys: new Set(['#t1', '#t3']), isRunning: true, toolCalls: 4, doing: 'Run the tests' })
  expect(running.files[0]?.items.map(item => item.owners)).toEqual([[ORCH], [0, ORCH]])
  expect(running.orchestrator).toMatchObject({ index: ORCH, status: 'running', isIdle: false, doing: 'Run the tests', links: ['#T1 Ship the parser', '#T3 Check the invoice'] })
  expect(running.agents.length).toBe(1)
  expect(running.live).toBe(1)
  expect(buildView(list, rows, 0, { keys: new Set(['#t1']), isRunning: false, toolCalls: 0 }).orchestrator).toMatchObject({ status: 'idle', isIdle: true })
  expect(buildView(list, rows, 0, { keys: new Set(['#nothing']), isRunning: true, toolCalls: 0 }).orchestrator).toBeUndefined()
  expect(buildView(list, rows, 0).orchestrator).toBeUndefined()
})

test('without a title the orchestrator card is titled by its first ticket, plus how many more', () => {
  expect(orchestratorTitle(undefined, ['#T1 Ship the parser'])).toBe('#T1 Ship the parser')
  expect(orchestratorTitle(undefined, ['#T1 Ship the parser', '#T2 B', '#T3 C'])).toBe('#T1 Ship the parser and 2 more')
  expect(orchestratorTitle('Release work', ['#T1 Ship the parser', '#T2 B'])).toBe('Release work')
  expect(orchestratorTitle(undefined, [])).toBe('Orchestrator')
  expect(readTitle('   ')).toBeUndefined()
  expect(readTitle(7)).toBeUndefined()
  expect(readTitle('x'.repeat(200))?.length).toBe(80)
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] #T1 Ship the parser\n- [~] #T3 Check the invoice') }]
  const make = (keys: string[], title?: string) => buildView(list, [], 0, { keys: new Set(keys), isRunning: true, toolCalls: 57, ...(title === undefined ? {} : { title }) }).orchestrator!
  expect(make(['#t1']).description).toBe('#T1 Ship the parser')
  expect(make(['#t1', '#t3']).description).toBe('#T1 Ship the parser and 1 more')
  const view = buildView(list, [], 0, { keys: new Set(['#t1']), isRunning: true, toolCalls: 57 })
  const card = agentSvg(view.orchestrator!, view)
  expect(card.source).toContain('Orchestrator\u2002·\u2002main conversation\u2002·\u200257 tool calls')
  expect(card.alt).toContain('O, Orchestrator: Running')
})

test('the counts of a file and of the heading include its same-named archive file', () => {
  const list: TodoFile[] = [
    { name: 'TODO.md', folder: '/r/.claude_todo', mtimeMs: 2, items: parseTodo('- [ ] #T1 open\n- [~] #T2 going') },
    { name: 'archive/TODO.md', folder: '/r/.claude_todo', mtimeMs: 1, items: parseTodo('- [x] #T3 a\n- [x] #T4 b\n- [ ] #T5 not closed'), isArchived: true },
    { name: 'TODO.md', folder: '/r/mods/x/.claude_todo', mtimeMs: 2, items: parseTodo('- [ ] #T1 other') },
  ]
  const view = buildView(list, [], 0)
  const row = (folder: string) => view.files.find(file => file.name === 'TODO.md' && file.items[0]?.folder === folder)
  expect([row('/r/.claude_todo')?.done, row('/r/.claude_todo')?.total]).toEqual([2, 4])
  expect([row('/r/mods/x/.claude_todo')?.done, row('/r/mods/x/.claude_todo')?.total]).toEqual([0, 1])
  expect([view.done, view.total, view.archived, view.active]).toEqual([2, 5, 2, 1])
})

// ---------------------------------------------------------------- and 

const todo = (text: string): TodoFile[] => [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo(text) }]

// ---------------------------------------------------------------- 

test('the Todo heading counts the tickets the In progress column shows', () => {
  const text = '- [ ] #T1 Ship the parser\n- [~] #T2 Check the invoice\n- [ ] #T3 Review the copy\n- [x] #T4 Done thing'
  const columnCount = (view: View) => ticketColumns(view.files[0]!.items, { categories: [], items: {} } as never)[0]!.items.length
  // State 1: an agent holds an open ticket, and one box is [~].
  const held = buildView(todo(text), [row({ brief: '#t1' })], 0)
  expect(held.active).toBe(2)
  expect(columnCount(held)).toBe(2)
  expect(held.files[0]!.active).toBe(2)
  // State 2: the orchestrator holds an open ticket.
  const orch = buildView(todo(text), [], 0, { keys: new Set(['#t3']), isRunning: true, toolCalls: 0 })
  expect(orch.active).toBe(columnCount(orch))
  expect(orch.active).toBe(2)
  // State 3: an agent holds a ticket whose box is already [~] (counted once), and an ended agent holds none.
  const both = buildView(todo(text), [row({ brief: '#t2' }), row({ id: 'e', brief: '#t3', status: 'completed', endedAt: 1 })], 0)
  expect(both.active).toBe(1)
  expect(columnCount(both)).toBe(1)
  // No one holds anything.
  expect(buildView(todo(text), [], 0).active).toBe(1)
})

test('the heading counts only archive files that pair with a live file', () => {
  const live = (name: string, text: string, folder = '.claude_todo'): TodoFile => ({ name, folder, mtimeMs: 1, items: parseTodo(text) })
  const archive = (name: string, text: string, folder = '.claude_todo'): TodoFile => ({ name: `archive/${name}`, folder, mtimeMs: 1, items: parseTodo(text), isArchived: true })
  // State 1: an archive with no live file.
  const orphan = buildView([live('OPEN.md', '- [ ] a'), archive('OLD.md', '- [x] c\n- [x] d')], [], 0)
  expect([orphan.done, orphan.total]).toEqual([0, 1])
  expect(orphan.archived).toBe(2)
  // State 2: a paired archive counts, an orphan next to it does not.
  const mixed = buildView([live('OPEN.md', '- [ ] a'), archive('OPEN.md', '- [x] c'), archive('OLD.md', '- [x] d\n- [x] e')], [], 0)
  expect([mixed.done, mixed.total]).toEqual([1, 2])
  // State 3: the same name in another folder is no pair.
  const other = buildView([live('OPEN.md', '- [ ] a'), archive('OPEN.md', '- [x] c', 'sub/.claude_todo')], [], 0)
  expect([other.done, other.total]).toEqual([0, 1])
  // The count equals what the rows of the live files add up to.
  for (const view of [orphan, mixed, other]) {
    const rows = view.files.filter(file => file.isArchived !== true)
    expect(view.done).toBe(rows.reduce((sum, file) => sum + file.done, 0))
    expect(view.total).toBe(rows.reduce((sum, file) => sum + file.total, 0))
  }
  expect(todoLedger(orphan, true).length).toBe(2)
})

// Moved from tests/register.test.tsx with ledger.
test('the ledger lists every active agent, then the finished ones, most recently ended first, grayed', async () => {
  const view = buildView(
    [],
    [
      row({ id: 'a', status: 'completed', startedAt: 0, endedAt: 50 }),
      row({ id: 'b', startedAt: 10 }),
      row({ id: 'c', status: 'failed', startedAt: 20, endedAt: 90 }),
      row({ id: 'd', startedAt: 30 }),
    ],
    100,
  )
  const hidden = ledger(view, false)
  expect(hidden.shown.map(agent => agent.index)).toEqual([1, 3])
  const all = ledger(view, true)
  expect(all.shown.map(agent => agent.index)).toEqual([1, 3, 2, 0])
  const finishedCard = agentSvg(all.finished[0] ?? all.shown[0]!, view).source
  expect(finishedCard).toContain('opacity=".55"')
  expect(finishedCard).toContain('ended 0s ago')
  expect(agentSvg(all.active[0]!, view).source).not.toContain('opacity=".55"')
  const timeline = timelineSvg(view, all.shown).source
  expect(timeline.split('<g opacity=".55">').length - 1).toBe(2)
  expect(timeline.indexOf('>A2<')).toBeLessThan(timeline.indexOf('>A3<'))
  expect(timeline.indexOf('>A4<')).toBeLessThan(timeline.indexOf('>A3<'))
  expect(timeline.indexOf('>A3<')).toBeLessThan(timeline.indexOf('>A1<'))
  expect(timelineSvg(view, hidden.shown).source).not.toContain('>A1<')
})

test('ticketColumns ranks a ticket named after a prototype member as unsorted, after the sorted ones', () => {
  const items = buildView([{ name: 'TODO.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] constructor\n- [ ] Fix the parser\n- [ ] __proto__\n- [ ] toString') }], [], 0).files[0]!.items
  expect(items.map(item => storedKey(item.key))).toEqual(['constructor', 'fix the parser', 'proto', 'tostring'])
  const book = { categories: ['Work'], items: { 'fix the parser': 'Work', tostring: 'Work' } }
  // Sorted first in category order, then the unsorted in file order: "constructor" reads no category, never Object.
  expect(ticketColumns(items as never, book)[2]!.items.map(item => item.text)).toEqual(['Fix the parser', 'toString', 'constructor', 'proto'])
  // A JSON book with a "constructor" entry ranks it by that entry.
  const read = readBook('{"categories":["Work","Later"],"items":{"constructor":"Work","fix the parser":"Later"}}')!
  expect(ticketColumns(items as never, read)[2]!.items.map(item => item.text)).toEqual(['constructor', 'Fix the parser', 'proto', 'toString'])
})


test('columnsThatFit puts as many columns side by side as keep the minimum ticket width, else one', () => {
  expect(columnsThatFit(1000, 3, 10, 300)).toBe(3)
  expect(columnsThatFit(900, 3, 10, 300)).toBe(2)
  expect(columnsThatFit(610, 3, 10, 300)).toBe(2)
  expect(columnsThatFit(609, 3, 10, 300)).toBe(1)
  expect(columnsThatFit(5000, 1, 10, 300)).toBe(1)
  expect(columnsThatFit(5000, 0, 10, 300)).toBe(1)
})
