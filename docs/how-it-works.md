# How Claudeopticon works

Claudeopticon is one hooks module, `hooks/register.tsx`, plus the card drawings in `hooks/cards.ts`. It has no server and no database. Each Claude Code session runs its own copy, so a pane shows only its own project and agents.

## The hooks

| Hook | What the mod does |
| --- | --- |
| `session.start` | Registers `/claudeopticon` and the two tools, reads the todo, opens the pane. |
| `prompt.context` | Adds the todo rules as a context block, unless the `rules` option is off. |
| `ui.render` | Draws the pane: SVG cards on the desktop app and VS Code, text on a terminal. |
| `tool.call` | Counts each agent's tool calls, records Claude's call summaries and each call's detail (Bash command, file path relative to the repo, Grep or Glob pattern, URL, search query, agent type and model; nothing for MCP tools; at most 300 characters; a command that matches a secret pattern is stored as "(hidden)"), rereads the todo after an edit in `.claude_todo/`, and answers `report_progress` and `move_ticket`. |
| `agent.spawn` | Adds a line to each agent's prompt that asks for progress reports, and starts the agent's row. |
| `prompt.submit` | Attaches notes for Claude: agents you named by label, moves you made by hand, IDs the mod gave or changed, the next three free ticket IDs, and claimed tickets still in progress (each at most once every 30 minutes). |
| `turn.step`, `turn.complete`, `session.compact` | Add up tokens per agent and per session, and record the count at a compaction. |

A clock tick each second refreshes running agents. An agent missing from the agent list for 15 seconds ends with the status `ended`. Agent rows (the last 200) are saved per session, so a reload keeps start times, counts, links and progress. The mod also stores how many agents came before the first kept row (`agents-base:<session id>`), so labels and colors count from there and A201 stays A201 after a reload. A label's font size shrinks with its length so it fits its 28 px circle with room to spare (at most 17 px of text, measured for Instrument Sans, the widest of the fallback fonts). Chat names are read up to six digits.

An agent is idle when its turn ends (`turn.complete` with its ID) and no tool call or model request of its own follows. Claude Code keeps such an agent open until something stops it. The card shows it as Idle, out of the live count, its time and timeline bar stopped at the end of the turn, and its last command as "Last:". Its next call or request ends the idle time.

When an agent leaves the live state (completed, failed, killed or ended) and tickets linked to it are still open or in progress, the mod queues one note for Claude, once per agent, naming up to five of them and asking Claude to close each one whose work is done. It goes with the next tool result or prompt. The mod never changes a box for this.

**Stop** runs the `TaskStop` tool with the agent's ID. That aborts the agent's loop: no more turns, no summary.

The todo folder is scanned every 3 seconds, and fully reread once a minute.

## Reading the todo

The mod shows the tickets of every `.claude_todo/` folder in the repo together, as if they were one todo. It finds the folders once, when it starts, with `git ls-files` (tracked, untracked and ignored folders; at most 20). From a git worktree it adds the main checkout's folders. Outside a repo, or if git fails, only the nearest folder counts. It never reads the global one in the home `.claude` folder. Each scan also looks for the nearest folder without git, so a folder made later in the session's folder or above it shows at once. Files of the same name in different folders stay two files. The ticket view draws one board for all files, with the tickets of every file in each column (files in their order break ties), and one header card with a row per file. A row shows its folder only when another row has the same name. The list view draws a card set per file. Each ticket keeps its source folder and file, so a change goes back to that file and a prompt to Claude names its real path. The files in the known folders are rescanned every 3 s and at each resync. Three buttons tidy the files. Consolidate todos moves every non-blank line of the other top-level todo files (other folders, and the central folder's extra files) into one target file in the central folder (`<root of the main checkout>/.claude_todo/`): `TODO.md` if it exists (any letter case), else the only top-level todo file, else a new `TODO.md`. Each file is a block under a `## From <place>/<file>` heading, and a clashing item ID gets the next one that no file uses, with references in the same file following. Archive files of other folders go to the same-named central archive file. The target is read again to confirm the block, and a source is then emptied only if its text is still what was copied. An empty top-level file keeps a header row that says Empty. Delete empty todos moves `.md` files with no text to the system trash (read again just before; `/usr/bin/trash`, then Finder through `osascript`, on macOS; `gio trash`, `trash-put`, then `kioclient5` on Linux; PowerShell `SendToRecycleBin` on Windows). A move counts only when the command succeeds and the file is gone, and it never falls back to an outright delete. Then it tries a non-recursive `rmdir` on the emptied `archive/` and folder. It never takes the target or `categories.json`. Windows paths (`C:/...`) pass the same trust rules. Delete duplicate tickets keeps the first of each group of top-level tickets with no indented lines under them that are identical apart from their own leading ID, removes the rest from the target, and rewrites references in the target and the central archive files. In the archive files a ticket's own leading ID never changes. Consolidate reads, writes and empties no file behind a symlink. The paths must be absolute, free of symlinks, inside the main checkout and not the global folder. All three are off in a linked worktree and when the main folder would be the global one. A line's `#T<n>` ID is the item's key. Without an ID, the key is the item's text. Outside the folder nearest to the session folder the key also carries the folder, so equal IDs in two folders stay two items. `categories.json` lives in the nearest folder only.

## IDs, numbering and the archive

A ticket ID is `#T` followed by a digit and then digits or letters, read without regard to case and ending at a word boundary, so `#T12` and `#T002A` are IDs and `#TODO` is not. Other prefixes keep the older form, letters then digits. The part after `#T` is a base-36 number (`25` is 77, `0026` is 78), so old and new IDs share one number line. The next free ID is one more than the highest value in every live and archive file of every known folder, written as 4 characters with leading zeros, and a form that starts with a letter is skipped. After `#T9ZZZ` the IDs grow to 5 characters. Suffixes longer than 10 characters are not read as numbers.

Each scan first numbers, then archives, in each top-level todo file of a trusted folder (inside the main checkout, not the global one, no symlink). Numbering gives each checkbox line that has no ID the next free one, right after the box, once the line has been seen without an ID for 5 seconds. Archive files are never numbered. A line that already names an ID anywhere in its text, such as a reference, keeps that as its ID and is not numbered. If numbering wrote a file, the scan starts again before the archive step, so the archive step never works from old text.

The archive step moves each top-level `- [x]` line, with the indented lines under it, to `archive/<same name>`, once every box in that block has been checked for 5 seconds. A block with an open subtask stays. Each block goes under the heading it had, the nearest heading above it outside code fences: at the end of that heading's section in the archive, or under a new copy of the heading at the end. Headings, notes and prose stay in the live file. The order is the same as Consolidate's: write the archive, read it back to confirm the blocks, read the source again, and write it without the blocks only if it did not change. A retry skips a block whose lines are already in the archive in that order. Tickets archived this session are kept in the store per session (the last 200), and the Done column lists them, newest first. A file's header row counts its same-named archive file, and the Todo heading counts every archive file.

**Show completed (N)** opens the archive file of the central folder (else the primary folder) with the system's opener: `open` on macOS, `xdg-open` on Linux, `explorer.exe` on Windows, with no shell. It makes the file if it is missing, and N counts the closed tickets in every archive file. The desktop app draws a link only for `https://` addresses, so this is a button and not a link.

## Linking agents to tickets

Strongest first: the ID in the agent's description or prompt (a whole ID: `#T1` does not match `#T12`); a `report_progress` claim; a Haiku match of the task against open items (at most three); a quote of the item's text. Only running agents link.

The main conversation (the orchestrator) claims a ticket when, in this session, an Edit or Write of a todo file by the main conversation moves its box to `[~]`, when a main-conversation `report_progress` names it, or when the Send or status button sends it. A helper agent's edit or report never claims for it. A claim ends when the ticket is done or gone, or when its box goes back to `[ ]` after it was seen in progress. Claims are stored per session (`orchestrator:<session id>`), so a reload keeps them. Its card shows Running between `prompt.submit` and the main `turn.complete`, and its O tag blinks only then. Its title is the `title` the main conversation last sent with `report_progress` (helper agents' titles are ignored; at most 80 characters; stored per session as `orchestrator-title:<session id>`, cleared when it owns no tickets), else the first claimed ticket's text plus " and N more". A Bash edit of a todo file does not claim.

## Categories

Haiku sorts open items into at most five categories, kept in `.claude_todo/categories.json`. On start it sorts unsorted items, 60 per call and up to 300. After that it sorts new items at most every 30 seconds.

**Recategorize** sends every open ticket to the same sorting prompt, ignoring the current groups. Each new group is matched to the old group it shares the most tickets with. The new groups are written only when the number of groups differs, or when at least a quarter of the open tickets would land in a group that does not match their old one. Otherwise the old groups stay, and a note shows next to the button for 4 seconds: "The current categories are correct", or "Could not recategorize" on a failure. A press while a request runs is ignored.

## Ticket buttons

`⋙` and `?` send a prompt to Claude. The manual moves rewrite one checkbox. Each move is queued as a note that goes to Claude with its next tool result or your next message. To change a move, Claude calls `move_ticket`, which asks you and writes only on a yes.

## The top graph

The top card plots two series over the last 30 minutes: the live agent count, recorded each time it changes, and tokens since the last compaction, recorded at each usage report. A compaction adds a marker and a point at zero, and the token line breaks there. The series are stored per session (`series:<session id>`, at most 2000 points each), so a reload keeps them. Each axis grows only when a value would leave it, to the next step (agents 4, 6, 8, 12, 16, 24, 32 and so on; tokens 150k, 300k, 600k, 900k, 1.5M, 3M and so on, with 4 grid intervals), and shrinks only after every visible value has stayed below half for 5 minutes. Token reports redraw it at most every 5 s, and an idle redraw every 30 s scrolls the time axis. X positions snap to 30 s, so redraws in between send the same markup. Agents are yellow (`#FACC15`, `#CA8A04` in the light theme) and tokens lime (`#A3E635`, `#65A30D`). The axis numbers use the card's text color, and the key sits in the top row after the totals; on a narrow card it moves to its own row.

When a ticket leaves a column or a list, a transparent card of the same height takes its place, so the cards below keep their position. The spaces clear at the next press of any control in the pane, or after 60 s, and at most 10 are kept.

## Drawing

Each card is an SVG image. Its markup does not change with the clock alone, so a redraw with no new data does not reload the image. Motion is CSS and stops under `prefers-reduced-motion`. A light palette follows the system theme. Ticket columns stack when a ticket would be under 300 px wide.

## Limits of the mod API

- An SVG card takes no click, so buttons sit over its bottom row.
- Elements sit in text cells, so button positions are approximate.
- A pane cannot scroll, so the Orchestrator history uses paging buttons.
