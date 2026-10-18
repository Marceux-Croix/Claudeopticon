/** Pruning of in-memory maps and sets to the keys still in use. */

/**
 * Deletes from `held` every key that `keep` does not hold, in place, so state kept per agent or per
 * item never grows over a long session. In place on purpose: the callers own module-level maps that
 * other functions hold references to, and a copy would leave those holding the old map.
 */
export function pruneTo<K>(held: Map<K, unknown> | Set<K>, keep: (key: K) => boolean): void {
  for (const key of [...held.keys()]) {
    if (!keep(key)) {
      held.delete(key)
    }
  }
}
