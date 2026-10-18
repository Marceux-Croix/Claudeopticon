/**
 * The read-layer gate: runs the source scan of `tests/read-scan.ts` on every
 * source of the mod outside `tests/` (`hook-sources.ts`) and exits 1 on any read of a todo file that
 * does not go through the read layer, any read that catches a failure into an empty value, and any
 * way around the `fs.read(` text (an alias of `$.fs`, a destructured or bound read). The plugin test
 * harness cannot read source files, so this step runs with plain node, from the mod folder:
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/check-reads.ts
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hookSources } from './hook-sources.ts'
import { unroutedReads } from '../tests/read-scan.ts'

const mod = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Every source of the mod outside tests/, any [cm]?[jt]sx? file; a symlink fails the gate, never read.
const { sources, links } = hookSources(mod)
if (links.length > 0) {
  console.error(`check-reads: symlinks in the mod, not scanned: ${links.join(', ')}`)
  process.exit(1)
}
const found = unroutedReads(sources)
if (Object.keys(sources).length === 0) {
  console.error(`check-reads: no source files in ${mod}`)
  process.exit(1)
}
if (found.length > 0) {
  console.error(`check-reads: ${found.length} unrouted read(s) (paths from hooks/):`)
  for (const one of found) {
    console.error(`  ${one}`)
  }
  process.exit(1)
}
console.log(`check-reads: ${Object.keys(sources).length} files, every todo read goes through the read layer.`)
