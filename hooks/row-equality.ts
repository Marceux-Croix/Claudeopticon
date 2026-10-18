/** Value equality of agent rows, so a change that changes nothing is not counted. */

import type { AgentRow } from '../types'

/** Value equality for the plain data of a row: primitives, arrays and flat objects. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((one, i) => sameValue(one, b[i]))
  }
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>

  return [...new Set([...Object.keys(x), ...Object.keys(y)])].every(key => sameValue(x[key], y[key]))
}

/**
 * True when both lists hold equal rows in the same order. No JSON: the tick calls it. A row's object
 * fields (such as `progress`) allocate a small key list each: a row holds few such fields,
 * so the cost stays small.
 */
export function sameRows(a: readonly AgentRow[], b: readonly AgentRow[]): boolean {
  return a === b || (a.length === b.length && a.every((row, i) => sameValue(row, b[i])))
}
