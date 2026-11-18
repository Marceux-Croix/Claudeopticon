// Engine case for /claudeopticon-status.

import { expect, mock, test } from 'claude-code/testing'

import { repoWith, open, clearMtimes } from './fake-repo'

// ----------------------------------------------------------------

test('/claudeopticon-status states the version, the roots, the files with their counts, the options and the scan time', async ($, on) => {
  clearMtimes()
  mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.claude_todo/TODO.md': '- [ ] #T0001 a\n- [~] #T0002 b\n- [x] #T0003 c',
    '/repo/.claude_todo/NOTES.html': '- [>] #T0004 d',
    '/repo/.claude_todo/plugin.json': '{"version":"1.2.3"}',
  }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md', '.claude_todo/NOTES.html', '.claude_todo/plugin.json'] })
  await open($)
  const answer = await $.command.run({ command: 'claudeopticon-status', args: '' } as never)
  const text = (answer as unknown as { text: string }).text
  expect(text.split('\n')[0]).toBe('Claudeopticon v1.2.3')
  expect(text).toContain('Repo root: /repo')
  expect(text).toContain('.claude_todo/TODO.md: .md, 3 items (1 in progress, 0 queued, 1 open, 1 done)')
  expect(text).toContain('.claude_todo/NOTES.html: .html, 1 items (0 in progress, 1 queued, 0 open, 0 done)')
  expect(text).toContain('rules: true')
  expect(text).toContain('foundIssues: true')
  expect(text).toMatch(/Last scan: \d{4}-\d\d-\d\dT/)
  expect(text).toContain('Unread: none')
})
