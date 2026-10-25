/**
 * The hooks module that hooks.json loads. It registers the hooks and the tools, and it holds each
 * function that calls the engine through `$`, with the session state that those functions write.
 * It is one responsibility, the engine-bound layer. `claude plugin validate`
 * follows `$` only into functions in this file, never across an import, and it reads a hook filter
 * only from a constant in this file. An imported `let` cannot get a new value, so the state that
 * these functions assign stays here too. The pure logic is in the modules that this file imports.
 */

import type { EngineInterface, Register, Timer } from 'claude-code'
import type { AgentRow, AgentRowStatus, TodoFile, TodoItem } from '../types'
import { agentSvg, orchestratorSvg, timelineSvg } from './agent-cards'
import { isEnded, notifiedEnd, unlistedEnds } from './agent-ends'
import { respawnedRow } from './agent-respawn'
import { colorSlots } from './agent-colors'
import { agentColor, AGENT_COLORS, agentLabel, ORCH, setColorSlots, setLabelBase } from './agent-identity'
import { MATCH_ITEMS, matchPrompt, readMatchReply } from './agent-match'
import { addToArchive, ARCHIVE_AFTER_MS, archiveName, blockFinder, blocksLeft, blocksStandAsItems, closedBlocks, recordAfterRollback, removeBlocks } from './archive-blocks'
import type { ClosedBlock } from './archive-blocks'
import { addFailure, isRetryDue } from './backoff'
import type { Failing } from './backoff'
import { clock, elapsed, tokens } from './card-format'
import { ACCENT, DANGER, GREEN, setWidth } from './card-stage'
import { altText, controlFree, cutUnits, keyText, toastText } from './card-text'
import type { AgentView, FileView, ItemStatus, ItemView, Usage, View } from './card-types'
import { applySortReply, bookBackups, bookKeptBy, categoryGroups, categoryOf, emptyBook, filterNames, groupOf, isSubstantialChange, mergeRecategorized, pruneBookItems, readBook, SORT_BATCH, SORT_BATCHES, SORT_EVERY_MS, SORT_MODEL, SORT_TRIES, sortPrompt, usedCategories, withoutHidden } from './categories'
import type { CategoryBook } from './categories'
import { keepsMissing, MISSING_CLAIM_MS } from './claim-keeping'
import { elapsedSince, isDeadlinePast } from './clock-elapsed'
import type { ClaimFolder } from './claim-keeping'
import { bestMatches } from './claim-score'
import type { PendingNotes } from './claude-notes'
import { claimNotes, DATA_MARK, SESSION_NAME_NOTE, deferredNote, endedNote, hasLabel, labelNote, moveLine, movesNote, NEXT_IDS_SHOWN, nextIdsLine, noteName, NUDGE_REPEAT_MS, NUDGE_TICKETS, numberedLine, numberedNote, peerClaimedLine, plannedLine, quoteName, quoteTicket, removedNote, renameNote, stillOpenNote, stoppedNote, withoutTold } from './claude-notes'
import { mergeMarks, readKeptMarks, retryStep } from './consolidate-marks'
import type { CopyMark } from './consolidate-marks'
import { appendSections, copyLines, destOf, eolOf, isUnsafeHeadingName, itemLines, keepsEveryItem, pressToast, renameLines, renumberLines, sectionCount, sectionText } from './consolidate-text'
import { removeDuplicateTickets, renameRefs } from './duplicate-tickets'
import { endsInExample } from './example-end'
import { heroCard, heroText } from './hero-card'
import { fileId, filePath, itemKey, keptKey, storedKey } from './item-keys'
import { pruneTo } from './key-prune'
import { cutReturnSlots, forgottenCut, isOldSessionList, KEPT_AGENTS, KEPT_CUT, KEPT_DROPPING, liveSessionIds, MAX_BASE, nextDropping, nextSessions, readDropping, readKeptAgents, readKeptBase, readKeptBlocks, readKeptCut, readKeptReserved, readKeptTickets, readKeptWrote, SESSION_PREFIXES, SESSION_RETRY_MS, SESSION_TOUCH_MS, STORED_BRIEF, storedBrief } from './kept-records'
import { linkOne } from './links'
import { normalize } from './normalize'
import { blockIds, blockOf, CLAIM_PRUNE_MS, CLAIM_SCAN, claimDirs, claimFrom, firstBlock, needsBlock, prunableClaims } from './id-blocks'
import type { HeldBlock } from './id-blocks'
import { claimAcross, END_BLOCK } from './block-claim'
import type { ClaimPort } from './block-claim'
import { gitWhereUp } from './git-file'
import type { GitFs } from './git-file'
import { insertIds, lineHolding, lineIds, NUMBER_AFTER_MS, NUMBER_MAX, textIds } from './numbering'
import { ORCHESTRATOR_KEPT, orchestratorView, pageLabel } from './orchestrator-history'
import type { OrchestratorEntry } from './orchestrator-history'
import { envDirs, isAbsPath, isSameFolder, isWinPath, listedName, normPath, psPath, relIn, resolveAgainst, samePath } from './path-forms'
import { MAC_SIGNS, openCommand, platformFrom, trashReason } from './platform-commands'
import { CLAIM_CHECK_MS, progressReply, readClaims, readProgress, readTitle } from './progress-report'
import { DIR, diskSpelling, findTodoDirWith, folderPlace, gitCommonDir, globalParents, isGlobalTodo, isInsideRoots, isMisspelledTodo, isSameTodo, isTodoOf, MAX_FOLDERS, pickFolders, placeOf, replaceGlobals, REV_PARSE, repoRoots, sessionFolder, todoFoldersIn } from './repo-folders'
import type { TodoFolder } from './repo-folders'
import { sameRows } from './row-equality'
import { buildPresence, holdings, newlyQueued, peerHolds, peerIds, peerTip, PEER_DIM_MS, PEER_IGNORE_MS, PEERS_EVERY_MS, plannedKey, PRESENCE_EVERY_MS, presenceKey, prunePlanned, readPlanned, readPresence, samePresence, sanitizeSessionName, ticketId, waitOver } from './peer-sessions'
import type { PeerClaim, Presence } from './peer-sessions'
import { withRules } from './rules'
import { HIDDEN, hideSecretLines, hideSecrets, hideTitle } from './secrets'
import { addAgents, addCompact, addTokens, emptySeries, readKeptSeries, seedSeries, stepAxes } from './series'
import { addAloneTry, isItemsFailure, nextBatchSize, nextSortBatch, nextThrows, sortReplyKind, THROWS_TO_HALVE } from './sort-queue'
import type { BatchThrows } from './sort-queue'
import type { Axes, Series } from './series'
import { bar, clip, textChildren } from './terminal-text'
import { DONE_ACTION, QUEUE_ACTION, REOPEN_ACTION, SEND_ACTION, START_ACTION, STATUS_ACTION, UNSTART_ACTION } from './ticket-actions'
import type { TicketAction } from './ticket-actions'
import { drawnPlaces, isDrawnLine, setBox, statusNamed, STATUS_WORDS } from './ticket-boxes'
import type { DrawnPlace } from './ticket-boxes'
import { heldBy, highestId, lostIds, RESERVE_MS, ticketValue } from './ticket-ids'
import type { Reservation } from './ticket-ids'
import { findTickets, narrowTickets } from './ticket-lookup'
import { moveQuestion, peerSendPrompt, sendScope, ticketSummary } from './ticket-prompts'
import { beginRender, clearSpaces, columnSlots, expireSpaces, newLayout, pressKeepsSpaces } from './ticket-spaces'
import { boardHead, boardWidth, cardWidth, fileCards, isTicketLong, listRowHeights, padCard, longItems, ticketSvg } from './todo-cards'
import { bare, CHECKBOX, exampleMask, ITEM_ID, leadingId, lineOwnIds, parseTodo, plainText } from './todo-markdown'
import { readReason, reasonOf, TodoReadError } from './todo-read'
import type { TodoRead } from './todo-read'
import { isTurnKept, readKeptUsage, stepUsage, turnKey as turnKeyOf, turnTokens } from './token-usage'
import type { StepUsage } from './token-usage'
import { isSkipped, nextStreak } from './unread-files'
import type { UnreadStreak } from './unread-files'
import { foldersWithUnread } from './unread-folders'
import { mergeToldLines, readToldLists } from './told-notes'
import { callDetail, callSummary, describeCall } from './tool-calls'
import { boardTargets, buildView, columnPx, columnsThatFit, itemChipId, ledger, MIN_TICKET_PX, rowsOf, searchTodo, TICKET_GAP_PX, ticketColumns, todoLedger } from './view-model'
import type { OrchestratorState, TicketOrder } from './view-model'
import { failAfter, inTime, NoAnswer, RUN_LIMIT_MS, STORE_LIMIT_MS, TIMED_OUT } from './time-limit'
import { tryWriteLock, withWriteLock } from './write-lock'
import { deferredIds } from './deferred-tickets'
import { stoppedKeys } from './stop-queue'
import { blankCard, holdRoom, NO_ROOM } from './agent-room'
import type { AgentRoom } from './agent-room'
import { manifestVersion } from './plugin-version'

const PANE = 'claudeopticon'
const TITLE = 'Claudeopticon'
/** The hover group of the room switch and its tip. */
const ROOM_SCOPE = 'claudeopticon-room'
const ROOM_TIP = 'Limit UI shift reserves interface space so new agent activity does not cause scroll jumps.'
/** Whether this load of the mod has tried to reopen a pane that carried an older title: once, failed or not. */
let isRetitled = false
const TICK_MS = 1000
const SCAN_EVERY = 3
/** Ticks between full resyncs: every file reread whatever its mtime, the categories reloaded, the agent list asked again. */
const RESYNC_EVERY = 60
const CLOCK_MS = 5000
const ITEMS_SHOWN = 12
/** The corner button's offsets from the card's lower right corner, in cells: about even in px. */
const ACTION_RIGHT = 2
const ACTION_BOTTOM = 1
/** Rows from a live agent card's top edge to its Stop button, on the title row at the card's right edge. */
const STOP_TOP = 1
/** The Stop button's label: blank, since the card draws the red key it lies over; two no-break spaces and the button's padding are about the key's width. */
const STOP_HIT = '\u00a0'.repeat(2)
/** Cells the blank Stop button's right edge sits left of the drawn key's: the button's own padding, measured on the desktop (2026-10-24). */
const STOP_PAD_CELLS = 1
/** The cells one corner button and its gap take, to set the tip left of them all. */
const ACTION_CELLS = 5
/**
 * CSS pixels per pane cell on the desktop: an estimate, not a measure (the pane reports cells, not pixels). It must be an
 * overestimate. A card drawn wider than the pane scales down to the pane's exact width, and the buttons placed over a card
 * in cells (Stop, tips) then land on the scaled card at any real cell width, since both use this value. An underestimate
 * draws every card short of the pane, out of line with the buttons outside the cards, and a Stop button over the badge
 * (, 8.5 fell short after a desktop update, 2026-10-24).
 */
const CELL_PX = 10

/** The tool names stay in this file: the validator reads the tool filter of a hook only from a constant here. */
const PROGRESS_TOOL = 'mcp__claudeopticon__report_progress'
const MOVE_TOOL = 'mcp__claudeopticon__move_ticket'

/** Appended to each agent's prompt: about 100 tokens, and each report rides along with a tool call. */
export const PROGRESS_NOTE = `

Progress: if you have the ${PROGRESS_TOOL} tool, call it once you have a plan, with done (steps finished), total (steps planned) and step (a few words on the current step). If your task covers items in the project's .claude_todo/ files, also pass items: each one quoted from its line, or its #T ID. Call it again after each step, in the same message as your next tool call. Raise total if the plan grows; pass items again only if they change.`

/** When each agent's claim was last set or confirmed, by agent ID. */
const claimCheckedAt = new Map<string, number>()

/**
 * What the pane draws, held by this session's own process. Each session runs its own copy of the
 * mod, so this can hold nothing but this session's project and agents. A hot reload starts it
 * over; the next scan and agent list fill it again within a few seconds.
 */
let todoFiles: TodoFile[] = []
let agentRows: AgentRow[] = []
let clockMs = 0
const expandedFiles = new Set<string>()
/** Files whose long items show whole, past 8 lines, by the pane's file ID. */
const openText = new Set<string>()
let isTicketView = true
let usage: Usage | undefined
let orchestrator: { isActive: boolean; history: OrchestratorEntry[] } = { isActive: false, history: [] }
let callCount = 0
/**
 * The tickets the orchestrator handles itself, by stored item key (keptKey): the value is whether a
 * scan has seen the ticket in progress since the claim. A claim ends when the ticket is done, gone,
 * or back to open after it was seen in progress. A ticket an agent works on may be in here too.
 */
const orchTickets = new Map<string, boolean>()
/**
 * The tickets this session's main conversation planned: it set the box to `[>]` itself, or the mod queued a ticket it took
 * out of progress. By `ticketId`, as the presence record carries them. A planned ticket stays while its box is `[~]` or `[>]` (prunePlanned).
 * A hand move on the board and a helper's edit never add to it. Saved per session as `planned:<session id>`.
 */
let plannedTickets: ReadonlySet<string> = new Set()
/** The headline Claude gave the assignment it works on itself (report_progress `title`); per session, cleared with the last ticket. */
let orchTitle: string | undefined
/** Which page of the history the card shows: 0 the newest. */
let orchestratorPage = 0
/** Categories the person hid, by name; their items leave the list and the board (search still finds them). */
const hiddenCategories = new Set<string>()
/** Tickets already sent to Claude this session, by file and item key. */
const sentTickets = new Set<string>()
let isFinishedShown = false
/** True while the Recategorize request runs: a press is ignored. */
let isRecategorizing = false
/** The line beside the Recategorize button, shown until `until` (clock ms); the tick clears it. */
let recatNote: { text: string; until: number } | undefined
const NOTE_MS = 4000
let sortBy: 'file' | 'category' = 'file'
/** How the board orders each column's tickets: by group, or newest ID first. */
let ticketOrder: TicketOrder = 'group'
let query = ''
/** The tallest the agent area was drawn this session, held so the board below it stays put. */
let agentRoom: AgentRoom = NO_ROOM
/** Whether the pane holds that room at all: off by default, the reader turns it on (). */
let isRoomHeld = false
/** The mod's version from its plugin.json, read at each load, for the hero card's corner. */
let pluginVersion: string | undefined
/** The mod's version from its own plugin.json; undefined when the manifest cannot be read. */
async function readPluginVersion($: EngineInterface): Promise<string | undefined> {
  const text: unknown = await fsBounded($, () => $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).catch(() => undefined)

  return typeof text === 'string' ? manifestVersion(text) : undefined
}
function redraw($: EngineInterface): void {
  noteLive()
  $.ui.invalidate('ui.render')
  saveAgents($)
}

// ---------------------------------------------------------------- the top card's series

/** What the top card plots; kept in the store per session, so a reload keeps the trace. */
let series: Series = emptySeries()
/** The axes the top card plots on: in memory, per session, stepped at each draw. */
let axes: Axes | undefined
/** The last time any code here read the clock, ms: a sync stand-in for `$.clock.now()` in the render. */
let wallMs = 0
/** When the pane last redrew for a token report, and whether a later report still waits for its redraw (CLOCK_MS throttle). */
let lastBurnDraw = 0
let isBurnDirty = false
/** The top card redraws this often when nothing else does, so its time axis scrolls. */
const IDLE_DRAW_MS = 30_000
let lastIdleDraw = 0

function nowSync(): number {
  return Math.max(wallMs, clockMs)
}

/** Records the live-agent count when it changed. Waits until the kept series is loaded, so a reload cannot overwrite it. */
function noteLive(): void {
  if (!loadedGroups.has('series')) {
    return
  }
  const count = agentRows.filter(row => !isEnded(row.status) && row.idleSince === undefined).length
  series = addAgents(series, nowSync(), count)
}

async function seriesKey($: EngineInterface): Promise<string> {
  return `series:${await $.session.id()}`
}

// ---------------------------------------------------------------- stable layout when a ticket leaves

const layout = newLayout()

// ---------------------------------------------------------------- agents kept across a reload

let isAgentsLoaded = false

async function agentsKey($: EngineInterface): Promise<string> {
  return `agents:${await $.session.id()}`
}

/** The store key of the label base: how many agents came before the first kept row. */
async function baseKey($: EngineInterface): Promise<string> {
  return `agents-base:${await $.session.id()}`
}

/** The number of agents before `agentRows[0]`, so A201 stays A201 after a reload drops older rows. */
let agentBase = 0

const reservedIds = new Map<string, Reservation>()

/**
 * The store key of the reservations: one per repo (the main checkout's root), so every session on it
 * shares one key. Outside git, the primary todo folder's real path stands in for the repo, so two
 * sessions in one folder still share a key; the session ID only when there is no folder.
 */
async function reservedKey($: EngineInterface): Promise<string> {
  const primary = todoFolders?.find(one => !one.isOther)

  return `reserved:${centralRoot ?? repoRoot ?? primary?.real ?? primary?.path ?? (await $.session.id())}`
}

/** This session's ID, as reservations name their holder. */
function sessionOf($: EngineInterface): Promise<string> {
  return Promise.resolve().then(() => $.session.id()).catch(() => 'session')
}

/** Drops the reserved IDs that a file holds now (on the board, or in `held`: IDs just read from the disk), and the expired ones. */
function pruneReserved(time = nowSync(), held: Iterable<string> = []): void {
  const all = new Set([...projectIds(), ...held])
  for (const [id, one] of reservedIds) {
    if (all.has(id) || one.until <= time) {
      reservedIds.delete(id)
    }
  }
}

/** The reservation writes of this session run one after another, so each read-modify-write sees the last. */
let reserveChain: Promise<unknown> = Promise.resolve()

/** Store rounds per sync: each writes, and the next reads back what another session may have written meanwhile. The last only reads. */
const SYNC_ROUNDS = 4

/**
 * Merges the repo's stored reservations into memory (an entry that is not expired, and not in
 * `removed` when this session holds it), prunes (`held`: IDs a file holds), then stores the union and
 * reads it back, until the store holds it (an overlapping write of another session that
 * dropped an entry is repaired). An ID this session held that the store gives to another session is
 * lost: the store's holder keeps it, and the ID leaves this session's hands. A failed read leaves the
 * store alone: it never writes over what it could not read. Resolves the lost IDs, or undefined when
 * a read of the store (the read-back after a write included) failed.
 *
 * The store has only get and set, with no compare-and-set across sessions, so this record alone
 * cannot keep two sessions off one ID: the ID block claims do (`freeIds`). The record keeps
 * the offers of this session across a reload, and the IDs of a session of an older build count.
 */
function syncReserved($: EngineInterface, removed: readonly string[] = [], held: readonly string[] = []): Promise<string[] | undefined> {
  const job = async (): Promise<string[] | undefined> => {
    const me = await sessionOf($)
    const key = await reservedKey($)
    const gone = new Set(removed)
    const lost: string[] = []
    for (let round = 0; round < SYNC_ROUNDS; round += 1) {
      const got = await tryGet($, key)
      // A read that fails, the read-back after a write included, is no answer: the caller cannot tell what the store holds.
      if (!got.ok) {
        return undefined
      }
      const time = nowSync()
      // An ID given back is dropped from the store only while this session holds it there: never another session's entry.
      const stored = readKeptReserved(got.value).filter(([id, one]) => !(gone.has(id) && heldBy(one) === me))
      for (const id of lostIds(reservedIds, stored, me, time)) {
        reservedIds.delete(id)
        lost.push(id)
      }
      for (const [id, one] of stored) {
        if (one.until > time && !reservedIds.has(id)) {
          reservedIds.set(id, one)
        }
      }
      pruneReserved(time, held)
      const value = [...reservedIds].map(([id, one]) => [id, one.until, one.offeredTo ?? null, one.by ?? null])
      // Done when the store already holds exactly this; else written, and read back in the next round.
      if (JSON.stringify(value) === JSON.stringify(got.value ?? []) || round === SYNC_ROUNDS - 1) {
        return lost
      }
      await storeSet($, key, value)
    }

    return lost
  }
  const run = reserveChain.then(job, job).catch(() => undefined)
  reserveChain = run

  return run
}

/** The orchestrator's tickets are kept beside the agent rows, per session, so a reload keeps them. */
async function orchKey($: EngineInterface): Promise<string> {
  return `orchestrator:${await $.session.id()}`
}

async function plannedStoreKey($: EngineInterface): Promise<string> {
  return plannedKey(await $.session.id())
}

async function orchTitleKey($: EngineInterface): Promise<string> {
  return `orchestrator-title:${await $.session.id()}`
}

/** A store read: the value (undefined when the key is absent), or a failure. A failure is not an absent key. */
type Got = { ok: true; value: unknown } | { ok: false }

/**
 * The store keys whose last call went unanswered for STORE_LIMIT_MS; an answer for the
 * key, a rejection included, takes it out. While any key is in it the store is stalled, and the
 * hooks do not wait on store work (unlessStoreWaits): a load would read that key again. By key, so
 * one key that never answers is not hidden by others that do.
 */
const stalledKeys = new Set<string>()

/** One store call for `key` under the store time limit: an unanswered call fails with NoAnswer and marks the key stalled. */
function storeCall<T>($: EngineInterface, key: string, call: () => Promise<T>): Promise<T> {
  return Promise.resolve()
    .then(() => failAfter(Promise.resolve(call()), STORE_LIMIT_MS, (ms, fire) => $.clock.after(ms, fire)))
    .then(
      value => {
        stalledKeys.delete(key)

        return value
      },
      (error: unknown) => {
        if (error instanceof NoAnswer) {
          stalledKeys.add(key)
        } else {
          stalledKeys.delete(key)
        }
        throw error
      },
    )
}

/** A read that has not answered within STORE_LIMIT_MS is a failed read: a store that never answers never holds a hook. */
function tryGet($: EngineInterface, key: string): Promise<Got> {
  return storeCall($, key, () => $.store.get(key))
    .then(
      (value): Got => ({ ok: true, value }),
      (): Got => ({ ok: false }),
    )
}

/**
 * A store write, rejected when it has not answered within STORE_LIMIT_MS, as a write that
 * failed: each caller tries it again or goes on, as it does for a store that rejects. A write that
 * only answers late may still land; each key is written whole, so a late write is one older copy that
 * the next write replaces.
 */
function storeSet($: EngineInterface, key: string, value: unknown): Promise<void> {
  return storeCall($, key, () => $.store.set(key, value)).then(() => undefined)
}

/**
 * The one way the rows change. Keeps at most KEPT_AGENTS in memory: the oldest go, and `agentBase`
 * grows by the number dropped, so a label stays the same (A201 stays A201). `rowsVersion` counts
 * real changes, which is all the store step compares: it never rebuilds the JSON to find out.
 */
function setRows(next: AgentRow[]): void {
  let rows = next
  if (rows.length > KEPT_AGENTS) {
    const dropped = rows.length - KEPT_AGENTS
    // Never past MAX_BASE: a stored base past it reads back as 0, and every label would change on reload. The save toasts once when it is reached.
    agentBase = Math.min(MAX_BASE, agentBase + dropped)
    setLabelBase(agentBase)
    // The cut rows are remembered, so the agent list never adds them back as new rows.
    for (const row of rows.slice(0, dropped)) {
      cutRowIds.add(row.id)
    }
    cutRowVersion += 1
    while (cutRowIds.size > KEPT_CUT) {
      cutRowIds.delete(cutRowIds.values().next().value!)
    }
    rows = rows.slice(dropped)
  }
  if (!sameRows(agentRows, rows)) {
    rowsVersion += 1
  }
  agentRows = rows
}

/** Bumped by each real change of the rows. */
let rowsVersion = 0

/** The IDs of the rows cut from the kept window: kept per session, so neither a refresh nor a reload adds one back. */
const cutRowIds = new Set<string>()
/** Bumped by each change of `cutRowIds`: the stamp its save compares. */
let cutRowVersion = 0

async function cutKey($: EngineInterface): Promise<string> {
  return `agents-cut:${await $.session.id()}`
}

/** When this session last noted itself in the session list, clock ms; undefined before the first note. Set only by a note that was stored. */
let lastTouch: number | undefined
/** When the last note failed, clock ms; undefined while no note failed. It is tried again SESSION_RETRY_MS later. */
let touchFailedAt: number | undefined
let isTouching = false
/** The notes that failed in a row, and whether the toast that says so is shown (it clears with the next note that is stored). */
let touchFailures = 0
let isTouchToastShown = false

/**
 * Notes this session in the store's list of the last KEPT_SESSIONS sessions, with the time, and
 * clears the keys of the sessions that fell off it. The session start calls it, and so does the save
 * every SESSION_TOUCH_MS, so a session that runs for days stays in the list: a session that
 * noted itself in the last SESSION_LIVE_MS is never cleared. The times are in the list itself, one
 * key and one write; the old `sessions-seen` key is only read, for a list in the older form. The
 * store has no delete, so a key is overwritten with null; every reader treats null as absent. The
 * list is written first. A failed read of the list (or of the old times a list in the older form
 * needs) clears nothing. A note that is not stored is tried again after SESSION_RETRY_MS. A session
 * that finds itself gone from the list (cleared while it was asleep) writes every key again with its
 * next save.
 */
async function pruneSessions($: EngineInterface): Promise<void> {
  const time = await $.clock.now()
  try {
    await noteSession($, time)
    lastTouch = time
    touchFailedAt = undefined
    touchFailures = 0
    isTouchToastShown = false
  } catch (error) {
    touchFailedAt = time
    touchFailures += 1
    // Like a failing save (saveKey): one toast after SAVE_FAILS_TOAST failures in a row. Until a note is stored, other sessions may clear this session's keys.
    if (touchFailures >= SAVE_FAILS_TOAST && !isTouchToastShown) {
      isTouchToastShown = true
      try {
        showToast($, `Claudeopticon cannot note this session in the store: ${touchFailures} notes in a row failed. Another session may clear what this session saved.`)
      } catch {
        // A toast that fails must not hide the failed note.
      }
    }
    throw error
  }
}

/** One note of this session in the session list; throws when the list is not read or not stored. */
async function noteSession($: EngineInterface, time: number): Promise<void> {
  const me = await $.session.id()
  const [got, seenGot] = await Promise.all([tryGet($, 'sessions-recent'), tryGet($, 'sessions-seen')])
  if (!got.ok || (!seenGot.ok && isOldSessionList(got.value))) {
    throw new Error('session list read failed')
  }
  wallMs = Math.max(wallMs, time)
  const { list, dropped, untimed, isListed } = nextSessions(got.value, seenGot.ok ? seenGot.value : undefined, me, time)
  // A session the list forgets is queued in `sessions-dropping` first: once the list no longer names it, no later note finds it dropped, so its keys would never be cleared. A queue that is not read or not stored throws before the list is written, and the next note starts from the same list.
  const droppedTimed = dropped.filter(one => !untimed.includes(one))
  if (droppedTimed.length > 0) {
    const queued = await tryGet($, 'sessions-dropping')
    if (!queued.ok) {
      throw new Error('session list read failed')
    }
    const held = readDropping(queued.value)
    const queue = new Map(held)
    for (const id of droppedTimed) {
      if (!queue.has(id)) {
        queue.set(id, time)
      }
    }
    if (queue.size !== held.size) {
      await storeSet($, 'sessions-dropping', [...queue].slice(-KEPT_DROPPING))
    }
  }
  await storeSet($, 'sessions-recent', list)
  if (isOldSessionList(got.value)) {
    // The list is in the new form now; the old times key is not read again.
    await storeSet($, 'sessions-seen', null).catch(() => undefined)
  }
  if (!isListed) {
    saved.clear()
    saved.set('title', undefined)
  }
  // A dropped session that noted itself while this call read a stale list is live: it keeps its keys.
  // A session with a time is cleared only in two steps: found droppable now, it waits in
  // `sessions-dropping`, and a note SESSION_DROP_CONFIRM_MS later clears its keys only when a read of
  // the list made then still shows it not live. One read cannot tell a dead session from a live one
  // whose note this write just overwrote (it read the list before that note and wrote after it); the
  // live one notes itself again within SESSION_TOUCH_MS, so the second step sees it.
  const timed = droppedTimed
  const pendingGot = await tryGet($, 'sessions-dropping')
  const pendingBefore = pendingGot.ok ? readDropping(pendingGot.value) : new Map<string, number>()
  const fresh = untimed.length === 0 && timed.length === 0 && pendingBefore.size === 0 ? undefined : await tryGet($, 'sessions-recent')
  const live = fresh?.ok === true ? new Set([...liveSessionIds(fresh.value, time), ...liveSessionIds(list, time)]) : liveSessionIds(list, time)
  // With the pending list or the fresh read missing, no timed session is cleared: the step waits for a note that reads both.
  const step = pendingGot.ok && fresh?.ok === true ? nextDropping(pendingBefore, timed, live, time) : undefined
  if (step !== undefined && JSON.stringify([...step.pending]) !== JSON.stringify([...pendingBefore])) {
    await storeSet($, 'sessions-dropping', [...step.pending]).catch(() => undefined)
  }
  const clear = [...untimed.filter(one => !live.has(one)), ...(step?.confirmed ?? [])]
  for (const id of clear) {
    for (const prefix of SESSION_PREFIXES) {
      await storeSet($, `${prefix}:${id}`, null).catch(() => undefined)
    }
  }
}

/** The groups of per-session keys, loaded each on its own: the save names of each group. The rows, their label base and their cut IDs belong together, since the base counts rows. */
type StoreGroup = 'rows' | 'tickets' | 'title' | 'series'
const GROUP_NAMES: Record<StoreGroup, readonly string[]> = { rows: ['agents', 'base', 'cut'], tickets: ['tickets', 'planned'], title: ['title'], series: ['series'] }
/** The groups whose stored value was read and merged: only these are ever saved, so a key that did not read is never written over. */
const loadedGroups = new Set<StoreGroup>()

/**
 * The load of what this session kept in the store. Every caller awaits the same promise, so nothing
 * merges twice. Each group loads on its own: a group whose read worked is merged and saved
 * from then on; one whose read failed stays unsaved, and the next caller reads it again.
 * `isAgentsLoaded` turns true once every group is loaded.
 */
let loading: Promise<void> | undefined
function loadAgents($: EngineInterface): Promise<void> {
  if (isAgentsLoaded) {
    return Promise.resolve()
  }
  loading ??= readStores($).finally(() => {
    loading = undefined
  })

  return loading
}

/**
 * Reads each group not loaded yet and merges the ones that read, under what was seen since the
 * load: a row seen since the load wins. An agent whose ticket match already ran is not matched
 * again. Rejects when any group failed, so a caller knows the load is not whole.
 */
async function readStores($: EngineInterface): Promise<void> {
  const want = (['rows', 'tickets', 'title', 'series'] as const).filter(group => !loadedGroups.has(group))
  const keyOf: Record<StoreGroup, () => Promise<string[]>> = {
    rows: () => Promise.all([agentsKey($), baseKey($), cutKey($)]),
    tickets: async () => [await orchKey($), await plannedStoreKey($)],
    title: async () => [await orchTitleKey($)],
    series: async () => [await seriesKey($)],
  }
  const reads = await Promise.all(want.map(async group => ({ group, got: await Promise.all((await keyOf[group]()).map(key => tryGet($, key))) })))
  // The clock is read before any merge: the series read bounds kept points by it, and a clock nothing has read yet is 0, which would drop every kept point as future.
  wallMs = Math.max(wallMs, await $.clock.now())
  // From here to the end there is no await: each merge is one step, and its group turns loaded with it.
  let isWhole = true
  for (const { group, got } of reads) {
    if (!got.every(one => one.ok)) {
      isWhole = false
      continue
    }
    const values = got.map(one => (one.ok ? one.value : undefined))
    mergeGroup(group, values)
    loadedGroups.add(group)
    // The first save after a load rewrites the group's keys (the title only when there is one).
    for (const name of GROUP_NAMES[group]) {
      saved.delete(name)
    }
    if (group === 'title') {
      saved.set('title', undefined)
    }
  }
  seedTrace()
  if (loadedGroups.size === Object.keys(GROUP_NAMES).length) {
    isAgentsLoaded = true
  }
  if (!isWhole) {
    throw new Error('store read failed')
  }
}

/** Merges one group's stored values into the session state. */
function mergeGroup(group: StoreGroup, values: readonly unknown[]): void {
  if (group === 'rows') {
    const [agentsRaw, base, cutRaw] = values
    for (const id of readKeptCut(cutRaw)) {
      cutRowIds.add(id)
    }
    const kept = readKeptAgents(agentsRaw).filter(row => !cutRowIds.has(row.id))
    const keptBase = readKeptBase(base)
    // Never lowered: cuts made while the group did not load moved the base on, and a label once shown keeps its number.
    if (kept.length > 0 && keptBase > agentBase) {
      agentBase = keptBase
      setLabelBase(agentBase)
    }
    // A row the list added back before the cut IDs were read goes again.
    const live = agentRows.filter(row => !cutRowIds.has(row.id))
    const seen = new Set(live.map(row => row.id))
    setRows([...kept.filter(row => !seen.has(row.id)), ...live])
    for (const row of kept) {
      if (row.autoClaims !== undefined) {
        matchedAgents.add(row.id)
      }
    }
  } else if (group === 'tickets') {
    for (const [kept, seen] of readKeptTickets(values[0])) {
      // A key stored with a place number is read as its first-place key: never a place.
      const key = storedKey(kept)
      if (!orchTickets.has(key)) {
        orchTickets.set(key, seen)
      }
    }
    // What this load added to the planned set since the read stays; a stored ticket joins it.
    plannedTickets = new Set([...readPlanned(values[1]), ...plannedTickets])
  } else if (group === 'title') {
    // A title kept by an older version is checked again, as a new one is.
    orchTitle ??= hideTitle(readTitle(values[0]))
  } else {
    // A clock still unknown (0) sets no future bound.
    const keptSeries = readKeptSeries(values[0], nowSync() > 0 ? nowSync() : Infinity)
    const after = (points: readonly (readonly [number, number])[], from: readonly (readonly [number, number])[]) => [...from, ...points.filter(point => point[0] > (from[from.length - 1]?.[0] ?? -Infinity))]
    series = {
      agents: after(series.agents, keptSeries.agents),
      tokens: after(series.tokens, keptSeries.tokens),
      compacts: [...keptSeries.compacts, ...series.compacts.filter(one => one > (keptSeries.compacts[keptSeries.compacts.length - 1] ?? -Infinity))],
      // The times of seeded points, kept and new, so a reload never counts a seed's rise as usage.
      ...(keptSeries.seeds === undefined && series.seeds === undefined ? {} : { seeds: [...new Set([...(keptSeries.seeds ?? []), ...(series.seeds ?? [])])] }),
    }
  }
}

/** What was last stored for each key, as the stamp compared next time: set when the write resolved, never before. */
const saved = new Map<string, unknown>()
/** The stamp of a write still out, so a redraw does not start the same write twice. */
const writing = new Map<string, unknown>()

/** The failed writes in a row of each save name, and when it is tried next. */
const saveFailures = new Map<string, Failing>()
/** The first wait after a failed write, and the longest: 1 s doubling to 5 min. */
const SAVE_RETRY_MS = 1000
const SAVE_RETRY_MAX_MS = 5 * 60_000
/** After this many failed writes in a row of one key, one toast says nothing is kept. */
const SAVE_FAILS_TOAST = 5
/** True once the store toast is shown; shown again only after every key was stored once more. */
let isSaveToastShown = false
/** True once the label-base toast is shown. */
let isBaseToastShown = false

/**
 * Stores `value` under `name`'s key unless `stamp` is what was stored last (or is being stored now).
 * The marker is set when the write resolves, and cleared when it fails. A failed write is tried
 * again with a later redraw, after a wait per key: 1 s, doubled for each failure in a row,
 * up to 5 min, so a store that rejects every write does not get every key again with every redraw.
 * After SAVE_FAILS_TOAST failures in a row, one toast says so.
 */
function saveKey($: EngineInterface, name: string, prefix: string, stamp: unknown, value: unknown): void {
  if ((saved.has(name) && Object.is(saved.get(name), stamp)) || (writing.has(name) && Object.is(writing.get(name), stamp))) {
    return
  }
  if (!isRetryDue(saveFailures.get(name), nowSync(), SAVE_RETRY_MAX_MS)) {
    return
  }
  writing.set(name, stamp)
  void $.session.id()
    .then(id => storeSet($, `${prefix}:${id}`, value))
    .then(
      () => {
        saved.set(name, stamp)
        saveFailures.delete(name)
        if (saveFailures.size === 0) {
          isSaveToastShown = false
        }
      },
      () => {
        saved.delete(name)
        const failing = addFailure(saveFailures.get(name), nowSync(), SAVE_RETRY_MS, SAVE_RETRY_MAX_MS)
        saveFailures.set(name, failing)
        if (failing.count >= SAVE_FAILS_TOAST && !isSaveToastShown) {
          isSaveToastShown = true
          try {
            showToast($, `Claudeopticon cannot save to the store: ${failing.count} writes in a row failed. The pane works, but a reload loses what this session saw.`)
          } catch {
            // A toast that fails must not turn a failed write into an unhandled rejection.
          }
        }
      },
    )
    .finally(() => {
      if (Object.is(writing.get(name), stamp)) {
        writing.delete(name)
      }
    })
}

/**
 * Stores what changed since the last store, for each group whose stored value was loaded:
 * a group that did not read is never written over. Every SESSION_TOUCH_MS it notes the session in
 * the session list again.
 */
function saveAgents($: EngineInterface): void {
  const time = nowSync()
  // A load with no session start (a hot reload) counts the interval from its first save.
  // A note that failed is not a note: it is tried again SESSION_RETRY_MS after it.
  lastTouch ??= time > 0 && touchFailedAt === undefined ? time : undefined
  // Timed with elapsedSince: a clock set back restarts the wait from now, so the notes go on and no other session prunes this one.
  const touch = lastTouch === undefined ? undefined : elapsedSince(lastTouch, time)
  const retry = touchFailedAt === undefined ? undefined : elapsedSince(touchFailedAt, time)
  lastTouch = touch?.from
  touchFailedAt = retry?.from
  // After a failed note the retry time is the due time: lastTouch stays old then, so the touch
  // interval alone would make every redraw a try.
  const isDue = retry !== undefined ? retry.ms >= SESSION_RETRY_MS : touch !== undefined && touch.ms >= SESSION_TOUCH_MS
  if (agentBase >= MAX_BASE && !isBaseToastShown) {
    isBaseToastShown = true
    showToast($, `Agent labels reached A${MAX_BASE}: from here on, a label may name another agent than it did before.`)
  }
  if (!isTouching && isDue) {
    isTouching = true
    void pruneSessions($)
      .catch(() => undefined)
      .finally(() => {
        isTouching = false
      })
  }
  // Small values compare by text; the archive by identity (it is replaced, never edited); the rows by version.
  if (loadedGroups.has('tickets')) {
    const tickets = JSON.stringify([...orchTickets])
    saveKey($, 'tickets', 'orchestrator', tickets, [...orchTickets])
    saveKey($, 'planned', 'planned', JSON.stringify([...plannedTickets]), [...plannedTickets])
  }
  if (loadedGroups.has('title')) {
    saveKey($, 'title', 'orchestrator-title', orchTitle, orchTitle ?? '')
  }
  if (loadedGroups.has('series')) {
    saveKey($, 'series', 'series', JSON.stringify(series), series)
  }
  if (!loadedGroups.has('rows')) {
    return
  }
  saveKey($, 'base', 'agents-base', agentBase, agentBase)
  saveKey($, 'cut', 'agents-cut', cutRowVersion, [...cutRowIds])
  if (!(saved.has('agents') && saved.get('agents') === rowsVersion) && !(writing.has('agents') && writing.get('agents') === rowsVersion)) {
    // Every stored brief goes through storedBrief: its secrets hidden and its length capped.
    saveKey(
      $,
      'agents',
      'agents',
      rowsVersion,
      agentRows.map(row => {
        const brief = storedBrief(row.brief)

        return brief === row.brief ? row : { ...row, brief }
      }),
    )
  }
}

// ---------------------------------------------------------------- todo

/**
 * Finds the project's own todo folder: `.claude_todo/` at the root of the repo the session works
 * in, or of its main checkout from a git worktree (whose `.git` file names it; `.claude_todo/` may
 * be gitignored, so a worktree may have none). Outside a repo, only the session folder's own. Never
 * the `.claude_todo/` in the home `.claude` folder, which belongs to no project.
 */
export async function findTodoDir($: EngineInterface): Promise<string | undefined> {
  return findTodoDirWith({
    exists: path => fsBounded($, () => $.fs.exists(path)),
    kind: path => fsBounded($, () => $.fs.stat(path)).then(stat => stat.kind).catch(() => undefined),
    realPath: path => realOf($, path),
    read: path => $.fs.read(path).then(text => (typeof text === 'string' ? text : '')).catch(() => ''),
  })
}
/** True once the environment gave a usable home; false means every write is off (fail closed). Windows paths need no home: the text rule covers them. */
let globalsKnown = false
let globalsToasted = false

/**
 * Reads one environment variable as the forms of an absolute folder (`envDirs`): through `printenv`
 * (no shell), and where `printenv` cannot start (Windows has none) through PowerShell with the name
 * as a fixed literal. Empty when unset, failed, timed out, or not an absolute path.
 */
async function envPath($: EngineInterface, name: 'HOME' | 'USERPROFILE' | 'CLAUDE_CONFIG_DIR'): Promise<string[]> {
  // Bounded: a call that does not return is a failure, told once, and the mod fails closed as for no home.
  const ask = async (argv: string[]) => {
    const ran = await runInTime($, argv)
    if (ran === TIMED_OUT) {
      noteTimedOut($, argv)

      return { timedOut: true } as const
    }

    return ran
  }
  let done = await ask(['printenv', name])
  // Not started (a throw) or not found (exit 127, as the trash code reads it): where there is no printenv, ask PowerShell.
  if (done === undefined || ('exitCode' in done && done.exitCode === 127)) {
    done = await ask(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `[Environment]::GetEnvironmentVariable('${name}')`])
  }

  return envDirs(done !== undefined && 'exitCode' in done && done.exitCode === 0 ? done.stdout.split('\n')[0] : undefined)
}

/**
 * Finds the global todo folders of this machine, once per load: under HOME (USERPROFILE, a Windows
 * home, when HOME is not set) and CLAUDE_CONFIG_DIR. Without a readable home the mod fails closed.
 */
async function loadGlobals($: EngineInterface): Promise<void> {
  // Built aside, swapped in with no await between (`replaceGlobals`): a write check during the load sees the folders of the last load, never none.
  const dirs = new Set<string>()
  const parentSet = new Set<string>()
  let homes = await envPath($, 'HOME')
  if (homes.length === 0) {
    homes = (await envPath($, 'USERPROFILE')).filter(isWinPath)
  }
  const configs = await envPath($, 'CLAUDE_CONFIG_DIR')
  const home = homes[0]
  const parents = [...homes.map(one => `${one.replace(/\/$/, '')}/.claude`), ...configs.map(one => one.replace(/\/$/, ''))]
  for (const parent of parents) {
    parentSet.add(parent)
    const dir = `${parent}/${DIR}`
    dirs.add(dir)
    const real = await realOf($, dir)
    if (real !== undefined) {
      dirs.add(real.replace(/\/+$/, ''))
    }
    // The parent exists at load even when `.claude_todo` does not yet: a symlinked `~/.claude`,
    // HOME or CLAUDE_CONFIG_DIR (stow, chezmoi) gives the real path a folder made later will have.
    const realParent = await realOf($, parent)
    if (realParent !== undefined) {
      dirs.add(`${realParent.replace(/[\\/]+$/, '')}/${DIR}`)
    }
  }
  replaceGlobals(dirs, parentSet)
  globalsKnown = home !== undefined
}

// ---------------------------------------------------------------- folders

/**
 * The pathspecs that limit `git ls-files` to todo folders: every path inside a `.claude_todo`
 * folder at any depth, and the folder itself for the ignored listing, where git gives an ignored
 * folder as one collapsed entry. `icase` keeps the case-only spellings `todoFoldersIn` reads
 *. On a real index of 90,002 entries the whole listing is 4,950,053 bytes, past the
 * engine's 4 MiB stdout cap; with these it is the todo entries only (53 bytes).
 */
const TODO_PATHSPECS = [`:(icase,glob)**/${DIR}/**`, `:(icase,glob)**/${DIR}`]

/** A `git ls-files` that failed, threw, did not return in time or was cut at the engine's stdout cap: the folder list is unknown, never empty. */
class FolderListError extends Error {}

/**
 * The `.claude_todo/` folders of a checkout, tracked, untracked and ignored, through git. Each call is
 * bounded (`runInTime`). A call that throws, exits non-zero, times out, or whose output the
 * engine cut at its stdout cap (it keeps the first 4 MiB and still gives exit 0) throws
 * `FolderListError`: no list is not an empty list.
 */
async function listFolders($: EngineInterface, root: string): Promise<{ path: string; rel: string }[]> {
  const run = async (argv: string[]) => {
    const done = await runInTime($, argv, { cwd: root })
    if (done === TIMED_OUT) {
      noteTimedOut($, argv)
      throw new FolderListError(`git ls-files did not return within ${RUN_LIMIT_MS / 1000} s`)
    }
    if (done === undefined || done.exitCode !== 0) {
      const said = typeof done?.stderr === 'string' ? done.stderr.trim().split('\n')[0] ?? '' : ''
      throw new FolderListError(done === undefined ? 'git ls-files did not start' : `git ls-files exited ${done.exitCode}${said === '' ? '' : `: ${said}`}`)
    }
    if ((done as { isStdoutTruncated?: boolean }).isStdoutTruncated === true) {
      throw new FolderListError('git ls-files output was cut at the size limit')
    }

    return done.stdout
  }
  const tracked = await run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...TODO_PATHSPECS])
  const ignored = await run(['git', 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--', ...TODO_PATHSPECS])

  return todoFoldersIn(`${tracked}\0${ignored}`, root)
}

/** True once a folder-list failure was told; a list that works clears it, so the next failure is told again. */
let listFailToasted = false

/** Tells once that git could not list the todo folders, and what the board does instead. */
function noteListFailed($: EngineInterface, error: FolderListError, isKept: boolean): void {
  if (!listFailToasted) {
    listFailToasted = true
    showToast($, `Claudeopticon could not list the todo folders (${error.message}). ${isKept ? 'The board keeps the folders it had' : 'The board shows the nearest todo folder only'} until a later search works: press Consolidate todos or reload the mod to search again.`)
  }
}

/**
 * One fs read under the time limit of an outside call (RUN_LIMIT_MS, at most; calls started in one bucket share a timer). The engine's fs gives no time limit of its
 * own, and the files may sit on a network mount or a stuck volume; a read that never answers would hold the
 * scan, and with it every later scan, for the whole session. An unanswered read rejects with NoAnswer, so it is
 * a failed read: never a missing file, an empty file or an empty folder. Use it only where a rejection already
 * means "could not be read". The call itself is not stopped; its late result is dropped. Writes are not bounded:
 * a write that gave no answer may still land, and a retry would not know.
 */
function fsBounded<T>($: EngineInterface, call: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const bucket = fsBucketFor($)
    const giveUp = () => reject(new NoAnswer(`no answer within ${RUN_LIMIT_MS / 1000} s`))
    bucket.add(giveUp)
    Promise.resolve()
      .then(call)
      .then(
        value => {
          bucket.delete(giveUp)
          resolve(value)
        },
        (error: unknown) => {
          bucket.delete(giveUp)
          reject(error)
        },
      )
  })
}

/** How long one bucket of fs calls takes new calls: a call waits between RUN_LIMIT_MS minus this and RUN_LIMIT_MS. */
const FS_BUCKET_MS = 5000
/** The calls started since the open bucket began: one timer gives them all up, so a scan of many files holds two timers, not one per call. */
let fsBucket: Set<() => void> | undefined

/** The bucket that a new fs call joins; the first call after the last bucket closed opens the next, with its two timers. */
function fsBucketFor($: EngineInterface): Set<() => void> {
  if (fsBucket !== undefined) {
    return fsBucket
  }
  const bucket = new Set<() => void>()
  fsBucket = bucket
  // A timer the engine refuses leaves the calls of this bucket unbounded, as for a store call; they still settle by their own answer.
  const arm = (ms: number, fire: () => void) => {
    try {
      const timer: unknown = $.clock.after(ms, fire)
      if (typeof (timer as { then?: unknown } | null)?.then === 'function') {
        void (timer as Promise<unknown>).then(undefined, () => undefined)
      }
    } catch {
      // Nothing to do: the bucket stays open and its calls are not timed.
    }
  }
  arm(FS_BUCKET_MS, () => {
    if (fsBucket === bucket) {
      fsBucket = undefined
    }
  })
  arm(RUN_LIMIT_MS, () => {
    for (const giveUp of [...bucket]) {
      giveUp()
    }
    bucket.clear()
    if (fsBucket === bucket) {
      fsBucket = undefined
    }
  })

  return bucket
}

/**
 * The real path of a folder in the one spelling the mod uses (`normPath`), or undefined when it cannot
 * be resolved. The engine's realpath gives backslashes on Windows: kept raw, the session
 * folder became `C:\proj`, its todo `C:\proj/.claude_todo`, which the trust check refuses, and the
 * claim folder was cut at a `/` it does not have. A POSIX path is returned as it is.
 */
function realOf($: EngineInterface, path: string): Promise<string | undefined> {
  return fsBounded($, () => $.fs.stat(path, { resolve: true })).then(stat => (typeof stat.realPath === 'string' ? normPath(stat.realPath) : stat.realPath)).catch(() => undefined)
}

/** The todo folders found but cut from the pane by MAX_FOLDERS; their ticket IDs still count. */
let cutFolders: string[] = []
let cutToasted = false
/** The ticket IDs (lowercase) of every file in the cut folders, so a new ID never repeats one of theirs. */
let cutIds: string[] = []

/** The ticket IDs of each file of the cut folders, by path, from its last good read. */
let cutIdsByFile = new Map<string, string[]>()
/** The files of the cut folders that have not read once: their IDs are unknown, so new IDs wait for them (`diskIds`). */
let cutUnknown = new Set<string>()

/**
 * Reads the ticket IDs of the cut folders (top level and archive). A file that does not read, or a
 * folder that does not list, keeps the IDs of its last good read: a failed read is never
 * an empty file. A file whose first read fails is unknown (`cutUnknown`), with one toast, and stops new
 * IDs until it reads or is skipped. A file that is gone holds none.
 */
async function refreshCutIds($: EngineInterface): Promise<void> {
  const next = new Map<string, string[]>()
  const unknown = new Set<string>()
  for (const folder of cutFolders) {
    const names = await mdFiles($, folder, true).catch(() => undefined)
    if (names === undefined) {
      for (const [path, ids] of cutIdsByFile) {
        if (path.startsWith(`${folder}/`)) {
          next.set(path, ids)
        }
      }
      for (const path of cutUnknown) {
        if (path.startsWith(`${folder}/`)) {
          unknown.add(path)
        }
      }
      continue
    }
    for (const name of names) {
      const path = `${folder}/${name}`
      const read = await readTodo($, path)
      const was = cutIdsByFile.get(path)
      if (read.kind === 'ok') {
        next.set(path, textIds(read.text))
        unreadToasted.delete(path)
      } else if (read.kind === 'failed' && was !== undefined) {
        next.set(path, was)
      } else if (read.kind === 'failed') {
        // Its first read failed: its IDs are unknown, never none. Named once, until it reads.
        unknown.add(path)
        if (!unreadToasted.has(path)) {
          unreadToasted.add(path)
          showToast($, `${path} did not read (${read.reason}). Its ticket IDs are unknown, so no new ticket ID is given until it reads.`)
        }
      }
    }
  }
  cutIdsByFile = next
  cutUnknown = unknown
  cutIds = [...next.values()].flat()
}

/** The repo root of the session, kept to name a folder found later by its place in the repo. */
let repoRoot: string | undefined
/** The git common dir, absolute (`git rev-parse --git-common-dir`): where the ID claims live in every git layout. */
let gitCommon: string | undefined
/** Where the central todo lives: the root of the main checkout (the repo root outside a worktree). */
let centralRoot: string | undefined
/**
 * The session folder as an absolute path: from git in a repo (the top plus `--show-prefix`), else the
 * real path of `.`. A relative nearest folder is made absolute against it, so the trust check, which
 * takes only absolute paths, can pass it.
 */
let sessionDir: string | undefined
/** Outside a repo (or when git fails): the session folder, whose own `.claude_todo` is the one folder trusted there. Undefined in a repo. */
let looseRoot: string | undefined

/**
 * A relative nearest folder as an absolute path against the session folder, when that path is its own
 * real path (no symlink at the folder). Undefined when this cannot be told: the folder then stays
 * relative, and so untrusted. An absolute path (a worktree's main checkout folder) is returned as it is.
 */
function absNearest(near: string, real: string | undefined): string | undefined {
  if (isAbsPath(near)) {
    return near
  }
  const path = sessionDir === undefined ? undefined : resolveAgainst(sessionDir, near)

  return path !== undefined && real !== undefined && samePath(real, path) ? path : undefined
}

/** Says once that HOME cannot be read, unless the session works on a Windows path, which the text rule covers with no home. */
function noteNoHome($: EngineInterface, where: string | undefined): void {
  if (!globalsKnown && !globalsToasted && !(where !== undefined && isWinPath(where))) {
    globalsToasted = true
    showToast($, 'Claudeopticon cannot read the HOME folder, so it cannot tell the global todo folder from a project one. It changes no todo file and the tidy buttons are off.')
  }
}

/** The folders already named in an "outside the repo" toast: one toast each, per load of the module. */
const outsideToasted = new Set<string>()

/** Says once per folder that a listed todo folder resolves outside the repo, so the mod does not read it. */
function noteOutsideRepo($: EngineInterface, path: string, real: string): void {
  if (!outsideToasted.has(path)) {
    outsideToasted.add(path)
    showToast($, `Claudeopticon skips ${path}: it is a link to ${real}, outside the repo, so its files are not read.`)
  }
}

/** True once a failed read of the repo layout was told; a layout that reads clears it, so the next failure is told again. */
let layoutFailToasted = false

/** Tells once that the repo layout could not be read, and what the board does instead: it shows the nearest todo folder only. */
function noteLayoutFailed($: EngineInterface, reason: string): void {
  if (!layoutFailToasted) {
    layoutFailToasted = true
    showToast($, `Claudeopticon could not read the repo layout (${reason}). The board shows the nearest todo folder only until you press Consolidate todos or reload the mod.`)
  }
}

/** The folders already named in a "spelled in another letter case" toast: one toast each, per load of the module. */
const misspelledToasted = new Set<string>()

/** Says once per folder that a todo folder is spelled `.claude_todo` in another letter case, so the mod leaves it alone. */
function noteMisspelled($: EngineInterface, path: string): void {
  if (!misspelledToasted.has(path)) {
    misspelledToasted.add(path)
    showToast($, `Claudeopticon skips ${path}: the folder name must be ${DIR} in lowercase. Rename it to ${DIR} to have it read and numbered.`)
  }
}

/**
 * Finds every `.claude_todo/` folder of the repo (and of the main checkout, from a worktree) with
 * git. Outside a repo, or when git fails, only the nearest one by the old rule counts, by its
 * absolute path so it can be written. A path git lists but the disk no longer has (a
 * tracked file deleted) is dropped.
 */
async function discoverFolders($: EngineInterface, previous?: TodoFolder[]): Promise<TodoFolder[]> {
  await loadGlobals($)
  const nearest = await findTodoDir($).catch(() => undefined)
  const nearestReal = nearest === undefined ? undefined : await realOf($, nearest)
  if (nearestReal !== undefined && isMisspelledTodo(nearestReal)) {
    // A disk that ignores case answers `.claude_todo` for `.Claude_todo`: the folder stays untrusted, so say why once.
    noteMisspelled($, nearestReal)
  }
  const alone = async (): Promise<TodoFolder[]> => {
    sessionDir = await realOf($, '.')
    looseRoot = sessionDir
    gitCommon = undefined
    // A search that finds no repo this time leaves no root of an earlier one trusted (a rediscover after a failed rev-parse).
    repoRoot = undefined
    centralRoot = undefined
    centralBlocked = false
    noteNoHome($, sessionDir)
    if (nearest === undefined) {
      return []
    }

    return [{ path: absNearest(nearest, nearestReal) ?? nearest, rel: nearest, isOther: false, ...(nearestReal === undefined ? {} : { real: nearestReal }) }]
  }
  try {
    // Bounded: a rev-parse that hangs is a failure, as one that fails is; one toast names it.
    const ran = await runInTime($, REV_PARSE)
    if (ran === TIMED_OUT) {
      noteTimedOut($, REV_PARSE)
    }
    const top = ran === TIMED_OUT || ran === undefined ? { exitCode: 1, stdout: '', stderr: '' } : ran
    // Exit 128 is git's answer outside a repo: normal. Any other failure to ask is told; a time-out already was.
    if (ran === undefined) {
      noteLayoutFailed($, 'git did not start')
    } else if (ran !== TIMED_OUT && top.exitCode !== 0 && top.exitCode !== 128) {
      noteLayoutFailed($, `git rev-parse exited ${top.exitCode}`)
    }
    let roots = top.exitCode === 0 ? repoRoots(top.stdout) : undefined
    if (roots !== undefined && (roots.isLinked === true || roots.main !== undefined)) {
      // The main checkout is the first entry of the worktree list, whatever the shape of the git dir; the common dir is the fallback only when the list fails.
      const listArgv = ['git', 'worktree', 'list', '--porcelain']
      const ranList = await runInTime($, listArgv)
      if (ranList === TIMED_OUT) {
        noteTimedOut($, listArgv)
      }
      const list = ranList === TIMED_OUT ? undefined : ranList
      roots = repoRoots(top.stdout, list?.exitCode === 0 ? list.stdout : '')
    }
    if (roots === undefined) {
      return await alone()
    }
    // Git must name the folder the session is in: GIT_DIR and GIT_WORK_TREE in the environment
    // (vcsh) or a core.worktree set elsewhere give well-formed output for another folder, whose todo and
    // `.git` this session must never write. Such a session takes the outside-a-repo path.
    if (!isSameFolder(sessionFolder(top.stdout), await realOf($, '.'))) {
      return await alone()
    }
    repoRoot = roots.root
    layoutFailToasted = false
    // The two worktree rules, both decided here. 1: a linked worktree whose main checkout git
    // names writes the main checkout's todo only; its own `.claude_todo/` is read but never written, as
    // it is outside `centralRoot`. 2: a worktree whose main checkout git cannot name (a separate git dir,
    // which `git worktree list` gives as the main entry) has none to defer to, so its own folder is the
    // central one; `isLinked` keeps Consolidate and Delete off there (`centralBlocked` below).
    centralRoot = roots.main ?? roots.root
    gitCommon = gitCommonDir(top.stdout)
    sessionDir = sessionFolder(top.stdout)
    looseRoot = undefined
    noteNoHome($, centralRoot)
    // Consolidate and Delete are off in a linked worktree (even one whose main checkout git did not name), when the main folder is the global one, and when HOME is unknown.
    const centralPath = `${centralRoot}/${DIR}`
    centralBlocked = roots.main !== undefined || roots.isLinked === true || !(globalsKnown || isWinPath(centralRoot)) || isGlobalTodo(centralPath) || isGlobalTodo((await realOf($, centralPath)) ?? centralPath)
    let listed: { path: string; rel: string }[]
    try {
      listed = [...(await listFolders($, roots.root)), ...(roots.main === undefined ? [] : await listFolders($, roots.main))]
      listFailToasted = false
    } catch (error) {
      if (!(error instanceof FolderListError)) {
        throw error
      }
      // A failed list is no list: a search after startup keeps the folders it had, so a folder that
      // stayed never leaves the board and its IDs still count. At startup there are none: the nearest one only.
      noteListFailed($, error, previous !== undefined)
      if (previous !== undefined) {
        return previous
      }
      listed = []
    }
    const found: { path: string; rel: string; real?: string }[] = []
    const globals = new Set<string>()
    let primary: string | undefined
    // The real paths of the checkouts git listed in: a folder that resolves outside them is a tracked symlink out of the repo.
    const realRoots = await Promise.all((roots.main === undefined ? [roots.root] : [roots.root, roots.main]).map(root => realOf($, root)))
    // Judged only when every root resolved: a root that did not leaves no basis to call a folder outside.
    const knownRoots = realRoots.every(one => one !== undefined) ? (realRoots as string[]) : []
    for (const listedOne of listed) {
      if (!(await fsBounded($, () => $.fs.exists(listedOne.path)).catch(() => false))) {
        continue
      }
      const real = await realOf($, listedOne.path)
      if (real !== undefined && knownRoots.length > 0 && !isGlobalTodo(real) && !isInsideRoots(real, knownRoots)) {
        noteOutsideRepo($, listedOne.path, real)
        continue
      }
      // Git's index spelling after a case-only rename (`Docs/` for `docs/`) is read in the disk's spelling, so the trust check, which compares by exact case, passes it.
      const one = diskSpelling(listedOne, real, roots.main === undefined ? [roots.root] : [roots.root, roots.main])
      // A folder spelled `.Claude_todo` on the disk is no todo folder: left out, and named once.
      if (isMisspelledTodo(one.path)) {
        noteMisspelled($, one.path)
        continue
      }
      found.push(real === undefined ? one : { ...one, real })
      if (isGlobalTodo(real ?? one.path)) {
        globals.add(one.path)
      }
      if (real !== undefined && real === nearestReal && primary === undefined) {
        primary = one.path
      }
    }
    if (nearest === undefined && primary === undefined && roots.main !== undefined) {
      // A linked worktree whose `.git` file the text rule could not read (a separate git dir): its main checkout's folder is the primary one.
      primary = found.find(one => one.path === `${roots.main}/${DIR}`)?.path
    }
    if (nearest !== undefined && primary === undefined) {
      // The nearest folder git did not list: keep it, named by its place in the repo when that shows, by its absolute path so it can be trusted.
      const path = absNearest(nearest, nearestReal) ?? nearest
      found.unshift({ path, rel: relIn(nearestReal, roots.root) ?? nearest, ...(nearestReal === undefined ? {} : { real: nearestReal }) })
      primary = path
    }

    const all = pickFolders(found, primary, globals, Infinity)
    cutFolders = all.slice(MAX_FOLDERS).map(one => one.path)
    await refreshCutIds($).catch(() => undefined)
    if (cutFolders.length > 0 && !cutToasted) {
      cutToasted = true
      showToast($, `This repo has ${all.length} todo folders. The pane shows ${MAX_FOLDERS}; the other ${cutFolders.length} are not shown, but their ticket IDs still count.`)
    }

    return all.slice(0, MAX_FOLDERS)
  } catch (error) {
    // Not a repo is a normal answer (exit 128 above); a throw is a failure to read the layout, told once.
    noteLayoutFailed($, error instanceof Error ? error.message : String(error))

    return alone()
  }
}

/** The folders found when the mod started; undefined until then. Git runs once per load; a reload does it again. */
let todoFolders: TodoFolder[] | undefined
let folderSearch: Promise<TodoFolder[]> | undefined
/** The nearest folder the last scan saw, to look it up among the known ones only when it changes. */
let nearestSeen: string | undefined

/** Counts the folder searches after startup (`rediscoverFolders`): a late answer of an older one is dropped. */
let folderSearchRound = 0

/**
 * The folder search after a Consolidate press. The folders the board has stay until
 * the search ends: a scan meanwhile uses them and never waits on git. The search is bounded; on a time-out
 * the old folders stay, and a late answer is taken only while no newer search started. A failed list keeps
 * the old folders (`discoverFolders`).
 */
async function rediscoverFolders($: EngineInterface): Promise<void> {
  const previous = todoFolders
  folderSearch = undefined
  nearestSeen = undefined
  folderSearchRound += 1
  const round = folderSearchRound
  const search = discoverFolders($, previous).then(found => {
    if (round === folderSearchRound) {
      todoFolders = found
    }
  })
  await boundedJob($, search.catch(() => undefined))
}

function ensureFolders($: EngineInterface): Promise<TodoFolder[]> {
  if (todoFolders !== undefined) {
    return Promise.resolve(todoFolders)
  }
  folderSearch ??= discoverFolders($).then(async found => {
    todoFolders = found

    return found
  })

  return folderSearch
}

// ---------------------------------------------------------------- consolidating

/** True when the three todo-tidying buttons are off: a linked worktree, or a main folder that would be the global one. */
let centralBlocked = false
/** The renumbered IDs Claude has not been told of yet. */
let pendingRenames: string[] = []
/** The tickets the mod numbered by itself that Claude has not been told of yet. */
let pendingNumbered: string[] = []
/** The duplicate tickets removed that Claude has not been told of yet. */
let pendingRemoved: string[] = []
/** The most new IDs Consolidate asks `freeIds` for at once: one pick scans CLAIM_SCAN blocks of BLOCK_SIZE IDs, so a count past that always fails. */
const PICK_CHUNK = 256

const toldKey = (me: string): string => `told-notes:${me}`
/** True once the stored waiting lines of this session were read into memory (once per load). */
let toldLoaded = false

/**
 * Brings the waiting renumbering, numbering and removal notes that an earlier load of this session
 * stored into memory, before the next prompt or tool result tells them: a reload between the change
 * and the prompt must not lose "#T7 is now". A store that does not read is tried again next time.
 */
async function loadToldNotes($: EngineInterface): Promise<void> {
  if (toldLoaded) {
    return
  }
  const got = await tryGet($, toldKey(await sessionOf($)))
  if (!got.ok) {
    return
  }
  toldLoaded = true
  const stored = readToldLists(got.value)
  pendingRenames = mergeToldLines(pendingRenames, stored.renames)
  pendingNumbered = mergeToldLines(pendingNumbered, stored.numbered)
  pendingRemoved = mergeToldLines(pendingRemoved, stored.removed)
}

/** Stores the waiting lines (what loadToldNotes reads); a store that fails leaves the memory as the only copy. */
async function saveToldNotes($: EngineInterface): Promise<void> {
  await storeSet($, toldKey(await sessionOf($)), { renames: pendingRenames, numbered: pendingNumbered, removed: pendingRemoved }).catch(() => undefined)
}

/** The empty `.md` files of the known folders, found by the last scan: the Delete empty todos button's work. */
let emptyFiles: { folder: string; path: string; name: string; rel?: string }[] = []
/** True when the central target file holds two or more identical tickets: the Delete duplicate tickets button's work. */
let hasDupTickets = false
/** The reference renames (old lowercase ID to the kept one) that Delete duplicate tickets could not write into some central archive file: the next press tries them again. */
let refsToFix: Record<string, string> = {}

/** The central folder: `<root of the main checkout>/.claude_todo`. */
function centralFolder(): string | undefined {
  return centralRoot === undefined ? undefined : `${centralRoot}/${DIR}`
}

/**
 * True when the Consolidate todos button shows: a repo's main checkout (not a worktree, not the
 * global folder), and more than one file to merge: the top-level todo files on the board, in any
 * folder, and every `.md` file outside the central folder that holds any text, an archive
 * file or one with no items included; or a source this session copied and did not empty. So the
 * "press Consolidate todos again" a toast asks for after a press that stopped half way has a button,
 * also when only a source archive file is left.
 */
function canConsolidate(): boolean {
  const places = new Set([...todoFiles.filter(file => file.isArchived !== true).map(fileId), ...filledSources])

  return !centralBlocked && centralRoot !== undefined && (places.size > 1 || copiedNotEmptied.size > 0)
}

/** True when the Delete empty todos button shows: the same gate, and an empty `.md` file in a known folder. */
function canDeleteEmpty(): boolean {
  return !centralBlocked && centralRoot !== undefined && emptyFiles.length > 0
}

/** True when the Delete duplicate tickets button shows: the same gate, and identical tickets in the target file. */
function canDeleteDupTickets(): boolean {
  return !centralBlocked && centralRoot !== undefined && (hasDupTickets || Object.keys(refsToFix).length > 0)
}

/**
 * The sources a Consolidate press copied into the target but did not empty, by path (`retryStep`
 * says what a retry does with each). Kept in the store per central folder (`marksKey`), so a reload
 * or another session knows them too; this map is the copy in memory, used when the store
 * cannot be read.
 */
let copiedNotEmptied = new Map<string, CopyMark>()
/** The marks this session was done with since its last stored save: a store read never brings them back. */
const droppedMarks = new Set<string>()

/** Ends a source's mark: in memory now, in the store with the next save that works. */
function dropMark(path: string): void {
  copiedNotEmptied.delete(path)
  droppedMarks.add(path)
}

const marksKey = (central: string): string => `consolidate-marks:${central}`

/**
 * Merges the stored marks of the central folder into memory (`mergeMarks`): a mark in memory is never
 * replaced by an older stored one after a save that failed. A store that cannot be read
 * leaves the memory as it is.
 */
async function loadMarks($: EngineInterface, central: string): Promise<void> {
  const got = await tryGet($, marksKey(central))
  if (got.ok) {
    copiedNotEmptied = mergeMarks(copiedNotEmptied, readKeptMarks(got.value), droppedMarks)
  }
}

/** Stores the marks; a store that cannot be written does not stop the press (the memory holds them, as before). */
async function saveMarks($: EngineInterface, central: string): Promise<void> {
  // Read again first: a mark another session stored since this session's last read stays in the written map.
  await loadMarks($, central)
  const isSaved = await Promise.resolve()
    .then(() => storeSet($, marksKey(central), Object.fromEntries(copiedNotEmptied)))
    .then(() => true, () => false)
  if (isSaved) {
    droppedMarks.clear()
  }
}

/** True when busy: the press is not run, and the user is told. */
function isBusy($: EngineInterface): boolean {
  if (isWorking || isArchiving || isNumbering) {
    showToast($, 'Busy, try again in a moment')

    return true
  }

  return false
}

/** Every item ID of every todo and archive file on the board, lowercase: all folders, the project-wide number line. */
function projectIds(): string[] {
  return [...todoFiles.flatMap(file => file.items.flatMap(item => (item.id === undefined ? [] : [item.id.toLowerCase()]))), ...cutIds]
}

/**
 * The `.md` files of a folder, top level and archive, as names inside it. An archived name starts with
 * the archive folder's own name on the disk (`archiveDirOf`): `Archive/x.md` on a disk that
 * ignores case, so a path built from the name is its own real path and the symlink check passes it.
 * A top-level name never holds a `/`, which is how a caller tells the two apart.
 */
async function mdFiles($: EngineInterface, folder: string, isStrict = false): Promise<string[]> {
  const names: string[] = []
  const archive = await archiveDirOf($, folder)
  for (const [dir, prefix] of [[folder, ''], [archive, `${archive.slice(folder.length + 1)}/`]] as const) {
    // Strict, a folder that will not answer or list is an error, not an empty or absent folder.
    if (!(isStrict ? await fsBounded($, () => $.fs.exists(dir)) : await fsBounded($, () => $.fs.exists(dir)).catch(() => false))) {
      continue
    }
    for (const entry of isStrict ? await fsBounded($, () => $.fs.list(dir)) : await fsBounded($, () => $.fs.list(dir)).catch(() => [])) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) {
        names.push(`${prefix}${entry.name}`)
      }
    }
  }

  return names
}

/**
 * The one read of a todo file: every todo read goes through here, so a read that failed is
 * never taken for an empty or an absent file. A read that throws is `missing` only when the disk says
 * nothing stands at the path; when that check fails too, the read is `failed`.
 */
async function readTodo($: EngineInterface, path: string): Promise<TodoRead> {
  let text: unknown
  try {
    text = await fsBounded($, () => $.fs.read(path))
  } catch (error) {
    const isThere = await fsBounded($, () => $.fs.exists(path)).then(is => is, () => true)

    return isThere ? { kind: 'failed', reason: reasonOf(error), error } : { kind: 'missing', error }
  }

  return typeof text === 'string' ? { kind: 'ok', text } : { kind: 'failed', reason: 'the read gave no text' }
}

/** The text of a todo file that must read: a failed or missing read is an error (the engine's own when it threw), never an empty file. */
async function readStrict($: EngineInterface, path: string): Promise<string> {
  const read = await readTodo($, path)
  if (read.kind === 'ok') {
    return read.text
  }

  throw read.error ?? new TodoReadError(path, readReason(read))
}

/**
 * Runs an outside command with a time limit: undefined when it fails to start, and
 * `TIMED_OUT` when it does not return within `RUN_LIMIT_MS`, so a call that hangs (a Finder
 * permission dialog, a stuck git) never holds the writer lock for good.
 */
function runInTime($: EngineInterface, argv: string[], options?: { cwd?: string }): Promise<Awaited<ReturnType<EngineInterface['process']['run']>> | undefined | typeof TIMED_OUT> {
  const work = Promise.resolve()
    .then(() => (options === undefined ? $.process.run(argv) : $.process.run(argv, options)))
    .catch(() => undefined)

  return inTime(work, RUN_LIMIT_MS, (ms, fire) => $.clock.after(ms, fire))
}

/** The programs a time-out toast named, so a hang is told once; a later answer in time clears its name. */
const timedOutTold = new Set<string>()

/** The name a time-out toast gives a command: the program, and for git its subcommand. */
const commandName = (argv: readonly string[]): string => argv.slice(0, argv[0] === 'git' ? 2 : 1).join(' ')

/** Tells once that `argv` did not return within `RUN_LIMIT_MS` and was taken as a failure. */
function noteTimedOut($: EngineInterface, argv: readonly string[]): void {
  const name = commandName(argv)
  if (!timedOutTold.has(name)) {
    timedOutTold.add(name)
    showToast($, `Claudeopticon stopped waiting for \`${name}\` after ${RUN_LIMIT_MS / 1000} s and took it as failed, so a stuck command does not stop the todo writes.`)
  }
}

/**
 * A job under the writer lock, bounded by `RUN_LIMIT_MS`: after the limit the caller goes on and the
 * lock is freed. The job itself is not stopped: it runs on without the lock, and anything that waits on it waits
 * still. So every outside call a job makes is bounded on its own (`runInTime`), and every job ends.
 */
function boundedJob<T>($: EngineInterface, job: Promise<T>): Promise<T | typeof TIMED_OUT> {
  return inTime(job, RUN_LIMIT_MS, (ms, fire) => $.clock.after(ms, fire))
}

/** What a guarded todo write did (`writeIfUnchanged`). */
type WriteOutcome = { kind: 'written' } | { kind: 'changed' } | { kind: 'unread'; reason: string } | { kind: 'unsafe'; reason: string } | { kind: 'refused' }

/**
 * Why a file may not be written at `path`, or undefined when it may: an existing file must be a
 * plain file that is its own real path; a missing one must have nothing at its name (no dangling
 * symlink), and its folder, when there, must be its own real path. Never through a symlink.
 */
async function placeProblem($: EngineInterface, path: string): Promise<string | undefined> {
  if (await fsBounded($, () => $.fs.exists(path))) {
    return plainFileProblem($, path)
  }
  if (await hasEntry($, path)) {
    return 'something that is no file stands at its name (a dangling symlink?)'
  }
  const dir = path.slice(0, path.lastIndexOf('/'))
  if ((await fsBounded($, () => $.fs.exists(dir))) && !samePath((await realOf($, dir)) ?? '', dir)) {
    return 'its folder is a symlink or could not be read'
  }

  return undefined
}

/**
 * The one write of a todo file: every todo write goes through here,
 * and `scripts/check-writes.ts` fails on any other. It does every check first: the folder's trust
 * (`folder`), the file's place (`placeProblem`), then the caller's own step that must come before the
 * write (`before`: a record or a mark stored; false stops the write). Then it reads the file and
 * compares it with `expected`, the text the caller computed `next` from, and writes `next` with no
 * await between that read and the write, so an edit made while any check or store call ran is never
 * written over. A missing file counts as `expected` '' only with `mayCreate`; then a write that fails
 * makes the folder (`mkdir -p`, no shell), checks the file's place again, and reads and compares again before it writes. A read that
 * fails is `unread`, never a change and never an empty file; a write that fails throws.
 */
async function writeIfUnchanged($: EngineInterface, path: string, expected: string, next: string, opts: { folder?: string; mayCreate?: boolean; before?: () => Promise<boolean> } = {}): Promise<WriteOutcome> {
  const isCreate = opts.mayCreate === true
  const trust = opts.folder === undefined ? undefined : await trustProblem($, opts.folder)
  if (trust !== undefined) {
    return { kind: 'unsafe', reason: trust }
  }
  const place = await placeProblem($, path)
  if (place !== undefined) {
    return { kind: 'unsafe', reason: place }
  }
  if (opts.before !== undefined && !(await opts.before())) {
    return { kind: 'refused' }
  }
  // The read and compare: the last await before the write.
  let read = await readTodo($, path)
  let isSame = read.kind === 'ok' ? read.text === expected : read.kind === 'missing' && isCreate && expected === ''
  if (read.kind === 'failed') {
    return { kind: 'unread', reason: read.reason }
  }
  if (!isSame) {
    return { kind: 'changed' }
  }
  try {
    await $.fs.write(path, next)
  } catch (error) {
    // Only a file that is not there may need its folder made; a check that fails counts as there.
    if (!isCreate || (await fsBounded($, () => $.fs.exists(path)).catch(() => true))) {
      throw error
    }
    const made = await runInTime($, ['mkdir', '-p', path.slice(0, path.lastIndexOf('/'))])
    if (made === undefined || made === TIMED_OUT || made.exitCode !== 0) {
      throw error
    }
    // The folder is new: its place is checked again, so a symlink made at its name meanwhile is never written through.
    const madePlace = await placeProblem($, path)
    if (madePlace !== undefined) {
      return { kind: 'unsafe', reason: madePlace }
    }
    read = await readTodo($, path)
    isSame = read.kind === 'ok' ? read.text === expected : read.kind === 'missing' && expected === ''
    if (read.kind === 'failed') {
      return { kind: 'unread', reason: read.reason }
    }
    if (!isSame) {
      return { kind: 'changed' }
    }
    await $.fs.write(path, next)
  }

  return { kind: 'written' }
}

let isWorking = false

/**
 * The one file the central todo is merged into: `TODO.md` when the central folder has it; else the
 * only top-level `.md` todo file (one with checkbox items) when there is exactly one; else `TODO.md`,
 * to be created.
 */
async function chooseTarget($: EngineInterface, central: string, topNames: readonly string[]): Promise<string> {
  // Names compare without case, as the disk may: a `todo.md` is the target, by its own name.
  const main = topNames.find(name => name.toLowerCase() === 'todo.md')
  if (main !== undefined) {
    return main
  }
  const todo: string[] = []
  for (const name of topNames) {
    if (itemLines(await readStrict($, `${central}/${name}`)).length > 0) {
      todo.push(name)
    }
  }

  return todo.length === 1 ? todo[0]! : 'TODO.md'
}

/**
 * Why a path is no regular file that is its own real path (no symlink in the file or the folders
 * above it), or undefined when it is one. The reason tells a check that failed from a symlink
 *: a stat that did not answer is not called a symlink.
 */
async function plainFileProblem($: EngineInterface, path: string): Promise<string | undefined> {
  const stat = await fsBounded($, () => $.fs.stat(path)).catch(() => undefined)
  if (stat === undefined) {
    return 'it could not be checked (the stat failed)'
  }
  if (stat.kind !== 'file') {
    return 'it is not a plain file'
  }
  const real = await realOf($, path)
  if (real === undefined) {
    return 'its real path could not be read'
  }

  return samePath(real, path) ? undefined : 'a symlink is in its path'
}

/** True for a regular file that is its own real path: no symlink in the file or the folders above it. */
async function isPlainFile($: EngineInterface, path: string): Promise<boolean> {
  return (await plainFileProblem($, path)) === undefined
}

/** True when anything stands at the path's name in its folder, a dangling symlink included; a folder that will not list counts as yes. */
async function hasEntry($: EngineInterface, path: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  if (!(await fsBounded($, () => $.fs.exists(dir)).catch(() => true))) {
    return false
  }
  const entries = await fsBounded($, () => $.fs.list(dir)).catch(() => undefined)

  return entries === undefined || entries.some(entry => entry.name === path.slice(dir.length + 1))
}

/**
 * Whether a folder may be changed by the mod: an absolute path with no `..`, ending in
 * `.claude_todo`, that is its own real path (so no symlink is in it), inside the main checkout, and
 * not the global one. Outside a repo there is no checkout: only the session folder's own
 * `.claude_todo` passes, by the same rules.
 */
async function isTrustedDir($: EngineInterface, path: string): Promise<boolean> {
  return (await trustProblem($, path)) === undefined
}

/**
 * Why a folder may not be changed by the mod (the rule of `isTrustedDir`, above), or undefined when
 * it may. The reason tells a path that could not be read from a symlink and from a folder outside
 * the checkout; the rule is the same.
 */
async function trustProblem($: EngineInterface, path: string): Promise<string | undefined> {
  if (centralRoot === undefined && looseRoot !== undefined && !samePath(path, `${looseRoot}/${DIR}`)) {
    return 'outside this repo'
  }
  const parts = path.split('/')
  // A `..` is refused by its text (M43). It is defense in depth: the engine folds a `..`
  // before the disk sees it, so the real path differs from the text and the check below refuses it
  // too. This one holds if a real path ever comes back unfolded.
  if (!(path.startsWith('/') || /^[A-Za-z]:\//.test(path)) || parts.includes('..') || parts.filter(part => part !== '').pop() !== DIR) {
    return `not a ${DIR} folder by its path`
  }
  // Without a known HOME the global folder cannot be told from a project one: nothing is trusted (a Windows path is told by its text).
  if (!globalsKnown && !isWinPath(path)) {
    return 'the home folder is not known'
  }
  const real = await realOf($, path)
  const base = centralRoot ?? looseRoot
  const root = base === undefined ? undefined : await realOf($, base)

  if (real === undefined || root === undefined) {
    return real === undefined ? 'its real path could not be read' : "the repo's real path could not be read"
  }
  const [nReal, nRoot] = [normPath(real).normalize('NFC'), normPath(root).normalize('NFC')]

  // The global checks (M02; ): discovery drops a folder whose real path was global at
  // load, and loadGlobals adds the real path of a linked global folder, so the `isGlobalTodo` test below
  // is defense in depth for those. A folder can still reach here global: a symlink at `~/.claude`, HOME,
  // CLAUDE_CONFIG_DIR or `~/.claude/.claude_todo` made after the load, which the loop over
  // `globalParents` below catches. This is the one gate every write passes.
  if (nReal !== normPath(path).normalize('NFC')) {
    return 'a symlink is in its path'
  }
  if (!nReal.startsWith(`${nRoot}/`)) {
    return 'outside this repo'
  }
  if (isGlobalTodo(nReal)) {
    return 'the global todo folder'
  }
  // Each global parent, and its `.claude_todo` itself, is resolved again now: a symlink at
  // `~/.claude`, HOME or CLAUDE_CONFIG_DIR, or at `~/.claude/.claude_todo` pointing at this folder, made
  // after the load still names this folder global. A path that does not resolve cannot be this folder, which exists.
  for (const parent of globalParents) {
    const realParent = await realOf($, parent)
    if (realParent !== undefined && isTodoOf(nReal, [realParent])) {
      return 'the global todo folder'
    }
    if (isSameTodo(nReal, await realOf($, `${parent.replace(/[\\/]+$/, '')}/${DIR}`))) {
      return 'the global todo folder'
    }
  }

  return undefined
}

/**
 * Moves the work to one central todo, `<root of the main checkout>/.claude_todo/`: every non-blank
 * line of every other top-level todo file (other folders, and the central folder's own extra files)
 * goes into the target file, in order, under a `## From <place>/<file>` heading. Archive files of
 * other folders go to the same-named central archive file the same way. An item ID the central
 * files that stay already use gets the next free one, and references to it in the same file follow.
 * Each destination is written once, if it did not change since it was read, then read again to
 * confirm the block is there. Only then is a source emptied, and only if its text is still what was
 * copied; a source that changed is left and named. The target is never emptied. Then the folders are
 * found again (the one discovery outside startup). Off in a linked worktree and when the main
 * folder would be the global one.
 */
async function consolidate($: EngineInterface): Promise<void> {
  await withWriteLock(() => consolidateLocked($))
}

async function consolidateLocked($: EngineInterface): Promise<void> {
  const central = centralFolder()
  if (central === undefined || !canConsolidate() || isBusy($)) {
    return
  }
  isWorking = true
  // What the press did so far, for the message when it stops half way.
  const progress = { written: [] as string[], emptied: [] as string[] }
  try {
    const sources: { path: string; rel: string }[] = []
    // A source that will not list or read stays as it is: nothing of it is copied, and the press says so.
    // A source folder that is not trusted (a symlink, or outside the checkout) is named the same way, not dropped in silence.
    const unreadable: string[] = []
    for (const one of todoFolders ?? []) {
      if (one.path === central) {
        continue
      }
      // The reason says which check failed: a path that would not read is not called a symlink.
      const why = await trustProblem($, one.path)
      if (why === undefined) {
        sources.push({ path: one.path, rel: one.rel })
      } else {
        unreadable.push(`${one.path} (not safe: ${why})`)
      }
    }
    const texts = new Map<string, string>()
    const centralText = async (name: string) => {
      const held = texts.get(name)
      if (held !== undefined) {
        return held
      }
      const path = `${central}/${name}`
      // An existing central file that cannot be read aborts the press: it is never written over.
      const text = (await fsBounded($, () => $.fs.exists(path))) ? await readStrict($, path) : ''
      texts.set(name, text)

      return text
    }
    // One target file takes everything; the central folder's other top-level todo files are merged into it.
    const centralNames = await mdFiles($, central, true)
    // A top-level name holds no `/`; an archived one starts with the archive folder's disk name, `archive/` or `Archive/`.
    const topNames = centralNames.filter(name => !name.includes('/'))
    const target = await chooseTarget($, central, topNames)
    const mergeNames: string[] = []
    for (const name of topNames) {
      if (name !== target && itemLines(await centralText(name)).length > 0) {
        mergeNames.push(name)
      }
    }
    // The IDs of the central files that stay; a moved file keeps its own IDs unless they clash with those.
    const used = new Set<string>()
    for (const name of centralNames.filter(one => !mergeNames.includes(one))) {
      for (const line of itemLines(await centralText(name))) {
        const id = ITEM_ID.exec(line)?.[1]
        if (id !== undefined) {
          used.add(id.toLowerCase())
        }
      }
    }
    type Job = { path: string; name: string; heading: string; text: string; dest: string; lines: string[]; group: string }
    const jobs: Job[] = []
    // The sources whose copy would end inside an unclosed code block or HTML comment: one would swallow every section
    // after it. They are not copied and stay as they are, named, with their marks kept.
    const openSources: string[] = []
    // The sources whose name cannot stand in a `## From` heading (a line break, a control character or a format character): the heading
    // would add lines to the central todo. They are not copied and stay as they are, named, marks kept.
    const badNames: string[] = []
    // The central folder's archive folder and the files in it, as its disk spells them: `Archive/` too.
    const centralArchive = (await archiveDirOf($, central)).slice(central.length + 1)
    const centralArchived = centralNames.filter(one => one.includes('/')).map(one => one.slice(one.indexOf('/') + 1))
    const add = (path: string, name: string, heading: string, text: string, group: string) => {
      const lines = copyLines(text)
      if (lines.some(line => line.trim() !== '')) {
        if (isUnsafeHeadingName(heading)) {
          badNames.push(path)

          return
        }
        if (endsInExample(lines.join('\n'))) {
          openSources.push(path)

          return
        }
        // An archived source (in `archive/` or `Archive/`) goes to the central folder's own archive, as its disk spells it.
        jobs.push({ path, name, heading, text, dest: destOf(name, target, centralArchive, centralArchived), lines, group })
      }
    }
    for (const name of mergeNames) {
      if (await isPlainFile($, `${central}/${name}`)) {
        add(`${central}/${name}`, name, name, await centralText(name), central)
      }
    }
    // The source folders with a file that did not read: none of their files is a job this press, but the marks of their healthy files stay.
    const heldFolders: string[] = []
    for (const source of sources) {
      const names = await mdFiles($, source.path, true).catch(() => undefined)
      if (names === undefined) {
        unreadable.push(source.path)
        continue
      }
      const read: { name: string; text: string }[] = []
      for (const name of names) {
        // A file behind a symlink (or in a symlinked archive/) counts as unreadable: the source stays.
        const why = await plainFileProblem($, `${source.path}/${name}`)
        const text = why === undefined ? await readStrict($, `${source.path}/${name}`).catch(() => undefined) : undefined
        if (text === undefined) {
          read.length = 0
          heldFolders.push(source.path)
          unreadable.push(why === undefined ? `${source.path}/${name}` : `${source.path}/${name} (${why})`)
          break
        }
        read.push({ name, text })
      }
      for (const one of read) {
        add(`${source.path}/${one.name}`, one.name, `${placeOf(source.rel)}/${one.name}`, one.text, source.path)
      }
    }
    const unreadNote = unreadable.length > 0 ? `Not read, left as they are: ${unreadable.join(', ')}` : undefined
    const openNote = openSources.length > 0 ? `Not copied, left as they are: ${openSources.join(', ')} (ends inside an unclosed code block or HTML block). Close it, then press Consolidate todos again.` : undefined
    // Named as JSON: the name's line breaks show as \n, never as lines of the toast.
    const nameNote = badNames.length > 0 ? `Not copied, left as they are: ${badNames.map(one => JSON.stringify(one)).join(', ')} (the name holds a line break, a control character or a format character, which a heading cannot hold). Rename it, then press Consolidate todos again.` : undefined
    if (jobs.length === 0) {
      for (const note of [unreadNote, openNote, nameNote]) {
        if (note !== undefined) {
          showToast($, note)
        }
      }

      return
    }
    // A source copied by an earlier press (of any session, before a reload too) that was not emptied is never
    // copied again: it is only emptied, or, when it changed after that copy, left and named.
    await loadMarks($, central)
    const fresh: Job[] = []
    const changedSince: string[] = []
    const isStale = new Set<Job>()
    for (const job of jobs) {
      const step = retryStep(copiedNotEmptied.get(job.path), job.heading, job.lines, await centralText(job.dest))
      if (step === 'copy') {
        dropMark(job.path)
        fresh.push(job)
      } else if (step === 'changed') {
        isStale.add(job)
        changedSince.push(job.path)
      }
    }
    // A mark whose source is no longer a job (emptied or deleted by hand) is done with; an unreadable source keeps its mark,
    // and so does one not copied for an open end. An unreadable entry may carry its reason in parentheses: the path is before it.
    const kept = [...unreadable.map(one => one.replace(/ \([^()]*\)$/, '')), ...heldFolders, ...openSources, ...badNames]
    for (const path of [...copiedNotEmptied.keys()]) {
      if (!jobs.some(job => job.path === path) && !kept.some(one => path === one || path.startsWith(`${one}/`))) {
        dropMark(path)
      }
    }
    // The blocks per destination, with the renumbering of each file.
    const blocks = new Map<Job, string[]>()
    const toldOf = new Map<Job, string[]>()
    // Every ID of every moved file: a new ID never takes one a later file keeps, so one clash renames one line.
    // The IDs of every folder and archive on the board are reserved too: a new value is free project-wide.
    const reserved = new Set([
      ...projectIds(),
      ...reservedIds.keys(),
      ...jobs.flatMap(job => job.lines.flatMap(line => {
        const id = CHECKBOX.test(line) ? ITEM_ID.exec(line)?.[1] : undefined

        return id === undefined ? [] : [id.toLowerCase()]
      })),
    ])
    // Each new `T` ID comes from this session's claimed block, as numbering's and the prompt offers' do:
    // a dry run counts them, `freeIds` gives them (recorded in `givenIds`), and they are stored with the repo's
    // reservations before any write, so no prompt, numbering pass or other session names one of them.
    const tCount = (() => {
      const dry = new Set(used)

      return fresh.reduce((sum, job) => sum + renumberLines(job.lines, dry, reserved).pairs.filter(pair => ticketValue(pair.to) !== undefined).length, 0)
    })()
    const supply: string[] = []
    if (tCount > 0) {
      const me = await sessionOf($)
      // The disk too, not only the board: a file may hold an ID the board has not seen yet.
      const onDisk = await diskIds($)
      // At most PICK_CHUNK IDs per pick: one pick holds at most CLAIM_SCAN blocks, so a larger count would fail every press.
      let picked: string[] | undefined = []
      for (let left = tCount; left > 0 && picked !== undefined; left -= PICK_CHUNK) {
        const part = await freeIds($, [...reserved, ...used, ...onDisk, ...picked], Math.min(PICK_CHUNK, left))
        picked = part === undefined ? undefined : [...picked, ...part]
      }
      if (picked === undefined) {
        throw new Error('no new ticket IDs could be claimed for the renumbering, so nothing was moved')
      }
      const ids = picked.map(id => id.toLowerCase())
      for (const id of ids) {
        reservedIds.set(id, { until: nowSync() + RESERVE_MS, by: me })
      }
      const lost = await syncReserved($)
      if (lost === undefined || lost.some(id => ids.includes(id))) {
        ids.forEach(id => reservedIds.delete(id))
        await syncReserved($, lost === undefined ? ids : ids.filter(id => !lost.includes(id)))
        throw new Error('the new ticket IDs for the renumbering could not be stored, so nothing was moved')
      }
      supply.push(...picked)
    }
    const renamed = new Map<Job, ReturnType<typeof renumberLines>>()
    for (const job of fresh) {
      renamed.set(job, renumberLines(job.lines, used, reserved, () => supply.shift()))
    }
    // One rename map per source folder: a file of the folder that names a ticket another file of the
    // folder renamed follows it. An ID the file owns itself, or that two files renamed differently, is left.
    for (const job of fresh) {
      const mine = renamed.get(job)!
      const owns = new Set(lineOwnIds(job.lines.map(bare)).flatMap(id => (id === undefined ? [] : [id.toLowerCase()])))
      const cross: Record<string, string> = {}
      const clash = new Set<string>()
      for (const other of fresh) {
        if (other === job || other.group !== job.group) {
          continue
        }
        for (const [old, to] of Object.entries(renamed.get(other)!.renames)) {
          if (owns.has(old)) {
            continue
          }
          if (cross[old] !== undefined && cross[old] !== to) {
            clash.add(old)
          }
          cross[old] = to
        }
      }
      clash.forEach(old => delete cross[old])
      // Lines in a code fence or an HTML comment are examples and keep their IDs.
      blocks.set(job, renameLines(mine.lines, cross))
      toldOf.set(job, mine.pairs.map(pair => `- ${job.heading}: #${pair.from} is now #${pair.to}`))
    }
    const emptied: string[] = []
    const left: string[] = []
    const skipped: string[] = []
    const failed: string[] = []
    const told: string[] = []
    // The destinations that end inside an unclosed code block or comment, or whose sections would not all stay items.
    const openEnded: string[] = []
    // The destinations a check refused, with the check's own reason: never called "changed meanwhile".
    const notSafe: string[] = []
    progress.emptied = emptied
    for (const dest of [...new Set(jobs.map(job => job.dest))]) {
      const path = `${central}/${dest}`
      // A source that changed after an earlier copy is neither copied nor emptied here.
      const mine = jobs.filter(one => one.dest === dest && !isStale.has(one))
      if (mine.length === 0) {
        continue
      }
      try {
        const list = fresh.filter(one => one.dest === dest).map(one => ({ job: one, place: one.heading, lines: blocks.get(one)! }))
        if (list.length > 0) {
          // The text the press read: the write below happens only if the file still holds it.
          const now = await centralText(dest)
          // Sections added after an open code fence or HTML comment would sit inside it, and leave the board.
          if (endsInExample(now)) {
            openEnded.push(`${DIR}/${dest}`)
            continue
          }
          const next = appendSections(now, list)
          // The result's items must be exactly the target's and then every section's, by text and box, before anything is
          // written or emptied: a count alone passes a lost item and an added one together.
          if (!keepsEveryItem(now, next, list)) {
            openEnded.push(`${DIR}/${dest}`)
            continue
          }
          // Marked before the write, and stored by the write's own `before` step: if the confirming read fails, or the press
          // stops before a source is emptied, a retry (after a reload too) empties the source instead of copying it again.
          // The store call comes before the write's last read and compare, so an edit made during it is never written over.
          for (const one of list) {
            droppedMarks.delete(one.job.path)
            copiedNotEmptied.set(one.job.path, { heading: one.job.heading, lines: one.job.lines, sectionsBefore: sectionCount(now, one.job.heading), told: toldOf.get(one.job) ?? [], isTold: false, copied: one.lines })
          }
          // Never written through a symlink: the central folder, its archive/ and an existing file must be their own real paths.
          const wrote = await writeIfUnchanged($, path, now, next, {
            folder: central,
            mayCreate: true,
            before: async () => {
              await saveMarks($, central)

              return true
            },
          })
          if (wrote.kind !== 'written') {
            // Not written: the marks go, and the sources stay as they are.
            list.forEach(one => dropMark(one.job.path))
            if (wrote.kind === 'unread') {
              failed.push(`${DIR}/${dest} (could not be read: ${wrote.reason})`)
            } else if (wrote.kind === 'unsafe') {
              notSafe.push(`${DIR}/${dest} (${wrote.reason})`)
            } else {
              skipped.push(`${DIR}/${dest}`)
            }
            continue
          }
          // Confirmed from the disk before any source is emptied.
          const after = await readStrict($, path)
          const eol = eolOf(now)
          if (!list.every(block => after.includes(sectionText(block.place, block.lines, eol)))) {
            list.forEach(one => dropMark(one.job.path))
            skipped.push(`${DIR}/${dest} (not confirmed)`)
            continue
          }
          progress.written.push(`${DIR}/${dest}`)
        } else {
          // Every source here was copied before: its copy must still be in the target, edited or not.
          const now = (await fsBounded($, () => $.fs.exists(path))) ? await readStrict($, path) : ''
          if (!mine.every(job => retryStep(copiedNotEmptied.get(job.path), job.heading, job.lines, now) === 'empty')) {
            skipped.push(`${DIR}/${dest}`)
            continue
          }
        }
        // The renumbering notes of this destination are queued now it is confirmed, whatever happens to the sources.
        for (const job of mine) {
          const mark = copiedNotEmptied.get(job.path)
          if (mark !== undefined && !mark.isTold) {
            mark.isTold = true
            pendingRenames = [...pendingRenames, ...mark.told]
            told.push(...mark.told)
            await saveToldNotes($)
          }
        }
        for (const job of mine) {
          if (job.path === path) {
            continue
          }
          try {
            // Emptied only if it is still what was copied. A read that fails is a failure, not a change: the source
            // stays marked, so the next press only empties it.
            // The checks first, then the read and compare as the last call before the write.
            const cut = await writeIfUnchanged($, job.path, job.text, '')
            if (cut.kind === 'written') {
              emptied.push(job.path)
              dropMark(job.path)
            } else if (cut.kind === 'changed') {
              // Changed since the copy: it stays marked, so a retry names it and never copies it a second time.
              left.push(job.path)
            } else {
              // Not checked or not read: a failure, not a change. It stays marked, so the next press only empties it.
              failed.push(`${job.path} (${cut.kind === 'refused' ? 'not written' : cut.kind === 'unsafe' ? `not safe: ${cut.reason}` : `could not be read: ${cut.reason}`})`)
            }
          } catch (error) {
            // Copied, not emptied: it stays marked so the next press only empties it. Only `failed` names it: it did not change.
            failed.push(`${job.path} (${error instanceof Error ? error.message : String(error)})`)
          }
        }
      } catch (error) {
        failed.push(`${DIR}/${dest} (${error instanceof Error ? error.message : String(error)})`)
      }
    }
    await saveMarks($, central)
    // The one discovery outside startup: the git index again. The board keeps its folders until it ends.
    await rediscoverFolders($)
    // Bounded: a scan that does not end in time frees the writer lock; it goes on, and its late result still counts.
    await boundedJob($, scan($, true).catch(() => undefined))
    // One toast for the whole press: a host that keeps only the last toast of a burst would lose every refusal.
    const notes: string[] = []
    if (openEnded.length > 0) {
      notes.push(`Not written: ${openEnded.join(', ')} ends inside an unclosed code block or HTML block, so the moved tickets would not be tickets there. Their sources are as they were. Close it, then press Consolidate todos again.`)
    }
    if (openNote !== undefined) {
      notes.push(openNote)
    }
    if (nameNote !== undefined) {
      notes.push(nameNote)
    }
    if (notSafe.length > 0) {
      notes.push(`Not written, not safe to change: ${notSafe.join(', ')}. Their sources are as they were. Press Consolidate todos again.`)
    }
    if (skipped.length > 0) {
      notes.push(`Not written, changed meanwhile: ${skipped.join(', ')}. Their sources are as they were. Press Consolidate todos again.`)
    }
    if (left.length > 0) {
      notes.push(`Left as they are, changed since the copy: ${left.join(', ')}`)
    }
    if (changedSince.length > 0) {
      notes.push(`Not copied again, changed since an earlier copy: ${changedSince.join(', ')}. The central ${DIR}/ holds that copy under its "## From" heading. Empty the file, or take that section out, then press Consolidate todos again.`)
    }
    if (failed.length > 0) {
      notes.push(`Not finished: ${failed.join('; ')}. Written to the target: ${progress.written.length > 0 ? progress.written.join(', ') : 'nothing'}. Emptied: ${emptied.length > 0 ? emptied.join(', ') : 'none'}. Press Consolidate todos again to finish.`)
    }
    if (unreadNote !== undefined) {
      notes.push(unreadNote)
    }
    const summary = `Moved ${emptied.length} ${emptied.length === 1 ? 'file' : 'files'} into ${DIR}/${target} at the repo root.${told.length > 0 ? ` Renumbered: ${told.map(line => line.slice(2)).join('; ')}` : ''}`
    showToast($, pressToast(notes, summary, emptied.length))
  } catch (error) {
    showToast($, `Could not consolidate: ${error instanceof Error ? error.message : String(error)}. Written to the target: ${progress.written.length > 0 ? progress.written.join(', ') : 'nothing'}. Emptied: ${progress.emptied.length > 0 ? progress.emptied.join(', ') : 'none'}.`)
  } finally {
    isWorking = false
    redraw($)
  }
}

// ---------------------------------------------------------------- archiving closed tickets

/** The archive file the Show completed link opens; undefined until a scan has made sure it exists. */
let archiveLink: string | undefined

/**
 * Works out the archive file of the central folder (else the primary one) that the Show completed
 * button opens. The button shows when the folder is trusted and the file is either a plain `.md`
 * file (its own real path, no symlink) or not there at all. Nothing is created here: a file made
 * during a scan could overwrite an archive move that lands a moment later. `openArchive` creates
 * it, under the writer lock, when the button is pressed.
 */
async function refreshArchiveLink($: EngineInterface): Promise<void> {
  const folders = todoFolders ?? []
  const central = centralFolder()
  const folder = folders.find(one => one.path === central) ?? folders.find(one => !one.isOther)
  let link: string | undefined
  if (folder !== undefined) {
    const dir = await archiveDirOf($, folder.path)
    const path = `${dir}/${archiveName(todoFiles, folder.path)}`
    if (await isTrustedDir($, folder.path)) {
      if (await hasEntry($, path)) {
        link = (await isArchiveFile($, path)) ? path : undefined
      } else if (!(await fsBounded($, () => $.fs.exists(dir)).catch(() => false)) || samePath((await realOf($, dir)) ?? '', dir)) {
        link = path
      }
    }
  }
  if (link !== archiveLink) {
    archiveLink = link
    redraw($)
  }
}

/** True for an archive file the mod may open: a plain file (no symlink in it or above it) whose name ends in `.md`. */
async function isArchiveFile($: EngineInterface, path: string): Promise<boolean> {
  return path.endsWith('.md') && (await isPlainFile($, path)) && ((await realOf($, path)) ?? '').endsWith('.md')
}

/** The first time a closed block was seen closed, by file and text: the debounce. */
const closedAt = new Map<string, number>()
let isArchiving = false

/**
 * Moves the closed tickets of every trusted top-level todo file to `archive/<same name>`, under the
 * heading each had. For each file: read it; read the archive; write the archive; read it back and
 * check every moved line is there; read the file again and write it without those lines only if it
 * is unchanged since the first read. Otherwise nothing more happens this scan: the next one tries
 * again, and the archive's own check keeps a block from being added twice. Never through a symlink,
 * never into the global folder, never from a file that did not read.
 */
async function archiveDone($: EngineInterface): Promise<boolean> {
  if (isArchiving || isWorking) {
    return false
  }
  isArchiving = true
  try {
    // A held lock skips this scan; the next one tries again. True: a file was rewritten, so the scan runs again.
    return (await tryWriteLock(() => archivePass($))) === true
  } finally {
    isArchiving = false
  }
}

/** One archive pass over the todo files, under the writer lock; true when a file was rewritten. */
async function archivePass($: EngineInterface): Promise<boolean> {
  const time = await $.clock.now()
  const seen = new Set<string>()
  let isMoved = false
  for (const file of todoFiles) {
    if (file.isArchived === true || file.name.includes('/') || !file.items.some(item => item.status === 'completed')) {
      continue
    }
    const path = `${file.folder}/${file.name}`
    if (!(await isTrustedDir($, file.folder)) || !(await isPlainFile($, path))) {
      continue
    }
    const read = await readTodo($, path)
    if (read.kind !== 'ok') {
      continue
    }
    const text = read.text
    const ready = closedBlocks(text).filter(block => {
      const sign = `${path}\0${block.lines.join('\n')}`
      seen.add(sign)
      closedAt.set(sign, closedAt.get(sign) ?? time)

      return time - closedAt.get(sign)! >= ARCHIVE_AFTER_MS
    })
    // One file that fails leaves itself as it is; the others go on.
    // A move that throws is told once per file, then retried at each scan (the cause may clear).
    const moved =
      ready.length > 0 &&
      (await moveBlocks($, file, path, text, ready).catch(error => {
        toldOnce(`${path}\0threw`, () => toastFailure($, `archive ${path} into ${file.folder}/archive`)(error))

        return false
      }))
    if (moved) {
      isMoved = true
    }
  }
  for (const sign of [...closedAt.keys()]) {
    if (!seen.has(sign)) {
      closedAt.delete(sign)
    }
  }

  return isMoved
}

/**
 * The record of what this mod wrote last to each archive file: one store key per archive
 * path, shared by every session, so a retry skips a block this mod wrote whatever session or load
 * makes it. Written before the archive write, cleared (null) once the source is cut. The key is the
 * archive's real path, in one spelling (NFC, Windows slashes and drive folded), so two
 * sessions that reach one folder by different paths share it.
 */
function wroteKey(record: string): string {
  return `archive-wrote:${record}`
}

/** The record path of a todo file's archive: the real path of its folder, in one spelling, then `archive/` and its name; undefined when the folder's real path cannot be read. */
async function recordOf($: EngineInterface, file: TodoFile): Promise<string | undefined> {
  const real = await realOf($, file.folder)

  return real === undefined ? undefined : `${normPath(real).normalize('NFC')}/archive/${file.name.normalize('NFC')}`
}

/** The clears of a record that failed, by record path: written again before the next move of that file. */
const wrotePending = new Map<string, null>()

/**
 * The blocks this mod wrote last to the archive file, read from the store; undefined when the record
 * cannot be read (or a pending clear cannot be written), and the move must wait. An archive with no
 * record under its real path takes the record under the path the scan gave (`target`, the key of
 * 0.8 before ), and then its entry from the per-session record of 0.7.
 */
async function readWrote($: EngineInterface, record: string, target: string): Promise<string[][] | undefined> {
  if (wrotePending.has(record) && !(await writeWrote($, record, null))) {
    return undefined
  }
  const got = await tryGet($, wroteKey(record))
  if (!got.ok) {
    return undefined
  }
  if (got.value !== undefined) {
    return readKeptBlocks(got.value)
  }
  if (record !== target) {
    const byTarget = await tryGet($, wroteKey(target))
    if (!byTarget.ok) {
      return undefined
    }
    if (byTarget.value !== undefined) {
      return readKeptBlocks(byTarget.value)
    }
  }
  // The old record is a fallback only: with no session ID there is none of this session's to read.
  const me = await Promise.resolve()
    .then(() => $.session.id())
    .catch(() => undefined)
  if (me === undefined) {
    return []
  }
  const legacy = await tryGet($, `archive-wrote:${me}`)

  return legacy.ok ? (readKeptWrote(legacy.value).get(target) ?? []) : undefined
}

/** Stores the archive file's record; true when stored. A clear that fails is kept to write again. */
async function writeWrote($: EngineInterface, record: string, blocks: string[][] | null): Promise<boolean> {
  const ok = await Promise.resolve()
    .then(() => storeSet($, wroteKey(record), blocks))
    .then(() => true, () => false)
  if (blocks === null) {
    if (ok) {
      wrotePending.delete(record)
    } else {
      wrotePending.set(record, null)
    }
  }

  return ok
}

/**
 * Undoes an archive write whose source cut did not land. The source is read again first:
 * only the blocks still in it come out of the archive. A block that left the source meanwhile (another
 * session cut it after it found the block in this archive and in the shared record, or the user deleted
 * the line) stays in the archive, or the ticket would be in neither file. The archive is put back only
 * when it still holds exactly `next`, the text the step wrote; a changed archive is left. The record is
 * cleared when the archive went back or every block left: then no block is in two places, but for a
 * block of the record the move read (an earlier step's, whose rollback a write between was refused)
 * still in the archive and the source: its record stays, so the next pass only cuts it. A source
 * that does not read leaves the archive and the record as they are: the record keeps the next pass from
 * adding the blocks again, and that pass only cuts what is still in the source.
 */
async function rollBack($: EngineInterface, move: { path: string; text: string; target: string; record: string; before: string; next: string; ready: readonly ClosedBlock[]; wrote: string[][]; eol: string }): Promise<void> {
  const now = await readTodo($, move.path)
  if (now.kind !== 'ok') {
    return
  }
  const left = blocksLeft(move.text, now.text, move.ready)
  // An earlier step's block (the record the move read) still in the archive and the source keeps its record.
  const keep = (archived: string) => {
    const kept = recordAfterRollback(move.wrote, archived, now.text)

    return kept.length > 0 ? kept : null
  }
  if (left.length === move.ready.length) {
    await writeWrote($, move.record, keep(move.next))

    return
  }
  // An archive that was missing goes back to an empty file, or to one with only the blocks that left.
  const back = left.length === 0 ? move.before : addToArchive(move.before, left, move.wrote, move.eol)
  // Checks, then the read and compare as the last call before the write.
  const put = await writeIfUnchanged($, move.target, move.next, back).catch(() => undefined)
  if (put?.kind === 'written') {
    await writeWrote($, move.record, keep(back))
  }
}

/** The archive files already named in a "moved tickets would be no items there" toast: one toast each, per session. */
const notItemsToasted = new Set<string>()

/** The archive files already named in an "unclosed code block" toast: one toast each, per session. */
const unclosedToasted = new Set<string>()

/** The refusals of the archive move already told, by file and cause: a cause that lasts is told once per session, not at each scan. */
const archiveToldOnce = new Set<string>()

/** Runs `tell` the first time `key` comes; the archive move's persistent failures use it so one cause gives one toast. */
function toldOnce(key: string, tell: () => void): void {
  if (!archiveToldOnce.has(key)) {
    archiveToldOnce.add(key)
    tell()
  }
}

/**
 * A folder's `archive/` in the disk's spelling: on a disk that ignores case, `archive` answers
 * for `Archive/` or `ARCHIVE/`, but the symlink check compares the real path by exact case and refused
 * it, so no ticket was ever archived and nothing said why. The folder's own entry name is taken; only
 * when the disk says `archive` is there, so a disk that keeps case apart gets a new `archive/`. A folder
 * that will not list keeps `archive`.
 */
async function archiveDirOf($: EngineInterface, folder: string): Promise<string> {
  const dir = `${folder}/archive`
  if (!(await fsBounded($, () => $.fs.exists(dir)).catch(() => false))) {
    return dir
  }
  const entries = await fsBounded($, () => $.fs.list(folder)).catch(() => undefined)

  return entries === undefined ? dir : `${folder}/${listedName(entries.map(entry => entry.name), 'archive')}`
}

/**
 * The name of a file's archive in `archive/` as the folder lists it. On a disk that ignores
 * case, `archive/todo.md` answers for `TODO.md` but the safe-file check compares exact case and refuses
 * it, so the archive's own entry name is taken. Only when the disk says the file is there: a disk that
 * keeps case apart has no `TODO.md` then, and a new one is made. A folder that will not list keeps the name.
 */
async function archiveEntryName($: EngineInterface, dir: string, name: string): Promise<string> {
  if (!(await fsBounded($, () => $.fs.exists(`${dir}/${name}`)).catch(() => false))) {
    return name
  }
  const entries = await fsBounded($, () => $.fs.list(dir)).catch(() => undefined)

  return entries === undefined ? name : listedName(entries.map(entry => entry.name), name)
}

/**
 * The record after an archive write that did not land: the move stored its blocks as the record before
 * the write, so a failed write leaves a record of blocks that are not in the archive, and a later equal
 * block would be taken for a retry and dropped. The record goes back to what the move read (`wrote`,
 * none cleared) unless the archive holds exactly `next`: a write that threw may have landed, and then the
 * record stays, so the retry only cuts the source. An archive that does not read keeps the record too.
 */
async function forgetUnwritten($: EngineInterface, record: string, target: string, next: string, wrote: readonly (readonly string[])[]): Promise<void> {
  // An archive that was never created is empty.
  const now = (await fsBounded($, () => $.fs.exists(target)).catch(() => true)) ? await readStrict($, target).catch(() => undefined) : ''
  if (now === undefined || now === next) {
    return
  }
  await writeWrote($, record, wrote.length > 0 ? wrote.map(block => [...block]) : null)
}

/** One file's move; true when the file was rewritten without the blocks. */
async function moveBlocks($: EngineInterface, file: TodoFile, path: string, text: string, ready: readonly ClosedBlock[]): Promise<boolean> {
  const dir = await archiveDirOf($, file.folder)
  const target = `${dir}/${await archiveEntryName($, dir, file.name)}`
  // What this mod wrote last comes from the store: without it a retry would add a block twice.
  // A record that cannot be read stops the move; the next scan tries again. So does a folder whose real path, the record's key, will not read.
  const record = await recordOf($, file)
  if (record === undefined) {
    return false
  }
  const wrote = await readWrote($, record, target)
  if (wrote === undefined) {
    return false
  }
  const isThere = await fsBounded($, () => $.fs.exists(target))
  // Never written through a symlink: archive/ and an existing archive file must be their own real paths.
  // A missing archive file with anything at its name (a dangling symlink) is left alone.
  if (((await fsBounded($, () => $.fs.exists(dir))) && !samePath((await realOf($, dir)) ?? '', dir)) || (isThere ? !(await isPlainFile($, target)) : await hasEntry($, target))) {
    toldOnce(`${target}\0place`, () => showToast($, `Not archived: ${target} or its folder is a symlink or no plain file. The tickets stay in ${path}.`))

    return false
  }
  const before = isThere ? await readStrict($, target) : ''
  // Text added after an open code fence or HTML comment would sit inside it, and be no ticket: the move waits for a fix.
  if (endsInExample(before)) {
    if (!unclosedToasted.has(target)) {
      unclosedToasted.add(target)
      showToast($, `Not archived: ${target} has an unclosed code block or HTML block at its end`)
    }

    return false
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const next = addToArchive(before, ready, wrote, eol)
  // Each moved block must be items in the new text: never put where a fence or a comment makes it no ticket.
  if (!blocksStandAsItems(next, ready)) {
    if (!notItemsToasted.has(target)) {
      notItemsToasted.add(target)
      showToast($, `Not archived: in ${target} the moved tickets would sit inside a code block or HTML block, where they are no tickets. Fix the archive file; the tickets stay in ${path}.`)
    }

    return false
  }
  let isWritten = false
  if (next !== before) {
    // The checks, then the record stored, then the read and compare as the last call before the write.
    // Stored before the archive is written: a crash or reload after the write still finds the record.
    // A record that cannot be stored stops the move before the archive is touched.
    let put: WriteOutcome
    try {
      put = await writeIfUnchanged($, target, before, next, { mayCreate: true, before: () => writeWrote($, record, ready.map(block => [...block.lines])) })
    } catch (error) {
      await forgetUnwritten($, record, target, next, wrote)

      throw error
    }
    if (put.kind !== 'written') {
      // 'unsafe' and 'refused' come before the record is stored; 'unread' and 'changed' come after it: the record names blocks that are not in the archive.
      if (put.kind === 'unread' || put.kind === 'changed') {
        await forgetUnwritten($, record, target, next, wrote)
      }
      if (put.kind === 'unsafe') {
        toldOnce(`${target}\0unsafe:${put.reason}`, () => showToast($, `Not archived: ${target} cannot be written (${put.reason}). The tickets stay in ${path}.`))
      }

      return false
    }
    isWritten = true
  }
  // Confirmed from the disk before the source is touched.
  const after = (await readStrict($, target)).split('\n')
  const stands = blockFinder(after)
  if (!ready.every(block => stands(block.lines))) {
    toldOnce(`${target}\0confirm`, () => showToast($, `Not archived: ${target} does not hold the moved tickets after the write. The tickets stay in ${path}.`))

    return false
  }
  // A write that throws leaves the archive and its record: the next pass finds the blocks there and only cuts the source.
  const cut = await writeIfUnchanged($, path, text, removeBlocks(text, ready))
  if (cut.kind !== 'written') {
    // The source changed (or would not check or read): the blocks still in it come out of the archive again; a
    // block that left it meanwhile stays in the archive.
    if (isWritten) {
      await rollBack($, { path, text, target, record, before, next, ready, wrote, eol })
    }

    return false
  }
  await writeWrote($, record, null)

  return true
}

/** The first time a line was seen without an ID, by file and text: the debounce. */
const unnumberedAt = new Map<string, number>()
let isNumbering = false

/**
 * Gives every unnumbered checkbox line of every trusted top-level todo file the next free ticket ID
 * (free project-wide: every folder, live and archive), after the line was seen without one for
 * NUMBER_AFTER_MS, so Claude's own edit is done first. The safe write is the archive move's: read,
 * compute, read again right before the write, write only if the text is unchanged, never through a
 * symlink or into the global folder, never from a file that did not read. A file that fails is left
 * for the next scan. True when any file was written. Claude is told once, with the next prompt.
 */
async function numberTickets($: EngineInterface): Promise<boolean> {
  if (isNumbering || isWorking) {
    return false
  }
  isNumbering = true
  try {
    // A held lock skips this scan; the next one tries again.
    return (await tryWriteLock(() => numberPass($))) ?? false
  } finally {
    isNumbering = false
  }
}

/** The todo files that failed to read when IDs were chosen, by path: how many passes in a row, and why. */
const unreadStreaks = new Map<string, UnreadStreak>()
/** Every ID each todo file held at any good read, by path: what a skipped file counts as. */
const seenIdsOf = new Map<string, Set<string>>()
/** The skipped files already named in a toast: once each, until the file reads again. */
const skipToasted = new Set<string>()
/** The files named in a "did not read" numbering toast: once each, until the file reads again. */
const unreadToasted = new Set<string>()

/**
 * Every item ID held by every `.md` file of every known folder (top level and archive), read from the
 * disk now, lowercase. A folder that will not list is an error. A file that will not read is an error
 * that names it (`TodoReadError`), never an empty file: an ID it holds would be given again.
 * Once a file failed SKIP_AFTER scan passes in a row (for any reason), it is skipped, with one toast, and
 * counts as every ID it held at any good read in this load, so the new IDs go above those; one file
 * that stopped reading no longer stops every ID. A good read is one of this step or the board's scan. A file
 * with no good read in this load is never skipped: what it holds is not known, so it stays an error,
 * with one toast that says why. A file that is gone (a dangling link) holds none.
 */
async function diskIds($: EngineInterface): Promise<string[]> {
  const ids: string[] = []
  const take = async (path: string): Promise<string[] | undefined> => {
    const read = await readTodo($, path)
    if (read.kind === 'ok') {
      const found = textIds(read.text)
      ids.push(...found)
      seenIdsOf.set(path, new Set([...(seenIdsOf.get(path) ?? []), ...found]))
      unreadStreaks.delete(path)
      skipToasted.delete(path)
      unreadToasted.delete(path)

      return found
    }
    if (read.kind === 'missing') {
      return []
    }
    const streak = nextStreak(unreadStreaks.get(path), read.reason, passStarted)
    unreadStreaks.set(path, streak)
    // A good read in this load: one of this step (`seenIdsOf`), or the board's parse of the file, which the scan keeps
    // only from a read that worked (a file the scan never read is in `unreadPlaces`, with no items).
    const board = todoFiles.find(file => `${file.folder}/${file.name}` === path)
    const boardIds = board === undefined || unreadPlaces.includes(`${board.rel ?? board.folder}/${board.name}`) ? undefined : board.items.flatMap(item => (item.id === undefined ? [] : [item.id.toLowerCase()]))
    const seen = seenIdsOf.get(path) === undefined && boardIds === undefined ? undefined : [...(seenIdsOf.get(path) ?? []), ...(boardIds ?? [])]
    if (!isSkipped(streak)) {
      throw new TodoReadError(path, read.reason)
    }
    // A file with no good read in this load is never skipped: its IDs are not known, and would be given again.
    if (seen === undefined) {
      if (!skipToasted.has(path)) {
        skipToasted.add(path)
        showToast($, `${path} did not read ${streak.count} times in a row (${read.reason}), and it has not read since Claudeopticon loaded. No new ticket IDs are named until it reads.`)
      }
      throw new TodoReadError(path, read.reason)
    }
    if (!skipToasted.has(path)) {
      skipToasted.add(path)
      showToast($, `${path} did not read ${streak.count} times in a row (${read.reason}). New ticket IDs are now chosen without it, above every ID it held at its good reads since Claudeopticon loaded.`)
    }
    ids.push(...seen)

    return undefined
  }
  for (const folder of todoFolders ?? []) {
    for (const name of await mdFiles($, folder.path, true)) {
      await take(`${folder.path}/${name}`)
    }
  }
  // A cut folder's file that never read is unknown, not empty: it is read again here, as a file of the
  // board is, and stops the IDs until it reads or is skipped. Its IDs, once read, count as the cut folders' do.
  for (const path of [...cutUnknown]) {
    const found = await take(path)
    if (found !== undefined) {
      cutUnknown.delete(path)
      cutIdsByFile.set(path, found)
      cutIds = [...cutIdsByFile.values()].flat()
    }
  }

  return ids
}

/** One entry of a folder list, as the engine gives it. */
type ListEntry = Awaited<ReturnType<EngineInterface['fs']['list']>>[number]

/** The ID block this session gives IDs from: its number and when it was claimed, clock ms. */
let idBlock: HeldBlock | undefined
/** The IDs this session gave from its blocks, lowercase: two picks of this session never give one ID. */
const givenIds = new Set<string>()
/** True once a toast said that no block could be claimed: once per load. */
let claimToasted = false
/** True once a toast said that the claims went to the fallback folder: once per load. */
let fallbackToasted = false
/** When this session last deleted the claims no one needs, clock ms; undefined before the first time. */
let claimsPrunedAt: number | undefined

/** The `.git` walk's file calls (`gitWhereUp`), through the engine. A call that fails gives undefined. */
function gitFs($: EngineInterface): GitFs {
  return {
    exists: path => fsBounded($, () => $.fs.exists(path)).catch(() => undefined),
    kind: path => fsBounded($, () => $.fs.stat(path)).then(stat => stat.kind as string, () => undefined),
    read: path => $.fs.read(path).catch(() => undefined),
  }
}

/**
 * The repo's claim folders (`claimDirs`): `main` in the git common dir in every git layout,
 * `fallback` only for a common dir `<root>/.git`, in that root's `.claude_work/`. Both come from the
 * common dir alone, so every session of the repo, in any worktree, names the same two. A
 * session with no common dir from git (its git call failed) reads it from the `.git` entry on the disk,
 * walking up from the primary todo folder's parent, so it claims where the git sessions do; with no
 * `.git` at all, that parent keys the one folder. Worked out from the session state each time, never
 * kept from a check that failed.
 */
async function claimFolders($: EngineInterface): Promise<{ main?: string; fallback?: string }> {
  const primary = todoFolders?.find(one => !one.isOther)
  const base = primary?.real ?? primary?.path
  const looseBase = base !== undefined && isAbsPath(base) ? base.slice(0, base.lastIndexOf('/')) : undefined
  const common = gitCommon !== undefined && isAbsPath(gitCommon) ? gitCommon : undefined
  if (common !== undefined) {
    return claimDirs({ common })
  }
  const from = looseBase ?? centralRoot
  const found = from === undefined ? undefined : await gitWhereUp(gitFs($), from)
  if (found === 'unknown') {
    return {}
  }

  return claimDirs(found !== undefined ? { common: found.common } : looseBase === undefined ? {} : { looseBase })
}

/**
 * Runs a program (no shell); where it cannot start on a Windows path (no MSYS or Git for Windows
 * tools), the PowerShell statement instead, as `envPath` falls back from `printenv`. Undefined when
 * neither starts.
 */
async function runOrPowerShell($: EngineInterface, argv: string[], path: string, script: string): Promise<{ exitCode: number } | undefined | typeof TIMED_OUT> {
  // Bounded: this runs under the writer lock, while numbering or a prompt claims IDs. A time-out is a
  // failure, told once; the command may still finish later, so PowerShell is not tried after it.
  const bounded = async (one: string[]) => {
    const done = await runInTime($, one)
    if (done === TIMED_OUT) {
      noteTimedOut($, one)
    } else if (done !== undefined) {
      timedOutTold.delete(commandName(one))
    }

    return done
  }
  const done = await bounded(argv)
  if (done !== undefined || !isWinPath(path)) {
    return done
  }

  return bounded(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script])
}

/** Makes a claim folder and its parents (`mkdir -p`); true when it is there. */
async function makeClaimDir($: EngineInterface, dir: string): Promise<boolean> {
  const made = await runOrPowerShell($, ['mkdir', '-p', '--', dir], dir, `try { [System.IO.Directory]::CreateDirectory(${psPath(dir)}) | Out-Null; exit 0 } catch { exit 1 }`)

  return made !== TIMED_OUT && made?.exitCode === 0
}

/**
 * Makes a claim entry only if nothing stands at its name, in one atomic step of the OS: `mkdir` with
 * no `-p` (no shell); on Windows with no `mkdir` program, a file opened CreateNew through PowerShell,
 * just as atomic. `made`; `taken` when another session made it first; `failed` when it cannot be told.
 */
async function makeClaim($: EngineInterface, path: string): Promise<'made' | 'taken' | 'failed'> {
  const done = await runOrPowerShell($, ['mkdir', '--', path], path, `try { [System.IO.File]::Open(${psPath(path)}, 'CreateNew').Close(); exit 0 } catch { exit 1 }`)
  // A time-out is a failure: the entry may still appear later, so it is never read as another session's.
  if (done === TIMED_OUT) {
    return 'failed'
  }
  if (done?.exitCode === 0) {
    return 'made'
  }

  return (await fsBounded($, () => $.fs.exists(path)).catch(() => false)) ? 'taken' : 'failed'
}

/**
 * Deletes the claim entries of `dir` no one needs any more (`prunableClaims`: stale, below the first
 * free block), at most once per CLAIM_PRUNE_MS, so the folder does not grow with every
 * block. `rmdir` (an empty folder only), else a .NET delete on Windows. A delete that fails is left
 * for the next time. The entries left, for the claim that follows.
 */
async function pruneClaims($: EngineInterface, dir: string, entries: readonly ListEntry[], first: number, time: number): Promise<ListEntry[]> {
  if (claimsPrunedAt !== undefined && time - claimsPrunedAt < CLAIM_PRUNE_MS) {
    return [...entries]
  }
  claimsPrunedAt = time
  const gone = new Set<string>()
  for (const name of prunableClaims(entries, first, time)) {
    if (await removeClaim($, `${dir}/${name}`)) {
      gone.add(name)
    }
  }

  return entries.filter(entry => !gone.has(entry.name))
}

/** Deletes one claim entry: `rmdir` (an empty folder only), else a .NET delete on Windows. True when it went. */
async function removeClaim($: EngineInterface, path: string): Promise<boolean> {
  const done = await runOrPowerShell($, ['rmdir', '--', path], path, `try { $p = ${psPath(path)}; if ([System.IO.Directory]::Exists($p)) { [System.IO.Directory]::Delete($p) } else { [System.IO.File]::Delete($p) }; exit 0 } catch { exit 1 }`)

  return done !== TIMED_OUT && done?.exitCode === 0
}

/** The file calls of a block claim (`claimAcross`), through the engine. A presence check that fails counts as there. */
function claimPort($: EngineInterface): ClaimPort {
  return {
    list: dir => fsBounded($, () => $.fs.list(dir)).then(
      entries => entries.map(entry => ({ name: entry.name, mtimeMs: entry.mtimeMs })),
      () => undefined,
    ),
    exists: path => fsBounded($, () => $.fs.exists(path)).catch(() => true),
    make: path => makeClaim($, path),
    remove: path => removeClaim($, path),
  }
}

/** A block this session claimed: the block it holds, and the path of its claim entry. */
type Claimed = { held: HeldBlock; path: string }

/**
 * Claims the first block from `from` up that no live claim holds in either claim folder of the repo
 * (`claimAcross`): the claim folder is made first (`mkdir -p`, the one step that may find it
 * there), then the block's entry, atomically; then the other folder is listed again, and the block is
 * given up when it shows a claim there too. When the git claim folder cannot be made (a read-only
 * `.git`), the claim goes to the fallback folder, with one toast; either way the claims of
 * the other folder count as held. The reason, as text, when no folder can be made, a list or a claim
 * fails, or every block scanned is held: then no ID is given. `first`: the first free block, for the pruning.
 */
async function claimBlock($: EngineInterface, from: number, first: number): Promise<Claimed | string> {
  const dirs = await claimFolders($)
  if (dirs.main === undefined) {
    return 'no folder to claim IDs in'
  }
  let dir = dirs.main
  let other = dirs.fallback
  if (!(await makeClaimDir($, dir))) {
    if (dirs.fallback === undefined || !(await makeClaimDir($, dirs.fallback))) {
      return `could not make ${dir}`
    }
    if (!fallbackToasted) {
      fallbackToasted = true
      showToast($, `Claudeopticon cannot write ${dir}, so it claims new ticket IDs in ${dirs.fallback} instead.`)
    }
    other = dir
    dir = dirs.fallback
  }
  const listed = await fsBounded($, () => $.fs.list(dir)).catch(() => undefined)
  if (listed === undefined) {
    return `could not list ${dir}`
  }
  const time = await $.clock.now()
  const own = await pruneClaims($, dir, listed, first, time)
  const made = await claimAcross(claimPort($), dir, other, own, from, time)

  return typeof made === 'string' ? made : { held: { block: made.block, claimedAt: time }, path: made.path }
}

/** True once a toast said that a pick found fewer free IDs than it needed: once per load. */
let shortToasted = false

/**
 * `count` free ticket IDs, above every ID of `taken` in this session's block, from this session's
 * claimed block: the one source of new IDs for the prompt offers, numbering and Consolidate's
 * renumbering. A new block is claimed when the session has none, when its
 * block ran out, or CLAIM_USE_MS after its claim (`needsBlock`); never only because another session's
 * IDs passed it, so two sessions taking turns leave no gap per pick. No store round trip:
 * the claim alone keeps another session off these IDs. Each pick and its record in `givenIds` come
 * with no await between, so two picks of this session never give one ID. Undefined when no block can
 * be claimed, or CLAIM_SCAN blocks give fewer than `count`: then no ID is given, and a toast says so
 * once. A pick that comes back short is undone: its IDs go back, the session holds the
 * block it held before, and each claim it made is deleted unless an ID of this session (another pick
 * that ran meanwhile) is from that block, so a failed pick wastes no block.
 */
async function freeIds($: EngineInterface, taken: readonly string[], count: number): Promise<string[] | undefined> {
  const out: string[] = []
  const heldBefore = idBlock
  const made: Claimed[] = []
  let failure: string | undefined
  let isSpent = false
  let isFull = false
  for (let round = 0; round < CLAIM_SCAN && out.length < count; round += 1) {
    const first = firstBlock([...taken, ...givenIds])
    if (needsBlock(idBlock, isSpent, nowSync())) {
      // The number line is used up: no block is claimed, not one claim folder is touched.
      if (claimFrom(idBlock, first) >= END_BLOCK) {
        isFull = true
        break
      }
      const claimed = await claimBlock($, claimFrom(idBlock, first), first)
      if (typeof claimed === 'string') {
        failure = claimed
        break
      }
      idBlock = claimed.held
      made.push(claimed)
    }
    // From here to the record, no await: the pick sees every ID this session gave.
    const got = blockIds([...taken, ...givenIds], idBlock!.block, count - out.length).map(id => id.toLowerCase())
    got.forEach(id => givenIds.add(id))
    out.push(...got)
    isSpent = out.length < count
  }
  if (out.length === count) {
    return out.map(id => id.toUpperCase())
  }
  // Undone. From here to the restore, no await: another pick of this session sees it whole.
  out.forEach(id => givenIds.delete(id))
  if (made.length > 0 && idBlock === made[made.length - 1]!.held) {
    idBlock = heldBefore
  }
  const inUse = new Set([...givenIds].flatMap(id => (ticketValue(id) === undefined ? [] : [blockOf(ticketValue(id)!)])))
  for (const one of made) {
    if (!inUse.has(one.held.block) && one.held !== idBlock) {
      await removeClaim($, one.path)
    }
  }
  if (isFull) {
    await noteLineFull($, [...taken, ...givenIds])
  } else if (failure !== undefined) {
    if (!claimToasted) {
      claimToasted = true
      showToast($, `Claudeopticon names no new ticket IDs: ${failure}.`)
    }
  } else if (!shortToasted) {
    shortToasted = true
    showToast($, `Claudeopticon found only ${out.length} of the ${count} free ticket IDs it needs in ${CLAIM_SCAN} blocks, so it names none of them now.`)
  }

  return undefined
}

/** True once a toast said that the number line of ticket IDs is used up: once per load. */
let fullToasted = false

/**
 * Says once that no ticket ID is left on the number line, naming the ID at its end and the
 * line that holds it, so the user can find the stray tag (often in an example) and change it.
 * The line is looked up in the files the last ID read saw (`seenIdsOf`); a read that fails leaves the ID alone named.
 */
async function noteLineFull($: EngineInterface, ids: readonly string[]): Promise<void> {
  if (fullToasted) {
    return
  }
  fullToasted = true
  const top = highestId(ids)?.toLowerCase()
  const path = top === undefined ? undefined : [...seenIdsOf].find(([, held]) => held.has(top))?.[0]
  const read = path === undefined ? undefined : await readTodo($, path).catch(() => undefined)
  const line = top === undefined || read?.kind !== 'ok' ? undefined : lineHolding(read.text, top)
  const where = path === undefined ? '' : ` in ${path}${line === undefined ? '' : `, the line "${line}"`}`
  showToast($, `Claudeopticon names no new ticket IDs: the number line of ticket IDs is used up by #${top?.toUpperCase() ?? '?'}${where}. IDs count up to #T1ZZZZ; change or remove that ID to free the line.`)
}

/** Picks per offer: a pick that loses an ID to another session's store write picks again. */
const OFFER_ROUNDS = 3

/**
 * The "Next free ticket IDs" line for a prompt; undefined when a todo file or folder cannot be read,
 * since an ID in it could be named again (numbering gives such items IDs later instead). The IDs are
 * free on the disk as it is now, not only on the board, which may be behind it: a Bash or hand edit,
 * or a scan still in flight, whose text is on the disk already, so the scan is not awaited.
 * The board, the disk and every reservation of the repo count as taken. The IDs this session named
 * before and no file holds yet are named again, so the numbers do not climb with each prompt; only
 * the shortfall to NEXT_IDS_SHOWN is new. Each new ID is stored with the repo's reservations; one that
 * another session's write took is given up and another is picked.
 */
async function offerIds($: EngineInterface): Promise<string | undefined> {
  const me = await sessionOf($)
  wallMs = await $.clock.now()
  const onDisk = await diskIds($).catch(() => undefined)
  if (onDisk === undefined) {
    return undefined
  }
  // The IDs other sessions of this repo reserved count as taken; a store that does not read names no ID.
  if ((await syncReserved($, [], onDisk)) === undefined) {
    return undefined
  }
  let shown: string[] = []
  for (let round = 0; round < OFFER_ROUNDS; round += 1) {
    pruneReserved(nowSync(), onDisk)
    const kept = [...reservedIds].filter(([, one]) => one.offeredTo === me).map(([id]) => id).sort((a, b) => (ticketValue(a) ?? 0) - (ticketValue(b) ?? 0))
    // The new IDs come from this session's claimed block, as numbering's do: no block, no offer.
    const picked = await freeIds($, [...projectIds(), ...onDisk, ...reservedIds.keys()], Math.max(0, NEXT_IDS_SHOWN - kept.length))
    if (picked === undefined) {
      return undefined
    }
    const fresh = picked.map(id => id.toLowerCase())
    for (const id of fresh) {
      reservedIds.set(id, { until: nowSync() + RESERVE_MS, offeredTo: me, by: me })
    }
    shown = [...kept, ...fresh].slice(0, NEXT_IDS_SHOWN)
    if (fresh.length === 0) {
      break
    }
    const lost = await syncReserved($, [], onDisk)
    // A read-back that fails sends no offer: the IDs are not known to be stored.
    if (lost === undefined) {
      return undefined
    }
    if (!shown.some(id => lost.includes(id))) {
      break
    }
    // Another session holds some of them now: they are its, and never named here.
    shown = shown.filter(id => !lost.includes(id))
  }

  return nextIdsLine(shown)
}

/** The todo files whose numbering write failed and was told to the user: one toast each, until it works again. */
const numberFailed = new Set<string>()

/**
 * One numbering pass, under the writer lock. A file that fails (a write that throws) does not stop
 * the others, and the note for a file that was written is queued right after its write.
 */
async function numberPass($: EngineInterface): Promise<boolean> {
  const time = await $.clock.now()
  wallMs = time
  const me = await sessionOf($)
  // The IDs other sessions of this repo reserved count as taken, when the store reads. When it does not, numbering goes
  // on (a choice): the IDs come from this session's claimed block, which no session of a current build gives
  // from, so the store adds only the reservations of a session of an older build (one with no claims). An offer does
  // stop, as it names IDs to Claude before any file holds them.
  await syncReserved($)
  const seen = new Set<string>()
  // The disk read once per pass, when the first file needs numbers: a read for every file would scale with the file count.
  // The IDs this pass gives are reserved, so a later file never takes one the memo lacks.
  let onDiskOnce: string[] | undefined
  // The leading IDs of every ticket on the board: a line that only names one of them refers to it.
  const owned = new Set(todoFiles.flatMap(file => file.items.flatMap(item => leadingId(item.text) ?? [])).map(id => id.toLowerCase()))
  let wrote = 0
  for (const file of todoFiles) {
    const path = `${file.folder}/${file.name}`
    const taken: string[] = []
    try {
      if (file.isArchived === true || file.name.includes('/')) {
        continue
      }
      // Two non-leading lines naming one ID share a key: the file is read to number the later one.
      const trailing = file.items.filter(item => item.id !== undefined && leadingId(item.text) === undefined).map(item => item.id!.toLowerCase())
      if (file.items.every(item => item.id !== undefined && (leadingId(item.text) !== undefined || !owned.has(item.id.toLowerCase()))) && new Set(trailing).size === trailing.length) {
        continue
      }
      if (!(await isTrustedDir($, file.folder)) || !(await isPlainFile($, path))) {
        continue
      }
      const read = await readTodo($, path)
      if (read.kind !== 'ok') {
        continue
      }
      const text = read.text
      // A carriage return never reaches a match, and a line in a code fence is never a ticket.
      const lines = text.split('\n').map(bare)
      const isFenced = exampleMask(lines)
      lines.forEach((line, index) => {
        const m = isFenced[index] === true ? null : CHECKBOX.exec(line)
        const id = m === null ? undefined : leadingId(plainText(m[2] ?? ''))
        if (id !== undefined) {
          owned.add(id.toLowerCase())
        }
      })
      const own = lineOwnIds(lines, owned)
      const at: number[] = []
      lines.forEach((line, index) => {
        const m = isFenced[index] === true ? null : CHECKBOX.exec(line)
        if (m === null || (m[2] ?? '').trim() === '' || own[index] !== undefined) {
          return
        }
        const sign = `${path}\0${line}`
        seen.add(sign)
        unnumberedAt.set(sign, unnumberedAt.get(sign) ?? time)
        if (time - unnumberedAt.get(sign)! >= NUMBER_AFTER_MS) {
          at.push(index)
        }
      })
      if (at.length === 0) {
        continue
      }
      // At most NUMBER_MAX lines per file per pass, which one pick can give; the rest wait for the next pass.
      at.splice(NUMBER_MAX)
      // Every file read again from the disk, inside the lock: the board may be older than the files.
      onDiskOnce ??= await diskIds($)
      const onDisk = onDiskOnce
      // The IDs are chosen now, above the board, the disk, the IDs reserved at this moment (a prompt may have
      // named some while this pass awaited) and the file's own text, which may be newer than the board. They come
      // from this session's claimed block, as the prompt offers do, and `freeIds` records each pick with no await
      // between, so a prompt never names them; they stay reserved until a scan finds them in a file.
      pruneReserved(time)
      // From this session's claimed block, as the prompt offers' are: no block, and the file waits.
      const ids = await freeIds($, [...projectIds(), ...onDisk, ...reservedIds.keys(), ...lines.flatMap(line => lineIds(line).map(id => id.toLowerCase()))], at.length)
      if (ids === undefined) {
        continue
      }
      ids.forEach(id => {
        reservedIds.set(id.toLowerCase(), { until: time + RESERVE_MS, by: me })
        taken.push(id.toLowerCase())
      })
      const next = insertIds(text, at, ids)
      // Stored with the repo's reservations before the write, so another session's pass or prompt skips them too.
      // An ID another session took between the pick and this store write is lost to it: the file waits for the next scan.
      const lost = await syncReserved($)
      const isLost = lost?.some(id => taken.includes(id)) === true
      // The checks first, then the read and compare as the last call before the write (writeIfUnchanged).
      const put = isLost ? undefined : await writeIfUnchanged($, path, text, next)
      if (put?.kind !== 'written') {
        const back = [...taken]
        taken.forEach(id => reservedIds.delete(id))
        // Not written: the IDs go back to this session's block, so the next pass gives them again (not one the store gives another session).
        if (!isLost) {
          back.forEach(id => givenIds.delete(id))
        }
        await syncReserved($, back)
        continue
      }
      taken.length = 0
      const place = file.rel === undefined ? file.name : `${file.rel}/${file.name}`
      pendingNumbered = [...pendingNumbered, ...at.map((index, i) => numberedLine(place, ids[i]!, plainText(CHECKBOX.exec(lines[index]!)?.[2] ?? '')))]
      await saveToldNotes($)
      numberFailed.delete(path)
      wrote += 1
    } catch (error) {
      // The IDs of a write that did not happen go back; the file is tried again at the next scan.
      const back = [...taken]
      taken.forEach(id => reservedIds.delete(id))
      back.forEach(id => givenIds.delete(id))
      await syncReserved($, back)
      // A file that did not read is named itself, not the file being numbered.
      if (error instanceof TodoReadError) {
        if (!unreadToasted.has(error.path)) {
          unreadToasted.add(error.path)
          showToast($, `Could not number the tickets: ${error.message}`)
        }
      } else if (!numberFailed.has(path)) {
        numberFailed.add(path)
        showToast($, `Could not number the tickets in ${path}: ${reasonOf(error)}`)
      }
    }
  }
  for (const sign of [...unnumberedAt.keys()]) {
    if (!seen.has(sign)) {
      unnumberedAt.delete(sign)
    }
  }

  return wrote > 0
}

/** The platform name, asked once: `uname -s`, else told by a file only macOS has. Empty when unknown. */
let unameCache: string | undefined

/**
 * The platform, asked once and kept in `unameCache`: the answer of `uname -s`; when that is empty,
 * `Darwin` if a file only macOS has is there (MAC_SIGNS), so neither the opener nor the trash falls
 * to the Linux commands on a Mac; else empty.
 */
async function platformName($: EngineInterface): Promise<string> {
  if (unameCache === undefined) {
    // Bounded: a uname that hangs is an empty answer, told once; the macOS signs decide then.
    const asked = await runInTime($, ['uname', '-s'])
    if (asked === TIMED_OUT) {
      noteTimedOut($, ['uname'])
    }
    const uname = ((asked === TIMED_OUT ? undefined : asked)?.stdout ?? '').trim()
    let hasMacSign = false
    for (const sign of uname === '' ? MAC_SIGNS : []) {
      hasMacSign ||= await fsBounded($, () => $.fs.exists(sign)).catch(() => false)
    }
    unameCache = platformFrom(uname, hasMacSign)
  }

  return unameCache
}

/** The command lines that send a file to the OS trash, in the order they are tried. */
async function trashCommands($: EngineInterface, path: string): Promise<string[][]> {
  if (isWinPath(path)) {
    // DeleteFile deletes outright, with no word, where there is no Recycle Bin: so only a local fixed
    // drive, and never when a Recycle Bin is set to delete at once (NukeOnDelete).
    const bin = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket'
    const script = [
      `$p = ${psPath(path)}`,
      "if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($p)).DriveType -ne 'Fixed') { exit 3 }",
      `$keys = @(Get-Item -LiteralPath '${bin}' -ErrorAction SilentlyContinue) + @(Get-ChildItem -LiteralPath '${bin}\\Volume' -ErrorAction SilentlyContinue)`,
      'if ($keys | Where-Object { $_.GetValue(\'NukeOnDelete\') -eq 1 }) { exit 4 }',
      'Add-Type -AssemblyName Microsoft.VisualBasic',
      "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')",
    ].join('; ')

    return [['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script]]
  }
  if ((await platformName($)) === 'Darwin') {
    // The macOS `trash` CLI takes no `--`; the path is absolute, so it cannot look like a flag.
    const quoted = path.replace(/[\\"]/g, char => `\\${char}`)

    return [['/usr/bin/trash', path], ['osascript', '-e', `tell application "Finder" to delete POSIX file "${quoted}"`]]
  }

  return [['gio', 'trash', '--', path], ['trash-put', '--', path], ['kioclient5', 'move', path, 'trash:/']]
}

/**
 * Makes sure the archive file can be opened, under the writer lock: the folder must be trusted and
 * archive/ its own real path. An existing file must be a plain `.md` file. A missing one is created
 * empty, with the existence check as the last call before the write, so a file an archive move made
 * a moment ago is never overwritten. Returns why not, or undefined when it is ready.
 */
async function readyArchive($: EngineInterface, path: string): Promise<string | undefined> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  const folder = dir.slice(0, dir.lastIndexOf('/'))
  if (!(await isTrustedDir($, folder))) {
    return 'its folder is not safe to change'
  }
  if (!(await fsBounded($, () => $.fs.exists(dir)).catch(() => false))) {
    // archive/ is made by the write below.
  } else if (!samePath((await realOf($, dir)) ?? '', dir)) {
    return 'archive/ is a symlink'
  }
  // The existence check is the last call before the write.
  if (await hasEntry($, path)) {
    return (await isArchiveFile($, path)) ? undefined : 'it is not a plain .md file (a symlink?)'
  }
  // Made only while still missing or empty: a file an archive move wrote meanwhile is never written over.
  await writeIfUnchanged($, path, '', '', { mayCreate: true }).catch(() => undefined)

  return (await isArchiveFile($, path)) ? undefined : 'it could not be made'
}

/** Opens the archive file in the OS default app, making it first when it is missing; a toast says so when that fails or the file is not safe to open. */
async function openArchive($: EngineInterface): Promise<void> {
  const path = archiveLink
  if (path === undefined) {
    return
  }
  const why = await withWriteLock(() => readyArchive($, path))
  if (why !== undefined) {
    showToast($, `Not opened: ${path} (${why})`)

    return
  }
  const argv = openCommand(path, isWinPath(path) ? '' : await platformName($))
  // Bounded: an opener that never returns (a permission dialog) is told, never waited on for good.
  const result = await runInTime($, argv)
  if (result === TIMED_OUT) {
    showToast($, `Could not open ${path}: \`${argv[0] ?? ''}\` did not return within ${RUN_LIMIT_MS / 1000} s`)

    return
  }
  // explorer.exe exits 1 even when it opened the file; any other command must exit 0.
  const isOk = result !== undefined && (result.exitCode === 0 || (argv[0] === 'explorer.exe' && result.exitCode === 1))
  if (!isOk) {
    showToast($, `Could not open ${path}`)
  }
}

/**
 * Sends one file to the OS trash. True only if a command exited 0 and the file is gone. There is no
 * fallback to `rm` or any other outright delete: when no trash method works, the file stays.
 */
async function trashFile($: EngineInterface, path: string): Promise<{ isOk: boolean; tried: string[] }> {
  const tried: string[] = []
  // Every outside call here is bounded: this runs under the writer lock, and a command that never returns
  // (a Finder permission dialog) must not stop every todo write of the session.
  const commands = await boundedJob($, trashCommands($, path))
  if (commands === TIMED_OUT) {
    return { isOk: false, tried: ['uname: timed out'] }
  }
  for (const argv of commands) {
    const result = await runInTime($, argv)
    if (result === TIMED_OUT) {
      // It may still finish later: no second command is tried on the same file.
      tried.push(`${argv[0] ?? ''}: timed out after ${RUN_LIMIT_MS / 1000} s`)
      break
    }
    if (result?.exitCode === 0 && !(await fsBounded($, () => $.fs.exists(path)).catch(() => true))) {
      return { isOk: true, tried }
    }
    // Per command: not found (it did not start, or the shell said 127), or the code it exited with.
    const name = argv[0] ?? ''
    tried.push(result === undefined || result.exitCode === 127 ? `${name}: not found` : result.exitCode === 0 ? `${name}: exited 0 but the file is still there` : `${name}: exited ${result.exitCode}`)
  }

  return { isOk: false, tried }
}

/**
 * Sends the empty `.md` files the last scan found (top level and archive) to the OS trash: each is
 * read again right before `trashFile` (no shell, no glob, one call per file) and skipped if it holds
 * anything now. Never the central target, never a file in an untrusted folder or behind a symlink,
 * never `categories.json`. A file whose trash call fails is kept and named with the reason; nothing
 * is ever deleted outright. Then a non-recursive `rmdir --` (a .NET `Directory.Delete` on Windows)
 * on an emptied `archive/` and folder, which fails on a non-empty directory: the intended guard.
 */
async function deleteEmpty($: EngineInterface): Promise<void> {
  await withWriteLock(() => deleteEmptyLocked($))
}

async function deleteEmptyLocked($: EngineInterface): Promise<void> {
  const central = centralFolder()
  if (central === undefined || !canDeleteEmpty() || isBusy($)) {
    return
  }
  isWorking = true
  try {
    // `uname` is asked once per press, so a changed platform is never read from a stale answer.
    unameCache = undefined
    // Bounded: an rmdir that hangs frees the writer lock.
    const run = async (argv: string[]) => {
      const done = await runInTime($, argv)

      return done !== TIMED_OUT && done?.exitCode === 0
    }
    // The target read also stops a press whose files will not read. The target check
    // below (M40) is defense in depth: the target is the central todo.md, which the scan
    // never lists as empty, or the one file with items, which the read below finds not empty, so no
    // state reaches it today. It stays so a change to the scan's rule cannot trash the target.
    const target = await chooseTarget($, central, (await mdFiles($, central)).filter(name => !name.includes('/')))
    const folders = new Set<string>()
    const isWin = isWinPath(central)
    const unmoved: string[] = []
    // What each trash command did, once per command, for the reason in the toast.
    const attempts: string[] = []
    let removed = 0
    const kept: string[] = []
    const archives = new Map<string, string>()
    for (const file of emptyFiles) {
      const name = file.path.slice(file.folder.length + 1)
      // The scan names an archived file by the archive folder's disk name, `Archive/` on a disk that ignores case.
      const isArchive = /^archive\/[^/]+$/i.test(name)
      const isTop = !name.includes('/')
      if ((!isArchive && !isTop) || !name.endsWith('.md') || (file.folder === central && !isArchive && name === target) || !(await isTrustedDir($, file.folder)) || !(await isPlainFile($, file.path))) {
        kept.push(file.path)
        continue
      }
      const read = await readTodo($, file.path)
      const text = read.kind === 'ok' ? read.text : undefined
      if (text === undefined || text.trim() !== '') {
        kept.push(file.path)
        continue
      }
      const done = await trashFile($, file.path)
      if (done.isOk) {
        removed += 1
        folders.add(file.folder)
        if (isArchive) {
          // The archive folder by the name the scan found it under, for the rmdir below.
          archives.set(file.folder, file.path.slice(0, file.path.lastIndexOf('/')))
        }
      } else {
        kept.push(file.path)
        unmoved.push(file.path)
        attempts.push(...done.tried.filter(one => !attempts.includes(one)))
      }
    }
    for (const folder of folders) {
      for (const dir of [archives.get(folder) ?? (await archiveDirOf($, folder)), folder]) {
        // Fails on a directory that still holds files, which keeps it.
        await run(isWin ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `[System.IO.Directory]::Delete(${psPath(dir)})`] : ['rmdir', '--', dir])
      }
    }
    // A folder that is gone leaves the folder list.
    const gone = new Set<string>()
    for (const folder of folders) {
      if (!(await fsBounded($, () => $.fs.exists(folder)).catch(() => true))) {
        gone.add(folder)
      }
    }
    todoFolders = todoFolders?.filter(one => !gone.has(one.path))
    if (kept.length > 0) {
      showToast($, `Kept: ${kept.join(', ')}`)
    }
    if (unmoved.length > 0) {
      const reason = trashReason(attempts, isWin, unameCache ?? '')
      showToast($, `Not moved to the ${isWin ? 'Recycle Bin' : 'Trash'}, file kept (${reason}): ${unmoved.join(', ')}`)
    }
    showToast($, `Moved ${removed} empty todo ${removed === 1 ? 'file' : 'files'} to the ${isWin ? 'Recycle Bin' : 'Trash'}.`)
    await boundedJob($, scan($, true).catch(() => undefined))
  } catch (error) {
    showToast($, `Could not delete empty todos: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isWorking = false
    redraw($)
  }
}

/**
 * Removes the identical tickets from the central target file (the first of each group stays) and
 * rewrites references to a removed ticket in the target and the central archive files. Each file is
 * read again right before it is written, and left alone if it changed.
 */
async function deleteDupTickets($: EngineInterface): Promise<void> {
  await withWriteLock(() => deleteDupTicketsLocked($))
}

async function deleteDupTicketsLocked($: EngineInterface): Promise<void> {
  const central = centralFolder()
  if (central === undefined || !canDeleteDupTickets() || isBusy($)) {
    return
  }
  isWorking = true
  try {
    const names = await mdFiles($, central, true)
    const target = await chooseTarget($, central, names.filter(name => !name.includes('/')))
    const path = `${central}/${target}`
    if (!names.includes(target)) {
      return
    }
    // A press that cannot write says why; the button shows only when these pass (`refreshDupTickets`).
    const why = (await trustProblem($, central)) ?? (await plainFileProblem($, path))
    if (why !== undefined) {
      showToast($, `Not changed: ${DIR}/${target} (not safe: ${why})`)

      return
    }
    const text = await readStrict($, path)
    const result = removeDuplicateTickets(text)
    // Nothing to remove, but archive files a press before could not follow: only their references are fixed now.
    if (result.removed.length === 0 && Object.keys(refsToFix).length === 0) {
      return
    }
    let done = ''
    if (result.removed.length > 0) {
      const put = await writeIfUnchanged($, path, text, result.text, { folder: central })
      if (put.kind !== 'written') {
        showToast($, put.kind === 'changed' ? `Not changed, the file changed meanwhile: ${DIR}/${target}` : `Not changed: ${DIR}/${target} (${put.kind === 'unsafe' ? `not safe: ${put.reason}` : put.kind === 'unread' ? `could not be read: ${put.reason}` : 'not written'})`)

        return
      }
      // The target changed: Claude is told, and the toast is built, now, whatever happens to the archive files.
      const mapped = Object.entries(result.map).map(([id, kept]) => `#${id.toUpperCase()} is now #${kept}`)
      pendingRemoved = [...pendingRemoved, ...result.removed.map(one => `- #${one.id} removed, it repeated #${one.kept}`), ...mapped.map(line => `- ${line}`)]
      await saveToldNotes($)
      done = `Removed ${result.removed.length} duplicate ${result.removed.length === 1 ? 'ticket' : 'tickets'} from ${DIR}/${target}.${mapped.length > 0 ? ` ${mapped.join('; ')}` : ''}`
    }
    // References in the central archive files follow; each file on its own, so one that fails names itself and stops no other.
    const changed: string[] = []
    const notFixed: string[] = []
    const fixMap = { ...refsToFix, ...result.map }
    if (Object.keys(fixMap).length > 0) {
      for (const name of names.filter(one => one.includes('/'))) {
        const file = `${central}/${name}`
        try {
          const before = await readStrict($, file)
          const after = renameRefs(before, fixMap)
          if (after === before) {
            continue
          }
          // The checks first, then the read and compare as the last call before the write.
          const fixed = await writeIfUnchanged($, file, before, after, { folder: central })
          if (fixed.kind === 'written') {
            changed.push(name)
          } else {
            notFixed.push(`${name} (${fixed.kind === 'changed' ? 'changed meanwhile' : fixed.kind === 'unsafe' ? `not safe: ${fixed.reason}` : fixed.kind === 'unread' ? `could not be read: ${fixed.reason}` : 'not written'})`)
          }
        } catch (error) {
          notFixed.push(`${name} (${error instanceof Error ? error.message : String(error)})`)
        }
      }
    }
    // A reference fix that failed is kept: the button stays, and the next press tries those files again.
    refsToFix = notFixed.length > 0 ? fixMap : {}
    showToast($, `${done}${changed.length > 0 ? `${done === '' ? '' : ' '}References fixed in ${changed.join(', ')}.` : ''}${notFixed.length > 0 ? `${done === '' && changed.length === 0 ? '' : ' '}References not fixed in ${notFixed.join(', ')}.` : ''}`)
    // Bounded: a scan that does not end in time frees the writer lock; it goes on, and its late result still counts.
    await boundedJob($, scan($, true).catch(() => undefined))
  } catch (error) {
    showToast($, `Could not remove duplicate tickets: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isWorking = false
    redraw($)
  }
}

/** Sets hasDupTickets from the central target file; false when it cannot be read, or the press could not write it: an untrusted folder, or a target that is no plain file of its own real path. */
async function refreshDupTickets($: EngineInterface): Promise<void> {
  hasDupTickets = false
  const central = centralFolder()
  if (central === undefined || centralBlocked) {
    return
  }
  try {
    const names = (await mdFiles($, central)).filter(name => !name.includes('/'))
    if (names.length === 0) {
      return
    }
    const target = await chooseTarget($, central, names)
    const path = `${central}/${target}`
    // The press's own checks: a button that shows must be one that can write.
    if (!names.includes(target) || !(await isTrustedDir($, central)) || !(await isPlainFile($, path))) {
      return
    }
    hasDupTickets = removeDuplicateTickets(await readStrict($, path)).removed.length > 0
  } catch {
    hasDupTickets = false
  }
}

/**
 * The cheap check each scan makes, with no git: the nearest folder by the old rule. A folder made
 * after the mod loaded (Claude creating `.claude_todo/` in a repo that had none) joins the known
 * ones: as the primary folder when there is none, else as one more folder. A known folder that was
 * only "other" becomes the primary when there is none.
 */
async function noteNearest($: EngineInterface, folders: TodoFolder[]): Promise<TodoFolder[]> {
  const near = await findTodoDir($).catch(() => undefined)
  if (near === undefined || near === nearestSeen) {
    return folders
  }
  nearestSeen = near
  const real = await realOf($, near)
  // By its absolute path, as discovery gives it, so the trust check passes it: numbered and archived like the rest.
  const path = absNearest(near, real) ?? near
  const hasPrimary = folders.some(one => !one.isOther)
  const known = folders.find(one => one.path === near || one.path === path || (real !== undefined && one.real === real))
  if (known !== undefined) {
    return hasPrimary || !known.isOther ? folders : folders.map(one => (one === known ? { ...one, isOther: false } : one))
  }
  const added: TodoFolder = { path, rel: relIn(real, repoRoot) ?? near, isOther: hasPrimary, ...(real === undefined ? {} : { real }) }
  if (folders.length < MAX_FOLDERS) {
    return hasPrimary ? [...folders, added] : [added, ...folders]
  }
  // At the limit no folder drops in silence. The session's own folder, with no primary yet,
  // is shown first and the last folder is cut; else the new folder is the one cut. The cut folder's IDs
  // still count, and a toast names it.
  const shown = hasPrimary ? folders : [added, ...folders]
  const cut = hasPrimary ? added : shown[shown.length - 1]!
  cutFolders = [...cutFolders.filter(one => one !== added.path), cut.path]
  await refreshCutIds($).catch(() => undefined)
  showToast($, `The todo folder ${cut.rel} is not shown: the pane shows ${MAX_FOLDERS} folders. Its ticket IDs still count.`)

  return shown.slice(0, MAX_FOLDERS)
}

/** The scan in flight, and the ask that came while it ran: one scan at a time, so an older slow scan never puts an older board over a newer one. */
let scanRun: Promise<void> | undefined
let scanAsked: { isFull: boolean } | undefined
/** The folders and files the last scan pass could not read: a ticket in one of them is not known to be gone. */
let unreadPlaces: string[] = []
/** The folders of the last scan pass, and those of them with a place that did not read: a claim stays only while a folder that could hold it is among them. */
let scanFolders: ClaimFolder[] = []
let unreadFolders: ClaimFolder[] = []
/** The folders of the last scan pass that list a `.md` entry the scan does not read (a symlink): their book keys stay. */
let linkedFolders = new Set<string>()
/** The number of the last scan pass started, and the callers waiting for a pass by its number. */
let passStarted = 0
let passWaiters: { pass: number; resolve: () => void; reject: (error: unknown) => void }[] = []

/**
 * Rereads the `.md` files of every known folder; a file whose mtime is unchanged keeps its parse.
 * Single-flight: a call while a scan runs asks for one more pass after it (full if any ask was full).
 * The promise a caller gets settles when the first pass that started after its call ends:
 * at most the pass in flight and one more, never the follow-up passes others ask for after it.
 */
function scan($: EngineInterface, isFull = false): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    passWaiters.push({ pass: passStarted + 1, resolve, reject })
  })
  if (scanRun !== undefined) {
    scanAsked = { isFull: isFull || scanAsked?.isFull === true }

    return done
  }
  scanRun = (async () => {
    try {
      let full = isFull
      for (;;) {
        passStarted += 1
        // A write (numbering, an archive move) asks for a full pass again, so the next pass never works from stale text.
        const again = await scanOnce($, full)
        const ended = passWaiters.filter(one => one.pass <= passStarted)
        passWaiters = passWaiters.filter(one => one.pass > passStarted)
        for (const one of ended) {
          one.resolve()
        }
        const asked = scanAsked
        scanAsked = undefined
        if (!again && asked === undefined) {
          return
        }
        full = again || asked?.isFull === true
      }
    } catch (error) {
      const failed = passWaiters
      passWaiters = []
      for (const one of failed) {
        one.reject(error)
      }
    } finally {
      scanRun = undefined
      scanAsked = undefined
    }
  })()

  return done
}

/** One scan pass; true when it wrote a file, so another full pass is due. */
/**
 * The place of each item line by file path and key, from the read that built the items the board
 * draws (`drawnPlaces`): a press checks that the line it writes is still at the place the board drew
 *. A scan collects the places of its reads and sets them in the same step as
 * `todoFiles`, so a press in the middle of a scan never checks the old board's item against
 * the new text's places.
 */
let linePlacesOf = new Map<string, Map<string, DrawnPlace>>()

/** The drawn place of a line for `isDrawnLine`: empty when the scan has no read of the file (then text and box are checked alone). */
function placeOfLine(path: string, key: string): { place?: string; sum?: string } {
  return linePlacesOf.get(path)?.get(key) ?? {}
}

/**
 * The `.md` files outside the central folder that hold any text, top level and archive, by path
 *: while one is there, Consolidate todos has work left, whether or not the file has items.
 */
const filledSources = new Set<string>()

/** Notes from one read whether a file outside the central folder holds text. */
function noteFilled(folder: string, path: string, text: string): void {
  if (folder !== centralFolder() && text.trim() !== '') {
    filledSources.add(path)
  } else {
    filledSources.delete(path)
  }
}

async function scanOnce($: EngineInterface, isFull: boolean): Promise<boolean> {
  todoFolders = await noteNearest($, await ensureFolders($))
  const folders = todoFolders ?? []
  // The book lives in the primary folder only. With no primary folder the items are not sorted.
  const bookFolder = folders.find(one => !one.isOther)?.path
  await loadBook($, bookFolder, isFull)
  if (isFull) {
    await refreshCutIds($).catch(() => undefined)
  }
  const known = new Map(todoFiles.map(file => [fileId(file), file]))
  const next: TodoFile[] = []
  const empties: { folder: string; path: string; name: string; rel?: string }[] = []
  const unread: string[] = []
  // The folders whose top level did not read whole: only they may hold a ticket the scan did not find (an archive holds no live ticket).
  const unreadTop = new Set<string>()
  // The files listed this scan, and the folders that would not list: a file gone from a listed folder leaves `filledSources` and `linePlacesOf`.
  const listedPaths = new Set<string>()
  const unlistedDirs: string[] = []
  const linked = new Set<string>()
  // The places of the files this scan keeps, from the read each one's items come from: set with `todoFiles`.
  const places = new Map<string, Map<string, DrawnPlace>>()
  const keepPlaces = (path: string) => {
    const was = linePlacesOf.get(path)
    if (was !== undefined) {
      places.set(path, was)
    }
  }
  for (const folder of folders) {
    // The archive folder by its disk name: a file's path is then its own real path, and its name keeps `archive/`.
    const sources: [string, string][] = [[folder.path, ''], [await archiveDirOf($, folder.path), 'archive/']]
    for (const [dir, prefix] of sources) {
      // A folder whose check or list fails is not known to be empty: its files stay as last read.
      const exists = await fsBounded($, () => $.fs.exists(dir)).then(is => is, () => undefined)
      const entries = exists === true ? await fsBounded($, () => $.fs.list(dir)).then(list => list, () => undefined) : []
      if (exists === undefined || entries === undefined) {
        unlistedDirs.push(dir)
        unread.push(`${folder.rel ?? folder.path}${prefix === '' ? '' : '/archive'}`)
        if (prefix === '') {
          unreadTop.add(folder.path)
        }
        const stay = todoFiles.filter(file => file.folder === folder.path && (prefix === '' ? !file.name.includes('/') : file.name.startsWith(prefix)))
        stay.forEach(file => keepPlaces(`${file.folder}/${file.name}`))
        next.push(...stay)
        continue
      }
      for (const entry of entries) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.md')) {
          // A linked (or other non-file) todo entry is never read, so its tickets are not known to be gone.
          if (entry.name.endsWith('.md') && entry.kind !== 'dir') {
            linked.add(folder.path)
          }
          continue
        }
        const name = `${prefix}${entry.name}`
        listedPaths.add(`${dir}/${entry.name}`)
        const place = { name, folder: folder.path, rel: folder.rel, ...(folder.isOther ? { isOther: true as const } : {}) }
        const cached = known.get(fileId(place))
        if (!isFull && cached !== undefined && cached.mtimeMs === entry.mtimeMs) {
          keepPlaces(`${dir}/${entry.name}`)
          next.push(cached)
          continue
        }
        const read = await readTodo($, `${dir}/${entry.name}`)
        const text = read.kind === 'ok' ? read.text : undefined
        // A read that failed is not an empty file: the last good parse stays (with its old mtime, so the next scan reads it again). Dropping it would end the orchestrator's claims on its tickets.
        if (typeof text !== 'string' && cached !== undefined) {
          keepPlaces(`${dir}/${entry.name}`)
          next.push(cached)
          continue
        }
        if (typeof text !== 'string') {
          unread.push(`${folder.rel ?? folder.path}/${name}`)
          if (prefix === '') {
            unreadTop.add(folder.path)
          }
        }
        // A file with nothing but blanks is empty; one that would not read is not known to be.
        if (typeof text === 'string' && text.trim() === '' && !(folder.path === centralFolder() && prefix === '' && entry.name.toLowerCase() === 'todo.md')) {
          empties.push({ folder: folder.path, path: `${dir}/${entry.name}`, name, ...(folder.rel === undefined ? {} : { rel: folder.rel }) })
        }
        if (typeof text === 'string') {
          places.set(`${dir}/${entry.name}`, drawnPlaces(text))
          noteFilled(folder.path, `${dir}/${entry.name}`, text)
        }
        const items = parseTodo(typeof text === 'string' ? text : '')
        next.push(prefix === '' ? { ...place, mtimeMs: entry.mtimeMs, items } : { ...place, mtimeMs: entry.mtimeMs, items, isArchived: true })
      }
    }
  }
  for (const path of [...filledSources.keys()]) {
    if (!listedPaths.has(path) && !unlistedDirs.some(dir => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))) {
      filledSources.delete(path)
    }
  }
  unreadPlaces = unread
  linkedFolders = linked
  scanFolders = folders.map(folder => ({ folder: folder.path, rel: folder.rel, isOther: folder.isOther }))
  unreadFolders = scanFolders.filter(folder => unreadTop.has(folder.folder))
  const kept = next.filter(file => file.items.length > 0)
  const isSame = isFull
    ? JSON.stringify(todoFiles) === JSON.stringify(kept)
    : todoFiles.length === kept.length && todoFiles.every((file, i) => fileId(file) === (kept[i] === undefined ? '' : fileId(kept[i])) && file.mtimeMs === kept[i]?.mtimeMs)
  // The places go with the items they came from, in the same step, with no await between. When the items
  // are the same the board is the same, and the new places name the same lines.
  linePlacesOf = places
  if (!isSame) {
    todoFiles = kept
    redraw($)
  }
  if (pruneTickets() || prunePlannedTickets()) {
    redraw($)
  }
  const sign = `${hasDupTickets}|${emptyFiles.map(one => one.path).join('|')}`
  await refreshArchiveLink($).catch(() => undefined)
  // The archive file the Show completed link opens may be empty: Delete empty todos leaves it be.
  emptyFiles = empties.filter(one => one.path !== archiveLink)
  await refreshDupTickets($)
  if (sign !== `${hasDupTickets}|${emptyFiles.map(one => one.path).join('|')}`) {
    redraw($)
  }
  // Numbering first, and a scan again after a write, so the archive move never works from stale text.
  if (await numberTickets($).catch(() => false)) {
    return true
  }
  if (await archiveDone($).catch(() => false)) {
    return true
  }
  void sortItems($).catch(() => undefined)

  return false
}

// ---------------------------------------------------------------- categories

let book: CategoryBook = emptyBook()
let bookDir: string | undefined
let isSorting = false
let lastSortAt: number | undefined
/** How many sorts in a row failed on the model call or the write: each doubles the wait, up to 64 times 30 s. */
let sortFailures = 0
/** The run of failures that may be the items' fault for one batch: the second halves the batch. */
let sortThrows: BatchThrows | undefined
/** The sort attempts that left an item unsorted, by key, with the text they saw. */
const sortTries = new Map<string, { text: string; count: number }>()
/** The items of the next sort call: halved by each reply that does not parse, reset by one that does. */
let sortBatchSize = SORT_BATCH
/** The items whose reply did not parse when each was sent alone, by key, with the text they had: sent alone and last from then on. */
const sortAlone = new Map<string, string>()

/** The failures in a row after which the sort says so once. */
const SORT_FAILS_TO_TOAST = 3
/** Whether the toast for failures in a row was shown; shown again only after a sort is written. */
let isSortToastShown = false

/** Counts a failed sort and, at SORT_FAILS_TO_TOAST in a row, says once why: a sort that fails for good would otherwise leave the tickets unsorted with no word. */
function sortFailed($: EngineInterface, why: string): void {
  sortFailures += 1
  if (sortFailures >= SORT_FAILS_TO_TOAST && !isSortToastShown) {
    isSortToastShown = true
    showToast($, `Sorting into categories failed ${sortFailures} times in a row (${why}). The tickets stay unsorted; it is tried again later.`)
  }
}

/** The wait before the next sort: 30 s, doubled for each failure in a row. */
function sortWaitMs(): number {
  return SORT_EVERY_MS * 2 ** Math.min(sortFailures, 6)
}

/**
 * Whether `categories.json` in the folder may be read or written: the folder is trusted (its own real
 * path, inside the checkout, not the global one) and the file is either not there or a plain file.
 * A symlink at that name (a repo can commit one) is never followed.
 */
async function isBookSafe($: EngineInterface, folder: string): Promise<boolean> {
  const path = `${folder}/categories.json`

  return (await isTrustedDir($, folder)) && (!(await hasEntry($, path)) || (await isPlainFile($, path)))
}

/**
 * Reads the book from `categories.json` in the primary folder. Three outcomes, kept apart:
 * no file, or a file that reads and parses: the book is that, and the folder is set. A file that reads
 * but does not parse: a copy goes to the first free of the numbered backup names (`categories.json.bak`,
 * `.bak.2`, ...) first, then the book starts over. A file
 * that does not read at all: the book in memory stays as it is and `bookDir` is cleared, so no sort
 * runs and nothing is written until a later scan reads the file.
 */
async function loadBook($: EngineInterface, folder: string | undefined, isFull = false): Promise<void> {
  if (folder === bookDir && !isFull) {
    return
  }
  if (isSorting) {
    return
  }
  await readBookFile($, folder)
}

/**
 * The text of `categories.json` that the book in memory came from or was last written as:
 * null for no file. Each book write reads the file again first and compares it with this.
 */
let bookSeen: string | null | undefined

/** The text of a book file now: null when there is none, undefined when it cannot be told (a failed check or read). */
async function bookOnDisk($: EngineInterface, path: string): Promise<string | null | undefined> {
  const exists = await fsBounded($, () => $.fs.exists(path)).then(is => is, () => undefined)
  if (exists !== true) {
    return exists === false ? null : undefined
  }
  try {
    const text: unknown = await fsBounded($, () => $.fs.read(path))

    return typeof text === 'string' ? text : ''
  } catch {
    return undefined
  }
}

/**
 * True when `categories.json` is no longer the text the book came from: a user edit, a
 * `git pull` or a branch switch. The book is then read again from the file and the caller skips its
 * write, so the change is kept; the next sort works on the book as read. A file that cannot be read
 * now counts as changed, and the read clears `bookDir`, so nothing is written.
 */
async function isBookChanged($: EngineInterface, folder: string): Promise<boolean> {
  const now = await bookOnDisk($, `${folder}/categories.json`)
  if (now !== undefined && now === bookSeen) {
    return false
  }
  await readBookFile($, folder)

  return true
}

/** The body of `loadBook` with no guard, also the reload after a change on disk. */
async function readBookFile($: EngineInterface, folder: string | undefined): Promise<void> {
  // A folder or file that is not safe (a symlink at the book's name, an untrusted folder) is not read: no book, no sort, no write.
  if (folder !== undefined && !(await isBookSafe($, folder))) {
    bookDir = undefined
    book = emptyBook()

    return
  }
  const path = `${folder}/categories.json`
  const raw = folder === undefined ? null : await bookOnDisk($, path)
  if (raw === undefined) {
    bookDir = undefined

    return
  }
  bookSeen = raw
  if (raw === null) {
    bookDir = folder
    book = emptyBook()

    return
  }
  const read = readBook(raw)
  if (read !== undefined) {
    book = read
    bookDir = folder

    return
  }
  // A damaged file (not JSON, or JSON of another shape) starts the book over, but the next
  // sort overwrites it: keep a copy first, under the first backup name with nothing at it, so an older
  // copy is never written over and a symlink at a backup name is never written through.
  // With no copy made, the file is left alone and the next scan tries again.
  book = emptyBook()
  bookDir = raw.trim() === '' ? folder : await backUpBook($, path, raw).then(isKept => (isKept ? folder : undefined), () => undefined)
}

/** True once the user was told that every backup name of a damaged book is taken. */
let backupsFullToasted = false
/** True once the user was told that the folder of a damaged book cannot be listed. */
let backupsListToasted = false

/** The first wait after a failed backup write of a damaged book, and the longest: 5 s doubling to 10 min. */
const BACKUP_RETRY_MS = 5000
const BACKUP_RETRY_MAX_MS = 10 * 60_000
/** The backup writes of a damaged book that failed in a row, and the time of the next try. */
let backupFailing: Failing | undefined
/** True once the user was told that a backup write failed; cleared when one works. */
let backupWriteToasted = false

/**
 * Writes a copy of a damaged book to the first free backup name (`bookBackups`). False when every name
 * is taken: the book is then left alone, so no sort runs, and a toast says so once. False too when the
 * write fails (a read-only folder, a full disk): one toast names the error, and the next try
 * waits (BACKUP_RETRY_MS, doubled per failure in a row) instead of coming with every scan.
 */
async function backUpBook($: EngineInterface, path: string, raw: string): Promise<boolean> {
  if (!isRetryDue(backupFailing, nowSync(), BACKUP_RETRY_MAX_MS)) {
    return false
  }
  try {
    return await backUpBookNow($, path, raw)
  } catch (error) {
    backupFailing = addFailure(backupFailing, nowSync(), BACKUP_RETRY_MS, BACKUP_RETRY_MAX_MS)
    if (!backupWriteToasted) {
      backupWriteToasted = true
      showToast($, `${path} is damaged and its backup could not be written (${error instanceof Error ? error.message : String(error)}), so it is left as it is and nothing is sorted. The backup is tried again later.`)
    }

    return false
  }
}

/** The body of `backUpBook`, with no retry wait: a write or check that throws goes up to it. */
async function backUpBookNow($: EngineInterface, path: string, raw: string): Promise<boolean> {
  const names = bookBackups(path)
  // A folder that will not list would make every name look taken (hasEntry answers yes): say the true cause instead.
  const dir = path.slice(0, path.lastIndexOf('/'))
  if ((await fsBounded($, () => $.fs.list(dir)).catch(() => undefined)) === undefined) {
    if (!backupsListToasted) {
      backupsListToasted = true
      showToast($, `${path} is damaged and ${dir} cannot be listed, so no backup can be made. It is left as it is and nothing is sorted.`)
    }

    return false
  }
  for (const name of names) {
    if (!(await hasEntry($, name))) {
      await $.fs.write(name, raw)
      backupFailing = undefined
      backupWriteToasted = false

      return true
    }
  }
  if (!backupsFullToasted) {
    backupsFullToasted = true
    showToast($, `${path} is damaged and its ${names.length} backup names are taken, so it is left as it is and nothing is sorted. Remove an old backup to sort again.`)
  }

  return false
}

/**
 * Asks the model to sort the open items that have no category yet: batch after batch, up to
 * SORT_BATCHES batches in one run (so the first scan sorts most folders whole), then again at most
 * every 30 s.
 */
async function sortItems($: EngineInterface): Promise<void> {
  const time = await $.clock.now()
  // Timed with elapsedSince: a clock set back restarts the wait, it never stops the sort for the length of the set-back.
  const sinceSort = lastSortAt === undefined ? undefined : elapsedSince(lastSortAt, time)
  lastSortAt = sinceSort?.from
  if (bookDir === undefined || isSorting || (sinceSort !== undefined && sinceSort.ms < sortWaitMs())) {
    return
  }
  const open = todoFiles
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map(item => ({ item, key: keptKey(file, item) })))
    .filter(one => one.item.status !== 'completed' && categoryOf(book, one.key) === undefined)
    // An item the model has twice failed to sort stays unsorted until its text changes.
    .filter(one => {
      const tried = sortTries.get(one.key)

      return tried === undefined || tried.text !== one.item.text || tried.count < SORT_TRIES
    })
  const unsorted = [...new Map(open.map(one => [one.key, one.item.text])).entries()]
  if (unsorted.length === 0) {
    return
  }
  isSorting = true
  lastSortAt = time
  try {
    // No model call for a book that could not be saved: the folder or file is not safe to write.
    if (!(await isBookSafe($, bookDir))) {
      return
    }
    for (const key of [...sortAlone.keys()]) {
      if (!unsorted.some(([one]) => one === key)) {
        sortAlone.delete(key)
      }
    }
    let queue = unsorted
    for (let call = 0; call < SORT_BATCHES; call += 1) {
      const batch = nextSortBatch(queue, sortAlone, sortBatchSize)
      if (batch.length === 0) {
        break
      }
      queue = queue.filter(one => !batch.includes(one))
      let reply: { isAnswered: boolean; text?: string; reason?: string; status?: unknown } | undefined
      let isThrown = false
      let failure = 'the model call failed'
      try {
        reply = (await $.model.complete({ model: SORT_MODEL, prompt: sortPrompt(book.categories, batch.map(([, text]) => text)), maxTokens: 4000 })) as typeof reply
      } catch (error) {
        reply = undefined
        isThrown = true
        failure = error instanceof Error ? error.message : String(error)
      }
      const kind = sortReplyKind(reply)
      if (kind === 'failed') {
        // The model call failed: wait longer before the next try.
        sortFailed($, reply?.reason === undefined || reply.reason === '' ? failure : reply.reason)
        // A throw, or an HTTP 4xx answer (a 400, a 413), may be the items' fault: the second
        // in a row for the same batch halves it, and a lone item goes last, with no try counted, so the
        // queue moves past it. A transport or capacity failure (no status, 5xx, 429, an abort) only waits.
        if (isItemsFailure(reply, isThrown)) {
          sortThrows = nextThrows(sortThrows, batch.map(([key]) => key).join('\u0000'))
          if (sortThrows.count >= THROWS_TO_HALVE) {
            sortThrows = undefined
            if (batch.length === 1) {
              sortAlone.delete(batch[0]![0])
              sortAlone.set(batch[0]![0], batch[0]![1])
            } else {
              sortBatchSize = nextBatchSize(Math.min(sortBatchSize, batch.length), false)
            }
          }
        }

        break
      }
      sortThrows = undefined
      // An empty reply (a refusal, no text) is read like one that does not parse: the items may be the cause.
      // The write drops the items of tickets gone from every file.
      const next = kind === 'text' ? applySortReply(pruneBookItems(book, bookKeep()), batch.map(([key]) => key), reply?.text ?? '') : undefined
      if (next === undefined) {
        // A reply that does not parse is the model's fault, not the items': it waits longer, as a failed call does, and counts against no item in a batch of more than one.
        // The next call carries half the items, so one item that never gets a readable reply ends up alone and last, and the queue moves past it.
        sortFailed($, 'the reply could not be read')
        if (batch.length === 1) {
          const [key, text] = batch[0]!
          // Set again at the end of the order: the other lone items go first next time.
          sortAlone.delete(key)
          sortAlone.set(key, text)
          // An item that fails alone SORT_TRIES times is tried for the session: it is not sent again until its text changes, so a poison item costs no call for good.
          const tried = addAloneTry(sortTries.get(key), text)
          sortTries.set(key, tried)
          if (tried.count >= SORT_TRIES) {
            sortAlone.delete(key)
            showToast($, `Not sorted: no readable reply for "${ticketSummary(text, 60)}" when sent alone. It stays unsorted until its text changes.`)
          }
        } else {
          sortBatchSize = nextBatchSize(Math.min(sortBatchSize, batch.length), false)
        }

        break
      }
      sortBatchSize = nextBatchSize(sortBatchSize, true)
      for (const [key] of batch) {
        sortAlone.delete(key)
      }
      for (const [key, text] of batch) {
        // Only a reply that parses but leaves an item out counts a try against it.
        if (categoryOf(next, key) === undefined) {
          const tried = sortTries.get(key)
          sortTries.set(key, { text, count: tried !== undefined && tried.text === text ? tried.count + 1 : 1 })
        } else {
          sortTries.delete(key)
        }
      }
      if (bookDir === undefined) {
        break
      }
      // The last check before the write: never through a symlink, never into an untrusted folder.
      if (!(await isBookSafe($, bookDir))) {
        break
      }
      // The file changed since the book was read: it is read again and this reply is dropped, so the change is never written over.
      if (await isBookChanged($, bookDir)) {
        redraw($)

        break
      }
      // Write first, then keep: a failed write leaves the book as the file has it.
      const written = `${JSON.stringify(next, null, 2)}\n`
      try {
        await $.fs.write(`${bookDir}/categories.json`, written)
      } catch (error) {
        sortFailed($, `categories.json could not be written: ${error instanceof Error ? error.message : String(error)}`)

        break
      }
      sortFailures = 0
      isSortToastShown = false
      book = next
      bookSeen = written
      redraw($)
    }
  } finally {
    isSorting = false
  }
}

/**
 * Which book keys a write keeps: the keys of the items of every live and archived file
 * the scan read, and every key of a folder that did not read whole: one that this discovery left
 * out (git failed, an exists check failed), one that lists a linked todo file, or one that holds a
 * place the scan could not read (`bookKeptBy`): an item in it is not known to be gone. Only that
 * folder keeps every key: one unread file never stops the pruning of the other folders.
 */
function bookKeep(): (key: string) => boolean {
  const keys = new Set(todoFiles.flatMap(file => file.items.map(item => keptKey(file, item))))
  const unreadAt = foldersWithUnread(unreadPlaces, scanFolders)
  const whole = scanFolders.filter(folder => !linkedFolders.has(folder.folder) && !unreadAt.has(folder.folder))

  return bookKeptBy(keys, { others: whole.filter(folder => folder.isOther === true).map(folder => folder.rel ?? folder.folder), hasPrimary: whole.some(folder => folder.isOther !== true) })
}

/** The open items of the live files, once each by key: [key, text]. */
function openItems(): [string, string][] {
  const open = todoFiles
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map(item => ({ item, key: keptKey(file, item) })))
    .filter(one => one.item.status !== 'completed')

  return [...new Map(open.map(one => [one.key, one.item.text])).entries()]
}

/**
 * The Recategorize button: asks the model to sort every open ticket from scratch (the sort prompt,
 * batch after batch, ignoring the current assignments), then keeps the result only when it is a
 * real change. Otherwise the current categories stay, and a note says so. A model failure leaves
 * everything as it was.
 */
async function recategorize($: EngineInterface): Promise<void> {
  const open = openItems()
  if (isRecategorizing || isSorting || open.length === 0) {
    return
  }
  isRecategorizing = true
  isSorting = true
  recatNote = undefined
  redraw($)
  let text: string | undefined = 'Could not recategorize'
  try {
    if (bookDir === undefined) {
      throw new Error('no book folder')
    }
    let fresh: CategoryBook = emptyBook()
    // At most SORT_BATCHES batches: the tickets past them are sorted afterwards by the
    // normal sort, into the new categories. A batch that fails is asked once more; if it fails
    // again nothing is written, since a part of the tickets cannot be judged as the whole.
    const covered = open.slice(0, SORT_BATCH * SORT_BATCHES)
    for (let from = 0; from < covered.length; from += SORT_BATCH) {
      const batch = covered.slice(from, from + SORT_BATCH)
      let next: CategoryBook | undefined
      let why = 'unreadable reply'
      for (let attempt = 0; attempt < 2 && next === undefined; attempt += 1) {
        try {
          const reply = await $.model.complete({ model: SORT_MODEL, prompt: sortPrompt(fresh.categories, batch.map(([, one]) => one)), maxTokens: 4000 })
          next = reply.isAnswered ? applySortReply(fresh, batch.map(([key]) => key), reply.text) : undefined
          why = reply.isAnswered ? 'unreadable reply' : 'no answer from the model'
        } catch (error) {
          why = error instanceof Error ? error.message : String(error)
        }
      }
      if (next === undefined) {
        throw new Error(why)
      }
      fresh = next
    }
    const keys = covered.map(([key]) => key).filter(key => categoryOf(fresh, key) !== undefined)
    if (keys.length === 0) {
      throw new Error('nothing sorted')
    }
    // Groups the model named but gave no ticket are dropped, so they do not count as groups; a group
    // only tickets past the covered ones hold stays, so the merge keeps their category.
    fresh = { categories: usedCategories(book, fresh, keys, open.slice(covered.length).map(([key]) => key)), items: fresh.items }
    if (isSubstantialChange(book, fresh, keys)) {
      // The tickets past the covered ones keep their saved category where it is still a category.
      fresh = mergeRecategorized(pruneBookItems(book, bookKeep()), fresh, covered.map(([key]) => key))
      if (!(await isBookSafe($, bookDir))) {
        throw new Error('the categories file is not safe to write')
      }
      // A file changed since it was read is read again and kept: the new sort is not written over it.
      if (await isBookChanged($, bookDir)) {
        throw new Error('categories.json changed on disk, so it was read again. Press again to sort its categories')
      }
      // Write first, then keep: a failed write leaves the book, and the pane, as they were.
      const written = `${JSON.stringify(fresh, null, 2)}\n`
      await $.fs.write(`${bookDir}/categories.json`, written)
      book = fresh
      bookSeen = written
      text = undefined
    } else {
      text = 'The current categories are correct'
    }
  } catch (error) {
    text = `Could not recategorize: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    isRecategorizing = false
    isSorting = false
    recatNote = text === undefined ? undefined : { text, until: (await $.clock.now()) + NOTE_MS }
    redraw($)
  }
}

// ---------------------------------------------------------------- agent to item matching

/** Agents already matched, or being matched, by agent ID: one model call per agent that is answered. */
const matchedAgents = new Set<string>()
/** The match calls of each agent that failed in a row (thrown or unanswered), and when it is tried next. */
const matchFailures = new Map<string, Failing>()
/** The tries of one agent's match, and the wait after the first failure: 30 s, then 60 s. */
const MATCH_TRIES = 3
const MATCH_RETRY_MS = 30_000
const MATCH_RETRY_MAX_MS = 10 * 60_000
/** True once the toast for a match given up is shown; shown again only after a match call is answered. */
let isMatchToastShown = false

/**
 * Asks Haiku, once per agent, which open, queued or in-progress todo items the agent's task works on, and
 * links them. Agents rarely name their items, and most items have no ID, so without this most
 * links never form. In-progress items are listed first, then queued, then open.
 */
async function matchAgent($: EngineInterface, id: string, task: string): Promise<void> {
  // The one guard of the once-per-agent rule; matchNewAgents calls for every live row.
  // A call that failed is tried again after its wait, at most MATCH_TRIES times in all.
  const failing = matchFailures.get(id)
  if (matchedAgents.has(id) || (failing !== undefined && failing.count >= MATCH_TRIES) || !isRetryDue(failing, nowSync(), MATCH_RETRY_MAX_MS)) {
    return
  }
  const open = todoFiles
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items)
    .filter(item => item.status !== 'completed')
  const texts = [...new Set([...open.filter(item => item.status === 'in_progress'), ...open.filter(item => item.status === 'queued'), ...open.filter(item => item.status === 'pending')].map(item => item.text))].slice(0, MATCH_ITEMS)
  if (texts.length === 0) {
    return
  }
  matchedAgents.add(id)
  const reply = await $.model.complete({ model: SORT_MODEL, prompt: matchPrompt(task, texts), maxTokens: 200 }).catch(() => undefined)
  if (reply?.isAnswered !== true) {
    // A thrown or unanswered call is not an answer: the agent is matched again after a wait, and given up with one toast after MATCH_TRIES.
    // No await between the delete and the record: a refresh in between would pass the guard and call again at once.
    const next = addFailure(matchFailures.get(id), nowSync(), MATCH_RETRY_MS, MATCH_RETRY_MAX_MS)
    matchFailures.set(id, next)
    matchedAgents.delete(id)
    if (next.count >= MATCH_TRIES && !isMatchToastShown) {
      isMatchToastShown = true
      const index = agentRows.findIndex(row => row.id === id)
      showToast($, `Could not match ${index < 0 ? 'an agent' : agentLabel(index)} to a ticket: the model call failed ${next.count} times. Its links come only from the IDs and items it names.`)
    }

    return
  }
  matchFailures.delete(id)
  isMatchToastShown = false
  const picks = readMatchReply(reply.text, texts.length)
  // A reply with no pick is stored as no pick, so a reload does not run the match again: mergeGroup marks a row with autoClaims as matched.
  const autoClaims = picks.map(i => texts[i]).filter((text): text is string => text !== undefined)
  setRows(agentRows.map(row => (row.id === id ? { ...row, autoClaims } : row)))
  redraw($)
}

// ---------------------------------------------------------------- agents

/**
 * The kill switch on a live agent's card: stops the agent at once through TaskStop, which aborts
 * its loop. The agent gets no turn to wind down or sum up.
 */
async function stopAgent($: EngineInterface, id: string): Promise<void> {
  // By ID, not by place: the rows shift when old ones are cut or a store merges, and a press on a tree drawn before the shift must stop the agent on its card.
  const index = agentRows.findIndex(one => one.id === id)
  const row = agentRows[index]
  if (row === undefined || isEnded(row.status)) {
    return
  }
  // Only the stop call is in the try: a throw after a stop that worked (the success toast) never reads as "Could not stop".
  let isStopped = false
  try {
    const stopped = (await $.tool.call({ tool: 'TaskStop', task_id: row.id } as never)) as { deny?: string; isError?: boolean; text?: string }
    if (stopped.deny !== undefined || stopped.isError === true) {
      throw new Error(stopped.deny ?? stopped.text ?? 'TaskStop failed')
    }
    isStopped = true
  } catch (error) {
    showToast($, `Could not stop ${agentLabel(index)}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (isStopped) {
    const old = agentRows
    setRows(agentRows.map(one => (one.id === row.id ? { ...one, status: 'killed', endedAt: one.endedAt ?? clockMs } : one)))
    endedHere.add(row.id)
    noteEnds(old, agentRows)
    try {
      // Every stored description is already hidden; the toast checks again, so no path can show one.
      showToast($, `Stopped ${agentLabel(index)}: ${ticketSummary(hideSecretLines(row.description), 60)}`)
    } catch {
      // A toast that fails has nowhere left to tell; the stop itself worked.
    }
  }
  await refreshAgents($, true).catch(() => undefined)
}

/**
 * The agents this session saw end for sure, by a Stop press or a task notification: a
 * list that still says they run lags behind (the engine list can trail TaskStop), so it never sets
 * them live again. A new spawn of the ID clears it. In memory only: after a reload the list rules.
 */
const endedHere = new Set<string>()

/** Tool calls seen since the last refresh, per agent: written in one batch, not one redraw each. */
const pendingTools = new Map<string, { calls: number; doing: string }>()
/** Tokens each agent's model requests used since the last refresh: they ride along like the tool calls. */
const pendingTokens = new Map<string, number>()
/** The turns this load saw a step of, by agent and turn ID; for a turn first seen past its first step, the tokens counted since. */
const seenTurns = new Map<string, number | undefined>()
/**
 * The model each agent's requests name. The spawn gives an agent's model, but an agent that was
 * already running when the mod loaded is known only from the agent list, which has none.
 */
const stepModels = new Map<string, string>()
/** The color slot each agent was first drawn with, by agent ID: a woken agent's replayed slot never moves another agent's color. */
const slotPins = new Map<string, number>()
/** Counts the refreshes started: the one that started last sets the view time. */
let refreshSeq = 0
let lastClock = 0
/** When each live row was first missing from the agent list, by agent ID: the start of its grace. */
let missingSince = new Map<string, number>()

/**
 * Merges the agent list and the pending tool calls and tokens into the rows, and redraws only on a
 * change of status, once every 5 s (STG-PERF-1), or when forced at the end of an agent's turn; the
 * CSS motion runs on between redraws.
 */
async function refreshAgents($: EngineInterface, isForced = false): Promise<void> {
  refreshSeq += 1
  const seq = refreshSeq
  const time = await $.clock.now()
  wallMs = time
  await loadAgents($).catch(() => undefined)
  // The kept token count too: a load that no session.start follows (a plugin reload) still seeds the trace from it.
  await readUsage($).catch(() => undefined)
  // Bounded (-015): an agent list that never answers fails this refresh, which its caller counts, instead of holding every later tick.
  const listed = await failAfter($.agent.list(), RUN_LIMIT_MS, (ms, fire) => $.clock.after(ms, fire))
  const rows = agentRows
  const known = new Map(rows.map(row => [row.id, row]))
  // The agents new in this refresh take places before a cut row returns, so a return never pushes out a live row.
  // An ended agent listed before every cut ID kept is a cut row whose ID fell off KEPT_CUT: it stays cut, so it never comes back as a new row with every refresh.
  const forgotten = loadedGroups.has('rows') && cutRowIds.size > 0 ? forgottenCut(listed, one => cutRowIds.has(one)) : new Set<string>()
  const freshIds = new Set(listed.filter(info => !known.has(info.id) && !cutRowIds.has(info.id) && !forgotten.has(info.id)).map(info => info.id))
  let returnSlots = cutReturnSlots(rows, freshIds.size)
  for (const info of listed) {
    const row = known.get(info.id)
    if (row === undefined && forgotten.has(info.id)) {
      continue
    }
    // A row cut from the kept window stays cut: added back it would be a new row with no data, every refresh.
    // A live one comes back while a place is free or an ended row goes for it: its agent is still at work.
    if (row === undefined && cutRowIds.has(info.id)) {
      if (isEnded(info.status as AgentRowStatus) || returnSlots === 0) {
        continue
      }
      returnSlots -= 1
      cutRowIds.delete(info.id)
      cutRowVersion += 1
    }
    const listedState = info.status as AgentRowStatus
    // A row this session ended (a Stop, a notification) keeps its end over a list that still says live; an ended status from the list is taken.
    const state = row !== undefined && endedHere.has(info.id) && isEnded(row.status) && !isEnded(listedState) ? row.status : listedState
    // The description is drawn as the card title, stored and toasted: its secrets are hidden first.
    const description = hideSecretLines(info.description || row?.description || info.name || info.id)
    known.set(info.id, {
      id: info.id,
      description,
      type: info.type,
      model: row?.model ?? stepModels.get(info.id),
      status: state,
      startedAt: row?.startedAt ?? time,
      endedAt: isEnded(state) ? (row?.endedAt ?? time) : undefined,
      toolCalls: row?.toolCalls ?? 0,
      ...(row?.tokens === undefined ? {} : { tokens: row.tokens }),
      ...(row?.idleSince === undefined ? {} : { idleSince: row.idleSince }),
      doing: row?.doing,
      brief: row?.brief ?? normalize(hideSecretLines(description)),
      ...(row?.progress === undefined ? {} : { progress: row.progress }),
      ...(row?.claims === undefined ? {} : { claims: row.claims }),
      ...(row?.autoClaims === undefined ? {} : { autoClaims: row.autoClaims }),
      // The name is drawn and stored: its secrets are hidden as the description's are.
      ...(info.name === undefined ? {} : { name: hideSecretLines(info.name) }),
    })
  }
  // An agent the engine no longer lists has ended, though nothing said how: without this its row
  // stays live for good. A new agent gets a grace period, since its spawn starts the row before
  // the list has it.
  // The grace counts from the first refresh that missed the agent, not from its start.
  const listedIds = new Set(listed.map(info => info.id))
  const unlisted = unlistedEnds([...known.values()], listedIds, missingSince, time)
  missingSince = unlisted.missing
  for (const id of unlisted.ended) {
    const row = known.get(id)!
    known.set(id, { ...row, status: 'ended', endedAt: time })
  }
  const listedRows = [...known.values()]
  // A start, an end or a new agent redraws at once; tool-call counts and the current call ride
  // along with the next clock step, so a busy agent redraws the pane every 5 s, not every second.
  const isStatusChanged = !sameRows(listedRows, rows)
  matchNewAgents($, listedRows)
  // Timed with elapsedSince: after a clock set back, the 5 s redraws go on.
  const sinceClock = elapsedSince(lastClock, time)
  lastClock = sinceClock.from
  if (!isForced && !isStatusChanged && sinceClock.ms < CLOCK_MS) {
    return
  }
  for (const [id, seen] of pendingTools) {
    const row = known.get(id)
    if (row !== undefined) {
      known.set(id, { ...row, toolCalls: row.toolCalls + seen.calls, doing: seen.doing })
    }
  }
  pendingTools.clear()
  for (const [id, used] of pendingTokens) {
    const row = known.get(id)
    if (row !== undefined) {
      known.set(id, { ...row, tokens: (row.tokens ?? 0) + used })
      pendingTokens.delete(id)
    }
  }
  const next = [...known.values()]
  noteEnds(rows, next)
  setRows(next)
  lastClock = time
  // Only the latest refresh to start sets the view time: one that read its time earlier can finish after a later one, and must not step the time back.
  // A clock set back still moves it, as the latest refresh read it.
  if (seq === refreshSeq) {
    clockMs = time
  }
  pruneAgentState()
  redraw($)
}

/**
 * Drops the per-agent and per-item state of agents and items gone, so none of it grows
 * over a long session: by agent ID, to the rows kept plus the cut IDs; the times tickets were named,
 * to the orchestrator's tickets; the sort tries, to the items the scan read, and only when every
 * place read (an item in a place that did not read is not known to be gone).
 */
function pruneAgentState(): void {
  const rowIds = new Set(agentRows.map(row => row.id))
  const isAgent = (id: string) => rowIds.has(id) || cutRowIds.has(id)
  for (const held of [claimCheckedAt, matchedAgents, matchFailures, stepModels, nudgedAgents, pendingTokens, endedHere, slotPins]) {
    pruneTo(held, isAgent)
  }
  pruneTo(seenTurns, key => isTurnKept(key, isAgent))
  pruneTo(namedAt, key => orchTickets.has(key))
  pruneTo(sortTries, bookKeep())
}

/** Starts the one model match for each live agent that has not had it. */
function matchNewAgents($: EngineInterface, rows: readonly AgentRow[]): void {
  for (const row of rows) {
    if (!isEnded(row.status)) {
      void matchAgent($, row.id, row.brief).catch(() => undefined)
    }
  }
}

/** Gives every row its color slot, keeping the slot each agent was first drawn with (the cards read it through agentColor). */
function pinColorSlots(rows: readonly AgentRow[]): void {
  const slots = colorSlots(
    rows.map(row => ({ startedAt: row.startedAt, endedAt: row.endedAt, idleSince: row.idleSince, isEnded: isEnded(row.status), ...(slotPins.has(row.id) ? { pinned: slotPins.get(row.id)! } : {}) })),
    AGENT_COLORS.length,
  )
  rows.forEach((row, i) => slotPins.set(row.id, slots[i]!))
  setColorSlots(slots)
}

/** Marks an agent at work again: its tool call or model request ends its idle time. */
function wake(id: string): void {
  if (agentRows.some(row => row.id === id && row.idleSince !== undefined)) {
    setRows(
      agentRows.map(row => {
        if (row.id !== id) {
          return row
        }
        const { idleSince: _, ...awake } = row

        return awake
      }),
    )
  }
}

/** The moves the user made by hand since Claude last heard: told with its next tool result or prompt. */
let pendingMoves: string[] = []
/** Every item the user moved by hand this session, by `file:key`, with the box they gave it. */
const userMoves = new Map<string, ItemStatus>()

/** Answers a move_ticket call: asks the user, and writes the box only on a yes. */
async function moveTicket($: EngineInterface, input: Record<string, unknown>, isMain = false): Promise<string> {
  const ref = typeof input.item === 'string' ? input.item : ''
  const to = statusNamed(input.to)
  const reason = typeof input.reason === 'string' ? input.reason : ''
  if (to === undefined) {
    return 'Not moved: "to" must be open, queued, in_progress or done.'
  }
  // A scan that throws read nothing new, so the unread places of an older pass say nothing about this one.
  const isScanned = await scan($).then(
    () => true,
    () => false,
  )
  const all = findTickets(todoFiles, ref)
  if (all.length === 0) {
    // Not found in what did not read is not "no match": adding the item again would make a duplicate.
    if (!isScanned) {
      return `Not moved: could not read the todo folders, so it is not known whether ${quoteName(ref)} is there. Nothing was changed. Try again later; do not add the item again.`
    }
    if (unreadPlaces.length > 0) {
      return `Not moved: could not read ${unreadPlaces.map(quoteName).join(', ')}, so it is not known whether ${quoteName(ref)} is there. Nothing was changed. Try again later; do not add the item again.`
    }

    return `Not moved: no live todo item matches ${quoteName(ref)}. Add the item to .claude_todo/ first.`
  }
  const where = typeof input.folder === 'string' ? input.folder.trim() : ''
  const hits = where === '' ? all : narrowTickets(all, where)
  if (hits.length === 0) {
    return `Not moved: ${quoteName(ref)} has no match in ${quoteName(where)}. Matches are in: ${[...new Set(all.map(one => quoteName(`${one.rel}/${one.file}`)))].join(', ')}.`
  }
  const places = [...new Set(hits.map(one => quoteName(`${one.rel}/${one.file}`)))]
  if (places.length > 1) {
    return `Not moved: ${quoteName(ref)} matches items in more than one file (${places.join(', ')}). Call move_ticket again with folder set to one of these paths.`
  }
  const found = hits[0]!
  const { file, folder, rel, item } = found
  // The path as the dialog names it, with no control characters, and as the answers to Claude quote it; the file calls use folder and file.
  const path = noteName(`${rel}/${file}`)
  const quoted = quoteName(`${rel}/${file}`)
  if (item.status === to) {
    // A ticket whose box is already open or queued can still show in In progress under the main conversation's claim:
    // moving it there ends that claim, with no write and no question, since the box does not change.
    const todo = todoFiles.find(one => one.folder === folder && one.name === file)
    const claimKey = todo === undefined ? undefined : keptKey(todo, item)
    if ((to === 'pending' || to === 'queued') && claimKey !== undefined && orchTickets.delete(claimKey)) {
      claimMissedAt.delete(claimKey)
      redraw($)

      return `Released: ${quoteTicket(item.text, 80)} was already ${STATUS_WORDS[to]} in the file; the main conversation's claim on it is cleared, so the board shows it ${STATUS_WORDS[to]} again.`
    }

    return `Not moved: ${quoteTicket(item.text, 80)} is already ${STATUS_WORDS[to]}.`
  }
  const key = `${folder}/${file}:${itemKey(item)}`
  const yes = 'Move it'
  // A dialog that could not be shown is no answer: the user has not decided, so it is not read as "kept".
  const asked = await $.ui
    .ask(moveQuestion(path, item, to, reason, userMoves.has(key)), { options: [yes, 'Keep it where it is'], header: 'Ticket' })
    .then(
      (value): { value: string | undefined } => ({ value }),
      () => undefined,
    )
  if (asked === undefined) {
    return `Not moved: the confirmation could not be shown, so the user has not decided about ${quoteTicket(item.text, 80)}. Try again later.`
  }
  const answer = asked.value
  if (answer !== yes) {
    return `Not moved: the user kept ${quoteTicket(item.text, 80)} ${STATUS_WORDS[item.status]}${answer === undefined || answer === 'Keep it where it is' ? '' : ` and said: ${answer}`}. Do not move it again unless the user asks.`
  }
  // The file is read again under the writer lock and only this one box changes in the fresh text.
  const isWritten = await withWriteLock(async () => {
    // Never through a symlink, never outside the checkout or into the global folder.
    if (!(await isTrustedDir($, folder)) || !(await isPlainFile($, `${folder}/${file}`))) {
      return { isUnsafe: true } as const
    }
    const read = await readTodo($, `${folder}/${file}`)
    if (read.kind !== 'ok') {
      return readReason(read)
    }
    // The line the key names must still be the one the board found: a place number moves when a line above it goes,
    // and identical lines in two sections differ by their place (the heading above and the rank under it).
    if (!isDrawnLine(read.text, itemKey(item), { text: item.text, status: item.status, ...placeOfLine(`${folder}/${file}`, itemKey(item)) })) {
      return { isMoved: true } as const
    }
    const next = setBox(read.text, itemKey(item), to)
    if (next === undefined) {
      return false
    }
    // A failed write is an answer, not a tool error. The checks, then the read and compare, then the write.
    try {
      const put = await writeIfUnchanged($, `${folder}/${file}`, read.text, next, { folder })
      if (put.kind === 'changed') {
        return { isMoved: true } as const
      }
      if (put.kind === 'unsafe' || put.kind === 'refused') {
        return { isUnsafe: true } as const
      }
      if (put.kind === 'unread') {
        return put.reason
      }
    } catch (error) {
      return { writeError: error instanceof Error ? error.message : String(error) }
    }

    return true
  })
  if (typeof isWritten === 'object' && 'writeError' in isWritten) {
    return `Not moved: ${quoted} could not be written (${noteName(isWritten.writeError)}). The user approved the move; try again.`
  }
  if (typeof isWritten === 'object' && 'isMoved' in isWritten) {
    return `Not moved: the line of ${quoteTicket(item.text, 80)} in ${quoted} changed since the board read it. Nothing was written; call move_ticket again.`
  }
  if (typeof isWritten === 'object') {
    return `Not moved: ${quoted} is not safe to change (a symlink, or outside this repo). Nothing was written.`
  }
  if (typeof isWritten === 'string') {
    return `Not moved: ${quoted} could not be read (${noteName(isWritten)}). Nothing was changed.`
  }
  if (!isWritten) {
    return `Not moved: the line for ${quoteTicket(item.text, 80)} was not found in ${quoted}.`
  }
  userMoves.delete(key)
  await scan($).catch(() => undefined)
  // A move to queued the main conversation asked for and the user approved plans the ticket; a helper's ask does not.
  if (isMain && to === 'queued') {
    const todo = todoFiles.find(one => one.folder === folder && one.name === file)
    if (todo !== undefined) {
      planTickets($, [ticketId(todo, item)])
    }
  }

  return `Moved with the user's approval: ${quoteTicket(item.text, 80)} is now ${STATUS_WORDS[to]} in ${quoted}.`
}

/** The lists of note lines waiting for Claude, as they are now: what queuedNotes builds from them now. */
function pendingNotes(): PendingNotes {
  return { moves: pendingMoves, renames: pendingRenames, numbered: pendingNumbered, removed: pendingRemoved, ended: pendingEnded, stopped: pendingStopped, deferred: pendingDeferred, claimed: pendingClaimed }
}

/**
 * Takes out of the waiting lists the lines `told` held, once their note reached Claude.
 * A line queued while the prompt or tool call ran stays for the next one.
 */
function forgetTold(told: PendingNotes): void {
  pendingMoves = withoutTold(pendingMoves, told.moves)
  pendingRenames = withoutTold(pendingRenames, told.renames)
  pendingNumbered = withoutTold(pendingNumbered, told.numbered)
  pendingRemoved = withoutTold(pendingRemoved, told.removed)
  pendingEnded = withoutTold(pendingEnded, told.ended)
  pendingStopped = withoutTold(pendingStopped, told.stopped)
  pendingDeferred = withoutTold(pendingDeferred, told.deferred)
  pendingClaimed = withoutTold(pendingClaimed, told.claimed)
}

/** Puts the lines `told` held back in front of the waiting lists: their note never reached Claude. */
function restoreTold(told: PendingNotes): void {
  pendingMoves = [...told.moves, ...pendingMoves]
  pendingRenames = [...told.renames, ...pendingRenames]
  pendingNumbered = [...told.numbered, ...pendingNumbered]
  pendingRemoved = [...told.removed, ...pendingRemoved]
  pendingEnded = [...told.ended, ...pendingEnded]
  pendingStopped = [...told.stopped, ...pendingStopped]
  pendingDeferred = [...told.deferred, ...pendingDeferred]
  pendingClaimed = [...told.claimed, ...pendingClaimed]
}

/** The notes waiting for Claude: the moves made by hand, the IDs a consolidation renumbered, and the agents that ended with tickets left open. */
function queuedNotes(): string[] {
  return [movesNote(pendingMoves), stoppedNote(pendingStopped), deferredNote(pendingDeferred), renameNote(pendingRenames), removedNote(pendingRemoved), numberedNote(pendingNumbered), ...claimNotes(pendingClaimed), ...pendingEnded].filter((note): note is string => note !== undefined)
}

/** Notes about ended agents, waiting for Claude. Cleared with the other pending notes. */
let pendingEnded: string[] = []
/** The agents already nudged, so each is named once. */
const nudgedAgents = new Set<string>()
/** When each in-progress ticket of the orchestrator was last named in a prompt, by item key (per session, in memory). */
const namedAt = new Map<string, number>()

/**
 * Queues one note for each agent that went from live to ended between `before` and `after`, when
 * tickets it worked on are still open or in progress. The links are read as for a live agent, since
 * an ended agent links to nothing. The mod never changes a box itself: Claude closes the work done.
 */
function noteEnds(before: readonly AgentRow[], after: readonly AgentRow[]): void {
  const live = new Set(before.filter(row => !isEnded(row.status)).map(row => row.id))
  after.forEach((row, index) => {
    if (!live.has(row.id) || !isEnded(row.status) || nudgedAgents.has(row.id)) {
      return
    }
    nudgedAgents.add(row.id)
    const found = linkOne(todoFiles, { ...row, status: 'running' })
    if (found.length > 0) {
      const how = row.status === 'completed' ? 'finished' : `ended (${row.status})`
      pendingEnded = [...pendingEnded, endedNote(agentLabel(index), how, found.map(link => link.item))]
    }
  })
}

/**
 * Every toast goes through here, so its text is cleaned once: ticket text, file names and
 * error messages can hold control characters, and a toast with ESC could move a terminal's cursor.
 */
function showToast($: EngineInterface, text: string): void {
  $.ui.toast(toastText(text))
}

/**
 * The catch for a button press whose job threw past its own handling: the user gets the reason in a
 * toast, never silence. A toast that itself fails is dropped, as there is nowhere left to tell.
 */
function toastFailure($: EngineInterface, what: string): (error: unknown) => void {
  return error => {
    try {
      showToast($, `Could not ${what}: ${error instanceof Error ? error.message : String(error)}`)
    } catch {
      // Nowhere left to report.
    }
  }
}

/** Writes a manual move into the item's todo file, rereads the folder, and queues the note for Claude. */
async function markTicket($: EngineInterface, item: ItemView, status: ItemStatus, toast: string): Promise<void> {
  // An archived item never reaches here: the pane gives it no button (removed that check).
  if (item.folder === undefined || item.file === undefined) {
    return
  }
  // Only the file the item came from is written: its folder and its name. The pane shows neither.
  const folder = item.folder
  const path = `${folder}/${item.file}`
  // Read again under the writer lock: the one box changes in the fresh text, never in a stale copy.
  let isWritten: boolean | 'unsafe' | 'moved'
  try {
    isWritten = await withWriteLock(async () => {
      // Never through a symlink, never outside the checkout or into the global folder.
      if (!(await isTrustedDir($, folder)) || !(await isPlainFile($, path))) {
        return 'unsafe' as const
      }
      const text = await readStrict($, path)
      const key = item.localKey ?? item.key
      // The press writes only the line the board drew: the same text and box. A board that is out of
      // date (a line added or removed above identical lines moves their place numbers) is refused, never the neighbor written.
      // Identical lines in two sections differ by their place: the heading above and the rank under it.
      if (!isDrawnLine(text, key, { text: item.text, status: item.heldFrom ?? item.status, ...placeOfLine(path, key) })) {
        return 'moved' as const
      }
      const next = setBox(text, key, status)
      if (next === undefined) {
        return false
      }
      // The checks, then the read and compare as the last call before the write. A read that fails throws, as the first one does.
      const put = await writeIfUnchanged($, path, text, next, { folder })
      if (put.kind === 'unread') {
        throw new TodoReadError(path, put.reason)
      }

      return put.kind === 'written' ? true : put.kind === 'changed' ? ('moved' as const) : ('unsafe' as const)
    })
  } catch (error) {
    showToast($, `Could not move ${ticketSummary(item.text, 60)}: ${error instanceof Error ? error.message : String(error)}`)

    return
  }
  if (isWritten === 'unsafe') {
    showToast($, `Not changed, ${item.file} is not safe to write (a symlink, or outside this repo): ${ticketSummary(item.text, 60)}`)

    return
  }
  if (isWritten === 'moved') {
    showToast($, `Not changed, the line changed in ${item.file} since the board drew it: ${ticketSummary(item.text, 60)}. Press again on the updated board.`)
    await scan($).catch(() => undefined)

    return
  }
  if (!isWritten) {
    showToast($, `Not found in ${item.file}: ${ticketSummary(item.text, 60)}`)

    return
  }
  userMoves.set(`${path}:${item.localKey ?? item.key}`, status)
  pendingMoves = [...pendingMoves, moveLine(item.text, item.path ?? path, STATUS_WORDS[item.heldFrom ?? item.status], STATUS_WORDS[status])]
  showToast($, `${toast}: ${ticketSummary(item.text, 60)}`)
  // The box is written: a scan that fails must not make the press read as failed.
  await scan($).catch(() => undefined)
}

// ---------------------------------------------------------------- queued tickets

/** The tickets the mod queued after Claude took them out of progress, told with the next tool result or prompt. */
let pendingStopped: string[] = []
/** The claim lines waiting for Claude: a planned claim the mod recorded, and a ticket this session claims that a peer claims too. Each is told once. */
let pendingClaimed: string[] = []
/** The open tickets Claude's text put off until later, told with the next tool result or prompt. */
let pendingDeferred: string[] = []
/** The most characters of one model step's text read for deferred tickets: a reply past it is read only to there. */
const SAID_CHARS = 20_000
/** The tickets already named in a deferred note this session, by item key: each is named once. */
const deferredNamed = new Set<string>()

/** The live files that hold the todo file at `path`. */
function filesAt(path: string): TodoFile[] {
  return todoFiles.filter(file => file.isArchived !== true && (path === `${file.folder}/${file.name}` || path.endsWith(`/${filePath(file)}`)))
}

/**
 * Writes `- [>]` for the tickets of the file at `path` whose kept key is in `keys`: the ones the main
 * conversation's edit took from in progress to open (stoppedKeys). Under the writer lock, from a fresh
 * read; a box that changed since is left. Each queued ticket goes in the stopped note for Claude.
 */
async function queueStopped($: EngineInterface, path: string, keys: readonly string[]): Promise<void> {
  const file = filesAt(path)[0]
  if (file === undefined) {
    return
  }
  const wanted = new Set(keys)
  const items = file.items.filter(item => wanted.has(keptKey(file, item)))
  const target = `${file.folder}/${file.name}`
  // Why the queueing could not be written, when it could not: Claude is told, as the ticket stays at the open box its own edit set.
  const failed: { reason?: string } = {}
  const written = await withWriteLock(async () => {
    if (!(await isTrustedDir($, file.folder)) || !(await isPlainFile($, target))) {
      return []
    }
    const text = await readStrict($, target)
    let next = text
    const done: TodoItem[] = []
    for (const item of items) {
      const changed = setBox(next, itemKey(item), 'queued', { text: item.text, status: 'pending' })
      if (changed !== undefined) {
        next = changed
        done.push(item)
      }
    }
    if (done.length === 0) {
      return []
    }
    const put = await writeIfUnchanged($, target, text, next, { folder: file.folder })
    // A box that changed since the read is left as the other writer made it: that is no failure.
    if (put.kind !== 'written' && put.kind !== 'changed') {
      failed.reason = 'reason' in put ? put.reason : 'the write was refused'
    }

    return put.kind === 'written' ? done : []
  }).catch((error: unknown) => {
    failed.reason = error instanceof Error ? error.message : String(error)

    return [] as TodoItem[]
  })
  if (failed.reason !== undefined) {
    const lines = items.map(item => `${quoteTicket(item.text, 160)} in ${quoteName(path)} stayed open: the Claudeopticon pane could not set it to queued (${failed.reason}). If it is next work, set its box to \`- [>]\` yourself.`)
    pendingClaimed = [...pendingClaimed, ...lines]
  }
  if (written.length > 0) {
    pendingStopped = [...pendingStopped, ...written.map(item => moveLine(item.text, path, STATUS_WORDS.in_progress, STATUS_WORDS.queued))]
    await scan($).catch(() => undefined)
    // The main conversation took these out of progress and still means to work them: planned. After the scan, so a prune never sees the old box.
    planTickets($, written.map(item => ticketId(file, item)))
  }
}

/** Queues a deferred note for each open ticket that `text`, the main conversation's reply, puts off until later; each ticket once a session. */
function noteDeferred(text: string): void {
  const ids = new Set(deferredIds(text))
  if (ids.size === 0) {
    return
  }
  for (const file of todoFiles.filter(one => one.isArchived !== true)) {
    for (const item of file.items) {
      const key = keptKey(file, item)
      if (item.status === 'pending' && item.id !== undefined && ids.has(item.id.toUpperCase()) && !deferredNamed.has(key)) {
        deferredNamed.add(key)
        pendingDeferred = [...pendingDeferred, `- ${quoteTicket(item.text, 160)} in ${quoteName(filePath(file))}`]
      }
    }
  }
}

// ---------------------------------------------------------------- orchestrator tickets

/** The live tickets of the todo files: item key to status. With `path`, only the file at that path (else all, when none matches). */
function ticketStatuses(path?: string): Map<string, ItemStatus> {
  const files = todoFiles.filter(file => file.isArchived !== true)
  const same = path === undefined ? [] : files.filter(file => path === `${file.folder}/${file.name}` || path.endsWith(`/${filePath(file)}`))
  const statuses = new Map<string, ItemStatus>()
  for (const file of same.length > 0 ? same : files) {
    for (const item of file.items) {
      const key = keptKey(file, item)
      // One key in two files: in progress wins over queued over open over done.
      const rank = (status?: ItemStatus) => (status === 'in_progress' ? 3 : status === 'queued' ? 2 : status === 'pending' ? 1 : 0)
      if (rank(item.status) >= rank(statuses.get(key))) {
        statuses.set(key, item.status)
      }
    }
  }

  return statuses
}

/** Marks tickets as the orchestrator's own; a new claim is stored and drawn at once. */
function claimTickets($: EngineInterface, keys: readonly string[]): void {
  const statuses = ticketStatuses()
  // Stored keys only: a claim on a later identical line is a claim on their shared key.
  const fresh = [...new Set(keys.map(storedKey))].filter(key => !orchTickets.has(key))
  for (const key of fresh) {
    orchTickets.set(key, statuses.get(key) === 'in_progress')
  }
  if (fresh.length > 0) {
    redraw($)
  }
}

/** When each claimed ticket was first not found, clock ms: the start of the bound on its claim. In memory only, so a reload starts each bound again. */
const claimMissedAt = new Map<string, number>()

/**
 * Ends the claims on tickets that are done or gone, and on tickets back to open after they were
 * seen in progress. A ticket sent to Claude is open until Claude starts it, so an open ticket never
 * seen in progress stays claimed. While no todo file is known, each claim ends MISSING_CLAIM_MS after
 * it was first found missing.
 */
function pruneTickets(): boolean {
  for (const key of [...claimMissedAt.keys()]) {
    if (!orchTickets.has(key)) {
      claimMissedAt.delete(key)
    }
  }
  const time = nowSync()
  let isChanged = false
  if (todoFiles.length === 0) {
    // No todo file is known: nothing says a claim's ticket is gone, so the claims stay, but only for MISSING_CLAIM_MS.
    // A claim restored before the first scan waits the same bound, so a reload does not end it at once.
    for (const key of orchTickets.keys()) {
      // A clock set back restarts the bound from now.
      const missed = elapsedSince(claimMissedAt.get(key) ?? time, time)
      claimMissedAt.set(key, missed.from)
      if (missed.ms >= MISSING_CLAIM_MS) {
        orchTickets.delete(key)
        claimMissedAt.delete(key)
        isChanged = true
      }
    }
    if (orchTickets.size === 0 && orchTitle !== undefined) {
      orchTitle = undefined
      isChanged = true
    }

    return isChanged
  }
  const statuses = ticketStatuses()
  for (const [key, seen] of orchTickets) {
    const status = statuses.get(key)
    // A ticket not found while a folder that could hold it did not read may be in it: its claim stays, for at most MISSING_CLAIM_MS.
    // A first miss in the future (a clock set back) counts as missed now.
    const missedAt = status === undefined ? Math.min(claimMissedAt.get(key) ?? time, time) : undefined
    if (missedAt === undefined) {
      claimMissedAt.delete(key)
    } else {
      claimMissedAt.set(key, missedAt)
    }
    if ((missedAt !== undefined && !keepsMissing(key, unreadFolders, scanFolders, missedAt, time)) || status === 'completed' || ((status === 'pending' || status === 'queued') && seen)) {
      orchTickets.delete(key)
      claimMissedAt.delete(key)
      isChanged = true
    } else if (status === 'in_progress' && !seen) {
      orchTickets.set(key, true)
      isChanged = true
    }
  }
  // A headline belongs to the tickets: with none left, it goes.
  if (orchTickets.size === 0 && orchTitle !== undefined) {
    orchTitle = undefined
    isChanged = true
  }

  return isChanged
}

/**
 * One line naming the orchestrator's tickets that are still in progress at the start of a prompt,
 * at most NUDGE_TICKETS, none named in the last NUDGE_REPEAT_MS. Undefined when there is none.
 */
async function stillOpenLine($: EngineInterface): Promise<string | undefined> {
  const time = await $.clock.now()
  const due: { key: string; item: TodoItem }[] = []
  for (const file of todoFiles.filter(one => one.isArchived !== true)) {
    for (const item of file.items) {
      const key = keptKey(file, item)
      const last = namedAt.get(key)
      // Timed with elapsedSince: a clock set back restarts the wait from now, so the note comes again NUDGE_REPEAT_MS later, not after the set-back plus that.
      const since = last === undefined ? undefined : elapsedSince(last, time)
      if (since !== undefined && since.from !== last) {
        namedAt.set(key, since.from)
      }
      if (orchTickets.has(key) && item.status === 'in_progress' && (since === undefined || since.ms >= NUDGE_REPEAT_MS) && !due.some(one => one.key === key)) {
        due.push({ key, item })
      }
    }
  }
  const named = due.slice(0, NUDGE_TICKETS)
  for (const one of named) {
    namedAt.set(one.key, time)
  }

  return stillOpenNote(named.map(one => one.item))
}

/** The orchestrator as the view draws it: Running between the prompt and the end of a main-conversation turn. */
function orchestratorState(): OrchestratorState {
  const last = orchestrator.history[orchestrator.history.length - 1]

  return { keys: new Set(orchTickets.keys()), isRunning: orchestrator.isActive, toolCalls: callCount, ...(last === undefined ? {} : { doing: last.line }), ...(orchTitle === undefined ? {} : { title: orchTitle }) }
}

// ---------------------------------------------------------------- peer sessions

/** Ends the planned claims whose box is no longer `[~]` or `[>]`; true when the set changed. Only once the plan set is loaded and a todo file is known. */
function prunePlannedTickets(): boolean {
  if (plannedTickets.size === 0 || todoFiles.length === 0 || !loadedGroups.has('tickets')) {
    return false
  }
  const kept = prunePlanned(plannedTickets, todoFiles)
  if (kept.size === plannedTickets.size) {
    return false
  }
  plannedTickets = kept

  return true
}

/** The todo item a ticket identity names, in the live files. */
function itemOfTicket(id: string): TodoItem | undefined {
  for (const file of todoFiles.filter(one => one.isArchived !== true)) {
    const item = file.items.find(one => ticketId(file, one) === id)
    if (item !== undefined) {
      return item
    }
  }

  return undefined
}

/**
 * Ends this session's claims, orchestrator and planned, on the tickets `refs` name (IDs or quoted text, matched as `items` are): report_progress `release`.
 * Nothing claims them again until a new move to queued or a new claim. True when a claim ended.
 */
function releaseTickets(refs: readonly string[]): boolean {
  const live = todoFiles.filter(file => file.isArchived !== true)
  const open = live.flatMap(file => file.items.map(item => ({ key: keptKey(file, item), item, id: ticketId(file, item) })))
  let isChanged = false
  for (const hit of bestMatches(open, refs)) {
    const one = open.find(entry => entry.key === hit.key)
    const key = storedKey(hit.key)
    if (orchTickets.delete(key)) {
      claimMissedAt.delete(key)
      isChanged = true
    }
    if (one !== undefined && plannedTickets.has(one.id)) {
      plannedTickets = new Set([...plannedTickets].filter(id => id !== one.id))
      isChanged = true
    }
  }
  if (orchTickets.size === 0 && orchTitle !== undefined) {
    orchTitle = undefined
  }

  return isChanged
}

/** The ticket IDs of the kept keys in the file at `path`. */
function plannedIdsOf(path: string, keys: readonly string[]): string[] {
  const wanted = new Set(keys)
  const file = filesAt(path)[0]

  return file === undefined ? [] : file.items.filter(item => wanted.has(keptKey(file, item))).map(item => ticketId(file, item))
}

/** Records tickets the main conversation queued as planned, by kept key (an edit) or by item (the mod's own queueing); a new one redraws and is saved. */
function planTickets($: EngineInterface, ids: readonly string[]): void {
  const fresh = ids.filter(id => !plannedTickets.has(id))
  if (fresh.length > 0) {
    plannedTickets = new Set([...plannedTickets, ...fresh])
    // A strong hint, not proof: the session may be triaging for others, so Claude is told how to release.
    for (const id of fresh) {
      const item = itemOfTicket(id)
      if (item !== undefined) {
        pendingClaimed = [...pendingClaimed, plannedLine(item.text, item.id)]
      }
    }
    redraw($)
  }
}

/** This session's name as Claude last reported it (report_progress `session`), kept in its presence record. */
let sessionName: string | undefined
/** The tickets live peer sessions on this repo claim, by ticketId, to the holder's name and last-seen time. */
let peerHeld: ReadonlyMap<string, PeerClaim> = new Map()
/** The last presence record stored, and when it was stored (clock ms). */
let lastPresence: Presence | undefined
let presenceAt: number | undefined
let peersAt: number | undefined
/** When the last presence write failed: the retry waits PRESENCE_EVERY_MS from it. */
let presenceFailedAt: number | undefined
let isPeerBusy = false
/** What the last drawn peer claims looked like (names, tickets, silent state), so the next read redraws on a change of any of them. */
let peerShape = '[]'
/** Whether the note that asks Claude for this session's name was queued in this load of the mod. */
let isNameAsked = false
/** The tickets this session claims that a peer claims too, already told to Claude: told again only after the peer's claim ended. */
const peerNoted = new Set<string>()
/** Whether this load has looked in the store for the name an earlier load of this session stored. */
let isNameRead = false

/**
 * The repo root that tells which sessions share the board: the main checkout's, so the worktrees of one
 * repo match; outside git, the primary todo folder's real path, as the reservations do. Undefined when no folder is known.
 */
function presenceRoot(): string | undefined {
  const primary = todoFolders?.find(one => !one.isOther)
  const root = centralRoot ?? repoRoot ?? primary?.real ?? primary?.path

  // A relative root would match sessions of other folders: no presence without an absolute one.
  return root !== undefined && /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(root) ? root : undefined
}

/**
 * One step of the presence work, run by every tick and guarded against overlap: stores this session's
 * record when its holdings or name changed, or PRESENCE_EVERY_MS after the last store; reads the
 * peers' records every PEERS_EVERY_MS and redraws when the tickets they hold changed. The store has
 * no key listing, so the peers are those in the session list (`sessions-recent`); a session leaves
 * no end event the mod can see, so a dead session's record just goes stale (PEER_IGNORE_MS).
 */
async function peerStep($: EngineInterface, now: number): Promise<void> {
  const root = presenceRoot()
  if (isPeerBusy || root === undefined || !loadedGroups.has('tickets')) {
    return
  }
  isPeerBusy = true
  try {
    const me = await sessionOf($)
    if (!isNameRead) {
      // A reload of the mod keeps the name an earlier load of this session stored.
      const got = await tryGet($, presenceKey(me))
      if (got.ok) {
        isNameRead = true
        sessionName ??= readPresence(got.value)?.name
      }
    }
    const held = holdings(todoFiles, agentRows, new Set(orchTickets.keys()), plannedTickets)
    const next = buildPresence(me, sessionName, root, held, now)
    // Each wait is timed with waitOver: after a clock set back it starts over from the new time and is not held until the old one.
    const written = waitOver(presenceAt, now, PRESENCE_EVERY_MS)
    presenceAt = written.from
    const retry = waitOver(presenceFailedAt, now, PRESENCE_EVERY_MS)
    presenceFailedAt = retry.from
    // Not written while the stored name was not read and none is known: the record would carry no name and replace the stored one.
    // After a failed write the retry waits PRESENCE_EVERY_MS, not one tick.
    if ((isNameRead || sessionName !== undefined) && (!samePresence(lastPresence, next) || written.isOver) && retry.isOver) {
      presenceAt = now
      await storeSet($, presenceKey(me), next).then(
        () => {
          lastPresence = next
          presenceFailedAt = undefined
        },
        () => {
          presenceFailedAt = now
        },
      )
    }
    const read = waitOver(peersAt, now, PEERS_EVERY_MS)
    peersAt = read.from
    if (!read.isOver) {
      return
    }
    peersAt = now
    const list = await tryGet($, 'sessions-recent')
    if (!list.ok) {
      return
    }
    const records = (await Promise.all(peerIds(list.value, me).map(async id => ({ id, got: await tryGet($, presenceKey(id)) })))).flatMap(one => (one.got.ok ? [{ id: one.id, value: one.got.value }] : []))
    const own = new Set([...held.tickets, ...held.agentTickets, ...held.planned])
    const found = peerHolds(records, me, root, now, own)
    // A ticket this session claims that a peer claims too: told once per peer claim.
    const both = peerHolds(records, me, root, now, new Set())
    for (const id of own) {
      const claim = both.get(id)
      if (claim !== undefined && !peerNoted.has(id)) {
        peerNoted.add(id)
        const item = itemOfTicket(id)
        if (item !== undefined) {
          pendingClaimed = [...pendingClaimed, peerClaimedLine(item.text, item.id, claim.name, root)]
        }
      }
    }
    // A session with no name (one that started before the rule existed) that holds a ticket or has a peer on its root is asked for it, once per load.
    if (!isNameAsked && isNameRead && sessionName === undefined && (own.size > 0 || records.some(one => readPresence(one.value)?.root === root))) {
      isNameAsked = true
      pendingClaimed = [...pendingClaimed, SESSION_NAME_NOTE]
    }
    for (const id of [...peerNoted]) {
      if (!both.has(id)) {
        peerNoted.delete(id)
      }
    }
    // Compared without seenAt, which moves at each refresh: a redraw is due when the claims, the names or the silent state change.
    const shape = (claims: ReadonlyMap<string, PeerClaim>) => JSON.stringify([...claims].map(([ticket, claim]) => [ticket, claim.name, claim.isPlanned === true, now - claim.seenAt > PEER_DIM_MS ? claim.seenAt : 0]))
    // Kept at every read, so each draw judges silence by the latest seenAt; a copy kept only on a change held the
    // first seenAt, and every peer read as silent 2 minutes later.
    peerHeld = found
    const nextShape = shape(found)
    if (nextShape !== peerShape) {
      peerShape = nextShape
      // The view's time moves up with this change: the silent state is worked out against it.
      clockMs = Math.max(clockMs, now)
      redraw($)
    }
  } finally {
    isPeerBusy = false
  }
}

/** A history entry for a main-conversation call: its summary, time and native detail. */
async function orchestratorEntry($: EngineInterface, input: Record<string, unknown> & { tool: string }): Promise<OrchestratorEntry> {
  const line = callSummary(input.tool, input)
  const detail = callDetail(input.tool, input, line, repoRoot)

  return { id: (callCount += 1), line, at: await $.clock.now(), isRunning: true, ...(detail === undefined ? {} : { detail }) }
}

// ---------------------------------------------------------------- loop

let ticker: Timer | undefined
let ticks = 0

/** The session's token burn, kept in the store under its session ID, so a reload keeps the count. */
let isBurnLoaded = false

async function burnKey($: EngineInterface): Promise<string> {
  return `tokens:${await $.session.id()}`
}

let burnLoading: Promise<void> | undefined

/**
 * Loads the count once per load of the mod; the count starts the first time the mod sees the
 * session. Every caller awaits the same promise. `isBurnLoaded` turns true only after the read
 * worked; a failed read leaves it false, so the next caller tries again and nothing is stored in
 * the meantime. What was counted before the read worked is added to the stored count.
 */
function readUsage($: EngineInterface): Promise<void> {
  if (isBurnLoaded) {
    return Promise.resolve()
  }
  burnLoading ??= (async () => {
    const got = await tryGet($, await burnKey($))
    if (!got.ok) {
      throw new Error('store read failed')
    }
    const stored = readKeptUsage(got.value)
    if (stored !== undefined) {
      const early = usage
      usage = {
        tokens: stored.tokens + (early?.tokens ?? 0),
        since: stored.since,
        ...(early?.atCompact !== undefined
          ? { atCompact: stored.tokens + early.atCompact, ...(early.compactAt === undefined ? {} : { compactAt: early.compactAt }) }
          : stored.atCompact === undefined
            ? {}
            : { atCompact: stored.atCompact, ...(stored.compactAt === undefined ? {} : { compactAt: stored.compactAt }) }),
      }
    }
    isBurnLoaded = true
    seedTrace()
    if (stored !== undefined) {
      redraw($)
    }
  })().finally(() => {
    burnLoading = undefined
  })

  return burnLoading
}

/**
 * After both the kept count and the kept series are loaded: a series with no token point, or one
 * that lags the kept count (seedSeries), is brought to the kept count, so the trace ends at the
 * value the mod holds (and the compaction is marked when it is inside the window) from the first
 * draw, not from the next model request.
 */
function seedTrace(): void {
  if (loadedGroups.has('series') && isBurnLoaded) {
    series = seedSeries(series, usage, nowSync())
  }
}

/**
 * Adds the tokens of one model request (turn.step, main loop and agents alike: the one source of
 * the total and both token traces), or records a compaction.
 */
async function addBurn($: EngineInterface, used: number, isCompact = false): Promise<void> {
  // The clock first: the load below bounds the kept series by it.
  const time = await $.clock.now()
  wallMs = time
  await readUsage($).catch(() => undefined)
  await loadAgents($).catch(() => undefined)
  const base = usage ?? { tokens: 0, since: time }
  // A count that is not a finite number adds nothing: a NaN would stay in the total and be lost at reload.
  const add = Number.isFinite(used) && used > 0 ? used : 0
  usage = isCompact ? { ...base, atCompact: base.tokens, compactAt: time } : { ...base, tokens: base.tokens + add }
  // The plot: the count since the last compaction, a point per request (coalesced per QUANT_MS step); a compaction is a marker and a fall to zero.
  // Series-level: the compactions and seeds are re-timed with the token points.
  series = isCompact ? addCompact(series, time) : addTokens(series, time, usage.tokens - (usage.atCompact ?? 0), add)
  // Not stored while the stored count is unread: the next report, after a read that worked, adds this one to it.
  if (isBurnLoaded) {
    await storeSet($, await burnKey($), usage).catch(() => undefined)
  }
  // Redraw at most every CLOCK_MS; the tick draws a report that came sooner. Timed with elapsedSince: a clock set back never stops the redraws for its length.
  const sinceDraw = elapsedSince(lastBurnDraw, time)
  lastBurnDraw = sinceDraw.from
  if (isCompact || sinceDraw.ms >= CLOCK_MS) {
    lastBurnDraw = time
    isBurnDirty = false
    redraw($)
  } else {
    isBurnDirty = true
  }
}

/**
 * Runs `work` (a count or a refresh) and waits for it unless the store is stalled: while
 * the store answers, the hook returns with its result drawn and stored, as before; once a store key
 * has gone unanswered for STORE_LIMIT_MS, hooks stop waiting on store work until that key answers
 * again (`stalledKeys`). The call that finds the stall waits for its time limit once; no hook waits for good.
 */
async function unlessStoreWaits(work: Promise<unknown>): Promise<void> {
  const settled = work.then(
    () => undefined,
    () => undefined,
  )
  if (stalledKeys.size === 0) {
    await settled
  }
}

/** The last count queued by burnInOrder; settles when every count before it is added. */
let burnChain: Promise<void> = Promise.resolve()

/**
 * Adds one count after every count queued before it: the hooks no longer wait on the
 * count, so two steps that end close together would otherwise add in the order their store reads
 * answer, and a compaction could land between the wrong steps. Each count is bounded by the store
 * time limit, so one store call that never answers holds the chain for a few STORE_LIMIT_MS, never for good.
 */
function burnInOrder($: EngineInterface, used: number, isCompact = false): Promise<void> {
  const run = burnChain.then(() => addBurn($, used, isCompact)).catch(() => undefined)
  burnChain = run

  return run
}

/**
 * Once a minute, rebuilds what the pane shows from the source: every todo and archive file reread
 * whatever its mtime, `categories.json` reloaded, the agent list asked again, and a redraw. It
 * catches what the quick checks can miss: an edit that kept a file's mtime, a categories file
 * changed by hand, an agent whose status changed while none was live.
 */
async function resync($: EngineInterface): Promise<void> {
  await scan($, true)
  lastClock = 0
  await refreshAgents($)
  redraw($)
}

function start($: EngineInterface): void {
  if (ticker !== undefined) {
    return
  }
  ticker = $.clock.every(TICK_MS, () => {
    ticks += 1
    void (async () => {
      const now = await $.clock.now()
      wallMs = now
      if (recatNote !== undefined && isDeadlinePast(recatNote.until, now, NOTE_MS)) {
        recatNote = undefined
        redraw($)
      }
      // The spaces of tickets that left go after SPACE_MS; a token report that came within CLOCK_MS of the last draw is drawn; the top card scrolls its time axis.
      if (expireSpaces(layout, now)) {
        redraw($)
      }
      // Both throttles timed with elapsedSince: after a clock set back, the redraws go on.
      const sinceBurn = elapsedSince(lastBurnDraw, now)
      lastBurnDraw = sinceBurn.from
      if (isBurnDirty && sinceBurn.ms >= CLOCK_MS) {
        isBurnDirty = false
        lastBurnDraw = now
        redraw($)
      }
      const sinceIdle = elapsedSince(lastIdleDraw, now)
      lastIdleDraw = sinceIdle.from
      if (sinceIdle.ms >= IDLE_DRAW_MS) {
        lastIdleDraw = now
        clockMs = Math.max(clockMs, now)
        redraw($)
      }
      void peerStep($, now).catch(() => undefined)
      if (ticks % RESYNC_EVERY === 0) {
        await resync($)

        return
      }
      // A live agent keeps the agent list checked.
      if (pendingTools.size > 0 || agentRows.some(row => !isEnded(row.status))) {
        await refreshAgents($)
      }
      if (ticks % SCAN_EVERY === 0) {
        await scan($)
      }
    })().then(
      () => {
        tickFailures = 0
        isTickToastShown = false
      },
      (error: unknown) => noteTickFailure($, error),
    )
  })
}

/** The ticks in a row whose work threw: a board that cannot refresh says so once. */
let tickFailures = 0
const TICK_FAILS_TO_TOAST = 3
let isTickToastShown = false

/** Counts a tick that threw and, at TICK_FAILS_TO_TOAST in a row, says why once (shown again only after a tick works): the ticker goes on, and the board would otherwise go stale with no word. */
function noteTickFailure($: EngineInterface, error: unknown): void {
  tickFailures += 1
  if (tickFailures >= TICK_FAILS_TO_TOAST && !isTickToastShown) {
    isTickToastShown = true
    try {
      showToast($, `The board could not refresh ${tickFailures} times in a row (${error instanceof Error ? error.message : String(error)}). It is tried again every second.`)
    } catch {
      // A toast that fails has nowhere left to tell.
    }
  }
}

/** Header rows for the empty top-level todo files, so a file Consolidate emptied stays in view until Delete empty todos removes it. */
function emptyRows(): FileView[] {
  return emptyFiles
    .filter(file => !file.name.startsWith('archive/'))
    .map(file => ({ name: file.name, id: `empty:${file.path}`, place: folderPlace(file.rel ?? file.folder), done: 0, active: 0, total: 0, owners: [], items: [], mtimeMs: 0, isEmpty: true }))
}

/** How many todo files the board pulls from: the top-level files with items, in every folder on the board; archives are not counted. */
function todoCount(): number {
  return todoFiles.filter(file => file.isArchived !== true).length
}

/** The dim text after the Todo heading: the counts, then the number of files they come from. */
function todoDetail(view: View): string {
  const files = todoCount()
  // A file the scan could not read is said so; it is never shown as a file with no items.
  const unread = unreadPlaces.length === 0 ? '' : `Could not read ${unreadPlaces.length} todo ${unreadPlaces.length === 1 ? 'file' : 'files'}`
  const counts = view.total === 0 ? (unread === '' ? 'No checkbox items in .claude_todo/' : '') : `${view.done} of ${view.total} done, ${view.active} in progress`
  const pulling = files === 0 ? '' : `Pulling todo from ${files} ${files === 1 ? 'file' : 'files'}`

  return [counts, pulling, unread].filter(part => part !== '').join('. ')
}

/** The heading's buttons for many folders: Consolidate todos when the tickets are in more than one place or a copied file was not emptied, Delete empty todos and Delete duplicate tickets while they have work. */
function todoActions($: EngineInterface): { key: string; label: string; onPress: () => void }[] {
  return [
    ...(canDeleteDupTickets() ? [{ key: 'todo-delete-dup-tickets', label: 'Delete duplicate tickets', onPress: () => void deleteDupTickets($).catch(toastFailure($, 'delete duplicate tickets')) }] : []),
    ...(canDeleteEmpty() ? [{ key: 'todo-delete-empty', label: 'Delete empty todos', onPress: () => void deleteEmpty($).catch(toastFailure($, 'delete empty todos')) }] : []),
    ...(canConsolidate() ? [{ key: 'todo-consolidate', label: 'Consolidate todos', onPress: () => void consolidate($).catch(toastFailure($, 'consolidate todos')) }] : []),
  ]
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  // Give Claude the todo rules, unless the user turned them off in the mod's options.
  on('prompt.context', async ($, e, next) => {
    return withRules(await next(e), options.rules !== false)
  })

  on('session.start', async ($, e, next) => {
    // Read at each load, so a reload shows the revision that runs; a manifest that cannot be read shows none.
    void readPluginVersion($).then(version => {
      pluginVersion = version
      redraw($)
    })
    await $.command.register({
      name: 'claudeopticon',
      description: 'Show the project todo and the running agents in one pane',
    })
    $.ui.status(undefined)
    await $.tool
      .register({
        name: 'report_progress',
        // Only an agent's done, total and step are drawn: the orchestrator card has no progress bar, so the main conversation's are not used, and the description says so.
        description: "Report your progress to the user: steps done of steps planned, and the current step. Only a helper agent's steps are drawn, on its card; from the main conversation, only title and items are used.",
        inputSchema: {
          type: 'object',
          properties: {
            done: { type: 'integer', description: 'Steps finished' },
            total: { type: 'integer', description: 'Steps planned' },
            step: { type: 'string', description: 'The current step, in a few words' },
            items: {
              type: 'array',
              items: { type: 'string' },
              description: "The .claude_todo items your task covers: each quoted from its line, or its #T ID",
            },
            title: { type: 'string', description: 'A short headline for the whole assignment you work on yourself (main conversation only), a few words' },
            release: { type: 'array', items: { type: 'string' }, description: "Main conversation only: tickets to give up, each quoted from its line or its #T ID. Drops this session's claims on them, planned and own. Use it for a ticket you queued for another session or only to order the work, or that another session asked you for and you agree" },
            session: { type: 'string', description: 'Main conversation only, once: your session name, as ListAgents shows it after "This session is", without the bracketed ref. Other sessions on the repo show it as the owner of your tickets' },
          },
          required: ['done', 'total'],
        },
        isDeferred: false,
      })
      // The rules still tell Claude to call it, so a failure is told, never silent.
      .catch(toastFailure($, 'register the report_progress tool'))
    await $.tool
      .register({
        name: 'move_ticket',
        description:
          "Ask the user to approve moving a .claude_todo item to another column of the Claudeopticon pane board: open, queued (slated next), in_progress or done. The user sees a dialog; the box is written only if they approve. Use it for any item the user moved by hand, instead of editing its box.",
        inputSchema: {
          type: 'object',
          properties: {
            item: { type: 'string', description: "The item's #T ID, or its text quoted from its line" },
            folder: { type: 'string', description: "Only when the item ID or text is in more than one file: the item's folder path as the prompts give it (mods/x/.claude_todo), or its file path (mods/x/.claude_todo/TODO.md)" },
            to: { type: 'string', enum: ['open', 'queued', 'in_progress', 'done'], description: 'Where to move it' },
            reason: { type: 'string', description: 'Why, in one or two sentences, shown to the user' },
          },
          required: ['item', 'to', 'reason'],
        },
        isDeferred: false,
      })
      .catch(toastFailure($, 'register the move_ticket tool'))
    await pruneSessions($).catch(() => undefined)
    // A scan that fails is told: the board would otherwise stay empty with no word why.
    await scan($).catch(toastFailure($, 'read the todo files'))
    await refreshAgents($).catch(() => undefined)
    await readUsage($).catch(() => undefined)
    start($)
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'claudeopticon' }, async $ => {
    await scan($).catch(() => undefined)
    start($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Claudeopticon pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e.prompt.includes(PROGRESS_TOOL) ? e : { ...e, prompt: `${e.prompt}${PROGRESS_NOTE}` })
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
        const known = agentRows.find(one => one.id === id)
        const placed = known === undefined ? row : respawnedRow(known, row)
        setRows(known === undefined ? [...agentRows, row] : agentRows.map(one => (one.id === id ? placed : one)))
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
  })

  on('tool.call', { tool: PROGRESS_TOOL }, async ($, e) => {
    const id = e.agentId
    const input = e as unknown as Record<string, unknown>
    const progress = readProgress(input)
    const claims = readClaims(input)
    const title = id === undefined ? hideTitle(readTitle(input.title)) : undefined
    // The main conversation names its session; the last name wins, and the next presence step stores it.
    const named = id === undefined ? sanitizeSessionName(input.session) : undefined
    if (named !== undefined) {
      sessionName = named
    }
    if (id !== undefined && (progress !== undefined || claims !== undefined)) {
      setRows(agentRows.map(row => (row.id !== id ? row : { ...row, ...(progress === undefined ? {} : { progress }), ...(claims === undefined ? {} : { claims }) })))
      redraw($)
    }
    // The main conversation gives up claims it holds: tickets it queued for another session, or only to order the work.
    const released = id === undefined ? readClaims({ items: input.release }) : undefined
    if (released !== undefined) {
      await scan($).catch(() => undefined)
      if (releaseTickets(released)) {
        redraw($)
      }
    }
    if (id === undefined && claims !== undefined) {
      // The main conversation names tickets: they are its own. A helper's claim never is.
      await scan($).catch(() => undefined)
      const open = [...todoFiles.filter(file => file.isArchived !== true).flatMap(file => file.items.map(item => ({ key: keptKey(file, item), item })))].filter(one => one.item.status !== 'completed')
      claimTickets($, bestMatches(open, claims).map(one => one.key))
    }
    // Only the main conversation titles its own assignment; a helper's title is ignored. It is
    // kept only while the orchestrator owns a ticket.
    if (title !== undefined && orchTickets.size > 0 && title !== orchTitle) {
      orchTitle = title
      redraw($)
    }
    let reply = 'Noted.'
    if (id !== undefined) {
      const time = await $.clock.now()
      // Timed with elapsedSince: a clock set back restarts the wait, it never stops the check for its length.
      const checked = claimCheckedAt.get(id)
      const since = checked === undefined ? undefined : elapsedSince(checked, time)
      const isDue = claims === undefined && since !== undefined && since.ms >= CLAIM_CHECK_MS
      claimCheckedAt.set(id, claims !== undefined || since === undefined || isDue ? time : since.from)
      reply = progressReply(agentRows.find(row => row.id === id)?.claims, isDue)
    }

    return { result: reply }
  })

  on('tool.call', { tool: MOVE_TOOL }, async ($, e) => {
    const text = await moveTicket($, e as unknown as Record<string, unknown>, e.agentId === undefined)

    // Every answer quotes ticket text or a name from a todo folder: it ends with the data mark.
    return { result: `${text} ${DATA_MARK}` }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined && e.tool !== PROGRESS_TOOL) {
      const input = e as unknown as Record<string, unknown>
      const described = describeCall(e.tool, input)
      // The whole command is checked, not only the first line the pane shows; the stored row never holds a secret.
      const command = typeof input.command === 'string' ? input.command : ''
      const doing = hideSecrets(command) === HIDDEN || hideSecrets(described) === HIDDEN ? `${e.tool}: ${HIDDEN}` : described
      pendingTools.set(id, { calls: (pendingTools.get(id)?.calls ?? 0) + 1, doing })
      wake(id)
    }
    const entry: OrchestratorEntry | undefined = id === undefined && e.tool !== 'Agent' ? await orchestratorEntry($, e as unknown as Record<string, unknown> & { tool: string }) : undefined
    if (entry !== undefined) {
      orchestrator = { isActive: true, history: [...orchestrator.history, entry].slice(-ORCHESTRATOR_KEPT) }
      redraw($)
    }
    const path = (e as { file_path?: unknown }).file_path
    // What the main conversation's edit of a todo file starts: the tickets it sets in progress.
    // Read from a scan made just now, not from a board up to 3 s old: a ticket a helper set
    // in progress since the last scan is in progress before this edit, so the edit does not claim it.
    const isOwnTodoEdit = id === undefined && typeof path === 'string' && path.includes(DIR)
    if (isOwnTodoEdit) {
      await scan($).catch(() => undefined)
    }
    const before = isOwnTodoEdit ? ticketStatuses(path) : undefined
    const ran = await next(e).finally(() => {
      if (entry !== undefined) {
        entry.isRunning = false
        redraw($)
      }
    })
    if (typeof path === 'string' && path.includes(DIR)) {
      await scan($).catch(() => undefined)
      if (before !== undefined) {
        const after = ticketStatuses(path)
        claimTickets($, [...after].filter(([key, status]) => status === 'in_progress' && before.get(key) !== 'in_progress').map(([key]) => key))
        // Work Claude stopped but did not finish is next work: the box goes to queued, not open.
        // The tickets this edit queued itself are planned; the mod's own queueing below adds the ones it queues.
        planTickets($, plannedIdsOf(path, newlyQueued(before, after)))
        const stopped = stoppedKeys(before, after)
        if (stopped.length > 0) {
          await queueStopped($, path, stopped)
        }
      }
    }
    // Moves made by hand reach the main conversation with its next tool result, mid-turn.
    if (id === undefined) {
      await loadToldNotes($)
    }
    const told = pendingNotes()
    const queued = id === undefined ? queuedNotes() : []
    if (queued.length === 0 || ran.deny !== undefined) {
      return ran
    }
    forgetTold(told)
    await saveToldNotes($)

    return { ...ran, context: [...(ran.context ?? []), ...queued] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification') {
      const ended = notifiedEnd(e.text)
      if (ended !== undefined) {
        // A background agent's notification carries its task ID, which is its agent ID: its row
        // takes the status it reports, also over an `ended` row.
        if (agentRows.some(row => row.id === ended.id && (row.status === 'ended' || !isEnded(row.status)))) {
          const old = agentRows
          setRows(agentRows.map(row => (row.id === ended.id ? { ...row, status: ended.status, endedAt: row.endedAt ?? clockMs } : row)))
          endedHere.add(ended.id)
          noteEnds(old, agentRows)
          redraw($)
        }
      }
    }
    // Moves not yet told with a tool result ride on the next prompt, a ticket button's own included.
    // They leave the waiting lists while the prompt is in flight, so a tool result of its turn does not
    // tell them twice, and go back when the prompt is dropped beneath the mod or fails.
    await loadToldNotes($)
    const told = pendingNotes()
    const moves = queuedNotes()
    forgetTold(told)
    // Local state: the prompt's own result, set inside the try so a failure on any await puts the notes back.
    let ran: Awaited<ReturnType<typeof next>>
    // The pane says "Working" only for a prompt that runs: a throw or a drop below this handler puts it back.
    const wasActive = orchestrator.isActive
    try {
      const isLabeled = hasLabel(e.text)
      if (isLabeled) {
        await refreshAgents($).catch(() => undefined)
      }
      // The next free IDs, recomputed each prompt; not for a notification the mod's host sends by itself.
      let idLine: string | undefined
      if (options.rules !== false && e.origin?.kind !== 'task-notification' && (todoFolders ?? []).length > 0) {
        idLine = await offerIds($)
      }
      const notes = [...moves, isLabeled ? labelNote(e.text, agentRows, agentBase) : undefined, idLine, options.rules !== false && e.origin?.kind !== 'task-notification' ? await stillOpenLine($) : undefined].filter(note => note !== undefined)
      orchestrator = { ...orchestrator, isActive: true }
      redraw($)
      ran = await next(notes.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...notes] })
    } catch (error) {
      restoreTold(told)
      orchestrator = { ...orchestrator, isActive: wasActive }
      redraw($)
      throw error
    }
    if ((ran as { drop?: unknown } | undefined)?.drop !== undefined) {
      restoreTold(told)
      orchestrator = { ...orchestrator, isActive: wasActive }
      redraw($)
    } else if (told.renames.length + told.numbered.length + told.removed.length > 0) {
      // Told: the store forgets them too, so a reload does not tell them twice.
      await saveToldNotes($)
    }

    return ran
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined) {
      await unlessStoreWaits(burnInOrder($, 0, true))
    }

    return compacted
  })

  // Each model request, the main loop's and every agent's: its tokens, from the step's result, else
  // from its stop chunk, are the one source of the session total and both token traces, counted at
  // the step that used them (never a whole run at its end), and an agent's also go on its card.
  // The count is awaited before the step returns, so it is drawn and stored in order, except while
  // the store is stalled (unlessStoreWaits): a store that never answers must not hold the
  // model request. burnInOrder keeps each step's count in order either way.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (agentId !== undefined) {
      stepModels.set(agentId, e.model)
      wake(agentId)
    }
    // A turn first seen past its first step began before this load: its steps from now are counted.
    const turnKey = turnKeyOf(agentId, e.turnId)
    if (!seenTurns.has(turnKey)) {
      seenTurns.set(turnKey, e.index > 0 ? 0 : undefined)
    }
    const stream = next(e)
    // The main conversation's text, read for tickets it puts off until later (deferredIds).
    let said = ''
    let stopUsage: StepUsage | undefined
    const count = async (used: StepUsage | undefined) => {
      if (used) {
        const n = turnTokens(used)
        const late = seenTurns.get(turnKey)
        if (late !== undefined) {
          seenTurns.set(turnKey, late + n)
        }
        if (agentId !== undefined) {
          pendingTokens.set(agentId, (pendingTokens.get(agentId) ?? 0) + n)
        }
        await unlessStoreWaits(burnInOrder($, n))
      }
    }
    // Counted once on every way out: done, a throw, or a consumer that stops reading
    // (return() at the yield, an interrupt), which runs only the finally.
    let isCounted = false
    // Whether the upstream stream ended on its own (returned or threw): if not, the consumer stopped
    // it, and the stream is owed a return() so its own cleanup runs.
    let isDone = false
    try {
      for (;;) {
        let read: Awaited<ReturnType<typeof stream.next>>
        try {
          read = await stream.next()
        } catch (error) {
          // A stream that breaks after its stop chunk still used the tokens the chunk reports.
          isDone = true
          isCounted = true
          await count(stopUsage)
          throw error
        }
        if (read.done) {
          isDone = true
          isCounted = true
          await count(stepUsage(read.value?.usage, stopUsage))
          if (agentId === undefined) {
            noteDeferred(said)
          }

          return read.value
        }
        if (read.value.kind === 'stop' && read.value.usage) {
          stopUsage = read.value.usage
        }
        if (agentId === undefined && read.value.kind === 'text' && said.length < SAID_CHARS) {
          said += read.value.text
        }
        yield read.value
      }
    } finally {
      try {
        if (!isCounted) {
          isCounted = true
          await count(stopUsage)
        }
      } finally {
        if (!isDone) {
          // A consumer that stops reading must end the stream it took; a failing return() never hides the stop.
          await Promise.resolve(stream.return?.(undefined)).catch(() => undefined)
        }
      }
    }
  })

  // A turn's usage is not counted here: its requests were counted at each turn.step, and the sum
  // of a whole run at its end would put an agent's tokens at the wrong time (before a compaction).
  // The one exception is a turn that began before this load: its steps before the load
  // were never counted, so its usage less the steps counted since goes in at its end.
  on('turn.complete', async ($, e, next) => {
    const turnKey = turnKeyOf(e.agentId, e.turnId)
    const late = seenTurns.get(turnKey)
    seenTurns.delete(turnKey)
    if (late !== undefined && e.usage !== undefined) {
      const missed = turnTokens(e.usage) - late
      if (missed > 0) {
        if (e.agentId !== undefined) {
          pendingTokens.set(e.agentId, (pendingTokens.get(e.agentId) ?? 0) + missed)
        }
        await unlessStoreWaits(burnInOrder($, missed))
      }
    }
    if (e.agentId !== undefined) {
      // A turn that ends with nothing after it leaves the agent finished but open, until a stop.
      const id = e.agentId
      const time = await $.clock.now()
      setRows(agentRows.map(row => (row.id === id && !isEnded(row.status) ? { ...row, idleSince: time } : row)))
      // The end of an agent's turn folds in its last tokens at once, not on the next clock step; not awaited while the store is stalled, so a store that never answers does not hold the turn.
      await unlessStoreWaits(refreshAgents($, true))
    } else {
      orchestrator = { ...orchestrator, isActive: false }
      redraw($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // A pane opened under an older title keeps it through a plugin reload: opening it again, just
    // after this draw, gives it the current one.
    if (e.props.title !== undefined && e.props.title !== TITLE && !isRetitled) {
      isRetitled = true
      // Tried once per load: a failed open retried on every draw reseated the pane each time, and a reseat resets its scroll.
      void Promise.resolve().then(() => $.ui.open({ id: PANE, title: TITLE })).catch(() => undefined)
    }
    const table = $.ui.resolve(e)
    const { Box, Button: RawButton, Text: RawText } = table
    // Every Text reaches the pane here, so its words are cleaned here, once, as the cards' alt is:
    // a control character in a ticket, a todo file name or a command would make the engine refuse
    // the whole pane (the terminal surface draws them all as Text).
    const Text = ((props: Parameters<typeof RawText>[0]) => <RawText {...props}>{textChildren(props.children) as never}</RawText>) as typeof RawText
    // A press that changes nothing on the board keeps the spaces of the list view's rows that left, so no row moves at the press;
    // every other press clears them and forgets what was drawn, so the change it makes (a filter, a view switch, a search) reflows.
    // Every label is cleaned here, once, as Text is: a category name with a control character made the engine refuse the pane.
    const Button = ((props: Parameters<typeof RawButton>[0]) => (
      <RawButton
        {...props}
        label={controlFree(String(props.label))}
        onPress={() => {
          if (!pressKeepsSpaces(props.key) && clearSpaces(layout, false)) {
            redraw($)
          }
          props.onPress?.()
        }}
      />
    )) as typeof RawButton
    const Input = 'Input' in table ? table.Input : undefined
    const rows = agentRows
    const time = Math.max(clockMs, ...rows.map(row => row.endedAt ?? row.startedAt))
    if (pruneTickets() || prunePlannedTickets()) {
      saveAgents($)
    }
    // A pane drawn before the kept state is read (a plugin reload, with no session.start and no live
    // agent to tick a refresh) reads it now, and draws again once it has: the seeded token trace
    // shows at once. A read that fails draws nothing more, so this cannot loop.
    if (!isAgentsLoaded || !isBurnLoaded) {
      void Promise.all([loadAgents($), readUsage($)]).then(() => redraw($)).catch(() => undefined)
    }
    axes = stepAxes(axes, series, time)
    const built = buildView(todoFiles, rows, time, orchestratorState(), peerHeld)
    pinColorSlots(rows)
    const view = { ...built, ...(usage === undefined ? {} : { usage }), series, axes }

    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined
    if (Svg !== undefined) {
      setWidth((e.props.bodyColumns ?? 48) * CELL_PX)
      beginRender(layout)
      const { active, idle, finished, shown } = ledger(view, isFinishedShown)
      // Held, it is drawn with no agents too, so the held room starts with the timeline's empty card.
      const timeline = isRoomHeld || view.agents.length > 0 ? timelineSvg(view, shown) : undefined
      const orchCard = view.orchestrator !== undefined ? agentSvg(view.orchestrator, view) : undefined
      const agentCards = shown.map(agent => ({ agent, drawn: agentSvg(agent, view) }))
      const held = isRoomHeld ? holdRoom(agentRoom, [timeline, orchCard, ...agentCards.map(one => one.drawn)].flatMap(one => (one === undefined ? [] : [one.height])), agentCards.length) : { room: agentRoom, blanks: [] }
      agentRoom = held.room
      // Every card reaches the pane here, so its alt is cleaned here, once: one control character
      // in a ticket, a command or a file name would make the engine refuse the whole pane.
      // No height is given: CELL_PX overestimates the cell, so the desktop scales each card down to the pane, and a
      // given height kept the box at the unscaled height with the image centered in it: a gap under each card, and columns of
      // different card heights starting at different tops. Without it the box takes the scaled image's own proportions.
      const card = (key: string, drawn: { source: string; width: number; height: number; alt: string; isInteractive?: true }) => (
        <Svg key={keyText(key)} source={drawn.source} alt={altText(drawn.alt)} width={drawn.width} {...(drawn.isInteractive === true ? { isInteractive: true } : {})} />
      )
      const section = (key: string, title: string, detail: string, buttonLabel: string | undefined, toggle: () => void, extra: { key: string; label: string; onPress: () => void }[] = [], showDone?: { label: string; onPress: () => void }) => (
        <Box key={keyText(key)} flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
          <Box flexDirection="row" gap={2}>
            <Text bold>{title}</Text>
            <Text dimColor>{detail}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            {extra.filter(one => one.key !== 'todo-consolidate').map(one => <Button key={one.key} label={one.label} onPress={one.onPress} />)}
            {buttonLabel !== undefined && <Button key={keyText(`${key}-toggle`)} label={buttonLabel} onPress={toggle} />}
            {showDone !== undefined && <Button key="todo-show-completed" label={showDone.label} onPress={showDone.onPress} />}
            {extra.filter(one => one.key === 'todo-consolidate').map(one => <Button key={one.key} label={one.label} onPress={one.onPress} />)}
          </Box>
        </Box>
      )

      return (
        <Box flexDirection="column" gap={1}>
          {(view.total > 0 || view.agents.length > 0 || view.usage !== undefined) && card('hero', heroCard(pluginVersion === undefined ? view : { ...view, version: pluginVersion }))}
          {/* The Orchestrator heading carries the room switch; pointing at it reveals its tip to its left, on the same line. */}
          <Box key="orchestrator-heading" flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
            <Box flexDirection="row" gap={2}>
              <Text bold>Orchestrator</Text>
              <Text dimColor>{orchestrator.isActive ? 'Working' : orchestrator.history.length === 0 ? 'Idle, nothing done yet' : 'Idle'}</Text>
            </Box>
            <Box flexDirection="row" gap={1} alignItems="center">
              <Box key="room-tip" display="none" hover={{ scope: ROOM_SCOPE, display: 'flex' }}>
                <Text dimColor wrap="truncate-end">{ROOM_TIP}</Text>
              </Box>
              <Button
                key="room-toggle"
                label="Limit UI shift"
                variant={isRoomHeld ? 'primary' : 'secondary'}
                hover={{ scope: ROOM_SCOPE, bold: true }}
                onPress={() => {
                  isRoomHeld = !isRoomHeld
                  redraw($)
                }}
              />
            </Box>
          </Box>
          {/* With nothing done yet, the heading alone; held, the card is drawn empty at its held height, so the first call moves nothing below it. */}
          {(orchestrator.history.length > 0 || isRoomHeld) && card('orchestrator', orchestratorSvg(orchestratorView(orchestrator.history, orchestratorPage).entries, isRoomHeld))}
          {orchestratorView(orchestrator.history, orchestratorPage).pages > 1 && (
            <Box key="orchestrator-pages" flexDirection="row" gap={1} alignItems="center">
              <Text dimColor>{pageLabel(orchestratorView(orchestrator.history, orchestratorPage), callCount)}</Text>
              {orchestratorView(orchestrator.history, orchestratorPage).page > 0 && (
                <Button
                  key="orchestrator-newer"
                  label="Newer"
                  onPress={() => {
                    orchestratorPage = Math.max(0, orchestratorView(orchestrator.history, orchestratorPage).page - 1)
                    redraw($)
                  }}
                />
              )}
              {orchestratorView(orchestrator.history, orchestratorPage).page < orchestratorView(orchestrator.history, orchestratorPage).pages - 1 && (
                <Button
                  key="orchestrator-older"
                  label="Older"
                  onPress={() => {
                    orchestratorPage = orchestratorView(orchestrator.history, orchestratorPage).page + 1
                    redraw($)
                  }}
                />
              )}
              {orchestratorView(orchestrator.history, orchestratorPage).page > 1 && (
                <Button
                  key="orchestrator-latest"
                  label="Latest"
                  onPress={() => {
                    orchestratorPage = 0
                    redraw($)
                  }}
                />
              )}
            </Box>
          )}
          {section(
            'agents',
            'Agents',
            view.agents.length === 0 ? (view.orchestrator === undefined ? 'None in this session yet' : 'No helper agents yet') : `${active.length} live, ${idle.length > 0 ? `${idle.length} idle, ` : ''}${finished.length} finished`,
            finished.length === 0 ? undefined : isFinishedShown ? 'Hide finished agents' : `Show finished agents (${finished.length})`,
            () => {
              isFinishedShown = !isFinishedShown
              redraw($)
            },
          )}
          {timeline !== undefined && card('timeline', timeline)}
          {/* The orchestrator leads, before A1; no Stop button, no timeline bar. */}
          {orchCard !== undefined && card('agent-orchestrator-card', orchCard)}
          {agentCards.map(({ agent, drawn }) => (
            // A live agent's Stop button is drawn in its card at the right edge, right of the badge: the badge's row and height, red with a
            // white stop sign, so it lines up at any cell size. A plain Button of blank text lies over it to take the press.
            // Keyed by the agent's ID: a cut at the front of the rows shifts every index, and index keys would remount every card.
            <Box key={keyText(`agent-${agent.id ?? agent.index}`)} flexDirection="column" position="relative">
              {card(`agent-${agent.id ?? agent.index}-card`, drawn)}
              {!agent.isEnded && (
                <Box position="absolute" right={ACTION_RIGHT - STOP_PAD_CELLS} top={STOP_TOP}>
                  <Button key={keyText(`agent-stop-${agent.id ?? agent.index}`)} label={STOP_HIT} plain onPress={() => (agent.id === undefined ? undefined : stopAgent($, agent.id).catch(toastFailure($, 'mark the agent stopped')))} />
                </Box>
              )}
            </Box>
          ))}
          {/* Empty gray slots hold the agent area at its height, so the board below stays put while three agents or fewer show. */}
          {held.blanks.map((px, i) => card(`agent-room-${i}`, blankCard(px)))}
          {section(
            'todo',
            'Todo',
            todoDetail(view),
            undefined,
            () => undefined,
            todoActions($),
            archiveLink === undefined ? undefined : { label: `Show completed (${view.archived})`, onPress: () => void openArchive($).catch(toastFailure($, 'open the archive')) },
          )}
          <Box key="todo-controls" flexDirection="row" gap={1} alignItems="center">
            {Input !== undefined && (
              <Input
                key="todo-search"
                placeholder="Search open, queued and in-progress items"
                value={controlFree(query)}
                submitLabel="Search"
                onInput={(value: string) => {
                  clearSpaces(layout, false)
                  // Cleaned before it is kept: the engine refuses an Input value with a control character, and the pane would stay refused until a reload.
                  query = controlFree(String(value))
                  redraw($)
                }}
                onSubmit={(value: string) => {
                  clearSpaces(layout, false)
                  query = controlFree(String(value))
                  redraw($)
                }}
              />
            )}
            <Button
              key="todo-tickets"
              label={isTicketView ? 'Show as list' : 'Show as tickets'}
              onPress={() => {
                isTicketView = !isTicketView
                redraw($)
              }}
            />
            {isTicketView && (
              <Button
                key="todo-order"
                label={ticketOrder === 'recency' ? 'Rank by group' : 'Rank by recency'}
                onPress={() => {
                  ticketOrder = ticketOrder === 'recency' ? 'group' : 'recency'
                  redraw($)
                }}
              />
            )}
            {openItems().length > 0 && (
              <Button
                key="todo-recategorize"
                label="Recategorize"
                onPress={() => {
                  void recategorize($).catch(() => undefined)
                }}
              />
            )}
            {/* One line, cut to fit: a long note that wrapped made the row taller, and moved the board below, for its 4 s. */}
            {(isRecategorizing || recatNote !== undefined) && <Text dimColor wrap="truncate-end">{isRecategorizing ? 'Recategorizing...' : recatNote!.text}</Text>}
            {query.trim() === '' && !isTicketView && (
              <Button
                key="todo-sort"
                label="Arrange by category"
                variant={sortBy === 'category' ? 'primary' : 'secondary'}
                onPress={() => {
                  sortBy = sortBy === 'category' ? 'file' : 'category'
                  redraw($)
                }}
              />
            )}
          </Box>
          {query.trim() === '' && filterNames(todoLedger(view), book).length > 0 && (
            <Box key="category-filter" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
              <Text dimColor>Categories</Text>
              {filterNames(todoLedger(view), book).map(name => (
                <Button
                  key={keyText(`category-toggle-${name}`)}
                  label={name}
                  variant={hiddenCategories.has(name) ? 'secondary' : 'primary'}
                  onPress={() => {
                    if (hiddenCategories.has(name)) {
                      hiddenCategories.delete(name)
                    } else {
                      hiddenCategories.add(name)
                    }
                    redraw($)
                  }}
                />
              ))}
            </Box>
          )}
          {query.trim() !== '' && (
            <Box key="search-head" flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text dimColor>{`${searchTodo(view.files, query).reduce((sum, file) => sum + file.items.length, 0)} matching items, open, queued and in progress`}</Text>
              <Button
                key="search-clear"
                label="Clear search"
                onPress={() => {
                  query = ''
                  redraw($)
                }}
              />
            </Box>
          )}
          {boardTargets(
            query.trim() !== ''
              ? searchTodo(view.files, query).map(file => ({ file, prefix: 'search' }))
              : sortBy === 'category' && !isTicketView
                ? categoryGroups(withoutHidden(todoLedger(view), book, hiddenCategories), book).map(file => ({ file, prefix: 'category' }))
                // The board keeps the live files whole; ticketColumns leaves their done tickets out (Show completed opens them).
                : withoutHidden(isTicketView ? view.files.filter(file => file.isArchived !== true) : todoLedger(view), book, hiddenCategories).map(file => ({ file, prefix: 'file' })),
            isTicketView,
          ).flatMap(({ file, prefix, rows }) => {
            const id = `${prefix}:${file.id}`
            const isExpanded = expandedFiles.has(id)
            const limit = isExpanded ? file.items.length : ITEMS_SHOWN
            const isTextOpen = openText.has(id)
            const sections = (file.groups ?? [{ name: '', from: 0, count: file.items.length }]).map(group => ({
              name: group.name,
              columns: ticketColumns(file.items.slice(group.from, group.from + group.count), book, ticketOrder),
            }))
            // Side by side while each ticket has room for its text and buttons; the rest wrap to the next row, or all stack.
            // The board view spans the whole pane, so its tickets grow with it; each ticket is as
            // wide as its column, so the buttons, anchored to the column's right edge, sit on the card.
            const paneW = isTicketView ? boardWidth() : cardWidth()
            const columnCount = columnsThatFit(paneW, sections[0]?.columns.length ?? 1, TICKET_GAP_PX, MIN_TICKET_PX)
            const isStacked = columnCount === 1
            // What one ticket draws, worked out once per render: the slots need its height before it is placed.
            const prepared = new Map<ItemView, { sentKey: string; isSent: boolean; actions: TicketAction[]; drawn: ReturnType<typeof ticketSvg> }>()
            // The tickets whose card cuts their text: the board offers the full text for them, as the list does.
            const longTickets = new Set<ItemView>()
            // Each item is in one column, so the first call's width is its column's.
            const prepare = (item: ItemView, ticketW: number) => {
              const known = prepared.get(item)
              if (known !== undefined) {
                return known
              }
              const sentKey = `${item.file ?? file.name}:${item.key}`
              const isSent = sentTickets.has(sentKey)
              // A ticket with no listed category is tagged Uncategorized, once the book has categories.
              const category = book.categories.length === 0 ? undefined : groupOf(book, storedKey(item.key))
              const id = itemChipId(item)
              const send = isSent ? [] : [SEND_ACTION]
              // Every ticket, in every column, ends with the status question mark.
              const actions: TicketAction[] =
                item.status === 'completed'
                  ? [STATUS_ACTION]
                  : item.status === 'pending'
                    ? [QUEUE_ACTION, START_ACTION, DONE_ACTION, ...send, STATUS_ACTION]
                    : item.status === 'queued'
                      ? [REOPEN_ACTION, START_ACTION, DONE_ACTION, ...send, STATUS_ACTION]
                      // Back moves one column, in progress to queued; a ticket held only by a live agent has no box to move back.
                      : [...(item.heldFrom === undefined ? [UNSTART_ACTION] : []), DONE_ACTION, ...(item.peer !== undefined ? send : []), STATUS_ACTION]
              // The tag's room: the card width less the buttons' cells (an overestimate, so the tag stays clear of them) and the card's padding.
              const peerTag = item.peer === undefined ? undefined : { tip: peerTip(item.peer), isDim: item.peer.silentSince !== undefined }
              if (isTicketLong(item, id, ticketW)) {
                longTickets.add(item)
              }
              const drawn = ticketSvg(item, view, ticketW, { ...(id === undefined ? {} : { id }), ...(category === undefined ? {} : { category }), isSent, isTextOpen, actions: actions.length, ...(peerTag === undefined ? {} : { peerTag }) })
              const one = { sentKey, isSent, actions, drawn }
              prepared.set(item, one)

              return one
            }
            // `slotId` is the ticket's slot ID, which is stable while the ticket stays: its key may not carry the slot's index, or every card below a change would remount.
            // `left` and `top`: the margin that sets the gap to the column on the left and the ticket above.
            const ticket = (item: ItemView, slotId: string, ticketW: number, left: number, top: number) => {
              const { sentKey, actions, drawn: plain } = prepare(item, ticketW)
              const drawn = padCard(plain, left, top)
              const press = (action: TicketAction) => {
                if (action.mark !== undefined) {
                  void markTicket($, item, action.mark, action.toast).catch(toastFailure($, `move ${ticketSummary(item.text, 60)}`))

                  return
                }
                // Sent, the ticket is the orchestrator's to build. A status ask starts no work: on an open or queued box it
                // claims nothing, since a claim on a ticket never seen in progress never ends, and the board held it in In progress
                // for good. On a box already in progress the claim ends as the box leaves it, so that ask still claims.
                if (action === SEND_ACTION) {
                  sentTickets.add(sentKey)
                }
                // A ticket a peer claims is sent with a different prompt: Claude checks in with the owner first, and claims it only when it starts.
                const isPeerSend = action === SEND_ACTION && item.peer !== undefined
                if (!isPeerSend && (action === SEND_ACTION || (item.status === 'in_progress' && item.heldFrom === undefined))) {
                  claimTickets($, [item.key])
                }
                const where = item.path ?? `${DIR}/${item.file ?? file.name}`
                const sent = isPeerSend ? peerSendPrompt(where, item.text, item.peer?.name, presenceRoot() ?? '') : action.prompt(where, item.text)
                void $.prompt.submit({ text: sent, asUser: true }).catch(toastFailure($, `send ${ticketSummary(item.text, 60)}`))
                showToast($, `${action.toast}: ${ticketSummary(item.text, 60)}`)
                redraw($)
              }

              // The buttons sit over the card's bottom row, which the card keeps free for them;
              // pointing at one reveals its tip in the same row, left of them all, cut to fit.
              return (
                <Box key={keyText(`${prefix}-${file.id}-t-${slotId}`)} flexDirection="column" position="relative">
                  {card(`${prefix}-${file.id}-c-${slotId}`, drawn)}
                  {actions.map(action => (
                    <Box
                      key={keyText(`${prefix}-${file.id}-tip-${action.name}-${item.file ?? file.name}-${item.key}`)}
                      position="absolute"
                      left={2 + Math.ceil(left / CELL_PX)}
                      right={ACTION_RIGHT + actions.length * ACTION_CELLS}
                      bottom={ACTION_BOTTOM}
                      display="none"
                      hover={{ scope: sendScope(`${action.name}:${sentKey}`), display: 'flex' }}
                    >
                      <Text dimColor wrap="truncate-end">{action.tip}</Text>
                    </Box>
                  ))}
                  {actions.length > 0 && (
                    <Box position="absolute" right={ACTION_RIGHT} bottom={ACTION_BOTTOM} flexDirection="row" gap={1}>
                      {actions.map(action => (
                        <Button
                          key={keyText(action === SEND_ACTION ? `ticket-${item.file ?? file.name}-${item.key}` : `ticket-${action.name}-${item.file ?? file.name}-${item.key}`)}
                          label={action.glyph}
                          hover={{ scope: sendScope(`${action.name}:${sentKey}`), bold: true }}
                          onPress={() => press(action)}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              )
            }
            const cards = isTicketView
              ? [
                  ...(rows.length + emptyRows().length === 0 ? [] : [card(`${prefix}-${file.id}-head`, boardHead([...rows, ...emptyRows()]))]),
                  ...sections.map(section => (
                    <Box key={keyText(`${prefix}-${file.id}-board-${section.name}`)} flexDirection="column" gap={1}>
                      {section.name !== '' && (
                        <Box flexDirection="row" gap={1} marginTop={1}>
                          <Text bold>{section.name}</Text>
                          <Text dimColor>{String(section.columns.reduce((sum, column) => sum + column.items.length, 0))}</Text>
                        </Box>
                      )}
                      {/* Explicit rows of columnCount columns: a column that does not fit starts a row below, never past the right edge. */}
                      {rowsOf(section.columns, columnCount).map((row, r) => (
                      // Side by side, each column is as wide as its tickets, and a margin in each ticket after the first column sets the gap.
                      // An empty column takes its tickets' share of the width, so it does not shrink to its heading. The pane takes
                      // only a whole percentage; rounded down, the row never passes the right edge.
                      <Box key={keyText(`${prefix}-${file.id}-row-${section.name}-${r}`)} flexDirection={isStacked ? 'column' : 'row'} gap={isStacked ? 1 : 0} alignItems="flex-start">
                        {row.map((column, c) => {
                          const ticketW = isStacked ? paneW : columnPx(paneW, row.length, TICKET_GAP_PX)
                          const left = isStacked || c === 0 ? 0 : TICKET_GAP_PX

                          return (
                          <Box key={keyText(`${prefix}-${file.id}-col-${section.name}-${column.name}`)} flexDirection="column" gap={1} {...(isStacked ? { width: '100%' } : column.items.length === 0 ? { width: `${Math.floor(((ticketW + left) / paneW) * 100)}%` } : {})}>
                            {/* The heading starts over its tickets, past the margin that sets the column gap. */}
                            <Box flexDirection="row" gap={1} {...(left > 0 ? { marginLeft: Math.round(left / CELL_PX) } : {})}>
                              <Text dimColor bold>{column.name}</Text>
                              <Text dimColor>{String(column.items.length)}</Text>
                            </Box>
                            {/* flex-start: each ticket Box is as wide as its image, so its buttons sit on the card. */}
                            <Box flexDirection="column" alignItems="flex-start">
                            {(() => {
                              const shown = column.items.slice(0, isExpanded ? column.items.length : ITEMS_SHOWN)
                              // Two tickets with one key get distinct slot IDs.
                              const seen = new Map<string, number>()
                              const slotId = (item: ItemView) => {
                                const base = prepare(item, ticketW).sentKey
                                const n = seen.get(base) ?? 0
                                seen.set(base, n + 1)

                                return n === 0 ? base : `${base}#${n}`
                              }
                              const ids = shown.map(slotId)
                              // A margin above each ticket after the first sets the gap between stacked tickets. A ticket that
                              // leaves leaves no space on the board: the tickets below close up at once.
                              return shown.map((item, i) => ticket(item, ids[i]!, ticketW, left, i > 0 ? TICKET_GAP_PX : 0))
                            })()}
                            </Box>
                          </Box>
                          )
                        })}
                      </Box>
                      ))}
                    </Box>
                  )),
                ]
              : (() => {
                  // The list view keeps a row's place the same way.
                  const shown = file.items.slice(0, limit)
                  const heights = listRowHeights(file, limit, isTextOpen)
                  const slots = columnSlots(layout, `list:${prefix}-${file.id}`, `${limit}:${isTextOpen}:${cardWidth()}`, shown.map((item, i) => ({ id: `${item.file ?? file.name}:${item.key}`, h: heights[i] ?? 0 })), nowSync())
                  const gaps = new Map<number, number>()
                  let at = 0
                  for (const slot of slots) {
                    if (slot.isSpace === true) {
                      gaps.set(at, (gaps.get(at) ?? 0) + slot.h)
                    } else {
                      at += 1
                    }
                  }

                  return fileCards(file, view, limit, isTextOpen, gaps).map((drawn, k) => card(`${prefix}-${file.id}-${k}`, drawn))
                })()
            // The tickets the file offers in this view: the board's columns hold the open ones, the list holds every item.
            const offered = isTicketView ? sections.flatMap(section => section.columns).reduce((sum, column) => sum + column.items.length, 0) : file.items.length
            const more = isTicketView
              ? sections.flatMap(section => section.columns).reduce((sum, column) => sum + Math.max(0, column.items.length - ITEMS_SHOWN), 0)
              : file.items.length - ITEMS_SHOWN
            const long = isTicketView ? longTickets.size : longItems(file, limit)
            const toggle = (set: Set<string>) => () => {
              if (set.has(id)) {
                set.delete(id)
              } else {
                set.add(id)
              }
              redraw($)
            }

            return more <= 0 && long === 0
              ? cards
              : [
                  ...cards,
                  <Box key={keyText(`${prefix}-${file.id}-more`)} flexDirection="row" justifyContent="flex-end" gap={1}>
                    {long > 0 && (
                      <Button
                        key={keyText(`${prefix}-text-${file.id}`)}
                        label={isTextOpen ? 'Shorten long items' : `Show full text (${long} long ${long === 1 ? 'item' : 'items'})`}
                        onPress={toggle(openText)}
                      />
                    )}
                    {more > 0 && (
                      <Button
                        key={keyText(`${prefix}-toggle-${file.id}`)}
                        label={isExpanded ? 'Show fewer' : `Show all ${offered} items`}
                        onPress={toggle(expandedFiles)}
                      />
                    )}
                  </Box>,
                ]
          })}
        </Box>
      )
    }

    const columns = e.props.bodyColumns ?? 40
    const width = Math.max(10, Math.min(30, columns - 16))
    const chip = (i: number) => (
      <Text key={keyText(`chip-${i}`)} backgroundColor={agentColor(i)} color="#FFFFFF" bold>
        {` ${agentLabel(i)} `}
      </Text>
    )
    const heading = (label: string, detail: string) => (
      <Box marginTop={1}>
        <Text bold>{label}</Text>
        <Text dimColor>{detail === '' ? '' : `  ${detail}`}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text key="hero-line" dimColor>{heroText(view)}</Text>
        {heading('Orchestrator', orchestrator.isActive ? '' : 'Idle')}
        {orchestratorView(orchestrator.history, 0).entries.slice(0, 5).map(entry => (
          <Text key={keyText(`orchestrator-${entry.id}`)} dimColor={!entry.isRunning}>
            {` ${entry.isRunning ? '•' : '·'} ${clock(entry.at)}  ${entry.line}`}
            {entry.detail !== undefined && <Text dimColor>{`  ${clip(entry.detail, Math.max(10, columns - 20 - entry.line.length))}`}</Text>}
          </Text>
        ))}
        {heading('Agents', view.agents.length === 0 ? '' : `${view.live} running, ${ledger(view, false).idle.length > 0 ? `${ledger(view, false).idle.length} idle, ` : ''}${ledger(view, false).finished.length} done`)}
        {ledger(view, isFinishedShown).finished.length > 0 && (
          <Button
            key="agents-toggle"
            label={isFinishedShown ? 'Hide finished agents' : `Show finished agents (${ledger(view, isFinishedShown).finished.length})`}
            onPress={() => {
              isFinishedShown = !isFinishedShown
              redraw($)
            }}
          />
        )}
        {view.orchestrator !== undefined && (
          <Box key="a-orchestrator" flexDirection="column" marginTop={1}>
            <Box>
              {chip(ORCH)}
              <Text bold>{` ${view.orchestrator.description}`}</Text>
            </Box>
            {view.orchestrator.links.map((link, n) => (
              // Keyed by place: two linked tickets can have the same text.
              <Box key={keyText(`link-${n}`)}>
                <Text dimColor>{'  Working on '}</Text>
                <Text color={agentColor(ORCH)}>{clip(link, columns - 16)}</Text>
              </Box>
            ))}
            <Text dimColor>
              {`  ${view.orchestrator.type} · `}
              <Text color={ACCENT}>running</Text>
              {` · ${view.orchestrator.toolCalls} tool call${view.orchestrator.toolCalls === 1 ? '' : 's'}`}
            </Text>
            {view.orchestrator.doing !== undefined && <Text dimColor>{`  ${clip(view.orchestrator.doing, columns - 12)}`}</Text>}
          </Box>
        )}
        {ledger(view, isFinishedShown).shown.map(agent => {
          const failed = agent.status === 'failed' || agent.status === 'killed'

          return (
            <Box key={keyText(`a-${agent.id ?? agent.index}`)} flexDirection="column" marginTop={1}>
              <Box>
                {chip(agent.index)}
                <Text bold={!agent.isEnded} dimColor={agent.isEnded}>{` ${clip(agent.description, columns - 8)}`}</Text>
              </Box>
              {agent.links.map((link, n) => (
                <Box key={keyText(`link-${n}`)}>
                  <Text dimColor>{'  Working on '}</Text>
                  <Text color={agentColor(agent.index)}>{clip(link, columns - 16)}</Text>
                </Box>
              ))}
              <Text dimColor>
                {`  ${agent.type}${agent.model ? ` · ${agent.model}` : ''} · `}
                <Text color={failed ? DANGER : agent.isEnded ? GREEN : ACCENT}>{failed ? '✕ ' : agent.isEnded ? '✓ ' : ''}{agent.isIdle ? 'idle, not stopped' : agent.status}</Text>
                {` · ${elapsed((agent.endedAt ?? agent.idleSince ?? view.now) - agent.startedAt)} · ${agent.toolCalls} tool call${agent.toolCalls === 1 ? '' : 's'}${agent.tokens ? ` · ${tokens(agent.tokens)} tokens` : ''}`}
              </Text>
              {!agent.isEnded && agent.progress !== undefined && (
                <Text color={ACCENT}>
                  {`  ${bar(agent.progress.done, agent.progress.total, 10)} step ${Math.min(agent.progress.done + 1, agent.progress.total)} of ${agent.progress.total}${agent.progress.step ? `: ${clip(agent.progress.step, columns - 30)}` : ''}`}
                </Text>
              )}
              {!agent.isEnded && agent.doing !== undefined && <Text dimColor>{`  ${clip(agent.doing, columns - 4)}`}</Text>}
            </Box>
          )
        })}
        {heading('Todo', view.total === 0 && todoCount() === 0 && unreadPlaces.length === 0 ? '' : todoDetail(view))}
        {todoActions($).map(one => (
          <Button key={one.key} label={one.label} onPress={one.onPress} />
        ))}
        {view.total > 0 && <Text color={ACCENT}>{`${bar(view.done, view.total, width)} ${Math.round((view.done / view.total) * 100)}%`}</Text>}
        {archiveLink !== undefined && <Button key="todo-show-completed" label={`Show completed (${view.archived})`} onPress={() => void openArchive($).catch(toastFailure($, 'open the archive'))} />}
        {todoLedger(view).map((file, _, all) => (
          <Box key={keyText(file.id)} flexDirection="column" marginTop={1}>
            <Text dimColor={file.done === file.total} bold={file.done < file.total}>
              {`${clip(`${file.name}${all.filter(one => one.name === file.name).length > 1 && file.place ? ` ${file.place}` : ''}`, columns - 24)}  ${bar(file.done, file.total, 10)} ${file.done}/${file.total}`}
            </Text>
            {file.items.slice(0, expandedFiles.has(`file:${file.id}`) ? file.items.length : ITEMS_SHOWN).map(item => (
              // Keyed by the ticket, not its place, so an insert does not remount every row below it.
              <Box key={keyText(`${file.id}:${item.key}`)}>
                <Text dimColor={item.status !== 'completed'}>
                  {item.status === 'in_progress' ? ' • ' : item.status === 'completed' ? ' ✓ ' : item.status === 'queued' ? ' ≡ ' : ' ○ '}
                </Text>
                <Text bold={item.owners.length > 0} color={item.owners[0] === undefined ? undefined : agentColor(item.owners[0])} dimColor={item.owners.length === 0 && item.status === 'pending'}>{clip(item.text, columns - 8 - item.owners.length * 5)}</Text>
                {item.owners.map(i => (
                  <Text key={keyText(`l-${i}`)}> {chip(i)}</Text>
                ))}
              </Box>
            ))}
            {file.items.length > ITEMS_SHOWN && (
              <Button
                key={keyText(`file-toggle-${file.id}`)}
                label={expandedFiles.has(`file:${file.id}`) ? 'Show fewer' : `Show all ${file.items.length} items`}
                onPress={() => {
                  if (expandedFiles.has(`file:${file.id}`)) {
                    expandedFiles.delete(`file:${file.id}`)
                  } else {
                    expandedFiles.add(`file:${file.id}`)
                  }
                  redraw($)
                }}
              />
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
