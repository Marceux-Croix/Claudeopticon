/** Ticket ID values: the base-36 number of an ID, the next free IDs, and how long a reservation lasts. */

/**
 * The IDs (lowercase) the mod reserved: it named them to Claude in a "Next free ticket IDs" line
 * (`offeredTo`: the session it told), or numbering is about to write them. They count as taken, so the mod never gives one
 * to a line. An ID leaves the map once a file holds it, or when `until` (ms) passes.
 * The reservations are kept per repo (the main checkout's root), not per session, so a session sees the
 * IDs the other sessions of the repo named. Each change is a read-modify-write of the repo's store key,
 * which two sessions can interleave, so the reservations alone cannot keep two sessions off one ID: the
 * ID block claims do (`claimAcross`, corrected this comment, which said they did).
 * `by` is the session that holds the ID (an offer or a numbering write). When two sessions hold one ID,
 * the store's holder keeps it and the other session gives it up and picks again (`heldBy`).
 */
export type Reservation = { until: number; offeredTo?: string; by?: string }

/** The session that holds a reservation: `by`, else the session it was offered to (entries stored before `by`); undefined when unknown. */
export const heldBy = (one: Reservation): string | undefined => one.by ?? one.offeredTo

/**
 * The IDs this session (`me`) holds in memory that the store gives to another holder: the ones this
 * session lost to a write of another session. An entry of no known holder counts as another's.
 */
export function lostIds(mine: ReadonlyMap<string, Reservation>, stored: Iterable<[string, Reservation]>, me: string, time: number): string[] {
  const lost: string[] = []
  for (const [id, one] of stored) {
    const held = mine.get(id)
    if (one.until > time && held !== undefined && heldBy(held) === me && heldBy(one) !== me) {
      lost.push(id)
    }
  }

  return lost
}
/** How long a reservation lasts if no file takes the ID. */
export const RESERVE_MS = 2 * 60 * 60 * 1000

/**
 * The longest `T` suffix that is read as a number at all: a longer `#T` word (`005`)
 * is a plain word. Leading zeros aside, VALUE_END below is the limit that counts.
 */
export const SUFFIX_MAX = 6

/**
 * The end of the number line: the first value that does not count, `T20000`. The
 * mod's form is 4 characters (`T0001` to `T9ZZZ`, 466,559 values); past `9ZZZ` the IDs go on at 5,
 * and the 5-character values that start with `1` (`T10000` to `T1ZZZZ`, 1,679,616 more) are the
 * margin. A `#T` word at or above it (a date-like tag `0` or ``, a placeholder
 * `Z`) is a plain word, so one stray tag, even in an example, never moves the next IDs for good
 * or uses up the line. The cost: a 5-character tag that starts with `1` (``) still counts.
 */
export const VALUE_END = 2 * 36 ** 4

/** A `T` ID that may count: a digit, then up to SUFFIX_MAX - 1 base-36 characters. */
const VALUED = new RegExp(`^[Tt](\\d[0-9A-Za-z]{0,${SUFFIX_MAX - 1}})$`)

/**
 * The base-36 value of a `T` ID (any case, no `#`); undefined for any other ID. The IDs the mod
 * creates are `T` and 4 base-36 characters (0-9, A-Z), the first a digit. An ID's value is its
 * suffix as a base-36 number (`25` is 77, `0026` is 78), so old and new IDs share one number line
 * and no value is handed out twice. A suffix longer than SUFFIX_MAX, or a value at or past
 * VALUE_END, has no value.
 */
export function ticketValue(id: string): number | undefined {
  const m = VALUED.exec(id)
  const value = m === null ? undefined : parseInt(m[1]!, 36)

  return value === undefined || value >= VALUE_END ? undefined : value
}

/** The ID of `ids` with the highest value on the number line, as given; undefined when none has a value. */
export function highestId(ids: Iterable<string>): string | undefined {
  let top: { id: string; value: number } | undefined
  for (const id of ids) {
    const value = ticketValue(id)
    if (value !== undefined && (top === undefined || value > top.value)) {
      top = { id, value }
    }
  }

  return top?.id
}

/**
 * The next `count` free ticket IDs (as `T0026`, no `#`): one past the highest value among `ids` and
 * past `floor` (a value: a block's start needs no ID form), the 4 characters padded with
 * zeros and uppercase. A value whose form starts with a letter is skipped. After `9ZZZ` there is no
 * room in 4 characters, so the IDs go on at 5 (`T10000`); every ID still starts with a digit. At
 * VALUE_END (`T20000`) the number line ends, so fewer than `count` come back: never an ID that
 * repeats one already given.
 */
export function nextTicketIds(ids: Iterable<string>, count: number, floor = 0): string[] {
  let next = Math.max(1, floor + 1)
  for (const id of ids) {
    const value = ticketValue(id)
    if (value !== undefined) {
      next = Math.max(next, value + 1)
    }
  }
  const out: string[] = []
  while (out.length < count && next < VALUE_END) {
    const suffix = next.toString(36).toUpperCase().padStart(4, '0')
    if (/^[A-Z]/.test(suffix)) {
      // Jump to the first value one character longer, whose form is `1` and zeros.
      next = 36 ** suffix.length
      continue
    }
    out.push(`T${suffix}`)
    next += 1
  }

  return out
}
