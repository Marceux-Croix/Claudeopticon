/** Names and text as the notes and prompts to Claude quote them: one line, and data inside its quotes. */

import { controlFree } from './card-text'

/**
 * The Unicode line terminators other than LF and CR: VT (U+000B), FF (U+000C), NEL (U+0085),
 * and the line and paragraph separators U+2028 and U+2029 (the classes Zl and Zp). JSON.stringify leaves
 * NEL, U+2028 and U+2029 raw (it escapes only U+0000 to U+001F), and controlFree keeps U+2028 and U+2029
 * (they are no control characters); a reader of the note may take any of them as a line break, which
 * would start a line of its own outside any quotes. LF and CR need no entry: JSON.stringify escapes them,
 * controlFree makes them a space, and a ticket's text never holds one (the CHECKBOX grammar).
 */
const LINE_TERMINATORS = /[\v\f\u0085\u2028\u2029]/g

/** The text with each of those line terminators one space. */
export const lineSafe = (text: string): string => text.replace(LINE_TERMINATORS, ' ')

/**
 * A file or folder name, or any other text, as a note line takes it: each run of control characters
 * one space, and each line terminator one space, so a line break, a tab or a separator in a
 * name cannot start a line of its own in the note.
 */
export const noteName = (name: string): string => lineSafe(controlFree(name))

/**
 * The C1 controls (U+0080 to U+009F; NEL is a space by then) and the format characters (class Cf:
 * the bidi overrides such as U+202E, the tag characters U+E0000 to U+E007F), which JSON.stringify
 * leaves raw and a reader cannot see.
 */
const HIDDEN_CHARS = /[\u0080-\u009f\p{Cf}]/gu

/** Each code unit of a hidden character as a JSON `\uXXXX` escape, so the note shows it and still parses. */
const escapeHidden = (json: string): string => json.replace(HIDDEN_CHARS, ch => Array.from({ length: ch.length }, (_, i) => `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`).join(''))

/** Text as a JSON string with no raw line terminator or hidden character: a quote, a line break or a tab stays inside the quotes as `\"`, `\n` or `\t`. */
export const quoteText = (text: string): string => escapeHidden(JSON.stringify(lineSafe(text)))

/** A name (a path, a heading, an agent type) as a note quotes it: noteName, then a JSON string, so a quote in it cannot close the quotes. */
export const quoteName = (name: string): string => quoteText(noteName(name))
