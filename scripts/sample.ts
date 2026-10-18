/** Sample data for the README images: a fictional CLI tool with a parser, docs and a release. */
import { ORCH } from '../hooks/agent-identity.ts'
import { stepAxes } from '../hooks/series.ts'
import type { AgentView, ItemStatus, ItemView, View } from '../hooks/card-types.ts'
import type { Point, Series } from '../hooks/series.ts'

export const NOW = Date.UTC(2026, 9, 15, 14, 40, 0)
const MIN = 60_000

const item = (text: string, status: ItemStatus, owners: number[] = []): ItemView => ({ text, status, owners, key: text.toLowerCase() })

const done = [
  'Set up the project layout', 'Add the argument parser', 'Read the config file', 'Add the --verbose flag',
  'Write the lexer', 'Write the tokenizer tests', 'Handle quoted strings', 'Handle escape sequences',
  'Report line numbers in errors', 'Add the help command', 'Add the version command', 'Set up CI',
  'Add a lint step to CI', 'Write the install guide', 'Write the usage guide', 'Add shell completions',
  'Cache parsed files', 'Fix the Windows path bug', 'Add the init command', 'Write the changelog template',
  'Pin the build tools', 'Add the dry-run flag', 'Add the JSON output mode', 'Tag the first beta',
]
const live = [
  'Write the migration for the v2 config format', 'Document the plugin API', 'Fix the parser crash on empty input',
  'Speed up the config loader',
]
const open = [
  'Draft the release notes', 'Add a man page', 'Review the error messages', 'Update the logo in the docs',
  'Add a Homebrew formula', 'Publish the docs site', 'Run the release checklist', 'Announce the release',
  'Triage the beta feedback', 'Add a plugin example', 'Check the exit codes', 'Tag the release',
]

const items = [
  ...done.map(t => item(t, 'completed')),
  item(live[0]!, 'in_progress', [0]), item(live[1]!, 'in_progress', [1]), item(live[2]!, 'in_progress', [ORCH]), item(live[3]!, 'in_progress'),
  ...open.map(t => item(t, 'pending')),
]

export const agents: AgentView[] = [
  {
    index: 0, description: 'Write the v2 config migration', type: 'general-purpose', model: 'sonnet', status: 'running', isEnded: false,
    startedAt: NOW - 9 * MIN, toolCalls: 31, tokens: 2_418_000, doing: 'Edit src/config/migrate.ts', links: [live[0]!],
    progress: { done: 2, total: 7, step: 'Write the migration' },
  },
  {
    index: 1, description: 'Draft the plugin API docs', type: 'general-purpose', model: 'sonnet', status: 'running', isEnded: false,
    startedAt: NOW - 6 * MIN, toolCalls: 14, tokens: 1_062_500, doing: 'Read docs/plugins.md', links: [live[1]!],
    progress: { done: 1, total: 4, step: 'Outline the hooks' },
  },
  {
    index: 2, description: 'Review the parser tests', type: 'reviewer', model: 'opus', status: 'completed', isEnded: true,
    startedAt: NOW - 14 * MIN, endedAt: NOW - 5 * MIN, toolCalls: 22, tokens: 1_735_000, links: [],
  },
]

/** The main conversation, working on a ticket itself: it leads the Agents card, before A1. */
export const orchestrator: AgentView = {
  index: ORCH, description: 'Harden the parser against bad input', type: 'main conversation', status: 'running', isEnded: false,
  startedAt: NOW, toolCalls: 57, doing: 'Run the parser tests', links: [live[2]!],
}

/** A second todo file, so the board header shows one row per file. */
const docs = [
  item('Write the install guide for Linux', 'completed'), item('Write the plugin guide', 'completed'), item('Add the FAQ page', 'completed'),
  item('Move the docs to the new site', 'in_progress'), item('Add search to the docs', 'pending'), item('Fix the broken links', 'pending'),
]

export const view: View = {
  files: [
    { name: 'release.md', id: 'release.md', done: 24, active: 4, total: 40, owners: [0, 1, ORCH], items, mtimeMs: NOW - MIN },
    { name: 'docs.md', id: 'docs.md', done: 3, active: 1, total: 6, owners: [], items: docs, mtimeMs: NOW - 5 * MIN },
  ],
  agents,
  orchestrator,
  done: 27, active: 5, total: 46, archived: 24, live: 2, now: NOW,
  usage: { tokens: 623_590_000, atCompact: 578_780_000, since: 0 },
}

/** Minutes before NOW. */
const ago = (min: number) => NOW - Math.round(min * MIN)

/**
 * The top card's trace: live agents stepping between 1 and 3, a compaction 18 minutes ago (12 minutes into the
 * window), and the count since the last compaction climbing to 44.81M. The totals are those of a long session:
 * 623.59M tokens, 33 of 35 agents finished.
 */
const plotted: Series = {
  agents: [[0, 1], [3, 2], [7, 3], [11, 2], [16, 1], [19, 2], [23, 3], [26, 2]].map(([at, n]) => [ago(30 - at!), n!] as Point),
  // 31M at the left edge to 51.8M at the compaction, then 1M to 44.81M now; a point a minute.
  tokens: [
    ...Array.from({ length: 12 }, (_, i) => [ago(30 - i), Math.round((31_000_000 + (i / 11.9) * 20_800_000) / 10_000) * 10_000] as Point),
    [ago(18), 970_000] as Point,
    ...Array.from({ length: 18 }, (_, i) => [ago(17 - i), Math.round((970_000 + ((i + 1) / 18) * 43_840_000) / 10_000) * 10_000] as Point),
  ],
  compacts: [ago(18)],
}
view.series = plotted
view.axes = stepAxes(undefined, plotted, NOW)

/** The top card counts every agent of the session: 35, of which 33 finished. */
export const heroView: View = {
  ...view,
  agents: [...agents, ...Array.from({ length: 32 }, (_, i): AgentView => ({ ...agents[2]!, index: 3 + i }))],
  live: 2,
}

export const entries = [
  { line: 'Run the parser tests', detail: 'npm test -- --run src/parser', at: NOW - 20_000, isRunning: true },
  { line: 'Read the config loader', detail: 'src/config/loader.ts', at: NOW - 75_000, isRunning: false },
  { line: 'Search the docs for the plugin API', detail: 'registerPlugin  docs', at: NOW - 140_000, isRunning: false },
  { line: 'Edit the release checklist', detail: '.claude_todo/release.md', at: NOW - 230_000, isRunning: false },
  { line: 'Start an agent for the config migration', detail: 'general-purpose, sonnet', at: NOW - 330_000, isRunning: false },
]

/** Board tickets: [item, id, category]. */
const t = (k: number) => items[k]!
export const progressTickets = [
  [t(24), '#T25', 'Config'], [t(25), '#T26', 'Docs'], [t(26), '#T27', 'Parser'],
] as const
export const queuedTickets = [
  [{ ...t(29), status: 'queued' as const }, '#T30', 'Docs'], [{ ...t(34), status: 'queued' as const }, '#T35', 'Release'],
] as const
export const openTickets = [
  [t(28), '#T29', 'Release'], [t(30), '#T31', 'Docs'], [t(35), '#T36', 'Release'],
] as const

/** A token series climbing by `perMin` a minute from `start` over the minutes `from` to `to` ago (one point a minute). */
const climb = (from: number, to: number, start: number, perMin: number): Point[] =>
  Array.from({ length: from - to + 1 }, (_, i) => [ago(from - i), start + i * perMin] as Point)

/**
 * Top-card states for the render check (scripts/render-hero.ts): the README sample; a compaction a
 * minute ago, so the Compacted label sits at the right edge with the end labels; the owner's case of
 * the agent and token traces crossing at the right edge; and every trace at zero.
 */
export function heroStates(): Record<string, View> {
  const of = (series: Series, usage: View['usage'], live = 2): View => ({ ...heroView, series, axes: stepAxes(undefined, series, NOW), usage, live })
  const lateCompact: Series = {
    agents: [[ago(30), 2], [ago(12), 3], [ago(4), 4]],
    tokens: [...climb(30, 2, 20_000_000, 900_000), [ago(1), 0], [ago(0.5), 400_000]],
    compacts: [ago(1)],
  }
  const crossing: Series = {
    agents: [[ago(30), 1], [ago(20), 3], [ago(2.5), 2]],
    tokens: climb(30, 0, 3_330_000, 1_000_000),
    compacts: [],
  }
  const zero: Series = { agents: [[ago(30), 0]], tokens: [[ago(20), 0]], compacts: [] }

  return {
    sample: heroView,
    'late-compact': of(lateCompact, { tokens: 650_000_000, atCompact: 649_600_000, since: 0 }, 4),
    crossing: of(crossing, { tokens: 659_630_000, atCompact: 626_300_000, since: 0 }),
    zero: of(zero, { tokens: 1_000, atCompact: 1_000, since: 0 }, 0),
  }
}
