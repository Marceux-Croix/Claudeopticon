import { expect, mock, test } from 'claude-code/testing'

import { clock, orchestratorSvg, AGENT_COLORS, tokens, agentShare, agentSvg, fileCards, heroSvg, setWidth, ticketSvg, timelineSvg, wrap } from '../hooks/cards'
import { endAgentTasks, taskLines, launchedTask, endedTask, readTaskName, taskNamePrompt, RULES, callSummary, orchestratorView, pageLabel, findTicket, moveQuestion, setBox, movesNote, statusPrompt, sendScope, PROGRESS_NOTE, turnTokens, filterNames, withoutHidden, matchPrompt, readMatchReply, ticketColumns, ticketPrompt, ticketSummary, applySortReply, claimScore, findTodoDirWith, isGlobalTodo, plainText, progressReply, readClaims, buildView, categoryGroups, describeCall, itemKey, labelNote, ledger, linkAgents, parseTodo, readProgress, searchTodo, sortPrompt, todoLedger } from '../hooks/register'
import type { AgentRow, TodoFile } from '../types'
import type { BackgroundTask } from '../hooks/register'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Work', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

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
  const list: TodoFile[] = [{ name: 'PLAN.md', mtimeMs: 1, items: parseTodo(PLAN) }]
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
  const list: TodoFile[] = [{ name: 'A<B>.md', mtimeMs: 1, items: parseTodo(PLAN) }]
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
    ...Array.from({ length: 9 }, (_, i) => ({ name: `DONE-${i}.md`, mtimeMs: 100 + i, items: many(0, 30) })),
    ...Array.from({ length: 12 }, (_, i) => ({ name: `OPEN-${i}.md`, mtimeMs: i, items: many(300, 20) })),
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
    { name: 'OPEN.md', mtimeMs: 3, items: parseTodo('- [ ] next\n- [x] shipped') },
    { name: 'DONE.md', mtimeMs: 2, items: parseTodo('- [x] a\n- [x] b') },
    { name: 'archive/OLD.md', mtimeMs: 1, items: parseTodo('- [x] c\n- [x] d\n- [x] e'), isArchived: true },
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
    { name: 'A.md', mtimeMs: 2, items: parseTodo('- [ ] #T1 pay vendor\n- [x] #T2 sign lease\n- [ ] #T3 new thing\n- [ ] #T5 bill client') },
    { name: 'B.md', mtimeMs: 1, items: parseTodo('- [ ] #T4 refund flow') },
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
    { name: 'OPEN.md', mtimeMs: 2, items: parseTodo('- [ ] Ship the new parser\n- [x] Parser test fixtures updated') },
    { name: 'archive/OLD.md', mtimeMs: 1, items: parseTodo('- [x] Parser fuzz run verified'), isArchived: true },
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
  const view = buildView([{ name: 'OPEN.md', mtimeMs: 1, items: parseTodo(`- [ ] ${item}`) }], [], 0)
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
  const list: TodoFile[] = [{ name: 'OPEN.md', mtimeMs: 1, items: parseTodo('- [~] working on it\n- [ ] open one\n- [x] done one') }]
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
  const list: TodoFile[] = [{ name: 'A.md', mtimeMs: 1, items: parseTodo('- [ ] #T1 update graphing\n- [ ] #T12 change codebase structure\n- [x] #T3 old one\n- [ ] #T4 other') }]
  const links = linkAgents(list, [row({ id: 'a', brief: 'architecture: #t1 and #t12, also #t3' }), row({ id: 'b', brief: 'only #t12' })])
  expect(links.get('a')?.map(link => link.item.id)).toEqual(['T1', 'T12'])
  expect(links.get('b')?.map(link => link.item.id)).toEqual(['T12'])
})

test('an item blinks its agent color, and cycles through every agent on it', async () => {
  const list: TodoFile[] = [{ name: 'A.md', mtimeMs: 1, items: parseTodo('- [ ] #T1 update graphing\n- [ ] #T12 change codebase structure\n- [ ] #T4 nobody') }]
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
  const list: TodoFile[] = [{ name: 'OPEN.md', mtimeMs: 1, items }]
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
  expect(await findTodoDirWith(fake({ '../../.git': 'dir', '../../.claude_todo': 'dir', '.claude_todo': 'dir' }))).toBe('../../.claude_todo')
  expect(await findTodoDirWith(fake({ '.git': 'file', '/repo/.claude_todo': 'dir' }))).toBe('/repo/.claude_todo')
  expect(await findTodoDirWith(fake({ '.git': 'dir' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.claude_todo': 'dir' }, { '.claude_todo': '/home/someone/.claude/.claude_todo' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.git': 'dir', '.claude_todo': 'dir' }, { '.claude_todo': '/home/someone/.claude/.claude_todo' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '../.claude_todo': 'dir' }))).toBeUndefined()
  expect(await findTodoDirWith(fake({ '.claude_todo': 'dir' }))).toBe('.claude_todo')
  expect(isGlobalTodo('/home/a/.claude/.claude_todo')).toBe(true)
  expect(isGlobalTodo('/home/a/project/.claude_todo')).toBe(false)
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
  expect(sent[0]).toBe(ticketPrompt('OPEN.md', 'Ship the new parser'))
  expect((await ui.find({ key: ticket }))?.text).toContain('?')
  expect(await svgs()).toContain('>Sent<')
  await ui.press({ key: ticket })
  expect(sent[1]).toBe(statusPrompt('OPEN.md', 'Ship the new parser'))
  const working = 'ticket-OPEN.md-build the release notes'
  expect((await ui.find({ key: working }))?.text).toContain('?')
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('Ask Claude for a status update')
  await ui.press({ key: working })
  expect(sent[2]).toBe(statusPrompt('OPEN.md', 'Build the release notes'))
  expect(sent.length).toBe(3)
  await ui.press({ key: 'todo-tickets' })
  expect((await ui.findAll({ type: 'Svg' })).some(svg => JSON.stringify(svg).includes('Ship the new parser'))).toBe(true)
})

test('a ticket summary cuts long text at a word, and keeps short text whole', async () => {
  expect(ticketSummary('short', 50)).toBe('short')
  expect(ticketSummary('one two three four five six seven', 20)).toBe('one two three four…')
  expect(ticketPrompt('A.md', 'Do it')).toContain('.claude_todo/A.md')
})

test('every card carries the light palette, swapped in by the system theme', async () => {
  const view = buildView([{ name: 'A.md', mtimeMs: 1, items: parseTodo('- [ ] one') }], [row({})], 10)
  for (const card of [heroSvg(view), ...fileCards(view.files[0]!, view, 12), timelineSvg(view, view.agents), agentSvg(view.agents[0]!, view)]) {
    expect(card.source).toContain('@media (prefers-color-scheme:light){[fill="#07080F"]{fill:#FFFFFF}')
    expect(card.source).toContain('[fill="rgba(255,255,255,.88)"]{fill:#10131C}')
  }
})

test('ticket columns: In progress (with open tickets a live agent works on), Open, then Done when shown; linked first, then by category, then file order', async () => {
  const list: TodoFile[] = [{ name: 'A.md', mtimeMs: 1, items: parseTodo([
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
    { name: 'A.md', mtimeMs: 2, items: parseTodo('- [ ] #T1 pay vendor\n- [ ] #T2 sign lease\n- [ ] #T3 unsorted thing') },
    { name: 'B.md', mtimeMs: 1, items: parseTodo('- [ ] #T4 refund flow') },
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
    { name: 'A.md', mtimeMs: 1, items: parseTodo('- [x] #T1 Review the terms of service\n- [ ] Ship the new parser and roll back') },
    { name: 'archive/B.md', mtimeMs: 1, items: parseTodo('- [x] #T9 Old thing'), isArchived: true },
  ]
  expect(findTicket(list, '#T1')?.item.text).toBe('#T1 Review the terms of service')
  expect(findTicket(list, 't1')?.file).toBe('A.md')
  expect(findTicket(list, 'Ship the new parser and roll back')?.item.status).toBe('pending')
  expect(findTicket(list, '#T9')).toBeUndefined()
  expect(findTicket(list, 'nothing like it')).toBeUndefined()
  const question = moveQuestion('A.md', list[0]!.items[0]!, 'in_progress', 'The review is not finished.', true)
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
  const ui = await $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
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
