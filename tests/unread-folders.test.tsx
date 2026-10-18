import { expect, test } from 'claude-code/testing'

import { foldersWithUnread } from '../hooks/unread-folders'

const FOLDERS = [
  { folder: '/repo/.claude_todo', rel: '.claude_todo' },
  { folder: '/repo/mods/x/.claude_todo', rel: 'mods/x/.claude_todo', isOther: true },
  { folder: '/elsewhere/.claude_todo' },
]

/**
 * Property (UCR-127): a place that did not read marks only the folder that holds it. States: a file
 * of the second folder, the second folder's archive (a folder-level place), a folder named by its
 * path (no rel), and a place under no folder, which marks every folder.
 */
test('UCR-127 foldersWithUnread marks only the folder of each unread place', () => {
  expect([...foldersWithUnread([], FOLDERS)]).toEqual([])
  expect([...foldersWithUnread(['mods/x/.claude_todo/TODO.md'], FOLDERS)]).toEqual(['/repo/mods/x/.claude_todo'])
  expect([...foldersWithUnread(['mods/x/.claude_todo/archive'], FOLDERS)]).toEqual(['/repo/mods/x/.claude_todo'])
  expect([...foldersWithUnread(['.claude_todo'], FOLDERS)]).toEqual(['/repo/.claude_todo'])
  expect([...foldersWithUnread(['/elsewhere/.claude_todo/A.md'], FOLDERS)]).toEqual(['/elsewhere/.claude_todo'])
  // A prefix that is not a folder boundary does not match: `.claude_todoX` is not under `.claude_todo`, so it marks every folder.
  expect([...foldersWithUnread(['.claude_todoX/A.md'], FOLDERS)].length).toBe(3)
})

/** A folder nested in another's label takes only its own places: the longest label wins. */
test('UCR-127 foldersWithUnread gives a place to the longest folder label it falls under', () => {
  const nested = [{ folder: '/r/a', rel: 'a' }, { folder: '/r/a/b', rel: 'a/b' }]
  expect([...foldersWithUnread(['a/b/T.md'], nested)]).toEqual(['/r/a/b'])
  expect([...foldersWithUnread(['a/T.md'], nested)]).toEqual(['/r/a'])
})
