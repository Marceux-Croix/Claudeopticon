import { expect, test } from 'claude-code/testing'

import { manifestVersion } from '../hooks/plugin-version'

test('manifestVersion reads the version of a plugin.json', () => {
  expect(manifestVersion('{ "name": "claudeopticon", "version": "0.9.12" }')).toBe('0.9.12')
  expect(manifestVersion('{ "version": "1.0.0-rc.1+b2" }')).toBe('1.0.0-rc.1+b2')
})

test('manifestVersion gives nothing for a missing, odd or unreadable version', () => {
  expect(manifestVersion('{ "name": "claudeopticon" }')).toBeUndefined()
  expect(manifestVersion('{ "version": 3 }')).toBeUndefined()
  expect(manifestVersion('{ "version": "<b>1</b>" }')).toBeUndefined()
  expect(manifestVersion('not json')).toBeUndefined()
})
