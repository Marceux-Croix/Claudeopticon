/** The sort queue: which open items the next sort call carries, and how a reply that does not parse narrows the calls after it. */

import { SORT_BATCH } from './categories'

/** An item waiting for a category: its key and its text. */
export type Queued = readonly [key: string, text: string]

/**
 * The items of the next sort call: the first `size` items in queue order, leaving out each item whose
 * reply did not parse when it was sent alone (`alone`, by key, to the text it had then). Those go
 * last, one per call, so one item the model never answers readably holds up only its own call, never
 * the items behind it. An item whose text changed since is an ordinary item again. Empty when the
 * queue is empty.
 */
export function nextSortBatch(queue: readonly Queued[], alone: ReadonlyMap<string, string>, size: number): Queued[] {
  const isAlone = ([key, text]: Queued) => alone.get(key) === text
  const plain = queue.filter(one => !isAlone(one))
  if (plain.length > 0) {
    return plain.slice(0, Math.max(1, size))
  }
  // The one tried longest ago first: `alone` is in the order of the last failure of each, so two such items take turns.
  for (const [key] of alone) {
    const one = queue.find(item => item[0] === key && isAlone(item))
    if (one !== undefined) {
      return [one]
    }
  }

  return []
}

/** What a model reply to a sort call means for the queue. */
type SortReplyKind = 'text' | 'failed' | 'empty'

/**
 * Tells the three kinds of reply apart. `text`: the model answered; the text may still not parse.
 * `empty`: the model answered with no text (the engine's reason `empty-reply`, e.g. a refusal): like
 * an unparsable reply, it may be the items' content, so the next call halves the batch. `failed`: no
 * reply at all (a thrown call) or an unanswered call for another reason (API or network error): not
 * the items' fault, so only the wait grows.
 */
export function sortReplyKind(reply: { isAnswered: boolean; reason?: string } | undefined): SortReplyKind {
  if (reply === undefined) {
    return 'failed'
  }

  return reply.isAnswered ? 'text' : reply.reason === 'empty-reply' ? 'empty' : 'failed'
}

/**
 * The batch size of the next call after a reply to a batch of `size` items. A reply that parses
 * doubles it, up to SORT_BATCH, so a size that was cut down grows back step by step: going straight
 * back to SORT_BATCH makes most calls of a model that cuts long replies off fail again. A
 * reply that does not parse halves it, down to 1: a reply cut off at the token limit gets shorter,
 * and an item the model will not answer readably ends up alone, where its failure is its own. No try
 * is counted against any item in a batch of more than one: a model that fails once and
 * then answers sorts every item.
 */
export function nextBatchSize(size: number, isParsed: boolean): number {
  return isParsed ? Math.min(SORT_BATCH, Math.max(1, size) * 2) : Math.max(1, Math.ceil(size / 2))
}

/**
 * The tries against an item after one more failure alone: a count of failures of the same
 * text, which starts again at 1 when the text changed. At SORT_TRIES the item is given up for the
 * session, until its text changes.
 */
export function addAloneTry(tried: { text: string; count: number } | undefined, text: string): { text: string; count: number } {
  return { text, count: tried !== undefined && tried.text === text ? tried.count + 1 : 1 }
}

/**
 * True when a failed sort call may be the items' fault, so the second such failure in a
 * row for the same batch halves it (see nextThrows); false for a transport or capacity failure,
 * which only waits. Read from the engine's own contract (checked against the 2.1.308 binary): `$.model.complete`
 * does not throw for an API or network failure; it answers `{ isAnswered: false, reason: 'api-error',
 * status, error }`, with `status` the HTTP status or null when no response came, and `reason:
 * 'aborted'` for a timeout or an abort. So:
 * - a throw (`isThrown`) may be the items' fault: the engine throws only for a call it refuses, and
 *   a hook that throws reaches the mod as a refusal too; the message cannot say more.
 * - an `api-error` with a 4xx status other than 408 and 429 (a 400 invalid request, a 413 too
 *   large) may be the items' fault.
 * - everything else (no status, 408, 429, 5xx, 529 overloaded, an abort) is a transport or
 *   capacity failure, not the items' fault.
 */
export function isItemsFailure(reply: { isAnswered: boolean; reason?: string; status?: unknown } | undefined, isThrown: boolean): boolean {
  if (isThrown) {
    return true
  }
  const status = reply?.status

  return reply !== undefined && !reply.isAnswered && reply.reason === 'api-error' && typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429
}

/** The run of failures that may be the items' fault (isItemsFailure), for one batch (by its keys): how many in a row. */
export type BatchThrows = { batch: string; count: number }

/** How many such failures in a row for one batch halve it. */
export const THROWS_TO_HALVE = 2

/**
 * The run after one more such failure for the batch with key signature `batch`: it counts
 * up for the same batch and starts at 1 for another. At THROWS_TO_HALVE the caller halves the
 * batch, as for a reply that does not parse, and the run starts over.
 */
export function nextThrows(before: BatchThrows | undefined, batch: string): BatchThrows {
  return { batch, count: before !== undefined && before.batch === batch ? before.count + 1 : 1 }
}
