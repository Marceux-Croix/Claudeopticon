import { expect, test } from 'claude-code/testing'

import { couldHold, keepsMissing, MISSING_CLAIM_MS } from '../hooks/claim-keeping'
import type { ClaimFolder } from '../hooks/claim-keeping'

const PRIMARY: ClaimFolder = { folder: '/repo/.claude_todo', rel: '.claude_todo', isOther: false }
const X: ClaimFolder = { folder: '/repo/mods/x/.claude_todo', rel: 'mods/x/.claude_todo', isOther: true }
const Y: ClaimFolder = { folder: '/repo/mods/y/.claude_todo', rel: 'mods/y/.claude_todo', isOther: true }
const ALL = [PRIMARY, X, Y]

/**
 * Property: a claim on a ticket the scan did not find stays only while a folder that could
 * hold it did not read, and only for MISSING_CLAIM_MS. Three states where the claim must end: the
 * ticket's own folder reads but another one does not (the V015), the claim at the limit
 * of the time bound, and (the population the fix keeps) the ticket's own folder unread, which keeps
 * it until the bound.
 */
test('one unreadable folder keeps only the claims it could hold, for a bounded time, in three constructed states', () => {
  const now = 10 * MISSING_CLAIM_MS
  // The ticket of mods/x is gone and mods/x reads; only the primary folder did not read: the claim ends.
  expect(keepsMissing('mods/x/.claude_todo::#t1', [PRIMARY], ALL, now, now)).toBe(false)
  // The same for an unread folder that is not the primary one, and for a primary claim.
  expect(keepsMissing('mods/x/.claude_todo::#t1', [Y], ALL, now, now)).toBe(false)
  expect(keepsMissing('#t1', [X, Y], ALL, now, now)).toBe(false)
  // At the limit of the bound: missed exactly MISSING_CLAIM_MS ago it ends; just inside, it stays.
  expect(keepsMissing('mods/x/.claude_todo::#t1', [X], ALL, now - MISSING_CLAIM_MS, now)).toBe(false)
  expect(keepsMissing('mods/x/.claude_todo::#t1', [X], ALL, now - MISSING_CLAIM_MS + 1, now)).toBe(true)
  // Kept: the ticket's own folder did not read.
  expect(keepsMissing('mods/x/.claude_todo::#t1', [X], ALL, now, now)).toBe(true)
  expect(keepsMissing('#t1', [PRIMARY], ALL, now, now)).toBe(true)
  expect(keepsMissing('#t1', [], ALL, now, now)).toBe(false)
})

test('a primary folder holds every key that names no other folder', () => {
  expect(couldHold('#t1', PRIMARY, ALL)).toBe(true)
  expect(couldHold('fix the parser', PRIMARY, ALL)).toBe(true)
  expect(couldHold('mods/x/.claude_todo::#t1', PRIMARY, ALL)).toBe(false)
  expect(couldHold('mods/x/.claude_todo::#t1', X, ALL)).toBe(true)
  expect(couldHold('mods/x/.claude_todo::#t1', Y, ALL)).toBe(false)
  // A folder with no repo path is named by its path.
  expect(couldHold('/repo/z/.claude_todo::#t1', { folder: '/repo/z/.claude_todo', isOther: true }, ALL)).toBe(true)
})
