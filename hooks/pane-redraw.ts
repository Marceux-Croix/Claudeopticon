/** The redraw request of the pane, and the read of the mod's own version. */

import type { EngineInterface } from 'claude-code'
import { manifestVersion } from './plugin-version'
import { fsBounded } from './fs-bounds'
import { saveAgents } from './kept-store'
import { noteLive } from './series-trace'

/** The mod's version from its own plugin.json; undefined when the manifest cannot be read. */
export async function readPluginVersion($: EngineInterface): Promise<string | undefined> {
  const text: unknown = await fsBounded($, () => $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).catch(() => undefined)

  return typeof text === 'string' ? manifestVersion(text) : undefined
}

export function redraw($: EngineInterface): void {
  noteLive()
  $.ui.invalidate('ui.render')
  saveAgents($)
}
