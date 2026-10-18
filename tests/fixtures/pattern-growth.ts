/**
 * The linearity check for the secret patterns: each pattern is run on inputs built from its
 * own words, at a small size and at twice that size, and the ratio of the backtracking steps says
 * whether its work grows faster than the text: about 2 when linear, about 4 when quadratic.
 *
 * Loop 3 replaced the wall-clock ratio of loops 1 and 2. A time ratio failed both ways: under load a
 * pause that landed on the large run flagged linear patterns, and the quadratic mutant M-V-2 (bearer
 * `\s+["']?\s*`, 29.8 s on a 50k input) passed, as no input put a long run of spaces after its word.
 * The steps come from tests/fixtures/regex-steps.ts: a count that depends on the pattern and the text
 * only, so the same pattern gives the same answer on an idle machine and under 16 busy processes.
 */

import { stepCounter } from './regex-steps'

/** The shapes of the old fixed-budget test, kept for every pattern: each makes one unbounded quantifier backtrack. */
export const SHAPES: readonly string[] = ['a-', 'a.', 'mysql ', 'sshpass ', 'docker login ', 'https://a', 'a://b:', '-u a', '--a-', 'a_', 'x-a-', 'eyJ-', 'a', ' ']

/**
 * The heads of the two-token inputs: a head once, then a long run of one unit. A pattern can be
 * quadratic only after a fixed start (`a://` then `x:` many times: verifier HI's mutant M-HI-1;
 * `authorization: bearer` then spaces: R6's M-V-2), and a run of one repeated unit never holds that
 * start once with a long run after it.
 */
export const HEADS: readonly string[] = ['a://', 'https://', 'a://b:', 'curl -u ', 'docker login ', 'sudo ', 'echo a | ', 'machine a ', 'net use ', '-----BEGIN ']

/** The units a head is followed by. A space and a tab: a run of white space after a word (M-V-2). */
export const RUNS: readonly string[] = ['x:', 'x', 'x ', 'a-', ':', '/', '@', ' ', '\t']

/**
 * The runs of a digit, of each quote and of every other ASCII punctuation character (batch M, final-v1 M-D
 * and M-Q): a pattern quadratic on a run of digits (`--pin\s?\d+\d*`) or of quotes (`password=["']*["']*`)
 * passed the gate, as no input had such a run after the pattern's own start. Each comes after a head and
 * before TAIL, so the match fails at the run's end.
 */
export const EXTRA_RUNS: readonly string[] = ['1', ' ', ...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~']

/** The character after an extra run: no value of a secret form takes it, so the match fails there and a backtracking pattern tries each split of the run. */
export const TAIL = '\u0001'

/** How a word of a pattern starts a head before an extra run: as a word, a value name (`password=`) or a flag (`--pin `, `-p `). */
const WORD_HEADS: readonly ((word: string) => string)[] = [word => `${word} `, word => `${word}=`, word => `${word}:`, word => `--${word} `, word => `-${word} `]

/** How a word pair of a pattern is joined into one head: `authorization: bearer`, `token=x`. */
const PAIR_JOINS: readonly string[] = [' ', ': ', '=']

/** How many of a pattern's first words make its own heads, alone and in pairs. */
const HEAD_WORDS = 6

/**
 * The sizes the check compares. Twice the text gives about twice the steps when linear, four times
 * when quadratic. SMALL is five times the longest bounded run of any pattern (300), so the runs cut
 * short at the end of the text change the ratio by under a tenth.
 */
export const SMALL = 1_500
export const LARGE = 3_000

/** The step ratio at or over which a pattern counts as faster than linear: the real patterns give at most 2.2, a quadratic one about 4. */
export const RATIO_MAX = 3

/**
 * The literal words of a pattern: its start words and tool names. Taken from its source with the
 * escapes, character classes and counts taken out, so a pattern added later brings its own words.
 */
export function wordsOf(re: RegExp): string[] {
  const bare = re.source.replace(/\\./g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ')

  return [...new Set(bare.match(/[A-Za-z][A-Za-z0-9_-]{1,}/g) ?? [])]
}

/** One input: `head` once, then `unit` repeated to the size, then `tail` (none for most). Most inputs have no head. */
export type Input = { head: string; unit: string; tail?: string }

/**
 * The repeated units for one pattern: per word, the word repeated alone and with each separator a
 * secret form puts after it; the pairs and triples of words in their order, for a tool of more than
 * one word (`docker login`, `gh secret set`); and SHAPES.
 */
export function unitsOf(re: RegExp): string[] {
  const words = wordsOf(re)
  const units = new Set<string>(SHAPES)
  for (const word of words) {
    for (const unit of [word, `${word} `, `${word}-`, `${word}_`, `${word}=`, `${word}:`]) {
      units.add(unit)
    }
  }
  for (let i = 0; i + 1 < words.length; i++) {
    units.add(`${words[i]} ${words[i + 1]} `)
    if (i + 2 < words.length) {
      units.add(`${words[i]} ${words[i + 1]} ${words[i + 2]} `)
    }
  }

  return [...units]
}

/** The heads of one pattern: HEADS, each of its first words with a space, and each pair of them in order, joined as a secret form joins them. */
export function headsOf(re: RegExp): string[] {
  const words = wordsOf(re).slice(0, HEAD_WORDS)
  const pairs = words.slice(1).flatMap((word, i) => PAIR_JOINS.map(join => `${words[i]}${join}${word}`))

  return [...new Set([...HEADS, ...words.map(word => `${word} `), ...pairs])]
}

/**
 * Every input for one pattern: its repeated units, then each head before each of RUNS, then each extra
 * run alone and after HEADS and the pattern's own word heads (`password=`, `--pin `), each before TAIL.
 */
export function inputsOf(re: RegExp): Input[] {
  const wordHeads = wordsOf(re)
    .slice(0, HEAD_WORDS)
    .flatMap(word => WORD_HEADS.map(make => make(word)))
  const extraHeads = [...new Set(['', ...HEADS, ...wordHeads])]

  return [
    ...unitsOf(re).map(unit => ({ head: '', unit })),
    ...headsOf(re).flatMap(head => RUNS.map(unit => ({ head, unit }))),
    ...extraHeads.flatMap(head => EXTRA_RUNS.map(unit => ({ head, unit, tail: TAIL }))),
  ]
}

/** `unit` repeated to exactly `size` characters. */
export const repeatTo = (unit: string, size: number): string => unit.repeat(Math.ceil(size / unit.length)).slice(0, size)

/** The text of one input at `size` characters. */
export const textOf = (input: Input, size: number): string => input.head + repeatTo(input.unit, size - input.head.length) + (input.tail ?? '')

/** steps(large) / steps(small) for one pattern on one input: the same number on every run and every load. */
export function stepRatio(re: RegExp, input: Input, small = SMALL, large = LARGE): number {
  const count = stepCounter(re)

  return count(textOf(input, large)).steps / count(textOf(input, small)).steps
}

/**
 * The pattern and input pairs whose steps grow faster than linear (RATIO_MAX or more), as
 * `<source start> on <head> + <unit>`. `isFirstOnly` stops at the first: a test that only needs to
 * see a quadratic pattern caught.
 */
export function superlinear(patterns: readonly RegExp[], small = SMALL, large = LARGE, isFirstOnly = false): string[] {
  const out: string[] = []
  for (const re of patterns) {
    const count = stepCounter(re)
    for (const input of inputsOf(re)) {
      if (count(textOf(input, large)).steps / count(textOf(input, small)).steps >= RATIO_MAX) {
        out.push(`${re.source.slice(0, 50)} on ${JSON.stringify(input.head)} + ${JSON.stringify(input.unit)}${input.tail === undefined ? '' : ` + ${JSON.stringify(input.tail)}`}`)
        if (isFirstOnly) {
          return out
        }
      }
    }
  }

  return out
}
