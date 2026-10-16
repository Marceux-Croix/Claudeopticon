export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  text: string
  status: TodoStatus
  /** The item's ID without its `#` (`T12`), when the line carries one. */
  id?: string
}

export type TodoFile = {
  /** The file's path under `.claude_todo/`: `OPEN.md`, or `archive/OLD.md` for an archived one. */
  name: string
  mtimeMs: number
  items: TodoItem[]
  /** True for a file in `.claude_todo/archive/`: finished work, listed in the completed ledger. */
  isArchived?: boolean
}

/** `ended`: the agent left the engine's agent list with no word of how it ended. */
export type AgentRowStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed' | 'ended'

export type AgentRow = {
  id: string
  description: string
  type: string
  model?: string
  status: AgentRowStatus
  startedAt: number
  endedAt?: number
  toolCalls: number
  /** The tokens of every model request the agent made, every kind summed. */
  tokens?: number
  doing?: string
  /** The description and the head of the prompt, lowercased, for linking to todo items. */
  brief: string
  /** What SendMessage addresses the agent by, when it has a name. */
  name?: string
  /** The agent's own report through `report_progress`: steps done of its plan, and the current one. */
  progress?: Progress
  /** The todo items the agent says it handles, as it quoted them through `report_progress`. */
  claims?: string[]
  /** The todo items Haiku matched to the agent's task when it started, by their text. */
  autoClaims?: string[]
}

export type Progress = { done: number; total: number; step?: string }
