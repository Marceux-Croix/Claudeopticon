import { expect, test } from 'claude-code/testing'

import { pruneTo } from '../hooks/key-prune'

// ---------------------------------------------------------------- 

/** Property: pruning keeps exactly the keys still in use, in the same map or set. */
test('pruneTo deletes the keys not kept, in place, from a map and a set', () => {
  const map = new Map([['a', 1], ['b', 2], ['c', 3]])
  const set = new Set(['a', 'b', 'c'])
  const keep = new Set(['a', 'c'])
  pruneTo(map, key => keep.has(key))
  pruneTo(set, key => keep.has(key))
  expect([...map.keys()]).toEqual(['a', 'c'])
  expect([...set]).toEqual(['a', 'c'])
  // Everything kept leaves it whole; nothing kept empties it.
  pruneTo(set, () => true)
  expect([...set]).toEqual(['a', 'c'])
  pruneTo(map, () => false)
  expect(map.size).toBe(0)
})
