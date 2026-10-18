/**
 * The source scan of the engine fs calls (UCR 5c, UCR-121): finds each call of one fs method in the
 * hooks that is not its layer's own or an allowed one, and every way around the call text. The read
 * scan (`read-scan.ts`) and the write scan (`write-scan.ts`) are two settings of it.
 *
 * The scan reads code only: comments are blanked first by a small lexer that knows strings, template
 * literals and regular expressions, so a call after a block comment on the same line, or on a line
 * that starts with `*` (a product), is still seen, and a call in a comment never runs. The call
 * patterns take optional chaining (`$?.fs?.read(`) and line breaks (`$.fs\n.read(`), on any handle name.
 */

/** A call that may stay outside the layer: where it is (file, enclosing function, the line), and why. */
export type AllowedCall = { file: string; fn: string; line: string; reason: string }

/** One setting of the scan: the method, the one function every call goes through, the allowed ones, and the words of a finding. */
export type ScanSpec = {
  method: string
  layer: { file: string; fn: string }
  allowed: readonly AllowedCall[]
  /** The noun of one call: `read`, `write`. */
  noun: string
  /** The words for a call that swallows its failure into an empty value; undefined when the method has no such rule. */
  swallow?: string
}

/** A catch that turns a failed call into an empty string or undefined. */
const SWALLOW = /\.catch\(\s*\(\s*\)\s*=>\s*(?:''|""|``|undefined)\s*\)/

/** A member access, with optional chaining: `.` or `?.`, spaces and line breaks around it. */
const DOT = String.raw`\s*\??\.\s*`

/** The words before a `/` that starts a regular expression, not a division. */
const REGEX_AFTER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new))\s*$/

/**
 * True when the `/` at `i` is part of a JSX tag, not the start of a regular expression (UCR-233): right
 * after `<` (a closing tag, `</Text>`), or before `>` after a `}` (a self-closing tag, `<B onPress={f} />`).
 * Read as a regular expression, it ran to the end of the line and took the brackets there with it.
 */
function isJsxSlash(source: string, i: number): boolean {
  return source[i - 1] === '<' || (source[i + 1] === '>' && /\}\s*$/.test(source.slice(Math.max(0, i - 12), i)))
}

/** The code before a `<` that opens a JSX element: where an expression starts (`(`, `=`, `=>`, `&&`, `?`, `return`...). */
const JSX_AFTER = /(?:^|[(,=:[!&|?{;]|=>|\b(?:return|yield|await|default|case|else|do))\s*$/

/**
 * A JSX element's start: `<` and a tag name before a space, `/`, `>` or `{`, or `<>` (a fragment). Not a
 * TypeScript type parameter list: `<T,>` has a comma, and `<T extends X>` the word `extends`.
 */
const JSX_OPEN = /^<(?:[A-Za-z_$][\w$.:-]*(?=[\s/>{])(?!\s+extends\b)|>)/

/**
 * The source with every comment and the text of every string and template literal blanked (each
 * character but a line break turned into a space; the quotes stay), so line and column numbers stay
 * and a call named in a toast's words is no call. The code in a template's `${}` holes is kept, and
 * so are regular expressions unless `isRegexBlanked` (the bracket count of `scopesOf` needs them out: a
 * `/\(/` holds a bracket that opens nothing); a `//` or `/*` inside a string or a regular expression
 * opens no comment. With `isJsx` (a .tsx or .jsx file), the text of a JSX element (between its tags,
 * outside `{}`) and its attribute strings are text too (UCR-233): a backtick, a quote, `//` or `/*` in
 * `<p>/*</p>` is no code, where read as code it opened a template, a string or a comment that hid the
 * calls after it. The tags and the code in `{}` stay.
 */
export function codeOnly(source: string, isTextKept = false, isRegexBlanked = false, isJsx = false): string {
  const out = source.split('')
  // Comments always; string text only when it is not kept (a lookup by name, `$['fs']`, needs it).
  const blankText = (from: number, to: number) => {
    if (!isTextKept) {
      blank(from, to)
    }
  }
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) {
      if (out[k] !== '\n') {
        out[k] = ' '
      }
    }
  }
  // The brace depth at each open `${` of a template, or `{` of a JSX element: its `}` goes back to where it was.
  const holes: { depth: number; kind: 'template' | 'jsxText' | 'jsxTag' }[] = []
  // Per JSX expression in progress (a hole's code may start another), how many of its elements are open.
  const elements: number[] = []
  let depth = 0
  let i = 0
  const n = source.length
  // Skips a template body from `i` (just after a backtick or a `}` that closes a hole): to its end, or into a hole.
  const template = () => {
    while (i < n) {
      const c = source[i]
      if (c === '\\') {
        blankText(i, Math.min(i + 2, n))
        i += 2
      } else if (c === '`') {
        i += 1

        return
      } else if (c === '$' && source[i + 1] === '{') {
        holes.push({ depth, kind: 'template' })
        depth += 1
        i += 2

        return
      } else {
        blankText(i, i + 1)
        i += 1
      }
    }
  }
  // The text of an open JSX element, from `i`: to a `{` (into code), a closing tag (the last one ends the
  // expression, back to code), or a child's opening tag. Its text is text, as a string's is.
  const jsxText = () => {
    while (i < n) {
      const c = source[i]
      if (c === '{') {
        holes.push({ depth, kind: 'jsxText' })
        depth += 1
        i += 1

        return
      }
      if (c === '<' && source[i + 1] === '/') {
        const end = source.indexOf('>', i)
        i = end < 0 ? n : end + 1
        elements[elements.length - 1]! -= 1
        if (elements[elements.length - 1] === 0) {
          elements.pop()

          return
        }
      } else if (c === '<') {
        i += 1
        jsxTag()

        return
      } else {
        blankText(i, i + 1)
        i += 1
      }
    }
  }
  // An opening tag, from `i` (past its `<`): attribute strings are text (JSX strings take no escapes), a
  // `{` goes into code, `>` opens the element's text, and `/>` closes it (the last one ends the expression).
  const jsxTag = () => {
    while (i < n) {
      const c = source[i]
      if (c === '"' || c === "'") {
        const end = source.indexOf(c, i + 1)
        const stop = end < 0 ? n : end
        blankText(i + 1, stop)
        i = stop + 1
      } else if (c === '{') {
        holes.push({ depth, kind: 'jsxTag' })
        depth += 1
        i += 1

        return
      } else if (c === '/' && source[i + 1] === '>') {
        i += 2
        if (elements[elements.length - 1] === 0) {
          elements.pop()
        } else {
          jsxText()
        }

        return
      } else if (c === '>') {
        i += 1
        elements[elements.length - 1]! += 1
        jsxText()

        return
      } else {
        i += 1
      }
    }
  }
  while (i < n) {
    const c = source[i]!
    const d = source[i + 1]
    if (isJsx && c === '<' && JSX_OPEN.test(source.slice(i, i + 80)) && JSX_AFTER.test(out.slice(Math.max(0, i - 12), i).join(''))) {
      elements.push(0)
      i += 1
      jsxTag()
    } else if (c === '/' && d === '/') {
      const end = source.indexOf('\n', i)
      const stop = end < 0 ? n : end
      blank(i, stop)
      i = stop
    } else if (c === '/' && d === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      blank(i, stop)
      i = stop
    } else if (c === "'" || c === '"') {
      const from = i + 1
      i += 1
      while (i < n && source[i] !== c && source[i] !== '\n') {
        i += source[i] === '\\' ? 2 : 1
      }
      blankText(from, Math.min(i, n))
      i += 1
    } else if (c === '`') {
      i += 1
      template()
    } else if (c === '{') {
      depth += 1
      i += 1
    } else if (c === '}') {
      depth -= 1
      i += 1
      if (holes.length > 0 && holes[holes.length - 1]!.depth === depth) {
        const kind = holes.pop()!.kind
        if (kind === 'template') {
          template()
        } else if (kind === 'jsxText') {
          jsxText()
        } else {
          jsxTag()
        }
      }
    } else if (c === '/' && !isJsxSlash(source, i) && REGEX_AFTER.test(out.slice(Math.max(0, i - 12), i).join(''))) {
      // A regular expression: to its closing `/` outside a class, then its flags.
      let isClass = false
      i += 1
      const from = i
      while (i < n && source[i] !== '\n' && (isClass || source[i] !== '/')) {
        if (source[i] === '\\') {
          i += 1
        } else if (source[i] === '[') {
          isClass = true
        } else if (source[i] === ']') {
          isClass = false
        }
        i += 1
      }
      if (isRegexBlanked) {
        blank(from, Math.min(i, n))
      }
      i += 1
    } else {
      i += 1
    }
  }

  return out.join('')
}

/**
 * The code with every `\uXXXX` and `\u{X}` escape that spells an identifier character written as that
 * character (UCR-121): `$.fs.write(` is `$.fs.write(` to the engine, so the scan reads it so too.
 * An escape of any other character (a line break, a symbol in a regular expression) stays as written,
 * so line numbers never move.
 */
export function unescapedIdentifiers(code: string): string {
  return code.replace(/\\u(?:([0-9a-fA-F]{4})|\{([0-9a-fA-F]{1,6})\})/g, (whole, four?: string, braced?: string) => {
    const point = Number.parseInt(four ?? braced!, 16)
    const char = point <= 0x10ffff ? String.fromCodePoint(point) : ''

    return /^[\p{ID_Continue}$]$/u.test(char) ? char : whole
  })
}

/**
 * The ways to reach the engine handle's members that no name pattern can follow (UCR-121): a lookup
 * by a computed key (`$[k]`, `$['f' + 's']`, `($ as any)[k]`, `$?.[k]`), and `Reflect` or an `Object`
 * method with the handle as its first argument (`Reflect.get($, 'fs')`). Read on code only, so a
 * template's `${` or a regular expression's `\$[` is no lookup. The handle is `$`, the engine's own
 * name in every hook; another name for it is the alias the first bypass pattern names.
 */
const HANDLE_REACH: [RegExp, string][] = [
  [/(?<![\w$\\])\$\s*(?:\?\.\s*)?\[/g, 'the engine handle looked up by a computed key'],
  // In parentheses, cast or not: `($ as any)[k]`; a call's argument (`f($)[0]`) is no lookup on the handle.
  // The callee check is `isCallArgument`, run on each match.
  [/\(\s*\$(?:\s+as\s+[^()]+?)?\s*\)\s*(?:\?\.\s*)?\[/g, 'the engine handle looked up by a computed key'],
  [/\b(?:Reflect|Object)\s*\.\s*\w+\s*\(\s*\(?\s*\$(?![\w$])/g, 'the engine handle read through Reflect or Object'],
]

/** The words after which a `(` opens a group, not a call's arguments. */
const GROUP_AFTER = new Set(['await', 'return', 'typeof', 'void', 'yield', 'in', 'of', 'case', 'throw', 'new', 'delete', 'else', 'do'])

/** True when the `(` at `index` of `code` opens a call's arguments: a name (not a keyword), `)` or `]` stands before it. */
function isCallArgument(code: string, index: number): boolean {
  const before = /([\w$]+|[)\]])\s*$/.exec(code.slice(Math.max(0, index - 40), index))?.[1]

  return before !== undefined && !GROUP_AFTER.has(before)
}

/**
 * A top-level declaration at column 0, and its name: a function (also `async`, a generator `function*`,
 * `export default`), a `const`, `let` or `var`, or a class (UCR-233). Read on code-only lines.
 */
const DECLARATION = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\b\s*\*?\s*([\w$]+)?|(?:const|let|var|class)\s+([\w$]+))/

/**
 * One top-level statement of a source: its name (empty for one that declares nothing), its lines (from 0,
 * both ends included) up to the next statement, and `inner`, the last line that is inside it for an
 * exemption: for a function, the line where its body closes (one less when code follows the brace on
 * that line), so nothing after the body counts as in it; -1 when the body's end cannot be found.
 */
type Scope = { name: string; from: number; to: number; inner: number }

/** The index after the bracket that closes the one at `open` in `code`, or undefined when none does. */
function closing(code: string, open: number): number | undefined {
  let depth = 0
  for (let k = open; k < code.length; k += 1) {
    const c = code[k]!
    if (c === '(' || c === '{' || c === '[') {
      depth += 1
    } else if (c === ')' || c === '}' || c === ']') {
      depth -= 1
      if (depth === 0) {
        return k + 1
      }
    }
  }

  return undefined
}

/** The end of the line an index sits on: the index of its line break, or the text's length. */
const lineEnd = (code: string, at: number): number => (code.indexOf('\n', at) < 0 ? code.length : code.indexOf('\n', at))

/**
 * The top-level statements of a source by line, found by bracket matching on code with strings,
 * comments and regular expressions blanked (UCR-233): a statement starts at a line that begins at
 * column 0 while no bracket is open, so a declaration the name rule does not know (`let x = async`)
 * still ends the one above it. `isBalanced` is false when the brackets of the source do not balance:
 * then no line is inside a scope for an exemption (the layer, an allowed entry), so the gate fails closed.
 */
function scopesOf(code: string): { scopes: Scope[]; isBalanced: boolean } {
  const starts: { at: number; name: string; isFunction: boolean }[] = []
  let depth = 0
  for (let k = 0; k < code.length; k += 1) {
    const c = code[k]!
    if ((k === 0 || code[k - 1] === '\n') && depth === 0 && /\S/.test(c)) {
      const m = DECLARATION.exec(code.slice(k, lineEnd(code, k)))
      starts.push({ at: k, name: m === null ? '' : (m[1] ?? m[2] ?? ''), isFunction: m !== null && /\bfunction\b/.test(m[0]) })
    }
    if (c === '(' || c === '{' || c === '[') {
      depth += 1
    } else if (c === ')' || c === '}' || c === ']') {
      depth -= 1
    }
  }
  const scopes = starts.map((start, k) => {
    const next = starts[k + 1]?.at ?? code.length
    const from = lineAt(code, start.at)
    const last = lineAt(code, Math.max(start.at, next - 1))
    if (!start.isFunction) {
      return { name: start.name, from, to: last, inner: last }
    }
    // The body is the first brace after the parameter list. A return type with a brace in it ends the scope early,
    // so a call in the body reads as outside it: the gate fails, never passes, on such a form.
    const params = code.indexOf('(', start.at)
    const afterParams = params < 0 || params >= next ? undefined : closing(code, params)
    const body = afterParams === undefined ? -1 : code.indexOf('{', afterParams)
    const end = body < 0 || body >= next ? undefined : closing(code, body)
    if (end === undefined) {
      return { name: start.name, from, to: last, inner: -1 }
    }
    const endLine = lineAt(code, end - 1)
    const isMore = /\S/.test(code.slice(end, lineEnd(code, end)))

    return { name: start.name, from, to: last, inner: Math.min(last, isMore ? endLine - 1 : endLine) }
  })

  return { scopes, isBalanced: depth === 0 }
}

/** The top-level statement a line (from 0) sits in, if any. */
function scopeAt(scopes: readonly Scope[], line: number): Scope | undefined {
  return scopes.find(one => line >= one.from && line <= one.to)
}

/**
 * The ways around the call text (UCR-121), each with its words: the engine's fs taken whole (an
 * alias, a destructured method, an argument, a bracket lookup) under any handle name, and the method
 * taken without a call. Any of them could reach a todo file outside the layer. A type such as
 * `EngineInterface['fs']['list']` names no value and is no way around. The third value says whether
 * the pattern reads string text (a lookup by name), so it runs on the source with only comments blanked.
 */
function bypasses(method: string): [RegExp, string, boolean][] {
  return [
    [new RegExp(String.raw`[\w$\])]${DOT}fs\b(?!${DOT}\w+\s*(?:\?\.\s*)?\()`, 'g'), 'the engine fs taken whole (an alias, a destructure or an argument)', false],
    [new RegExp(String.raw`(?<!EngineInterface)\[\s*['"\`]fs['"\`]\s*\]`, 'g'), 'the engine fs looked up by name', true],
    [/\{[^{}]*\bfs\b[^{}]*\}\s*=\s*[\w$]+(?![\w$.(])/g, 'the engine fs destructured from the handle', false],
    // A nested destructure (`{ fs: { read, write } } = $`, UCR-233): the pattern above stops at the inner brace.
    [/\bfs\s*:\s*[{[]/g, 'the engine fs destructured from the handle', false],
    [new RegExp(String.raw`\bfs${DOT}${method}\b(?!\s*(?:\?\.\s*)?\()`, 'g'), `a ${method} method taken without a call`, false],
    [new RegExp(String.raw`\bfs\s*(?:\?\.\s*)?\[\s*['"\`]${method}['"\`]\s*\]`, 'g'), `a ${method} method looked up by name`, true],
  ]
}

/** The line number (from 0) of an index in a text. */
const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length - 1

/**
 * The calls that break the rule, as `file:line: why`: each call of `spec.method` outside the layer
 * that no allowed entry names by file, function and line, and (with `spec.swallow`) the ones that
 * catch a failure into an empty value, named as such. An allowed line moved into another function, or
 * a second copy of it elsewhere, is not allowed. Every way around the call text is named too,
 * anywhere, in the layer as well. Comments are skipped; a line holds one finding at most.
 */
export function unroutedCalls(sources: Readonly<Record<string, string>>, spec: ScanSpec): string[] {
  const out: string[] = []
  for (const [file, text] of Object.entries(sources)) {
    // An escaped identifier is read as the engine reads it (UCR-121): `$.f\u0073` is `$.fs`.
    const isJsx = /\.[jt]sx$/.test(file)
    const code = unescapedIdentifiers(codeOnly(text, false, false, isJsx))
    const withText = unescapedIdentifiers(codeOnly(text, true, false, isJsx))
    const lines = text.split('\n')
    const codeLines = code.split('\n')
    const found = new Map<number, string>()
    // The scope of a call, by bracket matching (UCR-233). `enclosing` names it; `within` says the line is inside that
    // function's body for an exemption, which a source whose brackets do not balance never gives.
    const { scopes, isBalanced } = scopesOf(codeOnly(text, false, true, isJsx))
    const enclosing = (_lines: readonly string[], at: number): string => scopeAt(scopes, at)?.name ?? ''
    const within = (fn: string, at: number): boolean => {
      const scope = scopeAt(scopes, at)

      return isBalanced && scope !== undefined && scope.name === fn && at <= scope.inner
    }
    for (const [pattern, why, needsText] of bypasses(spec.method)) {
      for (const m of (needsText ? withText : code).matchAll(pattern)) {
        // Named on the line of the `fs` word: a match may start on a line above it.
        const at = lineAt(code, m.index! + Math.max(0, m[0].search(/\bfs\b/)))
        if (!found.has(at)) {
          found.set(at, `${file}:${at + 1}: ${why} (in ${enclosing(codeLines, at) || 'top level'})`)
        }
      }
    }
    // A lookup on the handle by a computed key, or through Reflect or Object, may reach any member: named unless an
    // allowed entry names its line (UCR-121).
    for (const [pattern, why] of HANDLE_REACH) {
      for (const m of code.matchAll(pattern)) {
        if (m[0].startsWith('(') && isCallArgument(code, m.index!)) {
          continue
        }
        const at = lineAt(code, m.index! + Math.max(0, m[0].indexOf('$')))
        const fn = enclosing(codeLines, at)
        if (!found.has(at) && !spec.allowed.some(one => one.file === file && one.fn === fn && within(fn, at) && one.line === lines[at]!.trim())) {
          found.set(at, `${file}:${at + 1}: ${why} (in ${fn || 'top level'})`)
        }
      }
    }
    const call = new RegExp(String.raw`\bfs${DOT}${spec.method}\s*(?:\?\.\s*)?\(`, 'g')
    for (const m of code.matchAll(call)) {
      // The line of the method name: a call split over lines is named where the method stands.
      const at = lineAt(code, m.index! + m[0].search(new RegExp(spec.method)))
      if (found.has(at)) {
        continue
      }
      // Read on code-only lines: a comment line at column 0 that names the layer function never renames the scope.
      const fn = enclosing(codeLines, at)
      if (file === spec.layer.file && fn === spec.layer.fn && within(fn, at)) {
        continue
      }
      const line = lines[at]!.trim()
      if (spec.allowed.some(one => one.file === file && one.fn === fn && within(fn, at) && one.line === line)) {
        continue
      }
      // The call and the lines that go on with it (a chained `.catch` on the next line).
      let tail = codeLines[at]!
      for (let k = at + 1; k < codeLines.length && /^\s*[.?)]/.test(codeLines[k]!); k += 1) {
        tail += codeLines[k]!
      }
      const isSwallow = spec.swallow !== undefined && SWALLOW.test(tail)
      found.set(at, `${file}:${at + 1}: ${isSwallow ? spec.swallow! : `a ${spec.noun}`} outside ${spec.layer.fn} (in ${fn || 'top level'})`)
    }
    out.push(...[...found.entries()].sort(([a], [b]) => a - b).map(([, finding]) => finding))
  }

  return out
}
