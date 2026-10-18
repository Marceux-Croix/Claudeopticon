/**
 * The source scan of the todo write layer: every `fs.write(` in the
 * hooks must be the write layer's own (`writeIfUnchanged` in register.tsx, which does every check,
 * then the last read and compare, then the write with no await between) or an allowed write of a
 * file that is no todo file. A write of a todo file anywhere else could land after an await that let
 * an edit in, and write over it.
 *
 * As with the read scan, the harness cannot read the sources: `write-scan.test.tsx` runs this scan on
 * constructed sources, and `scripts/check-writes.ts` runs it with node on the real hooks (a gate step:
 * it exits 1 on any write outside the layer).
 */

import { unroutedCalls } from './fs-scan'
import type { AllowedCall } from './fs-scan'

/** The one function every todo write goes through. */
export const WRITE_LAYER = { file: 'register.tsx', fn: 'writeIfUnchanged' }

/** The writes of files that are no todo file, each where it stands, and why it may stay. */
export const ALLOWED_WRITES: readonly AllowedCall[] = [
  { file: 'register.tsx', fn: 'backUpBookNow', line: 'await $.fs.write(name, raw)', reason: 'writes a backup of categories.json, no todo file' },
  { file: 'register.tsx', fn: 'sortItems', line: 'await $.fs.write(`${bookDir}/categories.json`, written)', reason: 'writes categories.json, no todo file; read and compared first' },
  { file: 'register.tsx', fn: 'recategorize', line: 'await $.fs.write(`${bookDir}/categories.json`, written)', reason: 'writes categories.json, no todo file; read and compared first' },
]

/**
 * The writes that break the rule, as `file:line: why`: each `fs.write(` outside `writeIfUnchanged`
 * that no allowed entry names by file, function and line, and every way around the call text (an
 * alias of the engine fs, a write method taken without a call, optional chaining, a call after a
 * block comment), anywhere.
 */
export function unroutedWrites(sources: Readonly<Record<string, string>>, allowed: readonly AllowedCall[] = ALLOWED_WRITES): string[] {
  return unroutedCalls(sources, { method: 'write', layer: WRITE_LAYER, allowed, noun: 'write' })
}
