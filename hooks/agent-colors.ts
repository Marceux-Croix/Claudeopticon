/** Agent color slots: which agent color each agent holds, reused once an agent finishes. */

/** The fields of an agent that decide its slot: when it started, and when it finished, if it has. */
export type SlotAgent = { startedAt: number; endedAt?: number; idleSince?: number; isEnded: boolean }

/**
 * Each agent's color slot, by its index in `agents` (start order). An agent takes the lowest slot no
 * live agent holds when it starts, and keeps it; the slot is free again from the time the agent ends or
 * goes idle. An ended agent with no end time frees its slot at its start. When all slots are held, the
 * agent shares the slot with the fewest holders: a color may repeat, and no agent waits for one. The
 * replay depends only on agents that started earlier, so a new agent never changes the color of one
 * already drawn.
 */
export function colorSlots(agents: readonly SlotAgent[], slots: number): number[] {
  const order = agents.map((agent, i) => i).sort((a, b) => agents[a]!.startedAt - agents[b]!.startedAt || a - b)
  const result: number[] = new Array(agents.length).fill(0)
  const holders: { slot: number; until: number }[] = []

  for (const i of order) {
    const agent = agents[i]!
    const held = new Array(slots).fill(0)
    for (const holder of holders) {
      if (holder.until > agent.startedAt) {
        held[holder.slot] += 1
      }
    }
    const slot = held.indexOf(Math.min(...held))
    result[i] = slot
    holders.push({ slot, until: freedAt(agent) })
  }

  return result
}

function freedAt(agent: SlotAgent): number {
  if (agent.isEnded) {
    return agent.endedAt ?? agent.startedAt
  }

  return agent.idleSince ?? Infinity
}
