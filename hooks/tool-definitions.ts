/** The definitions of the mod's two MCP tools, report_progress and move_ticket, and their registration. */

import type { EngineInterface } from 'claude-code'
import { toastFailure } from './toasts'

export async function registerTools($: EngineInterface): Promise<void> {
  await $.tool
    .register({
      name: 'report_progress',
      // Only an agent's done, total and step are drawn: the orchestrator card has no progress bar, so the main conversation's are not used, and the description says so.
      description: "Report your progress to the user: steps done of steps planned, and the current step. Only a helper agent's steps are drawn, on its card; from the main conversation, only title and items are used.",
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', description: 'Steps finished' },
          total: { type: 'integer', description: 'Steps planned' },
          step: { type: 'string', description: 'The current step, in a few words' },
          items: {
            type: 'array',
            items: { type: 'string' },
            description: "The .claude_todo items your task covers: each quoted from its line, or its #T ID",
          },
          title: { type: 'string', description: 'A short headline for the whole assignment you work on yourself (main conversation only), a few words' },
          release: { type: 'array', items: { type: 'string' }, description: "Main conversation only: tickets to give up, each quoted from its line or its #T ID. Drops this session's claims on them, planned and own. Use it for a ticket you queued for another session or only to order the work, or that another session asked you for and you agree" },
          session: { type: 'string', description: 'Main conversation only, once: your session name, as ListAgents shows it after "This session is", without the bracketed ref. Other sessions on the repo show it as the owner of your tickets' },
        },
        required: ['done', 'total'],
      },
      isDeferred: false,
    })
    // The rules still tell Claude to call it, so a failure is told, never silent.
    .catch(toastFailure($, 'register the report_progress tool'))
  await $.tool
    .register({
      name: 'move_ticket',
      description:
        "Ask the user to approve moving a .claude_todo item to another column of the Claudeopticon pane board: open, queued (close but not imminent), in_progress (running or next) or done. The user sees a dialog; the box is written only if they approve. Use it for any item the user moved by hand, instead of editing its box.",
      inputSchema: {
        type: 'object',
        properties: {
          item: { type: 'string', description: "The item's #T ID, or its text quoted from its line" },
          folder: { type: 'string', description: "Only when the item ID or text is in more than one file: the item's folder path as the prompts give it (mods/x/.claude_todo), or its file path (mods/x/.claude_todo/TODO.md)" },
          to: { type: 'string', enum: ['open', 'queued', 'in_progress', 'done'], description: 'Where to move it' },
          reason: { type: 'string', description: 'Why, in one or two sentences, shown to the user' },
        },
        required: ['item', 'to', 'reason'],
      },
      isDeferred: false,
    })
    .catch(toastFailure($, 'register the move_ticket tool'))
}
