import { expect, test } from 'claude-code/testing'

import { mergeToldLines, readToldLists } from '../hooks/told-notes'

test('readToldLists keeps well-formed lists and empties a damaged part', () => {
  expect(readToldLists({ renames: ['- a'], numbered: [1], removed: ['- b'] })).toEqual({ renames: ['- a'], numbered: [], removed: ['- b'] })
  expect(readToldLists(undefined)).toEqual({ renames: [], numbered: [], removed: [] })
  expect(readToldLists('x')).toEqual({ renames: [], numbered: [], removed: [] })
})

test('mergeToldLines puts the stored lines first and adds no line twice', () => {
  expect(mergeToldLines(['- b', '- c'], ['- a', '- b'])).toEqual(['- a', '- b', '- c'])
  expect(mergeToldLines([], [])).toEqual([])
})
