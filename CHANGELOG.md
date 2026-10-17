# Changelog

## 0.7.1

- The top card is now a live graph of the last 30 minutes: live agents in blue on the left axis, and tokens since the last compaction in orange on the right axis. The totals sit in small text at the top left. The axes rescale rarely, and a reload keeps the history. The Todo ring is gone; todo progress stays in the Todo header.
- When a ticket leaves a column, its space stays until your next click or for a minute, so the pane does not shift while you read.

## 0.7.0

- Closed tickets move to the archive on their own. About 5 seconds after a ticket is checked off, the mod moves it to the file of the same name in `.claude_todo/archive/`, under the heading it had, and makes the archive file when it is missing. The live todo holds only open and in-progress tickets. Nothing is deleted.
- **Show completed (N)** opens the archive file in your default app. The in-pane list of completed tickets is gone; the Done column shows the tickets archived this session.
- New **Recategorize** button. It sorts all open tickets again and keeps the new groups only when they differ in a real way. Otherwise it says that the current categories are correct.
- New ticket IDs are `#T` plus 4 digits and capital letters, the first a digit (`#T002A`), counting in base 36. Old IDs such as `#T12` stay valid. The mod gives Claude the next three free IDs with each prompt.
- A ticket with no ID gets the next free one from the mod.
- Agent labels keep their numbers after `/reload-plugins`, also past 200 agents in a session. The label circle is slightly bigger, and long labels such as A1000 shrink to fit it. Chat names are read up to A999999.
- Finished tickets get closed. The rules now tell Claude to check off an item in the same turn its work is done. When an agent ends with its tickets still open, or a ticket Claude claimed stays in progress, the mod reminds Claude to close each one whose work is done. It never closes a ticket itself.
- The Orchestrator agent card's title is a headline Claude writes for the work it does itself, through a new optional `title` on `report_progress`. Until then, it is the text of its first ticket.
- Each line on the Orchestrator card has a second line with the detail from the action itself: the command, file path, pattern, web address or agent type. Commands that look like they hold a secret show "(hidden)".
- The rules for Claude follow these changes. Claude no longer moves whole files to the archive.

## 0.6.1

- When Claude works on a ticket itself, with no helper agent, the ticket shows an **O** tag that blinks while Claude works, and an Orchestrator card shows in the Agents card. A ticket counts as Claude's own when Claude moves it to in progress, names it in a progress report, or you send it with the Send button.

## 0.6.0

- The Background tasks card is gone. Claude Code now has its own task tracker, which does this job better. The Haiku request that named each task is gone with it.

## 0.5.3

- Delete empty todos moves empty todo files to the Trash (the Recycle Bin on Windows) instead of deleting them, so you can get them back. It never falls back to an outright delete: if no trash command works, it keeps the file and says why.
- Windows paths (`C:/...`) pass the same trust rules as macOS and Linux paths, so the todo buttons work on Windows. On Windows the Trash step runs only on a local fixed drive with its Recycle Bin on, and keeps the file elsewhere. A file name reaches PowerShell only as character codes, and every `.claude/.claude_todo` counts as the global folder.

## 0.5.2

- Consolidate gives a clashing ticket a new ID that no moved file uses, so one clash renames one ticket and no other.

## 0.5.1

- A todo file that Consolidate emptied stays in the header, marked Empty, until Delete empty todos removes it. Before, it left the board at once and looked deleted.

## 0.5.0

- Consolidate todos moves every ticket and note into one central `.claude_todo/TODO.md`, under a "From" section per file. It folds nothing and deletes nothing. Each old file is emptied only after its content is confirmed in the central file, and a file that changed meanwhile is left alone.
- The delete button is now two buttons. Delete empty todos removes empty todo files, then their folders if empty. Delete duplicate tickets removes letter-for-letter identical tickets, keeps the first, and points the removed IDs to the kept one. Each button shows only when it has work, and disappears once it is done.
- The duplicates record, the coverage checks and folding are gone.
- Delete duplicate tickets never removes a subtask or a ticket with subtasks, and never changes the own ID of an archived ticket. Consolidate never reads, writes or empties a file through a symlink.

## 0.4.6

- Consolidate merges every todo file into one central file, `.claude_todo/TODO.md` (or the main folder's only todo file), so the board ends with one file. Delete duplicate todos then also removes the main folder's own merged files, never the central file, its categories or its archive.
- Consolidate shows whenever the board pulls from more than one file, also within one folder.
- File names compare without case, so a lowercase `todo.md` is the central file on a case-insensitive disk.

## 0.4.5

- Consolidate folds an identical ticket into its twin in any file of the main todo, not only the file with the same name.
- Leftover scratch files are out of the repo.

## 0.4.4

- Consolidate folds tickets whose text is letter-for-letter identical into one ticket, and copies everything else. A folded ticket's ID points to the ticket it was folded into.
- A folder that was consolidated but later gains a line that is not in the main todo shows on the board again, and Consolidate picks it up.

## 0.4.3

- Delete duplicate todos no longer keeps a file that was copied again after an earlier consolidation: a new copy replaces the old renumbering record.
- Consolidate renumbers only the tickets whose IDs clash, not the ones after them.

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
