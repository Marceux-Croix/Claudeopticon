/** The number and time formats on the cards: token counts, durations, plurals and clock times. */

/** "950", "84.3k", "1.23M", "17.38M", "1.50B": a token count, to 2 decimals in millions and billions and 1 in thousands. */
export function tokens(n: number): string {
  // A value that is not a finite number shows as 0, as turnTokens counts it (UCR-155): never "NaN" or "InfinityB".
  if (!Number.isFinite(n)) {
    return '0'
  }
  // The unit is chosen after rounding: 999950 is 1.00M, not 1000.0k.
  if (n >= 1_000_000_000 || (n >= 1_000_000 && Number((n / 1_000_000).toFixed(2)) >= 1000)) {
    return `${(n / 1_000_000_000).toFixed(2)}B`
  }
  if (n >= 1_000_000 || (n >= 1000 && Number((n / 1000).toFixed(1)) >= 1000)) {
    return `${(n / 1_000_000).toFixed(2)}M`
  }

  // Rounded before the unit is chosen (UCR-216): 999.6 rounds to 1000, so it is "1.0k", never "1000".
  return Math.round(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)

  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** "1 agent", "3 agents" (TXT-4). */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** A wall-clock time in the local time zone, `14:32:05`. */
export function clock(ms: number): string {
  const at = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
}
