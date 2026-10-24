/**
 * The source scan of the todo read layer: every `fs.read(` in the hooks must be the read
 * layer's own (`readTodo` in register.tsx) or an allowed read of a file that is no todo file, and no
 * read outside the layer may turn a failure into an empty string or undefined.
 *
 * The plugin test harness gives a test no way to read a source file (`node:fs`, `fetch`, text imports
 * and dynamic `import()` are all refused), so `todo-read.test.tsx` runs this scan on constructed
 * sources, and `scripts/check-reads.ts` runs the same function with node on the real hooks (a gate
 * step: it exits 1 on any unrouted read).
 */

import { unroutedCalls } from './fs-scan'
import type { AllowedCall } from './fs-scan'

/** A read of a file that is no todo file: where it is (file, enclosing function, the line), and why it may stay. */
export type AllowedRead = AllowedCall

/** The one function every todo read goes through. */
export const LAYER = { file: 'register.tsx', fn: 'readTodo' }

export const ALLOWED: readonly AllowedRead[] = [
  { file: 'register.tsx', fn: 'findTodoDir', line: "read: path => $.fs.read(path).then(text => (typeof text === 'string' ? text : '')).catch(() => ''),", reason: "reads a worktree's `.git` file for its gitdir line, no todo file; no text means no line, and the text rule falls back" },
  { file: 'register.tsx', fn: 'gitFs', line: 'read: path => $.fs.read(path).catch(() => undefined),', reason: "the engine port of the `.git` walk (`gitWhereUp`): reads a `.git` file for its gitdir line, no todo file; no text means the claim folders are unknown, and no ID is given" },
  { file: 'git-file.ts', fn: 'gitWhereUp', line: "const text = kind === 'file' ? await fs.read(path) : undefined", reason: "reads a `.git` file for its gitdir line through its port, no todo file; no text means the claim folders are unknown, and no ID is given" },
  { file: 'git-file.ts', fn: 'gitWhereUp', line: 'const linked = hasCommondir ? await fs.read(commondir) : undefined', reason: "reads a git dir's `commondir` file through its port, no todo file; a read that fails means the claim folders are unknown, and no ID is given" },
  { file: 'register.tsx', fn: 'bookOnDisk', line: 'const text: unknown = await fsBounded($, () => $.fs.read(path))', reason: 'reads categories.json, no todo file, for the book load and the check before each book write; a failed read is undefined, which clears the book folder and skips the write, never an empty book' },
  { file: 'repo-folders.ts', fn: 'mainOf', line: "const set = /^\\s*worktree\\s*=\\s*(.+)$/m.exec(await fs.read(`${common}/config`).catch(() => ''))?.[1]?.trim()", reason: 'reads the git config for core.worktree, no todo file; no text means the key is not set' },
  { file: 'repo-folders.ts', fn: 'mainOf', line: "const named = (await fs.read(`${dir}/commondir`).catch(() => '')).split('\\n')[0]?.replace(/\\r$/, '').trim() ?? ''", reason: "reads a git dir's `commondir` file, no todo file; no text means the git dir is no linked worktree's, as git reads it, so there is no other main checkout" },
  { file: 'register.tsx', fn: 'readPluginVersion', line: 'const text: unknown = await fsBounded($, () => $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).catch(() => undefined)', reason: "reads the mod's own plugin.json for its version, no todo file; a failed read shows no version" },
  { file: 'repo-folders.ts', fn: 'repoTodoDir', line: "const gitdir = /^gitdir:\\s*(.+)$/m.exec(await fs.read(git))?.[1]?.replace(/\\r$/, '').trim()", reason: "reads a worktree's `.git` file, no todo file; a failure throws" },
]

/**
 * The reads that break the rule, as `file:line: why`: each `fs.read(` outside the layer that no entry
 * of `allowed` names by file, function and line, the ones that catch a failure into an empty value
 * (the class of failed reads) named as such. An allowed line moved into another
 * function, or a second copy of it elsewhere, is not allowed. Every way around the `fs.read(` text
 * (an alias of the engine fs under any handle name, a destructured or bound read, optional chaining)
 * is named too, anywhere. Comments are skipped by a lexer, so code after a block comment is read.
 */
export function unroutedReads(sources: Readonly<Record<string, string>>, allowed: readonly AllowedRead[] = ALLOWED): string[] {
  return unroutedCalls(sources, { method: 'read', layer: LAYER, allowed, noun: 'read', swallow: 'a failed read caught into an empty value' })
}
