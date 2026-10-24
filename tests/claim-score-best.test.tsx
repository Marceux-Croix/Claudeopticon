import { expect, test } from 'claude-code/testing'

import { bestMatches, claimScore } from '../hooks/claim-score'
import type { TodoItem } from '../types'

const item = (text: string, id?: string): TodoItem => ({ text, status: 'pending', ...(id === undefined ? {} : { id }) }) as TodoItem

/** The pairwise form: each claim scored against each item, the first of equal scores kept. */
function reference<T extends { item: TodoItem }>(open: readonly T[], claims: readonly string[]): T[] {
  return claims.flatMap(claim => {
    const scored = open.map(link => ({ link, score: claimScore(claim, link.item) })).filter(one => one.score > 0)
    const best = scored.sort((x, y) => y.score - x.score)[0]

    return best === undefined ? [] : [best.link]
  })
}

test('bestMatches picks what the pairwise score picks: an ID hit, a substring hit, a word-share hit, a miss and a tie', () => {
  const open = [
    { item: item('Refactor the payment parser module', 'T1') },
    { item: item('Write the release notes for the next version') },
    { item: item('Cache cleanup for the session store layer') },
    { item: item('Cache cleanup for the session store layer') },
  ]
  const claims = ['working on #T1 now', 'write the release notes for the next version today', 'session store cache cleanup layer for the', 'something that matches nothing at all here', 'cache cleanup for the session store layer']
  expect(bestMatches(open, claims)).toEqual(reference(open, claims))
  expect(bestMatches(open, claims)[0]).toBe(open[0])
  expect(bestMatches(open, ['something that matches nothing at all here'])).toEqual([])
  // A tie keeps the first item.
  expect(bestMatches(open, ['cache cleanup for the session store layer'])[0]).toBe(open[2])
})
