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

**Stop** runs the `TaskStop` tool with the agent's ID. That aborts the agent's loop: no more turns, no summary.

The todo folder is scanned every 3 seconds, and fully reread once a minute.

## Reading the todo

The mod looks for `.claude_todo/` at the root of the repo. From a git worktree it uses the main checkout's folder. It never reads one in the home `.claude` folder. A line's `#T<n>` ID is the item's key. Without an ID, the key is the item's text.

## Linking agents to tickets

Strongest first: the ID in the agent's description or prompt (a whole ID: `#T1` does not match `#T12`); a `report_progress` claim; a Haiku match of the task against open items (at most three); a quote of the item's text. Only running agents link.

## Background tasks

A card starts when the launching call returns a task ID (`backgroundTaskId` from a background Bash call, `taskId` from `Monitor` and `Workflow`). It ends when the task's notification reports `completed`, `failed` or `killed`, or when `TaskStop` names it. Haiku shortens the description to a name once; until it answers, the cut description stands in.

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
