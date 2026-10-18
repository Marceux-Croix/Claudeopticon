/** The texts the mod gives Claude about one ticket: send, status, move question and the short form of a ticket. */

import type { TodoItem } from '../types'
import { cutUnits } from './card-text'
import type { ItemStatus } from './card-types'
import { lineSafe, quoteName } from './note-quotes'
import { STATUS_WORDS } from './ticket-boxes'

/**
 * The prompt a ticket sends to Claude: the item, where it lives, and how to keep the pane in step.
 * The path is quoted (a folder name is no instruction); the item is the work the user sent,
 * with each line terminator but LF and CR (VT, FF, NEL, U+2028, U+2029) a space (lineSafe).
 */
export function ticketPrompt(path: string, text: string): string {
  return [
    `Process this todo item from ${quoteName(path)}:`,
    '',
    lineSafe(text),
    '',
    'Build or process it now. Mark it [~] while you work on it and [x] when it is done. If you dispatch an agent for it, name the item in the Agent call and have the agent claim it with report_progress.',
  ].join('\n')
}

/** The question the move tool asks the user, in the engine's own dialog. */
export function moveQuestion(path: string, item: TodoItem, to: ItemStatus, reason: string, isUserMove: boolean): string {
  const from = STATUS_WORDS[item.status]
  const said = reason.trim() === '' ? '' : ` Claude's reason: ${ticketSummary(reason.trim(), 300)}`

  return `Claude asks to move "${ticketSummary(item.text, 120)}" (${path}) from ${from} to ${STATUS_WORDS[to]}.${isUserMove ? ' You moved it by hand.' : ''}${said} Allow this move?`
}

/** The prompt a ticket in progress sends: a short status update in the chat, and no new work. Quoted as ticketPrompt is. */
export function statusPrompt(path: string, text: string): string {
  return [
    `Give me a short status update on this todo item from ${quoteName(path)}:`,
    '',
    lineSafe(text),
    '',
    'Say what is done, what is running now (name any agent on it), and what is left. Check the work itself, not only the todo line. Do not start new work on it.',
  ].join('\n')
}

/** A short hover group name for a ticket's send arrow and its tip: at most 64 characters. */
export function sendScope(key: string): string {
  let hash = 0
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0
  }

  return `send-${(hash >>> 0).toString(36)}`
}

/** A ticket's one or two summary lines: the item's text cut to `chars`, at a word. */
export function ticketSummary(text: string, chars: number): string {
  if (text.length <= chars) {
    return text
  }
  // Cut by UTF-16 units, but never inside a surrogate pair: the toast would show a broken character.
  const cut = cutUnits(text, chars)
  const space = cut.lastIndexOf(' ')

  return `${(space > chars * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
