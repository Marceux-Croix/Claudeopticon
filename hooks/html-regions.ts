/**
 * The example regions of a `.html` todo file as a browser reads them: an HTML comment (`<!--` to
 * `-->`), and a `<pre>`, `<script>`, `<style>` or `<textarea>` element (the CommonMark type 1 names) up
 * to its closing tag. They may start or end anywhere in a line. An HTML item or `<hN>` heading in one is
 * an example, never an item or a heading.
 *
 * Outside a region, a tag (`<` and a letter) is read to its `>` with its quoted values skipped, so a
 * `<!--` or `<pre` inside an attribute value (`title="use <!-- here"`) opens nothing. A tag
 * that does not end on its line takes the rest of the line; no tag state runs into the next line, so a
 * stray `<b` in prose never hides an opener on a later line.
 */

/** The elements whose content is raw text: an item in one is an example. */
const RAW_NAMES = new Set(['pre', 'script', 'style', 'textarea'])

/** The closing tag of each element, any case, its name ended by a space, `/`, `>` or the line end. */
const CLOSERS: Readonly<Record<string, RegExp>> = Object.fromEntries([...RAW_NAMES].map(name => [name, new RegExp(`</${name}(?=[\\s/>]|$)`, 'gi')]))

/** The state at a point of the text: outside, in a comment, or in the element of that name (lowercase). */
type State = { kind: 'none' } | { kind: 'comment' } | { kind: 'element'; name: string }

/** A span of a line, `from` to `to` (excluded), that is inside a region. */
export type RegionSpan = readonly [from: number, to: number]

const isLetter = (char: string | undefined): boolean => char !== undefined && ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z'))
const isNameChar = (char: string | undefined): boolean => char !== undefined && (isLetter(char) || (char >= '0' && char <= '9') || char === '-' || char === ':')

/**
 * The index after the `>` of the tag whose name ends at `at`, quoted values skipped; the line length when
 * the tag does not end on the line. Each character is read once.
 */
function tagEnd(line: string, at: number): number {
  for (let k = at; k < line.length; k += 1) {
    const char = line[k]!
    if (char === '>') {
      return k + 1
    }
    if (char === '"' || char === "'") {
      const close = line.indexOf(char, k + 1)
      if (close < 0) {
        return line.length
      }
      k = close
    }
  }

  return line.length
}

/**
 * The state after reading `line` from `state`; each span of the line inside a region goes to `spans`.
 * Linear: each search starts where the last one ended, and a tag is read once.
 */
function readLine(line: string, state: State, spans: [number, number][]): State {
  let at = 0
  let now = state
  // Where the region the line is in began: 0 for one open at the line start.
  let from = 0
  for (;;) {
    if (now.kind === 'comment') {
      const close = line.indexOf('-->', at)
      if (close < 0) {
        spans.push([from, line.length])

        return now
      }
      at = close + 3
      spans.push([from, at])
      now = { kind: 'none' }
      continue
    }
    if (now.kind === 'element') {
      const closer = CLOSERS[now.name]!
      closer.lastIndex = at
      const close = closer.exec(line)
      if (close === null) {
        spans.push([from, line.length])

        return now
      }
      // The closing tag is read to its `>`, so the span ends after it.
      at = tagEnd(line, close.index + close[0].length)
      spans.push([from, at])
      now = { kind: 'none' }
      continue
    }
    const open = line.indexOf('<', at)
    if (open < 0) {
      return now
    }
    if (line.startsWith('<!--', open)) {
      at = open + 4
      // `<!-->` and `<!--->` are whole, empty comments (HTML).
      if (line.startsWith('>', at) || line.startsWith('->', at)) {
        at += line.startsWith('>', at) ? 1 : 2
        spans.push([open, at])
        continue
      }
      from = open
      now = { kind: 'comment' }
      continue
    }
    if (!isLetter(line[open + 1])) {
      // `a < b`, `</li>`, `<!DOCTYPE`: no tag that holds a quoted value or opens a region.
      at = open + 1
      continue
    }
    let nameTo = open + 1
    while (isNameChar(line[nameTo])) {
      nameTo += 1
    }
    const name = line.slice(open + 1, nameTo).toLowerCase()
    const isBound = nameTo >= line.length || /[\s/>]/.test(line[nameTo]!)
    at = tagEnd(line, nameTo)
    if (RAW_NAMES.has(name) && isBound) {
      from = open
      now = { kind: 'element', name }
    }
  }
}

/** Per line: the spans inside a region (a comment or a raw element), in order. A line wholly inside one has the span of the whole line. */
export function htmlRegionSpans(lines: readonly string[]): RegionSpan[][] {
  let state: State = { kind: 'none' }

  return lines.map(line => {
    const spans: [number, number][] = []
    state = readLine(line, state, spans)

    return spans
  })
}

/**
 * Per line: true when the line starts inside a region, or a region is still open at its end. Such a line
 * is an example: an item in it is no item. A line that opens and closes a region (`<!-- note -->`) is no
 * example by itself.
 */
export function htmlRegionMask(lines: readonly string[]): boolean[] {
  let state: State = { kind: 'none' }

  return lines.map(line => {
    const isInside = state.kind !== 'none'
    state = readLine(line, state, [])

    return isInside || state.kind !== 'none'
  })
}

/**
 * The line with `edit` applied to each part between `from` and `to` that is outside the region spans of
 * the line (`spans`, from `htmlRegionSpans`); the spans and the rest of the line stay as written.
 */
export function editOutside(line: string, spans: readonly RegionSpan[], edit: (part: string) => string, from = 0, to = line.length): string {
  let out = line.slice(0, from)
  let at = from
  for (const [start, end] of spans) {
    if (end <= at || start >= to) {
      continue
    }
    const cut = Math.max(start, at)
    out += edit(line.slice(at, cut)) + line.slice(cut, Math.min(end, to))
    at = Math.min(end, to)
  }

  return out + edit(line.slice(at, to)) + line.slice(to)
}
