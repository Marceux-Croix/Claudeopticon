/**
 * The sources the read and write gates scan: every `[cm]?[jt]sx?` file of the mod
 * (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`), subfolders included, outside `tests/`
 * and outside `node_modules`, the git folder and the work folders `.claude_work` and `.claude_todo`. The
 * engine loads `.mts`, `.jsx` and modules outside `hooks/` (`../lib/x`) as well as a top-level `.ts`
 * file, so a gate that read only `hooks/` could miss a call. A file is named by its path from
 * `hooks/` (`register.tsx`, `sub/evil.ts`, `../lib/evil.ts`), the names the scan's layer and allowed
 * entries use. Symlinks are not followed: a linked file or folder is named, so the gate fails, rather
 * than read from outside the mod.
 *
 * The walk takes its file system calls as a port, so the plugin test harness (which gives a test no
 * `node:fs`) can run it on a fake disk; `node-sources.ts` binds it to the real one.
 */

/** The file system calls the walk makes: the names in a folder, what one is (a link is not followed), and the text of a file. */
export type SourcePort = {
  list: (dir: string) => string[]
  kind: (path: string) => 'dir' | 'link' | 'file'
  read: (path: string) => string
}

/** The source extensions the gates read. */
const SOURCE = /\.[cm]?[jt]sx?$/

/** The folders of the mod root the gates never read: the tests (constructed sources, fakes) and tool folders. */
const SKIPPED = (rel: string, name: string): boolean => (rel === '' && name === 'tests') || ['node_modules', '.git', '.claude_work', '.claude_todo'].includes(name)

/** The name of a source by its path from the mod root: from `hooks/` for a file there, else `../` and its path. */
const nameOf = (path: string): string => (path.startsWith('hooks/') ? path.slice('hooks/'.length) : `../${path}`)

/** The sources under the mod folder `root` by name (`nameOf`), sorted, and the paths that are links (never read). */
export function hookSourcesFrom(port: SourcePort, root: string): { sources: Record<string, string>; links: string[] } {
  const sources: Record<string, string> = {}
  const links: string[] = []
  const walk = (rel: string) => {
    const dir = rel === '' ? root : `${root}/${rel}`
    for (const name of port.list(dir).sort()) {
      const path = rel === '' ? name : `${rel}/${name}`
      const kind = port.kind(`${root}/${path}`)
      if (kind === 'dir' && SKIPPED(rel, name)) {
        continue
      }
      if (kind === 'link') {
        links.push(path)
      } else if (kind === 'dir') {
        walk(path)
      } else if (SOURCE.test(name)) {
        sources[nameOf(path)] = port.read(`${root}/${path}`)
      }
    }
  }
  walk('')

  return { sources, links }
}
