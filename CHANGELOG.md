# Changelog

## 0.9.21

### Fixes

- The gap between board columns now matches the gap between stacked tickets, about 15 px each. The 0.9.20 spacer cards between stacked tickets are gone: the desktop draws about 15 px between two stacked cards by itself, and no spacer, margin or explicit `gap={0}` made that smaller. Instead each ticket is drawn 5 px narrower than its column when columns stand side by side, which widens the column gap from about 10 px to about 15 px. Stacked columns keep the full width, and the gap under each column heading is unchanged (#T0094, #T0095, #T0096).
- The board's columns span the full width of the cards above them. Before, each column was 32 % of the width (49 % in a row of two), so the row stopped about 4 % short of the right edge. The columns now grow to fill their row, and each ticket is drawn from the filled width less the gaps (`columnPx` in `view-model.ts`) (#T0097).

## 0.9.20

### Fixes

- A wider pane widens every card. Before, the graph, the agent and timeline cards and the file header stopped at 960 px, while the ticket columns and the buttons kept growing, so a wide pane left the cards short of its right edge (#T0092).
- Tickets stacked in a board column are spaced as the columns are, one cell apart. Before, they were one text row apart, about three times the gap between columns. The gap under each column heading is unchanged (#T0093).

## 0.9.19

### Changes

- The rules tell Claude to write a new ticket as queued (`- [>]`) when it plans to work on it now, next, or after the next checkpoint, gate, closeout or merge, and as open (`- [ ]`) only for backlog with no plan. Before, such tickets were written open and were lost in the Open column (#T0091).

## 0.9.18

### Fixes

- A peer that refreshes its record every 5 seconds no longer shows dimmed after 2 minutes. The board kept the time it first saw each peer and never moved it on while the claims stayed the same, so every peer read as inactive 2 minutes later. It now keeps the latest record at every read.
- Two sessions on one repo place a peer's ticket alike. A ticket a peer works on (itself or through a live agent) shows in In progress on every board, also when its box is open or queued, as it does on the peer's own board. Before, a peer's agent on a queued ticket showed it in In progress on the peer's board and in Queued, as planned work, on the others. Only a ticket a peer plans, and does not work on, stays in Queued. The claim of work in hand lasts until the ticket is done; a planned claim still ends when the box goes to open.
- An agent of this session that finished no longer hides a peer's claim on the same ticket. Only a live agent or the main conversation's own claim wins.

## 0.9.17

### Features

- Planned claims. When the main conversation of a session sets a ticket's box to queued (`- [>]`) itself, or the mod queues a ticket after the main conversation took it out of progress, the session records the ticket as planned. A box set by hand on the board, and a helper agent's edit, plan nothing. The planned set is stored per session (`planned:<session id>`), so a reload keeps it.
- The presence record carries `planned` (a record without it reads as empty). Another session shows a ticket you plan in Queued, with the "Peer owned" pill and the tooltip "<name> plans to work this".
- A claim, held or planned, lasts as long as the ticket's box is `[~]` or `[>]`, and ends when the box goes to done or open. A planned ticket whose box goes to `[~]` stays claimed.

### Changes

- A peer record not refreshed for 2 minutes still counts, but its pill and text are dimmed to about half opacity and its tooltip adds " (inactive since HH:MM)" in local 24-hour time. A record older than 24 hours is ignored. This replaces the 2 minute cutoff (`PEER_STALE_MS`); the bounds are `PEER_DIM_MS` and `PEER_IGNORE_MS`.
- A peer's claim on a ticket whose box is open no longer marks it.
- The Send button (⋙) is back on peer-claimed tickets, held and planned (0.9.16 hid it). It sends a different prompt: Claude is told the ticket is claimed by session "<name>", to ask that session with SendMessage first, and to start only when the owner agrees and releases it, or the user says to take it anyway. For an unnamed owner Claude calls ListAgents and asks each other session, with the ticket and the repo root path, whether it claims the ticket.
- A `move_ticket` to queued that the main conversation asked for and the user approved plans the ticket too. A move by hand on the board still claims nothing.

### Notes for Claude

- When the mod records a planned claim, one note line tells Claude: "<ID> is now claimed by this session as planned work. If you queued it for another session or only to order the work, release it: report_progress with release: [...]".
- When this session claims a ticket a peer claims too, one note line per peer claim tells Claude to check in with that session (SendMessage; ListAgents for an unnamed one) before it works on the ticket.
- A session with no name (one that started before 0.9.16 never got the rule), that holds a ticket or has a peer on its repo, gets one note asking Claude to call `report_progress` with `session`, once per load of the mod.
- `report_progress` takes `release`, a list of ticket IDs or quoted ticket text (main conversation only). It drops this session's claims, planned and own, on them. Two rules lines are added: release a ticket you queue for another session or only to order the work; ask a session that claims a ticket before you take it, and release a ticket another session asks you for when you agree.

## 0.9.16

### Features

- Several sessions on one repo see each other's tickets. A ticket another live session holds (itself or through its agents), that this session does not hold, shows in In progress with a yellow outlined "Peer owned" pill in its bottom row. Pointing at the pill shows a tooltip, "<name of that session> owns this", or "An unnamed peer session owns this" when the session never sent its name; a card with the pill is drawn in an interactive frame for it. The Send button is hidden on it, so a click does not start a second session on the same work; the status and move buttons stay.
- Each session writes a `presence:<session id>` record to the store (name, repo root, held tickets, time), at most every 5 seconds and at once on a change, and reads its peers' records every 5 seconds. A record older than 2 minutes does not count, which is how an ended session stops marking its tickets.
- `report_progress` takes an optional `session` field, the session name; the rules ask Claude to send it once, with the name ListAgents shows after "This session is".

## 0.9.15

### Fixes

- The status button (`?`) on an open or queued ticket no longer claims it for the main conversation. The claim never ended, because the ticket was never seen in progress, so the board kept the ticket in In progress with the O tag for good. On a ticket whose box is already in progress, the status button still claims it, and that claim ends as before.
- The README says when a ticket counts as Claude's own, with the `?` button and `move_ticket` cases.
- `move_ticket` to open or queued on a ticket whose box is already there ends the main conversation's claim on it, so a ticket stuck in In progress goes back to its column. Before, it answered "is already open" and changed nothing.

## 0.9.14

### Changes

- The scroll probe is removed: no status line and no `.claude_work/scroll-probe.log` at each scroll. It showed that the desktop pane reports the reader's scrolls to a mod, but gives a mod no way to hold the reader's place.
- A scroll lock built on `$.ui.scroll` was tried and withdrawn before release: on the desktop app each of its measures scrolled the pane, so the pane jumped to the bottom in a loop.
- A card taller than 4096 px (a timeline of about 130 agents or more) is drawn without its height again: since 0.9.11 the engine refused the whole pane for it.
- Two tests from 0.9.10 and 0.9.11 are corrected: an Svg card is found by its alt text, not its key, and the retitle test unmounts the pane between draws.
- The README states the known limit: content above the part you read (an agent card that starts or finishes) moves what you read; the fix has to come from the desktop app.

## 0.9.13

### Changes

- The scroll probe also writes `.claude_work/scroll-probe.log` in the mod's folder: each scroll event, each button press, and the window each draw of the pane reports, when it changes. It keeps the newest 400 lines.

## 0.9.12

### Features

- The hero card shows the mod's version, small, in its lower right corner. It is read from `plugin.json` at each load, so after a reload you can see at once which revision runs.

## 0.9.11

### Fixes

- On a narrow pane, where Open sits under In progress and Queued, a ticket that Start or Queue moves up leaves no space in Open. The column above grows by its card, so the cards from its place down stay put; before, the board moved down by one card.
- Every card is drawn with its height, so a new card no longer shows at no height until its image loads.
- A pane under an older title is reopened with the current one once per load, even if that fails; a failed reopen was tried on every draw.

## 0.9.10

### Fixes

- A press on a ticket button, Stop, the Orchestrator page buttons, Limit UI shift, Show finished agents or Show completed no longer clears the spaces of tickets that left, so the cards below them do not move at the press. Filters, view switches and searches still clear them. Spaces still go after one minute.
- With Limit UI shift on, the agent area always keeps one trailing empty card, so a row gap no longer comes and goes as card heights change, and the Orchestrator card is drawn empty at its held height before the first call.
- The recategorize note is one line, cut to fit, so it no longer pushes the board down for its 4 s.
- The Orchestrator heading has its own key; it shared one with the Orchestrator card.
- A scroll probe shows each `ui.scroll` move of the pane on the status line and in the debug log.

## 0.9.9

### Changes

- The button is now **Limit UI shift**, and it is off by default: the pane reserves no space until you turn it on. While on, the button is filled, like a selected category tag. The tip reads: Limit UI shift reserves interface space so new agent activity does not cause scroll jumps.

## 0.9.8

### Features

- A **Reserve agent space** button at the right of the Orchestrator heading turns the held agent area of 0.9.7 on or off. Off, the pane draws only the cards it has, as before 0.9.7: no empty gray cards, no empty timeline, and an Orchestrator card only as tall as its entries. This saves screen space on a small display, but the board moves as agents come and go. Pointing at the button shows a short tip to its left. The choice lasts for the session; the default is on.

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
