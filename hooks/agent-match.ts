/** The Haiku match of a new agent's task to open items: the prompt and the reply. */

import { cutUnits } from './card-text'

export const MATCH_ITEMS = 80
const MATCH_MAX = 3

export function matchPrompt(task: string, texts: readonly string[]): string {
  return [
    "An agent was started with this task. Which of the project's todo items is it working on?",
    '',
    'Task:',
    cutUnits(task, 2000),
    '',
    'Todo items:',
    ...texts.map((text, i) => `${i + 1}. ${cutUnits(text, 160)}`),
    '',
    `Reply with JSON only: {"items": [numbers]}, at most ${MATCH_MAX}, only items the task works on directly; {"items": []} when none fits.`,
  ].join('\n')
}

/** The item numbers in a match reply, 0-based, in range, at most three; empty when unreadable. */
export function readMatchReply(reply: string, count: number): number[] {
  const found = /\{[\s\S]*\}/.exec(reply)?.[0]
  if (found === undefined) {
    return []
  }
  try {
    const parsed = JSON.parse(found) as { items?: unknown }
    const items = Array.isArray(parsed.items) ? parsed.items : []

    return [...new Set(items.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count).map(n => n - 1))].slice(0, MATCH_MAX)
  } catch {
    return []
  }
}
