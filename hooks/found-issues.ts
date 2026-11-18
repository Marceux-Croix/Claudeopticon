/**
 * The found-issues rule (owner rule "Discovered issues"): a ticket made during a turn is fixed in
 * that turn. At a user prompt the mod snapshots the item keys; at the end of the turn, an item whose
 * key is new, that is not done, and that holds none of `(blocked: ...)`, `(arch: ...)` or `(noted: ...)` is an
 * offender, and the mod submits a prompt that names it. A `turn.complete` hook cannot continue its
 * turn, so the nudge is a prompt of its own (`$.prompt.submit`) that runs once the session is idle.
 * Ported from the Python Stop hook `hooks/found-issues`. At most MAX_BLOCKS nudges per user prompt.
 */

import type { TodoFile, TodoItem } from '../types'
import { filePath, keptKey } from './item-keys'

export const MAX_BLOCKS = 2
export const MAX_NAMED = 8
/** The name the engine gives this mod in `e.origin.name` of a prompt it submits. */
export const MOD_NAME = 'claudeopticon'
/** The first words of every nudge: the mod tells its own nudge from its other prompts (a ticket button) by it. */
export const NUDGE_PREFIX = 'Found-issues rule:'

/** `(noted: ...)` marks existing code noted for the backlog, not a found issue (owner rule,). */
export const EXEMPT = /\((?:blocked|arch|noted):/i
/** A `[~]` item an agent works on (`agent <id>, due <HH:MM> UTC`) is work in flight. */
export const IN_FLIGHT = /\bagent\b.*\bdue\b/i
/** A prompt that asks to make, plan or order tickets: the new items are the owner's plan, not found issues. */
export const PLANNING =
  /\b(?:add|make|create|file|write|open|log)\b\W+(?:\w+\W+){0,3}?(?:tickets?|items?|todos?)\b|\bbacklog\b|\b(?:plan|order|triage|queue)\b\W+(?:\w+\W+){0,3}?(?:tickets?|items?|todos?|work)\b/i

export type Snapshot = { keys: ReadonlySet<string>; planning: boolean; blocks: number }

export type Offender = { key: string; label: string; box: string; path: string }

const BOX = { pending: ' ', queued: '>', in_progress: '~', completed: 'x' } as const

/** Live files only: archive files are finished work. */
const live = (files: readonly TodoFile[]): TodoFile[] => files.filter(file => file.isArchived !== true && !file.name.startsWith('archive/'))

/**
 * The key of an item by its text alone, its leading `#T` ID cut: an item the mod numbers during the turn
 * (no ID at the prompt, an ID at the turn end) is the same item, not a new one.
 */
const textKey = (file: TodoFile, item: TodoItem): string => keptKey(file, { text: item.text.replace(/^#T[0-9A-Z]+\s+/, '') })

/** The item keys at a user prompt, with whether the prompt plans tickets, and no nudge yet. */
export function snapshot(files: readonly TodoFile[], promptText: string): Snapshot {
  const keys = new Set<string>()
  for (const file of live(files)) {
    for (const item of file.items) {
      keys.add(keptKey(file, item))
      keys.add(textKey(file, item))
    }
  }

  return { keys, planning: PLANNING.test(promptText), blocks: 0 }
}

function label(item: TodoItem): string {
  return item.id !== undefined ? `#${item.id}` : `"${item.text.slice(0, 80)}"`
}

/** The items made since the snapshot that are not done, not exempt and not in flight, one per key. */
export function offenders(before: Snapshot, files: readonly TodoFile[]): Offender[] {
  const found = new Map<string, Offender>()
  for (const file of live(files)) {
    for (const item of file.items) {
      const key = keptKey(file, item)
      if (before.keys.has(key) || before.keys.has(textKey(file, item)) || found.has(key) || item.status === 'completed' || EXEMPT.test(item.text)) {
        continue
      }
      if (item.status === 'in_progress' && IN_FLIGHT.test(item.text)) {
        continue
      }
      found.set(key, { key, label: label(item), box: BOX[item.status], path: filePath(file) })
    }
  }

  return [...found.values()]
}

/** Nudge only after a normal answer: not for an interrupt, a refusal or an error, not past the block limit, not for a planning prompt. */
export function shouldNudge(before: Snapshot, found: readonly Offender[], turnReason: 'answer' | 'aborted' | 'refusal' | 'error'): boolean {
  return turnReason === 'answer' && !before.planning && before.blocks < MAX_BLOCKS && found.length > 0
}

export function nudgeText(found: readonly Offender[]): string {
  const named = found.slice(0, MAX_NAMED).map(one => `${one.label} [${one.box}] in ${one.path}`)
  const more = found.length > MAX_NAMED ? ` (and ${found.length - MAX_NAMED} more)` : ''

  return (
    `${NUDGE_PREFIX} these tickets were made in this turn and are still open: ${named.join('; ')}${more}. ` +
    'Fix each one now and check it off (`- [x]`). If no fix is safe now, add `(blocked: <what>)` to the ' +
    'line; if it is a major architectural change, add `(arch: <why>)`. Then tell the owner in one line.'
  )
}

/** True for a prompt this mod submitted as a nudge: it keeps the snapshot and the block count. */
export function isOwnNudge(e: { text: string; origin?: { kind: string; name?: string } }): boolean {
  // The prefix alone decides: if an engine gave the nudge no plugin origin, a nudge would take a new
  // snapshot and reset the count, and the cap of MAX_BLOCKS would not hold. No other prompt starts with it.
  return e.text.startsWith(NUDGE_PREFIX)
}

type PromptEvent = { text: string; agentId?: string; origin?: { kind: string; name?: string } }
type TurnEvent = { reason: 'answer' | 'aborted' | 'refusal' | 'error'; agentId?: string }

export type FoundIssues = {
  /** True when a prompt takes a new snapshot: the option is on, it is the main loop, and it is the user's (not a nudge or a notification). */
  takesPrompt: (e: PromptEvent) => boolean
  /** Sets the snapshot from the live todo files; `undefined` (a read that failed) keeps the last one. */
  onPrompt: (e: PromptEvent, files: readonly TodoFile[] | undefined) => void
  /** True when a turn end is checked: the option is on, it is the main loop, a snapshot exists and it may still nudge. */
  takesTurn: (e: TurnEvent) => boolean
  /** The nudge text for this turn end, counted against the limit, or `undefined` for none. */
  onTurnEnd: (e: TurnEvent, files: readonly TodoFile[] | undefined) => string | undefined
}

/**
 * The rule's state, one snapshot for the session, set at each user prompt. It takes data, never `$`:
 * the plugin validator refuses `$` passed to a method, so `register.tsx` reads the files and submits
 * the nudge itself. Fails open: a read that failed (`undefined`) never nudges.
 */
export function createFoundIssues(options: { enabled: boolean }): FoundIssues {
  let current: Snapshot | undefined

  return {
    takesPrompt: e => options.enabled && e.agentId === undefined && !isOwnNudge(e) && e.origin?.kind !== 'task-notification',
    onPrompt(e, files) {
      if (files !== undefined) {
        current = snapshot(files, e.text)
      }
    },
    // Only a turn that ended with an answer can nudge, so no other end costs a rescan.
    takesTurn: e => options.enabled && e.reason === 'answer' && e.agentId === undefined && current !== undefined && !current.planning && current.blocks < MAX_BLOCKS,
    onTurnEnd(e, files) {
      const before = current
      if (before === undefined || files === undefined) {
        return undefined
      }
      const found = offenders(before, files)
      if (!shouldNudge(before, found, e.reason)) {
        return undefined
      }
      current = { ...before, blocks: before.blocks + 1 }

      return nudgeText(found)
    },
  }
}
