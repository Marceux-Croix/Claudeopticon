/**
 * The code points the note fuzz (UCR-181) puts into ticket text, names and agent rows: every code point of
 * the Unicode classes Zl, Zp, Cc and Cf, from U+0000 to U+10FFFF, as the JavaScript engine's own Unicode
 * tables give them. And the counter of raw line terminators in a text: what a reader may take for a line
 * break, which would start a line of its own outside the note's quotes.
 */

/** Every code point of the classes Zl (line separator), Zp (paragraph separator), Cc (control) and Cf (format). */
export const FUZZ_CODE_POINTS: readonly number[] = (() => {
  const isFuzzed = /^[\p{Zl}\p{Zp}\p{Cc}\p{Cf}]$/u
  const out: number[] = []
  for (let cp = 0; cp <= 0x10ffff; cp += 1) {
    // The surrogate range holds no code point of these classes, and a lone surrogate is no string to test.
    if (cp >= 0xd800 && cp <= 0xdfff) {
      continue
    }
    if (isFuzzed.test(String.fromCodePoint(cp))) {
      out.push(cp)
    }
  }

  return out
})()

/** The Unicode line terminators (UAX 14 mandatory breaks): LF, VT, FF, CR, NEL, U+2028 and U+2029. */
const RAW_BREAKS = /[\n\v\f\r\u0085\u2028\u2029]/g

/** How many raw line terminators the text holds. */
export const rawBreaks = (text: string | undefined): number => (text ?? '').match(RAW_BREAKS)?.length ?? 0
