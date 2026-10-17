/** Sample data for the README images: a fictional CLI tool with a parser, docs and a release. */
import type { AgentView, ItemStatus, ItemView, View } from '../hooks/cards.ts'

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
  item(live[0]!, 'in_progress', [0]), item(live[1]!, 'in_progress', [1]), item(live[2]!, 'in_progress'), item(live[3]!, 'in_progress'),
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

/** A second todo file, so the board header shows one row per file. */
const docs = [
  item('Write the install guide for Linux', 'completed'), item('Write the plugin guide', 'completed'), item('Add the FAQ page', 'completed'),
  item('Move the docs to the new site', 'in_progress'), item('Add search to the docs', 'pending'), item('Fix the broken links', 'pending'),
]

export const view: View = {
  files: [
    { name: 'release.md', id: 'release.md', done: 24, active: 4, total: 40, owners: [0, 1], items, mtimeMs: NOW - MIN },
    { name: 'docs.md', id: 'docs.md', done: 3, active: 1, total: 6, owners: [], items: docs, mtimeMs: NOW - 5 * MIN },
  ],
  agents,
  done: 27, active: 5, total: 46, completed: 27, live: 2, now: NOW,
  usage: { tokens: 17_384_000, atCompact: 12_100_000, since: 0 },
}

export const entries = [
  { line: 'Run the parser tests', at: NOW - 20_000, isRunning: true },
  { line: 'Read the config loader', at: NOW - 75_000, isRunning: false },
  { line: 'Search the docs for the plugin API', at: NOW - 140_000, isRunning: false },
  { line: 'Edit the release checklist', at: NOW - 230_000, isRunning: false },
  { line: 'Start an agent for the config migration', at: NOW - 330_000, isRunning: false },
]

/** Board tickets: [item, id, category]. */
const t = (k: number) => items[k]!
export const progressTickets = [
  [t(24), '#T25', 'Config'], [t(25), '#T26', 'Docs'], [t(26), '#T27', 'Parser'],
] as const
export const openTickets = [
  [t(28), '#T29', 'Release'], [t(30), '#T31', 'Docs'], [t(35), '#T36', 'Release'],
] as const
