# Changelog

## 0.4.2

- After Delete duplicate todos, the Consolidate todos button no longer comes back for folders that are gone.
- The board header lists the repo root's files first, and a file's place sits apart from its name.

## 0.4.1

- The ticket view draws one board for all todo files, under one header card with a row per file (name, bar, own count). Same-named files in different folders stay two files; their rows show the folder.

## 0.4.0

- The board shows the tickets of every `.claude_todo/` folder in the repo together, as one todo. Each change still goes back to the file the ticket came from. The folders are found once, when the pane starts.
- The Todo heading says how many files the board pulls from.
- **Consolidate todos** copies the other folders' todo files, whole, into the repo's own root `.claude_todo/`. **Delete duplicate todos** then removes the old files, but only those whose every line is in the copy.
- `move_ticket` takes an optional `folder`, and refuses when an ID matches tickets in more than one file.
- A project's own `.claude/.claude_todo` folder now shows; only the home folder's global one stays hidden.
- The README notes how far to trust the agent progress bars.

## 0.3.6

- The pane reads the nearest `.claude_todo/`, from the folder the session started in up to the repo root, so a subfolder can keep its own todo.

## 0.3.5

- An agent that finished its work but was never stopped now shows as Idle, with the time it finished. It no longer counts as live, its timeline bar stops at that time, and its last command reads "Last:". The Stop button stays so you can close it.

## 0.3.4

- The README and the plugin description lead with the ticket system.

## 0.3.3

- A pane opened before 0.3.2 takes the Claudeopticon title after `/reload-plugins`, without a restart.

## 0.3.2

- The pane's title is now Claudeopticon instead of Work.

## 0.3.1

- A background task that a helper agent started now ends when that agent ends. Before, its line could stay on running for good.

## 0.3.0

First public release.

- Work pane: top card, Orchestrator, Background tasks, Agents with a timeline, and the todo.
- Agent cards count tool calls and tokens. A Stop button ends a running agent at once.
- Ticket board (In progress, Open, Done) with group and agent tags.
- Ticket buttons: send to Claude, ask for status, move by hand.
- `move_ticket` tool: Claude asks you before it moves a ticket you moved.
- `report_progress` tool: agents report steps, shown as progress bars.
- Agent to ticket links by `#T` ID, progress claims, a Haiku match, and quoted text.
- Haiku groups, search, and a completed ledger with the archive.
- Todo rules for Claude, with the `rules` option to turn them off.
- Light and dark themes.
