import { expect, test } from 'claude-code/testing'

import { decodeEntities, HTML_BOX_TAGS, HTML_HEADING, htmlItem, looksLikeHtmlCheckbox, withHtmlBox } from '../hooks/html-items'

// ----------------------------------------------------------------
// Property: an HTML item line is read in each decided form, gives its box, text and parts, and a box change
// rewrites only the input tag, to the canonical form; a form not read is no item.

test('htmlItem reads each box state from the input tag', () => {
  expect(htmlItem('<li><input type="checkbox"> a</li>')?.box).toBe(' ')
  expect(htmlItem('<li><input type="checkbox" checked> a</li>')?.box).toBe('x')
  expect(htmlItem('<li><input type="checkbox" data-state="queued"> a</li>')?.box).toBe('>')
  expect(htmlItem('<li><input type="checkbox" data-state="in-progress"> a</li>')?.box).toBe('~')
  // `checked` with a data-state is done.
  expect(htmlItem('<li><input type="checkbox" data-state="queued" checked> a</li>')?.box).toBe('x')
  expect(htmlItem('<li><input checked data-state="in-progress" type="checkbox"> a</li>')?.box).toBe('x')
})

test('htmlItem reads every attribute form: any case, either quote, any order, the checked forms, /> or >', () => {
  for (const line of [
    '<li><input type="checkbox" checked> a</li>',
    '<LI><INPUT TYPE="CHECKBOX" CHECKED> a</LI>',
    "<li><input type='checkbox' checked=''> a</li>",
    '<li><input checked="checked" type="checkbox"> a</li>',
    '<li><input type="checkbox" checked /> a</li>',
    '<li><input type="checkbox" checked/> a</li>',
    '<li><input\ttype="checkbox"  checked = "" > a</li>',
    '<li> <input type="checkbox" checked> a</li>',
    '<li><input type="checkbox" id="x" class="y" disabled checked> a</li>',
  ]) {
    expect([line, htmlItem(line)?.box, htmlItem(line)?.text]).toEqual([line, 'x', 'a'])
  }
  expect(htmlItem("<li><input type='checkbox' data-state='Queued'> a</li>")?.box).toBe('>')
})

test('htmlItem splits head, text and tail, and the tail keeps its spaces and a carriage return', () => {
  const line = '    <li><input type="checkbox">  #T0001 Fix &amp; ship</li>  \r'
  const item = htmlItem(line)!
  expect(item.head).toBe('    <li><input type="checkbox">  ')
  expect(item.text).toBe('#T0001 Fix &amp; ship')
  expect(item.tail).toBe('</li>  \r')
  expect(item.head + item.text + item.tail).toBe(line)
  expect(line.slice(item.tagFrom, item.tagTo)).toBe('<input type="checkbox">')
  // An empty text is an item with an empty text, as `- [ ] ` is.
  expect(htmlItem('<li><input type="checkbox"></li>')?.text).toBe('')
  // A `</li>` inside the text is a second item on the line, so the line is no item.
  expect(htmlItem('<li><input type="checkbox"> a</li>b</li>')).toBeUndefined()
})

test('htmlItem refuses every form it does not read: the mod never writes a line it may misread', () => {
  for (const line of [
    '<li>no input</li>',
    '<li><input type="radio"> a</li>',
    '<li><input> a</li>',
    '<li><input type=checkbox> a</li>',
    '<li><input type="checkbox" checked="no"> a</li>',
    '<li><input type="checkbox" data-state="blocked"> a</li>',
    '<li><input type="checkbox" data-state> a</li>',
    '<li><input type="checkbox" type="checkbox"> a</li>',
    '<li><input type="checkbox"a> a</li>',
    '<li><input type="checkbox" a',
    '<li><input type="checkbox"> a',
    '<li><input type="checkbox"> a</ul>',
    '<li class="x"><input type="checkbox"> a</li>',
    '<li><inputs type="checkbox"> a</li>',
    'x <li><input type="checkbox"> a</li>',
    '- [ ] markdown',
    '',
  ]) {
    expect([line, htmlItem(line)]).toEqual([line, undefined])
  }
})

test('withHtmlBox writes the canonical tag for each box and keeps every other byte', () => {
  const line = '  <LI> <INPUT checked="checked" TYPE=\'checkbox\' /> #T0002 a &lt;b&gt;</LI> \r'
  const item = htmlItem(line)!
  for (const box of [' ', '>', '~', 'x'] as const) {
    const next = withHtmlBox(line, item, box)
    // The `/>` close stays, with its space.
    expect(next).toBe(`  <LI> ${HTML_BOX_TAGS[box].slice(0, -1)} /> #T0002 a &lt;b&gt;</LI> \r`)
    expect(htmlItem(next)?.box).toBe(box)
  }
  expect(HTML_BOX_TAGS).toEqual({ ' ': '<input type="checkbox">', '>': '<input type="checkbox" data-state="queued">', '~': '<input type="checkbox" data-state="in-progress">', x: '<input type="checkbox" checked>' })
})

// Property: a box change keeps the tag's other attributes and their values; only the box attributes change.
test('withHtmlBox keeps the other attributes of the tag, in order, for each box', () => {
  const line = '<li><input id="t1" type="checkbox" class=\'a "b"\' data-state="queued" disabled> #T0002 a</li>'
  const item = htmlItem(line)!
  expect(item.box).toBe('>')
  const want = {
    ' ': '<input type="checkbox" id="t1" class=\'a "b"\' disabled>',
    '>': '<input type="checkbox" data-state="queued" id="t1" class=\'a "b"\' disabled>',
    '~': '<input type="checkbox" data-state="in-progress" id="t1" class=\'a "b"\' disabled>',
    x: '<input type="checkbox" checked id="t1" class=\'a "b"\' disabled>',
  } as const
  for (const box of [' ', '>', '~', 'x'] as const) {
    const next = withHtmlBox(line, item, box)
    expect(next).toBe(`<li>${want[box]} #T0002 a</li>`)
    // Read back: the same box, and a second change from the written line keeps the attributes again.
    const again = htmlItem(next)!
    expect(again.box).toBe(box)
    expect(withHtmlBox(next, again, '>')).toBe(`<li>${want['>']} #T0002 a</li>`)
  }
})

test('decodeEntities decodes the five entities in one pass and leaves the rest', () => {
  expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;')).toBe('a & b <c> "d" \'e\'')
  expect(decodeEntities('&amp;lt; &nbsp; &#x27;')).toBe('&lt; &nbsp; &#x27;')
})

test('HTML_HEADING reads one-line <h1> to <h6> with their level, and no other line', () => {
  expect(HTML_HEADING.exec('<h2>Core</h2>')?.[1]).toBe('2')
  expect(HTML_HEADING.exec('  <H3 class="x">Docs</H3> ')?.[1]).toBe('3')
  for (const line of ['<h2>Core</h3>', '<h7>x</h7>', '<h2>open', '<header>x</header>', 'x <h2>a</h2>']) {
    expect([line, HTML_HEADING.test(line)]).toEqual([line, false])
  }
})

test('looksLikeHtmlCheckbox finds an input of type checkbox that is no item, and reads a long line once', () => {
  expect(looksLikeHtmlCheckbox('<li><input type="checkbox" checked> a')).toBe(true)
  expect(looksLikeHtmlCheckbox('<INPUT TYPE=CHECKBOX>')).toBe(true)
  expect(looksLikeHtmlCheckbox('a checkbox <inp type=checkbox')).toBe(false)
  const start = Date.now()
  expect(looksLikeHtmlCheckbox('<inpu type=checkbox'.repeat(100_000))).toBe(false)
  expect(htmlItem(`<li><input type="checkbox"> ${'a '.repeat(500_000)}`)).toBeUndefined()
  expect(htmlItem(`<li><input ${'a '.repeat(500_000)}>x</li>`)).toBeUndefined()
  expect(Date.now() - start).toBeLessThan(3000)
})

// ----------------------------------------------------------------
// Property: a line whose text holds another `<li`, `</li>` or `<input` (any case) is two items on one line: no item,
// and it looks like a checkbox, so the archive counts it open.

test('htmlItem refuses a line with two list items, and the line looks like a checkbox', () => {
  const two = '<li><input type="checkbox" checked> #T0001 a</li><li><input type="checkbox"> #T0002 still open</li>'
  expect(htmlItem(two)).toBeUndefined()
  for (const text of ['a <LI> b', 'a </Li> b', 'a <INPUT> b', 'a <li class="x"> b']) {
    const line = `<li><input type="checkbox"> ${text}</li>`
    expect([line, htmlItem(line)]).toEqual([line, undefined])
    expect(looksLikeHtmlCheckbox(line)).toBe(true)
  }
  // Text that only names a tag with entities is still one item.
  expect(htmlItem('<li><input type="checkbox"> write &lt;li&gt; and &lt;input&gt;</li>')?.text).toBe('write &lt;li&gt; and &lt;input&gt;')
})

// ----------------------------------------------------------------
// Property: a line that holds `<input`, or `type="checkbox"` (the rest of a tag split over lines), looks like a checkbox.

test('looksLikeHtmlCheckbox takes any <input and the type="checkbox" of a split tag', () => {
  for (const line of ['    <li><input', '        type="checkbox"> #T0002 open sub</li>', "TYPE = 'CHECKBOX' >", '<INPUT type="text">']) {
    expect([line, looksLikeHtmlCheckbox(line)]).toEqual([line, true])
  }
  for (const line of ['type=checkbox', 'a checkbox', '<inp', 'type="checkboxes"']) {
    expect([line, looksLikeHtmlCheckbox(line)]).toEqual([line, false])
  }
})

// ----------------------------------------------------------------
// Property: a box change keeps each kept attribute name as written and a `/>` end; names compare in lower case only.

test('withHtmlBox keeps the spelling of kept attribute names and a /> end', () => {
  const odd = '<li><INPUT TYPE="checkbox" ID="a" data-Foo=\'x"y\' disabled /> #T0004 t</li>'
  const item = htmlItem(odd)!
  expect(withHtmlBox(odd, item, '>')).toBe('<li><input type="checkbox" data-state="queued" ID="a" data-Foo=\'x"y\' disabled /> #T0004 t</li>')
  // A `/>` with no space before it stays as it is; a `>` tag stays `>`.
  const tight = '<li><input type="checkbox"/> a</li>'
  expect(withHtmlBox(tight, htmlItem(tight)!, 'x')).toBe('<li><input type="checkbox" checked/> a</li>')
  const plain = '<li><input Class="k" type="checkbox" CHECKED> a</li>'
  expect(withHtmlBox(plain, htmlItem(plain)!, ' ')).toBe('<li><input type="checkbox" Class="k"> a</li>')
  // The written line reads back with the same box, and another change keeps the names again.
  const next = withHtmlBox(odd, item, 'x')
  expect(htmlItem(next)?.box).toBe('x')
  expect(withHtmlBox(next, htmlItem(next)!, '>')).toBe(withHtmlBox(odd, item, '>'))
})
