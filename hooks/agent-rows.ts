/** The kept window of agent rows and the rows cut from it. */

import type { EngineInterface } from 'claude-code'
import type { AgentRow } from '../types'
import { setLabelBase } from './agent-identity'
import { KEPT_AGENTS, KEPT_CUT, MAX_BASE } from './kept-records'
import { sameRows } from './row-equality'
import { S, cutRowIds } from './state'

/**
 * The one way the rows change. Keeps at most KEPT_AGENTS in memory: the oldest go, and `agentBase`
 * grows by the number dropped, so a label stays the same (A201 stays A201). `rowsVersion` counts
 * real changes, which is all the store step compares: it never rebuilds the JSON to find out.
 */
export function setRows(next: AgentRow[]): void {
  let rows = next
  if (rows.length > KEPT_AGENTS) {
    const dropped = rows.length - KEPT_AGENTS
    // Never past MAX_BASE: a stored base past it reads back as 0, and every label would change on reload. The save toasts once when it is reached.
    S.agentBase = Math.min(MAX_BASE, S.agentBase + dropped)
    setLabelBase(S.agentBase)
    // The cut rows are remembered, so the agent list never adds them back as new rows.
    for (const row of rows.slice(0, dropped)) {
      cutRowIds.add(row.id)
    }
    S.cutRowVersion += 1
    while (cutRowIds.size > KEPT_CUT) {
      cutRowIds.delete(cutRowIds.values().next().value!)
    }
    rows = rows.slice(dropped)
  }
  if (!sameRows(S.agentRows, rows)) {
    S.rowsVersion += 1
  }
  S.agentRows = rows
}

export async function cutKey($: EngineInterface): Promise<string> {
  return `agents-cut:${await $.session.id()}`
}
