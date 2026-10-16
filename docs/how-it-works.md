# How Claudeopticon works

Claudeopticon is one hooks module, `hooks/register.tsx`, plus the card drawings in `hooks/cards.ts`. It has no server and no database. Each Claude Code session runs its own copy, so a pane shows only its own project and agents.

## The hooks

| Hook | What the mod does |
| --- | --- |
| `session.start` | Registers `/claudeopticon` and the two tools, reads the todo, opens the pane. |
| `prompt.context` | Adds the todo rules as a context block, unless the `rules` option is off. |
| `ui.render` | Draws the pane: SVG cards on the desktop app and VS Code, text on a terminal. |
| `tool.call` | Counts each agent's tool calls, records Claude's call summaries, starts and ends background task cards, rereads the todo after an edit in `.claude_todo/`, and answers `report_progress` and `move_ticket`. |
| `agent.spawn` | Adds a line to each agent's prompt that asks for progress reports, and starts the agent's row. |
| `prompt.submit` | Attaches notes for Claude: agents you named by label, and moves you made by hand. |
| `turn.step`, `turn.complete`, `session.compact` | Add up tokens per agent and per session, and record the count at a compaction. |

A clock tick each second refreshes running agents. An agent missing from the agent list for 15 seconds ends with the status `ended`. Agent rows (the last 200) are saved per session, so a reload keeps start times, counts, links and progress.

An agent is idle when its turn ends (`turn.complete` with its ID) and no tool call or model request of its own follows, while it waits on no background task it started. Claude Code keeps such an agent open until something stops it. The card shows it as Idle, out of the live count, its time and timeline bar stopped at the end of the turn, and its last command as "Last:". Its next call or request ends the idle time.

**Stop** runs the `TaskStop` tool with the agent's ID. That aborts the agent's loop: no more turns, no summary.

The todo folder is scanned every 3 seconds, and fully reread once a minute.

## Reading the todo

The mod shows the tickets of every `.claude_todo/` folder in the repo together, as if they were one todo. It finds the folders once, when it starts, with `git ls-files` (tracked, untracked and ignored folders; at most 20). From a git worktree it adds the main checkout's folders. Outside a repo, or if git fails, only the nearest folder counts. It never reads the global one in the home `.claude` folder. Each scan also looks for the nearest folder without git, so a folder made later in the session's folder or above it shows at once. Files of the same name in different folders are one board. Each ticket keeps its source folder and file, so a change goes back to that file and a prompt to Claude names its real path. The files in the known folders are rescanned every 3 s and at each resync. Consolidate todos copies every non-blank line of the other folders' files into the central folder (`<root of the main checkout>/.claude_todo/`), one write per target file, under a `## From <place>` heading (a source whose heading is already there is skipped). A colliding item ID gets the next free one, and references to it in the same file follow. The mod then runs the folder search once more and records the source folders as duplicates in the store by repo root. Delete duplicate todos checks a duplicate file line by line against the central file (an item line by box and text, any other line verbatim, each central line covering one source line), reads the file again right before its removal, and removes it with `rm -- <path>` only in a trusted folder (absolute, ending in `.claude_todo`, no symlink, inside the main checkout, not the central or the global one). Then it tries `rmdir` on `archive/` and the folder. Both are off in a linked worktree and when the main folder would be the global one. A line's `#T<n>` ID is the item's key. Without an ID, the key is the item's text. Outside the folder nearest to the session folder the key also carries the folder, so equal IDs in two folders stay two items. `categories.json` lives in the nearest folder only.

## Linking agents to tickets

Strongest first: the ID in the agent's description or prompt (a whole ID: `#T1` does not match `#T12`); a `report_progress` claim; a Haiku match of the task against open items (at most three); a quote of the item's text. Only running agents link.

## Background tasks

A card starts when the launching call returns a task ID (`backgroundTaskId` from a background Bash call, `taskId` from `Monitor` and `Workflow`). It ends when the task's notification reports `completed`, `failed` or `killed`, or when `TaskStop` names it. A task a helper agent starts reports its end to that agent, not to the main conversation, so its card ends when that agent ends (or after 15 s with no such agent). Haiku shortens the description to a name once; until it answers, the cut description stands in.

## Categories

Haiku sorts open items into at most five categories, kept in `.claude_todo/categories.json`. On start it sorts unsorted items, 60 per call and up to 300. After that it sorts new items at most every 30 seconds.

## Ticket buttons

`⋙` and `?` send a prompt to Claude. The manual moves rewrite one checkbox. Each move is queued as a note that goes to Claude with its next tool result or your next message. To change a move, Claude calls `move_ticket`, which asks you and writes only on a yes.

## Drawing

Each card is an SVG image. Its markup does not change with the clock alone, so a redraw with no new data does not reload the image. Motion is CSS and stops under `prefers-reduced-motion`. A light palette follows the system theme. Ticket columns stack when a ticket would be under 300 px wide.

## Limits of the mod API

- An SVG card takes no click, so buttons sit over its bottom row.
- Elements sit in text cells, so button positions are approximate.
- A pane cannot scroll, so the Orchestrator history uses paging buttons.
