/** The todo rules the mod gives Claude as a context block. */

/**
 * The rules the mod gives Claude, as a context block of its own beside CLAUDE.md, so the mod needs no
 * edit to anyone's CLAUDE.md. The `rules` option turns it off for those who write their own.
 */
export const RULES = [
  'The Claudeopticon mod runs here; its pane shows the project todo and its agents. Todo rules:',
  '',
  "- Items go in `.claude_todo/` at the root of the repo's main checkout (a worktree uses the main checkout's). Create it when missing. Each repo keeps only its own items. Other `.claude_todo/` folders in the repo show on the board: keep each item in its folder.",
  "- Never make or use the global todo folder, `~/.claude/.claude_todo/` (or `.claude_todo/` in `$CLAUDE_CONFIG_DIR`). When the repo root is that folder's parent, use the nearest project folder instead: the `.claude_todo/` of the project you work in, below that root (make it when missing).",
  '- One item is one checkbox line in a `.md` or `.html` file at the top level of `.claude_todo/`: `- [ ]` open, `- [>]` queued, `- [~]` in progress, `- [x]` done. Use one space after the dash and one inside an open box. Write only these forms (the board also reads `*`, `+` and `[X]`). A numbered line (`1. [ ] a`) or two spaces after the dash is not an item. Only checkbox lines count. In a `.html` file, `<li><input type="checkbox"> text</li>` lines are items too: `checked` is done, `data-state="queued"` or `data-state="in-progress"` the others. Update the box the moment the status changes.',
  "- Each item has a unique ID: `#T` and 4 digits and capital letters, the first a digit (`#T002B`); the mod gives 5 (`#T10000`, `#T12346`) when a 5-character ID is in use or the 4-character ones run out. Use the next free IDs the mod gives with each prompt. Old short IDs (`#T12`) stay valid. An item with no ID gets one from the mod. When you dispatch an agent for an item, put the ID in the Agent call's description and mark the item `[~]`.",
  '- When the work of an item is done, check it off (`- [x]`) in the same turn, before your final reply. Never leave finished work open or in progress. When an agent you started for an item finishes, check its result and close the item if the work is done. Never delete a done item or fold done items into a summary line.',
  '- The mod moves each done ticket whose subtasks are all done, with its indented lines, to `.claude_todo/archive/<same file>`; a done ticket with an open subtask stays until that subtask is done. Never move it back or treat it as lost.',
  '- When you work on tickets yourself (not through an agent), call `mcp__claudeopticon__report_progress` with `title` and `items`; call it again when the assignment changes. Send your session name once, in your first call, as `session`: the name ListAgents shows after "This session is", without the bracketed ref.',
  '- To queue a ticket (`- [>]`) for another session, or only to order or triage the work, release it: call `mcp__claudeopticon__report_progress` with `release` set to the ticket IDs. The mod claims a ticket you queue yourself as your planned work.',
  '- A ticket another session claims (the board shows "Peer owned") is theirs: ask that session with SendMessage before you take it. If its owner has no name, call ListAgents and ask each other session, naming the ticket and this repo\'s root path. When another session asks you for a ticket you claim and you agree, release it with `release`.',
  '- In progress (`- [~]`) is work running now and work that starts next. Queued (`- [>]`) is close but not imminent: work you plan to take within about the next 3 to 5 tickets, or second priority (the Queued column is between In progress and Open). Open (`- [ ]`) is the backlog, with no time to start. When you decide a ticket comes next, mark it `[~]`. When it comes within the next few tickets, after the next checkpoint, gate, closeout or merge, or waits for an event, mark it `[>]` at once. A ticket you add for work the user asked you to plan is `[~]` if you start it now or next, `[>]` if you plan it soon after, and `[ ]` only for backlog with no plan. Set a ticket you have not finished and still plan to do to `[>]`, not `[ ]` (the mod does this when you set `[~]` back to `[ ]`). When you start a queued ticket, mark it `[~]`.',
  '- Before any work, find its item or add one, and mark it `[~]`. Never do work that has no item.',
  '- An issue you find while you work is a ticket at once, written `- [~]` (never `[ ]` or `[>]`). Fix it in the same turn, then check it off. Never ticket it and move on. It stays open only with `(blocked: <what>)` (it needs another item or a fact you do not have) or `(arch: <why>)` (it changes a public interface, a stored data format, or a contract between modules) in its line; then tell the user in one line.',
  "- The user can move items on the board; you are told with your next tool result or prompt. Stop work on an item moved to open or done. Never change the box of an item the user moved. If you think a move is wrong, call `mcp__claudeopticon__move_ticket`: it asks the user and writes the box only on a yes. If the item is in more than one file, it refuses and lists them: call it again with `folder` set to the item's folder path.",
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
