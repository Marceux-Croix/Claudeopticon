/**
 * The backtracking step count of a regular expression on a text: a small backtracking
 * matcher for the JavaScript syntax the secret patterns use, which counts each character test, each
 * assertion and each place a quantifier tries its continuation from. The count is a property of the
 * pattern and the text only, so no load on the machine can change it, where a time ratio moves with
 * every pause of the scheduler or the collector.
 *
 * It models what a backtracking engine (V8's irregexp, JavaScriptCore's YARR) does: try each start
 * position, take each quantifier greedily (or lazily) and give back one at a time. Those engines add
 * fast paths (a first-character scan, a literal prefix search) that cut the constant, never the
 * order of growth, so a count that grows quadratically here is the backtracking that makes a real
 * engine quadratic. Supported: groups, `(?:`, lookahead and lookbehind, alternation, classes with
 * ranges and escapes, `\s \S \w \W \d \D \b \B`, `^ $`, `.`, `* + ? {n} {n,} {n,m}` and their lazy
 * forms, and the flags `i`, `g` and `y` (`test` from index 0 is the same for them). A back reference,
 * or the `m`, `s`, `u` or `v` flag, throws: no secret pattern uses one, and a pattern that did would
 * need this file to learn it first.
 */

/** A matcher: from `pos`, call `k` with each end it can reach in turn; true as soon as `k` is. */
type Matcher = (pos: number, k: (end: number) => boolean) => boolean

/** One node of the parsed pattern. */
type Node =
  | { kind: 'char'; test: (code: number) => boolean }
  | { kind: 'alt'; options: Node[][] }
  | { kind: 'look'; body: Node; isBehind: boolean; isNegated: boolean }
  | { kind: 'start' | 'end' | 'boundary' | 'notBoundary' }
  | { kind: 'repeat'; body: Node; min: number; max: number; isLazy: boolean }

const isWordCode = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
const isDigitCode = (c: number): boolean => c >= 48 && c <= 57
/** JavaScript's `\s`: the white space and line terminator characters. */
const isSpaceCode = (c: number): boolean =>
  (c >= 9 && c <= 13) || c === 32 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
const isLineEnd = (c: number): boolean => c === 10 || c === 13 || c === 0x2028 || c === 0x2029

/** The set escapes: `\d`, `\w`, `\s` and their complements. */
const SETS: Record<string, (code: number) => boolean> = {
  d: isDigitCode,
  D: c => !isDigitCode(c),
  w: isWordCode,
  W: c => !isWordCode(c),
  s: isSpaceCode,
  S: c => !isSpaceCode(c),
}

/** The one-character escapes by letter. */
const NAMED: Record<string, number> = { n: 10, r: 13, t: 9, f: 12, v: 11, '0': 0 }

const literal = (code: number) => (c: number) => c === code

/** The continuation that takes any end: a lookahead's, a single test's. */
const isAny = (): boolean => true

/** The parser: one pass over the source, by recursive descent. */
class Parser {
  private at = 0
  private readonly source: string
  private readonly isCaseBlind: boolean

  constructor(source: string, isCaseBlind: boolean) {
    this.source = source
    this.isCaseBlind = isCaseBlind
  }

  /** A character test as the flags make it: case-blind under `i`, and tabled for speed. */
  private fold(test: (code: number) => boolean): (code: number) => boolean {
    return tabled(this.isCaseBlind ? caseBlind(test) : test)
  }

  parse(): Node {
    const node = this.alternation()
    if (this.at < this.source.length) {
      throw new Error(`regex-steps: unexpected ${this.source[this.at]} at ${this.at}`)
    }

    return node
  }

  private peek(): string | undefined {
    return this.source[this.at]
  }

  private alternation(): Node {
    const options: Node[][] = [this.sequence()]
    while (this.peek() === '|') {
      this.at += 1
      options.push(this.sequence())
    }

    return { kind: 'alt', options }
  }

  private sequence(): Node[] {
    const nodes: Node[] = []
    while (this.at < this.source.length && this.peek() !== '|' && this.peek() !== ')') {
      nodes.push(this.quantified(this.atom()))
    }

    return nodes
  }

  /** `atom` with the quantifier after it, if any. A `{` that starts no count is a literal, as in a browser. */
  private quantified(atom: Node): Node {
    const c = this.peek()
    let range: [number, number] | undefined
    if (c === '*' || c === '+' || c === '?') {
      this.at += 1
      range = c === '*' ? [0, Infinity] : c === '+' ? [1, Infinity] : [0, 1]
    } else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.source.slice(this.at))
      if (m !== null) {
        this.at += m[0].length
        range = [Number(m[1]), m[2] === undefined ? Number(m[1]) : m[3] === '' ? Infinity : Number(m[3])]
      }
    }
    if (range === undefined) {
      return atom
    }
    const isLazy = this.peek() === '?'
    if (isLazy) {
      this.at += 1
    }

    return { kind: 'repeat', body: atom, min: range[0], max: range[1], isLazy }
  }

  private atom(): Node {
    const c = this.source[this.at++]!
    switch (c) {
      case '^':
        return { kind: 'start' }
      case '$':
        return { kind: 'end' }
      case '.':
        return { kind: 'char', test: code => !isLineEnd(code) }
      case '[':
        return this.charClass()
      case '(':
        return this.group()
      case '\\':
        return this.escape()
      default:
        return { kind: 'char', test: this.fold(literal(c.charCodeAt(0))) }
    }
  }

  private group(): Node {
    let look: { isBehind: boolean; isNegated: boolean } | undefined
    const rest = this.source.slice(this.at)
    if (rest.startsWith('?:')) {
      this.at += 2
    } else if (rest.startsWith('?=') || rest.startsWith('?!')) {
      look = { isBehind: false, isNegated: rest[1] === '!' }
      this.at += 2
    } else if (rest.startsWith('?<=') || rest.startsWith('?<!')) {
      look = { isBehind: true, isNegated: rest[2] === '!' }
      this.at += 3
    } else if (rest.startsWith('?<')) {
      // A named group: its name changes nothing a test counts.
      this.at = this.source.indexOf('>', this.at) + 1
    }
    const body = this.alternation()
    if (this.source[this.at++] !== ')') {
      throw new Error('regex-steps: a group is not closed')
    }

    return look === undefined ? body : { kind: 'look', body, ...look }
  }

  /** An escape outside a class, after its `\`. */
  private escape(): Node {
    const c = this.source[this.at]!
    const set = SETS[c]
    if (set !== undefined || c === 'b' || c === 'B') {
      this.at += 1

      return set !== undefined ? { kind: 'char', test: this.fold(set) } : { kind: c === 'b' ? 'boundary' : 'notBoundary' }
    }

    return { kind: 'char', test: this.fold(literal(this.escapedCode())) }
  }

  /** The code of a one-character escape after its `\`: `\n`, `\x41`, `\u2028`, `\b` (in a class), `\-`. */
  private escapedCode(): number {
    const c = this.source[this.at++]!
    if (c in NAMED) {
      return NAMED[c]!
    }
    if (c === 'b') {
      return 8
    }
    if (c === 'x' || c === 'u') {
      const width = c === 'x' ? 2 : 4
      const hex = this.source.slice(this.at, this.at + width)
      this.at += width

      return parseInt(hex, 16)
    }
    if (/[1-9]/.test(c)) {
      throw new Error('regex-steps: back references are not supported')
    }

    return c.charCodeAt(0)
  }

  private charClass(): Node {
    const isNegated = this.peek() === '^'
    if (isNegated) {
      this.at += 1
    }
    const parts: ((code: number) => boolean)[] = []
    // One character of the class, as its code, or a set escape (`\s`) as a test.
    const one = (): number | ((code: number) => boolean) => {
      const c = this.source[this.at++]!
      if (c !== '\\') {
        return c.charCodeAt(0)
      }
      const set = SETS[this.source[this.at]!]
      if (set !== undefined) {
        this.at += 1

        return set
      }

      return this.escapedCode()
    }
    while (this.peek() !== ']') {
      if (this.at >= this.source.length) {
        throw new Error('regex-steps: a class is not closed')
      }
      const from = one()
      if (typeof from === 'number' && this.peek() === '-' && this.source[this.at + 1] !== ']') {
        this.at += 1
        const to = one()
        if (typeof to !== 'number') {
          throw new Error('regex-steps: a range ends in a set')
        }
        parts.push(code => code >= from && code <= to)
      } else {
        parts.push(typeof from === 'number' ? literal(from) : from)
      }
    }
    this.at += 1
    // The `i` flag folds the class's own set first; a `^` then takes the complement of the folded set.
    const folded = this.fold(code => parts.some(part => part(code)))

    return { kind: 'char', test: isNegated ? tabled(code => !folded(code)) : folded }
  }
}

/** A test made case-blind, as the `i` flag makes each character test of the pattern. */
function caseBlind(test: (code: number) => boolean): (code: number) => boolean {
  return code => {
    if (test(code)) {
      return true
    }
    const char = String.fromCharCode(code)
    const lower = char.toLowerCase()
    const upper = char.toUpperCase()

    return (lower.length === 1 && test(lower.charCodeAt(0))) || (upper.length === 1 && test(upper.charCodeAt(0)))
  }
}

/** A character test with its answers for the first 256 codes kept in a table: a test of the text costs one read. */
function tabled(test: (code: number) => boolean): (code: number) => boolean {
  const table = Uint8Array.from({ length: 256 }, (_, code) => (test(code) ? 1 : 0))

  return code => (code < 256 ? table[code] === 1 : test(code))
}

/** The longest text a node matches, Infinity for no bound: how far back a lookbehind must try. */
function longest(node: Node): number {
  switch (node.kind) {
    case 'char':
      return 1
    case 'alt':
      return Math.max(0, ...node.options.map(seq => seq.reduce((sum, one) => sum + longest(one), 0)))
    case 'repeat':
      return node.max === 0 ? 0 : longest(node.body) * node.max
    case 'look':
    case 'start':
    case 'end':
    case 'boundary':
    case 'notBoundary':
      return 0
  }
}

/** What one run gives: whether the pattern matched, as RegExp.test from index 0 says, and the steps it took. */
export type Counted = { isMatch: boolean; steps: number }

/** The pattern compiled once, for many texts. */
export function stepCounter(re: RegExp): (text: string) => Counted {
  if (/[msuv]/.test(re.flags)) {
    throw new Error(`regex-steps: flag ${re.flags} is not supported`)
  }
  const root = new Parser(re.source, re.flags.includes('i')).parse()
  // Local mutable state of one run: the text and the step count. A closure over them keeps each
  // compiled matcher a plain function call, so ten million steps take about a second.
  let text = ''
  let steps = 0
  const isWordAt = (pos: number) => pos >= 0 && pos < text.length && isWordCode(text.charCodeAt(pos))

  const compile = (node: Node): Matcher => {
    switch (node.kind) {
      case 'char': {
        const test = node.test

        return (pos, k) => {
          steps += 1

          return pos < text.length && test(text.charCodeAt(pos)) && k(pos + 1)
        }
      }
      case 'start':
        return (pos, k) => ((steps += 1), pos === 0 && k(pos))
      case 'end':
        return (pos, k) => ((steps += 1), pos === text.length && k(pos))
      case 'boundary':
        return (pos, k) => ((steps += 1), isWordAt(pos - 1) !== isWordAt(pos) && k(pos))
      case 'notBoundary':
        return (pos, k) => ((steps += 1), isWordAt(pos - 1) === isWordAt(pos) && k(pos))
      case 'alt': {
        const options = node.options.map(seq => sequence(seq.map(compile)))

        return options.length === 1 ? options[0]! : (pos, k) => options.some(option => option(pos, k))
      }
      case 'look': {
        const body = compile(node.body)
        const reach = longest(node.body)
        const found = node.isBehind
          ? (pos: number) => {
              for (let from = pos; from >= Math.max(0, pos - reach); from -= 1) {
                if (body(from, end => end === pos)) {
                  return true
                }
              }

              return false
            }
          : (pos: number) => body(pos, () => true)

        return (pos, k) => ((steps += 1), found(pos) !== node.isNegated && k(pos))
      }
      case 'repeat':
        return node.body.kind === 'char' ? charRepeat(node, compile(node.body)) : groupRepeat(node, compile(node.body))
    }
  }

  /** A quantifier over one character: count the run, then try the continuation from each end, as an engine does. */
  const charRepeat = (node: { min: number; max: number; isLazy: boolean }, one: Matcher): Matcher => (pos, k) => {
    let run = 0
    while (run < node.max && one(pos + run, isAny)) {
      run += 1
    }
    if (node.isLazy) {
      for (let n = node.min; n <= run; n += 1) {
        steps += 1
        if (k(pos + n)) {
          return true
        }
      }

      return false
    }
    for (let n = run; n >= node.min; n -= 1) {
      steps += 1
      if (k(pos + n)) {
        return true
      }
    }

    return false
  }

  /** A quantifier over a group: one more round, or stop, in the greedy or lazy order; a round that matches nothing ends it. */
  const groupRepeat = (node: { min: number; max: number; isLazy: boolean }, body: Matcher): Matcher => (pos, k) => {
    const round = (at: number, n: number): boolean => {
      steps += 1
      const more = () => n < node.max && body(at, end => (end === at && n >= node.min ? false : round(end, n + 1)))
      const stop = () => n >= node.min && k(at)

      return node.isLazy ? stop() || more() : more() || stop()
    }

    return round(pos, 0)
  }

  /** The parts one after the other: each part's continuation is the rest of the sequence. */
  const sequence = (parts: Matcher[]): Matcher => {
    let chain: Matcher = (pos, k) => k(pos)
    for (const part of [...parts].reverse()) {
      const rest = chain
      chain = (pos, k) => part(pos, end => rest(end, k))
    }

    return chain
  }

  const matcher = compile(root)

  return (input: string): Counted => {
    text = input
    steps = 0
    for (let start = 0; start <= text.length; start += 1) {
      steps += 1
      if (matcher(start, () => true)) {
        return { isMatch: true, steps }
      }
    }

    return { isMatch: false, steps }
  }
}
