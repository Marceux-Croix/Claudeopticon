import { expect, test } from 'claude-code/testing'

import { callDetail, callSummary, describeCall, DETAIL_MAX, hideDoing } from '../hooks/tool-calls'

test('describeCall', async () => {
  expect(describeCall('Bash', { command: 'ls -la\nmore' })).toBe('Bash: ls -la')
})

test('callDetail gives the native detail per tool, relative paths, one line, hidden secrets and no repeat of the summary', () => {
  const root = '/repo'
  expect(callDetail('Bash', { command: 'npm test -- --run\nnext line' }, 'Run tests', root)).toBe('npm test -- --run')
  expect(callDetail('Read', { file_path: '/repo/src/a.ts' }, 'Read: /repo/src/a.ts', root)).toBe('src/a.ts')
  expect(callDetail('Edit', { file_path: '/elsewhere/a.ts' }, 'x', root)).toBe('/elsewhere/a.ts')
  expect(callDetail('Write', { file_path: '/repo/b.md' }, 'x', root)).toBe('b.md')
  expect(callDetail('NotebookEdit', { notebook_path: '/repo/n.ipynb' }, 'x', root)).toBe('n.ipynb')
  expect(callDetail('Grep', { pattern: 'foo.*bar' }, 'x', root)).toBe('foo.*bar')
  expect(callDetail('Grep', { pattern: 'foo', path: '/repo/hooks' }, 'x', root)).toBe('foo  hooks')
  expect(callDetail('Glob', { pattern: '**/*.ts' }, 'x', root)).toBe('**/*.ts')
  expect(callDetail('WebFetch', { url: 'https://example.com/a' }, 'x', root)).toBe('https://example.com/a')
  expect(callDetail('WebSearch', { query: 'svg text fit' }, 'x', root)).toBe('svg text fit')
  expect(callDetail('Task', { subagent_type: 'reviewer', model: 'opus' }, 'x', root)).toBe('reviewer, opus')
  expect(callDetail('Agent', { subagent_type: 'reviewer' }, 'x', root)).toBe('reviewer')
  expect(callDetail('Skill', { skill: 'code-style' }, 'x', root)).toBe('code-style')
  expect(callDetail('mcp__x__tool', { query: 'q', url: 'u' }, 'x', root)).toBeUndefined()
  expect(callDetail('Bash', {}, 'x', root)).toBeUndefined()
  expect(callDetail('Bash', { command: 'ls' }, 'ls', root)).toBeUndefined()
  for (const command of ['curl --password hunter2 x', 'export TOKEN=abc', 'curl -H "Authorization: Bearer x" u', 'run --api_key k', 'echo SECRET=abc']) {
    expect(callDetail('Bash', { command }, 'x', root)).toBe('(hidden)')
  }
  // (H5): a variable named SECRET holds no secret in the text, so `echo $SECRET` is shown now.
  expect(callDetail('Bash', { command: 'echo $SECRET' }, 'x', root)).toBe('echo $SECRET')
  expect(callDetail('Bash', { command: 'a'.repeat(1000) }, 'x', root)?.length).toBe(300)
})

test('a secret is hidden behind a valid first line, past the detail limit, and in every detail type', () => {
  const root = '/repo'
  // State 1: a valid first line; the secret is on a later line.
  expect(callDetail('Bash', { command: 'npm test\nPGPASSWORD=hunter2 psql' }, 'x', root)).toBe('(hidden)')
  // State 2: the secret sits past the 300 characters that a detail keeps.
  expect(callDetail('Bash', { command: `${'a'.repeat(400)} --with-token hunter2` }, 'x', root)).toBe('(hidden)')
  // State 3: the tools that are not Bash.
  expect(callDetail('WebFetch', { url: 'https://example.com/a?access_token=hunter2' }, 'x', root)).toBe('(hidden)')
  expect(callDetail('WebFetch', { url: 'https://user:hunter2@example.com/a' }, 'x', root)).toBe('(hidden)')
  expect(callDetail('Grep', { pattern: 'ghp_abcdefghijklmnopqrstuvwxyz', path: '/repo/a' }, 'x', root)).toBe('(hidden)')
  expect(callDetail('WebSearch', { query: 'api_key=hunter2' }, 'x', root)).toBe('(hidden)')
  // (H5): a glob that names secret files holds no secret; a glob with a token shape does.
  expect(callDetail('Glob', { pattern: '**/ghp_abcdefghijklmnop*' }, 'x', root)).toBe('(hidden)')
  expect(callDetail('Glob', { pattern: '**/secret*' }, 'x', root)).toBe('**/secret*')
  expect(callDetail('WebFetch', { url: 'https://example.com/a' }, 'x', root)).toBe('https://example.com/a')
})

test('the title line of a call is hidden too: describeCall and callSummary without a description', () => {
  expect(describeCall('Bash', { command: 'curl --password hunter2 u' })).toBe('Bash: (hidden)')
  expect(describeCall('Bash', { command: 'ls\nPGPASSWORD=hunter2 psql' })).toBe('Bash: (hidden)')
  expect(describeCall('WebFetch', { url: 'https://example.com/a?access_token=hunter2' })).toBe('WebFetch: (hidden)')
  expect(describeCall('Bash', { command: 'npm test' })).toBe('Bash: npm test')
  expect(callSummary('Bash', { command: 'curl --password hunter2 u' })).toBe('Bash: (hidden)')
  expect(callSummary('Bash', { command: 'x', description: 'Call with sk-abcdefghijkl' })).toBe('Bash: (hidden)')
  expect(callSummary('Bash', { command: 'npm test', description: 'Run the tests' })).toBe('Run the tests')
})

// ---------------------------------------------------------------- 

test('a long call detail is cut at DETAIL_MAX without splitting a surrogate pair', () => {
  // The pair across the cut, just inside it, and at the start of a long text.
  for (const at of [DETAIL_MAX - 1, DETAIL_MAX - 2, 0]) {
    const detail = callDetail('Glob', { pattern: `${'a'.repeat(at)}\u{1F600}${'b'.repeat(400)}` }, 'x') ?? ''
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(detail)).toBe(false)
    expect(detail.length).toBeLessThanOrEqual(DETAIL_MAX)
  }
})

test('the narrowed forms are hidden in the detail and the title of a Bash call with no description', () => {
  for (const command of ['docker login -u bob -p hunter2', 'redis-cli -a hunter2', 'MYSQL_PWD=hunter2 mysql', 'export PW=hunter2', 'curl -d \'{"token": "hunter2"}\' u', 'zip -P hunter2 a.zip a', 'echo hunter2 | sudo -S ls', 'curl https://hooks.slack.com/services/T0/B0/X']) {
    expect([command, callDetail('Bash', { command }, 'x', '/repo')]).toEqual([command, '(hidden)'])
    expect([command, callSummary('Bash', { command })]).toEqual([command, 'Bash: (hidden)'])
  }
  expect(callSummary('Bash', { command: 'docker run -p 8080:80 image' })).toBe('Bash: docker run -p 8080:80 image')
})

// ---------------------------------------------------------------- (batch H5): a stored current-call line

test('a stored current-call line with a secret is hidden, its tool kept', () => {
  // State 1: a valid tool prefix, then the secret.
  expect(hideDoing('Bash: curl --password Hunter2xyz u')).toBe('Bash: (hidden)')
  // State 2: a line with no tool prefix, a Bash description as written.
  expect(hideDoing('Login PGPASSWORD=Hunter2xyz')).toBe('(hidden)')
  // State 3: inside the lines the check shows, a line that only names a secret word stays.
  expect(hideDoing('Bash: kubectl get secrets')).toBe('Bash: kubectl get secrets')
  expect(hideDoing('Starting')).toBe('Starting')
})
