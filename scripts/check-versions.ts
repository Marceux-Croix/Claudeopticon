/**
 * The version gate: the plugin manifest and the marketplace entry name one version. A marketplace entry that
 * lags the manifest makes `claude plugin validate` warn and shows users an old version at install. Plain node,
 * from the mod folder:
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/check-versions.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mod = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string): unknown => JSON.parse(readFileSync(`${mod}/.claude-plugin/${file}`, 'utf8'))
const manifest = (read('plugin.json') as { version?: unknown }).version
const listed = ((read('marketplace.json') as { plugins?: { version?: unknown }[] }).plugins ?? []).map(entry => entry.version)
if (typeof manifest !== 'string' || listed.length === 0 || listed.some(version => version !== manifest)) {
  console.error(`check-versions: plugin.json says ${String(manifest)}, marketplace.json says ${listed.map(String).join(', ') || 'no plugin'}`)
  process.exit(1)
}
console.log(`check-versions: plugin.json and marketplace.json both say ${manifest}.`)
