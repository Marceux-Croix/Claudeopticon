export type TodoStatus = 'pending' | 'queued' | 'in_progress' | 'completed'

export type TodoItem = {
  text: string
  status: TodoStatus
  /** The item's ID without its `#` (`T12`), when the line carries one. */
  id?: string
  /** The line's place among the lines of its file with the same key, from 2; absent for the first: keeps every line's key unique. */
  nth?: number
}

export type TodoFile = {
  /** The file's path under its `.claude_todo/` folder: `OPEN.md`, or `archive/OLD.md` for an archived one. */
  name: string
  /** The path of the `.claude_todo/` folder the file lives in, as the engine's fs takes it. Folder plus name identify a file. */
  folder: string
  /** The folder's path from the repo root, ending in `.claude_todo` (`mods/x/.claude_todo`); `folder` when not known. */
  rel?: string
  /** True for a folder other than the primary one (the nearest to the session folder): its item keys carry its place, so equal IDs stay apart. The pane never shows the folder. */
  isOther?: true
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
  /**
   * When the agent's last turn ended with nothing after it: the work is done, but the agent was
   * never stopped. Cleared by its next tool call or model request.
   */
  idleSince?: number
  /** The agent's own report through `report_progress`: steps done of its plan, and the current one. */
  progress?: Progress
  /** The todo items the agent says it handles, as it quoted them through `report_progress`. */
  claims?: string[]
  /** The todo items Haiku matched to the agent's task when it started, by their text. */
  autoClaims?: string[]
}

export type Progress = { done: number; total: number; step?: string }
