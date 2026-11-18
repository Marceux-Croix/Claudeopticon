/** Matching a new agent to the ticket it works on, through the model. */

import type { EngineInterface } from 'claude-code'
import { agentLabel } from './agent-identity'
import { MATCH_ITEMS, matchPrompt, readMatchReply } from './agent-match'
import { addFailure, isRetryDue } from './backoff'
import { SORT_MODEL } from './categories'
import { setRows } from './agent-rows'
import { nowSync } from './pane-clock'
import { redraw } from './pane-redraw'
import { S, matchFailures, matchedAgents } from './state'
import { showToast } from './toasts'

/** The tries of one agent's match, and the wait after the first failure: 30 s, then 60 s. */
const MATCH_TRIES = 3

const MATCH_RETRY_MS = 30_000

const MATCH_RETRY_MAX_MS = 10 * 60_000

/** True once the toast for a match given up is shown; shown again only after a match call is answered. */
let isMatchToastShown = false

/**
 * Asks Haiku, once per agent, which open, queued or in-progress todo items the agent's task works on, and
 * links them. Agents rarely name their items, and most items have no ID, so without this most
 * links never form. In-progress items are listed first, then queued, then open.
 */
export async function matchAgent($: EngineInterface, id: string, task: string): Promise<void> {
  // The one guard of the once-per-agent rule; matchNewAgents calls for every live row.
  // A call that failed is tried again after its wait, at most MATCH_TRIES times in all.
  const failing = matchFailures.get(id)
  if (matchedAgents.has(id) || (failing !== undefined && failing.count >= MATCH_TRIES) || !isRetryDue(failing, nowSync(), MATCH_RETRY_MAX_MS)) {
    return
  }
  const open = S.todoFiles
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items)
    .filter(item => item.status !== 'completed')
  const texts = [...new Set([...open.filter(item => item.status === 'in_progress'), ...open.filter(item => item.status === 'queued'), ...open.filter(item => item.status === 'pending')].map(item => item.text))].slice(0, MATCH_ITEMS)
  if (texts.length === 0) {
    return
  }
  matchedAgents.add(id)
  const reply = await $.model.complete({ model: SORT_MODEL, prompt: matchPrompt(task, texts), maxTokens: 200 }).catch(() => undefined)
  if (reply?.isAnswered !== true) {
    // A thrown or unanswered call is not an answer: the agent is matched again after a wait, and given up with one toast after MATCH_TRIES.
    // No await between the delete and the record: a refresh in between would pass the guard and call again at once.
    const next = addFailure(matchFailures.get(id), nowSync(), MATCH_RETRY_MS, MATCH_RETRY_MAX_MS)
    matchFailures.set(id, next)
    matchedAgents.delete(id)
    if (next.count >= MATCH_TRIES && !isMatchToastShown) {
      isMatchToastShown = true
      const index = S.agentRows.findIndex(row => row.id === id)
      showToast($, `Could not match ${index < 0 ? 'an agent' : agentLabel(index)} to a ticket: the model call failed ${next.count} times. Its links come only from the IDs and items it names.`)
    }

    return
  }
  matchFailures.delete(id)
  isMatchToastShown = false
  const picks = readMatchReply(reply.text, texts.length)
  // A reply with no pick is stored as no pick, so a reload does not run the match again: mergeGroup marks a row with autoClaims as matched.
  const autoClaims = picks.map(i => texts[i]).filter((text): text is string => text !== undefined)
  setRows(S.agentRows.map(row => (row.id === id ? { ...row, autoClaims } : row)))
  redraw($)
}
