import { expect, test } from 'claude-code/testing'

import { PROGRESS_MAX, progressReply, readClaims, readProgress, readTitle } from '../hooks/progress-report'

test('readProgress keeps a report sane: whole steps, at least one planned, never more done than planned', async () => {
  expect(readProgress({ done: 3, total: 7, step: ' Run tests ' })).toEqual({ done: 3, total: 7, step: 'Run tests' })
  expect(readProgress({ done: 9, total: 4 })).toEqual({ done: 4, total: 4 })
  expect(readProgress({ done: -2, total: 0 })).toEqual({ done: 0, total: 1 })
  expect(readProgress({ done: 'x', total: 5 })).toBeUndefined()
  expect(readProgress({})).toBeUndefined()
})

/** Property: a report is read only when its counts are numbers (or numeric text), and its plan is held to PROGRESS_MAX steps. */
test('readProgress refuses counts that are no numbers and caps a huge plan: a valid report first, the counts at their limits, and the refused forms', () => {
  // State 1: a valid report, then a null total or done: no report, not "0 of 1".
  expect(readProgress({ done: 2, total: 5 })).toEqual({ done: 2, total: 5 })
  expect(readProgress({ done: '2', total: '5' })).toEqual({ done: 2, total: 5 })
  expect(readProgress({ done: null, total: null })).toBeUndefined()
  expect(readProgress({ done: 1, total: null })).toBeUndefined()
  expect(readProgress({ done: null, total: 3 })).toBeUndefined()
  // State 2: at the limits: the cap is kept, more is cut to it, 1e300 too.
  expect(readProgress({ done: PROGRESS_MAX, total: PROGRESS_MAX })).toEqual({ done: PROGRESS_MAX, total: PROGRESS_MAX })
  expect(readProgress({ done: 1, total: PROGRESS_MAX + 1 })).toEqual({ done: 1, total: PROGRESS_MAX })
  expect(readProgress({ done: 1e300, total: 1e300 })).toEqual({ done: PROGRESS_MAX, total: PROGRESS_MAX })
  // State 3: the forms Number() reads as 0 or a number: empty text, a space, a boolean, an array; and Infinity.
  for (const bad of ['', ' ', true, false, [], [3], {}, Number.POSITIVE_INFINITY, '1e400']) {
    expect([bad, readProgress({ done: 0, total: bad })]).toEqual([bad, undefined])
  }
})

/** Property: a title is hidden when it holds a secret before it is cut, so a cut cannot leave part of a secret the check no longer finds. */
test('readTitle hides a secret before the cut: a clean title first, a secret across the cut, and a secret inside the first line only', () => {
  // State 1: a clean title is kept.
  expect(readTitle('Fix the parser #T0037')).toBe('Fix the parser #T0037')
  // State 2: across the cut: a token of fixed length that the cut makes too short to know.
  const title = readTitle(`${'x'.repeat(65)} hf_abcdefghijklmnopqrstuvwxyz`) ?? ''
  expect(title).not.toContain('hf_')
  expect(title).toBe('(hidden)')
  // State 3: the secret on the first line, with an ID; a secret on a later line is cut away with it.
  expect(readTitle('Deploy DB_PASSWORD=Hunter2xyz #T0037')).toBe('(hidden) #T0037')
  expect(readTitle('Deploy\nDB_PASSWORD=Hunter2xyz')).toBe('Deploy')
})

test('the progress reply asks an agent to confirm its claim when one is due, and says only Noted otherwise', async () => {
  expect(progressReply(['fix the parser'], false)).toBe('Noted.')
  expect(progressReply(['fix the parser', 'ship it'], true)).toBe('Noted. You said you handle: "fix the parser"; "ship it". If that changed, pass the current items in your next report.')
  expect(progressReply(undefined, true)).toContain('pass them as items')
})

test('readTitle cuts at a carriage return and strips control characters', () => {
  expect(readTitle('First\rsecond')).toBe('First')
  expect(readTitle('First\r\nsecond')).toBe('First')
  expect(readTitle('Po\x00l\x07ish\x1B the copy')).toBe('Polish the copy')
  expect(readTitle('\x00\x07')).toBeUndefined()
  expect(readTitle('a\x85b\x7Fc')).toBe('abc')
})

// ---------------------------------------------------------------- 

/** True when `text` holds half of a surrogate pair. */
const hasLone = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)

test('a progress step, a claim and the claim reply are cut whole: no surrogate pair is split', () => {
  // A pair across each cut: 120 for the step, 300 for a claim, 80 in the reply.
  const step = readProgress({ done: 1, total: 2, step: `${'a'.repeat(119)}\u{1F600}tail` })?.step ?? ''
  expect(hasLone(step)).toBe(false)
  expect(step).toBe('a'.repeat(119))
  const claim = readClaims({ items: [`${'b'.repeat(299)}\u{1F600}`] })?.[0] ?? ''
  expect(hasLone(claim)).toBe(false)
  expect(hasLone(progressReply([`${'c'.repeat(79)}\u{1F600}`], true))).toBe(false)
  // A pair that ends at the cut is kept whole.
  expect(readProgress({ done: 1, total: 2, step: `${'a'.repeat(118)}\u{1F600}x` })?.step).toBe(`${'a'.repeat(118)}\u{1F600}`)
})

// ---------------------------------------------------------------- 

/** Property: an agent's step and claims are read with every line that holds a secret hidden, ticket IDs kept. */
test('a step or claim with a secret is read hidden, its ticket IDs kept, in three states', () => {
  // Behind a valid first case: a clean step and a clean claim are read as they are.
  expect(readProgress({ done: 1, total: 3, step: 'Run the parser tests' })?.step).toBe('Run the parser tests')
  expect(readClaims({ items: ['#T0037', 'Ship the parser'] })).toEqual(['#T0037', 'Ship the parser'])
  // The secret itself, in the step and in a claim after a clean one.
  expect(readProgress({ done: 1, total: 3, step: 'export DB_PASSWORD=Hunter2xyz' })?.step).toBe('(hidden)')
  expect(readClaims({ items: ['#T2', 'psql postgres://admin:Hunter2xyz@db/x #T0037'] })).toEqual(['#T2', '(hidden) #T0037'])
  // At the limit of the cut: a secret across 120 (step) or 300 (claim) units is hidden before the cut, so no part of it stays.
  const longStep = `${'x'.repeat(110)} PGPASSWORD=Hunter2xyz`
  expect(readProgress({ done: 0, total: 1, step: longStep })?.step).toBe('(hidden)')
  const longClaim = `${'y'.repeat(290)} PGPASSWORD=Hunter2xyz #T0037`
  expect(readClaims({ items: [longClaim] })).toEqual(['(hidden) #T0037'])
  // Inside a multi-line step: only the line with the secret is hidden.
  expect(readProgress({ done: 0, total: 1, step: 'Deploy\nexport DB_PASSWORD=Hunter2xyz' })?.step).toBe('Deploy\n(hidden)')
})
