/**
 * The write-layer gate: runs the source scan of
 * `tests/write-scan.ts` on every source of the mod outside `tests/` (`hook-sources.ts`) and exits 1 on
 * any write of a todo file that does not go through `writeIfUnchanged`, and any way around the
 * `fs.write(` text. The plugin test harness cannot read source files, so this step runs with plain
 * node, from the mod folder:
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/check-writes.ts
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hookSources } from './hook-sources.ts'
import { unroutedWrites } from '../tests/write-scan.ts'

const mod = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Every source of the mod outside tests/, any [cm]?[jt]sx? file; a symlink fails the gate, never read.
const { sources, links } = hookSources(mod)
if (links.length > 0) {
  console.error(`check-writes: symlinks in the mod, not scanned: ${links.join(', ')}`)
  process.exit(1)
}
if (Object.keys(sources).length === 0) {
  console.error(`check-writes: no source files in ${mod}`)
  process.exit(1)
}
const found = unroutedWrites(sources)
if (found.length > 0) {
  console.error(`check-writes: ${found.length} write(s) outside the write layer (paths from hooks/):`)
  for (const one of found) {
    console.error(`  ${one}`)
  }
  process.exit(1)
}
console.log(`check-writes: ${Object.keys(sources).length} files, every todo write goes through writeIfUnchanged.`)
