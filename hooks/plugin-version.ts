// The mod's version as its manifest states it: read from plugin.json at each load, so the pane shows the revision that runs.

/** The longest version drawn; a longer one is not a version this mod writes. */
const MAX_VERSION_CHARS = 32

/** The `version` of a plugin.json text: a short string of version characters, else undefined. */
export function manifestVersion(text: string): string | undefined {
  try {
    const version: unknown = (JSON.parse(text) as { version?: unknown }).version

    return typeof version === 'string' && version.length <= MAX_VERSION_CHARS && /^[0-9A-Za-z.+-]+$/.test(version) ? version : undefined
  } catch {
    return undefined
  }
}
