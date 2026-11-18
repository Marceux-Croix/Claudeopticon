/** The agent.spawn hook: adds the progress note to a prompt and puts the new agent on the board. */

import type { EngineInterface, Next, AgentSpawnInput, AgentSpawnResult } from 'claude-code'
import type { AgentRow } from '../types'
import { respawnedRow } from './agent-respawn'
import { clock } from './card-format'
import { cutUnits } from './card-text'
import { normalize } from './normalize'
import { hideSecretLines } from './secrets'
import { matchNewAgents, refreshAgents } from './agent-refresh'
import { setRows } from './agent-rows'
import { S, endedHere, matchFailures, matchedAgents, nudgedAgents } from './state'
import { unlessStoreWaits } from './token-burn'

export async function onAgentSpawn($: EngineInterface, e: AgentSpawnInput, next: Next<'agent.spawn', AgentSpawnInput, AgentSpawnResult, { 'agent.spawn': AgentSpawnInput }>, progressTool: string, progressNote: string) {
  const spawned = await next(e.prompt.includes(progressTool) ? e : { ...e, prompt: `${e.prompt}${progressNote}` })
  try {
    if (spawned.agentId !== undefined) {
      const id = spawned.agentId
      const row: AgentRow = {
        id,
        // Drawn, stored and toasted as it is, so its secrets are hidden here.
        description: hideSecretLines(e.description),
        type: e.subagentType,
        model: spawned.model,
        status: 'running',
        startedAt: await $.clock.now(),
        toolCalls: 0,
        doing: 'Starting',
        // Secrets are hidden by line before normalize joins the lines; #IDs on a hidden line stay.
        brief: normalize(hideSecretLines(`${e.description}\n${cutUnits(e.prompt, 4000)}`)),
      }
      // A known ID (a resumed agent) keeps its row in place: its label, counts and tokens stay; its new task is matched and its end noted again.
      const known = S.agentRows.find(one => one.id === id)
      const placed = known === undefined ? row : respawnedRow(known, row)
      setRows(known === undefined ? [...S.agentRows, row] : S.agentRows.map(one => (one.id === id ? placed : one)))
      matchedAgents.delete(id)
      matchFailures.delete(id)
      nudgedAgents.delete(id)
      endedHere.delete(id)
      matchNewAgents($, [placed])
      // Not awaited while the store is stalled: a store that never answers never holds the Agent tool.
      await unlessStoreWaits(refreshAgents($))
    }
  } catch {
    // A failed redraw must never cost the spawn its answer.
  }

  return spawned
}
