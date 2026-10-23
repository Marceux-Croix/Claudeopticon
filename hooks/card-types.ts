/** The view the cards draw: todo files, items, agents and the drawn card. */

import type { Axes, Series } from './series'

export type ItemStatus = 'pending' | 'queued' | 'in_progress' | 'completed'

export type ItemView = {
  text: string
  status: ItemStatus
  owners: number[]
  /** The item's stable key: its ID (`#t12`) when it has one, else its normalized text; qualified by folder outside the primary folder. */
  key: string
  /** The key without the folder: how the line is found in its file. Same as `key` when absent. */
  localKey?: string
  /** The source of the item, which the pane never shows: its folder, its file in that folder, and its path from the repo root. */
  folder?: string
  file?: string
  path?: string
  /** Shown in progress only because a live agent works on it: the status its box still holds, open (`- [ ]`) or queued (`- [>]`). */
  heldFrom?: 'pending' | 'queued'
  /**
   * Claimed by another session on this repo (#T008R); `name` is that session's name, absent when it never gave one.
   * `isPlanned`: the peer only plans the ticket (its planned list) and the box is queued, so the card stays in Queued (#T008U).
   *   Without it, the peer works on the ticket and the card shows in In progress, as on the peer's own board (#T008Y).
   * `silentSince`: the peer's record is older than PEER_DIM_MS; the time it was last refreshed, clock ms. Drawn as a tag; no Send.
   */
  peer?: { name?: string; isPlanned?: true; silentSince?: number }
}

export type FileView = {
  /** The file's path inside its folder. */
  name: string
  /** The file's ID in the pane: its name, or its folder and name when another file has that name. */
  id: string
  /** Where its folder sits in the repo (no `.claude_todo`); empty at the root. Shown only to tell same-named files apart. */
  place?: string
  done: number
  active: number
  total: number
  owners: number[]
  items: ItemView[]
  mtimeMs: number
  isArchived?: boolean
  /** True for a todo file with nothing in it, such as one Consolidate emptied: its header row says Empty until Delete empty todos removes it. */
  isEmpty?: boolean
  /** Category headings inside the card: each names the index of its first item. */
  groups?: { name: string; from: number; count: number }[]
}

export type AgentView = {
  index: number
  /** The agent's ID, which stays while `index` shifts when old rows are cut. Absent for the orchestrator. */
  id?: string
  description: string
  type: string
  model?: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed' | 'ended'
  isEnded: boolean
  startedAt: number
  endedAt?: number
  toolCalls: number
  /** The tokens of every model request the agent made, every kind summed. */
  tokens?: number
  /** Its last turn ended and nothing followed: finished, but never stopped. Not live. */
  isIdle?: boolean
  idleSince?: number
  doing?: string
  /** The open todo items the agent works on, by text. */
  links: string[]
  progress?: { done: number; total: number; step?: string }
}

export type View = {
  /** Every todo file, those with open items first; each carries all its items: linked, in progress, open, done. */
  files: FileView[]
  agents: AgentView[]
  /**
   * The main conversation, when it owns a ticket: drawn as an agent card before A1 (index ORCH),
   * and not one of `agents`, so no count or timeline holds it. Running during a turn, else idle.
   */
  orchestrator?: AgentView
  /** Counts over the files at the top of `.claude_todo/` plus the done tickets of every archive file, so moving a ticket to the archive leaves them as they were. */
  done: number
  active: number
  total: number
  /** Done tickets in the archive files: the number on the Show completed link. */
  archived: number
  live: number
  now: number
  /** The mod's version from its manifest, drawn small in the hero card's lower right corner (#T0050); absent until read. */
  version?: string
  /** The session's token burn, when the mod has counted any. */
  usage?: Usage
  /** What the top card plots, and the axes it plots on (held by the pane across draws). */
  series?: Series
  axes?: Axes
}

/**
 * Tokens the session has used, main conversation and subagents, every kind (input, output, cache
 * read and cache write) summed from each model request (turn.step); what the total stood at when
 * the conversation last compacted, and when that was (so a load can mark it); and since when the
 * mod has counted.
 */
export type Usage = { tokens: number; atCompact?: number; compactAt?: number; since: number }

/** A drawn card: its SVG and its size in CSS pixels, so the pane sizes its frame to it. */
/** `isInteractive` draws the card in the sandboxed frame, where its `<title>` tooltips show. */
export type Card = { source: string; width: number; height: number; alt: string; isInteractive?: true }
