/**
 * The sources the read and write gates scan (UCR-121, UCR-233): every `[cm]?[jt]sx?` file of the mod
 * (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`), subfolders included, outside `tests/`
 * and outside `node_modules`, the git folder and the work folders `.claude_work` and `.claude_todo`. The
 * engine loads `.mts`, `.jsx` and modules outside `hooks/` (`../lib/x`) as well as a top-level `.ts`
 * file, so a gate that read only `hooks/` could miss a call. A file is named by its path from
 * `hooks/` (`register.tsx`, `sub/evil.ts`, `../lib/evil.ts`), the names the scan's layer and allowed
 * entries use. Symlinks are not followed: a linked file or folder is named, so the gate fails, rather
 * than read from outside the mod.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs'

/** The source extensions the gates read. */
const SOURCE = /\.[cm]?[jt]sx?$/

/** The folders of the mod root the gates never read: the tests (constructed sources, fakes) and tool folders. */
const SKIPPED = (rel: string, name: string): boolean => (rel === '' && name === 'tests') || ['node_modules', '.git', '.claude_work', '.claude_todo'].includes(name)

/** The name of a source by its path from the mod root: from `hooks/` for a file there, else `../` and its path. */
const nameOf = (path: string): string => (path.startsWith('hooks/') ? path.slice('hooks/'.length) : `../${path}`)

/** The sources under the mod folder `root` by name (`nameOf`), sorted, and the paths that are links (never read). */
export function hookSources(root: string): { sources: Record<string, string>; links: string[] } {
  const sources: Record<string, string> = {}
  const links: string[] = []
  const walk = (rel: string) => {
    const dir = rel === '' ? root : `${root}/${rel}`
    for (const name of readdirSync(dir).sort()) {
      const path = rel === '' ? name : `${rel}/${name}`
      const stat = lstatSync(`${root}/${path}`)
      if (stat.isDirectory() && SKIPPED(rel, name)) {
        continue
      }
      if (stat.isSymbolicLink()) {
        links.push(path)
      } else if (stat.isDirectory()) {
        walk(path)
      } else if (SOURCE.test(name)) {
        sources[nameOf(path)] = readFileSync(`${root}/${path}`, 'utf8')
      }
    }
  }
  walk('')

  return { sources, links }
}
