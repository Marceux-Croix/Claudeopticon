import { expect, test } from 'claude-code/testing'

import { headingLevel, indentOf, isItemLine, itemParts, lineMask, looksLikeItem, openedLine, withBox, withLeadingId } from '../hooks/item-lines'
import { exampleMask } from '../hooks/markdown-blocks'
import { parseTodo } from '../hooks/todo-markdown'

// ----------------------------------------------------------------
// Property: a `.md` file reads only Markdown checkbox lines, exactly as before; a `.html` file reads them and
// HTML checkbox items. A write with no change gives the same bytes, a box change changes only the box or the
// input tag, and no write ever drops or adds a line.

const HTML_LINE = '  <li><input type="checkbox" data-state="queued"> #T0001 Fix &amp; ship</li>'

test('a .md file reads no HTML item; a .html file reads both kinds', () => {
  expect(itemParts(HTML_LINE, 'md')).toBeUndefined()
  expect(isItemLine(HTML_LINE, 'md')).toBe(false)
  expect(itemParts(HTML_LINE, 'html')).toEqual({ box: '>', head: '  <li><input type="checkbox" data-state="queued"> ', text: '#T0001 Fix &amp; ship', tail: '</li>', isHtml: true })
  expect(itemParts('- [x] #T2 done', 'md')).toEqual({ box: 'x', head: '- [x] ', text: '#T2 done', tail: '', isHtml: false })
  expect(itemParts('- [x] #T2 done', 'html')).toEqual(itemParts('- [x] #T2 done', 'md'))
  expect(looksLikeItem('<input type="checkbox"> no li', 'html')).toBe(true)
  expect(looksLikeItem('<input type="checkbox"> no li', 'md')).toBe(false)
})

test('withBox changes only the box: a Markdown box, or an HTML item\'s input tag to the canonical one', () => {
  expect(withBox('- [ ] a [ ] b', 'html', 'x')).toBe('- [x] a [ ] b')
  expect(withBox(`${HTML_LINE}\r`, 'html', 'x')).toBe('  <li><input type="checkbox" checked> #T0001 Fix &amp; ship</li>\r')
  expect(withBox('<li><input type="checkbox"> a [ ] b</li>', 'html', '~')).toBe('<li><input type="checkbox" data-state="in-progress"> a [ ] b</li>')
  // In a .md file an HTML line is no item: its `[ ]` text is the first box, as it always was.
  expect(withBox('<li><input type="checkbox"> a [ ] b</li>', 'md', 'x')).toBe('<li><input type="checkbox"> a [x] b</li>')
  expect(openedLine(HTML_LINE, 'html')).toBe('  <li><input type="checkbox"> #T0001 Fix &amp; ship</li>')
  expect(openedLine(HTML_LINE, 'md')).toBe(HTML_LINE)
  expect(openedLine('- [~] a', 'html')).toBe('- [ ] a')
})

test('withLeadingId puts the ID at the start of the text: after the box, or after the input tag and its spaces', () => {
  expect(withLeadingId('- [ ] Fix x', 'md', 'T002B')).toBe('- [ ] #T002B Fix x')
  expect(withLeadingId('<li><input type="checkbox">  Fix &amp; x</li>\r', 'html', 'T002B')).toBe('<li><input type="checkbox">  #T002B Fix &amp; x</li>\r')
  expect(withLeadingId('<li><input type="checkbox"> Fix</li>', 'md', 'T002B')).toBe('<li><input type="checkbox"> Fix</li>')
})

test('headingLevel reads ATX headings in both kinds and <hN> lines only in a .html file', () => {
  expect(headingLevel('## Core', 'md')).toBe(2)
  expect(headingLevel('<h3>Docs</h3>', 'html')).toBe(3)
  expect(headingLevel('<h3>Docs</h3>', 'md')).toBeUndefined()
  expect(headingLevel('prose', 'html')).toBeUndefined()
})

test('lineMask: a .md file is exampleMask exactly; in a .html file an HTML block, indent or fence never hides an HTML item, a comment does', () => {
  const lines = ['<ul>', '  <li><input type="checkbox"> a</li>', '', '    <li><input type="checkbox"> b</li>', '```', '<li><input type="checkbox"> c</li>', '```', '<!--', '<li><input type="checkbox"> d</li>', '-->', '<pre>', '<li><input type="checkbox"> e</li>', '</pre>', '- [ ] md', '<div>', '- [ ] md in div']
  expect(lineMask(lines, 'md')).toEqual(exampleMask(lines))
  const mask = lineMask(lines, 'html')
  expect([1, 3, 5, 8, 11].map(at => mask[at])).toEqual([false, false, false, true, true])
  // A Markdown checkbox line keeps the CommonMark rule in a .html file, as in 1.0.9: an item, or hidden by an HTML block.
  expect([13, 15].map(at => mask[at])).toEqual([exampleMask(lines)[13], exampleMask(lines)[15]])
  expect(mask[15]).toBe(true)
})

test('indentOf counts spaces and tabs to the next multiple of 4', () => {
  expect([indentOf('a'), indentOf('  a'), indentOf('\ta'), indentOf(' \t a'), indentOf('    ')]).toEqual([0, 2, 4, 5, 4])
})

/** A seeded generator (mulberry32): the fuzz is the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0

  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PARTS = ['<li>', '<LI>', '</li>', '</LI>', '<input', '<INPUT', ' type="checkbox"', " type='CheckBox'", ' checked', ' checked=""', ' checked="no"', ' data-state="queued"', " data-state='in-progress'", ' data-state="x"', '>', '/>', ' ', '\t', '#T0001', '#T1 ', 'text', '&amp;', '&lt;', '- [ ] ', '- [x] ', '[~]', '<!--', '-->', '<pre>', '\r', '"', "'", '=', ' ']

/** A random HTML-ish line, made of the grammar's own pieces, most of them in an order that is close to an item. */
function randomLine(next: () => number): string {
  const pick = () => PARTS[Math.floor(next() * PARTS.length)]!
  if (next() < 0.5) {
    const attrs = Array.from({ length: Math.floor(next() * 4) }, () => [' checked', ' checked=""', ' data-state="queued"', ' data-state="in-progress"', ' id="a"', pick()][Math.floor(next() * 6)]!)
    const tag = `<input${next() < 0.5 ? ' type="checkbox"' : ''}${attrs.join('')}${next() < 0.5 ? '>' : ' />'}`

    return `${' '.repeat(Math.floor(next() * 6))}<li>${tag}${Array.from({ length: Math.floor(next() * 4) }, pick).join('')}</li>${next() < 0.3 ? '  ' : ''}`
  }

  return Array.from({ length: Math.floor(next() * 10) }, pick).join('')
}

test('round trip: parts rebuild the line; a box set to its own value gives the same bytes; a change touches only the tag', () => {
  const next = rng(0xb0)
  let items = 0
  for (let i = 0; i < 5000; i += 1) {
    const line = randomLine(next)
    const parts = itemParts(line.replace(/\r$/, ''), 'html')
    if (parts === undefined) {
      expect([line, withBox(line, 'html', 'x').split('\n').length]).toEqual([line, line.split('\n').length])
      continue
    }
    items += 1
    expect(parts.head + parts.text + parts.tail).toBe(line.replace(/\r$/, ''))
    if (!parts.isHtml) {
      continue
    }
    const box = parts.box as ' ' | 'x' | '~' | '>'
    for (const to of [' ', 'x', '~', '>'] as const) {
      const out = withBox(line, 'html', to)
      const again = itemParts(out.replace(/\r$/, ''), 'html')!
      // The new box reads back, and every byte outside the input tag stays.
      expect(again.box).toBe(to)
      expect(again.text).toBe(parts.text)
      expect(again.tail).toBe(parts.tail)
      expect(out.replace(/<input[^>]*>/i, '<T>')).toBe(line.replace(/<input[^>]*>/i, '<T>'))
    }
    // Set back to what it read, the tag is the canonical one of that box: a line already canonical keeps its bytes.
    const canon = withBox(line, 'html', box)
    expect(withBox(canon, 'html', box)).toBe(canon)
  }
  expect(items).toBeGreaterThan(500)
})

test('fuzz: no box or ID write on random HTML-ish lines drops or adds a line', () => {
  const next = rng(0x7e57)
  for (let i = 0; i < 500; i += 1) {
    const lines = Array.from({ length: 1 + Math.floor(next() * 12) }, () => randomLine(next))
    const text = lines.join('\n')
    for (const kind of ['md', 'html'] as const) {
      const boxed = lines.map(line => withBox(line, kind, 'x'))
      const ided = lines.map(line => withLeadingId(line, kind, 'T0009'))
      for (const out of [boxed, ided]) {
        expect(out.join('\n').split('\n').length).toBe(text.split('\n').length)
        // Only item lines change.
        out.forEach((line, at) => {
          if (!isItemLine(lines[at]!.replace(/\r$/, ''), kind) && !/\[[ xX~>]\]/.test(lines[at]!)) {
            expect(line).toBe(lines[at]!)
          }
        })
      }
    }
  }
})

// ----------------------------------------------------------------
// Property: in a .html file a Markdown checkbox or ATX heading line is an example when CommonMark says so or when it
// is inside an HTML region: a comment opened mid-line is no HTML block, so only the regions see it.

test('a Markdown line in a comment opened mid-line is an example in a .html file', () => {
  const hidden = ['Old tickets, hidden: <!--', '', '- [x] #T0003 commented-out md ticket', '## Old', '', '-->', '- [ ] #T0004 live']
  expect(lineMask(hidden, 'html')).toEqual([true, true, true, true, true, true, false])
  expect(parseTodo(hidden.join('\n'), 'html').map(item => item.id)).toEqual(['T0004'])
  // A .md file keeps the CommonMark rule alone: the paragraph line opens no HTML block, as before.
  expect(lineMask(hidden, 'md').slice(2, 4)).toEqual([false, false])
  // In a <pre> opened mid-line too.
  expect(lineMask(['text <pre>', '- [ ] a', '</pre>', '- [ ] b'], 'html')).toEqual([true, true, true, false])
})
