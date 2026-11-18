/**
 * The HTML checkbox item line grammar of a `.html` todo file: one item is one line, an optional indent,
 * `<li>`, an `<input type="checkbox" ...>` tag, the item text, `</li>`, optional spaces. The box is in the
 * tag: `checked` done (`x`), `data-state="queued"` queued (`>`), `data-state="in-progress"` in progress
 * (`~`), none open (` `). A box change rewrites only the tag, to one canonical form (`HTML_BOX_TAGS`), keeping
 * the tag's other attributes.
 *
 * Parsed by hand, not by one regular expression: each part is read once, left to right, so a line of
 * 1 MB costs one pass (the rule). A tag that is not one of the forms read here (an unquoted
 * value, a doubled attribute, a `checked="no"`, an unknown `data-state`) makes the line no item: the mod
 * never writes a line it may have misread.
 */

/** The box characters of the todo grammar: open, done, in progress, queued. */
export type HtmlBox = ' ' | 'x' | '~' | '>'

/** The one tag a box change writes, per box. Every other byte of the line stays. */
export const HTML_BOX_TAGS: Readonly<Record<HtmlBox, string>> = {
  ' ': '<input type="checkbox">',
  '>': '<input type="checkbox" data-state="queued">',
  '~': '<input type="checkbox" data-state="in-progress">',
  x: '<input type="checkbox" checked>',
}

/**
 * One HTML item line, split: `head` is the line up to the text (indent, `<li>`, the tag and the spaces
 * after it), `text` the item text as written (entities not decoded), `tail` the `</li>` and what follows.
 * `tagFrom` and `tagTo` place the input tag in the line, for the box rewrite.
 */
export interface HtmlItem {
  box: HtmlBox
  head: string
  text: string
  tail: string
  tagFrom: number
  tagTo: number
}

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\t'
/** White space inside a tag, as HTML reads it. */
const isTagSpace = (char: string | undefined): boolean => char === ' ' || char === '\t' || char === '\n' || char === '\f' || char === '\r'

/**
 * The attributes of the tag that starts at `from` (`<input`), by lower-case name, with each name as written
 * (`raw`), the index after its `>`, and its close as written (`>`, or `/>` with the spaces before it); undefined
 * for any form this grammar does not read.
 */
function readInputTag(line: string, from: number): { attrs: Map<string, string | true>; raw: Map<string, string>; end: number; close: string } | undefined {
  if (line.slice(from, from + 6).toLowerCase() !== '<input') {
    return undefined
  }
  let at = from + 6
  // The name ends here: `<inputs>` is another tag.
  if (!(isTagSpace(line[at]) || line[at] === '>' || line[at] === '/')) {
    return undefined
  }
  const attrs = new Map<string, string | true>()
  const raw = new Map<string, string>()
  for (;;) {
    const spaceFrom = at
    while (isTagSpace(line[at])) {
      at += 1
    }
    if (line[at] === '>') {
      return { attrs, raw, end: at + 1, close: '>' }
    }
    if (line[at] === '/' && line[at + 1] === '>') {
      return { attrs, raw, end: at + 2, close: line.slice(spaceFrom, at + 2) }
    }
    const nameFrom = at
    while (at < line.length && !isTagSpace(line[at]) && !'"\'>/=<'.includes(line[at]!)) {
      at += 1
    }
    if (at === nameFrom) {
      return undefined
    }
    const name = line.slice(nameFrom, at).toLowerCase()
    if (attrs.has(name)) {
      return undefined
    }
    raw.set(name, line.slice(nameFrom, at))
    let probe = at
    while (isTagSpace(line[probe])) {
      probe += 1
    }
    if (line[probe] !== '=') {
      attrs.set(name, true)
      continue
    }
    probe += 1
    while (isTagSpace(line[probe])) {
      probe += 1
    }
    const quote = line[probe]
    if (quote !== '"' && quote !== "'") {
      return undefined
    }
    const close = line.indexOf(quote, probe + 1)
    if (close < 0) {
      return undefined
    }
    attrs.set(name, line.slice(probe + 1, close))
    at = close + 1
    // An attribute must end at a space or the tag end: `a="1"b` is no form read here.
    if (!(isTagSpace(line[at]) || line[at] === '>' || line[at] === '/')) {
      return undefined
    }
  }
}

/** The box the attributes give, or undefined when they are no checkbox of a form read here. `checked` wins over a data-state. */
function boxOf(attrs: ReadonlyMap<string, string | true>): HtmlBox | undefined {
  const type = attrs.get('type')
  if (typeof type !== 'string' || type.toLowerCase() !== 'checkbox') {
    return undefined
  }
  const checked = attrs.get('checked')
  if (checked !== undefined && checked !== true && checked !== '' && checked.toLowerCase() !== 'checked') {
    return undefined
  }
  const state = attrs.get('data-state')
  if (state !== undefined && (state === true || !['queued', 'in-progress'].includes(state.toLowerCase()))) {
    return undefined
  }
  if (checked !== undefined) {
    return 'x'
  }
  if (state === undefined) {
    return ' '
  }

  return state.toLowerCase() === 'queued' ? '>' : '~'
}

/** The line as an HTML item, or undefined when it is none. `line` is without its line end; a trailing `\r` is part of the tail. */
export function htmlItem(line: string): HtmlItem | undefined {
  let at = 0
  while (isSpace(line[at])) {
    at += 1
  }
  if (line.slice(at, at + 4).toLowerCase() !== '<li>') {
    return undefined
  }
  at += 4
  // Spaces between `<li>` and the tag are read too (a choice: the decided form has none, and a writer adds them often).
  while (isSpace(line[at])) {
    at += 1
  }
  const tagFrom = at
  const tag = readInputTag(line, tagFrom)
  const box = tag === undefined ? undefined : boxOf(tag.attrs)
  if (tag === undefined || box === undefined) {
    return undefined
  }
  let textFrom = tag.end
  while (isSpace(line[textFrom])) {
    textFrom += 1
  }
  let end = line.length
  while (end > textFrom && (isSpace(line[end - 1]) || line[end - 1] === '\r')) {
    end -= 1
  }
  if (end - 5 < textFrom || line.slice(end - 5, end).toLowerCase() !== '</li>') {
    return undefined
  }
  // A text that holds another list item or input (`a</li><li><input ...> b`) is two items on one line: the line is
  // no item, so a done first box never moves an open second one. It then counts open (`looksLikeHtmlCheckbox`).
  const lowerText = line.slice(textFrom, end - 5).toLowerCase()
  if (lowerText.includes('<li') || lowerText.includes('</li>') || lowerText.includes('<input')) {
    return undefined
  }

  return { box, head: line.slice(0, textFrom), text: line.slice(textFrom, end - 5), tail: line.slice(end - 5), tagFrom, tagTo: tag.end }
}

/** The attributes a box change writes itself: every other attribute of the tag is kept. */
const BOX_ATTRS = new Set(['type', 'checked', 'data-state'])

/** One kept attribute as written back: its name, and its value in double quotes, or single quotes when it holds a `"`. */
const attrText = (name: string, value: string | true): string => (value === true ? name : value.includes('"') ? `${name}='${value}'` : `${name}="${value}"`)

/**
 * The line with the item's tag rewritten to the canonical tag of `box`; every other byte of the line stays.
 * The tag's other attributes (`id`, `class`, `disabled`) are kept, in their order, after the box attributes,
 * so a box change never drops what a writer put on the tag. A kept name keeps its spelling (`ID`,
 * `data-Foo`; names compare in lower case only), and a `/>` close stays, with the spaces before it.
 * A `>` tag with no other attribute is exactly `HTML_BOX_TAGS[box]`.
 */
export function withHtmlBox(line: string, item: HtmlItem, box: HtmlBox): string {
  const tag = readInputTag(line, item.tagFrom)
  const kept = tag === undefined ? [] : [...tag.attrs].filter(([name]) => !BOX_ATTRS.has(name)).map(([name, value]): [string, string | true] => [tag.raw.get(name) ?? name, value])
  const canonical = HTML_BOX_TAGS[box]
  const written = `${canonical.slice(0, -1)}${kept.map(([name, value]) => ` ${attrText(name, value)}`).join('')}${tag?.close ?? '>'}`

  return `${line.slice(0, item.tagFrom)}${written}${line.slice(item.tagTo)}`
}

const ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

/** The text with the five entities `&amp; &lt; &gt; &quot; &#39;` decoded, in one pass (so `&amp;lt;` is `&lt;`); any other stays. */
export const decodeEntities = (text: string): string => text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ENTITIES[entity]!)

/** An HTML heading line, `<h1>` to `<h6>` on one line (the open tag may hold attributes). Group 1 is the level. */
export const HTML_HEADING = /^[ \t]*<[hH]([1-6])(?:[ \t][^<>]*)?>.*<\/[hH]\1[ \t]*>[ \t]*$/

/** `type="checkbox"` (either quote, any case, spaces around `=`): the later line of an `<input` tag split over lines. */
const CHECKBOX_TYPE = /type\s*=\s*["']checkbox["']/i

/**
 * True for a line that may be, or be part of, an HTML checkbox: it holds `<input` (any case), or
 * `type="checkbox"` (the later line of a tag split over lines). A line that fails `htmlItem` but passes this
 * counts as open in the archive, so a box the mod cannot read always holds its block back.
 */
export function looksLikeHtmlCheckbox(line: string): boolean {
  return line.toLowerCase().includes('<input') || CHECKBOX_TYPE.test(line)
}
