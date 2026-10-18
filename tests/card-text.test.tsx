import { expect, test } from 'claude-code/testing'

import { agentSvg, orchestratorSvg, timelineSvg } from '../hooks/agent-cards'
import { setWidth } from '../hooks/card-stage'
import { altText, cleanText, cutText, cutUnits, keyText, wrap } from '../hooks/card-text'
import { heroSvg } from '../hooks/hero-card'
import { readTitle } from '../hooks/progress-report'
import { boardHead, fileCards, ticketSvg } from '../hooks/todo-cards'
import { parseTodo } from '../hooks/todo-markdown'
import { buildView } from '../hooks/view-model'
import type { AgentRow, TodoFile } from '../types'

const PLAN = ['# Plan', '- [x] Write code', '- [~] #T2 Run the test suite', '- [ ] Ship the release build', 'prose', '  - [X] nested'].join('\n')

const row = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1', description: 'x', type: 'Explore', status: 'running', startedAt: 0, toolCalls: 0, brief: '', ...over,
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

/** XML 1.0 forbids these; the same class xmllint rejects. */
const BAD_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

// ---------------------------------------------------------------- and 

const todo = (text: string): TodoFile[] => [{ name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo(text) }]

const NASTY = 'bell\x07 nul\x00 esc\x1B ff\x0C del￾ end￿ lone\uD800 low\uDC00 ok\ttab'

test('every card is free of characters XML forbids, in tickets, files, agents, titles and the board header', () => {
  for (const text of [NASTY, `${NASTY} ${NASTY}`.repeat(30)]) {
    const list = todo(`- [ ] #T1 ${text}\n- [x] ${text}`)
    const rows = [row({ description: text, brief: '#t1', doing: text, type: text }), row({ id: 'b', status: 'failed', startedAt: 1, endedAt: 9, description: text })]
    const view = buildView(list, rows, 9000, { keys: new Set(), isRunning: false, title: text, toolCalls: 1, doing: text })
    const file = view.files[0]!
    const sources = [
      heroSvg(view).source,
      timelineSvg(view, view.agents).source,
      boardHead([file]).source,
      ...fileCards(file, view, 12).map(card => card.source),
      ...file.items.map(item => ticketSvg(item, view, 400, { id: '#T1', isSent: false }).source),
      ...view.agents.map(agent => agentSvg(agent, view).source),
      orchestratorSvg([{ line: text, at: 0, isRunning: false, detail: text }]).source,
    ]
    for (const source of sources) {
      expect(BAD_XML.test(source)).toBe(false)
    }
  }
  expect(cleanText('a\x00b\uD800c')).toBe('abc')
  expect(cleanText('tab\tlf\ncr\r')).toBe('tab\tlf\ncr\r')
  expect(cleanText('😀')).toBe('😀')
})

test('a cut never splits a surrogate pair: wrap, fit (through the ticket) and the aria label', () => {
  const smile = '😀'
  for (const width of [60, 97, 143, 211, 300]) {
    for (const text of [smile.repeat(300), `a${smile.repeat(300)}`, `word ${smile.repeat(100)} tail`, `${'x'.repeat(40)}${smile.repeat(40)}`]) {
      const lines = wrap(text, width, 13, 400, 3)
      for (const line of lines) {
        expect(BAD_XML.test(line)).toBe(false)
        expect(() => encodeURIComponent(line)).not.toThrow()
      }
    }
  }
  const list = todo(`- [ ] #T1 ${smile.repeat(300)}`)
  const view = buildView(list, [], 0)
  const item = view.files[0]!.items[0]!
  for (const w of [300, 384, 720]) {
    const card = ticketSvg(item, view, w, { id: '#T1', isSent: false })
    expect(BAD_XML.test(card.source)).toBe(false)
    expect(() => encodeURIComponent(card.source)).not.toThrow()
    expect(() => encodeURIComponent(card.alt)).not.toThrow()
  }
  // Cut limits: 120 and 200 fall inside a pair when the text starts with one unit more.
  const odd = ticketSvg({ ...item, text: `a${smile.repeat(150)}` }, view, 400, { id: '#T1', isSent: false })
  expect(BAD_XML.test(odd.source)).toBe(false)
  expect(() => encodeURIComponent(odd.alt)).not.toThrow()
  expect(cutText(`a${smile}`, 2)).toBe('a😀'.slice(0, 1) + smile)
  expect(cutText(smile.repeat(3), 2)).toBe(smile.repeat(2))
  expect(readTitle(`${smile.repeat(100)}`)).toBe(smile.repeat(80))
})

// ---------------------------------------------------------------- (narrowed), 

test('a card alt keeps no control character: C0, DEL and C1 go, a line break parts words', () => {
  // The verifier's characters and more of C1, each inside a word, at the start (behind nothing) and at the end (the limit).
  for (const bad of ['\x01', '\x07', '\x0B', '\x1B', '\x7F', '\x85', '\x9B', '\x9F', '\x80']) {
    for (const text of [`Fix${bad}parser`, `${bad}Fix parser`, `Fix parser${bad}`]) {
      const alt = altText(text)
      expect(alt).not.toMatch(/[\x00-\x1F\x7F-\x9F]/)
      expect(alt.replace(/\s/g, '')).toBe('Fixparser')
    }
  }
  expect(altText('Run\n\tthe tests\r\n')).toBe('Run the tests')
  // A lone surrogate goes; a pair, and letters just past the excluded range (U+00A0 and up), stay.
  expect(altText('a\uD83Db \u{1F600} é  x')).toBe('ab \u{1F600} é  x')
})

test('cutUnits never splits a surrogate pair', () => {
  expect(cutUnits('ab\u{1F600}c', 3)).toBe('ab')
  expect(cutUnits('ab\u{1F600}c', 4)).toBe('ab\u{1F600}')
  expect(cutUnits('abc', 5)).toBe('abc')
  expect(cutUnits('\u{1F600}', 1)).toBe('')
})

test('keyText encodes control characters and lone surrogates, keeps other text, and keeps names that differ by one apart', () => {
  expect(keyText('TODO.md')).toBe('TODO.md')
  expect(keyText('a\u001Bb')).toBe('a%1Bb')
  expect(keyText('a\nb')).toBe('a%0Ab')
  expect(keyText('a\u009Fb')).toBe('a%9Fb')
  expect(keyText('a\uD800b')).toBe('a%D800b')
  expect(keyText('a\u{1F600}b')).toBe('a\u{1F600}b')
  // Not a strip: "a<ESC>b", "ab" and the literal "a%1Bb" are three keys.
  expect(new Set([keyText('a\u001Bb'), keyText('ab'), keyText('a%1Bb')]).size).toBe(3)
  for (const text of ['\u0000', '\u007F', '\u0085', '\r\n', 'x\u0007\u001B[2Jy']) {
    expect(/[\x00-\x1F\x7F-\x9F]/.test(keyText(text))).toBe(false)
  }
})
