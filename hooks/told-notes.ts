/** The note lines about the mod's own ticket changes that Claude has not been told of yet, as the store keeps them. */

/** The waiting lines: renumbered IDs, tickets the mod numbered, duplicate tickets removed. */
export type ToldLists = { renames: string[]; numbered: string[]; removed: string[] }

const isLines = (value: unknown): value is string[] => Array.isArray(value) && value.every(one => typeof one === 'string')

/** Reads the stored lists back; a damaged part is an empty list. */
export function readToldLists(stored: unknown): ToldLists {
  const one = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}

  return { renames: isLines(one.renames) ? one.renames : [], numbered: isLines(one.numbered) ? one.numbered : [], removed: isLines(one.removed) ? one.removed : [] }
}

/** The waiting lines after a store read: the stored ones first, then those in memory that the store does not hold. */
export function mergeToldLines(memory: readonly string[], stored: readonly string[]): string[] {
  const held = new Set(stored)

  return [...stored, ...memory.filter(line => !held.has(line))]
}
