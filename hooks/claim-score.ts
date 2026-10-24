/** How well a claimed line names a todo item, and the best item for each claim. */

import type { TodoItem } from '../types'
import { normalize } from './normalize'

const CLAIM_MIN_CHARS = 12
const CLAIM_MIN_WORDS = 3
const CLAIM_MIN_SHARE = 0.7

function words(text: string): Set<string> {
  return new Set(normalize(text).split(/[^a-z0-9]+/).filter(word => word.length >= 3))
}

/**
 * How well a claim names an item, from 0 to 1: 1 when it gives the item's ID or holds the item's
 * text (or the item holds the claim); else the share of the shorter one's words the two have in
 * common, counted only from 3 shared words and a 70% share, so a loose paraphrase still lands.
 */
export function claimScore(claim: string, item: TodoItem): number {
  return scoreInfo(claimInfo(claim), itemInfo(item))
}

/** A claim worked out once: its normalized text, the item IDs it names (as whole IDs), and its words. */
type ClaimInfo = { c: string; ids: Set<string>; a: Set<string> }
/** An item worked out once per todo version: its lowercase ID, normalized text and words. */
export type ItemInfo = { id?: string; t: string; b: Set<string> }

export function claimInfo(claim: string): ClaimInfo {
  const c = normalize(claim)

  // One scan for every `#id` in the claim: `#t1` does not match `#t12`, as the whole run of letters and digits is the ID.
  return { c, ids: new Set([...c.matchAll(/#([0-9a-z]+)/g)].map(match => match[1]!)), a: words(claim) }
}

export function itemInfo(item: TodoItem): ItemInfo {
  return { ...(item.id === undefined ? {} : { id: item.id.toLowerCase() }), t: normalize(item.text), b: words(item.text) }
}

export function scoreInfo(claim: ClaimInfo, item: ItemInfo): number {
  if (item.id !== undefined && claim.ids.has(item.id)) {
    return 1
  }
  const { c, a } = claim
  const { t, b } = item
  if (Math.min(c.length, t.length) >= CLAIM_MIN_CHARS && (t.includes(c) || c.includes(t))) {
    return 1
  }
  let shared = 0
  for (const word of a) {
    if (b.has(word)) {
      shared += 1
    }
  }
  const share = shared / Math.max(1, Math.min(a.size, b.size))

  return shared >= CLAIM_MIN_WORDS && share >= CLAIM_MIN_SHARE ? share : 0
}

/** For each claim, the one item that best matches it, if any matches (see claimScore). The first of equal scores wins. */
export function bestMatches<T extends { item: TodoItem }>(open: readonly T[], claims: readonly string[]): T[] {
  // Each item is worked out once, not once per claim.
  const infos = open.map(link => itemInfo(link.item))

  return claims.flatMap(claim => {
    const info = claimInfo(claim)
    let best: T | undefined
    let top = 0
    open.forEach((link, i) => {
      const score = scoreInfo(info, infos[i]!)
      if (score > top) {
        top = score
        best = link
      }
    })

    return best === undefined ? [] : [best]
  })
}
