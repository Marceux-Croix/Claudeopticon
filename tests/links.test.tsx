import { expect, test } from 'claude-code/testing'

import { linkAgents, linkOne, linkWork, resetLinkCache } from '../hooks/links'
import { normalize } from '../hooks/normalize'
import { parseTodo } from '../hooks/todo-markdown'
import type { AgentRow, TodoFile } from '../types'

const PLAN = ['# Plan', '- [x] Write code', '- [~] #T2 Run the test suite', '- [ ] Ship the release build', 'prose', '  - [X] nested'].join('\n')

const row = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1', description: 'x', type: 'Explore', status: 'running', startedAt: 0, toolCalls: 0, brief: '', ...over,
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

test('an agent links to every open item its brief names by ID, and #T1 does not match #T12', async () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] #T1 update graphing\n- [ ] #T12 change codebase structure\n- [x] #T3 old one\n- [ ] #T4 other') }]
  const links = linkAgents(list, [row({ id: 'a', brief: 'architecture: #t1 and #t12, also #t3' }), row({ id: 'b', brief: 'only #t12' })])
  expect(links.get('a')?.map(link => link.item.id)).toEqual(['T1', 'T12'])
  expect(links.get('b')?.map(link => link.item.id)).toEqual(['T12'])
})

// ---------------------------------------------------------------- 

type OldLink = { file: string; index: number }

/** The linking as it was before the index: the reference the new code must agree with. */
function oldLinks(list: TodoFile[], rows: AgentRow[]): Map<string, OldLink[]> {
  const words = (text: string) => new Set(normalize(text).split(/[^a-z0-9]+/).filter(word => word.length >= 3))
  const score = (claim: string, item: { text: string; id?: string }) => {
    const c = normalize(claim)
    if (item.id !== undefined && new RegExp(`#${item.id.toLowerCase()}(?![0-9a-z])`).test(c)) {
      return 1
    }
    const t = normalize(item.text)
    if (Math.min(c.length, t.length) >= 12 && (t.includes(c) || c.includes(t))) {
      return 1
    }
    const a = words(claim)
    const b = words(item.text)
    const shared = [...a].filter(word => b.has(word)).length
    const share = shared / Math.max(1, Math.min(a.size, b.size))

    return shared >= 3 && share >= 0.7 ? share : 0
  }
  const out = new Map<string, OldLink[]>()
  const open = list
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map((item, index) => ({ file: `${file.folder}/${file.name}`, index, item })))
    .filter(link => link.item.status !== 'completed')
  for (const r of rows) {
    if (r.status === 'completed' || r.status === 'failed' || r.status === 'killed') {
      continue
    }
    const byId = open.filter(link => link.item.id !== undefined && new RegExp(`#${link.item.id.toLowerCase()}(?![0-9a-z])`).test(r.brief))
    const byClaim = [...(r.claims ?? []), ...(r.autoClaims ?? [])].flatMap(claim => {
      const best = open.map(link => ({ link, s: score(claim, link.item) })).filter(one => one.s > 0).sort((x, y) => y.s - x.s)[0]

      return best === undefined ? [] : [best.link]
    })
    const claimed = [...byId, ...byClaim].filter((link, i, all) => all.findIndex(one => one.file === link.file && one.index === link.index) === i)
    const byText = claimed.length > 0 ? [] : open.filter(link => {
      const t = normalize(link.item.text)

      return t.length >= 12 && r.brief.includes(t)
    }).slice(0, 1)
    const found = [...claimed, ...byText].map(link => ({ file: link.file, index: link.index }))
    if (found.length > 0) {
      out.set(r.id, found)
    }
  }

  return out
}

const WORDS = ['parser', 'invoice', 'render', 'cache', 'socket', 'router', 'schema', 'widget', 'archive', 'ledger', 'timeline', 'gateway', 'session', 'token', 'budget', 'sorter']

function bigList(n: number): TodoFile[] {
  const lines = Array.from({ length: n }, (_, i) => {
    const w = (k: number) => WORDS[(i * 7 + k * 3 + (i >> 4)) % WORDS.length]
    const box = i % 5 === 0 ? 'x' : i % 7 === 0 ? '~' : ' '

    return `- [${box}] #T${i.toString(36).padStart(4, '0')} ${w(0)} ${w(1)} ${w(2)} ${w(3)} case number ${i}`
  })

  return [{ name: 'BIG.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo(lines.join('\n')) }]
}

function agentRows(a: number, list: TodoFile[]): AgentRow[] {
  const items = list[0]!.items

  return Array.from({ length: a }, (_, i) => {
    const pick = (k: number) => items[(i * 37 + k * 211) % items.length]!

    return row({
      id: `ag${i}`,
      brief: i % 3 === 0 ? `work on #${pick(0).id!.toLowerCase()} and #${pick(1).id!.toLowerCase()}` : `quote: ${normalize(pick(2).text)} please`,
      claims: [pick(0).text, `${pick(1).text.replace('case number', 'case')}`, i % 4 === 0 ? `#${pick(2).id!.toLowerCase()}` : 'unrelated words about nothing at all'],
      status: i % 11 === 0 ? 'completed' : 'running',
    })
  })
}

/**
 * Property: a cold link of 2000 tickets and 50 agents scores each claim and brief
 * at most once against each open item, and a redraw with the same todo and agents scores nothing.
 * Counted in scores (`linkWork`), not in milliseconds, so a loaded machine cannot fail it.
 */
test('linkAgents with 2000 tickets and 50 agents of 3 claims each scores each ask once per open item, and a redraw scores nothing', () => {
  resetLinkCache()
  const list = bigList(2000)
  const rows = agentRows(50, list)
  const live = rows.filter(one => one.status !== 'completed')
  const asks = new Set(live.flatMap(one => [...(one.claims ?? []).map(claim => `c${claim}`), `b${one.brief}`])).size
  const contents = new Set(list[0]!.items.filter(item => item.status !== 'completed').map(item => `${item.id ?? ''}\u0000${item.text}`)).size
  const start = linkWork()
  const links = linkAgents(list, rows)
  const cold = linkWork() - start
  expect(cold).toBeGreaterThan(0)
  expect(cold).toBeLessThanOrEqual(asks * contents)
  expect(links.size).toBeGreaterThan(10)
  // A redraw with the same todo and agents is memoized: no score at all.
  const again = linkWork()
  linkAgents(list, rows)
  expect(linkWork()).toBe(again)
})

test('the links are those of the plain scan: IDs, claims, quoted text, ended agents, whole IDs', () => {
  const list = bigList(300)
  const rows = agentRows(30, list)
  rows.push(row({ id: 'prefix', brief: 'see #t0001 and #t00012 only' }), row({ id: 'none', brief: 'nothing here' }), row({ id: 'upper', brief: 'fix #T0003x then #t0004.' }))
  const want = oldLinks(list, rows)
  const got = linkAgents(list, rows)
  expect([...got.keys()].sort()).toEqual([...want.keys()].sort())
  for (const [id, links] of got) {
    expect(links.map(link => link.index)).toEqual(want.get(id)!.map(link => link.index))
  }
  // Same inputs again (memo hit) give the same links.
  expect([...linkAgents(list, rows)].map(([id, links]) => [id, links.map(link => link.index)])).toEqual([...got].map(([id, links]) => [id, links.map(link => link.index)]))
})

test('a changed todo or a changed brief or claim is not served from the memo', () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] #T1 Ship the parser\n- [ ] #T2 Review the copy') }]
  const agent = row({ id: 'a', brief: 'do #t1' })
  expect(linkAgents(list, [agent]).get('a')?.map(link => link.index)).toEqual([0])
  // The brief changes.
  expect(linkAgents(list, [{ ...agent, brief: 'do #t2' }]).get('a')?.map(link => link.index)).toEqual([1])
  // A claim is added.
  expect(linkAgents(list, [{ ...agent, claims: ['#T2'] }]).get('a')?.map(link => link.index)).toEqual([0, 1])
  // The todo is rescanned: item 1 is now done.
  const next: TodoFile[] = [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 2, items: parseTodo('- [x] #T1 Ship the parser\n- [ ] #T2 Review the copy') }]
  expect(linkAgents(next, [agent]).has('a')).toBe(false)
  // The same file object with a longer item list.
  const grown: TodoFile = { ...next[0]!, items: [...next[0]!.items, ...parseTodo('- [ ] #T1B again')] }
  expect(linkAgents([grown], [row({ id: 'a', brief: '#t1b' })]).get('a')?.map(link => link.index)).toEqual([2])
  // An agent that ended is not linked.
  expect(linkAgents(list, [{ ...agent, status: 'completed' }]).has('a')).toBe(false)
})

// ---------------------------------------------------------------- 

const indexes = (links: Map<string, { file?: string; index: number }[]>) => [...links].map(([id, found]) => [id, found.map(one => one.index)]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))

/**
 * Property: a todo change costs work for the changed items only, and the one-row link of an ended
 * agent leaves the memo of the other rows; the links stay those of the plain scan.
 */
test('a one-row link keeps the memo of the other rows: the next redraw scores nothing', () => {
  resetLinkCache()
  const list = bigList(300)
  const rows = agentRows(30, list)
  linkAgents(list, rows)
  // The ended agent's note links one row on its own, then the pane draws all rows again.
  expect(linkOne(list, { ...rows[1]!, id: 'ended' }).length).toBeGreaterThan(0)
  const afterOne = linkWork()
  linkAgents(list, rows)
  expect(linkWork()).toBe(afterOne)
  expect(linkOne(list, { ...rows[1]!, status: 'completed' })).toEqual([])
})

test('a todo change scores only the changed items, in three constructed states, with the links of the plain scan', () => {
  const base = bigList(300)
  const rows = agentRows(30, base)
  const live = rows.filter(one => one.status === 'running')
  // Each claim, and each brief with no other link, is scored again only against the changed content.
  const budget = live.reduce((sum, one) => sum + (one.claims?.length ?? 0) + 1, 0)
  const edit = (i: number, text: string): TodoFile[] => [{ ...base[0]!, mtimeMs: 2, items: base[0]!.items.map((item, k) => (k === i ? { ...item, text } : item)) }]
  const work = (after: TodoFile[]) => {
    resetLinkCache()
    linkAgents(base, rows)
    const start = linkWork()
    const got = linkAgents(after, rows)
    expect(indexes(got)).toEqual(indexes(oldLinks(after, rows)))

    return linkWork() - start
  }
  // A change behind a valid first item, and one at the last item: a few scores, not 300 per claim.
  expect(work(edit(1, 'parser invoice render cache brand new'))).toBeLessThanOrEqual(budget)
  expect(work(edit(299, 'parser invoice render cache brand new'))).toBeLessThanOrEqual(budget)
  // The excluded population: an edit that removes a claim's best item scores that claim over every item again.
  const claim = live[0]!.claims![0]!
  const at = base[0]!.items.findIndex(item => item.text === claim)
  expect(at).toBeGreaterThan(-1)
  expect(work(edit(at, 'nothing like it at all'))).toBeGreaterThan(budget)
})

test('over random edits the cached links equal the plain scan, ties going to the first item', () => {
  let seed = 7
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648

    return seed % n
  }
  let list = bigList(80)
  const rows = [...agentRows(10, list), row({ id: 'twin', claims: [list[0]!.items[3]!.text] })]
  resetLinkCache()
  for (let step = 0; step < 30; step += 1) {
    const items = [...list[0]!.items]
    const k = rand(items.length)
    const kind = rand(3)
    if (kind === 0) {
      items[k] = { ...items[k]!, text: `${WORDS[rand(WORDS.length)]} ${WORDS[rand(WORDS.length)]} ${WORDS[rand(WORDS.length)]} case number ${rand(80)}` }
    } else if (kind === 1) {
      items.splice(k, 1)
    } else {
      // A copy of an item: two items with one content, so the first in list order must win.
      items.splice(k, 0, { ...items[rand(items.length)]! })
    }
    list = [{ ...list[0]!, mtimeMs: step + 2, items }]
    expect(indexes(linkAgents(list, rows))).toEqual(indexes(oldLinks(list, rows)))
  }
})
