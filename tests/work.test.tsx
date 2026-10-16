import { expect, mock, test } from 'claude-code/testing'

import { boardHead, clock, orchestratorSvg, AGENT_COLORS, tokens, agentShare, agentSvg, fileCards, heroSvg, setWidth, ticketSvg, timelineSvg, wrap } from '../hooks/cards'
import { endAgentTasks, itemLines, lineSignature, renumberLines, appendSections, applyRenames, nonBlankLines, hasSection, renameNote, taskLines, launchedTask, endedTask, readTaskName, taskNamePrompt, RULES, callSummary, orchestratorView, pageLabel, findTicket, moveQuestion, setBox, movesNote, statusPrompt, sendScope, PROGRESS_NOTE, turnTokens, filterNames, withoutHidden, matchPrompt, readMatchReply, ticketColumns, ticketPrompt, ticketSummary, applySortReply, claimScore, findTodoDirWith, isGlobalTodo, todoFoldersIn, repoRoots, pickFolders, findTickets, narrowTickets, MAX_FOLDERS, plainText, progressReply, readClaims, buildView, categoryGroups, describeCall, itemKey, labelNote, ledger, linkAgents, parseTodo, readProgress, searchTodo, sortPrompt, todoLedger } from '../hooks/register'
import type { AgentRow, TodoFile } from '../types'
import type { FileView } from '../hooks/cards'
import type { BackgroundTask } from '../hooks/register'

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
  on('fs.exists', () => ({ value: true }))
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

test('each file shows 12 items, and its button shows them all, then 12 again', async ($, on) => {
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
  await ui.press({ key: 'todo-toggle' })
  expect(await items()).toBe(30)
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

test('the completed ledger keeps checked items, complete files and the archive, behind one button', async () => {
  const list: TodoFile[] = [
    { name: 'OPEN.md', folder: '.claude_todo', mtimeMs: 3, items: parseTodo('- [ ] next\n- [x] shipped') },
    { name: 'DONE.md', folder: '.claude_todo', mtimeMs: 2, items: parseTodo('- [x] a\n- [x] b') },
    { name: 'archive/OLD.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] c\n- [x] d\n- [x] e'), isArchived: true },
  ]
  const view = buildView(list, [], 0)
  expect([view.done, view.total, view.completed]).toEqual([3, 4, 6])
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
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).not.toContain('old one')
  await ui.press({ key: 'todo-toggle' })
  const drawn = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(drawn).toContain('old one')
  expect(drawn).toContain('archive/OLD.md')
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
  expect(await shown()).not.toContain('beta task done')
  await ui.input({ key: 'todo-search', text: 'beta', kind: 'change' })
  expect(await shown()).toContain('beta task done')
  expect(await shown()).not.toContain('gamma task')
  expect(await ui.find({ type: 'Text', text: /1 matching items/ })).toBeDefined()
  await ui.press({ key: 'search-clear' })
  expect(await shown()).toContain('gamma task')
  expect(await shown()).not.toContain('beta task done')
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
  await ui.press({ key: 'todo-toggle' })
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
  expect(RULES).toContain('#T<n>')
  expect(RULES).toContain('mcp__claudeopticon__move_ticket')
})

test('with the rules option off, the mod adds no context block', { options: { rules: false } }, async ($, on) => {
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }) as never)
  const context = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'mine' }] } as never)
  expect(context.blocks.map(block => block.name)).toEqual(['claudeMd'])
})

test('a background launch is read from its tool call; other calls launch nothing', async () => {
  expect(launchedTask('Bash', { command: 'npm run build', description: 'Build the app', run_in_background: true }, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' })).toEqual({ id: 'b1', kind: 'shell', stock: 'Build the app' })
  expect(launchedTask('Bash', { command: 'ls' }, { stdout: '', stderr: '', interrupted: false })).toBeUndefined()
  expect(launchedTask('Monitor', { description: 'Watch the deploy log', timeout_ms: 1000 }, { taskId: 'm1', timeoutMs: 1000 })?.kind).toBe('monitor')
  expect(launchedTask('Workflow', {}, { status: 'async_launched', taskId: 'w1', workflowName: 'review', summary: 'Review the diff' })?.stock).toBe('review: Review the diff')
  expect(launchedTask('Read', { file_path: '/x' }, { taskId: 'no' })).toBeUndefined()
  expect(endedTask('<task-notification><task-id>b1</task-id><status>completed</status></task-notification>')).toEqual({ id: 'b1', status: 'completed' })
  expect(endedTask('<task-id>m1</task-id><status>killed</status>')?.status).toBe('killed')
  expect(endedTask('<task-id>m1</task-id><event>line</event>')).toBeUndefined()
  expect(readTaskName('"Build the app."\nmore')).toBe('Build the app')
  expect(readTaskName('   ')).toBeUndefined()
  expect(taskNamePrompt('npm run build')).toContain('2 to 5 plain words')
})

test('a background task gets a line in the tasks card, named once by Haiku, and a stop ends it', async ($, on) => {
  mock.clock(on)
  const prompts: string[] = []
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)

    return { value: { isAnswered: true, text: 'Build the web app', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b7' } }) as never)
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'stopped', task_id: 'b7', task_type: 'local_bash' } }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const svgs = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(await ui.find({ type: 'Text', text: /^None in this session yet$/ })).toBeDefined()
  await $.tool.call({ tool: 'Bash', command: 'npm run build -- --watch', description: 'Run the web build in watch mode', run_in_background: true } as never)
  for (let i = 0; i < 200 && !(await svgs()).includes('Build the web app'); i += 1) {
    await Promise.resolve()
  }
  expect(await svgs()).toContain('>Build the web app<')
  expect(await svgs()).toContain('class=\\"pulse\\"')
  expect(await ui.find({ type: 'Text', text: /^1 running, 0 finished$/ })).toBeDefined()
  await $.tool.call({ tool: 'Bash', command: 'npm run build -- --watch', description: 'Something else', run_in_background: true } as never)
  expect(prompts.filter(prompt => prompt.includes('background task')).length).toBe(1)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b7' } as never)
  expect(await svgs()).not.toContain('>Build the web app<')
  await ui.press({ key: 'tasks-toggle' })
  expect(await svgs()).toContain('>Build the web app (stopped)<')
})

test('task lines read like the Orchestrator card: the name, and how a task ended when it did not finish cleanly', async () => {
  const base = { kind: 'shell' as const, stock: 's', startedAt: 5 }
  expect(taskLines([
    { ...base, id: 'a', name: 'Build', status: 'running' },
    { ...base, id: 'b', name: 'Lint', status: 'completed', endedAt: 9 },
    { ...base, id: 'c', name: 'Deploy', status: 'failed', endedAt: 9 },
    { ...base, id: 'd', name: 'Watch', status: 'killed', endedAt: 9 },
  ])).toEqual([
    { line: 'Build', at: 5, isRunning: true },
    { line: 'Lint', at: 5, isRunning: false },
    { line: 'Deploy (failed)', at: 5, isRunning: false },
    { line: 'Watch (stopped)', at: 5, isRunning: false },
  ])
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

test("a background task a helper agent started ends when that agent ends; the main conversation's own stays", () => {
  const task = (id: string, agentId?: string): BackgroundTask => ({ id, stock: id, name: id, kind: 'shell', status: 'running', startedAt: 0, ...(agentId === undefined ? {} : { agentId }) })
  const tasks = [task('t1', 'a1'), task('t2', 'a2'), task('t3'), task('t4', 'gone')]
  const ended = endAgentTasks(tasks, [row({ id: 'a1', status: 'killed' }), row({ id: 'a2', status: 'running' })], 20_000)
  expect(ended.map(one => one.status)).toEqual(['ended', 'running', 'running', 'ended'])
  expect(endAgentTasks(tasks, [], 5_000).map(one => one.status)).toEqual(['running', 'running', 'running', 'running'])
  expect(taskLines(ended)[0]?.line).toBe('t1')
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

/**
 * A fake repo (at `/repo` unless `root` says) with the given files by absolute path; `hasNearest` says
 * whether the session folder has its own `.claude_todo`; `rev` is what `git rev-parse` answers;
 * `links` maps a path to the real path the fake stat gives it (a symlink).
 */
function repoWith(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, opts: { hasNearest: boolean; listed: string[]; root?: string; rev?: string; links?: Record<string, string> }) {
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

    if (argv[0] === 'rm') {
      delete files[argv[2]!]

      return out('')
    }
    if (argv[0] === 'rmdir') {
      const isEmpty = !Object.keys(files).some(path => path.startsWith(`${argv[2]}/`))

      return (isEmpty ? out('') : { value: { exitCode: 1, stdout: '', stderr: 'not empty' } }) as never
    }

    return argv[1] === 'rev-parse' ? out(opts.rev ?? `${R}\n${R}/.git\n`) : out(argv.includes('--directory') ? '' : state.listed.join('\0'))
  })
  // The engine may hand the session folder's own paths over made absolute: match by their ends.
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.git') || (e.path.endsWith('.claude_todo') && !inside(e.path) && state.hasNearest) || (inside(e.path) && (e.path in files || Object.keys(files).some(path => path.startsWith(`${e.path}/`)))) }))
  on('fs.stat', (_$, e) => ({ value: { kind: e.path in files ? 'file' : 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: opts.links?.[e.path] ?? (inside(e.path) ? e.path : `${R}/.claude_todo`) } }) as never)
  on('fs.list', (_$, e) => ({ value: (inside(e.path) ? names(e.path) : state.hasNearest ? names(`${R}/.claude_todo`) : []).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 2, isLink: false })) }))
  on('fs.read', (_$, e) => ({ value: files[inside(e.path) ? e.path : `${R}/.claude_todo/${e.path.split('/').pop()}`] ?? '' }))
  on('fs.write', (_$, e) => {
    const path = inside(e.path) ? e.path : `${R}/.claude_todo/${e.path.split('/').pop()}`
    files[path] = e.text as string
    writes.push(path)

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
  // Four tickets in the columns (Open 2, In progress 2); the Done ticket is not shown.
  for (const one of ['Alpha open', 'Alpha active', 'Beta open', 'Beta active']) {
    expect(drawn).toContain(one)
  }
  expect(drawn).not.toContain('Alpha done')
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

test('consolidation helpers: renumber colliding IDs, append under a heading, compare lines without IDs', async () => {
  const used = new Set(['t1', 't2'])
  const out = renumberLines(['- [ ] #T1 Docs', '- [x] #T7 Kept', '- [~] No id', '- note, see #T1 and #T7'], used)
  // The new number skips the source's own #T7 as well as the used IDs.
  expect(out.lines).toEqual(['- [ ] #T8 Docs', '- [x] #T7 Kept', '- [~] No id', '- note, see #T8 and #T7'])
  expect(out.renames).toEqual({ t1: 'T8' })
  expect(out.pairs).toEqual([{ from: 'T1', to: 'T8' }])
  expect(applyRenames('#T1 and #T10 and #T3', { t1: 'T3', t3: 'T4' })).toBe('#T3 and #T10 and #T4')
  expect(appendSections('', [{ place: 'mods/x', lines: ['- [ ] a'] }])).toBe('## From mods/x\n\n- [ ] a\n')
  expect(appendSections('- [ ] top\n', [{ place: 'a', lines: ['- [ ] b'] }, { place: 'c', lines: ['- [x] d'] }])).toBe('- [ ] top\n\n## From a\n\n- [ ] b\n\n## From c\n\n- [x] d\n')
  expect(itemLines('# T\nprose\n- [ ] one\n  - [x] two')).toEqual(['- [ ] one', '  - [x] two'])
  expect(lineSignature('- [ ] #T3 Docs')).toBe(lineSignature('- [ ] #T1 Docs'))
  // Only the item's own leading ID goes: another ID in the text counts.
  expect(lineSignature('- [ ] #T1 Fix #X12')).not.toBe(lineSignature('- [ ] #T1 Fix #X13'))
  expect(nonBlankLines('# A\n\n  note  \n   \n- [ ] x')).toEqual(['# A', '  note', '- [ ] x'])
  expect(hasSection('a\n## From mods/x\n- [ ] b', 'mods/x')).toBe(true)
  expect(hasSection('a\n## From mods/xy', 'mods/x')).toBe(false)
  expect(renameNote([])).toBeUndefined()
  expect(lineSignature('- [x] #T3 Docs')).not.toBe(lineSignature('- [ ] #T3 Docs'))
})

const SPREAD = () => ({
  '/repo/.claude_todo/TODO.md': '# Plan\n- [ ] #T1 Fix the parser\n- [x] #T2 Ship it',
  '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Write the docs\n- [~] No id here',
  '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Old thing',
})
const SPREAD_LIST = ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/.claude_todo/archive/OLD.md']

test('the Todo heading says how many files it pulls from, and Consolidate shows only with more than one folder', async ($, on) => {
  mock.clock(on)
  repoWith(on, SPREAD(), { hasNearest: true, listed: SPREAD_LIST })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'claudeopticon', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /1 of 4 done, 1 in progress\. Pulling todo from 2 files$/ })).toBeDefined()
    expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
    expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeUndefined()
    await ui.unmount()
  }
})

test('one folder: the heading counts its files and Consolidate shows for two files', async ($, on) => {
  mock.clock(on)
  repoWith(on, { '/repo/.claude_todo/A.md': '- [ ] one', '/repo/.claude_todo/B.md': '- [ ] two' }, { hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md'] })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Pulling todo from 2 files/ })).toBeDefined()
  expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
})

test('Consolidate todos merges the folders into the central one, renumbers colliding IDs, leaves the sources alone and hides them', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = SPREAD()
  const before = { ...files }
  const { writes, calls } = repoWith(on, files, { hasNearest: true, listed: SPREAD_LIST })
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'ticket-start-TODO.md-mods/x/.claude_todo::#t1' })).toBeDefined()
  const gitBefore = calls.length
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('# Plan\n- [ ] #T1 Fix the parser\n- [x] #T2 Ship it\n\n## From mods/x/TODO.md\n\n- [ ] #T3 Write the docs\n- [~] No id here\n')
  expect(files['/repo/.claude_todo/archive/OLD.md']).toBe('## From mods/x/archive/OLD.md\n\n- [x] #T9 Old thing\n')
  // Each target is written once, and no source is touched.
  expect(writes.sort()).toEqual(['/repo/.claude_todo/TODO.md', '/repo/.claude_todo/archive/OLD.md'])
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBe(before['/repo/mods/x/.claude_todo/TODO.md'])
  expect(files['/repo/mods/x/.claude_todo/archive/OLD.md']).toBe(before['/repo/mods/x/.claude_todo/archive/OLD.md'])
  // One discovery as part of the press.
  expect(calls.length - gitBefore).toBe(3)
  expect(store.get('duplicates:/repo')).toEqual(['/repo/mods/x/.claude_todo'])
  // The sources are off the board: their tickets (and their folder-qualified keys) are gone.
  expect(await ui.find({ key: 'ticket-start-TODO.md-mods/x/.claude_todo::#t1' })).toBeUndefined()
  expect(await ui.find({ key: 'ticket-start-TODO.md-#t3' })).toBeDefined()
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Pulling todo from 1 file$/ })).toBeDefined()
})

test('Delete duplicate todos removes only verified files, one rm each, keeps a failing file, and the button stays while a file is kept', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser\n\n## From mods/x\n\n- [ ] #T3 Write the docs\n- [ ] Only in the duplicate\n',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Write the docs',
    '/repo/mods/x/.claude_todo/EXTRA.md': '- [ ] Only in the duplicate',
    '/repo/mods/x/.claude_todo/categories.json': '{}',
  }
  // EXTRA.md is fully copied, but it is a symlink: it is kept, so the folder stays a duplicate.
  const { writes, calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/x/.claude_todo/EXTRA.md'], links: { '/repo/mods/x/.claude_todo/EXTRA.md': '/repo/other.md' } })
  const store = new Map<string, unknown>([['duplicates:/repo', ['/repo/mods/x/.claude_todo']], ['duplicates-meta:/repo', { renames: { '/repo/mods/x/.claude_todo/TODO.md': { t1: 'T3' } } }]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-delete-duplicates' })
  const removing = calls.filter(call => call.startsWith('rm') )
  expect(removing).toEqual(['rm -- /repo/mods/x/.claude_todo/TODO.md', 'rmdir -- /repo/mods/x/.claude_todo/archive', 'rmdir -- /repo/mods/x/.claude_todo'])
  expect(files['/repo/mods/x/.claude_todo/TODO.md']).toBeUndefined()
  expect(files['/repo/mods/x/.claude_todo/EXTRA.md']).toBeDefined()
  // The book stays with a kept file, and nothing in the central folder is touched.
  expect(files['/repo/mods/x/.claude_todo/categories.json']).toBeDefined()
  expect(removing.some(call => call.includes('/repo/.claude_todo'))).toBe(false)
  expect(toasts.join('\n')).toContain('Kept: /repo/mods/x/.claude_todo/EXTRA.md')
  expect(writes).toEqual([])
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeDefined()
  expect(store.get('duplicates:/repo')).toEqual(['/repo/mods/x/.claude_todo'])
})

test('Delete duplicate todos removes the files, the book and the folders when all pass, then the button hides', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix\n- [ ] #T3 Docs',
    '/repo/.claude_todo/archive/OLD.md': '- [x] #T9 Old',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Docs',
    '/repo/mods/x/.claude_todo/archive/OLD.md': '- [x] #T9 Old',
    '/repo/mods/x/.claude_todo/categories.json': '{}',
  }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  const store = new Map<string, unknown>([['duplicates:/repo', ['/repo/mods/x/.claude_todo']], ['duplicates-meta:/repo', { renames: { '/repo/mods/x/.claude_todo/TODO.md': { t1: 'T3' } } }]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-delete-duplicates' })
  const removing = calls.filter(call => call.startsWith('rm'))
  expect(removing).toEqual([
    'rm -- /repo/mods/x/.claude_todo/TODO.md',
    'rm -- /repo/mods/x/.claude_todo/archive/OLD.md',
    'rm -- /repo/mods/x/.claude_todo/categories.json',
    'rmdir -- /repo/mods/x/.claude_todo/archive',
    'rmdir -- /repo/mods/x/.claude_todo',
  ])
  expect(removing.every(call => call.includes(' /repo/mods/x/.claude_todo'))).toBe(true)
  // The book was merged into the central one before it went.
  expect(Object.keys(files).sort()).toEqual(['/repo/.claude_todo/TODO.md', '/repo/.claude_todo/archive/OLD.md', '/repo/.claude_todo/categories.json'])
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeUndefined()
  // The deleted folders leave the folder list too, so Consolidate does not come back.
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  expect(store.get('duplicates:/repo')).toEqual([])
})

test('Delete duplicate todos never removes inside the central or a global folder', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] one' }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  // A corrupt record names the central folder and a global one.
  const store = new Map<string, unknown>([['duplicates:/repo', ['/repo/.claude_todo', '/home/a/.claude/.claude_todo']]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-delete-duplicates' }).catch(() => undefined)
  expect(calls.filter(call => call.startsWith('rm'))).toEqual([])
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] one')
})

test('the duplicate folders are remembered: the Delete button and the hidden folder come back in a new session, until none exists', async ($, on) => {
  mock.clock(on)
  // The central folder holds every line of the recorded duplicate, so it still counts as one.
  const files: Record<string, string> = SPREAD()
  files['/repo/.claude_todo/TODO.md'] = `${files['/repo/.claude_todo/TODO.md']}\n- [ ] #T1 Write the docs\n- [~] No id here`
  files['/repo/.claude_todo/archive/OLD.md'] = '- [x] #T9 Old thing'
  repoWith(on, files, { hasNearest: true, listed: SPREAD_LIST })
  const store = new Map<string, unknown>([['duplicates:/repo', ['/repo/mods/x/.claude_todo', '/repo/gone/.claude_todo']]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeDefined()
  expect(await ui.find({ key: 'ticket-start-TODO.md-mods/x/.claude_todo::#t1' })).toBeUndefined()
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  // The folder that is gone from the disk leaves the record.
  expect(store.get('duplicates:/repo')).toEqual(['/repo/mods/x/.claude_todo'])
})

test('with no recorded duplicate on disk the record is cleared and the Delete button is hidden', async ($, on) => {
  mock.clock(on)
  repoWith(on, SPREAD(), { hasNearest: true, listed: SPREAD_LIST })
  const store = new Map<string, unknown>([['duplicates:/repo', ['/repo/gone/.claude_todo']]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeUndefined()
  expect(store.get('duplicates:/repo')).toEqual([])
  expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
})

// ---------------------------------------------------------------- consolidate and delete: safety

/** A store in memory for the mod, with the given entries. */
function storeWith(on: Parameters<Parameters<typeof test>[1]>[1], entries: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(entries))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })

  return store
}

const rmCalls = (calls: string[]) => calls.filter(call => call.startsWith('rm'))

test('safety 1: with the main folder being the global one, Consolidate and Delete are off', async ($, on) => {
  mock.clock(on)
  const files = {
    '/home/a/.claude/mods/x/.claude_todo/TODO.md': '- [ ] one',
    '/home/a/.claude/mods/y/.claude_todo/TODO.md': '- [ ] two',
  }
  const { writes, calls } = repoWith(on, files, { root: '/home/a/.claude', hasNearest: false, listed: ['mods/x/.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md'] })
  storeWith(on, { 'duplicates:/home/a/.claude': ['/home/a/.claude/mods/x/.claude_todo'] })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeUndefined()
  expect(writes).toEqual([])
  expect(rmCalls(calls)).toEqual([])
})

test('safety 4: in a linked worktree Consolidate and Delete are off', async ($, on) => {
  mock.clock(on)
  const files = { '/repo/.claude_todo/TODO.md': '- [ ] one', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] two' }
  const { writes, calls } = repoWith(on, files, { hasNearest: true, rev: '/repo\n/elsewhere/.git\n', listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  storeWith(on, { 'duplicates:/elsewhere': ['/repo/mods/x/.claude_todo'] })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeUndefined()
  expect(writes).toEqual([])
  expect(rmCalls(calls)).toEqual([])
})

test('safety 2: Consolidate copies every non-blank line, and Delete keeps a file with a line the central one lacks, an empty file, and covers each central line once', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/mods/x/.claude_todo/TODO.md': '# Notes\n\n- [ ] #T1 Docs\n  indented note\nprose line\n',
    '/repo/mods/x/.claude_todo/EMPTY.md': '\n\n',
    '/repo/mods/y/.claude_todo/TODO.md': '- [ ] #T5 Same line\n- [ ] #T6 Other',
    '/repo/mods/y/.claude_todo/ONE.md': '- [ ] Same twice',
    '/repo/mods/z/.claude_todo/ONE.md': '- [ ] Same twice',
  }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: Object.keys(files).map(path => path.slice('/repo/'.length)) })
  storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toContain('## From mods/x/TODO.md\n\n# Notes\n- [ ] #T2 Docs\n  indented note\nprose line\n')
  expect(files['/repo/.claude_todo/EMPTY.md']).toBeUndefined()
  // Delete: the target holds the line once now, so only one of the two copies may go.
  files['/repo/.claude_todo/TODO.md'] = files['/repo/.claude_todo/TODO.md']!.replace('- [ ] Same twice\n\n## From mods/z/ONE.md\n\n- [ ] Same twice\n', '- [ ] Same twice\n')
  files['/repo/mods/y/.claude_todo/TODO.md'] = `${files['/repo/mods/y/.claude_todo/TODO.md']}\n- [ ] added later`
  files['/repo/.claude_todo/TODO.md'] = `${files['/repo/.claude_todo/TODO.md']}\n- [ ] #T5 Same line\n`
  await ui.press({ key: 'todo-delete-duplicates' })
  const removed = rmCalls(calls).filter(call => call.startsWith('rm --'))
  expect(removed).toContain('rm -- /repo/mods/x/.claude_todo/TODO.md')
  expect(removed).not.toContain('rm -- /repo/mods/x/.claude_todo/EMPTY.md')
  // mods/y/TODO.md has a line (#T6) the central lacks.
  expect(removed).not.toContain('rm -- /repo/mods/y/.claude_todo/TODO.md')
  expect(removed.filter(call => call.endsWith('/ONE.md')).length).toBe(1)
  expect(files['/repo/mods/y/.claude_todo/TODO.md']).toBeDefined()
})

test('safety 3: nothing is removed from an untrusted folder or file', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] one\n- [ ] two\n- [ ] three',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] one',
    '/repo/mods/link/.claude_todo/TODO.md': '- [ ] two',
    '/repo/mods/f/.claude_todo/TODO.md': '- [ ] three',
    '/repo/mods/f/.claude_todo/archive/OLD.md': '- [ ] one',
    '/repo/.claude_todo/archive/OLD.md': '- [ ] one',
    '/repo/other/NOTCLAUDE.md': '- [ ] one',
    '/outside/.claude_todo/TODO.md': '- [ ] one',
  }
  const { calls } = repoWith(on, files, {
    hasNearest: true,
    listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'],
    links: { '/repo/mods/link/.claude_todo': '/repo/mods/x/.claude_todo', '/repo/mods/f/.claude_todo/archive/OLD.md': '/repo/.claude_todo/TODO.md' },
  })
  storeWith(on, {
    'duplicates:/repo': [
      '/repo/mods/x/.claude_todo',
      '/repo/mods/link/.claude_todo',
      '/repo/mods/f/.claude_todo',
      '/repo/other',
      '/repo/mods/../.claude_todo',
      '/outside/.claude_todo',
      '/repo/.claude_todo',
      '.claude_todo',
    ],
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-delete-duplicates' })
  const removed = rmCalls(calls).filter(call => call.startsWith('rm --'))
  // The plain folder goes, its archive file behind a symlink stays; the symlinked folder, the others, the central folder never.
  expect(removed.sort()).toEqual(['rm -- /repo/mods/f/.claude_todo/TODO.md', 'rm -- /repo/mods/x/.claude_todo/TODO.md'])
  expect(files['/repo/mods/f/.claude_todo/archive/OLD.md']).toBeDefined()
  expect(removed.some(call => call.includes('/repo/.claude_todo') || call.includes('/outside') || call.includes('NOTCLAUDE') || call.includes('/link/'))).toBe(false)
})

test('safety 5: a second Consolidate writes the union of the old record and the new sources', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] one',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] two',
    '/repo/mods/y/.claude_todo/TODO.md': '- [ ] three',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md'] })
  const store = storeWith(on, { 'duplicates:/repo': ['/repo/mods/x/.claude_todo'] })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  expect([...(store.get('duplicates:/repo') as string[])].sort()).toEqual(['/repo/mods/x/.claude_todo', '/repo/mods/y/.claude_todo'])
})

test('safety 6: a source whose section is already in the central file is not copied again', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] one\n\n## From mods/x\n\n- [ ] two\n',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] two',
    '/repo/mods/y/.claude_todo/TODO.md': '- [ ] three',
  }
  const { writes } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md', 'mods/y/.claude_todo/TODO.md'] })
  storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] one\n\n## From mods/x\n\n- [ ] two\n\n## From mods/y/TODO.md\n\n- [ ] three\n')
  expect(writes).toEqual(['/repo/.claude_todo/TODO.md'])
  // Pressing again finds nothing left to copy: the board has one folder and the button is gone.
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
})

test('safety 7: a renumbered ID is rewritten in the same file, listed in the toast, and told to Claude once', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Docs\n- [ ] #T2 Ship, after #T1',
  }
  const store = storeWith(on)
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  // One clash moves one line: #T1 takes #T3, past the source's own #T2, which keeps its number.
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix\n\n## From mods/x/TODO.md\n\n- [ ] #T3 Docs\n- [ ] #T2 Ship, after #T3\n')
  expect(toasts.join('\n')).toContain('mods/x/TODO.md: #T1 is now #T3')
  expect((store.get('duplicates-meta:/repo') as { renames: Record<string, unknown> }).renames['/repo/mods/x/.claude_todo/TODO.md']).toEqual({ t1: 'T3' })
  const told = JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x' } as never))
  expect(told).toContain('#T1 is now #T3')
  expect(JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x' } as never))).not.toContain('is now #T2')
})

test('safety 9: a file that changes after the check is not removed', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] one\n- [ ] two' }
  let reads = 0
  Object.defineProperty(files, '/repo/mods/x/.claude_todo/TODO.md', {
    enumerable: true,
    configurable: true,
    get: () => {
      reads += 1

      return reads >= 2 ? '- [ ] one\n- [ ] two\n- [ ] added meanwhile' : '- [ ] one'
    },
  })
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  storeWith(on, { 'duplicates:/repo': ['/repo/mods/x/.claude_todo'] })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  reads = 0
  await ui.press({ key: 'todo-delete-duplicates' })
  expect(rmCalls(calls).some(call => call.includes('mods/x/.claude_todo/TODO.md') && call.startsWith('rm --'))).toBe(false)
  expect(toasts.join('\n')).toContain('changed since the check')
})

test('categories: a duplicate book is merged into the central one before it goes, and kept for the folder that was primary', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T3 Docs',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Docs',
    '/repo/mods/x/.claude_todo/categories.json': JSON.stringify({ categories: ['Writing'], items: { 'mods/x/.claude_todo::#t1': 'Writing' } }),
    '/repo/mods/p/.claude_todo/TODO.md': '- [ ] #T3 Docs',
    '/repo/mods/p/.claude_todo/categories.json': '{}',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md'] })
  storeWith(on, {
    'duplicates:/repo': ['/repo/mods/x/.claude_todo', '/repo/mods/p/.claude_todo'],
    'duplicates-meta:/repo': { primary: ['/repo/mods/p/.claude_todo'], renames: { '/repo/mods/x/.claude_todo/TODO.md': { t1: 'T3' } } },
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-delete-duplicates' })
  expect(JSON.parse(files['/repo/.claude_todo/categories.json']!)).toEqual({ categories: ['Writing'], items: { '#t3': 'Writing' } })
  expect(files['/repo/mods/x/.claude_todo/categories.json']).toBeUndefined()
  expect(files['/repo/mods/p/.claude_todo/categories.json']).toBe('{}')
})

// ---------------------------------------------------------------- final round

const SRC = () => ({ '/repo/.claude_todo/TODO.md': '- [ ] one', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] two' }) as Record<string, string>
const SRC_LIST = ['.claude_todo/TODO.md', 'mods/x/.claude_todo/TODO.md']

test('final 1: a central file that cannot be read is never written, and the press stops', async ($, on) => {
  mock.clock(on)
  const files = SRC()
  // The file reads while the board loads, and fails when the press reads it.
  let isBroken = false
  Object.defineProperty(files, '/repo/.claude_todo/TODO.md', { enumerable: true, configurable: true, get: () => { if (isBroken) { throw new Error('EIO') } return '- [ ] one' }, set: () => undefined })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: SRC_LIST })
  const store = storeWith(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  isBroken = true
  await ui.press({ key: 'todo-consolidate' })
  expect(writes).toEqual([])
  expect(toasts.join('\n')).toContain('Could not consolidate')
  expect(store.get('duplicates:/repo')).toBeUndefined()
  expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
})

test('final 2: a central file that changed since the press read it is skipped, and its sources stay on the board', async ($, on) => {
  mock.clock(on)
  const files = SRC()
  let reads = 0
  Object.defineProperty(files, '/repo/.claude_todo/TODO.md', {
    enumerable: true,
    configurable: true,
    // The first read of the press sees the text it starts from; the read before the write sees an edit.
    get: () => {
      reads += 1

      return reads >= 2 ? '- [ ] one\n- [ ] edited meanwhile' : '- [ ] one'
    },
    set: () => undefined,
  })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: SRC_LIST })
  const store = storeWith(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  reads = 0
  await ui.press({ key: 'todo-consolidate' })
  expect(writes).toEqual([])
  expect(toasts.join('\n')).toContain('changed meanwhile')
  expect(store.get('duplicates:/repo')).toEqual([])
  expect(await ui.find({ key: 'todo-consolidate' })).toBeDefined()
})

test('final 3: a heading alone does not mean copied: other lines under it are copied, and only fully copied folders become duplicates', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] one\n\n## From mods/x\n\n- [ ] an older version\n',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] two',
  }
  repoWith(on, files, { hasNearest: true, listed: SRC_LIST })
  const store = storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] one\n\n## From mods/x\n\n- [ ] an older version\n\n## From mods/x/TODO.md\n\n- [ ] two\n')
  expect(store.get('duplicates:/repo')).toEqual(['/repo/mods/x/.claude_todo'])
})

test('final 4: Delete needs the exact line after the renames, for item lines too', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [x] #T1 Same\n- [ ] #T3 Docs\n- [ ] #T9 Plain',
    '/repo/mods/a/.claude_todo/TODO.md': '- [ ] #T1 Same',
    '/repo/mods/b/.claude_todo/TODO.md': '- [ ] #T1 Docs',
    '/repo/mods/c/.claude_todo/TODO.md': '- [ ] #T9 Plain',
  }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  storeWith(on, {
    'duplicates:/repo': ['/repo/mods/a/.claude_todo', '/repo/mods/b/.claude_todo', '/repo/mods/c/.claude_todo'],
    'duplicates-meta:/repo': { renames: { '/repo/mods/b/.claude_todo/TODO.md': { t1: 'T3' } } },
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-delete-duplicates' })
  // a: the box differs, so it stays. b: the rename makes the line exact. c: identical.
  expect(rmCalls(calls).filter(call => call.startsWith('rm --')).sort()).toEqual(['rm -- /repo/mods/b/.claude_todo/TODO.md', 'rm -- /repo/mods/c/.claude_todo/TODO.md'])
})

test('final 5: a source file that cannot be read is not marked copied, and its folder stays on the board', async ($, on) => {
  mock.clock(on)
  const files = SRC()
  let isBroken = false
  Object.defineProperty(files, '/repo/mods/x/.claude_todo/TODO.md', { enumerable: true, configurable: true, get: () => { if (isBroken) { throw new Error('EIO') } return '- [ ] two' }, set: () => undefined })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: SRC_LIST })
  const store = storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  isBroken = true
  await ui.press({ key: 'todo-consolidate' })
  expect(writes).toEqual([])
  expect((store.get('duplicates:/repo') as string[] | undefined) ?? []).toEqual([])
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeUndefined()
})

test('renumbering skips the source file own IDs, so one clash moves one line only', () => {
  const used = new Set(['t1', 't2', 't12'])
  const out = renumberLines(['- [ ] #T1 Module task', '- [ ] #T12 Other', '- [x] #T13 Own', '- [ ] see #T1'], used)
  expect(out.pairs.map(pair => `${pair.from}>${pair.to}`)).toEqual(['T1>T14', 'T12>T15'])
  expect(out.lines[2]).toContain('#T13 Own')
})

test('a file copied again replaces its old renumbering, even with none, so Delete still matches it', async ($, on) => {
  mock.clock(on)
  repoWith(on, SRC(), { hasNearest: true, listed: SRC_LIST })
  const store = storeWith(on, { 'duplicates-meta:/repo': { primary: [], renames: { '/repo/mods/x/.claude_todo/TODO.md': { t2: 'T9' } } } })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  const meta = store.get('duplicates-meta:/repo') as { renames: Record<string, unknown> }
  expect(meta.renames['/repo/mods/x/.claude_todo/TODO.md']).toEqual({})
})

// ---------------------------------------------------------------- recorded duplicates re-checked, and folding

test('round 7a: a recorded duplicate that gains an uncovered line shows again, leaves the record, and is consolidated again', async ($, on) => {
  const clock = mock.clock(on)
  const files = SRC()
  const { calls } = repoWith(on, files, { hasNearest: true, listed: SRC_LIST })
  const store = storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  expect(store.get('duplicates:/repo')).toEqual(['/repo/mods/x/.claude_todo'])
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  // Claude adds a ticket to the consolidated folder.
  files['/repo/mods/x/.claude_todo/TODO.md'] = '- [ ] two\n- [ ] three'
  await clock.advance(60_000)
  expect(store.get('duplicates:/repo')).toEqual([])
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('three')
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeUndefined()
  await ui.press({ key: 'todo-consolidate' })
  // Only the new line is copied; the old one is not doubled.
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] one\n\n## From mods/x/TODO.md\n\n- [ ] two\n\n## From mods/x/TODO.md\n\n- [ ] three\n')
  expect(store.get('duplicates:/repo')).toEqual(['/repo/mods/x/.claude_todo'])
  expect(rmCalls(calls)).toEqual([])
})

/** Runs Consolidate on the given files and returns what the test then needs. */
async function consolidated($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, listed: string[]) {
  mock.clock(on)
  const { calls } = repoWith(on, files, { hasNearest: true, listed })
  const store = storeWith(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined } as never
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }) as never)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })

  return { ui, calls, store, toasts }
}

type Meta = { renames: Record<string, Record<string, string>>; folds: Record<string, string[]> }

test('round 7b: an identical ticket with another ID is folded: not copied, the ID mapped, references follow, Delete removes the source', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T4 Fix the parser\n- [ ] #T5 Ship, after #T4',
  }
  const { ui, calls, store, toasts } = await consolidated($, on, files, SRC_LIST)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix the parser\n\n## From mods/x/TODO.md\n\n- [ ] #T5 Ship, after #T1\n')
  const meta = store.get('duplicates-meta:/repo') as Meta
  expect(meta.renames['/repo/mods/x/.claude_todo/TODO.md']).toEqual({ t4: 'T1' })
  expect(meta.folds['/repo/mods/x/.claude_todo/TODO.md']).toEqual(['- [ ] #T4 Fix the parser'])
  expect(toasts.join('\n')).toContain('#T4 folded into #T1')
  expect(JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/x' } as never))).toContain('#T4 folded into #T1')
  await ui.press({ key: 'todo-delete-duplicates' })
  expect(rmCalls(calls).filter(call => call.startsWith('rm --'))).toEqual(['rm -- /repo/mods/x/.claude_todo/TODO.md'])
})

test('round 7c: the same text with another box is copied, not folded', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser',
    '/repo/mods/x/.claude_todo/TODO.md': '- [x] #T4 Fix the parser',
  }
  const { store } = await consolidated($, on, files, SRC_LIST)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix the parser\n\n## From mods/x/TODO.md\n\n- [x] #T4 Fix the parser\n')
  expect((store.get('duplicates-meta:/repo') as Meta).folds['/repo/mods/x/.claude_todo/TODO.md']).toEqual([])
})

test('round 7d: two sources with the same ticket fold into one central line, and Delete removes both', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T9 Other',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Same ticket',
    '/repo/mods/y/.claude_todo/TODO.md': '- [ ] #T2 Same ticket',
  }
  const { ui, calls } = await consolidated($, on, files, [...SRC_LIST, 'mods/y/.claude_todo/TODO.md'])
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T9 Other\n\n## From mods/x/TODO.md\n\n- [ ] #T1 Same ticket\n')
  await ui.press({ key: 'todo-delete-duplicates' })
  expect(rmCalls(calls).filter(call => call.startsWith('rm --')).sort()).toEqual(['rm -- /repo/mods/x/.claude_todo/TODO.md', 'rm -- /repo/mods/y/.claude_todo/TODO.md'])
})

test('round 7e: a ticket one character off is copied', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix the parser',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T4 Fix the parsr\n- [ ] #T5 fix the parser',
  }
  await consolidated($, on, files, SRC_LIST)
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix the parser\n\n## From mods/x/TODO.md\n\n- [ ] #T4 Fix the parsr\n- [ ] #T5 fix the parser\n')
})

test('review 8a: a skipped write keeps its source off the record, even when the coverage check then fails', async ($, on) => {
  mock.clock(on)
  const files = SRC()
  let reads = 0
  Object.defineProperty(files, '/repo/.claude_todo/TODO.md', {
    enumerable: true,
    configurable: true,
    get: () => {
      reads += 1
      if (reads >= 3) {
        throw new Error('EIO')
      }

      return reads === 2 ? '- [ ] one\n- [ ] edited meanwhile' : '- [ ] one'
    },
    set: () => undefined,
  })
  const { writes } = repoWith(on, files, { hasNearest: true, listed: SRC_LIST })
  const store = storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  reads = 0
  await ui.press({ key: 'todo-consolidate' })
  expect(writes).toEqual([])
  expect((store.get('duplicates:/repo') as string[] | undefined) ?? []).toEqual([])
})

test('review 8b: a malformed folds entry in the record does not stop the coverage check', async ($, on) => {
  const clock = mock.clock(on)
  const files = { ...SRC(), '/repo/.claude_todo/TODO.md': '- [ ] one\n- [ ] two' }
  repoWith(on, files, { hasNearest: true, listed: SRC_LIST })
  const store = storeWith(on, {
    'duplicates:/repo': ['/repo/mods/x/.claude_todo'],
    'duplicates-meta:/repo': { primary: [], renames: {}, folds: { '/repo/mods/x/.claude_todo/TODO.md': {} } },
  })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  files['/repo/mods/x/.claude_todo/TODO.md'] = '- [ ] two\n- [ ] three ONLY HERE'
  await clock.advance(60_000)
  await clock.advance(60_000)
  expect(store.get('duplicates:/repo')).toEqual([])
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('three ONLY HERE')
})

// ---------------------------------------------------------------- folding across central files

test('round 8a: a ticket identical to one in another central file is folded, with the same or another ID, and Delete removes the source', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T6 Update the install guide',
    '/repo/mods/x/.claude_todo/BACKLOG.md': '- [ ] #T6 Update the install guide',
    '/repo/mods/y/.claude_todo/BACKLOG.md': '- [ ] #T16 Update the install guide',
  }
  const { ui, calls, store, toasts } = await consolidated($, on, files, ['.claude_todo/TODO.md', 'mods/x/.claude_todo/BACKLOG.md', 'mods/y/.claude_todo/BACKLOG.md'])
  // Nothing was copied: no BACKLOG.md in the central folder, and TODO.md as it was.
  expect(files['/repo/.claude_todo/BACKLOG.md']).toBeUndefined()
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T6 Update the install guide')
  const meta = store.get('duplicates-meta:/repo') as Meta & { foldTo: Record<string, Record<string, string>> }
  expect(meta.renames['/repo/mods/y/.claude_todo/BACKLOG.md']).toEqual({ t16: 'T6' })
  // The same line, ID and all, is already in the target: covered as it is, no fold needed.
  expect(meta.foldTo['/repo/mods/x/.claude_todo/BACKLOG.md']).toEqual({})
  expect(meta.foldTo['/repo/mods/y/.claude_todo/BACKLOG.md']).toEqual({ '- [ ] #T16 Update the install guide': 'TODO.md' })
  expect(toasts.join('\n')).toContain('#T16 folded into #T6')
  await ui.press({ key: 'todo-delete-duplicates' })
  expect(rmCalls(calls).filter(call => call.startsWith('rm --')).sort()).toEqual(['rm -- /repo/mods/x/.claude_todo/BACKLOG.md', 'rm -- /repo/mods/y/.claude_todo/BACKLOG.md'])
})

test('round 8b: a line queued from one source TODO.md is the fold target for another source BACKLOG.md in the same press', async ($, on) => {
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Something else',
    '/repo/mods/a/.claude_todo/TODO.md': '- [ ] #T20 Shared thing',
    '/repo/mods/b/.claude_todo/BACKLOG.md': '- [ ] #T30 Shared thing',
  }
  const { ui, calls, store } = await consolidated($, on, files, ['.claude_todo/TODO.md', 'mods/a/.claude_todo/TODO.md', 'mods/b/.claude_todo/BACKLOG.md'])
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Something else\n\n## From mods/a/TODO.md\n\n- [ ] #T20 Shared thing\n')
  expect(files['/repo/.claude_todo/BACKLOG.md']).toBeUndefined()
  const meta = store.get('duplicates-meta:/repo') as Meta
  expect(meta.renames['/repo/mods/b/.claude_todo/BACKLOG.md']).toEqual({ t30: 'T20' })
  await ui.press({ key: 'todo-delete-duplicates' })
  expect(rmCalls(calls).filter(call => call.startsWith('rm --')).sort()).toEqual(['rm -- /repo/mods/a/.claude_todo/TODO.md', 'rm -- /repo/mods/b/.claude_todo/BACKLOG.md'])
})

test('round 8c: only a recorded fold shares a central line; an unrecorded identical line is covered once', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T6 Update the install guide',
    '/repo/mods/x/.claude_todo/BACKLOG.md': '- [ ] #T6 Update the install guide',
    '/repo/mods/y/.claude_todo/BACKLOG.md': '- [ ] #T6 Update the install guide',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', 'mods/x/.claude_todo/BACKLOG.md', 'mods/y/.claude_todo/BACKLOG.md'] })
  // Two duplicates with no fold record: the one central line covers the first only.
  const store = storeWith(on, { 'duplicates:/repo': ['/repo/mods/x/.claude_todo', '/repo/mods/y/.claude_todo'] })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(store.get('duplicates:/repo')).toEqual(['/repo/mods/x/.claude_todo'])
})

// ---------------------------------------------------------------- one target file

test('round 9a: Consolidate merges the central folder\'s other files too, and after Delete the board has one file', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/.claude_todo/BACKLOG.md': '- [ ] #T2 Backlog item',
    '/repo/.claude_todo/categories.json': '{}',
    '/repo/.claude_todo/archive/OLD.md': '- [x] #T9 Old',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T1 Docs',
  }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/BACKLOG.md', '.claude_todo/archive/OLD.md', 'mods/x/.claude_todo/TODO.md'] })
  const store = storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  const heads = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(await heads()).toContain('BACKLOG.md')
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix\n\n## From BACKLOG.md\n\n- [ ] #T2 Backlog item\n\n## From mods/x/TODO.md\n\n- [ ] #T10 Docs\n')
  // The central BACKLOG.md and the other folder are recorded; the target is not.
  expect([...(store.get('duplicates:/repo') as string[])].sort()).toEqual(['/repo/.claude_todo/BACKLOG.md', '/repo/mods/x/.claude_todo'])
  expect(await heads()).not.toContain('BACKLOG.md')
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  await ui.press({ key: 'todo-delete-duplicates' })
  const removing = rmCalls(calls)
  expect(removing.filter(call => call.startsWith('rm --')).sort()).toEqual(['rm -- /repo/.claude_todo/BACKLOG.md', 'rm -- /repo/mods/x/.claude_todo/TODO.md'])
  // The target, the central book and the central archive stay; the central folder is never removed.
  expect(files['/repo/.claude_todo/TODO.md']).toBeDefined()
  expect(files['/repo/.claude_todo/categories.json']).toBe('{}')
  expect(files['/repo/.claude_todo/archive/OLD.md']).toBeDefined()
  expect(files['/repo/.claude_todo/BACKLOG.md']).toBeUndefined()
  expect(removing.some(call => call.includes('categories.json') || call.includes('/repo/.claude_todo/archive') || call === 'rmdir -- /repo/.claude_todo')).toBe(false)
  expect(store.get('duplicates:/repo')).toEqual([])
  const after = await heads()
  expect(after).toContain('TODO.md')
  expect(after).not.toContain('BACKLOG.md')
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeUndefined()
})

test('round 9b: a central extra file with an uncovered line stays on the board', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix',
    '/repo/.claude_todo/BACKLOG.md': '- [ ] #T2 Not copied yet',
  }
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/BACKLOG.md'] })
  const store = storeWith(on, { 'duplicates:/repo': ['/repo/.claude_todo/BACKLOG.md'] })
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  expect(store.get('duplicates:/repo')).toEqual([])
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('Not copied yet')
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeUndefined()
  expect(rmCalls(calls)).toEqual([])
})

test('round 9c: one folder with TODO.md and BACKLOG.md shows Consolidate and merges into TODO.md', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/.claude_todo/TODO.md': '- [ ] #T1 Fix', '/repo/.claude_todo/BACKLOG.md': '- [ ] #T2 Later' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/BACKLOG.md'] })
  const store = storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('- [ ] #T1 Fix\n\n## From BACKLOG.md\n\n- [ ] #T2 Later\n')
  expect(store.get('duplicates:/repo')).toEqual(['/repo/.claude_todo/BACKLOG.md'])
  expect(await ui.find({ key: 'todo-consolidate' })).toBeUndefined()
  expect(await ui.find({ key: 'todo-delete-duplicates' })).toBeDefined()
})

test('round 9d: the target is TODO.md; else the only todo file; else a new TODO.md', async ($, on) => {
  mock.clock(on)
  // The only top-level todo file in the central folder takes the others.
  const only: Record<string, string> = { '/repo/.claude_todo/NOTES.md': '- [ ] #T1 n', '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T2 c' }
  repoWith(on, only, { hasNearest: true, listed: ['.claude_todo/NOTES.md', 'mods/x/.claude_todo/TODO.md'] })
  storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  expect(only['/repo/.claude_todo/NOTES.md']).toBe('- [ ] #T1 n\n\n## From mods/x/TODO.md\n\n- [ ] #T2 c\n')
  expect(only['/repo/.claude_todo/TODO.md']).toBeUndefined()
})

test('round 9e: with two central todo files and no TODO.md, a new TODO.md takes all', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/A.md': '- [ ] #T1 a',
    '/repo/.claude_todo/B.md': '- [ ] #T2 b',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 c',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/A.md', '.claude_todo/B.md', 'mods/x/.claude_todo/TODO.md'] })
  const store = storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  expect(files['/repo/.claude_todo/TODO.md']).toBe('## From A.md\n\n- [ ] #T1 a\n\n## From B.md\n\n- [ ] #T2 b\n\n## From mods/x/TODO.md\n\n- [ ] #T3 c\n')
  expect([...(store.get('duplicates:/repo') as string[])].sort()).toEqual(['/repo/.claude_todo/A.md', '/repo/.claude_todo/B.md', '/repo/mods/x/.claude_todo'])
})

test('review 9: a lowercase todo.md is the target on a case-insensitive disk, never merged into itself or deleted', async ($, on) => {
  mock.clock(on)
  const real: Record<string, string> = {
    '/repo/.claude_todo/todo.md': '- [ ] #T1 Precious',
    '/repo/.claude_todo/NOTES.md': '- [ ] #T2 Notes',
    '/repo/mods/x/.claude_todo/TODO.md': '- [ ] #T3 Other',
  }
  const key = (name: string | symbol) => (typeof name === 'string' ? Object.keys(real).find(one => one.toLowerCase() === name.toLowerCase()) ?? name : name)
  // Paths match without case, as on the default macOS disk.
  const files = new Proxy(real, {
    get: (target, name) => (typeof name === 'string' ? target[key(name) as string] : undefined),
    has: (target, name) => key(name) in target,
    set: (target, name, value) => {
      target[key(name) as string] = value

      return true
    },
    getOwnPropertyDescriptor: (target, name) => Object.getOwnPropertyDescriptor(target, key(name)),
  })
  const { calls } = repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/todo.md', '.claude_todo/NOTES.md', 'mods/x/.claude_todo/TODO.md'] })
  const store = storeWith(on)
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
  await ui.press({ key: 'todo-consolidate' })
  expect(real['/repo/.claude_todo/todo.md']).toContain('#T1 Precious')
  expect(real['/repo/.claude_todo/todo.md']).toContain('Notes')
  expect(real['/repo/.claude_todo/todo.md']).toContain('Other')
  expect(((store.get('duplicates:/repo') as string[] | undefined) ?? []).some(one => one.toLowerCase().endsWith('/todo.md') && one.startsWith('/repo/.claude_todo'))).toBe(false)
  if (await ui.find({ key: 'todo-delete-duplicates' })) {
    await ui.press({ key: 'todo-delete-duplicates' })
  }
  expect(rmCalls(calls).some(one => one.toLowerCase().includes('/repo/.claude_todo/todo.md'))).toBe(false)
  expect(real['/repo/.claude_todo/todo.md']).toContain('#T1 Precious')
})
