# Contributing

Issues and pull requests are welcome.

## Set up

1. Clone the repo.
2. Start Claude Code with `claude --plugin-dir <path to the clone>`.
3. After an edit, run `/reload-plugins`.

## Check your change

Run all four gates from the repo root before you open a pull request. The gates run by hand. There is no CI, so no check runs for you.

```bash
claude plugin test .
claude plugin validate .
node --import ./scripts/ts-resolve.mjs scripts/check-reads.ts
node --import ./scripts/ts-resolve.mjs scripts/check-writes.ts
```

- `claude plugin test .` runs the tests in `tests/`.
- `claude plugin validate .` checks the plugin and its hooks against the engine rules.
- `check-reads.ts` fails on any read of a todo file that does not go through `readTodo`, any read that turns a failure into an empty value, and any way around the `fs.read(` text.
- `check-writes.ts` fails on any write of a todo file that does not go through `writeIfUnchanged`, and any way around the `fs.write(` text.

Two more checks run by hand, when you change the matching part. `check-modules.ts` fails when a `hooks/*.ts` file is missing from the module list of CONTRIBUTING.md or the table in `docs/how-it-works.md`. `check-versions.ts` fails when `plugin.json` and `marketplace.json` name different versions. `claim-race.ts` races real processes over the ID claim folders (`node --import ./scripts/ts-resolve.mjs scripts/claim-race.ts 300` and `... scripts/claim-race.ts --layouts 200`; each exits 0, and `--old` exits 1 to show that the check finds the defect).

The two scripts run on plain Node 22.18 or later. `scripts/ts-resolve.mjs` adds the `.ts` to relative imports, so there is no `npx` and no download. A new read or write of a file that is no todo file goes in the allowed list in `tests/read-scan.ts` or `tests/write-scan.ts`, with its reason.

Add a test for each change in behavior, in the test file of the module you change: `tests/<module>.test.tsx` for `hooks/<module>.ts`. A case that needs the fake engine goes in a `tests/register*.test.tsx` file.

## Module layout

Each file in `hooks/` has one responsibility, which its first line states. Before you add code, find the module for it. Put a new responsibility in a new file, with its own test file.

- `register.tsx` is the hooks module that `hooks.json` loads. It holds the hooks, the tools, every function that calls the engine through `$`, and the session state those functions write. `claude plugin validate` follows `$` only into functions in that file. Never add pure logic to it.
- The other modules hold pure logic, types and constants, and never take `$`.
- Todo text: `todo-markdown.ts`, `markdown-blocks.ts`, `html-blocks.ts`, `example-end.ts`, `todo-read.ts`, `unread-files.ts`, `unread-folders.ts`, `ticket-ids.ts`, `numbering.ts`, `archive-blocks.ts`, `consolidate-text.ts`, `consolidate-marks.ts`, `told-notes.ts`, `duplicate-tickets.ts`, `ticket-boxes.ts`, `ticket-lookup.ts`, `stop-queue.ts`.
- ID claims: `id-blocks.ts`, `block-claim.ts`, `git-file.ts`.
- Folders, paths and limits: `repo-folders.ts`, `path-forms.ts`, `platform-commands.ts`, `write-lock.ts`, `time-limit.ts`, `backoff.ts`, `key-prune.ts`, `clock-elapsed.ts`.
- Agents and links: `links.ts`, `claim-score.ts`, `claim-keeping.ts`, `agent-match.ts`, `agent-identity.ts`, `agent-colors.ts`, `agent-respawn.ts`, `agent-ends.ts`, `row-equality.ts`, `progress-report.ts`, `tool-calls.ts`, `secrets.ts`, `peer-sessions.ts`.
- Notes and prompts for Claude: `claude-notes.ts`, `note-quotes.ts`, `ticket-prompts.ts`, `rules.ts`, `deferred-tickets.ts`, `plugin-version.ts`.
- The view: `view-model.ts`, `categories.ts`, `sort-queue.ts`, `ticket-actions.ts`, `ticket-spaces.ts`, `orchestrator-history.ts`, `terminal-text.ts`, `item-keys.ts`, `normalize.ts`.
- The store: `kept-records.ts`, `token-usage.ts`.
- The cards: `card-types.ts`, `card-stage.ts`, `card-text.ts`, `card-format.ts`, `card-parts.ts`, `series.ts`, `card-end-labels.ts`, `card-end-dots.ts`, `hero-card.ts`, `todo-cards.ts`, `agent-cards.ts`, `agent-room.ts`.

The table in [How it works](docs/how-it-works.md#module-layout) gives the responsibility of each file.

## Style

- Two-space indent, no semicolons, single quotes.
- Short comments that say what and why.
- Card markup must not change with the clock alone.

## Sample images

The images in `docs/images/` come from the real card code and the sample data in `scripts/sample.ts`. Render them again after any change to a card:

```bash
node --import ./scripts/ts-resolve.mjs scripts/render-cards.ts
```

This writes `top.svg`, `orchestrator.svg`, `agents.svg`, `board.svg` and `pane.svg` in `docs/images/`. The script renders in UTC, so the images are the same on every machine. `scripts/render-hero.ts` renders the top card in each sample state and fuzz state at the widths the pane allows, and `scripts/render-crowd.ts` renders the top card, a ticket card and a list card with 12 owners, for a check by eye. Both run with the same `node --import ./scripts/ts-resolve.mjs` command and write to `.claude_work/` unless you give a folder. On macOS, `qlmanage -t -s 1440 -o <dir> <dir>/*.svg` turns the SVG files into PNG files to look at. No script makes `social-preview.png` (1280 by 640). Make it from `pane.svg` by hand when the top card changes.
