import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRow, AgentRowStatus, Progress, TodoFile, TodoItem, TodoStatus } from '../types'
import { ACCENT, DANGER, GREEN, ORCH, clock, tokens, orchestratorSvg, plural, agentColor, agentLabel, setLabelBase, agentSvg, stopInsetPx, cardWidth, elapsed, boardHead, fileCards, heroSvg, longItems, ticketSvg, setWidth, timelineSvg } from './cards'
import type { AgentView, FileView, ItemStatus, ItemView, Usage, View } from './cards'

const PANE = 'claudeopticon'
const TITLE = 'Claudeopticon'
/** Whether this load of the mod has reopened a pane that carried an older title. */
let isRetitled = false
const DIR = '.claude_todo'
const TICK_MS = 1000
const SCAN_EVERY = 3
/** Ticks between full resyncs: every file reread whatever its mtime, the categories reloaded, the agent list asked again. */
const RESYNC_EVERY = 60
const CLOCK_MS = 5000
const ITEMS_SHOWN = 12
/** The corner button's offsets from the card's lower right corner, in cells: about even in px. */
const ACTION_RIGHT = 2
const ACTION_BOTTOM = 1
/** Rows from a live agent card's top edge to its Stop button, on the title row left of the badge. */
const STOP_TOP = 1
/** The Stop button's label: a circle with a bar, the stop sign. */
const STOP_GLYPH = '\u2296'
/** The cells one corner button and its gap take, to set the tip left of them all. */
const ACTION_CELLS = 5
/** The narrowest a ticket may be drawn side by side with others, in px; narrower, columns stack. */
const MIN_TICKET_PX = 300
/** CSS pixels per pane cell on the desktop: a slight overestimate, since a card wider than the pane scales down to fit. */
const CELL_PX = 8.5
const MAX_UP = 8
const LINK_MIN_CHARS = 12

const PROGRESS_TOOL = 'mcp__claudeopticon__report_progress'
const MOVE_TOOL = 'mcp__claudeopticon__move_ticket'

/** Appended to each agent's prompt: about 100 tokens, and each report rides along with a tool call. */
export const PROGRESS_NOTE = `

Progress: if you have the ${PROGRESS_TOOL} tool, call it once you have a plan, with done (steps finished), total (steps planned) and step (a few words on the current step). If your task covers items in the project's .claude_todo/ files, also pass items: each one quoted from its line, or its #T ID. Call it again after each step, in the same message as your next tool call. Raise total if the plan grows; pass items again only if they change.`

/** An agent's report, held to sense: whole steps, at least one planned, never more done than planned. */
export function readProgress(input: Record<string, unknown>): Progress | undefined {
  const total = Math.max(1, Math.round(Number(input.total)))
  const done = Math.min(total, Math.max(0, Math.round(Number(input.done))))
  if (!Number.isFinite(total) || !Number.isFinite(done)) {
    return undefined
  }
  const step = typeof input.step === 'string' && input.step.trim() !== '' ? input.step.trim().slice(0, 120) : undefined

  return step === undefined ? { done, total } : { done, total, step }
}

/** The items an agent claims in a report: up to 20 quoted lines or IDs; undefined when it named none. */
export function readClaims(input: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(input.items)) {
    return undefined
  }
  const claims = input.items
    .filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    .map(one => one.trim().slice(0, 300))
    .slice(0, 20)

  return claims.length === 0 ? undefined : claims
}

/** How long a claim stands before the next progress reply asks the agent to confirm it. */
export const CLAIM_CHECK_MS = 10 * 60_000

/**
 * The reply to a progress report. Every 10 minutes it asks the agent to confirm the items it
 * claimed, or, when it claimed none, to name them if its task covers any: about 40 tokens, carried
 * by a call the agent makes anyway.
 */
export function progressReply(claims: readonly string[] | undefined, isDue: boolean): string {
  if (!isDue) {
    return 'Noted.'
  }
  if (claims === undefined || claims.length === 0) {
    return 'Noted. If your task covers items in .claude_todo/, pass them as items in your next report.'
  }

  return `Noted. You said you handle: ${claims.map(claim => `"${claim.slice(0, 80)}"`).join('; ')}. If that changed, pass the current items in your next report.`
}

/** When each agent's claim was last set or confirmed, by agent ID. */
const claimCheckedAt = new Map<string, number>()

const CLAIM_MIN_CHARS = 12
const CLAIM_MIN_WORDS = 3
const CLAIM_MIN_SHARE = 0.7

function words(text: string): Set<string> {
  return new Set(normalize(text).split(/[^a-z0-9]+/).filter(word => word.length >= 3))
}

/**
 * How well a claim names an item, from 0 to 1: 1 when it gives the item's ID or holds the item's
 * text (or the item holds the claim); else the share of the shorter one's words the two have in
 * common, counted only from 3 shared words and a 70% share, so a loose paraphrase still lands.
 */
export function claimScore(claim: string, item: TodoItem): number {
  const c = normalize(claim)
  if (item.id !== undefined && new RegExp(`#${item.id.toLowerCase()}(?![0-9a-z])`).test(c)) {
    return 1
  }
  const t = normalize(item.text)
  if (Math.min(c.length, t.length) >= CLAIM_MIN_CHARS && (t.includes(c) || c.includes(t))) {
    return 1
  }
  const a = words(claim)
  const b = words(item.text)
  const shared = [...a].filter(word => b.has(word)).length
  const share = shared / Math.max(1, Math.min(a.size, b.size))

  return shared >= CLAIM_MIN_WORDS && share >= CLAIM_MIN_SHARE ? share : 0
}

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

/**
 * What the main conversation (the orchestrator) did itself this session: the one-line summary of
 * each of its tool calls (the call's own `description`, as the transcript shows it), with its start
 * time, newest last, the last 1000 kept. Agent calls stay out: they are the agents' work.
 */
export type OrchestratorEntry = { id: number; line: string; at: number; isRunning: boolean; detail?: string }
let orchestrator: { isActive: boolean; history: OrchestratorEntry[] } = { isActive: false, history: [] }
let callCount = 0
/**
 * The tickets the orchestrator handles itself, by item key (qualifiedKey): the value is whether a
 * scan has seen the ticket in progress since the claim. A claim ends when the ticket is done, gone,
 * or back to open after it was seen in progress. A ticket an agent works on may be in here too.
 */
const orchTickets = new Map<string, boolean>()
/** The headline Claude gave the assignment it works on itself (report_progress `title`); per session, cleared with the last ticket. */
let orchTitle: string | undefined
/** Which page of the history the card shows: 0 the newest. */
let orchestratorPage = 0
/** Categories the person hid, by name; their items leave the list and the board (search still finds them). */
const hiddenCategories = new Set<string>()
/** Tickets already sent to Claude this session, by file and item key. */
const sentTickets = new Set<string>()
let isFinishedShown = false
/**
 * Tickets the mod moved to the archive this session, newest first, as board tickets: the Done
 * column lists them. Kept in the store per session, so a reload keeps them.
 */
let archivedNow: ItemView[] = []
let savedArchived = ''
/** True while the Recategorize request runs: a press is ignored. */
let isRecategorizing = false
/** The line beside the Recategorize button, shown until `until` (clock ms); the tick clears it. */
let recatNote: { text: string; until: number } | undefined
const NOTE_MS = 4000
let sortBy: 'file' | 'category' = 'file'
let query = ''
function redraw($: EngineInterface): void {
  $.ui.invalidate('ui.render')
  saveAgents($)
}

// ---------------------------------------------------------------- agents kept across a reload

/** The agent rows kept in the store per session, so a plugin reload keeps each agent's data. */
const KEPT_AGENTS = 200
const KEPT_ARCHIVED = 200
let isAgentsLoaded = false
let savedAgents = ''

async function agentsKey($: EngineInterface): Promise<string> {
  return `agents:${await $.session.id()}`
}

/** The store key of the label base: how many agents came before the first kept row. */
async function baseKey($: EngineInterface): Promise<string> {
  return `agents-base:${await $.session.id()}`
}

/** The number of agents before `agentRows[0]`, so A201 stays A201 after a reload drops older rows. */
let agentBase = 0
let savedBase = -1

async function archivedKey($: EngineInterface): Promise<string> {
  return `archived:${await $.session.id()}`
}

/** Reads the stored archived tickets back, keeping only entries with the fields the board needs. */
export function readKeptArchived(stored: unknown): ItemView[] {
  if (!Array.isArray(stored)) {
    return []
  }

  return stored.filter((one): one is ItemView =>
    typeof one === 'object' && one !== null && typeof one.text === 'string' && typeof one.key === 'string' && one.status === 'completed' && Array.isArray(one.owners))
}

/**
 * The IDs (lowercase) the mod named to Claude in a "Next free ticket IDs" line and that no file holds
 * yet: kept per session in the store. They count as taken, so the mod never gives one to a line, and
 * the next prompt names fresh ones. Numbering reserves the IDs it gives before it writes them. An ID leaves the set once a file holds it.
 */
const reservedIds = new Set<string>()

async function reservedKey($: EngineInterface): Promise<string> {
  return `reserved:${await $.session.id()}`
}

/** Reads the stored reserved IDs back, keeping only strings. */
export function readKeptIds(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((one): one is string => typeof one === 'string') : []
}

/** Drops the reserved IDs that a file on the board holds now. */
function pruneReserved(): void {
  for (const id of projectIds()) {
    reservedIds.delete(id)
  }
}

/** The orchestrator's tickets are kept beside the agent rows, per session, so a reload keeps them. */
async function orchKey($: EngineInterface): Promise<string> {
  return `orchestrator:${await $.session.id()}`
}

async function orchTitleKey($: EngineInterface): Promise<string> {
  return `orchestrator-title:${await $.session.id()}`
}

/** A headline from the main conversation: a few words, one line, at most TITLE_MAX characters. */
export const TITLE_MAX = 80
export function readTitle(input: unknown): string | undefined {
  const text = typeof input === 'string' ? (input.trim().split('\n')[0] ?? '').trim().slice(0, TITLE_MAX) : ''

  return text === '' ? undefined : text
}

/** Reads the stored ticket claims back, keeping only well-formed pairs. */
export function readKeptTickets(stored: unknown): [string, boolean][] {
  if (!Array.isArray(stored)) {
    return []
  }

  return stored.filter((pair): pair is [string, boolean] => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'boolean')
}

/** Reads a stored list back into rows, keeping only entries with the fields every row has. */
export function readKeptAgents(stored: unknown): AgentRow[] {
  if (!Array.isArray(stored)) {
    return []
  }

  return stored.filter((row): row is AgentRow =>
    typeof row === 'object' && row !== null && typeof row.id === 'string' && typeof row.description === 'string'
    && typeof row.type === 'string' && typeof row.status === 'string' && typeof row.startedAt === 'number'
    && typeof row.toolCalls === 'number' && typeof row.brief === 'string')
}

/**
 * Loads the rows this session kept, once per load of the mod, under the rows already seen: a row
 * seen since the load wins. An agent whose ticket match already ran is not matched again.
 */
async function loadAgents($: EngineInterface): Promise<void> {
  if (isAgentsLoaded) {
    return
  }
  isAgentsLoaded = true
  const kept = readKeptAgents(await $.store.get(await agentsKey($)).catch(() => undefined))
  const base = await $.store.get(await baseKey($)).catch(() => undefined)
  if (kept.length > 0 && typeof base === 'number' && Number.isFinite(base) && base > 0) {
    agentBase = Math.floor(base)
    setLabelBase(agentBase)
  }
  for (const [key, seen] of readKeptTickets(await $.store.get(await orchKey($)).catch(() => undefined))) {
    if (!orchTickets.has(key)) {
      orchTickets.set(key, seen)
    }
  }
  orchTitle ??= readTitle(await $.store.get(await orchTitleKey($)).catch(() => undefined))
  savedTitle = undefined
  for (const id of readKeptIds(await $.store.get(await reservedKey($)).catch(() => undefined))) {
    reservedIds.add(id)
  }
  const keptArchived = readKeptArchived(await $.store.get(await archivedKey($)).catch(() => undefined))
  archivedNow = [...archivedNow, ...keptArchived.filter(one => !archivedNow.some(now => now.key === one.key && now.path === one.path))].slice(0, KEPT_ARCHIVED)
  const seen = new Set(agentRows.map(row => row.id))
  agentRows = [...kept.filter(row => !seen.has(row.id)), ...agentRows]
  for (const row of kept) {
    if (row.autoClaims !== undefined) {
      matchedAgents.add(row.id)
    }
  }
  // The first store after a load rewrites the list, without entries that did not read back.
  savedAgents = ''
}

let savedTickets = ''
let savedTitle: string | undefined | null = null
let savedReserved = ''

/** Stores the rows when they changed since the last store, after the kept rows are loaded. */
function saveAgents($: EngineInterface): void {
  if (!isAgentsLoaded) {
    return
  }
  const tickets = JSON.stringify([...orchTickets])
  if (tickets !== savedTickets) {
    savedTickets = tickets
    void orchKey($).then(key => $.store.set(key, [...orchTickets])).catch(() => undefined)
  }
  if (orchTitle !== savedTitle) {
    savedTitle = orchTitle
    void orchTitleKey($).then(key => $.store.set(key, orchTitle ?? '')).catch(() => undefined)
  }
  const reserved = JSON.stringify([...reservedIds])
  if (reserved !== savedReserved) {
    savedReserved = reserved
    void reservedKey($).then(key => $.store.set(key, [...reservedIds])).catch(() => undefined)
  }
  const archived = JSON.stringify(archivedNow)
  if (archived !== savedArchived) {
    savedArchived = archived
    void archivedKey($).then(key => $.store.set(key, archivedNow)).catch(() => undefined)
  }
  const rows = agentRows.slice(-KEPT_AGENTS)
  const base = agentBase + agentRows.length - rows.length
  if (base !== savedBase) {
    savedBase = base
    void baseKey($).then(key => $.store.set(key, base)).catch(() => undefined)
  }
  const text = JSON.stringify(rows)
  if (text === savedAgents) {
    return
  }
  savedAgents = text
  void agentsKey($).then(key => $.store.set(key, rows)).catch(() => undefined)
}

const ENDED: readonly AgentRowStatus[] = ['completed', 'failed', 'killed', 'ended']

// ---------------------------------------------------------------- todo

const CHECKBOX = /^\s*[-*+] \[([ xX~>])\]\s+(.*)$/
/** A code fence line: up to 3 spaces, then 3+ backticks or 3+ tildes, then the rest. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** An open code fence: its character and the length of its opening run. */
interface Fence {
  char: string
  len: number
}

/** The fence a line opens, if any: a backtick fence's info string may not hold a backtick (CommonMark). */
function fenceOpens(line: string): Fence | undefined {
  const m = FENCE.exec(line)
  if (m === null || (m[1]![0] === '`' && m[2]!.includes('`'))) {
    return undefined
  }

  return { char: m[1]![0]!, len: m[1]!.length }
}

/** True when the line closes `open`: the same character, at least as long, and nothing else but spaces. */
function fenceCloses(line: string, open: Fence): boolean {
  const m = FENCE.exec(line)

  return m !== null && m[1]![0] === open.char && m[1]!.length >= open.len && m[2]!.trim() === ''
}

/** The fence state after one line: opens, closes or keeps. */
const fenceStep = (line: string, open: Fence | undefined): Fence | undefined => (open === undefined ? fenceOpens(line) : fenceCloses(line, open) ? undefined : open)

/** True when the text ends inside an open code fence. */
function endsInFence(lines: readonly string[]): boolean {
  return lines.reduce<Fence | undefined>((open, line) => fenceStep(bare(line), open), undefined) !== undefined
}

/** The line without a trailing carriage return: a CRLF file matches like an LF one. */
const bare = (line: string): string => line.replace(/\r$/, '')

/** Per line: true for a code fence line and for every line inside a fence. Such lines are never items or headings. */
function fenceMask(lines: readonly string[]): boolean[] {
  let open: Fence | undefined

  return lines.map(line => {
    const was = open
    open = fenceStep(line, open)

    return was !== undefined || open !== undefined
  })
}
/**
 * An item ID without its `#`: `T` and a digit, then digits and letters (`T12`, `T002A`), or the
 * older forms of any other letters and digits (`PROJ7`). Case-insensitive; `#TODO` is no ID.
 */
const ID_SRC = '(?:[Tt]\\d[0-9A-Za-z]*|[A-Za-z]+\\d+)'
const ITEM_ID = new RegExp(`#(${ID_SRC})\\b`)

/** The longest `T` suffix read as a number: longer ones would pass 2^53 in base 36. */
const SUFFIX_MAX = 10

/**
 * The base-36 value of a `T` ID (any case, no `#`); undefined for any other ID. The IDs the mod
 * creates are `T` and 4 base-36 characters (0-9, A-Z), the first a digit. An ID's value is its
 * suffix as a base-36 number (`25` is 77, `0026` is 78), so old and new IDs share one number line
 * and no value is handed out twice.
 */
export function ticketValue(id: string): number | undefined {
  const m = /^[Tt](\d[0-9A-Za-z]*)$/.exec(id)

  return m === null || m[1]!.length > SUFFIX_MAX ? undefined : parseInt(m[1]!, 36)
}

/**
 * The next `count` free ticket IDs (as `T0026`, no `#`): one past the highest value among `ids`,
 * the 4 characters padded with zeros and uppercase. A value whose form starts with a letter is
 * skipped. After `9ZZZ` there is no room in 4 characters, so the IDs go on at 5 (`T10000`), and so
 * on for 6; every ID still starts with a digit.
 */
export function nextTicketIds(ids: Iterable<string>, count: number): string[] {
  let next = 1
  for (const id of ids) {
    const value = ticketValue(id)
    if (value !== undefined) {
      next = Math.max(next, value + 1)
    }
  }
  const out: string[] = []
  while (out.length < count) {
    const suffix = next.toString(36).toUpperCase().padStart(4, '0')
    if (/^[A-Z]/.test(suffix)) {
      // Jump to the first value one character longer, whose form is `1` and zeros.
      next = 36 ** suffix.length
      continue
    }
    out.push(`T${suffix}`)
    next += 1
  }

  return out
}

/** An item's text as the pane shows it: Markdown bold and strike markers taken out, spaces trimmed. */
export function plainText(markdown: string): string {
  return markdown.replace(/\*\*|__|~~/g, '').trim()
}

/** Reads the checkbox items of one todo file, in the format the RULES block gives Claude. */
export function parseTodo(markdown: string): TodoItem[] {
  const items: TodoItem[] = []
  const lines = markdown.split('\n').map(bare)
  const isFenced = fenceMask(lines)
  for (const [at, line] of lines.entries()) {
    const match = isFenced[at] === true ? null : CHECKBOX.exec(line)
    if (match === null) {
      continue
    }
    const box = match[1] ?? ' '
    const status: TodoStatus =
      box === 'x' || box === 'X' ? 'completed' : box === '~' || box === '>' ? 'in_progress' : 'pending'
    const text = plainText(match[2] ?? '')
    const id = ITEM_ID.exec(text)?.[1]
    items.push(id === undefined ? { text, status } : { text, status, id })
  }

  return items
}

export function count(items: readonly TodoItem[]): { done: number; active: number; total: number } {
  return {
    done: items.filter(item => item.status === 'completed').length,
    active: items.filter(item => item.status === 'in_progress').length,
    total: items.length,
  }
}

/**
 * Finds the project's own todo folder: `.claude_todo/` at the root of the repo the session works
 * in, or of its main checkout from a git worktree (whose `.git` file names it; `.claude_todo/` may
 * be gitignored, so a worktree may have none). Outside a repo, only the session folder's own. Never
 * the `.claude_todo/` in the home `.claude` folder, which belongs to no project.
 */
export async function findTodoDir($: EngineInterface): Promise<string | undefined> {
  return findTodoDirWith({
    exists: path => $.fs.exists(path),
    kind: path => $.fs.stat(path).then(stat => stat.kind).catch(() => undefined),
    realPath: path => $.fs.stat(path, { resolve: true }).then(stat => stat.realPath).catch(() => undefined),
    read: path => $.fs.read(path).then(text => (typeof text === 'string' ? text : '')).catch(() => ''),
  })
}

/** The file system calls the todo lookup makes, apart from `$` so a test can lay out folders. */
export type TodoFs = {
  exists: (path: string) => Promise<boolean>
  kind: (path: string) => Promise<string | undefined>
  realPath: (path: string) => Promise<string | undefined>
  read: (path: string) => Promise<string>
}

export async function findTodoDirWith(fs: TodoFs): Promise<string | undefined> {
  const found = await repoTodoDir(fs)
  if (found === undefined) {
    return undefined
  }
  const real = await fs.realPath(found)

  return real !== undefined && isGlobalTodo(real) ? undefined : found
}

/**
 * True for the global todo folder, `<home>/.claude/.claude_todo`, which the mod never reads. A project's
 * own `<repo>/.claude/.claude_todo` is not it. On Windows the profile can live anywhere, so every
 * `.claude/.claude_todo` counts as global there.
 */
export function isGlobalTodo(realPath: string): boolean {
  return /^\/(Users|home)\/[^/]+\/\.claude\/\.claude_todo\/?$|^\/root\/\.claude\/\.claude_todo\/?$/.test(realPath) || /^[A-Za-z]:[\\/](.*[\\/])?\.claude[\\/]\.claude_todo[\\/]?$/i.test(realPath)
}

/**
 * A PowerShell expression for a path, built from its character codes: digits and commas only, so no
 * character in a file name (straight or curly quote, `$`, backtick) can end the string or run code.
 */
export function psPath(path: string): string {
  return `[string]::new([char[]](${[...path.replace(/\//g, '\\')].map(char => char.codePointAt(0)).join(',')}))`
}

/** True for a Windows absolute path, `C:/x` or `C:\x`. */
const isWinPath = (path: string): boolean => /^[A-Za-z]:[\\/]/.test(path)

/** A Windows path with forward slashes and an upper-case drive letter, so two spellings compare equal. Any other path is returned as it is (a backslash is a legal POSIX name character). */
function normPath(path: string): string {
  return isWinPath(path) ? path.replace(/\\/g, '/').replace(/^[a-z]:/, drive => drive.toUpperCase()) : path
}

/**
 * The nearest `.claude_todo/`, from the session folder up to the repo root: a subfolder with a todo
 * of its own keeps it. With none up to the root, a worktree uses its main checkout's. Outside a
 * repo, only the session folder's own counts.
 */
async function repoTodoDir(fs: TodoFs): Promise<string | undefined> {
  for (let depth = 0; depth <= MAX_UP; depth += 1) {
    const prefix = '../'.repeat(depth)
    if (await fs.exists(`${prefix}${DIR}`)) {
      // Taken only inside a repo: the walk must reach a .git at or above this folder.
      for (let up = depth; up <= MAX_UP; up += 1) {
        if (await fs.exists(`${'../'.repeat(up)}.git`)) {
          return `${prefix}${DIR}`
        }
      }

      return depth === 0 ? DIR : undefined
    }
    const git = `${prefix}.git`
    if (!(await fs.exists(git))) {
      continue
    }
    if ((await fs.kind(git)) === 'file') {
      const gitdir = /^gitdir:\s*(.+)$/m.exec(await fs.read(git))?.[1]?.trim()
      const main = gitdir?.split('/.git/worktrees/')[0]

      return main !== undefined && main !== gitdir && (await fs.exists(`${main}/${DIR}`)) ? `${main}/${DIR}` : undefined
    }

    return undefined
  }

  return undefined
}

// ---------------------------------------------------------------- folders

/** One `.claude_todo/` folder: `path` as the engine's fs takes it, `rel` from its checkout's root. */
export type TodoFolder = { path: string; rel: string; isOther: boolean; real?: string }

/** Most folders the pane reads: a repo with more is cut, primary folder first, then by path. */
export const MAX_FOLDERS = 20

/**
 * The `.claude_todo/` folders in the output of `git ls-files -z`: every entry with a `.claude_todo`
 * segment is cut to the folder path ending there. An ignored folder lists as a collapsed directory
 * entry (`x/.claude_todo/`), which cuts the same way. Duplicates drop; the order is by path.
 */
export function todoFoldersIn(listing: string, root: string): { path: string; rel: string }[] {
  const rels = new Set<string>()
  for (const entry of listing.split('\0')) {
    const parts = entry.split('/').filter(part => part !== '')
    const at = parts.indexOf(DIR)
    if (at >= 0) {
      rels.add(parts.slice(0, at + 1).join('/'))
    }
  }

  return [...rels].sort().map(rel => ({ path: `${root}/${rel}`, rel }))
}

/**
 * The repo root and, from a git worktree, its main checkout, from the output of
 * `git rev-parse --path-format=absolute --show-toplevel --git-common-dir`.
 */
export function repoRoots(stdout: string): { root: string; main?: string } | undefined {
  const [top, common] = stdout.split('\n').map(line => line.trim())
  if (top === undefined || top === '' || !(top.startsWith('/') || /^[A-Za-z]:\//.test(top))) {
    return undefined
  }
  const main = common !== undefined && common !== `${top}/.git` && common.endsWith('/.git') ? common.slice(0, -'/.git'.length) : undefined

  return main === undefined || main === '' ? { root: top } : { root: top, main }
}

/**
 * The folders the pane reads from those found: the global ones dropped, a place found twice kept
 * once (the primary's entry when it is one of them, else the first), the primary folder first and
 * the rest by path, cut to MAX_FOLDERS. `primary` is the `path` of the one folder the nearest-up
 * rule picks.
 */
export function pickFolders(found: readonly { path: string; rel: string; real?: string }[], primary: string | undefined, globals: ReadonlySet<string>): TodoFolder[] {
  const byRel = new Map<string, { path: string; rel: string; real?: string }>()
  for (const one of found) {
    if (globals.has(one.path)) {
      continue
    }
    const held = byRel.get(one.rel)
    if (held === undefined || (one.path === primary && held.path !== primary)) {
      byRel.set(one.rel, one)
    }
  }
  const kept = [...byRel.values()]
  const first = kept.filter(one => one.path === primary)
  const rest = kept.filter(one => one.path !== primary).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

  return [...first.map(one => ({ ...one, isOther: false })), ...rest.map(one => ({ ...one, isOther: true }))].slice(0, MAX_FOLDERS)
}

/** The `.claude_todo/` folders of a checkout, tracked, untracked and ignored, through git. */
async function listFolders($: EngineInterface, root: string): Promise<{ path: string; rel: string }[]> {
  const run = async (argv: string[]) => {
    const done = await $.process.run(argv, { cwd: root })

    return done.exitCode === 0 ? done.stdout : ''
  }
  const tracked = await run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  const ignored = await run(['git', 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])

  return todoFoldersIn(`${tracked}\0${ignored}`, root)
}

/** The real path of a folder, or undefined when it cannot be resolved. */
function realOf($: EngineInterface, path: string): Promise<string | undefined> {
  return $.fs.stat(path, { resolve: true }).then(stat => stat.realPath).catch(() => undefined)
}

/** The repo root of the session, kept to name a folder found later by its place in the repo. */
let repoRoot: string | undefined
/** Where the central todo lives: the root of the main checkout (the repo root outside a worktree). */
let centralRoot: string | undefined

/**
 * Finds every `.claude_todo/` folder of the repo (and of the main checkout, from a worktree) with
 * git. Outside a repo, or when git fails, only the nearest one by the old rule counts. A path git
 * lists but the disk no longer has (a tracked file deleted) is dropped.
 */
async function discoverFolders($: EngineInterface): Promise<TodoFolder[]> {
  const nearest = await findTodoDir($).catch(() => undefined)
  const nearestReal = nearest === undefined ? undefined : await realOf($, nearest)
  const alone: TodoFolder[] = nearest === undefined ? [] : [{ path: nearest, rel: nearest, isOther: false, ...(nearestReal === undefined ? {} : { real: nearestReal }) }]
  try {
    const top = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
    const roots = top.exitCode === 0 ? repoRoots(top.stdout) : undefined
    if (roots === undefined) {
      return alone
    }
    repoRoot = roots.root
    centralRoot = roots.main ?? roots.root
    // Consolidate and Delete are off in a linked worktree and when the main folder is the global one.
    const centralPath = `${centralRoot}/${DIR}`
    centralBlocked = roots.main !== undefined || isGlobalTodo(centralPath) || isGlobalTodo((await realOf($, centralPath)) ?? centralPath)
    const listed = [...(await listFolders($, roots.root)), ...(roots.main === undefined ? [] : await listFolders($, roots.main))]
    const found: { path: string; rel: string; real?: string }[] = []
    const globals = new Set<string>()
    let primary: string | undefined
    for (const one of listed) {
      if (!(await $.fs.exists(one.path).catch(() => false))) {
        continue
      }
      const real = await realOf($, one.path)
      found.push(real === undefined ? one : { ...one, real })
      if (isGlobalTodo(real ?? one.path)) {
        globals.add(one.path)
      }
      if (real !== undefined && real === nearestReal && primary === undefined) {
        primary = one.path
      }
    }
    if (nearest !== undefined && primary === undefined) {
      // The nearest folder git did not list: keep it, named by its place in the repo when that shows.
      found.unshift({ path: nearest, rel: relIn(nearestReal, roots.root) ?? nearest, ...(nearestReal === undefined ? {} : { real: nearestReal }) })
      primary = nearest
    }

    return pickFolders(found, primary, globals)
  } catch {
    return alone
  }
}

/** A real path from the repo root, or undefined when it lies outside the root. */
function relIn(real: string | undefined, root: string | undefined): string | undefined {
  return real !== undefined && root !== undefined && real.startsWith(`${root}/`) ? real.slice(root.length + 1) : undefined
}

/** The folders found when the mod started; undefined until then. Git runs once per load; a reload does it again. */
let todoFolders: TodoFolder[] | undefined
let folderSearch: Promise<TodoFolder[]> | undefined
/** The nearest folder the last scan saw, to look it up among the known ones only when it changes. */
let nearestSeen: string | undefined

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
/** The empty `.md` files of the known folders, found by the last scan: the Delete empty todos button's work. */
let emptyFiles: { folder: string; path: string; name: string; rel?: string }[] = []
/** True when the central target file holds two or more identical tickets: the Delete duplicate tickets button's work. */
let hasDupTickets = false

/** The central folder: `<root of the main checkout>/.claude_todo`. */
function centralFolder(): string | undefined {
  return centralRoot === undefined ? undefined : `${centralRoot}/${DIR}`
}

/**
 * True when the Consolidate todos button shows: a repo's main checkout (not a worktree, not the
 * global folder), and more than one top-level todo file on the board, in any folder.
 */
function canConsolidate(): boolean {
  return !centralBlocked && centralRoot !== undefined && todoFiles.filter(file => file.isArchived !== true).length > 1
}

/** True when the Delete empty todos button shows: the same gate, and an empty `.md` file in a known folder. */
function canDeleteEmpty(): boolean {
  return !centralBlocked && centralRoot !== undefined && emptyFiles.length > 0
}

/** True when the Delete duplicate tickets button shows: the same gate, and identical tickets in the target file. */
function canDeleteDupTickets(): boolean {
  return !centralBlocked && centralRoot !== undefined && hasDupTickets
}

/** Every checkbox line of a todo file's text, as written. */
export function itemLines(markdown: string): string[] {
  return markdown.split('\n').filter(line => CHECKBOX.test(line))
}

/** Every line of the text with something on it, trailing spaces cut. */
export function nonBlankLines(markdown: string): string[] {
  return markdown.split('\n').map(line => line.trimEnd()).filter(line => line.trim() !== '')
}

/** The line with every `#ID` in the map replaced by its new one (one pass, so a new ID is never renamed again). */
export function applyRenames(line: string, renames: Readonly<Record<string, string>>): string {
  return line.replace(new RegExp(`#(${ID_SRC})\\b`, 'g'), (whole, id: string) => {
    const fresh = renames[id.toLowerCase()]

    return fresh === undefined ? whole : `#${fresh}`
  })
}

/** Like `applyRenames`, but a ticket line keeps its own leading ID: only its references change. */
export function applyRefRenames(line: string, renames: Readonly<Record<string, string>>): string {
  const m = new RegExp(`^(\\s*[-*+] \\[[ xX~>]\\]\\s+#${ID_SRC})(.*)$`).exec(line)

  return m === null ? applyRenames(line, renames) : `${m[1]}${applyRenames(m[2]!, renames)}`
}

/**
 * The lines of one source file with every item ID that `used` has already replaced by the next free
 * ID (`` when `#T1` and `#T2` are taken; `#PROJ3` for other letters), and the references to it in the other
 * lines of the file rewritten the same way. `used` (lowercase IDs) gains each ID the file ends up with.
 * `renames` maps old (lowercase) to new; `pairs` lists them as written, for the toast. A new ID also
 * skips every ID in `reserved` (lowercase): the IDs of the other files still to come.
 */
export function renumberLines(lines: readonly string[], used: Set<string>, reserved: ReadonlySet<string> = new Set()): { lines: string[]; renames: Record<string, string>; pairs: { from: string; to: string }[] } {
  const renames: Record<string, string> = {}
  const pairs: { from: string; to: string }[] = []
  // A new number also skips this source's own IDs, so one clash never pushes a later line out.
  const own = lines.flatMap(line => {
    const id = CHECKBOX.test(line) ? ITEM_ID.exec(line)?.[1] : undefined

    return id === undefined ? [] : [id.toLowerCase()]
  })
  // Other letters than `T` keep the older rule: the next number after the highest one of those letters.
  const nextFree = (letters: string) => {
    const all = [...used, ...own, ...reserved]
    if (letters.toLowerCase() === 't') {
      return nextTicketIds(all, 1)[0]!
    }
    let top = 0
    for (const id of all) {
      const m = /^([a-z]+)(\d+)$/.exec(id)
      if (m !== null && m[1] === letters.toLowerCase()) {
        top = Math.max(top, Number(m[2]))
      }
    }

    return `${letters}${top + 1}`
  }
  for (const line of lines) {
    const id = CHECKBOX.test(line) ? ITEM_ID.exec(line)?.[1] : undefined
    if (id === undefined) {
      continue
    }
    if (renames[id.toLowerCase()] !== undefined) {
      continue
    }
    if (!used.has(id.toLowerCase())) {
      used.add(id.toLowerCase())
      continue
    }
    const fresh = nextFree(/^[A-Za-z]+/.exec(id)?.[0] ?? 'T')
    used.add(fresh.toLowerCase())
    renames[id.toLowerCase()] = fresh
    pairs.push({ from: id, to: fresh })
  }

  return { lines: lines.map(line => applyRenames(line, renames)), renames, pairs }
}

/** The text of a target file with new sections added: kept as it was, then each `## From <place>` block. */
export function appendSections(existing: string, sections: readonly { place: string; lines: readonly string[] }[]): string {
  let text = existing
  for (const section of sections) {
    const gap = text.trim() === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n'
    text = `${text}${gap}## From ${section.place}\n\n${section.lines.join('\n')}\n`
  }

  return text
}

/** The one-time note for Claude after duplicate tickets were removed. */
export function removedNote(lines: readonly string[]): string | undefined {
  return lines.length === 0
    ? undefined
    : [
        'The Claudeopticon pane (the claudeopticon mod) removed duplicate tickets from the central todo file, and rewrote references to them. Use the kept IDs from now on:',
        ...lines,
      ].join('\n')
}

/** How many free IDs the prompt line names. */
const NEXT_IDS_SHOWN = 3

/** The line that gives Claude the next free ticket IDs, project-wide. */
export function nextIdsLine(ids: Iterable<string>): string {
  return `Next free ticket IDs: ${nextTicketIds(ids, NEXT_IDS_SHOWN).map(id => `#${id}`).join(', ')}`
}

/** The one-time note for Claude after the mod gave IDs to tickets that had none. */
export function numberedNote(lines: readonly string[]): string | undefined {
  return lines.length === 0
    ? undefined
    : [
        'The Claudeopticon pane (the claudeopticon mod) gave an ID to these todo tickets that had none, and wrote it into the todo file. Use these IDs from now on:',
        ...lines,
      ].join('\n')
}

/** Every item ID of every todo and archive file on the board, lowercase: all folders, the project-wide number line. */
function projectIds(): string[] {
  return todoFiles.flatMap(file => file.items.flatMap(item => (item.id === undefined ? [] : [item.id.toLowerCase()])))
}

/** The one-time note for Claude after IDs were renumbered. */
export function renameNote(lines: readonly string[]): string | undefined {
  return lines.length === 0
    ? undefined
    : [
        'The Claudeopticon pane (the claudeopticon mod) consolidated several .claude_todo/ folders into the repo\'s main one. These item IDs collided and were renumbered in the copies. Use the new IDs from now on:',
        ...lines,
      ].join('\n')
}

/** Where a folder sits in its checkout, for the heading in the central file: its path without `.claude_todo`. */
function placeOf(rel: string): string {
  const place = rel.slice(0, Math.max(0, rel.length - DIR.length)).replace(/\/$/, '')

  return place === '' ? 'the root of another checkout' : place
}

/** A folder's place in its checkout, for telling same-named files apart: its path without `.claude_todo`; empty at the repo root. */
export function folderPlace(rel: string): string {
  return rel.slice(0, Math.max(0, rel.length - DIR.length)).replace(/\/$/, '')
}

/** The `.md` files of a folder, top level and archive, as names inside it. */
async function mdFiles($: EngineInterface, folder: string, isStrict = false): Promise<string[]> {
  const names: string[] = []
  for (const [dir, prefix] of [[folder, ''], [`${folder}/archive`, 'archive/']] as const) {
    // Strict, a folder that will not answer or list is an error, not an empty or absent folder.
    if (!(isStrict ? await $.fs.exists(dir) : await $.fs.exists(dir).catch(() => false))) {
      continue
    }
    for (const entry of isStrict ? await $.fs.list(dir) : await $.fs.list(dir).catch(() => [])) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) {
        names.push(`${prefix}${entry.name}`)
      }
    }
  }

  return names
}

/** The text of a file that must read: a failed read is an error, not an empty file. */
async function readStrict($: EngineInterface, path: string): Promise<string> {
  const text = await $.fs.read(path)
  if (typeof text !== 'string') {
    throw new Error(`could not read ${path}`)
  }

  return text
}

async function readText($: EngineInterface, path: string): Promise<string> {
  const text = await $.fs.read(path).catch(() => '')

  return typeof text === 'string' ? text : ''
}

/** Writes a file, making its folder first through `mkdir -p` (no shell) when the plain write fails. */
async function writeFile($: EngineInterface, path: string, text: string): Promise<void> {
  try {
    await $.fs.write(path, text)
  } catch (error) {
    const dir = path.slice(0, path.lastIndexOf('/'))
    const made = await $.process.run(['mkdir', '-p', dir]).catch(() => undefined)
    if (made?.exitCode !== 0) {
      throw error
    }
    await $.fs.write(path, text)
  }
}

let isWorking = false

/**
 * The one writer lock of the todo files: a promise chain, so a user action waits its turn, and a
 * count of the jobs queued or running, so a scan writer sees the lock held at once (no gap between
 * two chained jobs). Two writers never overlap, which keeps one from writing over the other's change.
 */
let writeChain: Promise<unknown> = Promise.resolve()
let writeJobs = 0

/** Runs `job` once every earlier writer is done. A failed job does not break the chain. */
function withWriteLock<T>(job: () => Promise<T>): Promise<T> {
  writeJobs += 1
  const run = writeChain.then(job)
  writeChain = run.then(() => undefined, () => undefined).finally(() => {
    writeJobs -= 1
  })

  return run
}

/** For a scan writer: runs `job` if no writer holds the lock, else skips this scan (undefined). */
async function tryWriteLock<T>(job: () => Promise<T>): Promise<T | undefined> {
  return writeJobs > 0 ? undefined : withWriteLock(job)
}

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

/** The file a source file is judged against in the central folder: the target for a top-level file, the same-named archive file for an archive file. */
const destOf = (name: string, target: string): string => (name.startsWith('archive/') ? name : target)

/**
 * The parts of a ticket line that a fold compares: everything but the item's own leading `#T<n>` ID,
 * kept letter for letter (bullet, box, spacing, text), and that ID. Undefined for any other line.
 */
export function foldParts(line: string): { key: string; id: string } | undefined {
  const m = new RegExp(`^(\\s*[-*+] \\[[ xX~>]\\]\\s+)#(${ID_SRC})(?=\\s|$)(.*)$`).exec(line.trimEnd())

  return m === null ? undefined : { key: `${m[1]}#${m[3]}`, id: m[2]! }
}

/** True for a regular file that is its own real path: no symlink in the file or the folders above it. */
async function isPlainFile($: EngineInterface, path: string): Promise<boolean> {
  const stat = await $.fs.stat(path).catch(() => undefined)

  const real = await realOf($, path)

  return stat !== undefined && stat.kind === 'file' && real !== undefined && normPath(real) === normPath(path)
}

/** True when anything stands at the path's name in its folder, a dangling symlink included; a folder that will not list counts as yes. */
async function hasEntry($: EngineInterface, path: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  if (!(await $.fs.exists(dir).catch(() => true))) {
    return false
  }
  const entries = await $.fs.list(dir).catch(() => undefined)

  return entries === undefined || entries.some(entry => entry.name === path.slice(dir.length + 1))
}

/**
 * Whether a folder may be changed by the mod: an absolute path with no `..`, ending in
 * `.claude_todo`, that is its own real path (so no symlink is in it), inside the main checkout, and
 * not the global one.
 */
async function isTrustedDir($: EngineInterface, path: string): Promise<boolean> {
  const parts = path.split('/')
  if (!(path.startsWith('/') || /^[A-Za-z]:\//.test(path)) || parts.includes('..') || parts.filter(part => part !== '').pop() !== DIR) {
    return false
  }
  const real = await realOf($, path)
  const root = centralRoot === undefined ? undefined : await realOf($, centralRoot)

  if (real === undefined || root === undefined) {
    return false
  }
  const [nReal, nRoot] = [normPath(real), normPath(root)]

  return nReal === normPath(path) && nReal.startsWith(`${nRoot}/`) && !isGlobalTodo(nReal)
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
  if (isWorking || isArchiving || isNumbering || central === undefined || !canConsolidate()) {
    return
  }
  isWorking = true
  try {
    const sources: { path: string; rel: string }[] = []
    for (const one of todoFolders ?? []) {
      if (one.path !== central && (await isTrustedDir($, one.path))) {
        sources.push({ path: one.path, rel: one.rel })
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
      const text = (await $.fs.exists(path)) ? await readStrict($, path) : ''
      texts.set(name, text)

      return text
    }
    // One target file takes everything; the central folder's other top-level todo files are merged into it.
    const centralNames = await mdFiles($, central, true)
    const topNames = centralNames.filter(name => !name.startsWith('archive/'))
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
    type Job = { path: string; name: string; heading: string; text: string; dest: string; lines: string[] }
    const jobs: Job[] = []
    const add = (path: string, name: string, heading: string, text: string) => {
      const lines = nonBlankLines(text)
      if (lines.length > 0) {
        jobs.push({ path, name, heading, text, dest: destOf(name, target), lines })
      }
    }
    for (const name of mergeNames) {
      if (await isPlainFile($, `${central}/${name}`)) {
        add(`${central}/${name}`, name, name, await centralText(name))
      }
    }
    // A source that will not list or read stays as it is: nothing of it is copied.
    for (const source of sources) {
      const names = await mdFiles($, source.path, true).catch(() => undefined)
      const read: { name: string; text: string }[] = []
      for (const name of names ?? []) {
        // A file behind a symlink (or in a symlinked archive/) counts as unreadable: the source stays.
        const isPlain = await isPlainFile($, `${source.path}/${name}`)
        const text = isPlain ? await readStrict($, `${source.path}/${name}`).catch(() => undefined) : undefined
        if (text === undefined) {
          read.length = 0
          break
        }
        read.push({ name, text })
      }
      for (const one of read) {
        add(`${source.path}/${one.name}`, one.name, `${placeOf(source.rel)}/${one.name}`, one.text)
      }
    }
    if (jobs.length === 0) {
      return
    }
    // The blocks per destination, with the renumbering of each file.
    const blocks = new Map<string, { place: string; lines: string[] }[]>()
    const told: string[] = []
    const out = new Map<Job, string[]>()
    // Every ID of every moved file: a new ID never takes one a later file keeps, so one clash renames one line.
    // The IDs of every folder and archive on the board are reserved too: a new value is free project-wide.
    const reserved = new Set([
      ...projectIds(),
      ...reservedIds,
      ...jobs.flatMap(job => job.lines.flatMap(line => {
        const id = CHECKBOX.test(line) ? ITEM_ID.exec(line)?.[1] : undefined

        return id === undefined ? [] : [id.toLowerCase()]
      })),
    ])
    for (const job of jobs) {
      const fresh = renumberLines(job.lines, used, reserved)
      out.set(job, fresh.lines)
      blocks.set(job.dest, [...(blocks.get(job.dest) ?? []), { place: job.heading, lines: fresh.lines }])
      told.push(...fresh.pairs.map(pair => `- ${job.heading}: #${pair.from} is now #${pair.to}`))
    }
    const emptied: string[] = []
    const left: string[] = []
    const skipped: string[] = []
    for (const [dest, list] of blocks) {
      const path = `${central}/${dest}`
      const folder = path.slice(0, path.lastIndexOf('/'))
      // Never written through a symlink: the central folder, its archive/ and an existing file must be their own real paths.
      const isSafe =
        (await isTrustedDir($, central)) &&
        (!(await $.fs.exists(folder)) || (await realOf($, folder)) === folder) &&
        (!(await $.fs.exists(path)) || (await isPlainFile($, path)))
      if (!isSafe) {
        skipped.push(`${DIR}/${dest} (symlink)`)
        continue
      }
      // The destination may have changed since the press read it: then it is not written, and its sources stay.
      const before = await centralText(dest)
      const now = (await $.fs.exists(path)) ? await readStrict($, path) : ''
      if (now !== before) {
        skipped.push(`${DIR}/${dest}`)
        continue
      }
      await writeFile($, path, appendSections(now, list))
      // Confirmed from the disk before any source is emptied.
      const after = await readStrict($, path)
      const isThere = list.every(block => after.includes(`## From ${block.place}\n\n${block.lines.join('\n')}\n`))
      if (!isThere) {
        skipped.push(`${DIR}/${dest} (not confirmed)`)
        continue
      }
      for (const job of jobs.filter(one => one.dest === dest)) {
        if (job.path === path) {
          continue
        }
        // Emptied only if it is still what was copied.
        const nowText = await readStrict($, job.path).catch(() => undefined)
        if (nowText === job.text && (await isPlainFile($, job.path))) {
          await $.fs.write(job.path, '')
          emptied.push(job.path)
        } else {
          left.push(job.path)
        }
      }
    }
    pendingRenames = [...pendingRenames, ...told]
    // The one discovery outside startup: the git index again.
    todoFolders = undefined
    folderSearch = undefined
    nearestSeen = undefined
    await ensureFolders($)
    await scan($, true)
    if (skipped.length > 0) {
      $.ui.toast(`Not written, changed meanwhile: ${skipped.join(', ')}. Their sources are as they were. Press Consolidate todos again.`)
    }
    if (left.length > 0) {
      $.ui.toast(`Left as they are, changed since the copy: ${left.join(', ')}`)
    }
    $.ui.toast(`Moved ${emptied.length} ${emptied.length === 1 ? 'file' : 'files'} into ${DIR}/${target} at the repo root.${told.length > 0 ? ` Renumbered: ${told.map(line => line.slice(2)).join('; ')}` : ''}`)
  } catch (error) {
    $.ui.toast(`Could not consolidate: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isWorking = false
    redraw($)
  }
}

// ---------------------------------------------------------------- archiving closed tickets

/** A closed ticket is moved once it has been closed this long: a mis-click on Mark done can still be undone. */
const ARCHIVE_AFTER_MS = 5000
const HEADING = /^#{1,6}\s/

/** A closed ticket in a todo file's text: its lines, where they sit (`from` to `to`, end excluded), and the heading above it. */
export type ClosedBlock = { heading?: string; lines: string[]; from: number; to: number }

/** True for a line that is, or looks like, a checkbox that is not done: a line that looks like one but fails the match counts open. */
function isOpenLine(line: string): boolean {
  const box = CHECKBOX.exec(line)?.[1]
  if (box !== undefined) {
    return box.toLowerCase() !== 'x'
  }

  return /^\s*[-*+] \[[^\]]*\]/.test(line)
}

/**
 * The tickets of a todo file that can leave it: a top-level `- [x]` line plus the indented lines
 * under it, when every checkbox in that block is `[x]`. The block runs past blank lines while the
 * next non-blank line is indented. An open or in-progress subtask keeps the whole block, and so does
 * a code fence line in it. Prose, headings and tables are never part of a block. The heading is the
 * last heading line above the block (any level), outside code fences. A trailing carriage return
 * is ignored, so a CRLF file reads as an LF one; `lines` are without it.
 */
export function closedBlocks(markdown: string): ClosedBlock[] {
  const lines = markdown.split('\n').map(bare)
  const blocks: ClosedBlock[] = []
  let heading: string | undefined
  let open: Fence | undefined
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const isFenced = open !== undefined
    if (isFenced || fenceOpens(line) !== undefined) {
      open = fenceStep(line, open)
    } else if (HEADING.test(line)) {
      heading = line.trimEnd()
    } else if (/^[-*+] \[[xX]\]\s+/.test(line)) {
      // The block ends at its last indented line; blank lines after it are not taken.
      let end = i + 1
      for (let at = i + 1; at < lines.length && (lines[at]!.trim() === '' || /^[ \t]+\S/.test(lines[at]!)); at += 1) {
        end = lines[at]!.trim() === '' ? end : at + 1
      }
      const block = lines.slice(i, end)
      // A fence line in a block is not skipped: the walk goes on line by line so the fence state stays true.
      if (block.some(one => fenceOpens(one) !== undefined || FENCE.test(one))) {
        i += 1

        continue
      }
      if (!block.some(isOpenLine)) {
        blocks.push({ ...(heading === undefined ? {} : { heading }), lines: block, from: i, to: end })
      }
      i = end

      continue
    }
    i += 1
  }

  return blocks
}

/** The text without the lines of the given blocks; everything else stays as it was. */
export function removeBlocks(markdown: string, blocks: readonly ClosedBlock[]): string {
  return markdown.split('\n').filter((_, i) => !blocks.some(block => i >= block.from && i < block.to)).join('\n')
}

/**
 * True when `block` stands in `lines` as one whole block: its lines in order (trailing spaces
 * ignored), from a non-indented first line, and the next non-blank line after it is not indented.
 */
function hasBlock(lines: readonly string[], block: readonly string[]): boolean {
  const flat = lines.map(line => bare(line).trimEnd())
  const want = block.map(line => bare(line).trimEnd())

  return flat.some((_, at) => {
    if (!want.every((line, k) => flat[at + k] === line)) {
      return false
    }
    const after = flat.slice(at + want.length).find(line => line.trim() !== '')

    return after === undefined || !/^[ \t]/.test(after)
  })
}

/**
 * The archive file's text with the blocks added. A block goes at the end of the section under its
 * own heading when the archive has that heading (the last one, outside code fences), else the
 * heading is added at the end of the file; a block with no heading goes at the end. A block is
 * skipped only when it stands whole in the archive AND is one of `wrote`, the blocks this mod wrote
 * last for the file: a retry never adds a block twice, and a new block that equals an old archived
 * one is added. Lines end with the archive's own line ending (CRLF if it has one), else `eol`.
 */
export function addToArchive(existing: string, blocks: readonly ClosedBlock[], wrote: readonly (readonly string[])[] = [], eol = '\n'): string {
  const lines = existing.trim() === '' ? [] : existing.replace(/(\r?\n)+$/, '').split('\n').map(bare)
  const end = existing.includes('\r\n') ? '\r\n' : existing.trim() === '' ? eol : '\n'
  const base = [...lines]
  const wroteSet = new Set(wrote.map(one => one.join('\n')))
  const headings = [...new Set(blocks.map(block => block.heading))]
  for (const heading of headings) {
    const fresh = blocks.filter(block => block.heading === heading && !(hasBlock(base, block.lines) && wroteSet.has(block.lines.join('\n')))).flatMap(block => block.lines)
    if (fresh.length === 0) {
      continue
    }
    const isFenced = fenceMask(lines)
    const at = heading === undefined ? -1 : lines.map((line, k) => (!isFenced[k] && line.trimEnd() === heading ? k : -1)).reduce((last, k) => Math.max(last, k), -1)
    if (heading === undefined) {
      lines.push(...fresh)
    } else if (at < 0) {
      lines.push(...(lines.length > 0 ? [''] : []), heading, '', ...fresh)
    } else {
      let stop = lines.findIndex((line, k) => k > at && !isFenced[k] && HEADING.test(line))
      stop = stop < 0 ? lines.length : stop
      while (stop - 1 > at && lines[stop - 1]!.trim() === '') {
        stop -= 1
      }
      const isNext = stop < lines.length
      lines.splice(stop, 0, ...(stop === at + 1 ? [''] : []), ...fresh, ...(isNext && lines[stop]!.trim() !== '' ? [''] : []))
    }
  }

  return `${lines.join(end)}${end}`
}

/**
 * The name of the archive file the Show completed link opens, for a folder: a `TODO.md` (any case)
 * among its todo or archive files; else its only live file; else its only archive file; else `TODO.md`.
 */
export function archiveName(files: readonly { name: string; folder: string; isArchived?: boolean }[], folder: string): string {
  const mine = files.filter(file => file.folder === folder)
  const live = mine.filter(file => file.isArchived !== true).map(file => file.name)
  const old = mine.filter(file => file.isArchived === true).map(file => file.name.slice('archive/'.length))

  return [...live, ...old].find(name => name.toLowerCase() === 'todo.md') ?? (live.length === 1 ? live[0] : old.length === 1 ? old[0] : undefined) ?? 'TODO.md'
}

/** The archive file the Show completed link opens; undefined until a scan has made sure it exists. */
let archiveLink: string | undefined

/**
 * Works out the archive file of the central folder (else the primary one) and creates it, empty,
 * when it is missing and the folder is safe to write, so the link always opens something.
 */
async function refreshArchiveLink($: EngineInterface): Promise<void> {
  const folders = todoFolders ?? []
  const central = centralFolder()
  const folder = folders.find(one => one.path === central) ?? folders.find(one => !one.isOther)
  let link: string | undefined
  if (folder !== undefined) {
    const dir = `${folder.path}/archive`
    const path = `${dir}/${archiveName(todoFiles, folder.path)}`
    if (await $.fs.exists(path).catch(() => false)) {
      link = path
    } else if ((await isTrustedDir($, folder.path)) && (!(await $.fs.exists(dir).catch(() => false)) || normPath((await realOf($, dir)) ?? '') === normPath(dir)) && !(await hasEntry($, path))) {
      await writeFile($, path, '').catch(() => undefined)
      link = (await $.fs.exists(path).catch(() => false)) ? path : undefined
    }
  }
  if (link !== archiveLink) {
    archiveLink = link
    redraw($)
  }
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
async function archiveDone($: EngineInterface): Promise<void> {
  if (isArchiving || isWorking) {
    return
  }
  isArchiving = true
  try {
    // A held lock skips this scan; the next one tries again.
    const isMoved = (await tryWriteLock(() => archivePass($))) === true
    if (isMoved) {
      await scan($, true)
    }
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
    const text = await $.fs.read(path).catch(() => undefined)
    if (typeof text !== 'string') {
      continue
    }
    const ready = closedBlocks(text).filter(block => {
      const sign = `${path}\0${block.lines.join('\n')}`
      seen.add(sign)
      closedAt.set(sign, closedAt.get(sign) ?? time)

      return time - closedAt.get(sign)! >= ARCHIVE_AFTER_MS
    })
    // One file that fails leaves itself as it is; the others go on.
    if (ready.length > 0 && (await moveBlocks($, file, path, text, ready).catch(() => false))) {
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

/** The blocks this mod wrote last to each archive file (by path), as lines: a retry skips only these. Cleared once the source is cut. */
const lastWrote = new Map<string, string[][]>()

/** Puts the archive back to `before` when it still holds exactly `next`, the text the step wrote; a changed archive is left. */
async function rollBack($: EngineInterface, target: string, before: string, next: string): Promise<void> {
  if ((await isPlainFile($, target)) && (await readStrict($, target).catch(() => undefined)) === next) {
    await $.fs.write(target, before).catch(() => undefined)
    lastWrote.delete(target)
  }
}

/** The archive files already named in an "unclosed code block" toast: one toast each, per session. */
const unclosedToasted = new Set<string>()

/** One file's move; true when the file was rewritten without the blocks. */
async function moveBlocks($: EngineInterface, file: TodoFile, path: string, text: string, ready: readonly ClosedBlock[]): Promise<boolean> {
  const dir = `${file.folder}/archive`
  const target = `${dir}/${file.name}`
  const isThere = await $.fs.exists(target)
  // Never written through a symlink: archive/ and an existing archive file must be their own real paths.
  // A missing archive file with anything at its name (a dangling symlink) is left alone.
  if (((await $.fs.exists(dir)) && normPath((await realOf($, dir)) ?? '') !== normPath(dir)) || (isThere ? !(await isPlainFile($, target)) : await hasEntry($, target))) {
    return false
  }
  const before = isThere ? await readStrict($, target) : ''
  // Text added after an open code fence would sit inside it, and read as code: the move waits for a fix.
  if (endsInFence(before.split('\n'))) {
    if (!unclosedToasted.has(target)) {
      unclosedToasted.add(target)
      $.ui.toast(`Not archived: ${target} has an unclosed code block`)
    }

    return false
  }
  const next = addToArchive(before, ready, lastWrote.get(target) ?? [], text.includes('\r\n') ? '\r\n' : '\n')
  let isWritten = false
  if (next !== before) {
    // The checks first, then the read and compare as the last call before the write.
    const now = await $.fs.exists(target)
    if (now !== isThere || (now ? !(await isPlainFile($, target)) : await hasEntry($, target)) || (now ? await readStrict($, target) : '') !== before) {
      return false
    }
    lastWrote.set(target, ready.map(block => block.lines))
    await writeFile($, target, next)
    isWritten = true
  }
  // Confirmed from the disk before the source is touched.
  const after = (await readStrict($, target)).split('\n')
  if (!ready.every(block => hasBlock(after, block.lines))) {
    return false
  }
  if (!(await isPlainFile($, path)) || (await readStrict($, path).catch(() => undefined)) !== text) {
    // The source changed: the archive goes back, so the blocks are not in two places.
    if (isWritten) {
      await rollBack($, target, before, next)
    }

    return false
  }
  await $.fs.write(path, removeBlocks(text, ready))
  lastWrote.delete(target)
  const moved = ready.flatMap(block => {
    const item = parseTodo(block.lines[0]!)[0]

    return item === undefined
      ? []
      : [{ text: item.text, status: 'completed' as const, owners: [], key: qualifiedKey(file, item), localKey: itemKey(item), folder: file.folder, file: `archive/${file.name}`, path: filePath({ ...file, name: `archive/${file.name}` }) } satisfies ItemView]
  })
  archivedNow = [...moved, ...archivedNow].slice(0, KEPT_ARCHIVED)

  return true
}

/** The first time a line was seen without an ID, by file and text: the debounce. */
const unnumberedAt = new Map<string, number>()
const NUMBER_AFTER_MS = 5000
let isNumbering = false

/** The ID a checkbox line carries (no `#`), read as the parser reads it; undefined for a line with none. */
function lineId(line: string): string | undefined {
  const m = CHECKBOX.exec(line)

  return m === null ? undefined : ITEM_ID.exec(plainText(m[2] ?? ''))?.[1]
}

/** The item's leading ID (no `#`): the one right after the box, at the start of its text. */
const leadingId = (text: string): string | undefined => new RegExp(`^#(${ID_SRC})\\b`).exec(text)?.[1]

/**
 * The item's own ID for a checkbox line's text. A leading ID is its own. Else the first ID anywhere,
 * unless another ticket owns that ID as its leading ID (`owned`, lowercase): then the line only
 * refers to that ticket and has no ID of its own.
 */
function ownId(text: string, owned: ReadonlySet<string>): string | undefined {
  const lead = leadingId(text)
  const first = ITEM_ID.exec(text)?.[1]

  return lead ?? (first !== undefined && owned.has(first.toLowerCase()) ? undefined : first)
}

/** True for a checkbox line that has text and no ID of its own. */
const isUnnumbered = (line: string, owned: ReadonlySet<string>): boolean => {
  const m = CHECKBOX.exec(line)

  return m !== null && (m[2] ?? '').trim() !== '' && ownId(plainText(m[2] ?? ''), owned) === undefined
}

/**
 * The text with `ids` inserted, in order, right after the box of each line in `at` (line indexes):
 * `- [ ] Fix x` becomes `- [ ] Fix x`.
 */
export function insertIds(text: string, at: readonly number[], ids: readonly string[]): string {
  const lines = text.split('\n')
  at.forEach((index, i) => {
    lines[index] = lines[index]!.replace(/^(\s*[-*+] \[[ xX~>]\]\s+)/, `$1#${ids[i]!} `)
  })

  return lines.join('\n')
}

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

/** One numbering pass, under the writer lock. */
async function numberPass($: EngineInterface): Promise<boolean> {
  const time = await $.clock.now()
  const seen = new Set<string>()
  // The leading IDs of every ticket on the board: a line that only names one of them refers to it.
  const owned = new Set(todoFiles.flatMap(file => file.items.flatMap(item => leadingId(item.text) ?? [])).map(id => id.toLowerCase()))
  const told: string[] = []
  for (const file of todoFiles) {
    if (file.isArchived === true || file.name.includes('/') || file.items.every(item => item.id !== undefined && (leadingId(item.text) !== undefined || !owned.has(item.id.toLowerCase())))) {
      continue
    }
    const path = `${file.folder}/${file.name}`
    if (!(await isTrustedDir($, file.folder)) || !(await isPlainFile($, path))) {
      continue
    }
    const text = await $.fs.read(path).catch(() => undefined)
    if (typeof text !== 'string') {
      continue
    }
    // A carriage return never reaches a match, and a line in a code fence is never a ticket.
    const lines = text.split('\n').map(bare)
    const isFenced = fenceMask(lines)
    lines.forEach((line, index) => {
      const m = isFenced[index] === true ? null : CHECKBOX.exec(line)
      const id = m === null ? undefined : leadingId(plainText(m[2] ?? ''))
      if (id !== undefined) {
        owned.add(id.toLowerCase())
      }
    })
    const at: number[] = []
    lines.forEach((line, index) => {
      if (isFenced[index] === true || !isUnnumbered(line, owned)) {
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
    // The IDs are chosen now, from the board, the IDs reserved at this moment (a prompt may have named
    // some while this pass awaited) and the file's own text, which may be newer than the board. They are
    // reserved in the same step, with no await between: a prompt after this never names them, and
    // they stay reserved until a scan finds them in a file.
    pruneReserved()
    const ids = nextTicketIds([...projectIds(), ...reservedIds, ...lines.flatMap(line => lineId(line)?.toLowerCase() ?? [])], at.length)
    ids.forEach(id => reservedIds.add(id.toLowerCase()))
    const next = insertIds(text, at, ids)
    // The checks first, then the read and compare as the last call before the write.
    if (!(await isPlainFile($, path)) || (await readStrict($, path).catch(() => undefined)) !== text) {
      ids.forEach(id => reservedIds.delete(id.toLowerCase()))
      continue
    }
    await $.fs.write(path, next)
    const place = file.rel === undefined ? file.name : `${file.rel}/${file.name}`
    at.forEach((index, i) => told.push(`- ${place}: #${ids[i]!} is "${ticketSummary(plainText(CHECKBOX.exec(lines[index]!)?.[2] ?? ''), 60)}"`))
  }
  for (const sign of [...unnumberedAt.keys()]) {
    if (!seen.has(sign)) {
      unnumberedAt.delete(sign)
    }
  }
  pendingNumbered = [...pendingNumbered, ...told]

  return told.length > 0
}

/** The answer of `uname -s`, asked once. Empty when it cannot be asked. */
let unameCache: string | undefined

/** `uname -s`, asked once and kept in `unameCache`; empty when it cannot be asked. */
async function platformName($: EngineInterface): Promise<string> {
  if (unameCache === undefined) {
    unameCache = ((await $.process.run(['uname', '-s']).catch(() => undefined))?.stdout ?? '').trim()
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
 * The command line that opens an absolute file path in the OS default app. No shell, and the path
 * is absolute, so it cannot look like a flag.
 */
export function openCommand(path: string, platform: string): string[] {
  if (isWinPath(path)) {
    return ['explorer.exe', path.replace(/\//g, '\\')]
  }

  return platform === 'Darwin' ? ['open', path] : ['xdg-open', path]
}

/** Opens the archive file in the OS default app; a toast says so when that fails. */
async function openArchive($: EngineInterface): Promise<void> {
  const path = archiveLink
  if (path === undefined) {
    return
  }
  const argv = openCommand(path, isWinPath(path) ? '' : await platformName($))
  const result = await $.process.run(argv).catch(() => undefined)
  // explorer.exe exits 1 even when it opened the file; any other command must exit 0.
  const isOk = result !== undefined && (result.exitCode === 0 || (argv[0] === 'explorer.exe' && result.exitCode === 1))
  if (!isOk) {
    $.ui.toast(`Could not open ${path}`)
  }
}

/**
 * Sends one file to the OS trash. True only if a command exited 0 and the file is gone. There is no
 * fallback to `rm` or any other outright delete: when no trash method works, the file stays.
 */
async function trashFile($: EngineInterface, path: string): Promise<boolean> {
  for (const argv of await trashCommands($, path)) {
    const result = await $.process.run(argv).catch(() => undefined)
    if (result?.exitCode === 0 && !(await $.fs.exists(path).catch(() => true))) {
      return true
    }
  }

  return false
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
  if (isWorking || isArchiving || isNumbering || central === undefined || !canDeleteEmpty()) {
    return
  }
  isWorking = true
  try {
    // `uname` is asked once per press, so a changed platform is never read from a stale answer.
    unameCache = undefined
    const run = async (argv: string[]) => (await $.process.run(argv).catch(() => undefined))?.exitCode === 0
    const target = await chooseTarget($, central, (await mdFiles($, central)).filter(name => !name.startsWith('archive/')))
    const folders = new Set<string>()
    const isWin = isWinPath(central)
    const unmoved: string[] = []
    let removed = 0
    const kept: string[] = []
    for (const file of emptyFiles) {
      const name = file.path.slice(file.folder.length + 1)
      const isArchive = /^archive\/[^/]+$/.test(name)
      const isTop = !name.includes('/')
      if ((!isArchive && !isTop) || !name.endsWith('.md') || (file.folder === central && !isArchive && name === target) || !(await isTrustedDir($, file.folder)) || !(await isPlainFile($, file.path))) {
        kept.push(file.path)
        continue
      }
      const text = await $.fs.read(file.path).catch(() => undefined)
      if (typeof text !== 'string' || text.trim() !== '') {
        kept.push(file.path)
        continue
      }
      if (await trashFile($, file.path)) {
        removed += 1
        folders.add(file.folder)
      } else {
        kept.push(file.path)
        unmoved.push(file.path)
      }
    }
    for (const folder of folders) {
      for (const dir of [`${folder}/archive`, folder]) {
        // Fails on a directory that still holds files, which keeps it.
        await run(isWin ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `[System.IO.Directory]::Delete(${psPath(dir)})`] : ['rmdir', '--', dir])
      }
    }
    // A folder that is gone leaves the folder list.
    const gone = new Set<string>()
    for (const folder of folders) {
      if (!(await $.fs.exists(folder).catch(() => true))) {
        gone.add(folder)
      }
    }
    todoFolders = todoFolders?.filter(one => !gone.has(one.path))
    if (kept.length > 0) {
      $.ui.toast(`Kept: ${kept.join(', ')}`)
    }
    if (unmoved.length > 0) {
      const reason = isWin ? 'PowerShell could not move it to the Recycle Bin' : unameCache === 'Darwin' ? 'no trash method worked; /usr/bin/trash and osascript failed' : 'no trash command found; install gio or trash-cli'
      $.ui.toast(`Not moved to the ${isWin ? 'Recycle Bin' : 'Trash'}, file kept (${reason}): ${unmoved.join(', ')}`)
    }
    $.ui.toast(`Moved ${removed} empty todo ${removed === 1 ? 'file' : 'files'} to the ${isWin ? 'Recycle Bin' : 'Trash'}.`)
    await scan($, true).catch(() => undefined)
  } finally {
    isWorking = false
    redraw($)
  }
}

/**
 * Finds identical tickets in a todo file's text: ticket lines whose bullet, box and text, after the
 * item's own leading ID, are letter for letter the same. The first of each group stays. Returns the
 * text without the others, with references to a removed ticket's ID rewritten to the kept one, the
 * removed tickets, and the ID map (old lowercase to kept). An ID that a kept ticket owns is never remapped.
 */
export function removeDuplicateTickets(markdown: string): { text: string; removed: { id: string; kept: string }[]; map: Record<string, string> } {
  const seen = new Map<string, string>()
  const removed: { id: string; kept: string }[] = []
  const kept: string[] = []
  const map: Record<string, string> = {}
  const owned = new Set<string>()
  const lines = markdown.split('\n')
  for (const [index, line] of lines.entries()) {
    // A subtask, or a ticket with lines indented under it, is never a duplicate: its place in the tree is part of it.
    const parts = /^[-*+] /.test(line) && !/^\s+\S/.test(lines[index + 1] ?? '') ? foldParts(line) : undefined
    if (parts === undefined) {
      const own = foldParts(line)
      if (own !== undefined) {
        owned.add(own.id.toLowerCase())
      }
      kept.push(line)
      continue
    }
    const first = seen.get(parts.key)
    if (first === undefined) {
      seen.set(parts.key, parts.id)
      owned.add(parts.id.toLowerCase())
      kept.push(line)
    } else {
      removed.push({ id: parts.id, kept: first })
      if (first.toLowerCase() !== parts.id.toLowerCase()) {
        map[parts.id.toLowerCase()] = first
      }
    }
  }
  for (const id of Object.keys(map)) {
    if (owned.has(id)) {
      delete map[id]
    }
  }

  return { text: kept.map(line => applyRefRenames(line, map)).join('\n'), removed, map }
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
  if (isWorking || isArchiving || isNumbering || central === undefined || !canDeleteDupTickets()) {
    return
  }
  isWorking = true
  try {
    const names = await mdFiles($, central, true)
    const target = await chooseTarget($, central, names.filter(name => !name.startsWith('archive/')))
    const path = `${central}/${target}`
    if (!names.includes(target) || !(await isTrustedDir($, central)) || !(await isPlainFile($, path))) {
      return
    }
    const text = await readStrict($, path)
    const result = removeDuplicateTickets(text)
    if (result.removed.length === 0) {
      return
    }
    if ((await readStrict($, path)) !== text) {
      $.ui.toast(`Not changed, the file changed meanwhile: ${DIR}/${target}`)
      return
    }
    await $.fs.write(path, result.text)
    const mapped = Object.entries(result.map).map(([id, kept]) => `#${id.toUpperCase()} is now #${kept}`)
    // References in the central archive files follow.
    const changed: string[] = []
    if (Object.keys(result.map).length > 0) {
      for (const name of names.filter(one => one.startsWith('archive/'))) {
        const file = `${central}/${name}`
        const before = await readStrict($, file)
        const after = before.split('\n').map(line => applyRefRenames(line, result.map)).join('\n')
        if (after !== before && (await readStrict($, file)) === before && (await isPlainFile($, file))) {
          await $.fs.write(file, after)
          changed.push(name)
        }
      }
    }
    pendingRemoved = [...pendingRemoved, ...result.removed.map(one => `- #${one.id} removed, it repeated #${one.kept}`), ...mapped.map(line => `- ${line}`)]
    $.ui.toast(`Removed ${result.removed.length} duplicate ${result.removed.length === 1 ? 'ticket' : 'tickets'} from ${DIR}/${target}.${mapped.length > 0 ? ` ${mapped.join('; ')}` : ''}${changed.length > 0 ? ` References fixed in ${changed.join(', ')}.` : ''}`)
    await scan($, true).catch(() => undefined)
  } catch (error) {
    $.ui.toast(`Could not remove duplicate tickets: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isWorking = false
    redraw($)
  }
}

/** Sets hasDupTickets from the central target file; false when it cannot be read. */
async function refreshDupTickets($: EngineInterface): Promise<void> {
  hasDupTickets = false
  const central = centralFolder()
  if (central === undefined || centralBlocked) {
    return
  }
  try {
    const names = (await mdFiles($, central)).filter(name => !name.startsWith('archive/'))
    if (names.length === 0) {
      return
    }
    const target = await chooseTarget($, central, names)
    hasDupTickets = names.includes(target) && removeDuplicateTickets(await readStrict($, `${central}/${target}`)).removed.length > 0
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
  const hasPrimary = folders.some(one => !one.isOther)
  const known = folders.find(one => one.path === near || (real !== undefined && one.real === real))
  if (known !== undefined) {
    return hasPrimary || !known.isOther ? folders : folders.map(one => (one === known ? { ...one, isOther: false } : one))
  }
  if (folders.length >= MAX_FOLDERS) {
    return folders
  }
  const added: TodoFolder = { path: near, rel: relIn(real, repoRoot) ?? near, isOther: hasPrimary, ...(real === undefined ? {} : { real }) }

  return hasPrimary ? [...folders, added] : [added, ...folders]
}

/** A file's unique ID in the pane: its folder and its name. */
export function fileId(file: { folder: string; name: string }): string {
  return `${file.folder}/${file.name}`
}

/** A file's path from the repo root, for prompts: `mods/x/.claude_todo/TODO.md`. */
export function filePath(file: { folder: string; rel?: string; name: string }): string {
  return `${file.rel ?? file.folder}/${file.name}`
}

/** An item's key for the categories book: qualified by its folder outside the primary one. */
export function qualifiedKey(file: { rel?: string; folder: string; isOther?: true }, item: { text: string; id?: string }): string {
  return file.isOther === true ? `${file.rel ?? file.folder}::${itemKey(item)}` : itemKey(item)
}

/** Rereads the `.md` files of every known folder; a file whose mtime is unchanged keeps its parse. */
async function scan($: EngineInterface, isFull = false): Promise<void> {
  todoFolders = await noteNearest($, await ensureFolders($))
  const folders = todoFolders ?? []
  // The book lives in the primary folder only. With no primary folder the items are not sorted.
  const bookFolder = folders.find(one => !one.isOther)?.path
  await loadBook($, bookFolder, isFull)
  const known = new Map(todoFiles.map(file => [fileId(file), file]))
  const next: TodoFile[] = []
  const empties: { folder: string; path: string; name: string; rel?: string }[] = []
  for (const folder of folders) {
    const sources: [string, string][] = [[folder.path, ''], [`${folder.path}/archive`, 'archive/']]
    for (const [dir, prefix] of sources) {
      if (!(await $.fs.exists(dir).catch(() => false))) {
        continue
      }
      for (const entry of await $.fs.list(dir).catch(() => [])) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.md')) {
          continue
        }
        const name = `${prefix}${entry.name}`
        const place = { name, folder: folder.path, rel: folder.rel, ...(folder.isOther ? { isOther: true as const } : {}) }
        const cached = known.get(fileId(place))
        if (!isFull && cached !== undefined && cached.mtimeMs === entry.mtimeMs) {
          next.push(cached)
          continue
        }
        const text = await $.fs.read(`${dir}/${entry.name}`).catch(() => undefined)
        // A file with nothing but blanks is empty; one that would not read is not known to be.
        if (typeof text === 'string' && text.trim() === '' && !(folder.path === centralFolder() && prefix === '' && entry.name.toLowerCase() === 'todo.md')) {
          empties.push({ folder: folder.path, path: `${dir}/${entry.name}`, name, ...(folder.rel === undefined ? {} : { rel: folder.rel }) })
        }
        const items = parseTodo(typeof text === 'string' ? text : '')
        next.push(prefix === '' ? { ...place, mtimeMs: entry.mtimeMs, items } : { ...place, mtimeMs: entry.mtimeMs, items, isArchived: true })
      }
    }
  }
  const kept = next.filter(file => file.items.length > 0)
  const isSame = isFull
    ? JSON.stringify(todoFiles) === JSON.stringify(kept)
    : todoFiles.length === kept.length && todoFiles.every((file, i) => fileId(file) === (kept[i] === undefined ? '' : fileId(kept[i])) && file.mtimeMs === kept[i]?.mtimeMs)
  if (!isSame) {
    todoFiles = kept
    redraw($)
  }
  if (pruneTickets()) {
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
    await scan($, true)

    return
  }
  await archiveDone($).catch(() => undefined)
  void sortItems($).catch(() => undefined)
}

// ---------------------------------------------------------------- categories

/**
 * Categories Claude gives the open items, kept in `categories.json` in the primary `.claude_todo/`
 * folder (the first folder when none is primary); items of other folders carry their folder in the
 * key. An item keeps the
 * category it was first given; new categories are made only while there are fewer than five.
 */
export type CategoryBook = { categories: string[]; items: Record<string, string> }

const MAX_CATEGORIES = 5
const UNSORTED = 'Not sorted yet'
const SORT_BATCH = 60
/** The most batches one sort runs back to back. */
const SORT_BATCHES = 5
const SORT_EVERY_MS = 30_000
const SORT_MODEL = 'haiku'

let book: CategoryBook = { categories: [], items: {} }
let bookDir: string | undefined
let isSorting = false
let lastSortAt: number | undefined

/** An item's stable key: its ID when it has one, else its normalized text. */
export function itemKey(item: { text: string; id?: string }): string {
  return item.id !== undefined ? `#${item.id.toLowerCase()}` : normalize(item.text).slice(0, 200)
}

export function sortPrompt(categories: readonly string[], texts: readonly string[]): string {
  return [
    `Sort these todo items from one software project into categories. Use at most ${MAX_CATEGORIES} categories in all.`,
    categories.length === 0
      ? 'There are no categories yet: make them from the items, so that together they cover the whole project.'
      : `Existing categories, which you must keep: ${JSON.stringify(categories)}. Add a new one only while there are fewer than ${MAX_CATEGORIES}.`,
    'A category name is 1 to 3 words, in sentence case.',
    '',
    'Items:',
    ...texts.map((text, i) => `${i + 1}. ${text.slice(0, 160)}`),
    '',
    'Reply with JSON only: {"categories": [every category name], "assign": {"1": "Category", "2": "Category", ...}}. Give every item exactly one category from the list.',
  ].join('\n')
}

/**
 * Reads the model's reply into the book: existing categories stay first and unchanged, new ones are
 * kept up to five, and an item assigned to no listed category is left for the next sort.
 */
export function applySortReply(current: CategoryBook, keys: readonly string[], reply: string): CategoryBook | undefined {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return undefined
  }
  const record = parsed as { categories?: unknown; assign?: unknown }
  const proposed = Array.isArray(record.categories) ? record.categories.filter((name): name is string => typeof name === 'string' && name.trim() !== '') : []
  const categories = [...current.categories]
  for (const name of proposed.map(one => one.trim().slice(0, 40))) {
    if (categories.length < MAX_CATEGORIES && !categories.includes(name)) {
      categories.push(name)
    }
  }
  const items = { ...current.items }
  const assign = typeof record.assign === 'object' && record.assign !== null ? (record.assign as Record<string, unknown>) : {}
  keys.forEach((key, i) => {
    const name = assign[String(i + 1)]
    if (items[key] === undefined && typeof name === 'string' && categories.includes(name.trim())) {
      items[key] = name.trim()
    }
  })

  return { categories, items }
}

async function loadBook($: EngineInterface, folder: string | undefined, isFull = false): Promise<void> {
  if (folder === bookDir && !isFull) {
    return
  }
  if (isSorting) {
    return
  }
  bookDir = folder
  book = { categories: [], items: {} }
  if (folder === undefined || !(await $.fs.exists(`${folder}/categories.json`))) {
    return
  }
  const text = await $.fs.read(`${folder}/categories.json`).catch(() => '')
  try {
    const parsed = JSON.parse(typeof text === 'string' ? text : '') as Partial<CategoryBook>
    book = {
      categories: Array.isArray(parsed.categories) ? parsed.categories.filter((name): name is string => typeof name === 'string').slice(0, MAX_CATEGORIES) : [],
      items: typeof parsed.items === 'object' && parsed.items !== null ? parsed.items : {},
    }
  } catch {
    // A damaged file starts the book over; the next sort writes a good one.
  }
}

/**
 * Asks the model to sort the open items that have no category yet: batch after batch, up to
 * SORT_BATCHES batches in one run (so the first scan sorts most folders whole), then again at most
 * every 30 s.
 */
async function sortItems($: EngineInterface): Promise<void> {
  const time = await $.clock.now()
  if (bookDir === undefined || isSorting || (lastSortAt !== undefined && time - lastSortAt < SORT_EVERY_MS)) {
    return
  }
  const open = todoFiles
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map(item => ({ item, key: qualifiedKey(file, item) })))
    .filter(one => one.item.status !== 'completed' && book.items[one.key] === undefined)
  const unsorted = [...new Map(open.map(one => [one.key, one.item.text])).entries()]
  if (unsorted.length === 0) {
    return
  }
  isSorting = true
  lastSortAt = time
  try {
    for (let from = 0; from < unsorted.length && from < SORT_BATCH * SORT_BATCHES; from += SORT_BATCH) {
      const batch = unsorted.slice(from, from + SORT_BATCH)
      const reply = await $.model.complete({ model: SORT_MODEL, prompt: sortPrompt(book.categories, batch.map(([, text]) => text)), maxTokens: 4000 })
      const next = reply.isAnswered ? applySortReply(book, batch.map(([key]) => key), reply.text) : undefined
      if (next === undefined || bookDir === undefined) {
        break
      }
      book = next
      await $.fs.write(`${bookDir}/categories.json`, `${JSON.stringify(book, null, 2)}\n`)
      redraw($)
    }
  } finally {
    isSorting = false
  }
}

/** The open items of the live files, once each by key: [key, text]. */
function openItems(): [string, string][] {
  const open = todoFiles
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map(item => ({ item, key: qualifiedKey(file, item) })))
    .filter(one => one.item.status !== 'completed')

  return [...new Map(open.map(one => [one.key, one.item.text])).entries()]
}

/**
 * Whether a fresh sort differs enough from the current categories to be worth applying. Over the
 * given open tickets: true when the number of groups differs, or when at least a quarter of the
 * tickets land in a new group that does not map to their old one. Each new group maps to the old
 * group it shares the most tickets with (an unsorted ticket counts as an old group of its own), so
 * a rename alone moves nothing.
 */
export function isSubstantialChange(old: CategoryBook, next: CategoryBook, keys: readonly string[]): boolean {
  const oldOf = (key: string) => (old.categories.includes(old.items[key] ?? '') ? old.items[key]! : UNSORTED)
  const newOf = (key: string) => next.items[key] ?? UNSORTED
  const groups = (of: (key: string) => string) => new Set(keys.map(of).filter(name => name !== UNSORTED))
  if (groups(oldOf).size !== groups(newOf).size) {
    return true
  }
  const mapped = new Map<string, string>()
  for (const name of new Set(keys.map(newOf))) {
    const shared = new Map<string, number>()
    for (const key of keys.filter(one => newOf(one) === name)) {
      shared.set(oldOf(key), (shared.get(oldOf(key)) ?? 0) + 1)
    }
    mapped.set(name, [...shared.entries()].sort((a, b) => b[1] - a[1])[0]![0])
  }
  const moved = keys.filter(key => mapped.get(newOf(key)) !== oldOf(key)).length

  return keys.length > 0 && moved * 4 >= keys.length
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
    let fresh: CategoryBook = { categories: [], items: {} }
    for (let from = 0; from < open.length; from += SORT_BATCH) {
      const batch = open.slice(from, from + SORT_BATCH)
      const reply = await $.model.complete({ model: SORT_MODEL, prompt: sortPrompt(fresh.categories, batch.map(([, one]) => one)), maxTokens: 4000 })
      const next = reply.isAnswered ? applySortReply(fresh, batch.map(([key]) => key), reply.text) : undefined
      if (next === undefined) {
        throw new Error('unreadable reply')
      }
      fresh = next
    }
    const keys = open.map(([key]) => key).filter(key => fresh.items[key] !== undefined)
    if (keys.length === 0) {
      throw new Error('nothing sorted')
    }
    // Groups the model named but gave no ticket are dropped, so they do not count as groups.
    const used = new Set(keys.map(key => fresh.items[key]))
    fresh = { categories: fresh.categories.filter(name => used.has(name)), items: fresh.items }
    if (isSubstantialChange(book, fresh, keys)) {
      book = fresh
      await $.fs.write(`${bookDir}/categories.json`, `${JSON.stringify(book, null, 2)}\n`)
      text = undefined
    } else {
      text = 'The current categories are correct'
    }
  } catch {
    // The failure note stays.
  } finally {
    isRecategorizing = false
    isSorting = false
    recatNote = text === undefined ? undefined : { text, until: (await $.clock.now()) + NOTE_MS }
    redraw($)
  }
}

// ---------------------------------------------------------------- agent to item matching

const MATCH_ITEMS = 80
const MATCH_MAX = 3
/** Agents already matched, or being matched, by agent ID: one model call per agent. */
const matchedAgents = new Set<string>()

export function matchPrompt(task: string, texts: readonly string[]): string {
  return [
    "An agent was started with this task. Which of the project's todo items is it working on?",
    '',
    'Task:',
    task.slice(0, 2000),
    '',
    'Todo items:',
    ...texts.map((text, i) => `${i + 1}. ${text.slice(0, 160)}`),
    '',
    `Reply with JSON only: {"items": [numbers]}, at most ${MATCH_MAX}, only items the task works on directly; {"items": []} when none fits.`,
  ].join('\n')
}

/** The item numbers in a match reply, 0-based, in range, at most three; empty when unreadable. */
export function readMatchReply(reply: string, count: number): number[] {
  const found = /\{[\s\S]*\}/.exec(reply)?.[0]
  if (found === undefined) {
    return []
  }
  try {
    const parsed = JSON.parse(found) as { items?: unknown }
    const items = Array.isArray(parsed.items) ? parsed.items : []

    return [...new Set(items.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count).map(n => n - 1))].slice(0, MATCH_MAX)
  } catch {
    return []
  }
}

/**
 * Asks Haiku, once per agent, which open or in-progress todo items the agent's task works on, and
 * links them. Agents rarely name their items, and most items have no ID, so without this most
 * links never form. In-progress items are listed first.
 */
async function matchAgent($: EngineInterface, id: string, task: string): Promise<void> {
  const open = todoFiles
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items)
    .filter(item => item.status !== 'completed')
  const texts = [...new Set([...open.filter(item => item.status === 'in_progress'), ...open.filter(item => item.status === 'pending')].map(item => item.text))].slice(0, MATCH_ITEMS)
  if (texts.length === 0 || matchedAgents.has(id)) {
    return
  }
  matchedAgents.add(id)
  const reply = await $.model.complete({ model: SORT_MODEL, prompt: matchPrompt(task, texts), maxTokens: 200 }).catch(() => undefined)
  const picks = reply?.isAnswered === true ? readMatchReply(reply.text, texts.length) : []
  if (picks.length > 0) {
    const autoClaims = picks.map(i => texts[i]).filter((text): text is string => text !== undefined)
    agentRows = agentRows.map(row => (row.id === id ? { ...row, autoClaims } : row))
    redraw($)
  }
}

/**
 * Each file with its items grouped by category under headings: the categories in the order they
 * were made, then the items not sorted yet. Within a category the usual order holds: linked, in
 * progress, open, done.
 */
export function categoryGroups(files: readonly FileView[], current: CategoryBook): FileView[] {
  const rank = (item: { status: ItemStatus; owners: number[] }) =>
    item.owners.length > 0 ? 0 : item.status === 'in_progress' ? 1 : item.status === 'pending' ? 2 : 3
  const names = [...current.categories, UNSORTED]

  return files.map(file => {
    const groups: { name: string; from: number; count: number }[] = []
    const items = names.flatMap(name => {
      const members = file.items.filter(item => (current.items[item.key] ?? UNSORTED) === name).sort((a, b) => rank(a) - rank(b))
      if (members.length > 0) {
        groups.push({ name, from: groups.reduce((sum, group) => sum + group.count, 0), count: members.length })
      }

      return members
    })

    return { ...file, items, groups }
  })
}

/** Every item, open, done or archived, whose text holds every word of the query. */
export function searchTodo(files: readonly FileView[], query: string): FileView[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) {
    return []
  }

  return files
    .map(file => ({ ...file, items: file.items.filter(item => words.every(word => item.text.toLowerCase().includes(word))) }))
    .filter(file => file.items.length > 0)
}

// ---------------------------------------------------------------- agents

export function isEnded(state: AgentRowStatus): boolean {
  return ENDED.includes(state)
}

/** A few words on what a tool call does, from its arguments. */
export function describeCall(tool: string, input: Record<string, unknown>): string {
  for (const key of ['description', 'command', 'file_path', 'pattern', 'query', 'url', 'path', 'prompt']) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) {
      const line = value.split('\n')[0] ?? ''

      return `${tool}: ${line.length > 60 ? `${line.slice(0, 57)}...` : line}`
    }
  }

  return tool
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[*_`[\]()]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * The kill switch on a live agent's card: stops the agent at once through TaskStop, which aborts
 * its loop. The agent gets no turn to wind down or sum up.
 */
async function stopAgent($: EngineInterface, index: number): Promise<void> {
  const row = agentRows[index]
  if (row === undefined || isEnded(row.status)) {
    return
  }
  try {
    const stopped = (await $.tool.call({ tool: 'TaskStop', task_id: row.id } as never)) as { deny?: string; isError?: boolean; text?: string }
    if (stopped.deny !== undefined || stopped.isError === true) {
      throw new Error(stopped.deny ?? stopped.text ?? 'TaskStop failed')
    }
    const old = agentRows
    agentRows = agentRows.map(one => (one.id === row.id ? { ...one, status: 'killed', endedAt: one.endedAt ?? clockMs } : one))
    noteEnds(old, agentRows)
    $.ui.toast(`Stopped ${agentLabel(index)}: ${ticketSummary(row.description, 60)}`)
  } catch (error) {
    $.ui.toast(`Could not stop ${agentLabel(index)}: ${error instanceof Error ? error.message : String(error)}`)
  }
  await refreshAgents($, true).catch(() => undefined)
}

/** Tool calls seen since the last refresh, per agent: written in one batch, not one redraw each. */
const pendingTools = new Map<string, { calls: number; doing: string }>()
/** Tokens each agent's model requests used since the last refresh: they ride along like the tool calls. */
const pendingTokens = new Map<string, number>()
/**
 * The model each agent's requests name. The spawn gives an agent's model, but an agent that was
 * already running when the mod loaded is known only from the agent list, which has none.
 */
const stepModels = new Map<string, string>()
/** How long a live agent may be missing from the engine's agent list before its row ends. */
const UNLISTED_MS = 15_000
let lastClock = 0

/**
 * Merges the agent list and the pending tool calls and tokens into the rows, and redraws only on a
 * change of status, once every 5 s (STG-PERF-1), or when forced at the end of an agent's turn; the
 * CSS motion runs on between redraws.
 */
async function refreshAgents($: EngineInterface, isForced = false): Promise<void> {
  const time = await $.clock.now()
  await loadAgents($).catch(() => undefined)
  const listed = await $.agent.list()
  const rows = agentRows
  const known = new Map(rows.map(row => [row.id, row]))
  for (const info of listed) {
    const row = known.get(info.id)
    const state = info.status as AgentRowStatus
    const description = info.description || row?.description || info.name || info.id
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
      brief: row?.brief ?? normalize(description),
      ...(row?.progress === undefined ? {} : { progress: row.progress }),
      ...(row?.claims === undefined ? {} : { claims: row.claims }),
      ...(row?.autoClaims === undefined ? {} : { autoClaims: row.autoClaims }),
      ...(info.name === undefined ? {} : { name: info.name }),
    })
  }
  // An agent the engine no longer lists has ended, though nothing said how: without this its row
  // stays live for good. A new agent gets a grace period, since its spawn starts the row before
  // the list has it.
  const listedIds = new Set(listed.map(info => info.id))
  for (const row of known.values()) {
    if (!listedIds.has(row.id) && !isEnded(row.status) && time - row.startedAt > UNLISTED_MS) {
      known.set(row.id, { ...row, status: 'ended', endedAt: time })
    }
  }
  const listedRows = [...known.values()]
  // A start, an end or a new agent redraws at once; tool-call counts and the current call ride
  // along with the next clock step, so a busy agent redraws the pane every 5 s, not every second.
  const isStatusChanged = JSON.stringify(listedRows) !== JSON.stringify(rows)
  matchNewAgents($, listedRows)
  if (!isForced && !isStatusChanged && time - lastClock < CLOCK_MS) {
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
  agentRows = next
  lastClock = time
  clockMs = time
  redraw($)
}

/** Starts the one model match for each live agent that has not had it. */
function matchNewAgents($: EngineInterface, rows: readonly AgentRow[]): void {
  for (const row of rows) {
    if (!isEnded(row.status) && !matchedAgents.has(row.id)) {
      void matchAgent($, row.id, row.brief).catch(() => undefined)
    }
  }
}

// ---------------------------------------------------------------- labels

const LABEL = /\b[Aa](\d{1,6})\b/g

/**
 * The note that tells the model which agent each pane label in the text names, or undefined when
 * the text names none. A label is the agent's place in this session's start order: A1 the first.
 */
export function labelNote(text: string, rows: readonly AgentRow[], base = agentBase): string | undefined {
  const seen = new Set<number>()
  const lines: string[] = []
  for (const match of text.matchAll(LABEL)) {
    const index = Number(match[1]) - 1 - base
    const row = rows[index]
    if (row === undefined || seen.has(index)) {
      continue
    }
    seen.add(index)
    const address = row.name === undefined ? `agent ID ${row.id}` : `name "${row.name}", agent ID ${row.id}`
    lines.push(`- A${base + index + 1}: "${row.description}" (${row.type}, ${row.status}; ${address})`)
  }

  return lines.length === 0
    ? undefined
    : `The user's agent labels come from the Claudeopticon pane (the claudeopticon mod), which numbers this session's agents in start order:\n${lines.join('\n')}`
}

// ---------------------------------------------------------------- links

/** For each claim, the one item that best matches it, if any matches (see claimScore). */
function bestMatches<T extends { item: TodoItem }>(open: readonly T[], claims: readonly string[]): T[] {
  return claims.flatMap(claim => {
    const scored = open.map(link => ({ link, score: claimScore(claim, link.item) })).filter(one => one.score > 0)
    const best = scored.sort((x, y) => y.score - x.score)[0]

    return best === undefined ? [] : [best.link]
  })
}

/** `file` is the file's pane ID (its folder and name), `index` the item's place in it. */
export type Link = { file: string; index: number; item: TodoItem }

/**
 * Which open todo items each live agent works on: every item whose ID (`#T12`, as a whole ID, so
 * `#T1` does not match `#T12`) its description or prompt names, and every item it claimed through
 * `report_progress` (by ID, quote or close paraphrase); when there is none, the first open item
 * whose text the prompt quotes. Ended agents and archived files link to nothing.
 */
export function linkAgents(list: readonly TodoFile[], rows: readonly AgentRow[]): Map<string, Link[]> {
  const links = new Map<string, Link[]>()
  const open = list
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map((item, index) => ({ file: fileId(file), index, item })))
    .filter(link => link.item.status !== 'completed')
  for (const row of rows) {
    if (isEnded(row.status)) {
      continue
    }
    const byId = open.filter(link => link.item.id !== undefined && new RegExp(`#${link.item.id.toLowerCase()}(?![0-9a-z])`).test(row.brief))
    const byClaim = bestMatches(open, [...(row.claims ?? []), ...(row.autoClaims ?? [])])
    const claimed = [...byId, ...byClaim].filter((link, i, all) => all.findIndex(one => one.file === link.file && one.index === link.index) === i)
    const byText = claimed.length > 0 ? [] : open.filter(link => {
      const text = normalize(link.item.text)

      return text.length >= LINK_MIN_CHARS && row.brief.includes(text)
    }).slice(0, 1)
    const found = [...claimed, ...byText]
    if (found.length > 0) {
      links.set(row.id, found)
    }
  }

  return links
}

// ---------------------------------------------------------------- text helpers

export function bar(done: number, total: number, width: number): string {
  if (total === 0) {
    return '░'.repeat(width)
  }
  const filled = Math.round((done / total) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function clip(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(1, width - 3))}...` : text
}

// ---------------------------------------------------------------- view

/** The orchestrator as the view needs it: its ticket keys, whether a turn runs, and its call summary. */
export type OrchestratorState = { keys: ReadonlySet<string>; isRunning: boolean; doing?: string; toolCalls: number; title?: string }

/** The orchestrator card's title: Claude's headline, else the first ticket it owns, and how many more. */
export function orchestratorTitle(title: string | undefined, tickets: readonly string[]): string {
  const first = tickets[0]
  if (title !== undefined && title !== '') {
    return title
  }

  return first === undefined ? 'Orchestrator' : tickets.length > 1 ? `${first} and ${tickets.length - 1} more` : first
}

/** What the pane draws, worked out once for the cards and the terminal alike. */
export function buildView(list: readonly TodoFile[], rows: readonly AgentRow[], now: number, orch?: OrchestratorState): View {
  const links = linkAgents(list, rows)
  const itemOwners = new Map<string, number[]>()
  const fileOwners = new Map<string, number[]>()
  rows.forEach((row, i) => {
    for (const link of links.get(row.id) ?? []) {
      const key = `${link.file}:${link.index}`
      itemOwners.set(key, [...(itemOwners.get(key) ?? []), i])
      fileOwners.set(link.file, [...new Set([...(fileOwners.get(link.file) ?? []), i])])
    }
  })
  // The orchestrator owns last in an item's list, so an agent's color still leads a shared ticket.
  const orchLinks: string[] = []
  if (orch !== undefined && orch.keys.size > 0) {
    for (const file of list.filter(one => one.isArchived !== true)) {
      file.items.forEach((item, index) => {
        if (item.status !== 'completed' && orch.keys.has(qualifiedKey(file, item))) {
          const key = `${fileId(file)}:${index}`
          itemOwners.set(key, [...(itemOwners.get(key) ?? []), ORCH])
          fileOwners.set(fileId(file), [...new Set([...(fileOwners.get(fileId(file)) ?? []), ORCH])])
          orchLinks.push(item.text)
        }
      })
    }
  }

  // One FileView per file: the ticket board shares its columns across files, and the header card
  // has one row per file. Each item keeps its source (folder, file, path) for the writes and the
  // prompts. Sources run primary folder first, then by folder path, so the order is stable.
  const sources = [...list].sort((a, b) => Number(a.isOther === true) - Number(b.isOther === true) || ((a.rel ?? a.folder) < (b.rel ?? b.folder) ? -1 : (a.rel ?? a.folder) > (b.rel ?? b.folder) ? 1 : 0))
  // The pane ID is the name, kept short for the common case; a repeated name takes its folder too.
  const nameCount = new Map<string, number>()
  for (const file of sources) {
    nameCount.set(file.name, (nameCount.get(file.name) ?? 0) + 1)
  }
  // A file's counts include the done tickets of its archive file, so archiving leaves its bar as it was.
  const archiveDone = (file: TodoFile) => count(list.find(one => one.isArchived === true && one.folder === file.folder && one.name === `archive/${file.name}`)?.items ?? []).done
  const files: FileView[] = sources.map(file => {
    const own = count(file.items)
    const inArchive = file.isArchived === true ? 0 : archiveDone(file)
    const [done, active, total] = [own.done + inArchive, own.active, own.total + inArchive]
    const indexed = file.items.map((item, index) => ({ file, item, owners: itemOwners.get(`${fileId(file)}:${index}`) ?? [] }))
    const linked = indexed.filter(one => one.owners.length > 0)
    const rest = [
      ...indexed.filter(one => one.item.status === 'in_progress'),
      ...indexed.filter(one => one.item.status === 'pending'),
      ...indexed.filter(one => one.item.status === 'completed'),
    ].filter(one => one.owners.length === 0)
    const shown = [...linked, ...rest]

    return {
      name: file.name,
      id: (nameCount.get(file.name) ?? 0) > 1 ? fileId(file) : file.name,
      place: folderPlace(file.rel ?? file.folder),
      done,
      active,
      total,
      owners: fileOwners.get(fileId(file)) ?? [],
      items: shown.map(one => ({
        text: one.item.text,
        status: one.item.status,
        owners: one.owners,
        key: qualifiedKey(one.file, one.item),
        localKey: itemKey(one.item),
        folder: one.file.folder,
        file: one.file.name,
        path: filePath(one.file),
      })),
      mtimeMs: file.mtimeMs,
      ...(file.isArchived === true ? { isArchived: true } : {}),
    }
  })
  files.sort((a, b) => {
    const linkA = a.owners.length > 0 ? 0 : 1
    const linkB = b.owners.length > 0 ? 0 : 1
    const openA = a.done < a.total ? 0 : 1
    const openB = b.done < b.total ? 0 : 1

    // The repo root's own files first, then the rest.
    const rootA = (a.place ?? '') === '' ? 0 : 1
    const rootB = (b.place ?? '') === '' ? 0 : 1

    return rootA - rootB || linkA - linkB || openA - openB || b.mtimeMs - a.mtimeMs
  })

  const current = files.filter(file => file.isArchived !== true)
  const archivedFiles = files.filter(file => file.isArchived === true)
  const live = count(list.filter(file => file.isArchived !== true).flatMap(file => file.items))
  const archived = count(list.filter(file => file.isArchived === true).flatMap(file => file.items)).done
  const all = { done: live.done + archived, active: live.active, total: live.total + archived }

  return {
    files: [...current.filter(file => file.done < file.total), ...current.filter(file => file.done === file.total), ...archivedFiles],
    archived,
    agents: rows.map((row, i) => ({
      index: i,
      description: row.description,
      type: row.type,
      model: row.model,
      status: row.status,
      isEnded: isEnded(row.status),
      isIdle: !isEnded(row.status) && row.idleSince !== undefined,
      idleSince: row.idleSince,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      toolCalls: row.toolCalls,
      tokens: row.tokens,
      doing: row.doing,
      links: (links.get(row.id) ?? []).map(link => link.item.text),
      progress: row.progress,
    })),
    ...all,
    live: rows.filter(row => !isEnded(row.status) && row.idleSince === undefined).length,
    now,
    ...(orch === undefined || orchLinks.length === 0
      ? {}
      : {
          orchestrator: {
            index: ORCH,
            description: orchestratorTitle(orch.title, orchLinks),
            type: 'main conversation',
            status: orch.isRunning ? 'running' : 'idle',
            isEnded: false,
            isIdle: !orch.isRunning,
            startedAt: now,
            toolCalls: orch.toolCalls,
            ...(orch.doing === undefined ? {} : { doing: orch.doing }),
            links: orchLinks,
          } satisfies AgentView,
        }),
  }
}

/**
 * The todo files as the pane lists them: each file with open items, its open items only. With
 * `showCompleted`, every item shows, done ones last, then the complete files, then the archive.
 */
export function todoLedger(view: View, showCompleted = false): FileView[] {
  if (showCompleted) {
    return view.files
  }

  return view.files
    .filter(file => file.isArchived !== true && file.done < file.total)
    .map(file => ({ ...file, items: file.items.filter(item => item.status !== 'completed') }))
}

/**
 * What the todo area draws. The list view draws one card set per file. The ticket view draws one
 * board: a single FileView holding every file's items, files in their order (the tiebreak within
 * a column), with `rows` the files for the board's header. `extra` tickets (moved to the archive
 * this session) lead the items, so the Done column lists them first. No files, no board.
 */
export function boardTargets(entries: readonly { file: FileView; prefix: string }[], isTickets: boolean, extra: readonly ItemView[] = []): { file: FileView; prefix: string; rows: FileView[] }[] {
  if (!isTickets) {
    return entries.map(one => ({ ...one, rows: [one.file] }))
  }
  const first = entries[0]
  if (first === undefined && extra.length === 0) {
    return []
  }
  const files = entries.map(one => one.file)
  const file: FileView = {
    name: 'board',
    id: 'board',
    done: files.reduce((sum, one) => sum + one.done, 0),
    active: files.reduce((sum, one) => sum + one.active, 0),
    total: files.reduce((sum, one) => sum + one.total, 0),
    owners: [...new Set(files.flatMap(one => one.owners))],
    items: [...extra, ...files.flatMap(one => one.items.map(item => (item.file === undefined ? { ...item, file: one.name } : item)))],
    mtimeMs: Math.max(0, ...files.map(one => one.mtimeMs)),
  }

  return [{ file, prefix: first?.prefix ?? 'file', rows: files }]
}

/**
 * The agents as the pane lists them: every active agent, in start order; then, when shown, the
 * finished ones, most recently ended first, so the bottom of the list is the ledger of who ran.
 */
/**
 * The agents in three groups: live, idle (finished but never stopped, always shown, since an open
 * task is worth a look), and finished (shown on request).
 */
export function ledger(view: View, showFinished = isFinishedShown): { active: AgentView[]; idle: AgentView[]; finished: AgentView[]; shown: AgentView[] } {
  const active = view.agents.filter(agent => !agent.isEnded && !agent.isIdle)
  const idle = view.agents.filter(agent => !agent.isEnded && agent.isIdle)
  const finished = view.agents.filter(agent => agent.isEnded).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

  return { active, idle, finished, shown: showFinished ? [...active, ...idle, ...finished] : [...active, ...idle] }
}

/** Marks an agent at work again: its tool call or model request ends its idle time. */
function wake(id: string): void {
  if (agentRows.some(row => row.id === id && row.idleSince !== undefined)) {
    agentRows = agentRows.map(row => {
      if (row.id !== id) {
        return row
      }
      const { idleSince: _, ...awake } = row

      return awake
    })
  }
}

/** The prompt a ticket sends to Claude: the item, where it lives, and how to keep the pane in step. */
export function ticketPrompt(path: string, text: string): string {
  return [
    `Process this todo item from ${path}:`,
    '',
    text,
    '',
    'Build or process it now. Mark it [~] while you work on it and [x] when it is done. If you dispatch an agent for it, name the item in the Agent call and have the agent claim it with report_progress.',
  ].join('\n')
}

/** The files with the items of hidden categories taken out; a file left with none drops out. */
export function withoutHidden(files: readonly FileView[], current: CategoryBook, hidden: ReadonlySet<string>): FileView[] {
  if (hidden.size === 0) {
    return [...files]
  }

  return files
    .map(file => ({ ...file, items: file.items.filter(item => !hidden.has(current.items[item.key] ?? UNSORTED)) }))
    .filter(file => file.items.length > 0)
}

/** The category names the filter offers: the book's, then Not sorted yet when an item has none. */
export function filterNames(files: readonly FileView[], current: CategoryBook): string[] {
  const unsorted = files.some(file => file.items.some(item => current.items[item.key] === undefined))

  return current.categories.length === 0 ? [] : [...current.categories, ...(unsorted ? [UNSORTED] : [])]
}

export type TicketColumn = { name: string; items: ItemView[] }

/**
 * A file's tickets as board columns: In progress, Open, and Done when shown. An open ticket that a
 * live agent works on goes in In progress, and shows as in progress, though its box is still
 * `- [ ]`. Within a column, the tickets an agent works on come first, then by category in the
 * order the categories were made, then in file order.
 */
export function ticketColumns(given: readonly ItemView[], current: CategoryBook, showDone: boolean): TicketColumn[] {
  const items = given.map(item => (item.status === 'pending' && item.owners.length > 0 ? { ...item, status: 'in_progress' as const, isHeld: true as const } : item))
  const rank = (item: ItemView) => {
    // The Done column keeps the order given: tickets archived this session, newest first, then the rest.
    if (item.status === 'completed') {
      return 0
    }
    const category = current.items[item.key]
    const at = category === undefined ? current.categories.length : current.categories.indexOf(category)

    return (item.owners.length > 0 ? 0 : 1) * 100 + (at < 0 ? current.categories.length : at)
  }
  const column = (name: string, status: ItemStatus) => ({
    name,
    items: items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === status)
      .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
      .map(({ item }) => item),
  })

  return [column('In progress', 'in_progress'), column('Open', 'pending'), ...(showDone ? [column('Done', 'completed')] : [])]
}

/**
 * A ticket's corner button: its name, one-glyph label, hover tip and toast; then either the prompt
 * it sends to Claude, or, for a manual move, the box it writes in the todo file (no prompt).
 */
type TicketAction = { name: string; glyph: string; tip: string; toast: string; prompt: (path: string, text: string) => string; mark?: ItemStatus }

/** On an open ticket: three chevrons, sending the item to Claude to build. */
const SEND_ACTION: TicketAction = { name: 'send', glyph: '\u22D9', tip: 'Send to Claude', toast: 'Sent to Claude', prompt: ticketPrompt }

/** On a ticket in progress or already sent: a question mark, asking Claude for the item's status. */
const STATUS_ACTION: TicketAction = { name: 'status', glyph: '?', tip: 'Ask Claude for a status update', toast: 'Asked for status', prompt: statusPrompt }

/** The manual moves: they write the box and tell Claude at the next prompt, asking nothing of it. */
const START_ACTION: TicketAction = { name: 'start', glyph: '\u25D0', tip: 'Mark in progress', toast: 'Marked in progress', prompt: () => '', mark: 'in_progress' }
const DONE_ACTION: TicketAction = { name: 'done', glyph: '\u2713', tip: 'Mark done', toast: 'Marked done', prompt: () => '', mark: 'completed' }
const REOPEN_ACTION: TicketAction = { name: 'reopen', glyph: '\u21A9', tip: 'Move back to open', toast: 'Moved back to open', prompt: () => '', mark: 'pending' }

const BOXES: Record<ItemStatus, string> = { pending: ' ', in_progress: '~', completed: 'x' }
const STATUS_WORDS: Record<ItemStatus, string> = { pending: 'open', in_progress: 'in progress', completed: 'done' }

/**
 * The todo file with one item's box set to `status`: the first checkbox line whose item has `key`.
 * Undefined when no line has it, or its box already says so.
 */
export function setBox(markdown: string, key: string, status: ItemStatus): string | undefined {
  const lines = markdown.split('\n')
  const at = lines.findIndex(line => {
    const item = parseTodo(line)[0]

    return item !== undefined && itemKey(item) === key
  })
  const line = lines[at]
  if (line === undefined || parseTodo(line)[0]?.status === status) {
    return undefined
  }
  lines[at] = line.replace(/\[[ xX~>]\]/, `[${BOXES[status]}]`)

  return lines.join('\n')
}

/** The moves the user made by hand since Claude last heard: told with its next tool result or prompt. */
let pendingMoves: string[] = []
/** Every item the user moved by hand this session, by `file:key`, with the box they gave it. */
const userMoves = new Map<string, ItemStatus>()

const STATUS_NAMES: Record<string, ItemStatus> = { open: 'pending', in_progress: 'in_progress', done: 'completed' }

export type Found = { file: string; folder: string; rel: string; item: TodoItem }

/**
 * Every live item a reference may name: all items with its `#T` ID (folders may share IDs), else
 * the items of the best text match. Archived files are left out. Several files may match.
 */
export function findTickets(list: readonly TodoFile[], ref: string): Found[] {
  const all = list
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map(item => ({ file: file.name, folder: file.folder, rel: file.rel ?? file.folder, item })))
  const id = /#?\b(T\d+)\b/i.exec(ref)?.[1]?.toLowerCase()
  const byId = id === undefined ? [] : all.filter(one => one.item.id?.toLowerCase() === id)
  if (byId.length > 0) {
    return byId
  }
  const scored = all.map(one => ({ one, score: claimScore(ref, one.item) })).filter(x => x.score > 0)
  const best = Math.max(0, ...scored.map(x => x.score))

  return scored.filter(x => x.score === best).map(x => x.one)
}

/**
 * The matches in the one place `folder` names, exactly: a folder path as the prompts give it
 * (`mods/x/.claude_todo`, or the absolute one), or a file path in it (`mods/x/.claude_todo/TODO.md`).
 * No word search: a stray word in the reference never picks a folder.
 */
export function narrowTickets(hits: readonly Found[], folder: string): Found[] {
  const clean = folder.trim().replace(/^\.\//, '').replace(/\/+$/, '')

  return hits.filter(one => [one.rel, one.folder, `${one.rel}/${one.file}`, `${one.folder}/${one.file}`].includes(clean))
}

/** The live todo item a reference names, best match first; the first when several files have one. */
export function findTicket(list: readonly TodoFile[], ref: string, folder?: string): Found | undefined {
  const hits = findTickets(list, ref)

  return (folder === undefined ? hits : narrowTickets(hits, folder))[0]
}

/** The question the move tool asks the user, in the engine's own dialog. */
export function moveQuestion(path: string, item: TodoItem, to: ItemStatus, reason: string, isUserMove: boolean): string {
  const from = STATUS_WORDS[item.status]
  const said = reason.trim() === '' ? '' : ` Claude's reason: ${ticketSummary(reason.trim(), 300)}`

  return `Claude asks to move "${ticketSummary(item.text, 120)}" (${path}) from ${from} to ${STATUS_WORDS[to]}.${isUserMove ? ' You moved it by hand.' : ''}${said} Allow this move?`
}

/** Answers a move_ticket call: asks the user, and writes the box only on a yes. */
async function moveTicket($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const ref = typeof input.item === 'string' ? input.item : ''
  const to = STATUS_NAMES[typeof input.to === 'string' ? input.to : '']
  const reason = typeof input.reason === 'string' ? input.reason : ''
  if (to === undefined) {
    return 'Not moved: "to" must be open, in_progress or done.'
  }
  await scan($).catch(() => undefined)
  const all = findTickets(todoFiles, ref)
  if (all.length === 0) {
    return `Not moved: no live todo item matches "${ref}". Add the item to .claude_todo/ first.`
  }
  const where = typeof input.folder === 'string' ? input.folder.trim() : ''
  const hits = where === '' ? all : narrowTickets(all, where)
  if (hits.length === 0) {
    return `Not moved: "${ref}" has no match in "${where}". Matches are in: ${[...new Set(all.map(one => `${one.rel}/${one.file}`))].join(', ')}.`
  }
  const places = [...new Set(hits.map(one => `${one.rel}/${one.file}`))]
  if (places.length > 1) {
    return `Not moved: "${ref}" matches items in more than one file (${places.join(', ')}). Call move_ticket again with folder set to one of these paths.`
  }
  const found = hits[0]!
  const { file, folder, rel, item } = found
  const path = `${rel}/${file}`
  if (item.status === to) {
    return `Not moved: "${ticketSummary(item.text, 80)}" is already ${STATUS_WORDS[to]}.`
  }
  const key = `${folder}/${file}:${itemKey(item)}`
  const yes = 'Move it'
  const answer = await $.ui
    .ask(moveQuestion(path, item, to, reason, userMoves.has(key)), { options: [yes, 'Keep it where it is'], header: 'Ticket' })
    .catch(() => undefined)
  if (answer !== yes) {
    return `Not moved: the user kept "${ticketSummary(item.text, 80)}" ${STATUS_WORDS[item.status]}${answer === undefined || answer === 'Keep it where it is' ? '' : ` and said: ${answer}`}. Do not move it again unless the user asks.`
  }
  // The file is read again under the writer lock and only this one box changes in the fresh text.
  const isWritten = await withWriteLock(async () => {
    const text = await $.fs.read(`${folder}/${file}`).catch(() => undefined)
    const next = typeof text === 'string' ? setBox(text, itemKey(item), to) : undefined
    if (next === undefined) {
      return false
    }
    await $.fs.write(`${folder}/${file}`, next)

    return true
  })
  if (!isWritten) {
    return `Not moved: the line for "${ticketSummary(item.text, 80)}" was not found in ${path}.`
  }
  userMoves.delete(key)
  await scan($).catch(() => undefined)

  return `Moved with the user's approval: "${ticketSummary(item.text, 80)}" is now ${STATUS_WORDS[to]} in ${path}.`
}

/** The note the next prompt carries: the moves, as information, with no action asked. */
export function movesNote(moves: readonly string[]): string | undefined {
  return moves.length === 0
    ? undefined
    : [
        'The user moved these todo items by hand in the Claudeopticon pane (the claudeopticon mod), which wrote the new box into the todo file:',
        ...moves,
        'This is for your information only. Do not act on it unless the user asks. Follow the new places: stop work on an item moved to open or done. Never change the box of an item the user moved by hand yourself: if you think a move is wrong, call move_ticket, which asks the user first.',
      ].join('\n')
}

/** The notes waiting for Claude: the moves made by hand, the IDs a consolidation renumbered, and the agents that ended with tickets left open. */
function queuedNotes(): string[] {
  return [movesNote(pendingMoves), renameNote(pendingRenames), removedNote(pendingRemoved), numberedNote(pendingNumbered), ...pendingEnded].filter((note): note is string => note !== undefined)
}

/** The most tickets a close-the-work nudge names. */
const NUDGE_TICKETS = 5
/** How long a ticket named in the next-prompt nudge stays unnamed: 30 minutes. */
const NUDGE_REPEAT_MS = 30 * 60 * 1000

/** Notes about ended agents, waiting for Claude. Cleared with the other pending notes. */
let pendingEnded: string[] = []
/** The agents already nudged, so each is named once. */
const nudgedAgents = new Set<string>()
/** When each in-progress ticket of the orchestrator was last named in a prompt, by item key (per session, in memory). */
const namedAt = new Map<string, number>()

/** A ticket as the nudges name it: its real ID when it has one, then its text cut short. */
function nudgeName(item: TodoItem): string {
  // The item's text usually holds its ID already, as written in the file.
  const hasId = item.id === undefined || item.text.toLowerCase().includes(`#${item.id.toLowerCase()}`)

  return `${hasId ? '' : `#${item.id!.toUpperCase()} `}${ticketSummary(item.text, 60)}`
}

/** The names of at most NUDGE_TICKETS tickets, joined for a note. */
function nudgeList(items: readonly TodoItem[]): string {
  return items.slice(0, NUDGE_TICKETS).map(nudgeName).join(', ')
}

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
    const found = linkAgents(todoFiles, [{ ...row, status: 'running' }]).get(row.id) ?? []
    if (found.length > 0) {
      const how = row.status === 'completed' ? 'finished' : `ended (${row.status})`
      pendingEnded = [...pendingEnded, `${agentLabel(index)} ${how}. Its tickets are still open or in progress: ${nudgeList(found.map(link => link.item))}. Close each one whose work is done.`]
    }
  })
}

/** Writes a manual move into the item's todo file, rereads the folder, and queues the note for Claude. */
async function markTicket($: EngineInterface, item: ItemView, status: ItemStatus, toast: string): Promise<void> {
  if (item.folder === undefined || item.file === undefined || item.file.startsWith('archive/')) {
    return
  }
  // Only the file the item came from is written: its folder and its name. The pane shows neither.
  const path = `${item.folder}/${item.file}`
  // Read again under the writer lock: the one box changes in the fresh text, never in a stale copy.
  const isWritten = await withWriteLock(async () => {
    const text = await $.fs.read(path)
    const next = setBox(typeof text === 'string' ? text : '', item.localKey ?? item.key, status)
    if (next === undefined) {
      return false
    }
    await $.fs.write(path, next)

    return true
  })
  if (!isWritten) {
    $.ui.toast(`Not found in ${item.file}: ${ticketSummary(item.text, 60)}`)

    return
  }
  userMoves.set(`${path}:${item.localKey ?? item.key}`, status)
  pendingMoves = [...pendingMoves, `- "${ticketSummary(item.text, 160)}" in ${item.path ?? path}: ${STATUS_WORDS[item.isHeld === true ? 'pending' : item.status]} -> ${STATUS_WORDS[status]}`]
  $.ui.toast(`${toast}: ${ticketSummary(item.text, 60)}`)
  await scan($)
}

/** The prompt a ticket in progress sends: a short status update in the chat, and no new work. */
export function statusPrompt(path: string, text: string): string {
  return [
    `Give me a short status update on this todo item from ${path}:`,
    '',
    text,
    '',
    'Say what is done, what is running now (name any agent on it), and what is left. Check the work itself, not only the todo line. Do not start new work on it.',
  ].join('\n')
}

/** A short hover group name for a ticket's send arrow and its tip: at most 64 characters. */
export function sendScope(key: string): string {
  let hash = 0
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0
  }

  return `send-${(hash >>> 0).toString(36)}`
}

/** A ticket's one or two summary lines: the item's text cut to `chars`, at a word. */
export function ticketSummary(text: string, chars: number): string {
  if (text.length <= chars) {
    return text
  }
  const cut = text.slice(0, chars)
  const space = cut.lastIndexOf(' ')

  return `${(space > chars * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

// ---------------------------------------------------------------- orchestrator

/** A tool call's own one-line summary: its `description` as written, else a few words from its arguments. */
export function callSummary(tool: string, input: Record<string, unknown>): string {
  const description = input.description

  return typeof description === 'string' && description.trim() !== '' ? description.trim().split('\n')[0]! : describeCall(tool, input)
}

/** A Bash command with an obvious secret in it: its detail line is hidden. */
const SECRET = /--password|token=|authorization:|api[_-]?key|secret/i
/** The longest detail kept per history entry; the card cuts it again to fit its line. */
export const DETAIL_MAX = 300

/**
 * The native detail of a tool call, from its input: the command, path, pattern or URL it ran with.
 * Undefined when the tool has none (MCP tools), or the detail only repeats the summary `line`. A
 * path inside `root` shows relative to it. A Bash command that looks like it holds a secret shows
 * as "(hidden)".
 */
export function callDetail(tool: string, input: Record<string, unknown>, line: string, root?: string): string | undefined {
  const text = (key: string): string | undefined => {
    const value = input[key]

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  const rel = (path: string | undefined): string | undefined => (path === undefined ? undefined : (relIn(path, root) ?? path))
  let detail: string | undefined
  if (tool === 'Bash') {
    const command = text('command')
    detail = command === undefined ? undefined : SECRET.test(command) ? '(hidden)' : command.split('\n')[0]!.trim()
  } else if (tool === 'Read' || tool === 'Edit' || tool === 'Write') {
    detail = rel(text('file_path'))
  } else if (tool === 'NotebookEdit') {
    detail = rel(text('file_path') ?? text('notebook_path'))
  } else if (tool === 'Grep') {
    const pattern = text('pattern')
    const path = rel(text('path'))
    detail = pattern === undefined ? undefined : path === undefined ? pattern : `${pattern}  ${path}`
  } else if (tool === 'Glob') {
    detail = text('pattern')
  } else if (tool === 'WebFetch') {
    detail = text('url')
  } else if (tool === 'WebSearch') {
    detail = text('query')
  } else if (tool === 'Agent' || tool === 'Task') {
    detail = [text('subagent_type'), text('model')].filter(part => part !== undefined).join(', ')
  } else if (tool === 'Skill') {
    detail = text('skill')
  }
  detail = detail?.slice(0, DETAIL_MAX)

  return detail === undefined || detail === '' || detail === line ? undefined : detail
}

// ---------------------------------------------------------------- orchestrator tickets

/** The live tickets of the todo files: item key to status. With `path`, only the file at that path (else all, when none matches). */
function ticketStatuses(path?: string): Map<string, ItemStatus> {
  const files = todoFiles.filter(file => file.isArchived !== true)
  const same = path === undefined ? [] : files.filter(file => path === `${file.folder}/${file.name}` || path.endsWith(`/${filePath(file)}`))
  const statuses = new Map<string, ItemStatus>()
  for (const file of same.length > 0 ? same : files) {
    for (const item of file.items) {
      const key = qualifiedKey(file, item)
      // One key in two files: in progress wins over open over done.
      const rank = (status?: ItemStatus) => (status === 'in_progress' ? 2 : status === 'pending' ? 1 : 0)
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
  const fresh = keys.filter(key => !orchTickets.has(key))
  for (const key of fresh) {
    orchTickets.set(key, statuses.get(key) === 'in_progress')
  }
  if (fresh.length > 0) {
    redraw($)
  }
}

/**
 * Ends the claims on tickets that are done or gone, and on tickets back to open after they were
 * seen in progress. A ticket sent to Claude is open until Claude starts it, so an open ticket never
 * seen in progress stays claimed. Skipped while no todo file is known, as before the first scan.
 */
function pruneTickets(): boolean {
  if (todoFiles.length === 0) {
    return false
  }
  const statuses = ticketStatuses()
  let isChanged = false
  for (const [key, seen] of orchTickets) {
    const status = statuses.get(key)
    if (status === undefined || status === 'completed' || (status === 'pending' && seen)) {
      orchTickets.delete(key)
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
      const key = qualifiedKey(file, item)
      const last = namedAt.get(key)
      if (orchTickets.has(key) && item.status === 'in_progress' && (last === undefined || time - last >= NUDGE_REPEAT_MS) && !due.some(one => one.key === key)) {
        due.push({ key, item })
      }
    }
  }
  const named = due.slice(0, NUDGE_TICKETS)
  for (const one of named) {
    namedAt.set(one.key, time)
  }

  return named.length === 0 ? undefined : `Still in progress from earlier: ${nudgeList(named.map(one => one.item))}. Close any whose work is done.`
}

/** The orchestrator as the view draws it: Running between the prompt and the end of a main-conversation turn. */
function orchestratorState(): OrchestratorState {
  const last = orchestrator.history[orchestrator.history.length - 1]

  return { keys: new Set(orchTickets.keys()), isRunning: orchestrator.isActive, toolCalls: orchestrator.history.length, ...(last === undefined ? {} : { doing: last.line }), ...(orchTitle === undefined ? {} : { title: orchTitle }) }
}

/** A history entry for a main-conversation call: its summary, time and native detail. */
async function orchestratorEntry($: EngineInterface, input: Record<string, unknown> & { tool: string }): Promise<OrchestratorEntry> {
  const line = callSummary(input.tool, input)
  const detail = callDetail(input.tool, input, line, repoRoot)

  return { id: (callCount += 1), line, at: await $.clock.now(), isRunning: true, ...(detail === undefined ? {} : { detail }) }
}

const ORCHESTRATOR_KEPT = 1000
const ORCHESTRATOR_PAGE = 5

/** "Newest 5 of 57" on the first page, then "11 to 15 of 57". */
export function pageLabel(view: { entries: readonly unknown[]; page: number }, total: number): string {
  const from = view.page * ORCHESTRATOR_PAGE + 1

  return view.page === 0 ? `Newest ${view.entries.length} of ${total}` : `${from} to ${from + view.entries.length - 1} of ${total}`
}

/** One page of the history, newest first, and how many pages there are; a page past the end shows the last. */
export function orchestratorView(history: readonly OrchestratorEntry[], page: number): { entries: OrchestratorEntry[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(history.length / ORCHESTRATOR_PAGE))
  const at = Math.min(Math.max(0, page), pages - 1)
  const newest = [...history].reverse()

  return { entries: newest.slice(at * ORCHESTRATOR_PAGE, (at + 1) * ORCHESTRATOR_PAGE), page: at, pages }
}

// ---------------------------------------------------------------- task notifications

const NOTIFIED_ENDS: Record<string, AgentRowStatus> = { completed: 'completed', failed: 'failed', killed: 'killed', stopped: 'killed', timeout: 'failed', timed_out: 'failed' }

/** The task ID and end status a task notification reports; none when it reports no end. A background agent's task ID is its agent ID. */
export function notifiedEnd(text: string): { id: string; status: AgentRowStatus } | undefined {
  const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)?.[1]
  const status = NOTIFIED_ENDS[(/<status>\s*([^<\s]+)\s*<\/status>/.exec(text)?.[1] ?? '').toLowerCase()]

  return id === undefined || status === undefined ? undefined : { id, status }
}

// ---------------------------------------------------------------- loop

let ticker: Timer | undefined
let ticks = 0

/** The session's token burn, kept in the store under its session ID, so a reload keeps the count. */
let isBurnLoaded = false

async function burnKey($: EngineInterface): Promise<string> {
  return `tokens:${await $.session.id()}`
}

/** Loads the count once per load of the mod; the count starts the first time the mod sees the session. */
async function readUsage($: EngineInterface): Promise<void> {
  if (isBurnLoaded) {
    return
  }
  isBurnLoaded = true
  const stored = (await $.store.get(await burnKey($)).catch(() => undefined)) as Partial<Usage> | undefined
  if (stored !== undefined && typeof stored.tokens === 'number' && typeof stored.since === 'number') {
    usage = { tokens: stored.tokens, since: stored.since, ...(typeof stored.atCompact === 'number' ? { atCompact: stored.atCompact } : {}) }
    redraw($)
  }
}

/** The tokens one turn used, every kind summed. */
export function turnTokens(used: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number {
  return used.input_tokens + used.output_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens
}

async function addBurn($: EngineInterface, used: number, isCompact = false): Promise<void> {
  await readUsage($)
  const time = await $.clock.now()
  const base = usage ?? { tokens: 0, since: time }
  usage = isCompact ? { ...base, atCompact: base.tokens } : { ...base, tokens: base.tokens + used }
  await $.store.set(await burnKey($), usage).catch(() => undefined)
  redraw($)
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
      if (recatNote !== undefined && (await $.clock.now()) >= recatNote.until) {
        recatNote = undefined
        redraw($)
      }
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
    })().catch(() => undefined)
  })
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
  const counts = view.total === 0 ? 'No checkbox items in .claude_todo/' : `${view.done} of ${view.total} done, ${view.active} in progress`
  return files === 0 ? counts : `${counts}. Pulling todo from ${files} ${files === 1 ? 'file' : 'files'}`
}

/** The heading's buttons for many folders: Consolidate todos with more than one folder, Delete empty todos and Delete duplicate tickets while they have work. */
function todoActions($: EngineInterface): { key: string; label: string; onPress: () => void }[] {
  return [
    ...(canDeleteDupTickets() ? [{ key: 'todo-delete-dup-tickets', label: 'Delete duplicate tickets', onPress: () => void deleteDupTickets($).catch(() => undefined) }] : []),
    ...(canDeleteEmpty() ? [{ key: 'todo-delete-empty', label: 'Delete empty todos', onPress: () => void deleteEmpty($).catch(() => undefined) }] : []),
    ...(canConsolidate() ? [{ key: 'todo-consolidate', label: 'Consolidate todos', onPress: () => void consolidate($).catch(() => undefined) }] : []),
  ]
}

// ---------------------------------------------------------------- hooks

/**
 * The rules the mod gives Claude, as a context block of its own beside CLAUDE.md, so the mod needs no
 * edit to anyone's CLAUDE.md. The `rules` option turns it off for those who write their own.
 */
export const RULES = [
  'This session runs the Claudeopticon mod. Its Claudeopticon pane reads the project todo and shows the agents working on it. Follow these rules for the todo:',
  '',
  "- Todo items go in `.claude_todo/` at the root of the repo's main checkout (a git worktree uses the main checkout's). Create the folder when the repo has none. Each repo keeps its own items, and only its own. Other `.claude_todo/` folders in the repo also show on the board: keep each item in the folder it is in.",
  '- Write each item as one Markdown checkbox line in a `.md` file at the top level of `.claude_todo/`: `- [ ]` open, `- [~]` in progress, `- [x]` done. Prose, tables and headings may surround the items; only checkbox lines count. Update the box the moment the status changes.',
  '- Give each item an ID, unique in the project, in its line: `#T` and 4 digits and capital letters, the first a digit (`- [ ] #T002B Fix the parser`). Use the next free IDs the mod gives you with each prompt. Old short IDs (`#T12`) stay valid. An item with no ID gets one from the mod. When you dispatch an agent for an item, put its ID in the Agent call\'s description and mark the item `[~]`: the pane links the agent to the item by that ID.',
  '- When a ticket is done, check it off (`- [x]`). Never delete a done item, and never fold done items into a summary line. The mod then moves each done ticket (with its indented lines) to `.claude_todo/archive/<same file>` by itself, a few seconds later. That is expected: never move it back, and never treat it as lost.',
  '- When the work of an item is done, check it off (`- [x]`) in the same turn, before your final reply. Never leave finished work open or in progress. When an agent you started for an item finishes, check its result and close the item if the work is done.',
  '- When you work on tickets yourself (not through an agent), call `mcp__claudeopticon__report_progress` with `title` (a headline for the assignment) and `items`; call it again when the assignment changes.',
  '- All work is ticketed. Before you start any work, find its item or add one, and mark it `[~]`. Never do work that has no item.',
  '- The user can move items by hand on the Claudeopticon pane board. You are told of each move with your next tool result or prompt. Follow it: stop work on an item moved to open or done. Never change the box of an item the user moved by hand yourself. If you think a move is wrong, call `mcp__claudeopticon__move_ticket`, which asks the user and writes the box only on a yes. If the item is in more than one file, it refuses and lists them: call it again with `folder` set to the item\'s folder path.',
].join('\n')

export const register: Register = (on, options) => {
  // Give Claude the todo rules, unless the user turned them off in the mod's options.
  on('prompt.context', async ($, e, next) => {
    const context = await next(e)

    return options.rules === false || context.blocks.some(block => block.name === 'claudeopticon')
      ? context
      : { ...context, blocks: [...context.blocks, { name: 'claudeopticon', text: RULES }] }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'claudeopticon',
      description: 'Show the project todo and the running agents in one pane',
    })
    $.ui.status(undefined)
    await $.tool
      .register({
        name: 'report_progress',
        description: 'Report your progress to the user: steps done of steps planned, and the current step.',
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
          },
          required: ['done', 'total'],
        },
        isDeferred: false,
      })
      .catch(() => undefined)
    await $.tool
      .register({
        name: 'move_ticket',
        description:
          "Ask the user to approve moving a .claude_todo item to another column of the Claudeopticon pane board: open, in_progress or done. The user sees a dialog; the box is written only if they approve. Use it for any item the user moved by hand, instead of editing its box.",
        inputSchema: {
          type: 'object',
          properties: {
            item: { type: 'string', description: "The item's #T ID, or its text quoted from its line" },
            folder: { type: 'string', description: "Only when the item ID or text is in more than one file: the item's folder path as the prompts give it (mods/x/.claude_todo), or its file path (mods/x/.claude_todo/TODO.md)" },
            to: { type: 'string', enum: ['open', 'in_progress', 'done'], description: 'Where to move it' },
            reason: { type: 'string', description: 'Why, in one or two sentences, shown to the user' },
          },
          required: ['item', 'to', 'reason'],
        },
        isDeferred: false,
      })
      .catch(() => undefined)
    await scan($).catch(() => undefined)
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
          description: e.description,
          type: e.subagentType,
          model: spawned.model,
          status: 'running',
          startedAt: await $.clock.now(),
          toolCalls: 0,
          doing: 'Starting',
          brief: normalize(`${e.description}\n${e.prompt.slice(0, 4000)}`),
        }
        agentRows = [...agentRows.filter(one => one.id !== id), row]
        matchNewAgents($, [row])
        await refreshAgents($)
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
    const title = id === undefined ? readTitle(input.title) : undefined
    if (id !== undefined && (progress !== undefined || claims !== undefined)) {
      agentRows = agentRows.map(row =>
        row.id !== id ? row : { ...row, ...(progress === undefined ? {} : { progress }), ...(claims === undefined ? {} : { claims }) },
      )
      redraw($)
    }
    if (id === undefined && claims !== undefined) {
      // The main conversation names tickets: they are its own. A helper's claim never is.
      await scan($).catch(() => undefined)
      const open = [...todoFiles.filter(file => file.isArchived !== true).flatMap(file => file.items.map(item => ({ key: qualifiedKey(file, item), item })))].filter(one => one.item.status !== 'completed')
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
      const checked = claimCheckedAt.get(id)
      if (claims !== undefined || checked === undefined) {
        claimCheckedAt.set(id, time)
      }
      const isDue = claims === undefined && checked !== undefined && time - checked >= CLAIM_CHECK_MS
      if (isDue) {
        claimCheckedAt.set(id, time)
      }
      reply = progressReply(agentRows.find(row => row.id === id)?.claims, isDue)
    }

    return { result: reply }
  })

  on('tool.call', { tool: MOVE_TOOL }, async ($, e) => {
    const text = await moveTicket($, e as unknown as Record<string, unknown>)

    return { result: text }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined && e.tool !== PROGRESS_TOOL) {
      const doing = describeCall(e.tool, e as unknown as Record<string, unknown>)
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
    const before = id === undefined && typeof path === 'string' && path.includes(DIR) ? ticketStatuses(path) : undefined
    const ran = await next(e).finally(() => {
      if (entry !== undefined) {
        entry.isRunning = false
        redraw($)
      }
    })
    if (typeof path === 'string' && path.includes(DIR)) {
      await scan($).catch(() => undefined)
      if (before !== undefined) {
        claimTickets($, [...ticketStatuses(path)].filter(([key, status]) => status === 'in_progress' && before.get(key) !== 'in_progress').map(([key]) => key))
      }
    }
    // Moves made by hand reach the main conversation with its next tool result, mid-turn.
    const queued = id === undefined ? queuedNotes() : []
    if (queued.length === 0 || ran.deny !== undefined) {
      return ran
    }
    pendingMoves = []
    pendingRenames = []
    pendingNumbered = []
    pendingRemoved = []
    pendingEnded = []

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
          agentRows = agentRows.map(row => (row.id === ended.id ? { ...row, status: ended.status, endedAt: row.endedAt ?? clockMs } : row))
          noteEnds(old, agentRows)
          redraw($)
        }
      }
    }
    // Moves not yet told with a tool result ride on the next prompt, a ticket button's own included.
    const moves = queuedNotes()
    pendingMoves = []
    pendingRenames = []
    pendingNumbered = []
    pendingRemoved = []
    pendingEnded = []
    const isLabeled = LABEL.test(e.text)
    LABEL.lastIndex = 0
    if (isLabeled) {
      await refreshAgents($).catch(() => undefined)
    }
    // The next free IDs, recomputed each prompt; not for a notification the mod's host sends by itself.
    let idLine: string | undefined
    if (options.rules !== false && e.origin?.kind !== 'task-notification' && (todoFolders ?? []).length > 0) {
      pruneReserved()
      const known = [...projectIds(), ...reservedIds]
      idLine = nextIdsLine(known)
      // The IDs named now are reserved: the mod gives them to no line, and the next prompt names fresh ones.
      for (const id of nextTicketIds(known, NEXT_IDS_SHOWN)) {
        reservedIds.add(id.toLowerCase())
      }
    }
    const notes = [...moves, isLabeled ? labelNote(e.text, agentRows) : undefined, idLine, options.rules !== false && e.origin?.kind !== 'task-notification' ? await stillOpenLine($) : undefined].filter(note => note !== undefined)
    orchestrator = { ...orchestrator, isActive: true }
    redraw($)

    return next(notes.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...notes] })
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined) {
      await addBurn($, 0, true).catch(() => undefined)
    }

    return compacted
  })

  // Each model request an agent makes: its tokens go on the agent's card, from the step's result,
  // else from its stop chunk. The main loop's count is only on the top card, from turn.complete.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      return yield* next(e)
    }
    stepModels.set(e.agentId, e.model)
    wake(e.agentId)
    const stream = next(e)
    let stopUsage: Parameters<typeof turnTokens>[0] | undefined
    for (;;) {
      const read = await stream.next()
      if (read.done) {
        const used = read.value?.usage ?? stopUsage
        if (used) {
          pendingTokens.set(e.agentId, (pendingTokens.get(e.agentId) ?? 0) + turnTokens(used))
        }

        return read.value
      }
      if (read.value.kind === 'stop' && read.value.usage) {
        stopUsage = read.value.usage
      }
      yield read.value
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.usage !== undefined) {
      await addBurn($, turnTokens(e.usage)).catch(() => undefined)
    }
    if (e.agentId !== undefined) {
      // A turn that ends with nothing after it leaves the agent finished but open, until a stop.
      const id = e.agentId
      const time = await $.clock.now()
      agentRows = agentRows.map(row => (row.id === id && !isEnded(row.status) ? { ...row, idleSince: time } : row))
      // The end of an agent's turn folds in its last tokens at once, not on the next clock step.
      await refreshAgents($, true).catch(() => undefined)
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
      void Promise.resolve().then(() => $.ui.open({ id: PANE, title: TITLE })).catch(() => {
        isRetitled = false
      })
    }
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const Input = 'Input' in table ? table.Input : undefined
    const rows = agentRows
    const time = Math.max(clockMs, ...rows.map(row => row.endedAt ?? row.startedAt))
    if (pruneTickets()) {
      saveAgents($)
    }
    const view = { ...buildView(todoFiles, rows, time, orchestratorState()), ...(usage === undefined ? {} : { usage }) }

    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined
    if (Svg !== undefined) {
      setWidth((e.props.bodyColumns ?? 48) * CELL_PX)
      const { active, idle, finished, shown } = ledger(view)
      const card = (key: string, drawn: { source: string; width: number; alt: string }) => (
        <Svg key={key} source={drawn.source} alt={drawn.alt} width={drawn.width} />
      )
      const section = (key: string, title: string, detail: string, buttonLabel: string | undefined, toggle: () => void, extra: { key: string; label: string; onPress: () => void }[] = [], showDone?: { label: string; onPress: () => void }) => (
        <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
          <Box flexDirection="row" gap={2}>
            <Text bold>{title}</Text>
            <Text dimColor>{detail}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            {extra.filter(one => one.key !== 'todo-consolidate').map(one => <Button key={one.key} label={one.label} onPress={one.onPress} />)}
            {buttonLabel !== undefined && <Button key={`${key}-toggle`} label={buttonLabel} onPress={toggle} />}
            {showDone !== undefined && <Button key="todo-show-completed" label={showDone.label} onPress={showDone.onPress} />}
            {extra.filter(one => one.key === 'todo-consolidate').map(one => <Button key={one.key} label={one.label} onPress={one.onPress} />)}
          </Box>
        </Box>
      )

      return (
        <Box flexDirection="column" gap={1}>
          {(view.total > 0 || view.agents.length > 0 || view.usage !== undefined) && card('hero', heroSvg(view))}
          {section(
            'orchestrator',
            'Orchestrator',
            orchestrator.isActive ? 'Working' : orchestrator.history.length === 0 ? 'Idle, nothing done yet' : 'Idle',
            undefined,
            () => undefined,
          )}
          {/* As the Agents card: with nothing done yet, the heading alone. */}
          {orchestrator.history.length > 0 && card('orchestrator', orchestratorSvg(orchestratorView(orchestrator.history, orchestratorPage).entries))}
          {orchestratorView(orchestrator.history, orchestratorPage).pages > 1 && (
            <Box key="orchestrator-pages" flexDirection="row" gap={1} alignItems="center">
              <Text dimColor>{pageLabel(orchestratorView(orchestrator.history, orchestratorPage), orchestrator.history.length)}</Text>
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
          {view.agents.length > 0 && card('timeline', timelineSvg(view, shown))}
          {/* The orchestrator leads, before A1; no Stop button, no timeline bar. */}
          {view.orchestrator !== undefined && card('agent-orchestrator-card', agentSvg(view.orchestrator, view))}
          {shown.map(agent => (
            // A live agent's Stop button sits left of its status badge, in the room the card keeps free.
            <Box key={`agent-${agent.index}`} flexDirection="column" position="relative">
              {card(`agent-${agent.index}-card`, agentSvg(agent, view))}
              {!agent.isEnded && (
                <Box position="absolute" right={ACTION_RIGHT + Math.ceil(stopInsetPx(agent) / CELL_PX)} top={STOP_TOP}>
                  <Button key={`agent-stop-${agent.index}`} label={STOP_GLYPH} onPress={() => stopAgent($, agent.index)} />
                </Box>
              )}
            </Box>
          ))}
          {section(
            'todo',
            'Todo',
            todoDetail(view),
            undefined,
            () => undefined,
            todoActions($),
            archiveLink === undefined ? undefined : { label: `Show completed (${view.archived})`, onPress: () => void openArchive($).catch(() => undefined) },
          )}
          {(
            <Box key="todo-controls" flexDirection="row" gap={1} alignItems="center">
              {Input !== undefined && (
                <Input
                  key="todo-search"
                  placeholder="Search open and done items"
                  value={query}
                  submitLabel="Search"
                  onInput={(value: string) => {
                    query = value
                    redraw($)
                  }}
                  onSubmit={(value: string) => {
                    query = value
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
              {openItems().length > 0 && (
                <Button
                  key="todo-recategorize"
                  label="Recategorize"
                  onPress={() => {
                    void recategorize($).catch(() => undefined)
                  }}
                />
              )}
              {(isRecategorizing || recatNote !== undefined) && <Text dimColor>{isRecategorizing ? 'Recategorizing...' : recatNote!.text}</Text>}
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
          )}
          {query.trim() === '' && filterNames(todoLedger(view), book).length > 0 && (
            <Box key="category-filter" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
              <Text dimColor>Categories</Text>
              {filterNames(todoLedger(view), book).map(name => (
                <Button
                  key={`category-toggle-${name}`}
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
              <Text dimColor>{`${searchTodo(view.files, query).reduce((sum, file) => sum + file.items.length, 0)} matching items, open and done`}</Text>
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
                // The board keeps the live files whole, done tickets too: its Done column lists them.
                : withoutHidden(isTicketView ? view.files.filter(file => file.isArchived !== true) : todoLedger(view), book, hiddenCategories).map(file => ({ file, prefix: 'file' })),
            isTicketView,
            query.trim() === '' ? archivedNow.filter(one => !hiddenCategories.has(book.items[one.key] ?? UNSORTED)) : [],
          ).flatMap(({ file, prefix, rows }) => {
            const id = `${prefix}:${file.id}`
            const isExpanded = expandedFiles.has(id)
            const limit = isExpanded ? file.items.length : ITEMS_SHOWN
            const isTextOpen = openText.has(id)
            const showDone = query.trim() !== '' || file.items.some(item => item.status === 'completed')
            const sections = (file.groups ?? [{ name: '', from: 0, count: file.items.length }]).map(group => ({
              name: group.name,
              columns: ticketColumns(file.items.slice(group.from, group.from + group.count), book, showDone),
            }))
            // Side by side while each ticket has room for its text and buttons; else one under another.
            const sideBy = showDone ? 3 : 2
            const isStacked = Math.floor((cardWidth() - (sideBy - 1) * CELL_PX) / sideBy) < MIN_TICKET_PX
            const columnCount = isStacked ? 1 : sideBy
            const ticketW = Math.floor((cardWidth() - (columnCount - 1) * CELL_PX) / columnCount)
            const ticket = (item: ItemView, k: number) => {
              const sentKey = `${item.file ?? file.name}:${item.key}`
              const isSent = sentTickets.has(sentKey)
              const category = book.items[item.key]
              const id = new RegExp(`#${ID_SRC}\\b`).exec(item.text)?.[0]
              // The buttons, left to right: the manual moves, which only mark the box, then Claude's
              // action in the corner: an open ticket sends itself, one in progress (or sent) asks for status.
              const actions: TicketAction[] =
                item.status === 'completed'
                  ? []
                  : item.status === 'pending'
                    ? [START_ACTION, isSent ? STATUS_ACTION : SEND_ACTION]
                    : [...(item.isHeld === true ? [] : [REOPEN_ACTION]), DONE_ACTION, STATUS_ACTION]
              const drawn = ticketSvg(item, view, ticketW, { ...(id === undefined ? {} : { id }), ...(category === undefined ? {} : { category }), isSent, actions: actions.length })
              const press = (action: TicketAction) => {
                if (action.mark !== undefined) {
                  void markTicket($, item, action.mark, action.toast).catch(() => undefined)

                  return
                }
                if (action === SEND_ACTION) {
                  sentTickets.add(sentKey)
                }
                // The prompt goes to the main conversation: the ticket is the orchestrator's.
                claimTickets($, [item.key])
                void $.prompt.submit({ text: action.prompt(item.path ?? `${DIR}/${item.file ?? file.name}`, item.text), asUser: true }).catch(() => undefined)
                $.ui.toast(`${action.toast}: ${ticketSummary(item.text, 60)}`)
                redraw($)
              }

              // The buttons sit over the card's bottom row, which the card keeps free for them;
              // pointing at one reveals its tip in the same row, left of them all, cut to fit.
              return (
                <Box key={`${prefix}-${file.id}-t${k}-${item.file ?? ''}-${item.key}`} flexDirection="column" position="relative">
                  {card(`${prefix}-${file.id}-c${k}-${item.file ?? ''}-${item.key}`, drawn)}
                  {actions.map(action => (
                    <Box
                      key={`${prefix}-${file.id}-tip-${action.name}-${item.file ?? file.name}-${item.key}`}
                      position="absolute"
                      left={2}
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
                          key={action === SEND_ACTION || action === STATUS_ACTION ? `ticket-${item.file ?? file.name}-${item.key}` : `ticket-${action.name}-${item.file ?? file.name}-${item.key}`}
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
                    <Box key={`${prefix}-${file.id}-board-${section.name}`} flexDirection="column" gap={1}>
                      {section.name !== '' && (
                        <Box flexDirection="row" gap={1} marginTop={1}>
                          <Text bold>{section.name}</Text>
                          <Text dimColor>{String(section.columns.reduce((sum, column) => sum + column.items.length, 0))}</Text>
                        </Box>
                      )}
                      <Box flexDirection={isStacked ? 'column' : 'row'} gap={1} alignItems="flex-start">
                        {section.columns.map(column => (
                          <Box key={`${prefix}-${file.id}-col-${section.name}-${column.name}`} flexDirection="column" gap={1} width={columnCount === 3 ? '32%' : columnCount === 2 ? '49%' : '100%'}>
                            <Box flexDirection="row" gap={1}>
                              <Text dimColor bold>{column.name}</Text>
                              <Text dimColor>{String(column.items.length)}</Text>
                            </Box>
                            {column.items.slice(0, isExpanded ? column.items.length : ITEMS_SHOWN).map(ticket)}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )),
                ]
              : fileCards(file, view, limit, isTextOpen).map((drawn, k) => card(`${prefix}-${file.id}-${k}`, drawn))
            const more = isTicketView
              ? sections.flatMap(section => section.columns).reduce((sum, column) => sum + Math.max(0, column.items.length - ITEMS_SHOWN), 0)
              : file.items.length - ITEMS_SHOWN
            const long = isTicketView ? 0 : longItems(file, limit)
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
                  <Box key={`${prefix}-${file.id}-more`} flexDirection="row" justifyContent="flex-end" gap={1}>
                    {long > 0 && (
                      <Button
                        key={`${prefix}-text-${file.id}`}
                        label={isTextOpen ? 'Shorten long items' : `Show full text (${long} long ${long === 1 ? 'item' : 'items'})`}
                        onPress={toggle(openText)}
                      />
                    )}
                    {more > 0 && (
                      <Button
                        key={`${prefix}-toggle-${file.id}`}
                        label={isExpanded ? 'Show fewer' : `Show all ${file.items.length} items`}
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
      <Text key={`chip-${i}`} backgroundColor={agentColor(i)} color="#FFFFFF" bold>
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
        {heading('Orchestrator', orchestrator.isActive ? '' : 'Idle')}
        {orchestratorView(orchestrator.history, 0).entries.slice(0, 5).map(entry => (
          <Text key={`orchestrator-${entry.id}`} dimColor={!entry.isRunning}>
            {` ${entry.isRunning ? '•' : '·'} ${clock(entry.at)}  ${entry.line}`}
            {entry.detail !== undefined && <Text dimColor>{`  ${clip(entry.detail, Math.max(10, columns - 20 - entry.line.length))}`}</Text>}
          </Text>
        ))}
        {heading('Agents', view.agents.length === 0 ? '' : `${view.live} running, ${view.agents.length - view.live} done`)}
        {ledger(view).finished.length > 0 && (
          <Button
            key="agents-toggle"
            label={isFinishedShown ? 'Hide finished agents' : `Show finished agents (${ledger(view).finished.length})`}
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
            {view.orchestrator.links.map(link => (
              <Box key={`link-${link}`}>
                <Text dimColor>{'  Working on '}</Text>
                <Text color={agentColor(ORCH)}>{clip(link, columns - 16)}</Text>
              </Box>
            ))}
            <Text dimColor>
              {`  ${view.orchestrator.type} · `}
              <Text color={view.orchestrator.isIdle ? undefined : ACCENT}>{view.orchestrator.isIdle ? 'idle' : 'running'}</Text>
              {` · ${view.orchestrator.toolCalls} tool call${view.orchestrator.toolCalls === 1 ? '' : 's'}`}
            </Text>
            {view.orchestrator.doing !== undefined && <Text dimColor>{`  ${view.orchestrator.isIdle ? 'Last: ' : ''}${clip(view.orchestrator.doing, columns - 12)}`}</Text>}
          </Box>
        )}
        {ledger(view).shown.map(agent => {
          const failed = agent.status === 'failed' || agent.status === 'killed'

          return (
            <Box key={`a-${agent.index}`} flexDirection="column" marginTop={1}>
              <Box>
                {chip(agent.index)}
                <Text bold={!agent.isEnded} dimColor={agent.isEnded}>{` ${clip(agent.description, columns - 8)}`}</Text>
              </Box>
              {agent.links.map(link => (
                <Box key={`link-${link}`}>
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
        {heading('Todo', view.total === 0 && todoCount() === 0 ? '' : todoDetail(view))}
        {todoActions($).map(one => (
          <Button key={one.key} label={one.label} onPress={one.onPress} />
        ))}
        {view.total > 0 && <Text color={ACCENT}>{`${bar(view.done, view.total, width)} ${Math.round((view.done / view.total) * 100)}%`}</Text>}
        {archiveLink !== undefined && <Button key="todo-show-completed" label={`Show completed (${view.archived})`} onPress={() => void openArchive($).catch(() => undefined)} />}
        {todoLedger(view).map((file, _, all) => (
          <Box key={file.id} flexDirection="column" marginTop={1}>
            <Text dimColor={file.done === file.total} bold={file.done < file.total}>
              {`${clip(`${file.name}${all.filter(one => one.name === file.name).length > 1 && file.place ? ` ${file.place}` : ''}`, columns - 24)}  ${bar(file.done, file.total, 10)} ${file.done}/${file.total}`}
            </Text>
            {file.items.slice(0, expandedFiles.has(`file:${file.id}`) ? file.items.length : ITEMS_SHOWN).map((item, k) => (
              <Box key={`${file.id}:${k}`}>
                <Text dimColor={item.status !== 'completed'}>
                  {item.status === 'in_progress' ? ' • ' : item.status === 'completed' ? ' ✓ ' : ' ○ '}
                </Text>
                <Text bold={item.owners.length > 0} color={item.owners[0] === undefined ? undefined : agentColor(item.owners[0])} dimColor={item.owners.length === 0 && item.status === 'pending'}>{clip(item.text, columns - 8 - item.owners.length * 5)}</Text>
                {item.owners.map(i => (
                  <Text key={`l-${i}`}> {chip(i)}</Text>
                ))}
              </Box>
            ))}
            {file.items.length > ITEMS_SHOWN && (
              <Button
                key={`file-toggle-${file.id}`}
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
