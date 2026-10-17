![Claudeopticon: see everything Claude Code is doing, in one live pane](docs/images/social-preview.png)

# Claudeopticon

**A ticket system for Claude Code. Plan the work, hand it to Claude, and watch it get done.**

Claudeopticon is a mod for Claude Code. It adds a work pane next to your conversation which shows your todo list as a ticket board, what Claude is doing, and what its helpers (Claude Code calls them agents) are doing. You can send a ticket to Claude, ask how it is going, or move it yourself.

![The whole Claudeopticon pane: the top card, then Orchestrator, Agents and the Todo board, top to bottom](docs/images/pane.svg)

At its core is a ticket system that lives in your repo. Each line in `.claude_todo/` is a ticket with an ID such as `#T12`. From the board you can send a ticket to Claude, ask for a status update, or move it between Open, In progress and Done. Claude keeps each ticket's state up to date as it works, and every helper agent is linked to the tickets it works on.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [The pane](#the-pane)
- [The todo format](#the-todo-format)
- [Rules for Claude](#rules-for-claude)
- [Agents and progress](#agents-and-progress)
- [Options](#options)
- [Cost and privacy](#cost-and-privacy)
- [Limits](#limits)
- [Development](#development)
- [License](#license)

## Requirements

- Claude Code 2.1.275 or later.
- The desktop app or VS Code for the card view. A terminal shows the same data as text.

## Install

Run this line in Claude Code:

```
/plugin install claudeopticon --marketplace Marceux-Croix/Claudeopticon
```

The pane opens at the start of each session. To open it again, run `/claudeopticon`. In a session that is already running, run `/reload-plugins` first.

## Quick start

1. Make a folder `.claude_todo/` at the root of your repo, and a file in it, for example `.claude_todo/TODO.md`:

   ```markdown
   - [ ] #T1 Write the migration for the v2 config format
   - [ ] #T2 Document the plugin API
   ```

2. Open the pane. The items show as tickets in the Open column.
3. Click `⋙` on a ticket to send it to Claude. Claude marks it `[~]`, and the ticket moves to In progress.
4. When Claude starts an agent for a ticket, the agent's card links to it and shows its progress.

## The pane

### Top card

![The top card: todo done, live agents, and session tokens](docs/images/top.svg)

- **Todo:** how much of your todo is done.
- **Agents:** how many agents run, and how far along they are together.
- **Tokens:** how much text Claude has processed this session (a token is the unit of Claude's usage). The line below counts since the last compaction, when Claude Code shrinks a long conversation to free up room.

### Orchestrator: what Claude is doing

![The Orchestrator card](docs/images/orchestrator.svg)

This card lists what Claude does itself, not its agents. Each line is the short description Claude already writes for an action, with its start time. The newest is on top. A pulsing dot means the action still runs. **Older** and **Newer** page through the history.

### Agents: what Claude's helpers are doing

![The agents timeline and two agent cards](docs/images/agents.svg)

Each agent gets a card, labeled A1, A2, and so on, in start order. Each agent has its own color. A card shows what the agent was asked to do, its tickets, its progress ("Step 3 of 7" with a bar), its run time, tool calls and tokens, and what it does now. A timeline above the cards shows one bar per agent.

A running agent has a **Stop** button (⊖) left of its status. Stop ends the agent at once. It gets no chance to finish its step or write a summary. Use it when an agent has gone wrong.

An agent that finished its work but was never stopped shows **Idle**, with the time it finished and its last command marked "Last:". It does not count as live, and it keeps its Stop button so you can close it.

If an agent vanishes from Claude Code's agent list without a report of how it ended, its card shows **Ended** after 15 seconds.

Finished agents are hidden. **Show finished agents** brings them back, grayed out. You can name an agent by its label in chat ("how is A2 doing?"). The mod tells Claude which agent that is.

### Todo: the ticket board

![The ticket board](docs/images/board.svg)

The pane draws one board for all your todo files, with the columns **In progress**, **Open** and **Done**. Above it, one header card has a row for each file: its name, its progress bar, and its own "done of total" count. If two files have the same name, the row also shows the folder in dim text. A ticket shows its number, its group, its status, and the tags of the agents working on it. The tags blink in the agent's color. When an agent starts on a ticket, the ticket moves to In progress by itself.

Tickets that are not done have buttons on the bottom edge:

| Button | On | What it does |
| --- | --- | --- |
| `⋙` Send to Claude | Open tickets | Sends the item to Claude as a prompt, to build it. |
| `?` Ask Claude for a status update | Tickets in progress, or already sent | Asks Claude for a short report in the chat. It starts no new work. |
| `◐` Mark in progress | Open tickets | Moves the ticket by hand. |
| `✓` Mark done | Tickets in progress | Moves the ticket by hand. |
| `↩` Move back to open | Tickets in progress | Moves the ticket by hand. |

The move buttons are for work you do yourself, such as a human review. They change the checkbox in your todo file and nothing else. Claude is told at its next action, so it does not work on a ticket you closed. It is not asked to do anything.

The Todo heading says how many todo files the board pulls from ("Pulling todo from 3 files"; archives are not counted). Up to three buttons sit next to it. Each shows only when it has work to do, and disappears once it is done. You can use one, two or all three, in any order.

- **Consolidate todos** (more than one todo file): moves every ticket into one central file, `TODO.md` in the repo's root `.claude_todo/`. If that folder has no `TODO.md` but exactly one other todo file, that file is the central file. Notes move too, under a `## From <folder>/<file>` heading per file. Nothing is folded and nothing is deleted. A ticket whose `#T` ID the central file already uses gets the next ID that no file uses, references to it follow, and Claude is told the new IDs once. Archive files move into the same-named file in the central `archive/`. Each old file is emptied only after its content is confirmed in the central file. If a file changed in the meantime, it is left alone, and the pane names it. The emptied files stay on disk and in the header, marked Empty, until you delete them.
- **Delete empty todos** (an empty todo file exists): moves empty todo files to the Trash (the Recycle Bin on Windows), so you can get them back. Then it removes their `archive/` and `.claude_todo/` folders if those are empty too. It never deletes a file outright: if it cannot use the Trash, it keeps the file and says why. It never removes the central file, a file with content, or `categories.json`.
- **Delete duplicate tickets** (the central file holds identical tickets): removes tickets that are letter-for-letter identical, apart from their own ID, and keeps the first. A subtask, or a ticket with subtasks under it, is never removed. A removed ticket's ID is rewritten to the kept one wherever it is mentioned, and Claude is told once.

Each button reads a file again right before it writes it, and skips a file that changed. The buttons are off in a git worktree and when the repo root is `~/.claude`.

Other controls:

- **Show as list** shows each file as a list. **Arrange by category** groups the list.
- The **group buttons** show or hide each group. Haiku makes the groups: it reads your open tickets, names up to five groups, and puts each ticket in one. A ticket keeps its group, and new tickets are sorted as they appear.
- **Show completed** adds finished tickets and archived todo files.
- The **search box** finds tickets with every word you type.

## The todo format

The mod reads checkbox lines in the Markdown files at the top level of `.claude_todo/`, and in `.claude_todo/archive/`.

```markdown
- [ ] #T4 Open item
- [~] #T5 Item in progress
- [x] #T6 Done item
```

- Give each item a short ID, `#T<n>`, unique in the project.
- Prose, tables and headings may surround the items. Only checkbox lines count.
- When an item is done, check it off and leave it in the file. Checked items are your record of finished work.
- When every item in a file is done, move the file to `.claude_todo/archive/`.
- The pane shows the tickets of every `.claude_todo/` folder in the repo together, as if they were one todo. It finds the folders with git (tracked, untracked and ignored ones; at most 20) and adds the main checkout's folders from a git worktree. It never reads the global `~/.claude/.claude_todo`.
- Files of the same name in different folders are two files, each with its own header row. Each change goes back to the file the ticket came from. Two folders may use the same `#T` ID: they stay two tickets.
- `categories.json` lives in the folder nearest to the session folder. With no such folder, items are not sorted into categories.

## Rules for Claude

At the start of each conversation, the mod gives Claude short instructions. Claude:

- keeps `.claude_todo/` in the format above and updates each box as status changes;
- puts the item's ID in the description of each agent it starts for that item;
- finds or adds an item before it starts any work;
- stops work on an item you moved to open or done;
- never changes the box of an item you moved. If it thinks your move was wrong, it calls the `move_ticket` tool. You get a dialog, and the box changes only if you say yes.

## Agents and progress

The mod asks each agent to report progress after each step, with a small tool it adds, `report_progress`. Most agents can use it with no setup. The exception is a custom agent whose definition file lists its tools in a `tools:` line. Add this name to that list to get its progress bar:

```
mcp__claudeopticon__report_progress
```

Without it, the agent shows no bar but still links to its tickets.

An agent links to a ticket when its description or prompt names the ticket's `#T` ID, when it names the ticket in a progress report, when its prompt quotes the ticket's text, or when Haiku, reading the agent's task once at its start, picks the ticket.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `rules` | On | Gives Claude the instructions for keeping the todo. Turn it off if you wrote your own in `CLAUDE.md`. |

Set options in the `/config` menu, under the plugin.

## Cost and privacy

The mod uses Haiku for two small jobs:

- **Sorting tickets into groups:** once per new ticket, up to 60 per request. Sorting a large todo the first time costs a few thousand tokens.
- **Matching a new agent to its tickets:** one request per agent.

Everything else is free or nearly free: the Orchestrator card makes no requests, the instructions to Claude are about 400 tokens per conversation, a progress report is about 40 tokens, and card token counts come from usage Claude Code already reports.

All requests go through your own Claude Code session. The mod sends nothing anywhere else. On disk, it reads `.claude_todo/` and writes the checkbox of a ticket you move, the checkbox of a ticket you allow Claude to move, and `.claude_todo/categories.json`, which remembers each ticket's group. The three todo buttons change todo files only when you click them: Consolidate writes and empties them, Delete duplicate tickets edits the central file, and Delete empty todos moves empty files to the Trash.

## Limits

- The token count starts the first time the mod sees a session.
- The Orchestrator history is kept in memory, so a reload clears it.
- Agent data is saved per session, so `/reload-plugins` keeps it. An agent that started while the mod was off shows its model after its next request, and its run time counts from the load.
- An agent's progress bar comes from the agent's own reports, not from a measurement. It works well for work with clear steps, such as editing a set of files or running tests. For open-ended work, such as research, debugging or review, the agent cannot know its steps in advance, so the total may grow as it goes (step 3 of 5 can become step 4 of 9), or the reports may stop. Some agents skip the reports, and a custom agent without `report_progress` in its tool list shows no bar at all.
- Ticket buttons sit over the card, so their position is approximate.
- The pane finds the `.claude_todo/` folders once, when it starts. A new `.claude_todo/` in the session's folder or a folder above it shows at once. One made elsewhere needs `/reload-plugins` (or a new session).
- **Consolidate todos**, **Delete empty todos** and **Delete duplicate tickets** are off in a repo whose root folder is the home `.claude` folder (`~/.claude`), because there the repo's root `.claude_todo/` is Claude Code's global todo folder, which the mod never writes to. They are also off in a git worktree. In every other repo the central todo is the repo's own root `.claude_todo/`.
- Delete empty todos uses the system's own trash command: `trash` or Finder on macOS, `gio trash`, `trash-put` or `kioclient5` on Linux, and PowerShell on Windows. A Linux system with none of these keeps the files. On Windows it works only on a local fixed drive whose Recycle Bin is on, because elsewhere Windows deletes the file outright; on any other drive it keeps the file. Only the macOS command has been run on a real system. The Linux and Windows commands are covered by the mod's own tests only.
- The files in the known folders stay live: new items, edits, checkbox changes, new files and archived files show within a few seconds, with no restart.

[How it works](docs/how-it-works.md) explains the hooks, the linking and the drawing.

## Development

Load the repo from its folder, run the checks, and see [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

The cards follow the [Stage UI](https://github.com/Marceux-Croix/Stage-UI) design system.

## License

[MIT](LICENSE)
