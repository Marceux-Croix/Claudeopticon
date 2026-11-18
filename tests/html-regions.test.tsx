import { expect, test } from 'claude-code/testing'

import { editOutside, htmlRegionMask, htmlRegionSpans } from '../hooks/html-regions'

// ----------------------------------------------------------------
// Property: in a `.html` file a line is an example exactly when it starts inside an HTML comment or a
// `<pre>`, `<script>`, `<style>` or `<textarea>` element, or one is still open at its end.

test('htmlRegionMask marks the lines of a comment, at any indent, and not a comment closed on its line', () => {
  expect(htmlRegionMask(['<ul>', '  <!--', '  <li>a</li>', '  -->', '  <li>b</li>', '</ul>'])).toEqual([false, true, true, true, false, false])
  expect(htmlRegionMask(['<!-- note -->', '<li>a</li>'])).toEqual([false, false])
  expect(htmlRegionMask(['<li>a</li> <!-- open', 'x -->', 'y'])).toEqual([true, true, false])
  // `<!-->` and `<!--->` are whole empty comments.
  expect(htmlRegionMask(['<!-->', 'a', '<!--->', 'b'])).toEqual([false, false, false, false])
})

test('htmlRegionMask marks pre, script, style and textarea in any case up to the closing tag, and no other name', () => {
  expect(htmlRegionMask(['<PRE class="x">', '<li>a</li>', '</pre>', 'b'])).toEqual([true, true, true, false])
  for (const name of ['script', 'style', 'textarea']) {
    expect(htmlRegionMask([`<${name}>`, 'a', `</${name.toUpperCase()}>`, 'b'])).toEqual([true, true, true, false])
  }
  expect(htmlRegionMask(['<prefix>', 'a', '<pre>x</pre>', 'b'])).toEqual([false, false, false, false])
  // A `</pre` must end its name: `</prefix>` closes nothing.
  expect(htmlRegionMask(['<pre>', '</prefix>', '</pre >', 'a'])).toEqual([true, true, true, false])
  // A comment opener inside a pre opens nothing; a pre opener inside a comment opens nothing.
  expect(htmlRegionMask(['<pre>', '<!--', '</pre>', 'a'])).toEqual([true, true, true, false])
  expect(htmlRegionMask(['<!--', '<pre>', '-->', 'a'])).toEqual([true, true, true, false])
})

test('htmlRegionMask reads a long line in one pass', () => {
  const start = Date.now()
  expect(htmlRegionMask(['<!---->'.repeat(100_000), '<pre></pre>'.repeat(50_000), 'a']).at(-1)).toBe(false)
  expect(Date.now() - start).toBeLessThan(3000)
})

// ----------------------------------------------------------------
// Property: outside a region a tag is read to its `>`, past quoted values: a `<!--` or `<pre` in an attribute value
// opens nothing, and a tag that does not end on its line takes only the rest of that line. Linear.

test('an opener inside a quoted attribute value opens no region', () => {
  const lines = ['<ul>', '<li><input type="checkbox" title="use <!-- in docs"> #T0001 a</li>', '<li><input type="checkbox"> #T0002 b</li>', '<li><input type="checkbox"> #T0003 c</li>', '</ul>']
  expect(htmlRegionMask(lines)).toEqual([false, false, false, false, false])
  expect(htmlRegionMask(["<a title='<pre>'>x</a>", '<li>a</li>'])).toEqual([false, false])
  // A raw element's own tag is read past its values too: `</pre>` in a value does not close it.
  expect(htmlRegionMask(['<pre title="</pre>">', '<li>a</li>', '</pre>', 'b'])).toEqual([true, true, true, false])
  // An opener after the tag still opens; one after a stray `<` that is no tag opens too.
  expect(htmlRegionMask(['<b class="x"><!--', 'x', '-->'])).toEqual([true, true, true])
  expect(htmlRegionMask(['a < b <!--', '-->'])).toEqual([true, true])
  // A tag cut at the line end takes the rest of its line only: the next line reads from outside.
  expect(htmlRegionMask(['<a title="x', '<!--', '-->', 'y'])).toEqual([false, true, true, false])
  const start = Date.now()
  expect(htmlRegionMask(['<a b="1" '.repeat(100_000), `<a title="${'<!--'.repeat(100_000)}">`, '<x'.repeat(100_000), 'z']).at(-1)).toBe(false)
  expect(Date.now() - start).toBeLessThan(3000)
})

// ----------------------------------------------------------------
// Property: the spans of a line inside a region are the parts a rename leaves; `editOutside` edits only the rest.

test('htmlRegionSpans gives the region parts of each line, and editOutside edits only the rest', () => {
  const lines = ['- [ ] #T1 a', '<!-- e.g. #T1 --> see #T1', 'x <pre>#T1</pre> #T1 <!--', '#T1 -->#T1']
  expect(htmlRegionSpans(lines)).toEqual([[], [[0, 17]], [[2, 16], [21, 25]], [[0, 7]]])
  const up = (part: string) => part.replace(/#T1/g, '#T9')
  expect(lines.map((line, at) => editOutside(line, htmlRegionSpans(lines)[at]!, up))).toEqual(['- [ ] #T9 a', '<!-- e.g. #T1 --> see #T9', 'x <pre>#T1</pre> #T9 <!--', '#T1 -->#T9'])
  // A window: only the part from `from` to `to` is edited.
  expect(editOutside('#T1 <!-- #T1 --> #T1 #T1', [[4, 16]], up, 1, 20)).toBe('#T1 <!-- #T1 --> #T9 #T1')
})
