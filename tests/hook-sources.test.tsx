import { expect, test } from 'claude-code/testing'

import { hookSourcesFrom } from '../scripts/hook-sources'
import type { SourcePort } from '../scripts/hook-sources'

/** A fake disk: a path maps to the text of a file, 'dir', or 'link'. */
function disk(entries: Record<string, string>): { port: SourcePort; reads: string[] } {
  const reads: string[] = []
  const port: SourcePort = {
    list: dir => [...new Set(Object.keys(entries).filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0]!))],
    kind: path => (entries[path] === 'dir' ? 'dir' : entries[path] === 'link' ? 'link' : 'file'),
    read: path => {
      reads.push(path)

      return entries[path]!
    },
  }

  return { port, reads }
}

test('hookSources names a file under hooks/ by its path from hooks/, and any other file by ../ and its path', () => {
  const { port } = disk({
    '/repo/hooks': 'dir',
    '/repo/hooks/register.tsx': 'a',
    '/repo/hooks/sub': 'dir',
    '/repo/hooks/sub/evil.ts': 'b',
    '/repo/lib': 'dir',
    '/repo/lib/x.mjs': 'c',
    '/repo/notes.md': 'not a source',
  })
  expect(hookSourcesFrom(port, '/repo').sources).toEqual({ 'register.tsx': 'a', 'sub/evil.ts': 'b', '../lib/x.mjs': 'c' })
})

test('hookSources skips tests/ at the mod root only, and node_modules, .git and the work folders anywhere', () => {
  const { port, reads } = disk({
    '/repo/tests': 'dir',
    '/repo/tests/fake.ts': 'fake',
    '/repo/hooks': 'dir',
    '/repo/hooks/tests': 'dir',
    '/repo/hooks/tests/real.ts': 'kept',
    '/repo/hooks/node_modules': 'dir',
    '/repo/hooks/node_modules/dep.js': 'dep',
    '/repo/.git': 'dir',
    '/repo/.git/hook.js': 'hook',
    '/repo/.claude_work': 'dir',
    '/repo/.claude_work/scratch.ts': 'scratch',
    '/repo/hooks/.claude_todo': 'dir',
    '/repo/hooks/.claude_todo/x.ts': 'todo',
  })
  expect(hookSourcesFrom(port, '/repo').sources).toEqual({ 'tests/real.ts': 'kept' })
  expect(reads).toEqual(['/repo/hooks/tests/real.ts'])
})

test('hookSources names a symlinked file or folder and never reads through it', () => {
  const { port, reads } = disk({
    '/repo/hooks': 'dir',
    '/repo/hooks/linked.ts': 'link',
    '/repo/hooks/outside': 'link',
    '/repo/hooks/outside/secret.ts': 'beyond the mod',
    '/repo/hooks/ok.ts': 'ok',
  })
  const found = hookSourcesFrom(port, '/repo')
  expect(found.links).toEqual(['hooks/linked.ts', 'hooks/outside'])
  expect(found.sources).toEqual({ 'ok.ts': 'ok' })
  expect(reads).toEqual(['/repo/hooks/ok.ts'])
})

test('hookSources reads every source extension the engine loads', () => {
  const names = ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']
  const { port } = disk(Object.fromEntries([['/repo/hooks', 'dir'], ...names.map(name => [`/repo/hooks/${name}`, name])]))
  expect(Object.keys(hookSourcesFrom(port, '/repo').sources).sort()).toEqual([...names].sort())
})
