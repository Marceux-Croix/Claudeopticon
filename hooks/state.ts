/** The session state that more than one module reads or writes: the mutable object `S` and the shared collections. */

import type { AgentRow, TodoFile } from '../types'
import type { Failing } from './backoff'
import type { Usage } from './card-types'
import { emptyBook, SORT_BATCH } from './categories'
import type { CategoryBook } from './categories'
import type { ClaimFolder } from './claim-keeping'
import type { CopyMark } from './consolidate-marks'
import type { HeldBlock } from './id-blocks'
import type { OrchestratorEntry } from './orchestrator-history'
import type { TodoFolder } from './repo-folders'
import type { PeerClaim } from './peer-sessions'
import { emptySeries } from './series'
import type { BatchThrows } from './sort-queue'
import type { Axes, Series } from './series'
import type { Reservation } from './ticket-ids'
import { newLayout } from './ticket-spaces'
import type { TicketOrder } from './view-model'
import { NO_ROOM } from './agent-room'
import type { AgentRoom } from './agent-room'
import type { StoreGroup } from './kept-store'

/** When each agent's claim was last set or confirmed, by agent ID. */
export const claimCheckedAt = new Map<string, number>()

export const expandedFiles = new Set<string>()

/** Files whose long items show whole, past 8 lines, by the pane's file ID. */
export const openText = new Set<string>()

/**
 * The tickets the orchestrator handles itself, by stored item key (keptKey): the value is whether a
 * scan has seen the ticket in progress since the claim. A claim ends when the ticket is done, gone,
 * or back to open after it was seen in progress. A ticket an agent works on may be in here too.
 */
export const orchTickets = new Map<string, boolean>()

/** Categories the person hid, by name; their items leave the list and the board (search still finds them). */
export const hiddenCategories = new Set<string>()

/** Tickets already sent to Claude this session, by file and item key. */
export const sentTickets = new Set<string>()

export const layout = newLayout()

export const reservedIds = new Map<string, Reservation>()

/**
 * The store keys whose last call went unanswered for STORE_LIMIT_MS; an answer for the
 * key, a rejection included, takes it out. While any key is in it the store is stalled, and the
 * hooks do not wait on store work (unlessStoreWaits): a load would read that key again. By key, so
 * one key that never answers is not hidden by others that do.
 */
export const stalledKeys = new Set<string>()

/** The IDs of the rows cut from the kept window: kept per session, so neither a refresh nor a reload adds one back. */
export const cutRowIds = new Set<string>()

/** The groups whose stored value was read and merged: only these are ever saved, so a key that did not read is never written over. */
export const loadedGroups = new Set<StoreGroup>()

/** What was last stored for each key, as the stamp compared next time: set when the write resolved, never before. */
export const saved = new Map<string, unknown>()

/** The marks this session was done with since its last stored save: a store read never brings them back. */
export const droppedMarks = new Set<string>()

/** The programs a time-out toast named, so a hang is told once; a later answer in time clears its name. */
export const timedOutTold = new Set<string>()

/** Every ID each todo file held at any good read, by path: what a skipped file counts as. */
export const seenIdsOf = new Map<string, Set<string>>()

/** The files named in a "did not read" numbering toast: once each, until the file reads again. */
export const unreadToasted = new Set<string>()

/** The IDs this session gave from its blocks, lowercase: two picks of this session never give one ID. */
export const givenIds = new Set<string>()

/**
 * The todo files (`.md` or `.html`) outside the central folder that hold any text, top level and archive, by path
 *: while one is there, Consolidate todos has work left, whether or not the file has items.
 */
export const filledSources = new Set<string>()

/** The sort attempts that left an item unsorted, by key, with the text they saw. */
export const sortTries = new Map<string, { text: string; count: number }>()

/** The items whose reply did not parse when each was sent alone, by key, with the text they had: sent alone and last from then on. */
export const sortAlone = new Map<string, string>()

/** Agents already matched, or being matched, by agent ID: one model call per agent that is answered. */
export const matchedAgents = new Set<string>()

/** The match calls of each agent that failed in a row (thrown or unanswered), and when it is tried next. */
export const matchFailures = new Map<string, Failing>()

/**
 * The agents this session saw end for sure, by a Stop press or a task notification: a
 * list that still says they run lags behind (the engine list can trail TaskStop), so it never sets
 * them live again. A new spawn of the ID clears it. In memory only: after a reload the list rules.
 */
export const endedHere = new Set<string>()

/** Tool calls seen since the last refresh, per agent: written in one batch, not one redraw each. */
export const pendingTools = new Map<string, { calls: number; doing: string }>()

/** Tokens each agent's model requests used since the last refresh: they ride along like the tool calls. */
export const pendingTokens = new Map<string, number>()

/** The turns this load saw a step of, by agent and turn ID; for a turn first seen past its first step, the tokens counted since. */
export const seenTurns = new Map<string, number | undefined>()

/**
 * The model each agent's requests name. The spawn gives an agent's model, but an agent that was
 * already running when the mod loaded is known only from the agent list, which has none.
 */
export const stepModels = new Map<string, string>()

/** The agents already nudged, so each is named once. */
export const nudgedAgents = new Set<string>()

/** When each in-progress ticket of the orchestrator was last named in a prompt, by item key (per session, in memory). */
export const namedAt = new Map<string, number>()

/** When each claimed ticket was first not found, clock ms: the start of the bound on its claim. In memory only, so a reload starts each bound again. */
export const claimMissedAt = new Map<string, number>()

export type State = {
  /** Whether this load of the mod has tried to reopen a pane that carried an older title: once, failed or not. */
  isRetitled: boolean
  /**
   * What the pane draws, held by this session's own process. Each session runs its own copy of the
   * mod, so this can hold nothing but this session's project and agents. A hot reload starts it
   * over; the next scan and agent list fill it again within a few seconds.
   */
  todoFiles: TodoFile[]
  agentRows: AgentRow[]
  clockMs: number
  isTicketView: boolean
  usage: Usage | undefined
  orchestrator: { isActive: boolean; history: OrchestratorEntry[] }
  callCount: number
  /**
   * The tickets this session's main conversation planned: it set the box to `[>]` itself, or the mod queued a ticket it took
   * out of progress. By `ticketId`, as the presence record carries them. A planned ticket stays while its box is `[~]` or `[>]` (prunePlanned).
   * A hand move on the board and a helper's edit never add to it. Saved per session as `planned:<session id>`.
   */
  plannedTickets: ReadonlySet<string>
  /** The headline Claude gave the assignment it works on itself (report_progress `title`); per session, cleared with the last ticket. */
  orchTitle: string | undefined
  /** Which page of the history the card shows: 0 the newest. */
  orchestratorPage: number
  isFinishedShown: boolean
  /** True while the Recategorize request runs: a press is ignored. */
  isRecategorizing: boolean
  /** The line beside the Recategorize button, shown until `until` (clock ms); the tick clears it. */
  recatNote: { text: string; until: number } | undefined
  sortBy: 'file' | 'category'
  /** How the board orders each column's tickets: by group, or newest ID first. */
  ticketOrder: TicketOrder
  query: string
  /** The tallest the agent area was drawn this session, held so the board below it stays put. */
  agentRoom: AgentRoom
  /** Whether the pane holds that room at all: off by default, the reader turns it on (). */
  isRoomHeld: boolean
  /** The mod's version from its plugin.json, read at each load, for the hero card's corner. */
  pluginVersion: string | undefined
  /** What the top card plots; kept in the store per session, so a reload keeps the trace. */
  series: Series
  /** The axes the top card plots on: in memory, per session, stepped at each draw. */
  axes: Axes | undefined
  /** The last time any code here read the clock, ms: a sync stand-in for `$.clock.now()` in the render. */
  wallMs: number
  /** When the pane last redrew for a token report, and whether a later report still waits for its redraw (CLOCK_MS throttle). */
  lastBurnDraw: number
  isBurnDirty: boolean
  lastIdleDraw: number
  // ---------------------------------------------------------------- agents kept across a reload
  isAgentsLoaded: boolean
  /** The number of agents before `agentRows[0]`, so A201 stays A201 after a reload drops older rows. */
  agentBase: number
  /** Bumped by each real change of the rows. */
  rowsVersion: number
  /** Bumped by each change of `cutRowIds`: the stamp its save compares. */
  cutRowVersion: number
  /** When this session last noted itself in the session list, clock ms; undefined before the first note. Set only by a note that was stored. */
  lastTouch: number | undefined
  /** When the last note failed, clock ms; undefined while no note failed. It is tried again SESSION_RETRY_MS later. */
  touchFailedAt: number | undefined
  isTouching: boolean
  /** True once the environment gave a usable home; false means every write is off (fail closed). Windows paths need no home: the text rule covers them. */
  globalsKnown: boolean
  globalsToasted: boolean
  /** True once a folder-list failure was told; a list that works clears it, so the next failure is told again. */
  listFailToasted: boolean
  /** The todo folders found but cut from the pane by MAX_FOLDERS; their ticket IDs still count. */
  cutFolders: string[]
  cutToasted: boolean
  /** The ticket IDs (lowercase) of every file in the cut folders, so a new ID never repeats one of theirs. */
  cutIds: string[]
  /** The ticket IDs of each file of the cut folders, by path, from its last good read. */
  cutIdsByFile: any
  /** The files of the cut folders that have not read once: their IDs are unknown, so new IDs wait for them (`diskIds`). */
  cutUnknown: any
  /** The repo root of the session, kept to name a folder found later by its place in the repo. */
  repoRoot: string | undefined
  /** The git common dir, absolute (`git rev-parse --git-common-dir`): where the ID claims live in every git layout. */
  gitCommon: string | undefined
  /** Where the central todo lives: the root of the main checkout (the repo root outside a worktree). */
  centralRoot: string | undefined
  /** Outside a repo (or when git fails): the session folder, whose own `.claude_todo` is the one folder trusted there. Undefined in a repo. */
  looseRoot: string | undefined
  /** The folders found when the mod started; undefined until then. Git runs once per load, and again after a reload, a Consolidate press, or a move of the session to another folder. */
  todoFolders: TodoFolder[] | undefined
  /** The nearest folder the last scan saw, to look it up among the known ones only when it changes. */
  nearestSeen: string | undefined
  /** True when the three todo-tidying buttons are off: a linked worktree, or a main folder that would be the global one. */
  centralBlocked: boolean
  /** The renumbered IDs Claude has not been told of yet. */
  pendingRenames: string[]
  /** The tickets the mod numbered by itself that Claude has not been told of yet. */
  pendingNumbered: string[]
  /** The duplicate tickets removed that Claude has not been told of yet. */
  pendingRemoved: string[]
  /** The empty todo files (`.md` or `.html`) of the known folders, found by the last scan: the Delete empty todos button's work. */
  emptyFiles: { folder: string; path: string; name: string; rel?: string }[]
  /** True when the central target file holds two or more identical tickets: the Delete duplicate tickets button's work. */
  hasDupTickets: boolean
  /** The reference renames (old lowercase ID to the kept one) that Delete duplicate tickets could not write into some central archive file: the next press tries them again. */
  refsToFix: Record<string, string>
  /**
   * The sources a Consolidate press copied into the target but did not empty, by path (`retryStep`
   * says what a retry does with each). Kept in the store per central folder (`marksKey`), so a reload
   * or another session knows them too; this map is the copy in memory, used when the store
   * cannot be read.
   */
  copiedNotEmptied: any
  isWorking: boolean
  /** The archive file the Show completed link opens; undefined until a scan has made sure it exists. */
  archiveLink: string | undefined
  isArchiving: boolean
  isNumbering: boolean
  /** The ID block this session gives IDs from: its number and when it was claimed, clock ms. */
  idBlock: HeldBlock | undefined
  /** The platform name, asked once: `uname -s`, else told by a file only macOS has. Empty when unknown. */
  unameCache: string | undefined
  /** The folders and files the last scan pass could not read: a ticket in one of them is not known to be gone. */
  unreadPlaces: string[]
  /** The folders of the last scan pass, and those of them with a place that did not read: a claim stays only while a folder that could hold it is among them. */
  scanFolders: ClaimFolder[]
  unreadFolders: ClaimFolder[]
  /** The folders of the last scan pass that list a `.md` or `.html` entry the scan does not read (a symlink): their book keys stay. */
  linkedFolders: any
  /** The number of the last scan pass started, and the callers waiting for a pass by its number. */
  passStarted: number
  // ---------------------------------------------------------------- categories
  book: CategoryBook
  bookDir: string | undefined
  isSorting: boolean
  lastSortAt: number | undefined
  /** How many sorts in a row failed on the model call or the write: each doubles the wait, up to 64 times 30 s. */
  sortFailures: number
  /** The run of failures that may be the items' fault for one batch: the second halves the batch. */
  sortThrows: BatchThrows | undefined
  /** The items of the next sort call: halved by each reply that does not parse, reset by one that does. */
  sortBatchSize: any
  /** Whether the toast for failures in a row was shown; shown again only after a sort is written. */
  isSortToastShown: boolean
  /**
   * The text of `categories.json` that the book in memory came from or was last written as:
   * null for no file. Each book write reads the file again first and compares it with this.
   */
  bookSeen: string | null | undefined
  lastClock: number
  /** The moves the user made by hand since Claude last heard: told with its next tool result or prompt. */
  pendingMoves: string[]
  /** The tickets the mod queued after Claude took them out of progress, told with the next tool result or prompt. */
  pendingStopped: string[]
  /** The claim lines waiting for Claude: a planned claim the mod recorded, and a ticket this session claims that a peer claims too. Each is told once. */
  pendingClaimed: string[]
  /** The open tickets Claude's text put off until later, told with the next tool result or prompt. */
  pendingDeferred: string[]
  /** This session's name as Claude last reported it (report_progress `session`), kept in its presence record. */
  sessionName: string | undefined
  /** The tickets live peer sessions on this repo claim, by ticketId, to the holder's name and last-seen time. */
  peerHeld: ReadonlyMap<string, PeerClaim>
  /** The session's token burn, kept in the store under its session ID, so a reload keeps the count. */
  isBurnLoaded: boolean
}

export const S: State = {
  isRetitled: false,
  todoFiles: [],
  agentRows: [],
  clockMs: 0,
  isTicketView: true,
  usage: undefined,
  orchestrator: { isActive: false, history: [] },
  callCount: 0,
  plannedTickets: new Set(),
  orchTitle: undefined,
  orchestratorPage: 0,
  isFinishedShown: false,
  isRecategorizing: false,
  recatNote: undefined,
  sortBy: 'file',
  ticketOrder: 'group',
  query: '',
  agentRoom: NO_ROOM,
  isRoomHeld: false,
  pluginVersion: undefined,
  series: emptySeries(),
  axes: undefined,
  wallMs: 0,
  lastBurnDraw: 0,
  isBurnDirty: false,
  lastIdleDraw: 0,
  isAgentsLoaded: false,
  agentBase: 0,
  rowsVersion: 0,
  cutRowVersion: 0,
  lastTouch: undefined,
  touchFailedAt: undefined,
  isTouching: false,
  globalsKnown: false,
  globalsToasted: false,
  listFailToasted: false,
  cutFolders: [],
  cutToasted: false,
  cutIds: [],
  cutIdsByFile: new Map<string, string[]>(),
  cutUnknown: new Set<string>(),
  repoRoot: undefined,
  gitCommon: undefined,
  centralRoot: undefined,
  looseRoot: undefined,
  todoFolders: undefined,
  nearestSeen: undefined,
  centralBlocked: false,
  pendingRenames: [],
  pendingNumbered: [],
  pendingRemoved: [],
  emptyFiles: [],
  hasDupTickets: false,
  refsToFix: {},
  copiedNotEmptied: new Map<string, CopyMark>(),
  isWorking: false,
  archiveLink: undefined,
  isArchiving: false,
  isNumbering: false,
  idBlock: undefined,
  unameCache: undefined,
  unreadPlaces: [],
  scanFolders: [],
  unreadFolders: [],
  linkedFolders: new Set<string>(),
  passStarted: 0,
  book: emptyBook(),
  bookDir: undefined,
  isSorting: false,
  lastSortAt: undefined,
  sortFailures: 0,
  sortThrows: undefined,
  sortBatchSize: SORT_BATCH,
  isSortToastShown: false,
  bookSeen: undefined,
  lastClock: 0,
  pendingMoves: [],
  pendingStopped: [],
  pendingClaimed: [],
  pendingDeferred: [],
  sessionName: undefined,
  peerHeld: new Map(),
  isBurnLoaded: false,
}
