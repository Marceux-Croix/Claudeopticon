/** The report_progress replies: how a report, its claimed items and a title are read, and the reply to it. */

import type { Progress } from '../types'
import { cleanText, cutText, cutUnits } from './card-text'
import { hideSecretLines } from './secrets'

/**
 * An agent's report, held to sense: whole steps, at least one planned, never more done than planned.
 * A step line that holds a secret is hidden: the step is drawn and stored. It is hidden
 * before the cut, so a cut cannot leave a part of a secret the check no longer knows.
 */
export function readProgress(input: Record<string, unknown>): Progress | undefined {
  const total = Math.max(1, Math.round(Number(input.total)))
  const done = Math.min(total, Math.max(0, Math.round(Number(input.done))))
  if (!Number.isFinite(total) || !Number.isFinite(done)) {
    return undefined
  }
  const step = typeof input.step === 'string' && input.step.trim() !== '' ? cutUnits(hideSecretLines(input.step.trim()), 120) : undefined

  return step === undefined ? { done, total } : { done, total, step }
}

/**
 * The items an agent claims in a report: up to 20 quoted lines or IDs; undefined when it named none.
 * A claim line that holds a secret is hidden, its ticket IDs kept: claims are stored and
 * echoed in the reply, and an ID is enough to link.
 */
export function readClaims(input: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(input.items)) {
    return undefined
  }
  const claims = input.items
    .filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    .map(one => cutUnits(hideSecretLines(one.trim()), 300))
    .slice(0, 20)

  return claims.length === 0 ? undefined : claims
}

/** How long a claim stands before the next progress reply asks the agent to confirm it. */
export const CLAIM_CHECK_MS = 10 * 60_000

/**
 * The reply to a progress report. Every 10 minutes it asks the agent to confirm the items it
 * claimed, or, when it claimed none, to name them if its task covers any: about 40 tokens, carried
 * by a call the agent makes anyway.
 */
export function progressReply(claims: readonly string[] | undefined, isDue: boolean): string {
  if (!isDue) {
    return 'Noted.'
  }
  if (claims === undefined || claims.length === 0) {
    return 'Noted. If your task covers items in .claude_todo/, pass them as items in your next report.'
  }

  return `Noted. You said you handle: ${claims.map(claim => `"${cutUnits(claim, 80)}"`).join('; ')}. If that changed, pass the current items in your next report.`
}

/** A headline from the main conversation: a few words, one line, at most TITLE_MAX characters. */
export const TITLE_MAX = 80
export function readTitle(input: unknown): string | undefined {
  const text = typeof input === 'string' ? cutText(cleanText(input.trim().split(/[\r\n]/)[0] ?? '').replace(/[\x7F-\x9F]/g, '').trim(), TITLE_MAX) : ''

  return text === '' ? undefined : text
}
