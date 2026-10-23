/** The todo rules the mod gives Claude as a context block. */

/**
 * The rules the mod gives Claude, as a context block of its own beside CLAUDE.md, so the mod needs no
 * edit to anyone's CLAUDE.md. The `rules` option turns it off for those who write their own.
 */
export const RULES = [
  'This session runs the Claudeopticon mod. Its Claudeopticon pane reads the project todo and shows the agents working on it. Follow these rules for the todo:',
  '',
  "- Todo items go in `.claude_todo/` at the root of the repo's main checkout (a git worktree uses the main checkout's). Create the folder when the repo has none. Each repo keeps its own items, and only its own. Other `.claude_todo/` folders in the repo also show on the board: keep each item in the folder it is in.",
  "- Never make or use the global todo folder, `~/.claude/.claude_todo/` (or `.claude_todo/` in `$CLAUDE_CONFIG_DIR`): the board never reads it. When the repo root is that folder's parent (`~/.claude` is a git repo), use the nearest project folder instead: the `.claude_todo/` of the project you work in, below that root, made there when it has none.",
  '- Write each item as one Markdown checkbox line in a `.md` file at the top level of `.claude_todo/`: `- [ ]` open, `- [>]` queued, `- [~]` in progress, `- [x]` done, with one space after the dash and one space inside an open box. The board also reads `*` or `+` for the dash and `[X]` as done, but write the four forms above. A numbered line (`1. [ ] a`) or two spaces after the dash is not an item. Prose, tables and headings may surround the items; only checkbox lines count. Update the box the moment the status changes.',
  '- Give each item an ID, unique in the project, in its line: `#T` and 4 digits and capital letters, the first a digit (`- [ ] #T002B Fix the parser`); the mod gives 5 (`#T10000`, `#T12346`) when a 5-character ID is in use or the 4-character ones run out. Use the next free IDs the mod gives you with each prompt. Old short IDs (`#T12`) stay valid. An item with no ID gets one from the mod. When you dispatch an agent for an item, put its ID in the Agent call\'s description and mark the item `[~]`: the pane links the agent to the item by that ID.',
  '- When a ticket is done, check it off (`- [x]`). Never delete a done item, and never fold done items into a summary line. The mod then moves each done ticket whose subtasks are all done (with its indented lines) to `.claude_todo/archive/<same file>` by itself, a few seconds later; a done ticket with an open subtask stays until that subtask is done. That is expected: never move it back, and never treat it as lost.',
  '- When the work of an item is done, check it off (`- [x]`) in the same turn, before your final reply. Never leave finished work open or in progress. When an agent you started for an item finishes, check its result and close the item if the work is done.',
  '- When you work on tickets yourself (not through an agent), call `mcp__claudeopticon__report_progress` with `title` (a headline for the assignment) and `items`; call it again when the assignment changes.',
  "- Send your session name once, in your first `mcp__claudeopticon__report_progress` call, as `session`: the name ListAgents shows after \"This session is\", without the bracketed ref. Other sessions on the repo then name you in the hover tip on your tickets.",
  "- When you queue a ticket (`- [>]`) for another session, or only to order or triage the work (for example the user asked you to order the backlog), release it: call `mcp__claudeopticon__report_progress` with `release` set to the ticket IDs. The mod claims a ticket you queue yourself as your planned work, and tells you so.",
  '- A ticket another session claims (the board shows a "Peer owned" tag) is theirs: ask that session with SendMessage before you take it. If its owner has no name, call ListAgents and ask each other session, naming the ticket and this repo\'s root path, whether it claims the ticket. When another session asks you for a ticket you claim and you agree, release it with `report_progress` `release`.',
  '- Queued (`- [>]`) is the work slated next, not started yet: the board shows it in a Queued column between In progress and Open. When you decide a ticket comes next or waits for an event ("after X lands, I will take #T0042"), mark it `[>]` at once. When you add a ticket you plan to work on now, next, or after the next checkpoint, gate, closeout or merge, write it `[>]`, not `[ ]`; write `[ ]` only for backlog with no plan. When you stop work on a ticket you have not finished and still plan to do, set it to `[>]`, not `[ ]`; the mod does this for you when you set `[~]` back to `[ ]`. When you start a queued ticket, mark it `[~]`.',
  '- All work is ticketed. Before you start any work, find its item or add one, and mark it `[~]`. Never do work that has no item.',
  '- The user can move items by hand on the Claudeopticon pane board. You are told of each move with your next tool result or prompt. Follow it: stop work on an item moved to open or done. Never change the box of an item the user moved by hand yourself. If you think a move is wrong, call `mcp__claudeopticon__move_ticket`, which asks the user and writes the box only on a yes. If the item is in more than one file, it refuses and lists them: call it again with `folder` set to the item\'s folder path.',
].join('\n')

/** The name of the mod's context block. */
export const RULES_BLOCK = 'claudeopticon'

type Context = { blocks: readonly { name: string; text: string }[] }

/**
 * The context with the rules block added, once. Unchanged when `isOn` is false (the user's
 * `rules` option), or when a block of that name is there already. The real engine's contract for two
 * blocks of one name is not written down (the test engine keeps one per name, so an engine test cannot
 * see this guard): the mod adds its block at most once itself, whatever the engine does.
 */
export function withRules<C extends Context>(context: C, isOn: boolean): C {
  return !isOn || context.blocks.some(block => block.name === RULES_BLOCK) ? context : { ...context, blocks: [...context.blocks, { name: RULES_BLOCK, text: RULES }] }
}
