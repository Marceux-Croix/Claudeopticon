/**
 * The module-list gate: every `hooks/*.ts` file is named in the module list of CONTRIBUTING.md and in the module
 * table of docs/how-it-works.md. Plain node, from the mod folder:
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/check-modules.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mod = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modules = readdirSync(`${mod}/hooks`).filter(name => name.endsWith('.ts')).sort()
const problems: string[] = []
for (const doc of ['CONTRIBUTING.md', 'docs/how-it-works.md']) {
  const text = readFileSync(`${mod}/${doc}`, 'utf8')
  // A module is named in backticks, as `name.ts`; `register.tsx` is the one .tsx module and is not checked here.
  const named = new Set([...text.matchAll(/`([a-z][a-z0-9-]*\.ts)`/g)].map(one => one[1]!))
  for (const name of modules.filter(one => !named.has(one))) {
    problems.push(`${doc} does not name hooks/${name}`)
  }
}
if (problems.length > 0) {
  console.error(`check-modules: ${problems.length} problem(s):`)
  for (const one of problems) {
    console.error(`  ${one}`)
  }
  process.exit(1)
}
console.log(`check-modules: ${modules.length} modules, each named in CONTRIBUTING.md and docs/how-it-works.md.`)
