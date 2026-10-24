/**
 * The mod's sources read from the real disk: `hookSourcesFrom` with node's file system calls. A symlink
 * is named with `lstat`, never followed.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { hookSourcesFrom } from './hook-sources.ts'

/** The sources under the mod folder `root` by name, and the paths that are links (never read). */
export function hookSources(root: string): { sources: Record<string, string>; links: string[] } {
  return hookSourcesFrom(
    {
      list: dir => readdirSync(dir),
      kind: path => {
        const stat = lstatSync(path)

        return stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : 'file'
      },
      read: path => readFileSync(path, 'utf8'),
    },
    root,
  )
}
