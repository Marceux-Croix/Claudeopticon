// Lets plain Node run the scripts: `node --import ./scripts/ts-resolve.mjs scripts/render-cards.ts`.
// Node (22.18 and later, 23.6 and later) strips TypeScript types by itself, but it resolves only
// imports that name their file: the hooks import `./card-text`, not `./card-text.ts`. This hook adds
// the `.ts` for a relative import that has no extension. No package is downloaded, so nothing floats
// (UCR-063: `npx -y tsx@x` pinned tsx alone, and its esbuild and get-tsconfig ranges floated).
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context)
      } catch {
        // Not a .ts file: resolve it as written.
      }
    }

    return next(specifier, context)
  },
})
