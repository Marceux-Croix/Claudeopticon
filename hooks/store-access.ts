/** The bounded reads and writes of the engine store. */

import type { EngineInterface } from 'claude-code'
import { clock } from './card-format'
import { failAfter, NoAnswer, STORE_LIMIT_MS } from './time-limit'
import { stalledKeys } from './state'

/** A store read: the value (undefined when the key is absent), or a failure. A failure is not an absent key. */
type Got = { ok: true; value: unknown } | { ok: false }

/** One store call for `key` under the store time limit: an unanswered call fails with NoAnswer and marks the key stalled. */
function storeCall<T>($: EngineInterface, key: string, call: () => Promise<T>): Promise<T> {
  return Promise.resolve()
    .then(() => failAfter(Promise.resolve(call()), STORE_LIMIT_MS, (ms, fire) => $.clock.after(ms, fire)))
    .then(
      value => {
        stalledKeys.delete(key)

        return value
      },
      (error: unknown) => {
        if (error instanceof NoAnswer) {
          stalledKeys.add(key)
        } else {
          stalledKeys.delete(key)
        }
        throw error
      },
    )
}

/** A read that has not answered within STORE_LIMIT_MS is a failed read: a store that never answers never holds a hook. */
export function tryGet($: EngineInterface, key: string): Promise<Got> {
  return storeCall($, key, () => $.store.get(key))
    .then(
      (value): Got => ({ ok: true, value }),
      (): Got => ({ ok: false }),
    )
}

/**
 * A store write, rejected when it has not answered within STORE_LIMIT_MS, as a write that
 * failed: each caller tries it again or goes on, as it does for a store that rejects. A write that
 * only answers late may still land; each key is written whole, so a late write is one older copy that
 * the next write replaces.
 */
export function storeSet($: EngineInterface, key: string, value: unknown): Promise<void> {
  return storeCall($, key, () => $.store.set(key, value)).then(() => undefined)
}
