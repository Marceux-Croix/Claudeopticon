/** The texts the mod gives Claude about one ticket: send, status, move question and the short form of a ticket. */

import type { TodoItem } from '../types'
import { cutUnits } from './card-text'
import type { ItemStatus } from './card-types'
import { noteName, quoteName, visibleText } from './note-quotes'
import { STATUS_WORDS } from './ticket-boxes'

/**
 * The prompt a ticket sends to Claude: the item, where it lives, and how to keep the pane in step.
 * The path is quoted (a folder name is no instruction); the item is the work the user sent,
 * with each line terminator but LF and CR (VT, FF, NEL, U+2028, U+2029) a space and each hidden
 * character (tag characters, bidi overrides) an escape (visibleText): the prompt goes in as the user's
 * own, so it holds no text the card does not show.
 */
export function ticketPrompt(path: string, text: string): string {
  return [
    `Process this todo item from ${quoteName(path)}:`,
    '',
    visibleText(text),
    '',
    'The user sent it as the next work, not to interrupt. If you are in the middle of other work, finish the step you are on; do not drop it. Mark the item [~] now, since it is next, and [x] when it is done. Dispatch an agent for it unless it takes only a few tool calls: name the item ID in the Agent call and have the agent claim it with report_progress. If it does not depend on your current work, dispatch that agent now, so it runs alongside.',
  ].join('\n')
}

/**
 * What Claude does when the owner has no name: ask every other session (ListAgents does not show a session's folder, so the
 * message names this repo's root, and a session in another repo ignores it). `quoteName` keeps the path from being an instruction.
 */
const ASK_ALL = (root: string): string =>
  `That session sent no name, so it cannot be addressed. Call ListAgents and send one SendMessage to each other session there, naming this ticket's ID and text and this repo's root path ${quoteName(root)}, asking: "Do you claim this ticket? If you do and can give it up, release it with report_progress release; if it is not in your repo, ignore this."`

/**
 * The prompt Send gives for a ticket another session claims: a peer tag means check in with the owner first, not hands off.
 * Claude asks the owner with SendMessage (to: its name, as ListAgents shows it), and starts only when the owner agrees and
 * releases the ticket, or the user says to take it anyway. With no name it asks the user.
 */
export function peerSendPrompt(path: string, text: string, name: string | undefined, root: string): string {
  const owner = name === undefined ? 'an unnamed peer session' : `session ${quoteName(name)}`
  const ask = name === undefined ? ASK_ALL(root) : `First ask that session with SendMessage (to: ${quoteName(name)}, the name ListAgents shows) whether it can take the ticket.`
  const start =
    name === undefined
      ? 'Start once the "Peer owned" tag on the ticket clears (the owner released it). If every session answered no and the tag is still there, start only when the user tells you to take it anyway. Then mark it [~] while you work on it and [x] when it is done.'
      : 'Start only when that session agrees and releases the ticket (it calls report_progress with release), or when the user tells you to take it anyway. Then mark it [~] while you work on it and [x] when it is done.'

  return [
    `This todo item from ${quoteName(path)} is claimed by ${owner}, another Claude Code session on this repo:`,
    '',
    visibleText(text),
    '',
    ask,
    start,
  ].join('\n')
}

/**
 * The question the move tool asks the user, in the engine's own dialog: the consent gate of the move.
 * The ticket text, the path and Claude's reason are cleaned before the cut (noteName: no control
 * character, each hidden character an escape), so a terminal sequence or a bidi override in them
 * cannot change what the user reads.
 */
export function moveQuestion(path: string, item: TodoItem, to: ItemStatus, reason: string, isUserMove: boolean): string {
  const from = STATUS_WORDS[item.status]
  const why = noteName(reason).trim()
  const said = why === '' ? '' : ` Claude's reason: ${ticketSummary(why, 300)}`

  return `Claude asks to move "${ticketSummary(noteName(item.text), 120)}" (${noteName(path)}) from ${from} to ${STATUS_WORDS[to]}.${isUserMove ? ' You moved it by hand.' : ''}${said} Allow this move?`
}

/** The prompt a ticket in progress sends: a short status update in the chat, and no new work. Quoted as ticketPrompt is. */
export function statusPrompt(path: string, text: string): string {
  return [
    `Give me a short status update on this todo item from ${quoteName(path)}:`,
    '',
    visibleText(text),
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
