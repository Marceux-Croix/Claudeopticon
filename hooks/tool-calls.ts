/** What a tool call shows on the pane: its few words, its summary line and its detail line. */

import { cutText, cutUnits } from './card-text'
import { relIn } from './path-forms'
import { hasSecret, HIDDEN, hideSecrets } from './secrets'

/** A few words on what a tool call does, from its arguments. */
export function describeCall(tool: string, input: Record<string, unknown>): string {
  for (const key of ['description', 'command', 'file_path', 'pattern', 'query', 'url', 'path', 'prompt']) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) {
      // A command, URL or pattern with a secret in any line shows as "(hidden)", as callDetail hides it.
      const line = hasSecret(value) ? '(hidden)' : (value.split('\n')[0] ?? '')

      return `${tool}: ${line.length > 60 ? `${cutText(line, 57)}...` : line}`
    }
  }

  return tool
}

/** A tool call's own one-line summary: its `description` as written, else a few words from its arguments. */
export function callSummary(tool: string, input: Record<string, unknown>): string {
  const description = input.description

  return typeof description === 'string' && description.trim() !== '' ? (hasSecret(description) ? `${tool}: (hidden)` : description.trim().split('\n')[0]!) : describeCall(tool, input)
}
/** The longest detail kept per history entry; the card cuts it again to fit its line. */
export const DETAIL_MAX = 300

/**
 * The native detail of a tool call, from its input: the command, path, pattern or URL it ran with.
 * Undefined when the tool has none (MCP tools), or the detail only repeats the summary `line`. A
 * path inside `root` shows relative to it. A detail of any tool that looks like it holds a secret shows
 * as "(hidden)".
 */
export function callDetail(tool: string, input: Record<string, unknown>, line: string, root?: string): string | undefined {
  const text = (key: string): string | undefined => {
    const value = input[key]

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  const rel = (path: string | undefined): string | undefined => (path === undefined ? undefined : (relIn(path, root) ?? path))
  let detail: string | undefined
  if (tool === 'Bash') {
    const command = text('command')
    detail = command === undefined ? undefined : hideSecrets(command) === '(hidden)' ? '(hidden)' : command.split('\n')[0]!.trim()
  } else if (tool === 'Read' || tool === 'Edit' || tool === 'Write') {
    detail = rel(text('file_path'))
  } else if (tool === 'NotebookEdit') {
    detail = rel(text('file_path') ?? text('notebook_path'))
  } else if (tool === 'Grep') {
    const pattern = text('pattern')
    const path = rel(text('path'))
    detail = pattern === undefined ? undefined : path === undefined ? pattern : `${pattern}  ${path}`
  } else if (tool === 'Glob') {
    detail = text('pattern')
  } else if (tool === 'WebFetch') {
    detail = text('url')
  } else if (tool === 'WebSearch') {
    detail = text('query')
  } else if (tool === 'Agent' || tool === 'Task') {
    detail = [text('subagent_type'), text('model')].filter(part => part !== undefined).join(', ')
  } else if (tool === 'Skill') {
    detail = text('skill')
  }
  // Every detail type is checked, on the whole input text and again on the one line that shows.
  detail = detail === undefined ? undefined : cutUnits(hideSecrets(detail), DETAIL_MAX)

  return detail === undefined || detail === '' || detail === line ? undefined : detail
}

/**
 * An agent's current-call line as kept, with a secret hidden: `Bash: (hidden)` when the line names
 * its tool, else "(hidden)". For a line stored by an older version, which no check saw (UCR-029).
 */
export function hideDoing(doing: string): string {
  if (!hasSecret(doing)) {
    return doing
  }
  const tool = /^([\w.-]{1,80}): /.exec(doing)?.[1]

  return tool === undefined ? HIDDEN : `${tool}: ${HIDDEN}`
}
