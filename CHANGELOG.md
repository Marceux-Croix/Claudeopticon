# Changelog

## 0.9.7

### Fixes

- The board no longer moves while you read when agents come and go. The agent area keeps the height of three agent cards, with an empty gray card for each slot no agent fills and the timeline drawn empty before the first agent, and keeps the tallest height it reached. The Orchestrator history card is always as tall as a page of five entries. Before, each agent card or history line that came or went moved the board by its height. Past three agent cards the board still moves: see Limits in the README.

## 0.9.6

### Features

- **Rank by recency** on the board puts the newest ticket first in each column, by ticket ID: a higher ID is a newer ticket, and a 5-character ID is newer than every 4-character one. A ticket with no ID yet comes last. **Rank by group** goes back to the default order: tickets an agent works on, then by category, then in file order.

## 0.9.5

### Fixes

- The tokens per minute have their own scale, fitted to the highest rate in view, on the same gridlines as the token scale. Before, the rate scale was the token scale divided by 10, so when the count since compact grew to hundreds of millions, the rate line was flat along the bottom.
- Two clipped segments close together no longer draw their peak labels on top of each other: the later label is left out, and its zigzag stays.

## 0.9.4

### Features

- The token axis is scaled to the count since the last compaction in view, and to the tokens per minute. A count from before the compaction that is too tall is cut off at the top, with a zigzag break mark and its peak. Before, a large count before a compaction made the lines after it flat along the bottom for 30 minutes.

### Fixes

- The token axis shrinks as soon as the high count from before a compaction leaves the graph. Before, it waited 5 more minutes, and the lines stayed flat along the bottom.
- The README images are rendered again from the code, with the 0.9.2 axis label widths.

## 0.9.3

### Fixes

- The Orchestrator card shows only while Claude works a ticket itself in a turn. Before, it stayed between turns with its tickets still "Working on" and lit.
- A ticket Claude hands to a helper agent belongs to that agent while it runs: it leaves the Orchestrator card, and the board shows only the agent's disk on it.
- A ticket that fits no category is tagged "Uncategorized". Before, Haiku had to put it in the closest category, even a wrong one. The group of tickets not sorted yet is also named "Uncategorized" now, not "Not sorted yet".

## 0.9.2

### Fixes

- The "Tokens" axis title no longer overlaps the blue tokens-per-minute numbers. The axis numbers are measured by glyph, so "600M" gets its true width.
- Board tickets grow with the pane, not only shrink. Before, they stopped at 960 px of pane width while their columns kept growing.
- Ticket buttons sit on their card. Before, on a wide pane they were at the right edge of the column, away from the card.
- On a pane too narrow for three columns, In progress and Queued are side by side and Open is under them at the full width. Before, Open was pushed off the right edge. On a very narrow pane all three stack, as before.

## 0.9.1

### Fixes

- Agent colors are used again. An agent takes the first free color when it starts, and the color is free again when the agent finishes or goes idle. Before, only the first six agents of a session had a color, and every later agent was gray.
- 16 agent colors, not 6, ordered so the most distinct are used first. With all 16 held, a new agent shares a color.
- Every ticket has the `?` status button, in every column. Before, open and queued tickets had it only after a send.
- The back button's glyph is `↪`, not `↩`. It still moves a ticket back one column: in progress to queued, queued to open.

## 0.9.0

### Features

- The board has a **Queued** column between In progress and Open, for the work slated next. A queued ticket is `- [>]`. `[>]` no longer reads as in progress.
- A new button, `≡` Move to queued, is on open tickets. `↩` moves a ticket back one column: in progress to queued, queued to open. Queued tickets have `↩`, `◐` Mark in progress and `⋙` Send to Claude. `✓` Mark done is on open and queued tickets too, so a ticket closes without a stop in In progress. `move_ticket` takes `queued`.
- The rules tell Claude to mark a ticket queued when it decides the ticket comes next or waits for an event, and when it stops a ticket it still plans to do.
- When the main conversation sets a ticket from `[~]` back to `[ ]`, the mod writes `[>]` instead and tells Claude. Setting a queued ticket to `[ ]` keeps it open.
- When Claude's reply puts an open ticket off until later by its ID ("after X lands, #T0042"), the mod asks Claude once to mark it queued. It never moves a ticket on a reply.
- Category groups and the list view sort queued after in progress and before open. Search finds queued tickets.

## 0.8.1

### Features

- Tokens per minute has its own scale: a blue column of numbers next to the green token scale on the right. The blue scale is always the green one divided by 10, so a high total since compact no longer flattens the rate line, and the two lines stay comparable.
- Each axis's numbers are in its line's color: yellow, green and blue. The left margin mirrors the right one, so the plot is wider, and the key has more room above the plot.

### Fixes

- The pane image in the README shows its section headings in the light theme. The cards' light-theme colors no longer turn them dark on the dark background.

## 0.8.0

### Features

- The top card has three lines: live agents (yellow), all tokens since compact (lime green), and tokens per minute (blue, on the token axis). Each vertical axis has a title, the token axis shows "0" at the bottom and counts in k, M and B, and the totals line says "total session tokens".
- Each line ends in a dot with its value as a label with a halo. The label sits clear of the lines where the plot has a clear place, keeps the vertical order of the dots where it can, and gets a leader line when it sits far from its dot. A leader runs under the Compacted text and never through another label. Lines that end at equal values share one split dot.
- The board has no Done column. A ticket that is done goes to the archive and leaves the board. The search box finds open and in-progress tickets. **Show completed** opens the archive.
- Every model request is counted once, at the step that used it, for the main conversation and for each agent. A whole run is never counted at its end, so tokens land on the right side of a compaction.
- The rules for Claude say more: never use the global todo folder, which checkbox forms to write, 5-character IDs, that a done ticket with an open subtask stays until the subtask is done, and the `folder` argument of `move_ticket`.

### Fixes

- Placing end labels takes tens of milliseconds in every state. It took up to 5 seconds when no clear place existed.
- A clock that reads far ahead once no longer trims the graph. Later points are re-timed to the clock, and a clock set back never stops redraws or session notes.
- A kept graph and its compaction marks survive a reload. A count that is not a number draws as the base step, and a first request on a fresh graph counts as usage.
- Blank lines, block quotes and HTML blocks in a todo file follow CommonMark, so checkbox lines in examples are never read as tickets.
- An agent spawned again under an ID that has a row keeps its row. The Stop button works by agent ID.
- A turn that was running when the mod loaded counts its earlier steps at its end, so an upgrade or a reload in the middle of a turn loses no tokens.
- A todo file that keeps failing to read no longer blocks new IDs. A failed read is never taken for an empty file or an absent key.

### Safety

- IDs are claimed in blocks of 8 values in a claim folder, `claudeopticon/id-claims` in the git common directory, so two sessions in one repo never keep the same block. When that folder cannot be made, the fallback is `.claude_work/claudeopticon-id-claims` in the repo root. A block left half used is a gap in the numbers, never a duplicate. A claim is stale after 4 hours, and stale entries are pruned once an hour.
- Every todo read goes through one read function, and every todo write goes through one function that reads the file again and writes only if it did not change. Two gates check this on the source.
- An outside call or a write job that takes more than 20 seconds, and a store call that takes more than 5 seconds, counts as failed and is told once.
- Many more secret forms are hidden: long and short options, assignments, PowerShell forms, here-strings, and values in an agent's description, brief and title, and in older stored rows. A hidden line keeps its ticket IDs, but not an ID that is the secret itself. Control and format characters (C1, bidi overrides, tag characters) in names and texts quoted to Claude are escaped.
- The mod trusts only absolute folders inside the main checkout with no symlink, and never reads or writes the global todo folder, also when it is reached through a symlink or a case-spelled name.

### Internals

- `hooks/register.tsx` holds every function that uses `$`. Pure logic is in one-responsibility modules in `hooks/`, with a test file for each in `tests/<module>.test.tsx`. Engine tests are in `tests/register*.test.tsx`. The module table in `docs/how-it-works.md` lists every module.
- Four gates, run by hand (there is no CI): `claude plugin test .`, `claude plugin validate .`, and `node --import ./scripts/ts-resolve.mjs scripts/check-reads.ts` and `scripts/check-writes.ts`.
- The scripts run on plain Node 22.18 or later with `scripts/ts-resolve.mjs`: no `npx`, no downloads.
- The images in `docs/images/` are rendered again from the current cards.

## 0.7.2

- The top graph is restyled: live agents in yellow, tokens since compact in lime green, axis numbers in plain text color, and the key moved into the top row next to the totals.

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
