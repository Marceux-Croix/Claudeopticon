import { expect, test } from 'claude-code/testing'

import { HTML_STARTS, htmlEnds, htmlStart } from '../hooks/html-blocks'
import { SMALL } from './fixtures/pattern-growth'
import { stepCounter } from './fixtures/regex-steps'

// ---------------------------------------------------------------- (batch M)

/**
 * Property: a line starts an HTML block exactly when CommonMark 0.31.2 starts one (types 1 to 7), with the
 * end condition of its type, and a lone tag (type 7) never ends a paragraph.
 */
test('htmlStart gives each of the 7 CommonMark HTML block types its end, and refuses what starts none', () => {
  // Types 1 to 5: the end mark, matched on any line (the start line included).
  expect(htmlStart('<pre>', false)!.toString()).toContain('pre|script|style|textarea')
  expect(htmlStart('<TEXTAREA rows=2', false)).not.toBeUndefined()
  expect(htmlEnds('x</Script>', htmlStart('<script>', false)!)).toBe(true)
  expect(htmlEnds('-->', htmlStart('<!--', false)!)).toBe(true)
  expect(htmlEnds('a ?>', htmlStart('<?php', false)!)).toBe(true)
  expect(htmlEnds('>', htmlStart('<!DOCTYPE html', false)!)).toBe(true)
  expect(htmlEnds(']]>', htmlStart('<![CDATA[', false)!)).toBe(true)
  // Type 6: a block tag name, open or closing, then a space, `>`, `/>` or the line end; any case; ends at a blank line.
  for (const line of ['<div>', '</div>', '<details>', '<DIV class="y">', '<div/>', '<summary>x</summary>', '   <table', '<search>']) {
    expect([line, htmlStart(line, true)]).toEqual([line, 'blank'])
  }
  expect(htmlEnds('', 'blank')).toBe(true)
  expect(htmlEnds('</div>', 'blank')).toBe(false)
  // Type 7: a complete lone tag (any name), not on a paragraph.
  for (const line of ['<span>', '</span>', '<a href="x">', "<custom-tag a=1 b='2' c>", '<prefix>', '<pre/>']) {
    expect([line, htmlStart(line, false)]).toEqual([line, 'blank'])
    expect([line, htmlStart(line, true)]).toEqual([line, undefined])
  }
  // The excluded population: 4 spaces in (indented code), a tag in the middle of a line, an incomplete or unknown form.
  for (const line of ['    <div>', 'x <div>', '<b>text</b>', '<span', '<a href=x', '<1a>', '< div>', '<divx', '<!', '<!-', 'text']) {
    expect([line, htmlStart(line, false)]).toEqual([line, undefined])
  }
})

/** Property: each HTML start pattern does linear work on a long line, as a todo line can be 1 MB. */
test('the HTML block start patterns take linear steps on long adversarial lines', () => {
  const shapes = ['<a b', '<a b=c', ' ', '<div', '<a b="', "<a b='", '<a\t', '<a b= ', '</a ', 'a=b ']
  for (const re of HTML_STARTS) {
    const count = stepCounter(re)
    for (const unit of shapes) {
      // A head of each kind's start, then the unit repeated: the step ratio at twice the size is about 2 when linear.
      for (const head of ['', '<a', '<div', '<!--', '<a b']) {
        const at = (size: number) => count(head + unit.repeat(Math.ceil(size / unit.length)).slice(0, size)).steps
        const ratio = at(SMALL * 2) / at(SMALL)
        expect([re.source.slice(0, 30), head, unit, ratio < 3]).toEqual([re.source.slice(0, 30), head, unit, true])
      }
    }
  }
})
