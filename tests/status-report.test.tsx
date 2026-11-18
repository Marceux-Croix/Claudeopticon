import { expect, test } from 'claude-code/testing'

import { fileKind, statusReport } from '../hooks/status-report'
import type { StatusData } from '../hooks/status-report'

const base: StatusData = {
  version: '1.2.3',
  projectRoot: '/repo/sub',
  repoRoot: '/repo',
  folders: [{ path: '/repo/.claude_todo', rel: '.claude_todo', isOther: false }, { path: '/repo/m/.claude_todo', rel: 'm/.claude_todo', isOther: true }],
  files: [
    { name: 'TODO.md', folder: '/repo/.claude_todo', rel: '.claude_todo', mtimeMs: 1, items: [{ text: 'a', status: 'pending' }, { text: 'b', status: 'in_progress' }, { text: 'c', status: 'completed' }, { text: 'd', status: 'queued' }, { text: 'e', status: 'pending' }] },
    { name: 'archive/OLD.html', folder: '/repo/m/.claude_todo', rel: 'm/.claude_todo', mtimeMs: 1, items: [{ text: 'z', status: 'completed' }], isArchived: true },
  ],
  emptyFiles: [{ folder: '/repo/.claude_todo', name: 'EMPTY.md' }],
  options: { rules: true, foundIssues: false },
  scannedAt: Date.UTC(2026, 10, 18, 12, 0, 0),
  unread: ['m/.claude_todo/BAD.md'],
}

test('the report states version, roots, folders, files with counts and kind, options, scan time and unread places', () => {
  expect(statusReport(base).split('\n')).toEqual([
    'Claudeopticon v1.2.3',
    'Project root: /repo/sub',
    'Repo root: /repo',
    'Todo folders (2):',
    '  .claude_todo (primary)',
    '  m/.claude_todo (other)',
    'Todo files (3):',
    '  .claude_todo/TODO.md: .md, 5 items (1 in progress, 1 queued, 2 open, 1 done)',
    '  m/.claude_todo/archive/OLD.html: .html, 1 items (0 in progress, 0 queued, 0 open, 1 done)',
    '  .claude_todo/EMPTY.md: .md, 0 items (empty)',
    'Options:',
    '  rules: true',
    '  foundIssues: false',
    'Last scan: 2026-11-18T12:00:00.000Z',
    'Unread (1): m/.claude_todo/BAD.md',
  ])
})

test('unknown values are named, and no unread place says none', () => {
  const text = statusReport({ ...base, version: undefined, projectRoot: undefined, repoRoot: undefined, folders: [], files: [], emptyFiles: [], unread: [] })
  expect(text).toContain('Claudeopticon (version not known)')
  expect(text).toContain('Project root: (not known)')
  expect(text).toContain('Repo root: (not known)')
  expect(text).toContain('Unread: none')
})

test('no file says none; the kind comes from the extension', () => {
  expect(statusReport({ ...base, files: [], emptyFiles: [] })).toContain('Todo files (0):\n  (none)')
  expect([fileKind('A.MD'), fileKind('a.html'), fileKind('a.txt')]).toEqual(['.md', '.html', 'other'])
})
