import { expect, mock, test } from 'claude-code/testing'

import { labelFontSize, setLabelBase, agentLabel as labelOf, ORCH, boardHead, clock, orchestratorSvg, AGENT_COLORS, tokens, agentShare, agentSvg, fileCards, heroSvg, setWidth, ticketSvg, timelineSvg, wrap } from '../hooks/cards'
import { psPath, readKeptIds, closedBlocks, removeBlocks, addToArchive, openCommand, nextTicketIds, nextIdsLine, ticketValue, insertIds, numberedNote, archiveName, isSubstantialChange, readKeptArchived, applyRefRenames, removeDuplicateTickets, removedNote, foldParts, itemLines, renumberLines, appendSections, applyRenames, nonBlankLines, renameNote, notifiedEnd, RULES, callSummary, callDetail, orchestratorTitle, readTitle, orchestratorView, pageLabel, findTicket, moveQuestion, setBox, movesNote, statusPrompt, sendScope, PROGRESS_NOTE, turnTokens, filterNames, withoutHidden, matchPrompt, readMatchReply, ticketColumns, ticketPrompt, ticketSummary, applySortReply, claimScore, findTodoDirWith, isGlobalTodo, todoFoldersIn, repoRoots, pickFolders, findTickets, narrowTickets, MAX_FOLDERS, plainText, progressReply, readClaims, buildView, readKeptTickets, categoryGroups, describeCall, itemKey, labelNote, ledger, linkAgents, parseTodo, readProgress, searchTodo, sortPrompt, todoLedger } from '../hooks/register'
import type { AgentRow, TodoFile } from '../types'
import type { FileView } from '../hooks/cards'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

const PLAN = ['# Plan', '- [x] Write code', '- [~] #T2 Run the test suite', '- [ ] Ship the release build', 'prose', '  - [X] nested'].join('\n')

const row = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1', description: 'x', type: 'Explore', status: 'running', startedAt: 0, toolCalls: 0, brief: '', ...over,
})

test('parseTodo reads states and item IDs', async () => {
  const items = parseTodo(PLAN)
  expect(items.map(item => item.status)).toEqual(['completed', 'in_progress', 'pending', 'completed'])
  expect(items[1]?.id).toBe('T2')
  expect(items[0]?.id).toBeUndefined()
})

test('an agent links by item ID first, then by quoted item text, never once ended', async () => {
  const list: TodoFile[] = [{ name: 'PLAN.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo(PLAN) }]
  const links = linkAgents(list, [
    row({ id: 'a', brief: 'fix #t2 now' }),
    row({ id: 'b', brief: 'please: ship the release build today' }),
    row({ id: 'c', brief: '#t2', status: 'completed' }),
    row({ id: 'd', brief: 'unrelated work' }),
  ])
  expect(links.get('a')?.map(link => link.index)).toEqual([1])
  expect(links.get('b')?.map(link => link.index)).toEqual([2])
  expect(links.has('c')).toBe(false)
  expect(links.has('d')).toBe(false)
})

test('the cards are well-formed SVG with every label escaped', async () => {
  const list: TodoFile[] = [{ name: 'A<B>.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo(PLAN) }]
  const rows = [
    row({ description: 'Audit <docs> #T2', brief: '#t2', startedAt: 0 }),
    row({ id: 'b', status: 'failed', startedAt: 1000, endedAt: 5000 }),
  ]
  const view = buildView(list, rows, 9000)
  expect(view.files[0]?.items[0]?.owners).toEqual([0])
  expect(view.agents[0]?.links).toEqual(['#T2 Run the test suite'])
  const file = view.files[0]
  const agent = view.agents[0]
  if (file === undefined || agent === undefined) {
    throw new Error('view lost its file or agent')
  }
  for (const { source: svg, width, height } of [heroSvg(view), ...fileCards(file, view, 4), timelineSvg(view, view.agents), agentSvg(agent, view)]) {
    expect(width).toBeGreaterThan(0)
    expect(svg).toContain(`height="${height}"`)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg.includes('<B>')).toBe(false)
    expect(svg.includes('<docs>')).toBe(false)
    expect(svg.includes('NaN')).toBe(false)
  }
  expect(heroSvg(buildView([], [], 0)).source).not.toContain('NaN')
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

test('the cards take the width they are given, within 300 to 960 px', async () => {
  const view = buildView([], [row({})], 1000)
  setWidth(720)
  expect(timelineSvg(view, view.agents).width).toBe(720)
  setWidth(5000)
  expect(timelineSvg(view, view.agents).width).toBe(960)
  setWidth(10)
  expect(timelineSvg(view, view.agents).width).toBe(300)
  setWidth(384)
})

test('one pane shows the todo and the agents, and the link between them', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_$, e) => ({ value: !e.path.endsWith('archive') }))
  on('fs.list', () => ({ value: [{ name: 'PLAN.md', kind: 'file', size: 1, mtimeMs: 2, isLink: false }] }))
  on('fs.read', () => ({ value: PLAN }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Tests #T2', type: 'general-purpose', status: 'running' }] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Work on #T2', description: 'Tests #T2', subagentType: 'general-purpose' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'claudeopticon', surface, ...PANE })
    if (surface === 'desktop') {
      await ui.press({ key: 'todo-tickets' })
      expect((await ui.findAll({ type: 'Svg' })).length).toBe(4)
      const drawn = JSON.stringify(await ui.drawn())
      expect(drawn.indexOf('"Agents"')).toBeLessThan(drawn.indexOf('"Todo"'))
      expect(await ui.find({ type: 'Text', text: /2 of 4 done, 1 in progress/ })).toBeDefined()
    } else {
      expect(await ui.find({ type: 'Text', text: /2 of 4 done, 1 in progress/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Tests #T2/ })).toBeDefined()
      expect((await ui.findAll({ type: 'Text', text: / A1 / })).length).toBeGreaterThanOrEqual(2)
    }
    await ui.unmount()
  }
})

test('with neither todo nor agents both sections are empty, and the idle Orchestrator draws no card', async ($, on) => {
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
  expect(await ui.find({ type: 'Text', text: /No checkbox items/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /None in this session yet/ })).toBeDefined()
})

test('describeCall', async () => {
  expect(describeCall('Bash', { command: 'ls -la\nmore' })).toBe('Bash: ls -la')
})

test('each file shows its top 12 open items, and its button shows them all, then 12 again', async ($, on) => {
  mock.clock(on)
  const lines = Array.from({ length: 30 }, (_, i) => `- [${i < 10 ? 'x' : ' '}] item ${i}`).join('\n')
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'BIG.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: lines }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-tickets' })
  const items = async () => {
    const svgs = await ui.findAll({ type: 'Svg' })

    return JSON.stringify(svgs).split('item ').length - 1
  }
  expect(await items()).toBe(12)
  await ui.press({ key: 'file-toggle-BIG.md' })
  expect(await items()).toBe(20)
  await ui.press({ key: 'file-toggle-BIG.md' })
  expect(await items()).toBe(12)
})

test('readProgress keeps a report sane: whole steps, at least one planned, never more done than planned', async () => {
  expect(readProgress({ done: 3, total: 7, step: ' Run tests ' })).toEqual({ done: 3, total: 7, step: 'Run tests' })
  expect(readProgress({ done: 9, total: 4 })).toEqual({ done: 4, total: 4 })
  expect(readProgress({ done: -2, total: 0 })).toEqual({ done: 0, total: 1 })
  expect(readProgress({ done: 'x', total: 5 })).toBeUndefined()
  expect(readProgress({})).toBeUndefined()
})

test('the agents ring counts finished agents whole and running ones by their reported share', async () => {
  const view = buildView(
    [],
    [
      row({ id: 'a', status: 'completed', endedAt: 5 }),
      row({ id: 'b', progress: { done: 1, total: 4 } }),
      row({ id: 'c' }),
      row({ id: 'd', progress: { done: 3, total: 4 } }),
    ],
    10,
  )
  expect(agentShare(view.agents)).toBe(0.5)
  const card = agentSvg(view.agents[3] ?? view.agents[0]!, view).source
  expect(card).toContain('Step 4 of 4')
  expect(card).toContain('75%')
})

test('a spawned agent is asked to report its progress, once', async ($, on) => {
  mock.clock(on)
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)

    return { model: 'claude-sonnet-5-5', agentId: `a${prompts.length}` }
  })
  on('agent.list', () => ({ value: [] }))
  await $.agent.spawn({ prompt: 'Fix the parser', description: 'Parser', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ prompt: `Fix it${PROGRESS_NOTE}`, description: 'Again', subagentType: 'general-purpose' } as never)
  expect(prompts[0]).toBe(`Fix the parser${PROGRESS_NOTE}`)
  expect(prompts[1]?.split('report_progress').length).toBe(2)
})

test('the progress tool answers without running anything beneath it', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  const ran = await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 1, total: 3 } as never)
  expect(JSON.stringify(ran)).toContain('Noted.')
})

test('labelNote names each pane label the text mentions, once, and nothing for unknown labels', async () => {
  const rows = [row({ id: 'x1', description: 'Audit docs' }), row({ id: 'x2', description: 'Verify todo group B', name: 'verifier', status: 'completed' })]
  const note = labelNote('check on A2 and a1, then A2 again; A9 and BA1 and A10x are not labels', rows) ?? ''
  expect(note).toContain('- A2: "Verify todo group B" (Explore, completed; name "verifier", agent ID x2)')
  expect(note).toContain('- A1: "Audit docs" (Explore, running; agent ID x1)')
  expect(note.split('- A2').length).toBe(2)
  expect(note).not.toContain('A9')
  expect(labelNote('no labels here', rows)).toBeUndefined()
  expect(labelNote('A3', rows)).toBeUndefined()
})

test('a prompt that names a label carries the note for the model, one that does not carries none', async ($, on) => {
  mock.clock(on)
  const contexts: (readonly string[] | undefined)[] = []
  on('agent.list', () => ({ value: [{ id: 'z1', description: 'Verify todo group C', type: 'general-purpose', status: 'running' }] }))
  on('prompt.submit', (_$, e) => {
    contexts.push(e.context)

    return { text: e.text }
  })
  await $.prompt.submit({ text: 'how is A1 doing?' } as never)
  await $.prompt.submit({ text: 'how is it going?' } as never)
  expect(contexts[0]?.join('')).toContain('A1: "Verify todo group C"')
  expect(contexts[1]).toBeUndefined()
})

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

test('finished agents stay hidden until the button shows them', async ($, on) => {
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({
    value: [
      { id: 'p', description: 'Live one', type: 'Explore', status: 'running' },
      { id: 'q', description: 'Done one', type: 'Explore', status: 'completed' },
    ],
  }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.prompt.submit({ text: 'A1' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const agentCards = async () => (await ui.findAll({ type: 'Svg' })).filter(svg => /A\d, /.test(JSON.stringify(svg))).length
  expect(await agentCards()).toBe(1)
  await ui.press({ key: 'agents-toggle' })
  expect(await agentCards()).toBe(2)
  await ui.press({ key: 'agents-toggle' })
  expect(await agentCards()).toBe(1)
})

test('the ledger keeps checked items, complete files and the archive; the counts include the archive', async () => {
  const list: TodoFile[] = [
    { name: 'OPEN.md', folder: '.claude_todo', mtimeMs: 3, items: parseTodo('- [ ] next\n- [x] shipped') },
    { name: 'DONE.md', folder: '.claude_todo', mtimeMs: 2, items: parseTodo('- [x] a\n- [x] b') },
    { name: 'archive/OLD.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] c\n- [x] d\n- [x] e'), isArchived: true },
  ]
  const view = buildView(list, [], 0)
  expect([view.done, view.total, view.archived]).toEqual([6, 7, 3])
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

test('the scan reads the archive folder as finished work', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') || e.path.endsWith('.claude_todo/archive') }))
  on('fs.list', (_$, e) => ({
    value: e.path.endsWith('archive')
      ? [{ name: 'OLD.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }]
      : [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 2, isLink: false }],
  }))
  on('fs.read', (_$, e) => ({ value: e.path.endsWith('OLD.md') ? '- [x] old one\n- [x] old two' : '- [ ] new one' }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  // The archive's done tickets are in the counts, but not on the board; the toggle is gone.
  const board = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(board).not.toContain('old one')
  expect(board).toContain('Todo 2 of 3 done')
  expect(await ui.find({ key: 'todo-toggle' })).toBeUndefined()
  // Search covers the archive.
  await ui.input({ key: 'todo-search', text: 'old', kind: 'change' })
  const found = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(found).toContain('old one')
  expect(found).toContain('archive/OLD.md')
})

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

test('search finds open, done and archived items by every word, and nothing for an empty query', async () => {
  const list: TodoFile[] = [
    { name: 'OPEN.md', folder: '.claude_todo', mtimeMs: 2, items: parseTodo('- [ ] Ship the new parser\n- [x] Parser test fixtures updated') },
    { name: 'archive/OLD.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] Parser fuzz run verified'), isArchived: true },
  ]
  const view = buildView(list, [], 0)
  const hits = searchTodo(view.files, 'parser')
  expect(hits.flatMap(file => file.items).length).toBe(3)
  expect(hits.map(file => file.name)).toEqual(['OPEN.md', 'archive/OLD.md'])
  expect(searchTodo(view.files, 'parser ship').flatMap(file => file.items.map(item => item.text))).toEqual(['Ship the new parser'])
  expect(searchTodo(view.files, '   ')).toEqual([])
})

test('searching replaces the todo cards with results, and Clear search brings them back', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: '- [ ] alpha task\n- [x] beta task done\n- [ ] gamma task' }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const shown = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(await shown()).toContain('gamma task')
  // A done ticket still in a live file shows in the Done column.
  expect(await shown()).toContain('beta task done')
  await ui.input({ key: 'todo-search', text: 'beta', kind: 'change' })
  expect(await shown()).toContain('beta task done')
  expect(await shown()).not.toContain('gamma task')
  expect(await ui.find({ type: 'Text', text: /1 matching items/ })).toBeDefined()
  await ui.press({ key: 'search-clear' })
  expect(await shown()).toContain('gamma task')
})

test('the sorter asks the model once for unsorted open items and saves the book', async ($, on) => {
  mock.clock(on)
  const writes: string[] = []
  const prompts: string[] = []
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: '- [ ] #T1 pay vendor\n- [x] #T2 old done thing' }))
  on('fs.write', (_$, e) => {
    writes.push(e.text)

    return { value: undefined }
  })
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)

    return { value: { isAnswered: true, text: '{"categories": ["Billing"], "assign": {"1": "Billing"}}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  for (let i = 0; i < 20 && writes.length === 0; i += 1) {
    await Promise.resolve()
  }
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('1. #T1 pay vendor')
  expect(prompts[0]).not.toContain('old done thing')
  expect(JSON.parse(writes[0] ?? '{}')).toEqual({ categories: ['Billing'], items: { '#t1': 'Billing' } })
})

test('Arrange by category adds category headings inside each file card, and unchecking takes them away', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') || e.path.endsWith('categories.json') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', (_$, e) => ({
    value: e.path.endsWith('categories.json')
      ? '{"categories": ["Billing", "Legal"], "items": {"#t1": "Billing", "#t2": "Legal"}}'
      : '- [ ] #T1 pay vendor\n- [ ] #T2 sign lease',
  }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const shown = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  await ui.press({ key: 'todo-tickets' })
  expect(await shown()).not.toContain('>Billing<')
  await ui.press({ key: 'todo-sort' })
  expect(await shown()).toContain('>Billing<')
  expect(await shown()).toContain('>Legal<')
  expect(await shown()).toContain('OPEN.md')
  await ui.press({ key: 'todo-sort' })
  expect(await shown()).not.toContain('>Billing<')
})

test('item text wraps at spaces, splits a word too long for a line, and stops at 8 lines', async () => {
  expect(wrap('one two three four', 52, 10)).toEqual(['one two', 'three four'])
  expect(wrap('abcdefghijklmnopqrstuvwxyz', 52, 10)).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz'])
  expect(wrap('', 52, 10)).toEqual([''])
  const long = wrap(Array.from({ length: 200 }, () => 'word').join(' '), 52, 10)
  expect(long.length).toBe(8)
  expect(long[7]?.endsWith('…')).toBe(true)
  setWidth(384)
  const item = 'Write the long help text for the config command, with one example for each flag, so that a new user can start without the docs.'
  const view = buildView([{ name: 'OPEN.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo(`- [ ] ${item}`) }], [], 0)
  const card = fileCards(view.files[0]!, view, 12)[0]?.source ?? ''
  expect(card).toContain('Write the long help text')
  expect(card).toContain('docs.</tspan>')
  expect(card.split('<tspan').length - 1).toBeGreaterThan(1)
  expect(card).not.toContain('…')
})

test('long items stop at 8 lines inside one card, and one button per file shows them whole', async ($, on) => {
  mock.clock(on)
  const long = Array.from({ length: 150 }, (_, i) => `w${i}`).join(' ')
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: `- [ ] short one\n- [ ] ${long}\n- [ ] after it` }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-tickets' })
  const svgs = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(2)
  expect(await svgs()).toContain('…')
  expect(await svgs()).not.toContain('w149')
  expect((await ui.find({ key: 'file-text-OPEN.md' }))?.text).toContain('Show full text (1 long item)')
  await ui.press({ key: 'file-text-OPEN.md' })
  expect(await svgs()).toContain('w149')
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(2)
  expect((await ui.find({ key: 'file-text-OPEN.md' }))?.text).toContain('Shorten long items')
  await ui.press({ key: 'file-text-OPEN.md' })
  expect(await svgs()).not.toContain('w149')
})

test('a todo card does not change with the clock, so a redraw reloads nothing', async () => {
  const list: TodoFile[] = [{ name: 'OPEN.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [~] working on it\n- [ ] open one\n- [x] done one') }]
  const rows = [row({ id: 'a', brief: 'working on it now', startedAt: 0 })]
  const early = buildView(list, rows, 1_000)
  const late = buildView(list, rows, 7_777)
  const one = fileCards(todoLedger(early, true)[0]!, early, 12)[0]?.source
  const two = fileCards(todoLedger(late, true)[0]!, late, 12)[0]?.source
  expect(one).toBe(two)
  expect(one).not.toContain('animation-delay')
  expect(one).not.toContain('class="blink"')
  expect(one?.match(/class="k\d+"/g)?.length).toBe(2)
  expect(heroSvg(early).source).toBe(heroSvg(late).source)
})

test('an agent links to every open item its brief names by ID, and #T1 does not match #T12', async () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] #T1 update graphing\n- [ ] #T12 change codebase structure\n- [x] #T3 old one\n- [ ] #T4 other') }]
  const links = linkAgents(list, [row({ id: 'a', brief: 'architecture: #t1 and #t12, also #t3' }), row({ id: 'b', brief: 'only #t12' })])
  expect(links.get('a')?.map(link => link.item.id)).toEqual(['T1', 'T12'])
  expect(links.get('b')?.map(link => link.item.id)).toEqual(['T12'])
})

test('an item blinks its agent color, and cycles through every agent on it', async () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] #T1 update graphing\n- [ ] #T12 change codebase structure\n- [ ] #T4 nobody') }]
  const rows = [row({ id: 'a', brief: '#t1 #t12' }), row({ id: 'b', brief: '#t12' })]
  const view = buildView(list, rows, 0)
  const [blue, orange] = AGENT_COLORS
  const card = fileCards(view.files[0]!, view, 12)[0]?.source ?? ''
  expect(card).toMatch(new RegExp(`@keyframes k\\d\\{0\\.00%\\{fill:${blue};opacity:1\\}50\\.00%\\{fill:${blue};opacity:\\.25\\}\\}`))
  expect(card).toMatch(new RegExp(`0\\.00%\\{fill:${blue};opacity:1\\}25\\.00%\\{fill:${blue};opacity:\\.25\\}50\\.00%\\{fill:${orange};opacity:1\\}75\\.00%\\{fill:${orange};opacity:\\.25\\}`))
  expect(card).toContain('2.4s steps(1,end) infinite')
  expect(card).toContain('prefers-reduced-motion:reduce){.k')
  const agentCard = agentSvg(view.agents[0]!, view).source
  expect(agentCard).toContain('#T1 update graphing')
  expect(agentCard).toContain('#T12 change codebase structure')
  expect(agentCard).toContain(`fill:${blue};opacity:1`)
  expect(fileCards(view.files[0]!, view, 12)[0]?.source).toBe(card)
})

test('an agent marks its own items by quote, paraphrase or ID, with no ID in its prompt', async () => {
  const items = parseTodo([
    '- [ ] Ship the new parser and run one real import, then roll it back.',
    '- [ ] Add the new contributors to the credits page.',
    '- [ ] #T9 Rotate the test signing key',
    '- [x] Finished thing about parser import rollback ship',
  ].join('\n'))
  expect(claimScore('Ship the new parser and run one real import', items[0]!)).toBe(1)
  expect(claimScore('ship new parser, real import then roll back', items[0]!)).toBeGreaterThan(0)
  expect(claimScore('#T9', items[2]!)).toBe(1)
  expect(claimScore('#T9', items[0]!)).toBe(0)
  expect(claimScore('credits', items[1]!)).toBe(0)
  const list: TodoFile[] = [{ name: 'OPEN.md', folder: '.claude_todo', mtimeMs: 1, items }]
  const links = linkAgents(list, [row({ id: 'a', brief: 'make imports work', claims: ['ship new parser, real import then roll back', 'new contributors on the credits page', '#T9'] })])
  expect(links.get('a')?.map(link => link.index)).toEqual([0, 1, 2])
  expect(readClaims({ items: ['  one ', '', 3, 'two'] })).toEqual(['one', 'two'])
  expect(readClaims({ items: [] })).toBeUndefined()
  expect(readClaims({})).toBeUndefined()
})

test('the prompt note asks each agent to name its todo items, and the claim field reaches the tool schema', async () => {
  expect(PROGRESS_NOTE).toContain('also pass items')
  expect(PROGRESS_NOTE).toContain('#T ID')
  expect(PROGRESS_NOTE).toContain('pass items again only if they change')
})

test('the progress reply asks an agent to confirm its claim when one is due, and says only Noted otherwise', async () => {
  expect(progressReply(['fix the parser'], false)).toBe('Noted.')
  expect(progressReply(['fix the parser', 'ship it'], true)).toBe('Noted. You said you handle: "fix the parser"; "ship it". If that changed, pass the current items in your next report.')
  expect(progressReply(undefined, true)).toContain('pass them as items')
})

test('the minute resync catches an edit that kept the file mtime', async ($, on) => {
  const clock = mock.clock(on)
  let text = '- [ ] first version'
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 5, isLink: false }] }))
  on('fs.read', () => ({ value: text }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const shown = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(await shown()).toContain('first version')
  text = '- [ ] second version'
  await clock.advance(5_000)
  expect(await shown()).toContain('first version')
  await clock.advance(60_000)
  expect(await shown()).toContain('second version')
})

test('item text drops Markdown bold and strike markers, and keeps the rest', async () => {
  expect(plainText('**Docs pass:** step 6 done, ~~old~~ `code` stays')).toBe('Docs pass: step 6 done, old `code` stays')
  expect(parseTodo('- [~] **Smoke test:** passed')[0]?.text).toBe('Smoke test: passed')
})

test('the todo folder is the repo root one, the main checkout one from a worktree, and never the global one', async () => {
  const fake = (layout: Record<string, 'dir' | 'file'>, real: Record<string, string> = {}) => ({
    exists: async (path: string) => layout[path] !== undefined,
    kind: async (path: string) => layout[path],
    realPath: async (path: string) => real[path],
    read: async () => 'gitdir: /repo/.git/worktrees/x\n',
  })
  // The nearest todo wins, up to the repo root: a subfolder's own, else the root's.
  expect(await findTodoDirWith(fake({ '../../.git': 'dir', '../../.claude_todo': 'dir', '.claude_todo': 'dir' }))).toBe('.claude_todo')
  expect(await findTodoDirWith(fake({ '../../.git': 'dir', '../.claude_todo': 'dir' }))).toBe('../.claude_todo')
  expect(await findTodoDirWith(fake({ '../../.git': 'dir', '../../.claude_todo': 'dir' }))).toBe('../../.claude_todo')
  // Above the repo root, nothing counts.
  expect(await findTodoDirWith(fake({ '.git': 'dir', '../.claude_todo': 'dir' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.git': 'file', '/repo/.claude_todo': 'dir' }))).toBe('/repo/.claude_todo')
  expect(await findTodoDirWith(fake({ '.git': 'dir' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.claude_todo': 'dir' }, { '.claude_todo': '/home/someone/.claude/.claude_todo' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.git': 'dir', '.claude_todo': 'dir' }, { '.claude_todo': '/home/someone/.claude/.claude_todo' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '../.claude_todo': 'dir' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.claude_todo': 'dir' }))).toBe('.claude_todo')
  expect(isGlobalTodo('/home/a/.claude/.claude_todo')).toBe(true)
  expect(isGlobalTodo('/home/a/project/.claude_todo')).toBe(false)
  expect(isGlobalTodo('/home/a/.claude/.claude_todo/')).toBe(true)
  expect(isGlobalTodo('/root/.claude/.claude_todo')).toBe(true)
  // A project's own .claude/.claude_todo is not the global folder.
  expect(isGlobalTodo('/home/a/project/.claude/.claude_todo')).toBe(false)
  expect(isGlobalTodo('/repo/.claude/.claude_todo')).toBe(false)
  expect(await findTodoDirWith(fake({ '.git': 'dir', '.claude_todo': 'dir' }, { '.claude_todo': '/home/a/proj/.claude/.claude_todo' }))).toBe('.claude_todo')
})

test('ticket view: an open ticket sends itself to Claude once, then asks for status; in progress asks for status; done has no button', async ($, on) => {
  mock.clock(on)
  const sent: string[] = []
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: '- [ ] Ship the new parser\n- [~] Build the release notes\n- [x] Old finished thing' }))
  on('agent.list', () => ({ value: [] }))
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const ticket = 'ticket-OPEN.md-ship the new parser'
  const svgs = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect((await ui.find({ key: ticket }))?.text).toContain('\u22D9')
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('Send to Claude')
  expect(await svgs()).toContain('Ship the new parser')
  expect(await ui.find({ key: 'ticket-OPEN.md-old finished thing' })).toBeUndefined()
  expect(await svgs()).toContain('Old finished thing')
  await ui.press({ key: ticket })
  expect(sent.length).toBe(1)
  expect(sent[0]).toBe(ticketPrompt('.claude_todo/OPEN.md', 'Ship the new parser'))
  expect((await ui.find({ key: ticket }))?.text).toContain('?')
  expect(await svgs()).toContain('>Sent<')
  await ui.press({ key: ticket })
  expect(sent[1]).toBe(statusPrompt('.claude_todo/OPEN.md', 'Ship the new parser'))
  const working = 'ticket-OPEN.md-build the release notes'
  expect((await ui.find({ key: working }))?.text).toContain('?')
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('Ask Claude for a status update')
  await ui.press({ key: working })
  expect(sent[2]).toBe(statusPrompt('.claude_todo/OPEN.md', 'Build the release notes'))
  expect(sent.length).toBe(3)
  await ui.press({ key: 'todo-tickets' })
  expect((await ui.findAll({ type: 'Svg' })).some(svg => JSON.stringify(svg).includes('Ship the new parser'))).toBe(true)
})

test('a ticket summary cuts long text at a word, and keeps short text whole', async () => {
  expect(ticketSummary('short', 50)).toBe('short')
  expect(ticketSummary('one two three four five six seven', 20)).toBe('one two three four…')
  expect(ticketPrompt('mods/x/.claude_todo/A.md', 'Do it')).toContain('mods/x/.claude_todo/A.md')
})

test('every card carries the light palette, swapped in by the system theme', async () => {
  const view = buildView([{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] one') }], [row({})], 10)
  for (const card of [heroSvg(view), ...fileCards(view.files[0]!, view, 12), timelineSvg(view, view.agents), agentSvg(view.agents[0]!, view)]) {
    expect(card.source).toContain('@media (prefers-color-scheme:light){[fill="#07080F"]{fill:#FFFFFF}')
    expect(card.source).toContain('[fill="rgba(255,255,255,.88)"]{fill:#10131C}')
  }
})

test('ticket columns: In progress (with open tickets a live agent works on), Open, then Done when shown; linked first, then by category, then file order', async () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo([
    '- [ ] #T1 plain open',
    '- [ ] #T2 billing open',
    '- [~] #T3 working',
    '- [ ] #T4 legal open',
    '- [x] #T5 done one',
    '- [ ] #T6 linked open',
  ].join('\n')) }]
  const view = buildView(list, [row({ id: 'a', brief: '#t6' })], 0)
  const book = { categories: ['Legal', 'Billing'], items: { '#t2': 'Billing', '#t4': 'Legal' } }
  const items = todoLedger(view, true)[0]!.items
  const hidden = ticketColumns(items, book, false)
  expect(hidden.map(column => column.name)).toEqual(['In progress', 'Open'])
  expect(hidden[0]?.items.map(item => [item.key, item.status])).toEqual([['#t6', 'in_progress'], ['#t3', 'in_progress']])
  expect(hidden[1]?.items.map(item => item.key)).toEqual(['#t4', '#t2', '#t1'])
  const shown = ticketColumns(items, book, true)
  expect(shown.map(column => [column.name, column.items.length])).toEqual([['In progress', 2], ['Open', 3], ['Done', 1]])
})

test('a match reply gives at most three in-range items, and nothing when unreadable', async () => {
  expect(readMatchReply('{"items": [2, 5, 2, 9, 1, 3]}', 5)).toEqual([1, 4, 0])
  expect(readMatchReply('Sure! {"items": []}', 5)).toEqual([])
  expect(readMatchReply('no json', 5)).toEqual([])
  expect(matchPrompt('fix the build memory', ['a', 'b'])).toContain('2. b')
})

test('a new agent is matched to its todo items by the model, and its item blinks its color', async ($, on) => {
  mock.clock(on)
  const asked: string[] = []
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: '- [~] Cache cleanup: close every open database connection\n- [ ] Something unrelated' }))
  on('agent.list', () => ({ value: [{ id: 'm1', description: 'Close database connections', type: 'engineer', status: 'running' }] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'm1' }))
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)

    return { value: { isAnswered: true, text: '{"items": [1]}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Close every open database connection', description: 'Close database connections', subagentType: 'engineer' } as never)
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve()
  }
  const matches = asked.filter(prompt => prompt.startsWith('An agent was started'))
  expect(matches.length).toBe(1)
  expect(matches[0]).toContain('1. Cache cleanup')
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const drawn = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(drawn).toContain('Working on')
  expect(drawn).toContain('fill:#3987e5;opacity:1')
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

test('ticket view is the default: the toggle reads Show as list, Arrange by category is hidden, and the category filter still works', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') || e.path.endsWith('categories.json') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', (_$, e) => ({
    value: e.path.endsWith('categories.json')
      ? '{"categories": ["Billing", "Legal"], "items": {"#t1": "Billing", "#t2": "Legal"}}'
      : '- [ ] #T1 pay vendor\n- [~] #T2 sign lease',
  }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect((await ui.find({ key: 'todo-tickets' }))?.text).toContain('Show as list')
  expect(await ui.find({ key: 'todo-sort' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Billing$/ })).toBeUndefined()
  await ui.press({ key: 'category-toggle-Legal' })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).not.toContain('sign lease')
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('pay vendor')
  await ui.press({ key: 'todo-tickets' })
  expect((await ui.find({ key: 'todo-tickets' }))?.text).toContain('Show as tickets')
  expect(await ui.find({ key: 'todo-sort' })).toBeDefined()
})

test('the third slot is the token burn as a number, with the burn since the last compaction', async () => {
  const base = buildView([], [], 0)
  const after = heroSvg({ ...base, usage: { tokens: 1_234_567, atCompact: 900_000, since: 0 } }).source
  expect(after).toContain('>Tokens<')
  expect(after).toContain('>1.23M<')
  expect(after).toContain('334.6k since compact')
  expect(after).not.toContain('>Cost<')
  expect(heroSvg({ ...base, usage: { tokens: 950, since: 0 } }).source).toContain('No compaction yet')
  expect(heroSvg(base).source).toContain('None counted yet')
  expect([tokens(950), tokens(84_321), tokens(1_234_567), tokens(23_456_789)]).toEqual(['950', '84.3k', '1.23M', '23.46M'])
  expect(turnTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 })).toBe(10)
})

test('each finished turn adds its tokens to the burn, main and subagent alike', async ($, on) => {
  mock.clock(on)
  const store = new Map<string, unknown>()
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  const used = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0, model: 'm' }
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', usage: used } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'x', usage: used } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('>43.0k<')
  expect((store.get('tokens:sess-1') as { tokens: number }).tokens).toBe(43_000)
})

test('a ticket with buttons keeps a bottom row of its own for them', async () => {
  const view = buildView([], [], 0)
  const item = { text: 'Fix the parser', status: 'pending' as const, owners: [], key: 'fix the parser' }
  const plain = ticketSvg(item, view, 300, { isSent: false })
  const sendable = ticketSvg(item, view, 300, { isSent: false, actions: 1 })
  expect(sendable.height).toBe(plain.height + 60)
})

test('a send scope is short and the same for the same ticket', async () => {
  expect(sendScope('A.md:#t1')).toBe(sendScope('A.md:#t1'))
  expect(sendScope('A.md:#t1')).not.toBe(sendScope('A.md:#t2'))
  expect(sendScope('x'.repeat(5000)).length).toBeLessThanOrEqual(64)
})

test('setBox sets one item\'s box by its key, and leaves the rest of the file as it was', async () => {
  const file = '# Plan\n\n- [ ] #T1 First\n- [ ] **Second** thing\nprose\n- [~] #T3 Third'
  expect(setBox(file, '#t1', 'in_progress')).toBe('# Plan\n\n- [~] #T1 First\n- [ ] **Second** thing\nprose\n- [~] #T3 Third')
  expect(setBox(file, itemKey({ text: 'Second thing' }), 'completed')).toContain('- [x] **Second** thing')
  expect(setBox(file, '#t3', 'pending')).toContain('- [ ] #T3 Third')
  expect(setBox(file, '#t3', 'in_progress')).toBeUndefined()
  expect(setBox(file, '#t9', 'completed')).toBeUndefined()
  expect(movesNote([])).toBeUndefined()
  expect(movesNote(['- "First": open -> in progress'])).toContain('Do not act on it')
})

test('manual moves write the box, ask nothing of Claude, and reach it with its next tool result or prompt', async ($, on) => {
  mock.clock(on)
  let file = '- [ ] #T1 Review the copy\n- [~] #T2 Check the invoice'
  let writes = 1
  const sent: string[] = []
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: writes, isLink: false }] }))
  on('fs.read', () => ({ value: file }))
  on('fs.write', (_$, e) => {
    file = e.text as string
    writes += 1

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)

    return { text: e.text, context: e.context }
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'ticket-start-OPEN.md-#t1' })
  expect(file).toBe('- [~] #T1 Review the copy\n- [~] #T2 Check the invoice')
  await ui.press({ key: 'ticket-done-OPEN.md-#t2' })
  expect(file).toBe('- [~] #T1 Review the copy\n- [x] #T2 Check the invoice')
  await ui.press({ key: 'ticket-reopen-OPEN.md-#t1' })
  expect(file).toBe('- [ ] #T1 Review the copy\n- [x] #T2 Check the invoice')
  expect(sent).toEqual([])
  const read = JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x' } as never))
  expect(read).toContain('open -> in progress')
  expect(read).toContain('in progress -> done')
  expect(read).toContain('Do not act on it')
  expect(JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x' } as never))).not.toContain('by hand')
  await ui.press({ key: 'ticket-start-OPEN.md-#t1' })
  const reply = JSON.stringify(await $.prompt.submit({ text: 'hello', asUser: true } as never))
  expect(reply).toContain('open -> in progress')
  expect(reply).not.toContain('in progress -> done')
})

test('the first scan sorts every open item, batch after batch, with no wait between batches', async ($, on) => {
  mock.clock(on)
  const prompts: string[] = []
  const writes: string[] = []
  const todo = Array.from({ length: 130 }, (_, i) => `- [ ] #T${i + 1} item number ${i + 1}`).join('\n')
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: todo }))
  on('fs.write', (_$, e) => {
    writes.push(e.text)

    return { value: undefined }
  })
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    const count = (e.prompt.match(/^\d+\. /gm) ?? []).length
    const assign = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), 'Work']))

    return { value: { isAnswered: true, text: JSON.stringify({ categories: ['Work'], assign }), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('agent.list', () => ({ value: [] }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  for (let i = 0; i < 2000 && writes.length < 3; i += 1) {
    await Promise.resolve()
  }
  expect(prompts.length).toBe(3)
  expect((JSON.parse(writes[2]!) as { items: Record<string, string> }).items['#t130']).toBe('Work')
})

test('findTicket finds a live item by ID first, else by its quoted text, and never in the archive', async () => {
  const list: TodoFile[] = [
    { name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] #T1 Review the terms of service\n- [ ] Ship the new parser and roll back') },
    { name: 'archive/B.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] #T9 Old thing'), isArchived: true },
  ]
  expect(findTicket(list, '#T1')?.item.text).toBe('#T1 Review the terms of service')
  expect(findTicket(list, 't1')?.file).toBe('A.md')
  expect(findTicket(list, 'Ship the new parser and roll back')?.item.status).toBe('pending')
  expect(findTicket(list, '#T9')).toBeUndefined()
  expect(findTicket(list, 'nothing like it')).toBeUndefined()
  const question = moveQuestion('.claude_todo/A.md', list[0]!.items[0]!, 'in_progress', 'The review is not finished.', true)
  expect(question).toContain('from done to in progress')
  expect(question).toContain('You moved it by hand.')
  expect(question.endsWith('?')).toBe(true)
})

test('move_ticket writes the box only when the user allows it', async ($, on) => {
  mock.clock(on)
  let file = '- [x] #T1 Review the terms'
  let writes = 1
  let answer = 'Keep it where it is'
  const asked: string[] = []
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: writes, isLink: false }] }))
  on('fs.read', () => ({ value: file }))
  on('fs.write', (_$, e) => {
    file = e.text as string
    writes += 1

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
    asked.push(question)

    return { result: { questions: [], answers: { [question]: answer } } } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const call = async () => JSON.stringify(await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T1', to: 'in_progress', reason: 'Not finished.' } as never))
  // The engine accepts a tool result only as text or content blocks, never as a { content } object.
  expect(typeof (await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: '#T9', to: 'done', reason: '' } as never) as { result: unknown }).result).toBe('string')
  expect(typeof (await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 1, total: 2 } as never) as { result: unknown }).result).toBe('string')
  expect(await call()).toContain('Not moved: the user kept')
  expect(file).toBe('- [x] #T1 Review the terms')
  answer = 'Move it'
  expect(await call()).toContain("Moved with the user's approval")
  expect(file).toBe('- [~] #T1 Review the terms')
  expect(asked.length).toBe(2)
  expect(asked[0]).toContain('from done to in progress')
})

test('the Orchestrator card keeps the main conversation\'s own call summaries, newest first, each timed', async ($, on) => {
  mock.clock(on)
  let models = 0
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('model.complete', () => {
    models += 1

    return { value: { isAnswered: true, text: '{}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const svgs = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(await ui.find({ type: 'Text', text: /^Idle, nothing done yet$/ })).toBeDefined()
  await $.prompt.submit({ text: 'Look into the parser', asUser: true } as never)
  expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
  await $.tool.call({ tool: 'Bash', command: 'grep -n parse src', description: 'Find the parser entry points' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the parser tests' } as never)
  const drawn = await svgs()
  expect(drawn.indexOf('Run the parser tests<')).toBeGreaterThan(-1)
  expect(drawn.indexOf('Run the parser tests<')).toBeLessThan(drawn.indexOf('Find the parser entry points<'))
  expect(drawn).toMatch(/>\d\d:\d\d:\d\d</)
  expect(models).toBe(0)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1' } as never).catch(() => undefined)
  expect(await svgs()).toContain('Run the parser tests<')
  expect(await ui.find({ type: 'Text', text: /^Idle$/ })).toBeDefined()
  for (let i = 0; i < 12; i += 1) {
    await $.tool.call({ tool: 'Bash', command: 'ls', description: `Step ${i}` } as never)
  }
  expect(await ui.find({ type: 'Text', text: /^Newest 5 of 14$/ })).toBeDefined()
  await ui.press({ key: 'orchestrator-older' })
  await ui.press({ key: 'orchestrator-older' })
  expect(await svgs()).toContain('Find the parser entry points<')
  expect(await svgs()).not.toContain('Step 11<')
  expect(await ui.find({ type: 'Text', text: /^11 to 14 of 14$/ })).toBeDefined()
  await ui.press({ key: 'orchestrator-latest' })
  expect(await svgs()).toContain('Step 11<')
})

test('the Orchestrator history pages newest first, five at a time, and times each line', async () => {
  expect(callSummary('Bash', { command: 'ls', description: 'List files\nmore' })).toBe('List files')
  expect(callSummary('Read', { file_path: '/a/b.ts' })).toBe('Read: /a/b.ts')
  const history = Array.from({ length: 25 }, (_, i) => ({ id: i, line: `L${i}`, at: 0, isRunning: i === 24 }))
  expect(orchestratorView(history, 0).entries.map(entry => entry.line).slice(0, 2)).toEqual(['L24', 'L23'])
  expect(orchestratorView(history, 4).entries.map(entry => entry.line)).toEqual(['L4', 'L3', 'L2', 'L1', 'L0'])
  expect(orchestratorView(history, 9).page).toBe(4)
  expect(orchestratorView([], 0).pages).toBe(1)
  expect(pageLabel(orchestratorView(history, 4), 25)).toBe('21 to 25 of 25')
  expect(clock(new Date(2026, 9, 15, 9, 5, 7).getTime())).toBe('09:05:07')
  const card = orchestratorSvg(history.slice(-2)).source
  expect(card).toContain('>L24<')
  expect(card).toContain('class="pulse"')
})

test('the mod gives Claude its todo rules as a context block of its own, once', async ($, on) => {
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }) as never)
  const context = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'mine' }] } as never)
  expect(context.blocks.map(block => block.name)).toEqual(['claudeMd', 'claudeopticon'])
  expect(context.blocks[1]?.text).toBe(RULES)
  expect(RULES).toContain('4 digits and capital letters')
  expect(RULES).toContain('An item with no ID gets one from the mod')
  expect(RULES).toContain('mcp__claudeopticon__move_ticket')
})

test('with the rules option off, the mod adds no context block', { options: { rules: false } }, async ($, on) => {
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }) as never)
  const context = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'mine' }] } as never)
  expect(context.blocks.map(block => block.name)).toEqual(['claudeMd'])
})

test('a task notification reports an ID and an end status; other messages report none', () => {
  expect(notifiedEnd('<task-notification><task-id>b1</task-id><status>completed</status></task-notification>')).toEqual({ id: 'b1', status: 'completed' })
  expect(notifiedEnd('<task-id>m1</task-id><status>stopped</status>')?.status).toBe('killed')
  expect(notifiedEnd('<task-id>m1</task-id><event>line</event>')).toBeUndefined()
})

test("an agent's model requests add up to a token count beside its tool calls", async ($, on) => {
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Parser', type: 'engineer', status: 'running' }] }))
  const used = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 600_000, cache_creation_input_tokens: 0, model: 'm' }
  on('turn.step', async function* (_$, e) {
    yield { kind: 'stop', stopReason: 'end_turn', usage: used } as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: used } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Fix the parser', description: 'Parser', subagentType: 'engineer' } as never)
  for (const [index, agentId] of [[0, 'a1'], [1, 'a1'], [0, undefined]] as const) {
    for await (const _chunk of $.turn.step({ turnId: 't', index, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) } as never)) {
      // Each step yields its stop chunk.
    }
  }
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  // The turn ended, so the card is idle and its meta line longer: a wide pane shows it whole.
  const wide = { ...PANE, props: { ...(PANE.props as object), bodyColumns: 120 } } as never as typeof PANE
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...wide })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('0 tool calls · 1.20M tokens')
  const text = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
  expect(await text.find({ type: 'Text', text: /1\.20M tokens/ })).toBeDefined()
})

test('Stop on a live agent card stops the agent at once through TaskStop, and an ended agent has no Stop', async ($, on) => {
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  let status = 'running'
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Parser', type: 'engineer', status }] }) as never)
  const stops: unknown[] = []
  on('tool.call', { tool: 'TaskStop' }, (_$, e) => {
    stops.push((e as { task_id?: string }).task_id)
    status = 'killed'

    return { result: { message: 'stopped', task_id: 'a1', task_type: 'local_agent' } } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Fix the parser', description: 'Parser', subagentType: 'engineer' } as never)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const labels = async () => (await ui.findAll({ type: 'Button' })).map(button => (button as { props?: { label?: string } }).props?.label)
  expect(await labels()).toContain('\u2296')
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('Running')
  await ui.press({ key: 'agent-stop-0' })
  expect(stops).toEqual(['a1'])
  await ui.press({ key: 'agents-toggle' })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('>Stopped<')
  expect(await labels()).not.toContain('\u2296')
})

test('an agent missing from the engine list ends after a grace period, and its notification gives how', async ($, on) => {
  let now = 1_000_000
  on('clock.now', () => ({ value: now }) as never)
  on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [] }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Fix the parser', description: 'Parser', subagentType: 'engineer' } as never)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const svgs = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(await svgs()).toContain('>Running<')
  now += 20_000
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  expect(await svgs()).not.toContain('>Running<')
  await ui.press({ key: 'agents-toggle' })
  expect(await svgs()).toContain('>Ended<')
  await $.prompt.submit({ text: '<task-notification><task-id>a1</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' } } as never).catch(() => undefined)
  expect(await svgs()).toContain('>Done<')
})

test('an agent first seen in the list, as after a reload, takes its model from its model requests', async ($, on) => {
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Parser', type: 'engineer', status: 'running' }] }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('engineer · 0s')
  for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'a1' } as never)) {
    // The base hook yields no chunks.
  }
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('engineer · claude-opus-5-5')
})

test('agent data is kept by session, so a reload shows each agent as it was', async ($, on) => {
  mock.clock(on)
  const store = new Map<string, unknown>()
  store.set('agents:sess-1', [
    { id: 'a1', description: 'Parser', type: 'engineer', model: 'claude-opus-5-5', status: 'running', startedAt: 0, toolCalls: 22, tokens: 2_420_000, brief: 'parser', autoClaims: [] },
    { id: 'bad', description: 7 },
  ])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Parser', type: 'engineer', status: 'running' }] }))
  let models = 0
  on('model.complete', () => {
    models += 1

    return { value: { isAnswered: true, text: '{}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('engineer · claude-opus-5-5 · 0s · 22 tool calls · 2.42M tokens')
  expect(models).toBe(0)
  const kept = store.get('agents:sess-1') as { id: string }[]
  expect(kept.map(row => row.id)).toEqual(['a1'])
})

test('a pane drawn under an older title is opened again once, with the current one', async ($, on) => {
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  const opened: unknown[] = []
  on('ui.open', (_$, e) => {
    opened.push((e as { title?: string }).title)

    return { value: undefined } as never
  })
  const old = { ...PANE, props: { ...(PANE.props as object), title: 'Work' } } as never as typeof PANE
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...old })
  await ui.drawn()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(opened).toEqual(['Claudeopticon'])
})

test('an agent whose turn ended with nothing after it is idle: not live, still shown, with its Stop button', async ($, on) => {
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Gate fixes', type: 'engineer', status: 'waiting' }] }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'Fix the gate', description: 'Gate fixes', subagentType: 'engineer' } as never)
  await $.tool.call({ tool: 'Bash', command: 'sleep 20', description: 'Wait', agentId: 'a1' } as never).catch(() => undefined)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const svgs = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(svgs).toContain('>Idle<')
  expect(svgs).toContain('not stopped')
  expect(svgs).toContain('Last: ')
  expect(svgs).toContain('0 of 1 agent live')
  expect(await ui.find({ type: 'Text', text: /0 live, 1 idle, 0 finished/ })).toBeDefined()
  const labels = (await ui.findAll({ type: 'Button' })).map(button => (button as { props?: { label?: string } }).props?.label)
  expect(labels).toContain('\u2296')
})

// ---------------------------------------------------------------- many todo folders

test('git output gives the todo folders: nested ones, an ignored folder entry, the roots of a worktree', async () => {
  const listing = ['a.txt', '.claude_todo/TODO.md', '.claude_todo/archive/OLD.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/src/b.ts', 'deep/er/.claude_todo/', 'x.claude_todo/f.md', ''].join('\0')
  expect(todoFoldersIn(listing, '/repo')).toEqual([
    { path: '/repo/.claude_todo', rel: '.claude_todo' },
    { path: '/repo/deep/er/.claude_todo', rel: 'deep/er/.claude_todo' },
    { path: '/repo/mods/x/.claude_todo', rel: 'mods/x/.claude_todo' },
  ])
  expect(todoFoldersIn('', '/repo')).toEqual([])
  expect(repoRoots('/repo\n/repo/.git\n')).toEqual({ root: '/repo' })
  expect(repoRoots('/work/tree\n/repo/.git\n')).toEqual({ root: '/work/tree', main: '/repo' })
  expect(repoRoots('fatal: not a git repository')).toBeUndefined()
})

test('the folders are the primary first then by path, the global one dropped, one place once, at most 20', async () => {
  const at = (rel: string) => ({ path: `/r/${rel}`, rel })
  const found = [at('z/.claude_todo'), at('.claude_todo'), at('a/.claude_todo'), at('g/.claude_todo'), { path: '/main/a/.claude_todo', rel: 'a/.claude_todo' }]
  const picked = pickFolders(found, '/r/z/.claude_todo', new Set(['/r/g/.claude_todo']))
  expect(picked.map(one => one.rel)).toEqual(['z/.claude_todo', '.claude_todo', 'a/.claude_todo'])
  expect(picked.map(one => one.isOther)).toEqual([false, true, true])
  expect(picked[2]?.path).toBe('/r/a/.claude_todo')
  const many = Array.from({ length: 30 }, (_, i) => at(`d${String(i).padStart(2, '0')}/.claude_todo`))
  const capped = pickFolders(many, '/r/d29/.claude_todo', new Set())
  expect(capped.length).toBe(MAX_FOLDERS)
  expect(capped[0]?.rel).toBe('d29/.claude_todo')
  expect(capped[1]?.rel).toBe('d00/.claude_todo')
  expect(pickFolders(many, undefined, new Set()).every(one => one.isOther)).toBe(true)
  // The same place listed twice (a worktree and its main checkout): the primary's entry stays.
  const twice = pickFolders([{ path: '/main/a/.claude_todo', rel: 'a/.claude_todo' }, { path: '/wt/a/.claude_todo', rel: 'a/.claude_todo' }], '/wt/a/.claude_todo', new Set())
  expect(twice).toEqual([{ path: '/wt/a/.claude_todo', rel: 'a/.claude_todo', isOther: false }])
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

test('the board header has one row per file with its own count, and shows a place only for a repeated name', async () => {
  const file = (name: string, place: string, done: number, total: number): FileView => ({ name, id: name, place, done, active: 0, total, owners: [], items: [], mtimeMs: 1 })
  const two = boardHead([file('A.md', '', 1, 4), file('B.md', 'mods/x', 3, 5)])
  const one = boardHead([file('A.md', '', 1, 4)])
  expect(two.source).toContain('>A.md<')
  expect(two.source).toContain('>B.md<')
  expect(two.source).toContain('1 of 4')
  expect(two.source).toContain('3 of 5')
  expect(two.source).not.toContain('mods/x')
  expect(two.height).toBeGreaterThan(one.height)
  // With one file the header is the list view's first card.
  expect(one.height).toBe(fileCards(file('A.md', '', 1, 4), { ...view0(), files: [] }, 0)[0]!.height)
  const same = boardHead([file('A.md', '', 1, 4), file('A.md', 'mods/x', 3, 5), file('B.md', 'lib', 0, 1)])
  expect(same.source).toContain('>mods/x<')
  expect(same.source).not.toContain('>lib<')
  // The root's own folder needs no place.
  expect(same.source).not.toContain('>.claude_todo<')
})

const view0 = () => buildView([], [], 0)

test('a folder input picks a move_ticket target exactly, never by a word in the reference', async () => {
  const mk = (folder: string, rel: string, name: string, text: string): TodoFile => ({ name, folder, rel, mtimeMs: 1, items: parseTodo(text) })
  const list = [
    mk('/r/a/.claude_todo', 'a/.claude_todo', 'TODO.md', '- [ ] #T1 First'),
    mk('/r/b/.claude_todo', 'b/.claude_todo', 'TODO.md', '- [ ] #T1 Second'),
    mk('/r/b/.claude_todo', 'b/.claude_todo', 'MORE.md', '- [ ] #T1 Third'),
  ]
  const hits = findTickets(list, 'mark #T1 as done')
  expect(hits.length).toBe(3)
  expect(narrowTickets(hits, 'a').length).toBe(0)
  expect(narrowTickets(hits, 'a/.claude_todo').map(one => one.item.text)).toEqual(['#T1 First'])
  expect(narrowTickets(hits, 'b/.claude_todo/MORE.md').map(one => one.item.text)).toEqual(['#T1 Third'])
  expect(narrowTickets(hits, '/r/b/.claude_todo/').length).toBe(2)
  expect(findTicket(list, '#T1', 'b/.claude_todo/TODO.md')?.item.text).toBe('#T1 Second')
})

/** The empty `archive/TODO.md` the mod makes for the Show completed link: a test of other files leaves it out. */
const withoutLink = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([path]) => !path.endsWith('/archive/TODO.md') || files[path] !== ''))

/** The path a PowerShell script names through `psPath`, with forward slashes. */
const fromPs = (script: string) => String.fromCodePoint(...(/\[char\[\]\]\(([\d,]+)\)/.exec(script)![1]!.split(',').map(Number))).replace(/\\/g, '/')

/**
 * A fake repo (at `/repo` unless `root` says) with the given files by absolute path; `hasNearest` says
 * whether the session folder has its own `.claude_todo`; `rev` is what `git rev-parse` answers;
 * `links` maps a path to the real path the fake stat gives it (a symlink). `uname` is what `uname -s`
 * answers; a trash command named in `failing` exits 1, and one named in `stays` exits 0 but leaves the
 * file. Any other trash command removes the file from `files`, as the real one would.
 */
function repoWith(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string>; uname?: string; failing?: string[]; stays?: string[]; exits?: Record<string, number>; log?: string[]; dangling?: string[]; hold?: Promise<void> }) {
  const R = opts.root ?? '/repo'
  const state = { hasNearest: opts.hasNearest, listed: opts.listed }
  const writes: string[] = []
  const calls: string[] = []
  const inside = (path: string) => path === R || path.startsWith(`${R}/`)
  const names = (dir: string) => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never

    const fail = { value: { exitCode: 1, stdout: '', stderr: 'failed' } } as never
    const dirEmpty = (dir: string) => !Object.keys(files).some(path => path.startsWith(`${dir}/`))

    if (argv[0] === 'uname') {
      return out(`${opts.uname ?? 'Darwin'}\n`)
    }
    if (['/usr/bin/trash', 'osascript', 'gio', 'trash-put', 'kioclient5', 'powershell.exe'].includes(argv[0]!)) {
      const script = argv[argv.length - 1]!
      if (argv[0] === 'powershell.exe' && script.startsWith('[System.IO.Directory]::Delete(')) {
        return dirEmpty(fromPs(script)) ? out('') : fail
      }
      if (opts.failing?.includes(argv[0]!)) {
        return fail
      }
      const path =
        argv[0] === 'osascript' ? /POSIX file "(.*)"$/.exec(script)![1]!.replace(/\\(.)/g, '$1')
        : argv[0] === 'powershell.exe' ? fromPs(script)
        : argv[0] === 'kioclient5' ? argv[2]!
        : argv[argv.length - 1]!
      if (!opts.stays?.includes(argv[0]!)) {
        delete files[path]
      }

      return out('')
    }
    if (['open', 'xdg-open', 'explorer.exe'].includes(argv[0]!)) {
      return opts.failing?.includes(argv[0]!) ? fail : ({ value: { exitCode: opts.exits?.[argv[0]!] ?? 0, stdout: '', stderr: '' } } as never)
    }
    if (argv[0] === 'rm') {
      delete files[argv[2]!]

      return out('')
    }
    if (argv[0] === 'rmdir') {
      return dirEmpty(argv[2]!) ? out('') : fail
    }

    return argv[1] === 'rev-parse' ? out(opts.rev ?? `${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : state.listed.join('\0'))
  })
  // The engine may hand the session folder's own paths over made absolute: match by their ends.
  // It does the same to a Windows path (`C:/repo`), which `abs` hands back whole.
  const abs = (path: string) => /[A-Za-z]:\/.*$/.exec(path)?.[0] ?? path
  on('fs.exists', (_$, e) => ({ value: abs(e.path).endsWith('.git') || (abs(e.path).endsWith('.claude_todo') && !inside(abs(e.path)) && state.hasNearest) || (inside(abs(e.path)) && (abs(e.path) in files || Object.keys(files).some(path => path.startsWith(`${abs(e.path)}/`)))) }))
  on('fs.stat', (_$, e) => (opts.log?.push(`stat:${abs(e.path)}`), { value: { kind: abs(e.path) in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.links?.[abs(e.path)] ?? (inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo`) } }) as never)
  on('fs.list', (_$, e) => ({ value: [...(inside(abs(e.path)) ? names(abs(e.path)) : state.hasNearest ? names(`${R}/.claude_todo`) : []), ...(opts.dangling ?? []).filter(path => path.slice(0, path.lastIndexOf('/')) === abs(e.path)).map(path => path.slice(path.lastIndexOf('/') + 1))].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2, isLink: false })) }))
  on('fs.read', (_$, e) => (opts.log?.push(`read:${abs(e.path)}`), { value: files[inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`] ?? '' }))
  on('fs.write', async (_$, e) => {
    const path = inside(abs(e.path)) ? abs(e.path) : `${R}/.claude_todo/${abs(e.path).split('/').pop()}`
    opts.log?.push(`write:${path}`)
    // A held write: the test presses a button while this write is in flight.
    if (opts.hold !== undefined && e.text !== '') {
      await opts.hold
    }
    files[path] = e.text as string
    // The mod makes an empty archive/TODO.md for the Show completed link: not one of the writes a test counts.
    if (!(path.endsWith('/archive/TODO.md') && e.text === '')) {
      writes.push(path)
    }

    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }))

  return { state, writes, calls }
}

const TWO = () => ({
  '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser',
  '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Write the docs',
})

test('two todo folders show as one board, a button writes only its own file, and one ID in both stays two tickets', async ($, on) => {
  mock.clock(on)
  const files = TWO()
  const { writes, calls } = repoWith(on, files, { hasNearest: true, listed: ['src/a.ts', '.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)

    return { text: e.text, context: e.context }
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  expect(calls[0]).toContain('rev-parse')
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const drawn = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(drawn).toContain('Fix the parser')
  expect(drawn).toContain('Write the docs')
  expect(drawn).not.toContain('mods/x:')
  expect(drawn).not.toContain('repo root')
  // One board, one header with a row per file: the names repeat, so the second one's place shows.
  expect(drawn.match(/>TODO\.md</g)?.length).toBe(2)
  expect(drawn.match(/>0 of 1</g)?.length).toBe(2)
  expect(drawn).toContain('>mods/x<')
  expect(drawn).not.toContain('>.claude_todo<')
  expect(await ui.find({ key: 'ticket-start-TODO.md-#t1' })).toBeDefined()
  await ui.press({ key: 'ticket-start-TODO.md-mods/x/.claude_todo::#t1' })
  expect(writes).toEqual(['/repo/mods/x/.claude_todo/TODO.md'])
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [~] #T1 Write the docs')
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix the parser')
  await ui.press({ key: 'ticket-start-TODO.md-#t1' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [~] #T1 Fix the parser')
  // The prompt to Claude names the real path, which the pane hides.
  await ui.press({ key: 'ticket-TODO.md-mods/x/.claude_todo::#t1' })
  expect(sent[0]).toContain('mods/x/.claude_todo/TODO.md')
  // Git runs once: a write inside a todo folder only rescans the known ones.
  const gitCalls = calls.length
  await $.tool.call({ tool: 'Write', file_path: '/repo/new/.claude_todo/T.md' } as never).catch(() => undefined)
  expect(calls.length).toBe(gitCalls)
})

test('one board holds the tickets of every file together, under a header with a row per file; the list view stays per file', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/ALPHA.md': '- [ ] #T1 Alpha open\n- [~] #T2 Alpha active\n- [x] #T3 Alpha done',
    '/repo/mods/x/.claude_todo/BETA.md': '- [ ] #T4 Beta open\n- [~] #T5 Beta active',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/ALPHA.md', 'mods/x/.claude_todo/BETA.md'] })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const drawn = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  // Ticket view: one header card (two rows, own counts), tickets from both files, no place shown.
  expect(drawn.match(/>ALPHA\.md</g)?.length).toBe(1)
  expect(drawn.match(/>BETA\.md</g)?.length).toBe(1)
  expect(drawn).toContain('1 of 3')
  expect(drawn).toContain('0 of 2')
  expect(drawn).not.toContain('mods/x')
  // Five tickets in the columns (Open 2, In progress 2, Done 1): the done ticket is still in its live file.
  for (const one of ['Alpha open', 'Alpha active', 'Beta open', 'Beta active', 'Alpha done']) {
    expect(drawn).toContain(one)
  }
  // In a column, file order: Alpha before Beta.
  const order = (text: string) => drawn.indexOf(text)
  expect(order('Alpha open')).toBeLessThan(order('Beta open'))
  expect(order('Alpha active')).toBeLessThan(order('Beta active'))
  // Button keys keep the file and the item.
  expect(await ui.find({ key: 'ticket-start-ALPHA.md-#t1' })).toBeDefined()
  expect(await ui.find({ key: 'ticket-start-BETA.md-mods/x/.claude_todo::#t4' })).toBeDefined()
  // List view: a card set per file, each with its own header.
  await ui.press({ key: 'todo-tickets' })
  const text = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(text.match(/>ALPHA\.md</g)?.length).toBe(1)
  expect(text.match(/>BETA\.md</g)?.length).toBe(1)
  expect(text).toContain('>1 of 3<')
  expect(text).toContain('>0 of 2<')
})

test('the board shows 12 tickets per column across all files, and one button shows them all', async ($, on) => {
  mock.clock(on)
  const many = (word: string) => Array.from({ length: 8 }, (_, i) => `- [ ] ${word} ${i}`).join('\n')
  const files = { '/repo/.claude_todo/AAA.md': many('aaa'), '/repo/mods/x/.claude_todo/BBB.md': many('bbb') }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/AAA.md', 'mods/x/.claude_todo/BBB.md'] })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const count = async () => {
    const text = JSON.stringify(await ui.findAll({ type: 'Svg' }))

    return (text.match(/>(aaa|bbb) \d</g) ?? []).length
  }
  expect(await count()).toBe(12)
  await ui.press({ key: 'file-toggle-board' })
  expect(await count()).toBe(16)
})

test('move_ticket refuses an ID found in more than one file, and the folder input picks one', async ($, on) => {
  mock.clock(on)
  const files = { ...TWO(), '/repo/mods/x/.claude_todo/MORE.md': '- [ ] #T1 Third' }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/.claude_todo/MORE.md'] })
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
    asked.push(question)

    return { result: { questions: [], answers: { [question]: 'Move it' } } } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const move = async (extra: Record<string, unknown> = {}) =>
    JSON.stringify(await $.tool.call({ tool: 'mcp__claudeopticon__move_ticket', item: 'mark #T1 as done', to: 'done', reason: 'r', ...extra } as never))
  const refused = await move()
  expect(refused).toContain('more than one file')
  expect(refused).toContain('mods/x/.claude_todo/MORE.md')
  expect(refused).toContain('.claude_todo/TODO.md')
  expect(await move({ folder: 'a' })).toContain('no match')
  expect(writes).toEqual([])
  expect(await move({ folder: 'mods/x/.claude_todo' })).toContain('more than one file')
  expect(await move({ folder: 'mods/x/.claude_todo/MORE.md' })).toContain('Moved with the user')
  expect(writes).toEqual(['/repo/mods/x/.claude_todo/MORE.md'])
  expect(files['/repo/mods/x/.claude_todo/MORE.md']).toBe('- [x] #T1 Third')
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix the parser')
  expect(asked[0]).toContain('mods/x/.claude_todo/MORE.md')
})

test('with no primary folder, categories are not written to any folder', async ($, on) => {
  mock.clock(on)
  const files = TWO()
  const { writes } = repoWith(on, files, { hasNearest: false, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  let asked = 0
  on('model.complete', () => {
    asked += 1

    return { text: '{"categories":["Code"],"assign":{"1":"Code","2":"Code"}}', isAnswered: true } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('Write the docs')
  expect(asked).toBe(0)
  expect(writes.filter(path => path.endsWith('categories.json'))).toEqual([])
})

test('a todo folder made after the mod loaded shows at the next scan, as the primary folder', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {}
  const { state, calls } = repoWith(on, files, { hasNearest: false, listed: [] })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).not.toContain('First run')
  // Claude creates .claude_todo/ at the root of a repo that had none.
  files['/repo/.claude_todo/TODO.md'] = '- [ ] #T1 First run'
  state.hasNearest = true
  const gitCalls = calls.length
  await clock.advance(5_000)
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('First run')
  expect(calls.length).toBe(gitCalls)
  // It is the primary folder: its item keys carry no folder.
  expect(await ui.find({ key: 'ticket-start-TODO.md-#t1' })).toBeDefined()
})

// ---------------------------------------------------------------- tidying the todo files

const rmCalls = (calls: string[]) => calls.filter(call => call.startsWith('rm'))
const trashed = (calls: string[]) => calls.filter(call => call.startsWith('/usr/bin/trash ')).sort()

const open = async ($: Parameters<Parameters<typeof test>[1]>[0]) => {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

test('helpers: renumbering, sections, references and the exact-duplicate rule', async () => {
  const used = new Set(['t1', 't2'])
  // A new ID skips the reserved IDs of the files still to come.
  expect(renumberLines(['- [ ] #T1 A'], new Set(['t1']), new Set(['t2', 't3'])).pairs).toEqual([{ from: 'T1', to: 'T0004' }])
  const out = renumberLines(['- [ ] #T1 Docs', '- [x] #T7 Kept', '- [~] No id', '- note, see #T1 and #T7'], used)
  expect(out.lines).toEqual(['- [ ] #T0008 Docs', '- [x] #T7 Kept', '- [~] No id', '- note, see #T0008 and #T7'])
  expect(applyRenames('#T1 and #T10 and #T3', { t1: 'T3', t3: 'T4' })).toBe('#T3 and #T10 and #T4')
  expect(appendSections('', [{ place: 'mods/x', lines: ['- [ ] a'] }])).toBe('## From mods/x\n\n- [ ] a\n')
  expect(appendSections('- [ ] top\n', [{ place: 'a', lines: ['- [ ] b'] }])).toBe('- [ ] top\n\n## From a\n\n- [ ] b\n')
  expect(nonBlankLines('# A\n\n  note  \n   \n- [ ] x')).toEqual(['# A', '  note', '- [ ] x'])
  expect(itemLines('# T\nprose\n- [ ] one\n  - [x] two')).toEqual(['- [ ] one', '  - [x] two'])
  expect(renameNote([])).toBeUndefined()
  expect(removedNote([])).toBeUndefined()
  expect(foldParts('- [ ] #T1 Fix')?.key).toBe(foldParts('- [ ] #T9 Fix')?.key)
  expect(foldParts('- [ ] see #T1')).toBeUndefined()
  const dup = removeDuplicateTickets(['- [ ] #T1 Fix it', '- [ ] #T2 Fix it', '- [ ] #T3 fix it', '- [x] #T4 Fix it', '- [ ] #T5 Fix  it', '- [ ] #T6 Fix it.', 'after #T2 and #T1'].join('\n'))
  expect(dup.removed).toEqual([{ id: 'T2', kept: 'T1' }])
  expect(dup.map).toEqual({ t2: 'T1' })
  expect(dup.text).toBe(['- [ ] #T1 Fix it', '- [ ] #T3 fix it', '- [x] #T4 Fix it', '- [ ] #T5 Fix  it', '- [ ] #T6 Fix it.', 'after #T1 and #T1'].join('\n'))
  // An ID that a kept ticket owns is never remapped.
  const owned = removeDuplicateTickets('- [ ] #T1 A\n- [ ] #T2 A\n- [ ] #T2 B')
  expect(owned.map).toEqual({})
})

test('Consolidate moves every other file into the one target, renumbers clashes, and empties the sources only when unchanged', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/.claude_todo/BACKLOG.md': '- [ ] #T2 Backlog item',
    '/repo/.claude_todo/archive/OLD.md': '- [x] #T9 Old',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Docs\n- [ ] #T2 Ship, after #T1',
    '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Done in x',
  }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/BACKLOG.md', '.claude_todo/archive/OLD.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/.claude_todo/archive/OLD.md'] })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }) as never)
  const ui = await open($)
  expect(await ui.find({ key: 'todo-delete-empty' })).toBeUndefined()
  expect(await ui.find({ key: 'todo-delete-dup-tickets' })).toBeUndefined()
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix\n\n## From BACKLOG.md\n\n- [ ] #T2 Backlog item\n\n## From mods/x/TODO.md\n\n- [ ] #T000A Docs\n- [ ] #T000B Ship, after #T000A\n')
  expect(files['/repo/.claude_todo/archive/OLD.md']).toBe('- [x] #T9 Old\n\n## From mods/x/archive/OLD.md\n\n- [x] #T000C Done in x\n')
  // The sources are empty, the target is not, and nothing is removed yet.
  expect(files['/repo/.claude_todo/BACKLOG.md']).toBe('')
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('')
  expect(files['/repo/mods/x/.claude_todo/archive/OLD.md']).toBe('')
  expect(rmCalls(calls)).toEqual([])
  expect(toasts.join('\n')).toContain('mods/x/TODO.md: #T1 is now #T000A')
  expect(JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x' } as never))).toContain('#T1 is now #T000A')
  // The button is gone, and the next one has work.
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  expect(await ui.find({ key: 'todo-delete-empty' })).toBeDefined()
  // The emptied files stay in the header, marked Empty, until Delete empty todos removes them.
  const head = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(head.match(/>Empty</g)?.length).toBe(2)
  await ui.press({ key: 'todo-delete-empty' })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).not.toContain('>Empty<')
})

test('a subtask or a ticket with lines under it is never a duplicate, and a leading ID is never renamed', () => {
  const tree = removeDuplicateTickets(['- [ ] #T1 Parser', '  - [ ] #T2 Write tests', '- [ ] #T3 Lexer', '  - [ ] #T4 Write tests', 'See #T4'].join('\n'))
  expect(tree.removed).toEqual([])
  const parent = removeDuplicateTickets(['- [ ] #T1 Fix X', '- [ ] #T2 Fix X', '  - [ ] #T3 Child'].join('\n'))
  expect(parent.removed).toEqual([])
  // A subtask that owns the ID keeps it: the ID is not remapped.
  const clash = removeDuplicateTickets(['- [ ] #T1 Fix X', '- [ ] #T5 Fix X', '- [ ] #T6 Other', '  - [ ] #T5 Sub'].join('\n'))
  expect(clash.removed).toEqual([{ id: 'T5', kept: 'T1' }])
  expect(clash.map).toEqual({})
  // In an archive file, a ticket's own ID stays and only its references follow.
  expect(applyRefRenames('- [x] #T5 Ship Y, after #T5', { t5: 'T1' })).toBe('- [x] #T5 Ship Y, after #T1')
  expect(applyRefRenames('see #T5', { t5: 'T1' })).toBe('see #T1')
})

test('Consolidate never reads, writes or empties through a symlink', async ($, on) => {
  mock.clock(on)
  const make = () => ({
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 Docs',
    '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T3 Notes',
  })
  const listed = ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/.claude_todo/archive/OLD.md']
  // A source archive that is a link to the global folder: the whole source stays as it is.
  const files: Record<string, string> = make()
  repoWith(on, files, { hasNearest: true, listed, links: { '/repo/mods/x/.claude_todo/archive/OLD.md': '/home/a/.claude/.claude_todo/OLD.md' } })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  expect(withoutLink(files)).toEqual(make())
})

test('Consolidate does not write a target that is a symlink, and empties no source', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 Docs' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'], links: { '/repo/.claude_todo/TODO.md': '/home/a/.claude/.claude_todo/TODO.md' } })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix')
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] #T2 Docs')
})

test('a source that changed after the copy is left as it is and named', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] one' }
  let reads = 0
  Object.defineProperty(files, '/repo/mods/x/.claude_todo/TODO.md', {
    enumerable: true,
    configurable: true,
    // The press reads it once to copy it; the read before emptying finds a new line.
    get: () => {
      reads += 1

      return reads >= 2 ? '- [ ] two\n- [ ] added meanwhile' : '- [ ] two'
    },
    set: () => undefined,
  })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  const ui = await open($)
  reads = 0
  await ui.press({ key: 'todo-consolidate' })
  expect(writes).toEqual(['/repo/.claude_todo/TODO.md'])
  expect(toasts.join('\n')).toContain('changed since the copy')
  expect(toasts.join('\n')).toContain('/repo/mods/x/.claude_todo/TODO.md')
})

test('a target that changed since it was read is not written, and no source is emptied', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/mods/x/.claude_todo/TODO.md': '- [ ] two' }
  let reads = 0
  Object.defineProperty(files, '/repo/.claude_todo/TODO.md', {
    enumerable: true,
    configurable: true,
    get: () => {
      reads += 1

      return reads >= 2 ? '- [ ] one\n- [ ] edited meanwhile' : '- [ ] one'
    },
    set: () => undefined,
  })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  const ui = await open($)
  reads = 0
  await ui.press({ key: 'todo-consolidate' })
  expect(writes).toEqual([])
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] two')
  expect(toasts.join('\n')).toContain('changed meanwhile')
  expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
})

test('the target is found without case: todo.md takes the files, and is never emptied', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/todo.md': '- [ ] #T1 one',
    '/repo/.claude_todo/BACKLOG.md': '- [ ] #T2 two',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 three',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/todo.md', '.claude_todo/BACKLOG.md', 'mods/x/.claude_todo/TODO.md'] })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/todo.md']).toBe('- [ ] #T1 one\n\n## From BACKLOG.md\n\n- [ ] #T2 two\n\n## From mods/x/TODO.md\n\n- [ ] #T3 three\n')
  expect(files['/repo/.claude_todo/TODO.md']).toBeUndefined()
})

test('the target is TODO.md; else the only todo file; else a new TODO.md', async ($, on) => {
  mock.clock(on)
  const only: Record<string, string> = { '/repo/.claude_todo/NOTES.md': '- [ ] #T1 n', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 c' }
  repoWith(on, only, { hasNearest: true, listed: ['.claude_todo/NOTES.md', 'mods/x/.claude_todo/TODO.md'] })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  expect(only['/repo/.claude_todo/NOTES.md']).toBe('- [ ] #T1 n\n\n## From mods/x/TODO.md\n\n- [ ] #T2 c\n')
  expect(only['/repo/.claude_todo/TODO.md']).toBeUndefined()
})

test('with two central todo files and no TODO.md, a new TODO.md takes all', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/A.md': '- [ ] #T1 a', '/repo/.claude_todo/B.md': '- [ ] #T2 b' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md'] })
  const ui = await open($)
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('## From A.md\n\n- [ ] #T1 a\n\n## From B.md\n\n- [ ] #T2 b\n')
  expect(files['/repo/.claude_todo/A.md']).toBe('')
  expect(files['/repo/.claude_todo/B.md']).toBe('')
})

test('Delete empty todos removes only the empty files and their emptied folders, never the target or a book', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '',
    '/repo/.claude_todo/BACKLOG.md': '  \n',
    '/repo/.claude_todo/categories.json': '{}',
    '/repo/.claude_todo/archive/EMPTY.md': '',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] stays',
    '/repo/mods/x/.claude_todo/archive/GONE.md': '\n\n',
    '/repo/mods/y/.claude_todo/NOTES.md': '',
  }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/BACKLOG.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/.claude_todo/archive/GONE.md', 'mods/y/.claude_todo/NOTES.md', '.claude_todo/archive/EMPTY.md'] })
  const ui = await open($)
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  await ui.press({ key: 'todo-delete-empty' })
  expect(trashed(calls)).toEqual([
    '/usr/bin/trash /repo/.claude_todo/BACKLOG.md',
    '/usr/bin/trash /repo/.claude_todo/archive/EMPTY.md',
    '/usr/bin/trash /repo/mods/x/.claude_todo/archive/GONE.md',
    '/usr/bin/trash /repo/mods/y/.claude_todo/NOTES.md',
  ])
  expect(calls.filter(call => call.startsWith('rm --'))).toEqual([])
  expect(files['/repo/.claude_todo/TODO.md']).toBe('')
  expect(files['/repo/.claude_todo/categories.json']).toBe('{}')
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] stays')
  // Folders are tried after their files, archive first; a folder that still holds a file stays.
  expect(rmCalls(calls).filter(call => call.startsWith('rmdir')).sort()).toEqual([
    'rmdir -- /repo/.claude_todo',
    'rmdir -- /repo/.claude_todo/archive',
    'rmdir -- /repo/mods/x/.claude_todo',
    'rmdir -- /repo/mods/x/.claude_todo/archive',
    'rmdir -- /repo/mods/y/.claude_todo',
    'rmdir -- /repo/mods/y/.claude_todo/archive',
  ])
  expect(await ui.find({ key: 'todo-delete-empty' })).toBeUndefined()
})

test('Delete empty todos keeps a file that gained content since the scan', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] one' }
  let reads = 0
  Object.defineProperty(files, '/repo/mods/x/.claude_todo/OLD.md', {
    enumerable: true,
    configurable: true,
    get: () => {
      reads += 1

      return reads >= 1 ? '- [ ] new content' : ''
    },
    set: () => undefined,
  })
  reads = -1
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/OLD.md'] })
  const ui = await open($)
  expect(await ui.find({ key: 'todo-delete-empty' })).toBeDefined()
  reads = 0
  await ui.press({ key: 'todo-delete-empty' })
  expect(trashed(calls)).toEqual([])
  expect(rmCalls(calls).some(call => call.startsWith('rm --'))).toBe(false)
})

/** A repo with two empty todo files and one with content, for the trash tests. */
const EMPTIES = (root = '/repo'): Record<string, string> => ({
  [`${root}/.claude_todo/TODO.md`]: '- [ ] one',
  [`${root}/mods/x/.claude_todo/OLD's.md`]: '',
})

/** Runs Delete empty todos on a fake repo and returns the calls, the files left and the toasts. */
async function trashRun($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { root?: string; uname?: string; failing?: string[]; stays?: string[] }) {
  mock.clock(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  const root = opts.root ?? '/repo'
  const { calls } = repoWith(on, files, { ...opts, hasNearest: true, listed: ['.claude_todo/TODO.md', "mods/x/.claude_todo/OLD's.md"], rev: `${root}\n${root}/.git\n` })
  const ui = await open($)
  await ui.press({ key: 'todo-delete-empty' })

  return { calls, toasts: toasts.join('\n') }
}

test('Delete empty todos on macOS uses /usr/bin/trash without --, and never rm', async ($, on) => {
  const files = EMPTIES()
  const { calls, toasts } = await trashRun($, on, files, {})
  expect(calls).toContain("/usr/bin/trash /repo/mods/x/.claude_todo/OLD's.md")
  expect(calls.some(call => call.startsWith('osascript'))).toBe(false)
  expect(calls.filter(call => call.startsWith('uname'))).toEqual(['uname -s'])
  expect(rmCalls(calls).filter(call => call.startsWith('rm --'))).toEqual([])
  expect(Object.keys(withoutLink(files))).toEqual(['/repo/.claude_todo/TODO.md'])
  expect(toasts).toContain('Moved 1 empty todo file to the Trash')
})

test('Delete empty todos on macOS falls back to osascript when trash fails', async ($, on) => {
  const files = EMPTIES()
  const { calls } = await trashRun($, on, files, { failing: ['/usr/bin/trash'] })
  expect(calls).toContain(`osascript -e tell application "Finder" to delete POSIX file "/repo/mods/x/.claude_todo/OLD's.md"`)
  expect(files["/repo/mods/x/.claude_todo/OLD's.md"]).toBeUndefined()
  expect(calls.filter(call => call.startsWith('rm --'))).toEqual([])
})

test('Delete empty todos on Linux tries gio, then trash-put, then kioclient5', async ($, on) => {
  const first = EMPTIES()
  const one = await trashRun($, on, first, { uname: 'Linux' })
  expect(one.calls).toContain("gio trash -- /repo/mods/x/.claude_todo/OLD's.md")
  expect(one.calls.some(call => call.startsWith('trash-put'))).toBe(false)
  expect(Object.keys(withoutLink(first))).toEqual(['/repo/.claude_todo/TODO.md'])
})

test('Delete empty todos on Linux falls back to trash-put when gio fails', async ($, on) => {
  const files = EMPTIES()
  const { calls } = await trashRun($, on, files, { uname: 'Linux', failing: ['gio'] })
  expect(calls).toContain("gio trash -- /repo/mods/x/.claude_todo/OLD's.md")
  expect(calls).toContain("trash-put -- /repo/mods/x/.claude_todo/OLD's.md")
  expect(calls.some(call => call.startsWith('kioclient5'))).toBe(false)
  expect(files["/repo/mods/x/.claude_todo/OLD's.md"]).toBeUndefined()
})

test('Delete empty todos keeps the file and says why when no trash command works, and never calls rm', async ($, on) => {
  const files = EMPTIES()
  const { calls, toasts } = await trashRun($, on, files, { uname: 'Linux', failing: ['gio', 'trash-put', 'kioclient5'] })
  expect(calls.some(call => call.startsWith('kioclient5 move'))).toBe(true)
  expect(rmCalls(calls).filter(call => call.startsWith('rm --'))).toEqual([])
  expect(files["/repo/mods/x/.claude_todo/OLD's.md"]).toBe('')
  expect(toasts).toContain("OLD's.md")
  expect(toasts).toContain('no trash command found; install gio or trash-cli')
  expect(toasts).toContain('Moved 0 empty todo files')
})

test('Delete empty todos counts a command that exits 0 but leaves the file as a failure', async ($, on) => {
  const files = EMPTIES()
  const { calls, toasts } = await trashRun($, on, files, { stays: ['/usr/bin/trash', 'osascript'] })
  expect(calls.some(call => call.startsWith('osascript'))).toBe(true)
  expect(files["/repo/mods/x/.claude_todo/OLD's.md"]).toBe('')
  expect(calls.filter(call => call.startsWith('rm --'))).toEqual([])
  expect(toasts).toContain('file kept')
})

test('Delete empty todos on a Windows path uses PowerShell, with the path as character codes and a fixed-drive check', async ($, on) => {
  const files = EMPTIES('C:/repo')
  const { calls, toasts } = await trashRun($, on, files, { root: 'C:/repo' })
  const script = calls.find(call => call.startsWith('powershell.exe') && call.includes('DeleteFile'))
  expect(script).toContain(`$p = ${psPath("C:/repo/mods/x/.claude_todo/OLD's.md")}`)
  expect(script).not.toContain("OLD's")
  expect(script).toContain("DriveType -ne 'Fixed') { exit 3 }")
  expect(script).toContain("GetValue('NukeOnDelete') -eq 1 }) { exit 4 }")
  expect(script).toContain("DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')")
  // No character of a file name reaches the script as text: curly quotes, `$` and backticks become codes.
  expect(psPath('C:/a’);$x`b')).toBe('[string]::new([char[]](67,58,92,97,8217,41,59,36,120,96,98))')
  expect(calls.some(call => call.startsWith('uname') || call.startsWith('/usr/bin/trash'))).toBe(false)
  expect(calls.some(call => call.includes('[System.IO.Directory]::Delete('))).toBe(true)
  expect(calls.some(call => call.startsWith('rm'))).toBe(false)
  expect(Object.keys(withoutLink(files))).toEqual(['C:/repo/.claude_todo/TODO.md'])
  expect(toasts).toContain('Moved 1 empty todo file to the Recycle Bin')
})

test('isGlobalTodo matches a Windows home too, in any case', () => {
  expect(isGlobalTodo('C:/Accounts/Me/.claude/.claude_todo')).toBe(true)
  expect(isGlobalTodo('c:\\accounts\\Me\\.claude\\.claude_todo\\')).toBe(true)
  expect(isGlobalTodo('C:/repo/.claude_todo')).toBe(false)
  // A profile outside C:/Users still counts: on Windows every .claude/.claude_todo is global.
  expect(isGlobalTodo('D:/Profiles/me/.claude/.claude_todo')).toBe(true)
})

test('Delete duplicate tickets keeps the first of each exact group, fixes references, and tells Claude', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': ['- [ ] #T1 Fix the parser', '- [ ] #T2 Fix the parser', '- [ ] #T3 fix the parser', '- [x] #T4 Fix the parser', '- [ ] #T5 Fix the parsr', '- [ ] see #T2 and #T1', '- [ ] #T6 Other'].join('\n'),
    '/repo/.claude_todo/archive/OLD.md': '- [x] #T9 done, after #T2',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/archive/OLD.md'] })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }) as never)
  const ui = await open($)
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  await ui.press({ key: 'todo-delete-dup-tickets' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe(['- [ ] #T1 Fix the parser', '- [ ] #T3 fix the parser', '- [x] #T4 Fix the parser', '- [ ] #T5 Fix the parsr', '- [ ] see #T1 and #T1', '- [ ] #T6 Other'].join('\n'))
  expect(files['/repo/.claude_todo/archive/OLD.md']).toBe('- [x] #T9 done, after #T1')
  expect(toasts.join('\n')).toContain('#T2 is now #T1')
  expect(JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x' } as never))).toContain('#T2 is now #T1')
  expect(await ui.find({ key: 'todo-delete-dup-tickets' })).toBeUndefined()
})

test('Delete duplicate tickets skips a target that changed since it was read', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {}
  let reads = 0
  Object.defineProperty(files, '/repo/.claude_todo/TODO.md', {
    enumerable: true,
    configurable: true,
    get: () => {
      reads += 1

      return reads >= 2 ? '- [ ] #T1 A\n- [ ] #T2 A\n- [ ] #T3 added' : '- [ ] #T1 A\n- [ ] #T2 A'
    },
    set: () => undefined,
  })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  reads = 0
  await ui.press({ key: 'todo-delete-dup-tickets' })
  expect(writes).toEqual([])
})

test('the three buttons are off in the global folder and in a linked worktree', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/home/a/.claude/.claude_todo/TODO.md': '- [ ] #T1 a\n- [ ] #T2 a',
    '/home/a/.claude/mods/x/.claude_todo/TODO.md': '- [ ] one',
    '/home/a/.claude/mods/y/.claude_todo/EMPTY.md': '',
  }
  const { writes, calls } = repoWith(on, files, { root: '/home/a/.claude', hasNearest: false, listed: ['mods/x/.claude_todo/TODO.md', 'mods/y/.claude_todo/EMPTY.md'] })
  const ui = await open($)
  for (const key of ['todo-consolidate', 'todo-delete-empty', 'todo-delete-dup-tickets']) {
    expect(await ui.find({ key })).toBeUndefined()
  }
  expect(writes).toEqual([])
  expect(rmCalls(calls)).toEqual([])
})

test('in a linked worktree the three buttons are off', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] one\n- [ ] two', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] x', '/repo/mods/y/.claude_todo/E.md': '' }
  const { writes, calls } = repoWith(on, files, { hasNearest: true, rev: '/repo\n/elsewhere/.git\n', listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/y/.claude_todo/E.md'] })
  const ui = await open($)
  for (const key of ['todo-consolidate', 'todo-delete-empty', 'todo-delete-dup-tickets']) {
    expect(await ui.find({ key })).toBeUndefined()
  }
  expect(writes).toEqual([])
  expect(rmCalls(calls)).toEqual([])
})

test('a central file that cannot be read stops Consolidate and writes nothing', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/mods/x/.claude_todo/TODO.md': '- [ ] two' }
  let isBroken = false
  Object.defineProperty(files, '/repo/.claude_todo/TODO.md', { enumerable: true, configurable: true, get: () => { if (isBroken) { throw new Error('EIO') } return '- [ ] one' }, set: () => undefined })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  const ui = await open($)
  isBroken = true
  await ui.press({ key: 'todo-consolidate' })
  expect(writes).toEqual([])
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] two')
  expect(toasts.join('\n')).toContain('Could not consolidate')
})

// ---------------------------------------------------------------- the orchestrator owns tickets

const ORCH_FILE = '- [ ] #T1 Ship the parser\n- [ ] #T2 Review the copy\n- [~] #T3 Check the invoice'

/** A pane over one todo file the test can edit; `edit` is what the main conversation or a helper does to it. */
function orchSetup($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], store = new Map<string, unknown>()) {
  const state = { file: ORCH_FILE, mtime: 1 }
  mock.clock(on)
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: state.mtime, isLink: false }] }))
  on('fs.read', () => ({ value: state.file }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Helper', type: 'general-purpose', status: 'running' }] }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} }) as never)
  const edit = (next: string, agentId?: string) => {
    state.file = next
    state.mtime += 1

    return $.tool.call({ tool: 'Edit', file_path: '/repo/.claude_todo/OPEN.md', ...(agentId === undefined ? {} : { agentId }) } as never)
  }

  return { state, store, edit }
}

/** Opens the pane's session as a start would: the scan, then the first agent list, which also loads the kept data. */
async function begin($: Parameters<Parameters<typeof test>[1]>[0]): Promise<void> {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', agentId: 'a1' } as never).catch(() => undefined)
}

const orchCard = (drawn: string) => drawn.includes('O, Orchestrator')

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

test('an orchestrator ticket tag is O in its own color and blinks only while the orchestrator runs', () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [~] #T3 Check the invoice') }]
  const make = (isRunning: boolean) => buildView(list, [], 0, { keys: new Set(['#t3']), isRunning, toolCalls: 1 })
  expect(AGENT_COLORS).not.toContain('#1fa7b8')
  for (const [isRunning, blinks] of [[true, true], [false, false]] as const) {
    const view = make(isRunning)
    const item = view.files[0]!.items[0]!
    const ticket = ticketSvg(item, view, 400, { id: '#T3', isSent: false }).source
    const listed = fileCards(view.files[0]!, view, 12)[0]!.source
    for (const source of [ticket, listed]) {
      expect(source).toContain('#1fa7b8')
      expect(source).toContain('>O<')
      expect(source.includes('@keyframes k0')).toBe(blinks)
    }
    const card = agentSvg(view.orchestrator!, view).source
    expect(card).toContain(isRunning ? '>Running<' : '>Idle<')
    expect(card.includes('@keyframes k0')).toBe(blinks)
    expect(card).toContain('>O<')
    expect(card).toContain('#T3 Check the invoice')
  }
})

test('a ticket the main conversation sets in progress by an edit is the orchestrator\'s; a helper\'s edit is not', async ($, on) => {
  const { edit } = orchSetup($, on)
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const drawn = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(orchCard(await drawn())).toBe(false)
  await edit('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy\n- [~] #T3 Check the invoice', 'a1')
  expect(orchCard(await drawn())).toBe(false)
  await edit('- [~] #T1 Ship the parser\n- [~] #T2 Review the copy\n- [~] #T3 Check the invoice')
  const after = await drawn()
  expect(orchCard(after)).toBe(true)
  const card = (await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg)).find(orchCard) ?? ''
  expect(card).toContain('#T2 Review the copy')
  expect(card).not.toContain('#T1 Ship the parser')
  expect(card).not.toContain('#T3 Check the invoice')
  // The orchestrator leads the Agents card, before A1, and is not one of the agents counted on top.
  expect(after.indexOf('O, Orchestrator')).toBeLessThan(after.indexOf('A1, Helper'))
  expect(after).toContain('0 of 1 agent')
})

test('a main-conversation report_progress that names a ticket makes it the orchestrator\'s; a helper\'s does not', async ($, on) => {
  orchSetup($, on)
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const drawn = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 0, total: 2, items: ['#T2'], agentId: 'a1' } as never)
  expect(orchCard(await drawn())).toBe(false)
  await $.tool.call({ tool: 'mcp__claudeopticon__report_progress', done: 0, total: 2, items: ['#T2'] } as never)
  const after = await drawn()
  expect(orchCard(after)).toBe(true)
  expect(after).toContain('#T2 Review the copy')
})

test('Send to Claude makes the ticket the orchestrator\'s, held in progress while its box is still open', async ($, on) => {
  orchSetup($, on)
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const drawn = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(orchCard(await drawn())).toBe(false)
  await ui.press({ key: 'ticket-OPEN.md-#t1' })
  const card = (await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg)).find(orchCard) ?? ''
  expect(card).toContain('#T1 Ship the parser')
  expect(card).not.toContain('#T2 Review the copy')
  // The status button on a ticket already in progress claims it too.
  await ui.press({ key: 'ticket-OPEN.md-#t3' })
  expect((await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg)).find(orchCard)).toContain('#T3 Check the invoice')
})

test('the orchestrator card says Running during a turn and Idle after it, and the ticket blinks only while it runs', async ($, on) => {
  const { edit } = orchSetup($, on)
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const card = async () => (await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg)).find(orchCard) ?? ''
  const ticket = async () => (await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg)).find(text => text.includes('Ship the parser') && text.includes('>O<')) ?? ''
  await $.prompt.submit({ text: 'Do T1', asUser: true } as never)
  await edit('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy\n- [~] #T3 Check the invoice')
  expect(await card()).toContain('O, Orchestrator: Running')
  expect(await card()).toContain('@keyframes k0')
  expect(await ticket()).toContain('@keyframes k0')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1' } as never).catch(() => undefined)
  expect(await card()).toContain('O, Orchestrator: Idle')
  expect(await card()).not.toContain('@keyframes k0')
  expect(await ticket()).toContain('#1fa7b8')
  expect(await ticket()).not.toContain('@keyframes k0')
  await $.prompt.submit({ text: 'More', asUser: true } as never)
  expect(await ticket()).toContain('@keyframes k0')
})

test('the orchestrator keeps a ticket until it is no longer in progress, and drops the card with the last one', async ($, on) => {
  const { edit } = orchSetup($, on)
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const drawn = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  await edit('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy\n- [~] #T3 Check the invoice')
  await edit('- [~] #T1 Ship the parser\n- [~] #T2 Review the copy\n- [~] #T3 Check the invoice')
  expect(orchCard(await drawn())).toBe(true)
  await edit('- [~] #T1 Ship the parser\n- [x] #T2 Review the copy\n- [~] #T3 Check the invoice')
  expect(orchCard(await drawn())).toBe(true)
  await edit('- [~] #T1 Ship the parser\n- [x] #T2 Review the copy\n- [x] #T3 Check the invoice')
  expect(orchCard(await drawn())).toBe(true)
  await edit('- [ ] #T1 Ship the parser\n- [x] #T2 Review the copy\n- [x] #T3 Check the invoice')
  expect(orchCard(await drawn())).toBe(false)
})

test('the orchestrator tickets are kept by session, and read back with only well-formed pairs', async ($, on) => {
  const store = new Map<string, unknown>()
  const { edit } = orchSetup($, on, store)
  await begin($)
  await edit('- [ ] #T1 Ship the parser\n- [ ] #T2 Review the copy\n- [~] #T3 Check the invoice'.replace('[ ] #T1', '[~] #T1'))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as never).catch(() => undefined)
  expect(readKeptTickets(store.get('orchestrator:sess-1'))).toEqual([['#t1', true]])
  expect(readKeptTickets([['x', true], ['y'], 3, ['z', 'no']])).toEqual([['x', true]])
})

test('a stored claim comes back after a reload, and a claim on a ticket that is gone is dropped', async ($, on) => {
  const store = new Map<string, unknown>([['orchestrator:sess-1', [['#t2', false], ['#gone', true]]]])
  orchSetup($, on, store)
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const shown = (await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg)).find(orchCard) ?? ''
  expect(shown).toContain('#T2 Review the copy')
  expect(shown).toContain('O, Orchestrator: Idle')
  expect(readKeptTickets(store.get('orchestrator:sess-1'))).toEqual([['#t2', false]])
})

const PROGRESS = 'mcp__claudeopticon__report_progress'
const orchSvgs = async (ui: Awaited<ReturnType<Parameters<Parameters<typeof test>[1]>[0]['ui']['mount']>>) => (await ui.findAll({ type: 'Svg' })).map(svg => JSON.stringify(svg))

test('report_progress title from the main conversation titles the orchestrator card; a helper\'s title is ignored', async ($, on) => {
  orchSetup($, on)
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await $.tool.call({ tool: PROGRESS, done: 0, total: 2, items: ['#T2'], title: 'Helper headline', agentId: 'a1' } as never)
  await $.tool.call({ tool: PROGRESS, done: 0, total: 2, items: ['#T2'] } as never)
  const fallback = (await orchSvgs(ui)).find(orchCard) ?? ''
  expect(fallback).not.toContain('Helper headline')
  await $.tool.call({ tool: PROGRESS, done: 0, total: 2, items: ['#T2'], title: '  Polish the copy\nsecond line' } as never)
  const card = (await orchSvgs(ui)).find(orchCard) ?? ''
  expect(card).toContain('>Polish the copy<')
  expect(card).toContain('Orchestrator')
  expect(card).toContain('main conversation')
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

test('the orchestrator title is kept by session, comes back after a reload, and goes with the last ticket', async ($, on) => {
  const store = new Map<string, unknown>()
  const { edit } = orchSetup($, on, store)
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await edit('- [~] #T1 Ship the parser\n- [ ] #T2 Review the copy\n- [ ] #T3 Check the invoice')
  await $.tool.call({ tool: PROGRESS, done: 0, total: 1, items: ['#T1'], title: 'Parser work' } as never)
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(store.get('orchestrator-title:sess-1')).toBe('Parser work')
  expect((await orchSvgs(ui)).find(orchCard)).toContain('>Parser work<')
  await edit('- [x] #T1 Ship the parser\n- [ ] #T2 Review the copy\n- [ ] #T3 Check the invoice')
  expect((await orchSvgs(ui)).find(orchCard)).toBeUndefined()
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(store.get('orchestrator-title:sess-1')).toBe('')
})

test('a stored orchestrator title comes back after a reload', async ($, on) => {
  const store = new Map<string, unknown>([['orchestrator:sess-1', [['#t2', false]]], ['orchestrator-title:sess-1', 'Copy review']])
  orchSetup($, on, store)
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect((await orchSvgs(ui)).find(orchCard)).toContain('>Copy review<')
})

test('the rules tell Claude to report a title when it works on tickets itself', () => {
  expect(RULES).toContain('report_progress` with `title`')
})

test('callDetail gives the native detail per tool, relative paths, one line, hidden secrets and no repeat of the summary', () => {
  const root = '/repo'
  expect(callDetail('Bash', { command: 'npm test -- --run\nnext line' }, 'Run tests', root)).toBe('npm test -- --run')
  expect(callDetail('Read', { file_path: '/repo/src/a.ts' }, 'Read: /repo/src/a.ts', root)).toBe('src/a.ts')
  expect(callDetail('Edit', { file_path: '/elsewhere/a.ts' }, 'x', root)).toBe('/elsewhere/a.ts')
  expect(callDetail('Write', { file_path: '/repo/b.md' }, 'x', root)).toBe('b.md')
  expect(callDetail('NotebookEdit', { notebook_path: '/repo/n.ipynb' }, 'x', root)).toBe('n.ipynb')
  expect(callDetail('Grep', { pattern: 'foo.*bar' }, 'x', root)).toBe('foo.*bar')
  expect(callDetail('Grep', { pattern: 'foo', path: '/repo/hooks' }, 'x', root)).toBe('foo  hooks')
  expect(callDetail('Glob', { pattern: '**/*.ts' }, 'x', root)).toBe('**/*.ts')
  expect(callDetail('WebFetch', { url: 'https://example.com/a' }, 'x', root)).toBe('https://example.com/a')
  expect(callDetail('WebSearch', { query: 'svg text fit' }, 'x', root)).toBe('svg text fit')
  expect(callDetail('Task', { subagent_type: 'reviewer', model: 'opus' }, 'x', root)).toBe('reviewer, opus')
  expect(callDetail('Agent', { subagent_type: 'reviewer' }, 'x', root)).toBe('reviewer')
  expect(callDetail('Skill', { skill: 'code-style' }, 'x', root)).toBe('code-style')
  expect(callDetail('mcp__x__tool', { query: 'q', url: 'u' }, 'x', root)).toBeUndefined()
  expect(callDetail('Bash', {}, 'x', root)).toBeUndefined()
  expect(callDetail('Bash', { command: 'ls' }, 'ls', root)).toBeUndefined()
  for (const command of ['curl --password hunter2 x', 'export TOKEN=abc', 'curl -H "Authorization: Bearer x" u', 'run --api_key k', 'echo $SECRET']) {
    expect(callDetail('Bash', { command }, 'x', root)).toBe('(hidden)')
  }
  expect(callDetail('Bash', { command: 'a'.repeat(1000) }, 'x', root)?.length).toBe(300)
})

test('the orchestrator card draws a dim mono detail line per entry, in a taller card, and none when there is no detail', () => {
  const plain = orchestratorSvg([{ line: 'A', at: 0, isRunning: false }, { line: 'B', at: 0, isRunning: false }])
  const rich = orchestratorSvg([{ line: 'A', at: 0, isRunning: false, detail: 'npm test <all>' }, { line: 'B', at: 0, isRunning: false }])
  expect(rich.height).toBe(plain.height + 16)
  expect(rich.source).toContain('npm test &lt;all&gt;')
  expect(rich.source).not.toContain('<all>')
  expect(rich.source).toMatch(/font-size="11" class="mono">npm test/)
  expect(plain.source).not.toContain('font-size="11"')
  expect(rich.source).toContain(`height="${rich.height}"`)
  const long = orchestratorSvg([{ line: 'A', at: 0, isRunning: false, detail: 'x'.repeat(400) }])
  expect(long.source).toContain('…')
  expect(long.source).not.toContain('x'.repeat(400))
})

test('main-conversation calls store their detail; a duplicate or an MCP call has none; the terminal view shows it after the line', async ($, on) => {
  orchSetup($, on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: {} }) as never)
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' } as never)
  await $.tool.call({ tool: 'Bash', command: 'curl --password x u', description: 'Call the API' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const drawn = (await orchSvgs(ui)).join('')
  expect(drawn).toContain('>npm test<')
  expect(drawn).toContain('>(hidden)<')
  expect(drawn).not.toContain('hunter')
  expect(drawn).not.toContain('--password')
  const terminal = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
  const text = JSON.stringify(await terminal.drawn())
  expect(text).toContain('Run the tests')
  expect(text).toContain('npm test')
  expect(text).not.toContain('--password')
})

test('the text view lists the orchestrator before the agents', async ($, on) => {
  orchSetup($, on, new Map<string, unknown>([['orchestrator:sess-1', [['#t2', false]]]]))
  await begin($)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('main conversation')
  expect(drawn.indexOf('main conversation')).toBeLessThan(drawn.indexOf('Helper'))
})

// ---------------------------------------------------------------- archiving closed tickets

const PLAN_TEXT = ['# Plan', '', '## Core', '- [x] #T1 Done parser', '  note under it', '- [ ] #T2 Open lexer', '- [x] #T3 Done with open child', '  - [ ] #T4 child open', '', '## Docs', '- [x] #T5 Done docs', 'prose stays'].join('\n')

test('closedBlocks finds a top-level done ticket with its indented lines, only when every box in the block is done', () => {
  const blocks = closedBlocks(PLAN_TEXT)
  expect(blocks.map(block => block.lines)).toEqual([['- [x] #T1 Done parser', '  note under it'], ['- [x] #T5 Done docs']])
  expect(blocks.map(block => block.heading)).toEqual(['## Core', '## Docs'])
  expect(blocks.map(block => [block.from, block.to])).toEqual([[3, 5], [10, 11]])
  // A done subtask under an open ticket stays; a done child under a done ticket goes with it.
  expect(closedBlocks('- [ ] #T1 Open\n  - [x] done child')).toEqual([])
  expect(closedBlocks('- [x] #T1 Done\n  - [x] done child\n    - [X] deeper')[0]?.lines.length).toBe(3)
  expect(closedBlocks('- [x] #T1 Done\n  - [~] child going')).toEqual([])
  // Only an unindented ticket line starts a block; the bullet and the box case can differ.
  expect(closedBlocks('  - [x] indented only')).toEqual([])
  expect(closedBlocks('* [X] Star bullet')[0]?.lines).toEqual(['* [X] Star bullet'])
  // A block runs past blank lines while the next non-blank line is indented; the blanks after its last line are not taken.
  expect(closedBlocks('- [x] A\n\n  later indent\n\n- [x] B').map(block => [block.lines, block.from, block.to])).toEqual([[['- [x] A', '', '  later indent'], 0, 3], [['- [x] B'], 4, 5]])
  // An open or in-progress subtask after a blank line keeps the whole block: it never joins the item above.
  expect(closedBlocks('- [x] A\n  - [x] done\n\n  - [ ] open after a blank')).toEqual([])
  expect(closedBlocks('- [x] A\n\n\n    - [~] going')).toEqual([])
  // Prose, a table and a code fence are never moved.
  expect(closedBlocks('| a | b |\n|---|---|\n```\n- [x] in a fence\n```').length).toBe(0)
  // A block with no heading above it has none.
  expect(closedBlocks('- [x] Top')[0]?.heading).toBeUndefined()
  // Removing the blocks leaves everything else exactly.
  expect(removeBlocks(PLAN_TEXT, blocks)).toBe(['# Plan', '', '## Core', '- [ ] #T2 Open lexer', '- [x] #T3 Done with open child', '  - [ ] #T4 child open', '', '## Docs', 'prose stays'].join('\n'))
})

test('addToArchive groups blocks under their heading, never twice', () => {
  const blocks = closedBlocks(PLAN_TEXT)
  const fresh = addToArchive('', blocks)
  expect(fresh).toBe('## Core\n\n- [x] #T1 Done parser\n  note under it\n\n## Docs\n\n- [x] #T5 Done docs\n')
  // A retry adds nothing: the exact block is there, and it is what this mod wrote last.
  expect(addToArchive(fresh, blocks, blocks.map(block => block.lines))).toBe(fresh)
  // Under an existing heading the block goes at the end of that section; another section is untouched.
  const merged = addToArchive('## Docs\n\n- [x] #T0 Older\n\n## Other\n\n- [x] #T9 x\n', [blocks[1]!])
  expect(merged).toBe('## Docs\n\n- [x] #T0 Older\n- [x] #T5 Done docs\n\n## Other\n\n- [x] #T9 x\n')
  // A new heading goes at the end of the file; a block with no heading goes at the end with none.
  expect(addToArchive('- [x] #T0 Older\n', [blocks[0]!])).toBe('- [x] #T0 Older\n\n## Core\n\n- [x] #T1 Done parser\n  note under it\n')
  expect(addToArchive('## Core\n\n- [x] #T0 Older\n', closedBlocks('- [x] #T7 Loose'))).toBe('## Core\n\n- [x] #T0 Older\n- [x] #T7 Loose\n')
  // A heading with nothing under it takes the block after a blank line.
  expect(addToArchive('## Docs\n', [blocks[1]!])).toBe('## Docs\n\n- [x] #T5 Done docs\n')
})

test('closedBlocks: a fence line in a block keeps it, and the fence state still holds', () => {
  expect(closedBlocks('- [x] A\n  ```\n- [x] fenced\n  ```\n- [x] B').map(block => block.lines)).toEqual([['- [x] B']])
  expect(closedBlocks('- [x] A\n  ~~~\n  code\n  ~~~').length).toBe(0)
})

test('CRLF: a trailing carriage return never hides a checkbox, and a checkbox-like line that fails the match counts open', () => {
  expect(closedBlocks('- [x] A\r\n  - [ ] open\r\n')).toEqual([])
  expect(closedBlocks('- [x] A\n  - [ ] open\r\n- [x] B\r\n').map(block => block.lines)).toEqual([['- [x] B']])
  expect(closedBlocks('- [x] A\r\n  note\r\n')[0]?.lines).toEqual(['- [x] A', '  note'])
  expect(closedBlocks('- [x] A\n  - [ ]')).toEqual([])
  expect(parseTodo('- [ ] a\r\n- [x] b\r').map(item => [item.text, item.status])).toEqual([['a', 'pending'], ['b', 'completed']])
  // The archive keeps its own line ending, else the source's.
  const [block] = closedBlocks('## Core\r\n- [x] #T1 Done parser\r\n  note under it\r\n')
  expect(addToArchive('## Core\r\n\r\n- [x] #T0 Older\r\n', [block!])).toBe('## Core\r\n\r\n- [x] #T0 Older\r\n- [x] #T1 Done parser\r\n  note under it\r\n')
  expect(addToArchive('', [block!], [], '\r\n')).toBe('## Core\r\n\r\n- [x] #T1 Done parser\r\n  note under it\r\n')
  expect(addToArchive('- [x] #T0 Older\n', [block!], [], '\r\n')).toBe('- [x] #T0 Older\n\n## Core\n\n- [x] #T1 Done parser\n  note under it\n')
})

test('parseTodo skips checkbox lines inside code fences', () => {
  expect(parseTodo('- [ ] a\n```\n- [ ] fenced\n```\n~~~\n- [x] tilde\n~~~\n- [x] b').map(item => item.text)).toEqual(['a', 'b'])
})

test('fences are CommonMark-like: a fence closes only on its own character, at least as long, with nothing else on the line', () => {
  // A tilde line inside a backtick fence does not close it, and nothing in it is parsed.
  expect(parseTodo('```\n~~~\n- [x] in code\n```\n- [ ] #T1 real').map(item => item.text)).toEqual(['#T1 real'])
  const text = '```\n~~~\n- [x] in code\n```\n- [x] #T2 done'
  const [block, ...more] = closedBlocks(text)
  expect(more).toEqual([])
  expect(block?.lines).toEqual(['- [x] #T2 done'])
  // The line in code stays where it is when the block is cut.
  expect(removeBlocks(text, [block!])).toBe('```\n~~~\n- [x] in code\n```')
  // A 4-backtick fence holds a 3-backtick line; a shorter run does not close it.
  const four = '````\n```\n- [x] in code\n```\n````\n- [ ] #T3 real\n- [x] #T4 done'
  expect(parseTodo(four).map(item => item.text)).toEqual(['#T3 real', '#T4 done'])
  expect(closedBlocks(four).map(one => one.lines)).toEqual([['- [x] #T4 done']])
  // A closing line with an info string is content; a longer closing run closes.
  expect(parseTodo('```\n```js\n- [ ] hidden\n````\n- [ ] #T5 real').map(item => item.text)).toEqual(['#T5 real'])
  // A backtick fence's info string may not hold a backtick: no fence opens.
  expect(parseTodo('```a`b\n- [ ] #T6 real').map(item => item.text)).toEqual(['#T6 real'])
  // Four spaces of indent is code by indent, not a fence.
  expect(parseTodo('    ```\n- [ ] #T7 real').map(item => item.text)).toEqual(['#T7 real'])
})

test('addToArchive does not take a heading inside a code fence for a heading', () => {
  const [block] = closedBlocks('## Core\n- [x] #T1 Done parser\n  note under it')
  expect(addToArchive('## Core\n\n- [x] #T0 Older\n\n## Other\n\n```\n## Core\n```\n', [block!])).toBe('## Core\n\n- [x] #T0 Older\n- [x] #T1 Done parser\n  note under it\n\n## Other\n\n```\n## Core\n```\n')
  expect(addToArchive('## Core\n\n- [x] #T0 Older\n\n```\n# install\n```\n- [x] #T3 After fence\n\n## Other\n', [block!])).toBe('## Core\n\n- [x] #T0 Older\n\n```\n# install\n```\n- [x] #T3 After fence\n- [x] #T1 Done parser\n  note under it\n\n## Other\n')
})

test('addToArchive skips a block only when it stands whole in the archive and this mod wrote it last', () => {
  const one = closedBlocks('- [x] #T1 Done parser')
  const arch = '- [x] #T1 Done parser\n'
  // A new block that equals an old archived line is added.
  expect(addToArchive(arch, one)).toBe('- [x] #T1 Done parser\n- [x] #T1 Done parser\n')
  expect(addToArchive(arch, one, [one[0]!.lines])).toBe(arch)
  // A longer archived block does not count as the run: the next line is indented.
  expect(addToArchive('- [x] #T1 Done parser\n  note\n', one, [one[0]!.lines])).toBe('- [x] #T1 Done parser\n  note\n- [x] #T1 Done parser\n')
})

test('openCommand picks the opener per platform, with no shell, and archiveName picks the file', () => {
  expect(openCommand('/repo/.claude_todo/archive/TODO.md', 'Darwin')).toEqual(['open', '/repo/.claude_todo/archive/TODO.md'])
  expect(openCommand('/home/a/my repo/a.md', 'Linux')).toEqual(['xdg-open', '/home/a/my repo/a.md'])
  expect(openCommand('/home/a/a.md', '')).toEqual(['xdg-open', '/home/a/a.md'])
  expect(openCommand('C:/repo x/.claude_todo/archive/TODO.md', 'Linux')).toEqual(['explorer.exe', 'C:\\repo x\\.claude_todo\\archive\\TODO.md'])
  const file = (name: string, folder = '/r', isArchived?: true) => ({ name, folder, ...(isArchived ? { isArchived } : {}) })
  expect(archiveName([file('A.md'), file('todo.md')], '/r')).toBe('todo.md')
  expect(archiveName([file('A.md'), file('archive/TODO.md', '/r', true)], '/r')).toBe('TODO.md')
  expect(archiveName([file('NOTES.md')], '/r')).toBe('NOTES.md')
  expect(archiveName([file('A.md'), file('B.md')], '/r')).toBe('TODO.md')
  expect(archiveName([file('archive/OLD.md', '/r', true)], '/r')).toBe('OLD.md')
  expect(archiveName([file('A.md', '/other')], '/r')).toBe('TODO.md')
  expect(readKeptArchived([{ text: 't', status: 'completed', owners: [], key: 'k' }, { text: 'x', status: 'pending', owners: [], key: 'k' }, 3])).toEqual([{ text: 't', status: 'completed', owners: [], key: 'k' }])
})

test('a closed ticket moves to archive/<same file> after 5 seconds, under its heading, and the live file keeps the rest', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': PLAN_TEXT }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  // The archive file is made, empty, for the Show completed link: nothing else yet.
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('')
  // Debounce: seen closed at the first scan; the second scan, 3 s on, is too early.
  await clock.advance(3000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe(PLAN_TEXT)
  expect(writes).toEqual([])
  await clock.advance(3000)
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('## Core\n\n- [x] #T1 Done parser\n  note under it\n\n## Docs\n\n- [x] #T5 Done docs\n')
  expect(files['/repo/.claude_todo/TODO.md']).toBe(['# Plan', '', '## Core', '- [ ] #T2 Open lexer', '- [x] #T3 Done with open child', '  - [ ] #T4 child open', '', '## Docs', 'prose stays'].join('\n'))
  // The Done column lists them, from this session; the counts still hold the moved tickets.
  const drawn = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(drawn).toContain('Done parser')
  expect(drawn).toContain('Done docs')
  expect(drawn).toContain('Todo 3 of 5 done')
  // A ticket closed later is newer: it leads the Done column.
  files['/repo/.claude_todo/TODO.md'] += '\n- [x] #T6 Later done'
  await clock.advance(6000)
  await clock.advance(3000)
  const later = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(files['/repo/.claude_todo/archive/TODO.md']).toContain('- [x] #T6 Later done')
  expect(later.indexOf('Later done')).toBeGreaterThan(-1)
  expect(later.indexOf('Later done')).toBeLessThan(later.indexOf('Done parser'))
})

test('a ticket reopened inside the 5 seconds is not moved', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 Mis-click' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(3000)
  files['/repo/.claude_todo/TODO.md'] = '- [ ] #T1 Mis-click'
  await clock.advance(9000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Mis-click')
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('')
})

test('a source that changed during the move is not rewritten, and the retry adds the block to the archive once', async ($, on) => {
  const clock = mock.clock(on)
  const archive = '/repo/.claude_todo/archive/TODO.md'
  const files: Record<string, string> = {}
  let current = '- [x] #T1 Done parser\n- [ ] #T2 Open lexer'
  let isSettled = false
  Object.defineProperty(files, '/repo/.claude_todo/TODO.md', {
    enumerable: true,
    configurable: true,
    // The first read after the archive was written finds a new line: the source changed meanwhile.
    get: () => {
      if (!isSettled && (files[archive] ?? '') !== '') {
        isSettled = true

        return `${current}\n- [ ] #T3 added meanwhile`
      }

      return current
    },
    set: value => {
      current = value as string
    },
  })
  files[archive] = ''
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(6000)
  // The source check failed after the archive was written: the archive is put back as it was.
  expect(files[archive]).toBe('')
  expect(writes).toEqual([archive])
  expect(current).toBe('- [x] #T1 Done parser\n- [ ] #T2 Open lexer')
  // The next scan finds it unchanged: the source is cut, and the archive keeps one copy.
  await clock.advance(3000)
  expect(current).toBe('- [ ] #T2 Open lexer')
  expect(files[archive]).toBe('- [x] #T1 Done parser\n')
})

test('a source that changed during the move, with an archive that changed too, keeps the archive and the retry does not add the block twice', async ($, on) => {
  const clock = mock.clock(on)
  const archive = '/repo/.claude_todo/archive/TODO.md'
  const files: Record<string, string> = {}
  let current = '- [x] #T1 Done parser\n- [ ] #T2 Open lexer'
  let isSettled = false
  Object.defineProperty(files, '/repo/.claude_todo/TODO.md', {
    enumerable: true,
    configurable: true,
    // The first read after the archive was written finds a new line, and the archive changes too.
    get: () => {
      if (!isSettled && (files[archive] ?? '') !== '') {
        isSettled = true
        files[archive] += '- [x] #T0 someone else\n'

        return `${current}\n- [ ] #T3 added meanwhile`
      }

      return current
    },
    set: value => {
      current = value as string
    },
  })
  files[archive] = ''
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(6000)
  // Not equal to what the step wrote, so it is not rolled back.
  expect(files[archive]).toBe('- [x] #T1 Done parser\n- [x] #T0 someone else\n')
  await clock.advance(3000)
  expect(current).toBe('- [ ] #T2 Open lexer')
  expect(files[archive]).toBe('- [x] #T1 Done parser\n- [x] #T0 someone else\n')
})

test('a new closed ticket that equals an old archived line is added to the archive, not dropped', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 Done parser', '/repo/.claude_todo/archive/TODO.md': '- [x] #T1 Done parser\n  old note\n' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(6000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('')
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('- [x] #T1 Done parser\n  old note\n- [x] #T1 Done parser\n')
})

test('a CRLF file archives with its own line ending, and an open subtask under a mixed file is never archived', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 Done\r\n  note\r\n- [x] #T2 Mixed\n  - [ ] #T3 open child\r\n' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(6000)
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('- [x] #T1 Done\r\n  note\r\n')
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [x] #T2 Mixed\n  - [ ] #T3 open child\r\n')
})

test('an open subtask after a blank line keeps its parent in the live file', async ($, on) => {
  const clock = mock.clock(on)
  const text = '- [x] #T1 Parent\n  - [x] #T2 done child\n\n  - [ ] #T3 open child\n- [x] #T4 Plain'
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': text }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(9000)
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('- [x] #T4 Plain\n')
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [x] #T1 Parent\n  - [x] #T2 done child\n\n  - [ ] #T3 open child')
})

test('the compare is the last call before each write: the checks come first, then the read', async ($, on) => {
  const clock = mock.clock(on)
  const log: string[] = []
  const live = '/repo/.claude_todo/TODO.md'
  const archive = '/repo/.claude_todo/archive/TODO.md'
  const files: Record<string, string> = { [live]: '- [x] #T1 Done\n- [ ] Open', [archive]: '- [x] #T0 Old\n' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], log })
  await open($)
  await clock.advance(15000)
  // Numbering wrote the live file, then the archive move wrote the archive and then the live file.
  const writes = log.flatMap((entry, at) => (entry.startsWith('write:') ? [at] : []))
  expect(writes.length).toBeGreaterThanOrEqual(3)
  for (const at of writes) {
    if (log[at] === `write:${live}` || (log[at] === `write:${archive}` && files[archive] !== '')) {
      expect(log[at - 1]).toBe(log[at]!.replace('write:', 'read:'))
    }
  }
})

test('Consolidate refuses to start while the archive move runs', async ($, on) => {
  const clock = mock.clock(on)
  let release = () => {}
  const hold = new Promise<void>(resolve => {
    release = resolve
  })
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 Done\n- [ ] #T2 Open', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Elsewhere' }
  const log: string[] = []
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'], hold, log })
  const ui = await open($)
  await clock.advance(3000)
  const moving = clock.advance(3000)
  // Let the move reach its held write: the second write to the archive file (the first makes it, empty).
  const writesToArchive = () => log.filter(entry => entry === 'write:/repo/.claude_todo/archive/TODO.md').length
  for (let i = 0; i < 200 && writesToArchive() < 2; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(writesToArchive()).toBe(2)
  await ui.press({ key: 'todo-consolidate' })
  release()
  await moving
  for (let i = 0; i < 500; i += 1) {
    await Promise.resolve()
  }
  // The press did nothing: the other file was not merged and emptied.
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe('- [ ] #T3 Elsewhere')
})

test('a dangling symlink where the archive file would be is never written over', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 Done', '/repo/.claude_todo/archive/OTHER.md': '- [x] #T0 Old' }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], dangling: ['/repo/.claude_todo/archive/TODO.md'] })
  await open($)
  await clock.advance(12000)
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBeUndefined()
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [x] #T1 Done')
  expect(writes).toEqual([])
})

test('numbering and the archive move leave code fences alone', async ($, on) => {
  const clock = mock.clock(on)
  const text = ['- [ ] Real', '```', '- [ ] Fenced', '- [x] Fenced done', '```', '~~~', '- [ ] Tilde', '~~~'].join('\n')
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': text }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(15000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe(text.replace('- [ ] Real', '- [ ] #T0001 Real'))
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('')
})

const SYMLINKS: [string, Record<string, string>][] = [
  ['an archive file that is a symlink', { '/repo/.claude_todo/archive/TODO.md': '/home/a/.claude/.claude_todo/archive/TODO.md' }],
  ['an archive folder that is a symlink', { '/repo/.claude_todo/archive': '/home/a/elsewhere' }],
  ['a source file that is a symlink', { '/repo/.claude_todo/TODO.md': '/home/a/other/TODO.md' }],
]
for (const [name, links] of SYMLINKS) {
  test(`${name}: nothing is moved or written`, async ($, on) => {
    const clock = mock.clock(on)
    const make = () => ({ '/repo/.claude_todo/TODO.md': '- [x] #T1 Done parser', '/repo/.claude_todo/archive/TODO.md': '- [x] #T0 Old' })
    const files: Record<string, string> = make()
    const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], links })
    await open($)
    await clock.advance(9000)
    expect(files).toEqual(make())
    expect(writes).toEqual([])
  })
}

test('the global folder is never written', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/home/a/.claude/.claude_todo/TODO.md': '- [x] #T1 Done parser' }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], root: '/home/a/.claude' })
  await open($)
  await clock.advance(9000)
  expect(files).toEqual({ '/home/a/.claude/.claude_todo/TODO.md': '- [x] #T1 Done parser' })
  expect(writes).toEqual([])
})

test('a sub-folder of the repo has its closed tickets archived beside it', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Open', '/repo/mods/x/.claude_todo/WORK.md': '# W\n- [x] #T7 Done in x' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/WORK.md'] })
  await open($)
  await clock.advance(6000)
  // The block keeps its heading, of any level.
  expect(files['/repo/mods/x/.claude_todo/archive/WORK.md']).toBe('# W\n\n- [x] #T7 Done in x\n')
  expect(files['/repo/mods/x/.claude_todo/WORK.md']).toBe('# W')
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

/** Four open tickets, sorted into Code (#T1, #T2) and Docs (#T3, #T4), and a model that answers `reply`. */
async function recategorizeSetup($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], reply: () => unknown) {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': ['- [ ] #T1 parser', '- [ ] #T2 lexer', '- [ ] #T3 guide', '- [ ] #T4 faq'].join('\n'),
    '/repo/.claude_todo/categories.json': JSON.stringify({ categories: ['Code', 'Docs'], items: { '#t1': 'Code', '#t2': 'Code', '#t3': 'Docs', '#t4': 'Docs' } }),
  }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    const out = reply()

    return { value: out === undefined ? { isAnswered: false, text: '' } : { isAnswered: true, text: JSON.stringify(out), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  const ui = await open($)

  return { clock, files, writes, prompts, ui }
}

test('Recategorize applies a real change: the new names and assignments are written, from scratch', async ($, on) => {
  const { files, writes, prompts, ui } = await recategorizeSetup($, on, () => ({ categories: ['Lexing', 'Parsing', 'Writing'], assign: { 1: 'Parsing', 2: 'Lexing', 3: 'Writing', 4: 'Writing' } }))
  expect(await ui.find({ key: 'todo-recategorize' })).toBeDefined()
  await ui.press({ key: 'todo-recategorize' })
  expect(prompts.length).toBe(1)
  // The current assignments are ignored: no existing categories in the prompt.
  expect(prompts[0]).toContain('There are no categories yet')
  expect(writes).toEqual(['/repo/.claude_todo/categories.json'])
  expect(JSON.parse(files['/repo/.claude_todo/categories.json']!)).toEqual({ categories: ['Lexing', 'Parsing', 'Writing'], items: { '#t1': 'Parsing', '#t2': 'Lexing', '#t3': 'Writing', '#t4': 'Writing' } })
  expect(await ui.find({ type: 'Text', text: /current categories are correct/ })).toBeUndefined()
})

test('Recategorize keeps the old names when the new sort is only a rename, and says so for 4 seconds', async ($, on) => {
  const { clock, files, writes, ui } = await recategorizeSetup($, on, () => ({ categories: ['Software', 'Writing'], assign: { 1: 'Software', 2: 'Software', 3: 'Writing', 4: 'Writing' } }))
  const before = files['/repo/.claude_todo/categories.json']
  await ui.press({ key: 'todo-recategorize' })
  expect(files['/repo/.claude_todo/categories.json']).toBe(before)
  expect(writes).toEqual([])
  expect(await ui.find({ type: 'Text', text: /The current categories are correct/ })).toBeDefined()
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /The current categories are correct/ })).toBeDefined()
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /The current categories are correct/ })).toBeUndefined()
  expect(await ui.find({ key: 'todo-recategorize' })).toBeDefined()
})

test('Recategorize says so when the model fails, changes nothing, and the note goes after 4 seconds', async ($, on) => {
  const { clock, files, writes, ui } = await recategorizeSetup($, on, () => undefined)
  const before = files['/repo/.claude_todo/categories.json']
  await ui.press({ key: 'todo-recategorize' })
  expect(await ui.find({ type: 'Text', text: /Could not recategorize/ })).toBeDefined()
  expect(files['/repo/.claude_todo/categories.json']).toBe(before)
  expect(writes).toEqual([])
  await clock.advance(4000)
  expect(await ui.find({ type: 'Text', text: /Could not recategorize/ })).toBeUndefined()
})

test('Recategorize is hidden when no ticket is open', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 done' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const ui = await open($)
  expect(await ui.find({ key: 'todo-recategorize' })).toBeUndefined()
})

// ---------------------------------------------------------------- Show completed link

test('Show completed is a button that opens the archive file, made empty when missing, and counts the archived tickets', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 open', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 other' }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  const ui = await open($)
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('')
  // The desktop app draws a Link as plain text unless it is https: so it is a Button, on both surfaces.
  const term = await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })
  const button = JSON.stringify(await term.drawn())
  expect(button).not.toContain('"type":"Link"')
  expect(button).toContain('"label":"Show completed (0)"')
  expect(await ui.find({ key: 'todo-show-completed' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"label":"Show completed (0)"')
  // The empty archive file is not an empty todo to delete, and the old toggle is gone.
  expect(await ui.find({ key: 'todo-delete-empty' })).toBeUndefined()
  expect(await ui.find({ key: 'todo-toggle' })).toBeUndefined()
  // macOS: `open <path>`, no shell.
  await ui.press({ key: 'todo-show-completed' })
  expect(calls).toContain('open /repo/.claude_todo/archive/TODO.md')
  await term.unmount()
  // With closed tickets in two archive files: N is their total.
  files['/repo/.claude_todo/archive/TODO.md'] = '- [x] #T2 a\n- [x] #T3 b'
  files['/repo/mods/x/.claude_todo/archive/TODO.md'] = '- [x] #T4 c\n- [ ] #T5 not closed'
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const again = JSON.stringify(await (await $.ui.mount({ plugin: 'claudeopticon', surface: 'terminal', ...PANE })).drawn())
  expect(again).toContain('"label":"Show completed (3)"')
})

test('Show completed opens with xdg-open on Linux, explorer.exe with backslashes on Windows, and toasts when it fails', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/home/a/repo/.claude_todo/TODO.md': '- [ ] #T1 open' }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], root: '/home/a/repo', uname: 'Linux', failing: ['xdg-open'] })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  const ui = await open($)
  await ui.press({ key: 'todo-show-completed' })
  expect(calls).toContain('xdg-open /home/a/repo/.claude_todo/archive/TODO.md')
  expect(calls.filter(call => call === 'uname -s').length).toBe(1)
  expect(toasts.join('\n')).toContain('Could not open /home/a/repo/.claude_todo/archive/TODO.md')
})

test('Show completed on Windows runs explorer.exe with a backslash path; its exit code 1 is not a failure', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { 'C:/repo/.claude_todo/TODO.md': '- [ ] #T1 open' }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], root: 'C:/repo', exits: { 'explorer.exe': 1 } })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  const ui = await open($)
  await ui.press({ key: 'todo-show-completed' })
  expect(calls).toContain('explorer.exe C:\\repo\\.claude_todo\\archive\\TODO.md')
  expect(toasts.join('\n')).not.toContain('Could not open')
})

test('the Show completed link is not made when the folder is not safe to write', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 open' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], links: { '/repo/.claude_todo/archive': '/home/a/elsewhere' } })
  files['/repo/.claude_todo/archive/OLD.md'] = ''
  const ui = await open($)
  expect(JSON.stringify(await ui.drawn())).not.toContain('"type":"Link"')
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBeUndefined()
})

// ---------------------------------------------------------------- ticket IDs and auto-numbering

test('ticket IDs: T plus a digit then digits and letters parse in any case, #TODO does not, and values are base 36', () => {
  const ids = parseTodo(['- [ ] #T12 old', '- [ ] #T002A new', '- [ ] #t002a lower', '- [ ] #TODO fix', '- [ ] #PROJ7 other prefix', '- [ ] #TA1 letter first', '- [ ] #T1x2y'].join('\n')).map(item => item.id)
  expect(ids).toEqual(['T12', 'T002A', 't002a', undefined, 'PROJ7', 'TA1', 'T1x2y'])
  expect(ticketValue('T25')).toBe(77)
  expect(ticketValue('T0026')).toBe(78)
  expect(ticketValue('t002a')).toBe(82)
  expect(ticketValue('PROJ7')).toBeUndefined()
  expect(ticketValue('TODO')).toBeUndefined()
  expect(applyRenames('#TODO and #T12 and #T002A', { t12: 'T0001', t002a: 'T0002' })).toBe('#TODO and #T0001 and #T0002')
})

test('the next free ticket IDs follow the highest value, old or new, and skip forms that start with a letter', () => {
  expect(nextTicketIds([], 2)).toEqual(['T0001', 'T0002'])
  // Old #T25 (77) then #T0026 (78).
  expect(nextTicketIds(['t25'], 3)).toEqual(['T0026', 'T0027', 'T0028'])
  expect(nextTicketIds(['t0029', 'T1'], 2)).toEqual(['T002A', 'T002B'])
  expect(nextTicketIds(['t002a', 'proj9'], 1)).toEqual(['T002B'])
  // 9ZZZ is the last 4-character form that starts with a digit: then 5 characters, still a digit first.
  expect(nextTicketIds(['t9zzz'], 2)).toEqual(['T10000', 'T10001'])
  expect(nextTicketIds(['t9zzy'], 2)).toEqual(['T9ZZZ', 'T10000'])
  expect(nextIdsLine(['t25'])).toBe('Next free ticket IDs: #T0026, #T0027, #T0028')
  expect(insertIds('# P\n- [ ] a\n  - [~] b\nc', [1, 2], ['T0001', 'T0002'])).toBe('# P\n- [ ] #T0001 a\n  - [~] #T0002 b\nc')
  expect(numberedNote([])).toBeUndefined()
})

test('a ticket with no ID gets the next free one after 5 seconds, at any indent, open, active or done; archives and ID-less prose stay', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': ['# Plan', '- [ ] Fix x', '  - [~] Sub', '    - [x] **Deep** done', '- [ ] #T25 Old', '- [ ] #TODO not an id', 'prose'].join('\n'),
    '/repo/.claude_todo/archive/OLD.md': '- [x] #T3C Old\n- [x] Archived without ID',
  }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push(e.context)

    return { text: e.text, context: e.context }
  })
  const before = files['/repo/.claude_todo/TODO.md']
  await open($)
  // Debounce: seen at the first scan; 3 s on is too early.
  await clock.advance(3000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe(before)
  await clock.advance(3000)
  // The next free value is one past the highest of every file, the archive's #T3C (120) included.
  expect(files['/repo/.claude_todo/TODO.md']).toBe(['# Plan', '- [ ] #T003D Fix x', '  - [~] #T003E Sub', '    - [x] #T003F **Deep** done', '- [ ] #T25 Old', '- [ ] #T003G #TODO not an id', 'prose'].join('\n'))
  expect(files['/repo/.claude_todo/archive/OLD.md']).toBe('- [x] #T3C Old\n- [x] Archived without ID')
  // Idempotent: no further write however long it waits.
  const done = writes.filter(path => path.endsWith('/TODO.md')).length
  await clock.advance(30000)
  expect(writes.filter(path => path.endsWith('/TODO.md')).length).toBe(done)
  expect(files['/repo/.claude_todo/TODO.md']).not.toContain('#T003H')
  // Claude hears of it once, and gets the next free IDs with each prompt.
  await $.prompt.submit({ text: 'go' } as never)
  await $.prompt.submit({ text: 'again' } as never)
  const first = contexts[0]?.join('\n') ?? ''
  expect(first).toContain('gave an ID to these todo tickets')
  expect(first).toContain('#T003D is "Fix x"')
  expect(first).toContain('Next free ticket IDs: #T003H, #T003I, #T003J')
  expect(contexts[1]?.join('\n')).not.toContain('gave an ID')
  // The IDs named to Claude are reserved: the next prompt names fresh ones.
  expect(contexts[1]?.join('\n')).toContain('Next free ticket IDs: #T003K, #T003L, #T003M')
})

test('an ID named to Claude is never given to a line, the next prompt names fresh ones, and the reservation is kept in the store', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a\n- [ ] new' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const contexts: string[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push((e.context ?? []).join('\n'))

    return { text: e.text, context: e.context }
  })
  await begin($)
  await $.prompt.submit({ text: 'go' } as never)
  expect(contexts[0]).toContain('Next free ticket IDs: #T0002, #T0003, #T0004')
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
  expect(readKeptIds(store.get('reserved:sess-1'))).toEqual(['t0002', 't0003', 't0004'])
  // A new line gets the next ID after the reserved ones.
  await clock.advance(9000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 a\n- [ ] #T0005 new')
  await $.prompt.submit({ text: 'again' } as never)
  expect(contexts[1]).toContain('Next free ticket IDs: #T0006, #T0007, #T0008')
  // An ID Claude used leaves the reservation.
  files['/repo/.claude_todo/TODO.md'] += '\n- [ ] #T0003 mine'
  // The fake folder keeps one mtime: a full resync (every 60 ticks) reads the edit.
  await clock.advance(60000)
  await $.prompt.submit({ text: 'third' } as never)
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
  expect(readKeptIds(store.get('reserved:sess-1'))).not.toContain('t0003')
  expect(readKeptIds(store.get('reserved:sess-1'))).toContain('t0002')
  expect(readKeptIds(['t1', 3, null])).toEqual(['t1'])
})

test('a line that only refers to another ticket gets an ID of its own; a line with its own leading ID, or a first ID nobody owns, does not', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': ['- [ ] #T5 The parser', '- [ ] Fix bug from #T5', '- [ ] #T6 Has own, after #T5', '- [ ] Note about #T9 unowned', '  - [ ] Follow up of #T5 and #T6'].join('\n'),
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(9000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe(['- [ ] #T5 The parser', '- [ ] #T000A Fix bug from #T5', '- [ ] #T6 Has own, after #T5', '- [ ] Note about #T9 unowned', '  - [ ] #T000B Follow up of #T5 and #T6'].join('\n'))
})

test('Consolidate is not interrupted by numbering: the scan inside it numbers nothing', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 a\n- [ ] fresh',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 b',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  const ui = await open($)
  // Past the 5 s debounce, between two scans.
  await clock.advance(5500)
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toContain('- [ ] fresh\n')
  await clock.advance(3000)
  expect(files['/repo/.claude_todo/TODO.md']).toContain('- [ ] #T0003 fresh')
})

test('numbering shares one number line across folders: each new ID is unique project-wide', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 a\n- [ ] new one',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T5 b\n- [ ] other new',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(6000)
  const added = [files['/repo/.claude_todo/TODO.md']!.split('\n')[1]!, files['/repo/mods/x/.claude_todo/TODO.md']!.split('\n')[1]!]
  expect(added.map(line => line.slice(0, 12)).sort()).toEqual(['- [ ] #T0006', '- [ ] #T0007'])
  expect(files['/repo/.claude_todo/TODO.md']!.startsWith('- [ ] #T1 a\n')).toBe(true)
})

test('a line that gets its ID from Claude inside the 5 seconds is not numbered by the mod', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] Fix x' }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(3000)
  files['/repo/.claude_todo/TODO.md'] = '- [ ] #T0030 Fix x'
  await clock.advance(9000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T0030 Fix x')
  expect(writes).toEqual([])
})

test('a file that changed between the read and the write is not numbered; the next scan tries again', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {}
  let current = '- [ ] Fix x'
  let reads = 0
  let isArmed = false
  Object.defineProperty(files, '/repo/.claude_todo/TODO.md', {
    enumerable: true,
    configurable: true,
    // While armed, the second read of a scan finds a new line: the file changed meanwhile.
    get: () => {
      if (!isArmed) {
        return current
      }
      reads += 1

      return reads === 2 ? `${current}\n- [ ] added meanwhile` : current
    },
    set: value => {
      current = value as string
    },
  })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(3000)
  isArmed = true
  await clock.advance(3000)
  expect(current).toBe('- [ ] Fix x')
  expect(writes).toEqual([])
  await clock.advance(3000)
  expect(current).toBe('- [ ] #T0001 Fix x')
  expect(writes).toEqual(['/repo/.claude_todo/TODO.md'])
})

test('numbering and the archive move do not write one file with stale text: a done unnumbered ticket is numbered, then archived', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] Done thing\n- [ ] Open thing' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(6000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [x] #T0001 Done thing\n- [ ] #T0002 Open thing')
  await clock.advance(9000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T0002 Open thing')
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('- [x] #T0001 Done thing\n')
})

test('a prompt during numbering never names an ID numbering gives, and numbering never gives one a prompt named', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-1' }) as never)
  let release = () => {}
  const hold = new Promise<void>(resolve => {
    release = resolve
  })
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a\n- [ ] new' }
  const log: string[] = []
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], hold, log })
  const contexts: string[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push((e.context ?? []).join('\n'))

    return { text: e.text, context: e.context }
  })
  await begin($)
  await clock.advance(3000)
  const numbering = clock.advance(3000)
  for (let i = 0; i < 200 && !log.includes('write:/repo/.claude_todo/TODO.md'); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(log).toContain('write:/repo/.claude_todo/TODO.md')
  // Numbering is in flight, its write held: the prompt names IDs after the one numbering gives.
  await $.prompt.submit({ text: 'go' } as never)
  expect(contexts[0]).toContain('Next free ticket IDs: #T0003, #T0004, #T0005')
  release()
  await numbering
  await clock.advance(1000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 a\n- [ ] #T0002 new')
})

test('archiveDone and numberTickets never write in one overlap: a scan that finds the lock held skips', async ($, on) => {
  const clock = mock.clock(on)
  let release = () => {}
  const hold = new Promise<void>(resolve => {
    release = resolve
  })
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 Done\n- [ ] new' }
  const log: string[] = []
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], hold, log })
  await open($)
  await clock.advance(3000)
  const first = clock.advance(3000)
  for (let i = 0; i < 200 && !log.includes('write:/repo/.claude_todo/TODO.md'); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  // Numbering holds the lock in its write; later scans run meanwhile.
  const second = clock.advance(3000)
  for (let i = 0; i < 40; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(log.filter(entry => entry.startsWith('write:') && entry !== 'write:/repo/.claude_todo/archive/TODO.md')).toEqual(['write:/repo/.claude_todo/TODO.md'])
  expect(log.filter(entry => entry === 'write:/repo/.claude_todo/archive/TODO.md').length).toBeLessThanOrEqual(1)
  release()
  await first
  await second
  await clock.advance(9000)
  // Both land, one after the other.
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T0002 new')
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('- [x] #T1 Done\n')
})

test('a Mark done pressed during numbering waits, then keeps both changes', async ($, on) => {
  const clock = mock.clock(on)
  let release = () => {}
  const hold = new Promise<void>(resolve => {
    release = resolve
  })
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [~] #T1 a\n- [ ] new' }
  const log: string[] = []
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], hold, log })
  const ui = await open($)
  await clock.advance(3000)
  const numbering = clock.advance(3000)
  for (let i = 0; i < 200 && !log.includes('write:/repo/.claude_todo/TODO.md'); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(log).toContain('write:/repo/.claude_todo/TODO.md')
  void ui.press({ key: 'ticket-done-TODO.md-#t1' })
  // The press reaches the mod while the numbering write is still held.
  for (let i = 0; i < 20; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  release()
  await numbering
  for (let i = 0; i < 40; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [x] #T1 a\n- [ ] #T0002 new')
})

test('an archive that ends inside an open code fence gets nothing: the move is skipped, with one toast', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [x] #T1 Done\n- [ ] #T2 Open', '/repo/.claude_todo/archive/TODO.md': '- [x] #T0 Old\n```\nsample' }
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  await open($)
  await clock.advance(12000)
  await clock.advance(12000)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [x] #T1 Done\n- [ ] #T2 Open')
  expect(files['/repo/.claude_todo/archive/TODO.md']).toBe('- [x] #T0 Old\n```\nsample')
  expect(writes).toEqual([])
  expect(toasts.filter(one => one.includes('Not archived: /repo/.claude_todo/archive/TODO.md has an unclosed code block')).length).toBe(1)
})

for (const [name, links] of [
  ['a source file that is a symlink', { '/repo/.claude_todo/TODO.md': '/home/a/other/TODO.md' }],
  ['a todo folder that is a symlink', { '/repo/.claude_todo': '/home/a/elsewhere' }],
] as [string, Record<string, string>][]) {
  test(`numbering: ${name} is never written`, async ($, on) => {
    const clock = mock.clock(on)
    const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] Fix x' }
    const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], links })
    await open($)
    await clock.advance(12000)
    expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] Fix x')
    expect(writes).toEqual([])
  })
}

test('numbering never writes the global folder', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/home/a/.claude/.claude_todo/TODO.md': '- [ ] Fix x' }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], root: '/home/a/.claude' })
  await open($)
  await clock.advance(12000)
  expect(files['/home/a/.claude/.claude_todo/TODO.md']).toBe('- [ ] Fix x')
  expect(writes).toEqual([])
})

test('with the rules option off, the prompt carries no next-IDs line', { options: { rules: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 a' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push(e.context)

    return { text: e.text, context: e.context }
  })
  await open($)
  await clock.advance(1000)
  await $.prompt.submit({ text: 'go' } as never)
  expect(contexts[0]?.join('\n') ?? '').not.toContain('Next free ticket IDs')
})

test('agent labels fit their circle at any length, and count from the kept base after a reload', () => {
  // Instrument Sans at weight 500: A is 0.461 em, a digit 0.664 em; the circle leaves at most 17 px.
  for (const label of ['A1', 'A10', 'A100', 'A1000', 'A10000']) {
    const width = (0.461 + 0.664 * (label.length - 1)) * labelFontSize(label)
    expect(width).toBeLessThanOrEqual(17)
  }
  expect(labelFontSize('A1')).toBe(11)
  expect(labelFontSize('A23')).toBe(9.5)
  setLabelBase(200)
  expect(labelOf(0)).toBe('A201')
  expect(labelNote('how is A201 doing? and A1?', [{ id: 'x', description: 'Kept', type: 'general-purpose', status: 'running', startedAt: 1, toolCalls: 0, brief: '' } as AgentRow], 200)).toContain('- A201: "Kept"')
  setLabelBase(0)
  expect(labelOf(0)).toBe('A1')
})

// ---------------------------------------------------------------- close the work that is done

/** A pane over one todo file the test can edit and one helper whose status it sets; the prompts' contexts are kept. */
function endSetup($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], file: string) {
  const state = { file, mtime: 1, status: 'running' }
  const clock = mock.clock(on)
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.claude_todo') }))
  on('fs.list', () => ({ value: [{ name: 'OPEN.md', kind: 'file', size: 1, mtimeMs: state.mtime, isLink: false }] }))
  on('fs.read', () => ({ value: state.file }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Parser #T0026', type: 'general-purpose', status: state.status }] }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} }) as never)
  const contexts: string[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push((e.context ?? []).join('\n'))

    return { text: e.text, context: e.context }
  })
  const edit = (next: string) => {
    state.file = next
    state.mtime += 1

    return $.tool.call({ tool: 'Edit', file_path: '/repo/.claude_todo/OPEN.md' } as never)
  }

  return { state, clock, edit, contexts }
}

test('the rules tell Claude to close finished work in the same turn', () => {
  expect(RULES).toContain('check it off (`- [x]`) in the same turn, before your final reply')
  expect(RULES).toContain('Never leave finished work open or in progress')
  expect(RULES).toContain('When an agent you started for an item finishes, check its result and close the item if the work is done')
})

test('an agent that ends with a ticket still open queues one note for Claude', async ($, on) => {
  const { state, contexts } = endSetup($, on, '- [~] #T0026 Ship the parser\n- [x] #T0027 Done already')
  await begin($)
  await $.agent.spawn({ prompt: 'Work on #T0026', description: 'Parser #T0026', subagentType: 'general-purpose' } as never)
  state.status = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as never).catch(() => undefined)
  await $.prompt.submit({ text: 'go' } as never)
  await $.prompt.submit({ text: 'again' } as never)
  const first = contexts[0] ?? ''
  expect(first).toContain('A1 finished. Its tickets are still open or in progress: #T0026 Ship the parser. Close each one whose work is done.')
  expect(first).not.toContain('#T0027')
  expect(contexts[1] ?? '').not.toContain('finished')
})

test('an agent that ends with its tickets done queues no note', async ($, on) => {
  const { state, contexts } = endSetup($, on, '- [x] #T0026 Ship the parser')
  await begin($)
  await $.agent.spawn({ prompt: 'Work on #T0026', description: 'Parser #T0026', subagentType: 'general-purpose' } as never)
  state.status = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as never).catch(() => undefined)
  await $.prompt.submit({ text: 'go' } as never)
  expect(contexts[0] ?? '').not.toContain('Its tickets are still open')
})

test('the next prompt names the in-progress tickets the orchestrator claimed, and not again within 30 minutes', async ($, on) => {
  const { clock, edit, contexts } = endSetup($, on, ORCH_FILE)
  await begin($)
  await edit('- [~] #T0026 Ship the parser\n- [ ] #T2 Review the copy\n- [~] #T3 Check the invoice')
  await $.prompt.submit({ text: 'one' } as never)
  expect(contexts[0] ?? '').toContain('Still in progress from earlier: #T0026 Ship the parser. Close any whose work is done.')
  expect(contexts[0] ?? '').not.toContain('#T3')
  await $.prompt.submit({ text: 'two' } as never)
  expect(contexts[1] ?? '').not.toContain('Still in progress')
  await clock.advance(29 * 60 * 1000)
  await $.prompt.submit({ text: 'three' } as never)
  expect(contexts[2] ?? '').not.toContain('Still in progress')
  await clock.advance(2 * 60 * 1000)
  await $.prompt.submit({ text: 'four' } as never)
  expect(contexts[3] ?? '').toContain('Still in progress from earlier: #T0026 Ship the parser')
})
