import { expect, test } from 'claude-code/testing'

import { agentSvg } from '../hooks/agent-cards'
import { AGENT_COLORS } from '../hooks/agent-identity'
import { ACCENT, setWidth } from '../hooks/card-stage'
import type { FileView, ItemView } from '../hooks/card-types'
import { heroSvg } from '../hooks/hero-card'
import { boardHead, fileCards, listRowPx, spaceSvg, ticketSvg } from '../hooks/todo-cards'
import { parseTodo } from '../hooks/todo-markdown'
import { buildView, todoLedger } from '../hooks/view-model'
import type { AgentRow, TodoFile } from '../types'

const row = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1', description: 'x', type: 'Explore', status: 'running', startedAt: 0, toolCalls: 0, brief: '', ...over,
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

test('a ticket with buttons keeps a bottom row of its own for them', async () => {
  const view = buildView([], [], 0)
  const item = { text: 'Fix the parser', status: 'pending' as const, owners: [], key: 'fix the parser' }
  const plain = ticketSvg(item, view, 300, { isSent: false })
  const sendable = ticketSvg(item, view, 300, { isSent: false, actions: 1 })
  expect(sendable.height).toBe(plain.height + 60)
})

test('a queued ticket shows a Queued badge and no accent bar, as an open one shows none', async () => {
  const view = buildView([], [], 0)
  const open = ticketSvg({ text: 'Fix the parser', status: 'pending' as const, owners: [], key: 'a' }, view, 300, { isSent: false }).source
  const queued = ticketSvg({ text: 'Fix the parser', status: 'queued' as const, owners: [], key: 'a' }, view, 300, { isSent: false }).source
  expect(queued).toContain('>Queued<')
  const working = ticketSvg({ text: 'Fix the parser', status: 'in_progress' as const, owners: [], key: 'a' }, view, 300, { isSent: false }).source
  expect(working).toContain(ACCENT)
  expect(open).not.toContain(ACCENT)
  expect(queued).not.toContain(ACCENT)
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
    // the orchestrator card exists only while a main-conversation turn runs; idle, the tag above stays but the card is gone.
    if (!isRunning) {
      expect(view.orchestrator).toBeUndefined()
      continue
    }
    const card = agentSvg(view.orchestrator!, view).source
    expect(card).toContain('>Running<')
    expect(card.includes('@keyframes k0')).toBe(blinks)
    expect(card).toContain('>O<')
    expect(card).toContain('#T3 Check the invoice')
  }
})

test('a space is a transparent card of its height with no text and no buttons', async () => {
  const space = spaceSvg(300, 142)
  expect([space.width, space.height]).toEqual([300, 142])
  expect(space.source).toContain('height="142"')
  expect(space.source).not.toContain('<text')
  expect(space.source).not.toContain('<rect')
  expect(space.source).not.toContain('fill=')
})

test('the list view keeps the place of a row that left', async () => {
  const items = [0, 1, 2].map(i => ({ text: `Row ${i}`, status: 'pending' as const, owners: [], key: `r${i}` }))
  const file = (list: typeof items): FileView => ({ name: 'A.md', id: 'A.md', done: 0, active: 0, total: list.length, owners: [], items: list, mtimeMs: 1 })
  const view = buildView([], [], 0)
  const whole = fileCards(file(items), view, 12)[0]!
  const fewer = fileCards(file([items[0]!, items[2]!]), view, 12)[0]!
  const held = fileCards(file([items[0]!, items[2]!]), view, 12, false, new Map([[1, listRowPx(items[1]!)]]))[0]!
  expect(fewer.height).toBeLessThan(whole.height)
  expect(held.height).toBe(whole.height)
})

// ---------------------------------------------------------------- loop 2, batch J5


/** The rightmost and leftmost x any shape of an SVG reaches, from its rects, circles and the anchors of its text. */
function extent(svg: string) {
  let min = Infinity
  let max = -Infinity
  for (const match of svg.matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"/g)) {
    min = Math.min(min, Number(match[1]))
    max = Math.max(max, Number(match[1]) + Number(match[2]))
  }
  for (const match of svg.matchAll(/<circle cx="([-\d.]+)" cy="[-\d.]+" r="(14|16\.5)"/g)) {
    min = Math.min(min, Number(match[1]) - Number(match[2]))
    max = Math.max(max, Number(match[1]) + Number(match[2]))
  }

  return { min, max }
}

const crowd = (n: number) => Array.from({ length: n }, (_, i) => row({ id: `a${i}`, description: `agent ${i}`, brief: `agent ${i}` }))
const owned = (n: number): ItemView => ({ text: 'Pay the vendor invoice and file the receipt in the books', status: 'in_progress', owners: Array.from({ length: n }, (_, i) => i), key: '#t1' })

for (const width of [300, 384]) {
  for (const n of [9, 12]) {
    test(`a ticket card at ${width} px with ${n} owners keeps every chip inside the card and tells the rest by a +M chip`, () => {
      const view = buildView([], crowd(n), 1000)
      const card = ticketSvg(owned(n), view, width, { id: '#T0001', isSent: false })
      const { min, max } = extent(card.source)
      expect(min).toBeGreaterThanOrEqual(0)
      expect(max).toBeLessThanOrEqual(width)
      const chips = [...card.source.matchAll(/font-size="10\.5" font-weight="700">([^<]+)</g)].map(match => match[1]!)
      const more = chips.find(chip => chip.startsWith('+'))
      expect(more).toBeDefined()
      expect(chips.length - 1 + Number(more!.slice(1))).toBe(n)
      // The first owners come first, in order.
      expect(chips.slice(0, 2)).toEqual(['A1', 'A2'])
      // The working agent's text keeps room: it is not cut to nothing.
      expect(card.source).toContain('agent 0')
    })

    test(`a list row at ${width} px with ${n} owners keeps every disk inside the card, clear of the text, and tells the rest by a +M disk`, () => {
      setWidth(width)
      const view = buildView([], crowd(n), 1000)
      const item = owned(n)
      const file: FileView = { name: 'OPEN.md', id: 'OPEN.md', done: 0, active: 1, total: 1, owners: item.owners, items: [item], mtimeMs: 1 }
      const card = fileCards(file, view, 12)[0]!
      const { min, max } = extent(card.source)
      setWidth(384)
      expect(min).toBeGreaterThanOrEqual(0)
      expect(max).toBeLessThanOrEqual(width)
      const disks = [...card.source.matchAll(/<circle cx="([-\d.]+)" cy="[-\d.]+" r="14"/g)].map(match => Number(match[1]))
      expect(disks.length).toBeLessThan(n)
      expect(card.source).toMatch(/>\+\d+</)
      // The text start is PAD + 22 = 38; its room is at least 120 px: the leftmost disk edge is right of that.
      expect(Math.min(...disks) - 14).toBeGreaterThanOrEqual(38 + 120)
    })
  }
}

test('a few owners are all shown, with no +M chip, at every width', () => {
  for (const width of [300, 384, 520, 960]) {
    setWidth(width)
    const view = buildView([], crowd(3), 1000)
    const item = owned(3)
    const file: FileView = { name: 'OPEN.md', id: 'OPEN.md', done: 0, active: 1, total: 1, owners: item.owners, items: [item], mtimeMs: 1 }
    expect(fileCards(file, view, 12)[0]!.source).not.toMatch(/>\+\d+</)
    expect(ticketSvg(item, view, width, { isSent: false }).source).not.toMatch(/>\+\d+</)
    expect(listRowPx(item)).toBeGreaterThan(0)
  }
  setWidth(384)
})

test('a ticket whose category is not a string draws with no category chip, and never throws', () => {
  const view = buildView([], [], 0)
  const item = { text: 'constructor', status: 'pending' as const, owners: [], key: 'constructor' }
  // The old card passed Object (what a plain-object book gave "constructor") to esc(), which threw "text.replace is not a function".
  for (const odd of [Object, 5, null]) {
    const card = ticketSvg(item, view, 300, { isSent: false, category: odd as never }).source
    expect(card).toContain('>constructor<')
    expect(card).not.toContain('rx="9.5"')
  }
  // A string category still draws its chip, an empty one too (the limit).
  expect(ticketSvg(item, view, 300, { isSent: false, category: 'Work' }).source).toContain('>Work<')
  expect(ticketSvg(item, view, 300, { isSent: false, category: '' }).source).toContain('rx="9.5"')
})
