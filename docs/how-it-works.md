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

The mod shows the tickets of every `.claude_todo/` folder in the repo together, as if they were one todo. It finds the folders once, when it starts, with `git ls-files` (tracked, untracked and ignored folders; at most 20). From a git worktree it adds the main checkout's folders. Outside a repo, or if git fails, only the nearest folder counts. It never reads the global one in the home `.claude` folder. Each scan also looks for the nearest folder without git, so a folder made later in the session's folder or above it shows at once. Files of the same name in different folders stay two files. The ticket view draws one board for all files, with the tickets of every file in each column (files in their order break ties), and one header card with a row per file. A row shows its folder only when another row has the same name. The list view draws a card set per file. Each ticket keeps its source folder and file, so a change goes back to that file and a prompt to Claude names its real path. The files in the known folders are rescanned every 3 s and at each resync. Three buttons tidy the files. Consolidate todos moves every non-blank line of the other top-level todo files (other folders, and the central folder's extra files) into one target file in the central folder (`<root of the main checkout>/.claude_todo/`): `TODO.md` if it exists (any letter case), else the only top-level todo file, else a new `TODO.md`. Each file is a block under a `## From <place>/<file>` heading, and a clashing item ID gets the next one that no file uses, with references in the same file following. Archive files of other folders go to the same-named central archive file. The target is read again to confirm the block, and a source is then emptied only if its text is still what was copied. An empty top-level file keeps a header row that says Empty. Delete empty todos moves `.md` files with no text to the system trash (read again just before; `/usr/bin/trash`, then Finder through `osascript`, on macOS; `gio trash`, `trash-put`, then `kioclient5` on Linux; PowerShell `SendToRecycleBin` on Windows). A move counts only when the command succeeds and the file is gone, and it never falls back to an outright delete. Then it tries a non-recursive `rmdir` on the emptied `archive/` and folder. It never takes the target or `categories.json`. Windows paths (`C:/...`) pass the same trust rules. Delete duplicate tickets keeps the first of each group of top-level tickets with no indented lines under them that are identical apart from their own leading ID, removes the rest from the target, and rewrites references in the target and the central archive files. In the archive files a ticket's own leading ID never changes. Consolidate reads, writes and empties no file behind a symlink. The paths must be absolute, free of symlinks, inside the main checkout and not the global folder. All three are off in a linked worktree and when the main folder would be the global one. A line's `#T<n>` ID is the item's key. Without an ID, the key is the item's text. Outside the folder nearest to the session folder the key also carries the folder, so equal IDs in two folders stay two items. `categories.json` lives in the nearest folder only.

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
