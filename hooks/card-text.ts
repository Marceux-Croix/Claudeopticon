/** Card text: XML-safe characters, alt text, escaping, cutting, fitting a line and wrapping lines. */

/** XML 1.0 forbids these: C0 controls but tab, LF and CR, U+FFFE and U+FFFF, and a surrogate with no partner. */
const BAD_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** The text without the characters an XML document cannot hold. */
export function cleanText(text: string): string {
  return text.replace(BAD_XML, '')
}

/**
 * Every control character (C0, DEL and C1: \x00-\x1F and \x7F-\x9F, tab and line breaks too) and
 * every lone surrogate. The engine refuses a whole pane whose Svg alt holds a control character.
 */
const BAD_ALT = /[\x00-\x1F\x7F-\x9F]+|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * The text with no character the engine refuses in a pane's text: each run of control characters
 * becomes one space (a line break or tab parts words) and a lone surrogate goes. Spaces the text
 * already had stay, so a terminal line keeps its indent.
 */
export function controlFree(text: string): string {
  return text.replace(BAD_ALT, match => (/^[\uD800-\uDFFF]$/.test(match) ? '' : ' '))
}

/** Characters that print nothing but reorder or hide text: bidi controls, word joiners, the byte order mark and tag characters. */
const HIDDEN_FORMAT = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|\uDB40[\uDC00-\uDC7F]/g

/**
 * Text for a toast: controlFree, and without the format characters that reorder a name or hide
 * text in it (a right-to-left override, a zero-width space, tag characters), since a toast prints
 * a file, folder or ticket name as it is.
 */
export function toastText(text: string): string {
  return controlFree(text).replace(HIDDEN_FORMAT, '')
}

/**
 * An element key made safe for the engine: a `%` becomes `%25`, and each control
 * character or lone surrogate becomes `%` and its code in hex (`%1B`, `%D800`). It is an encoding,
 * not a strip, so two names that differ only by such a character keep two keys. Every key that
 * holds user text (a file name, a ticket key, a category) goes through it, on both surfaces.
 */
export function keyText(text: string): string {
  const hex = (unit: number) => `%${unit.toString(16).toUpperCase().padStart(2, '0')}`

  return text.replace(/%/g, '%25').replace(BAD_ALT, run => Array.from({ length: run.length }, (_, i) => hex(run.charCodeAt(i))).join(''))
}

/** A card's alt text as the engine takes it: controlFree, runs of spaces made one, and the ends trimmed. */
export function altText(text: string): string {
  return controlFree(text).replace(/ {2,}/g, ' ').trim()
}

/** At most `n` UTF-16 units of `text`, one fewer when the cut would split a surrogate pair. */
export function cutUnits(text: string, n: number): string {
  if (text.length <= n) {
    return text
  }
  const end = Math.max(0, n)
  const last = text.charCodeAt(end - 1)

  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end)
}

/** The first `n` code points of `text`: a cut never splits a surrogate pair. */
export function cutText(text: string, n: number): string {
  if (text.length <= n) {
    return text
  }

  return Array.from(text).slice(0, Math.max(0, n)).join('')
}

/**
 * The width of one code point in cells: 2 for East Asian wide characters and emoji (about 1 em),
 * else 1 (about 0.52 em). A line sized by cells does not overflow on a CJK or emoji text.
 */
function cellsOf(point: string): number {
  const code = point.codePointAt(0) ?? 0

  return code < 0x1100 ? 1 : isWide(code) ? 2 : 1
}

function isWide(code: number): boolean {
  return (
    code <= 0x115f ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

/** The width of `text` in cells. */
function cells(text: string): number {
  let total = 0
  for (const point of text) {
    total += cellsOf(point)
  }

  return total
}

/** The longest start of `text` that is at most `n` cells wide; a cut never splits a surrogate pair. */
function cutCells(text: string, n: number): string {
  let used = 0
  let end = 0
  for (const point of text) {
    used += cellsOf(point)
    if (used > n) {
      break
    }
    end += point.length
  }

  return text.slice(0, end)
}

export function esc(text: string): string {
  return cleanText(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Ends a single-line text with an ellipsis when it does not fit (TYP-3). */
export function fit(text: string, px: number, size: number, weight = 400, isMono = false): string {
  const glyph = size * (isMono ? 0.62 : weight >= 500 ? 0.55 : 0.52)
  const room = Math.max(1, Math.floor(px / glyph))

  return cells(text) > room ? `${cutCells(text, Math.max(1, room - 1)).trimEnd()}…` : text
}
export const MAX_LINES = 8

/**
 * Breaks a text into lines that fit `px` at `size`, at spaces where it can and inside a long word
 * where it must; past `maxLines` the last line ends with an ellipsis (TYP-3: long free text wraps).
 */
export function wrap(text: string, px: number, size: number, weight = 400, maxLines = MAX_LINES): string[] {
  const room = Math.max(8, Math.floor(px / (size * (weight >= 500 ? 0.55 : 0.52))))
  const lines: string[] = []
  let line = ''
  // Every pass is linear in the text: a long word is cut once, in one scan, and the walk ends as
  // soon as one line more than `maxLines` exists, since only the first `maxLines` are kept.
  for (const word of text.split(/\s+/)) {
    if (word === '') {
      continue
    }
    if (lines.length > maxLines) {
      break
    }
    let rest = word
    if (cells(word) > room) {
      let used = 0
      let start = 0
      let at = 0
      const chunks: string[] = []
      for (const point of word) {
        const width = cellsOf(point)
        if (used + width > room) {
          chunks.push(word.slice(start, at))
          start = at
          used = 0
          if (lines.length + chunks.length > maxLines + 1) {
            break
          }
        }
        used += width
        at += point.length
      }
      chunks.push(word.slice(start, at))
      rest = chunks.pop() ?? ''
      if (line !== '') {
        lines.push(line)
        line = ''
      }
      lines.push(...chunks)
    }
    if (line === '') {
      line = rest
    } else if (cells(line) + 1 + cells(rest) <= room) {
      line = `${line} ${rest}`
    } else {
      lines.push(line)
      line = rest
    }
  }
  if (line !== '' || lines.length === 0) {
    lines.push(line)
  }
  if (lines.length <= maxLines) {
    return lines
  }
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = `${cutCells(kept[maxLines - 1] ?? '', Math.max(1, room - 1)).trimEnd()}…`

  return kept
}
