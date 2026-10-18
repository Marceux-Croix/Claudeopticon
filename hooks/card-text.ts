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

/**
 * An element key made safe for the engine (UCR-196): a `%` becomes `%25`, and each control
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

/** The length of `text` in code points. */
function glyphs(text: string): number {
  return text.length < 2 ? text.length : Array.from(text).length
}

export function esc(text: string): string {
  return cleanText(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Ends a single-line text with an ellipsis when it does not fit (TYP-3). */
export function fit(text: string, px: number, size: number, weight = 400, isMono = false): string {
  const glyph = size * (isMono ? 0.62 : weight >= 500 ? 0.55 : 0.52)
  const room = Math.max(1, Math.floor(px / glyph))

  return glyphs(text) > room ? `${cutText(text, Math.max(1, room - 1)).trimEnd()}…` : text
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
  for (const word of text.split(/\s+/).filter(one => one !== '')) {
    let rest = word
    while (glyphs(rest) > room) {
      if (line !== '') {
        lines.push(line)
        line = ''
      }
      const head = cutText(rest, room)
      lines.push(head)
      rest = rest.slice(head.length)
    }
    if (line === '') {
      line = rest
    } else if (glyphs(line) + 1 + glyphs(rest) <= room) {
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
  kept[maxLines - 1] = `${cutText(kept[maxLines - 1] ?? '', Math.max(1, room - 1)).trimEnd()}…`

  return kept
}
