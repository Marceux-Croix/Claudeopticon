/** The Orchestrator history: its entries and its pages. */

/**
 * What the main conversation (the orchestrator) did itself this session: the one-line summary of
 * each of its tool calls (the call's own `description`, as the transcript shows it), with its start
 * time, newest last, the last 1000 kept. Agent calls stay out: they are the agents' work.
 */
export type OrchestratorEntry = { id: number; line: string; at: number; isRunning: boolean; detail?: string }

export const ORCHESTRATOR_KEPT = 1000
const ORCHESTRATOR_PAGE = 5

/** "Newest 5 of 57" on the first page, then "11 to 15 of 57". */
export function pageLabel(view: { entries: readonly unknown[]; page: number }, total: number): string {
  const from = view.page * ORCHESTRATOR_PAGE + 1

  return view.page === 0 ? `Newest ${view.entries.length} of ${total}` : `${from} to ${from + view.entries.length - 1} of ${total}`
}

/** One page of the history, newest first, and how many pages there are; a page past the end shows the last. */
export function orchestratorView(history: readonly OrchestratorEntry[], page: number): { entries: OrchestratorEntry[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(history.length / ORCHESTRATOR_PAGE))
  const at = Math.min(Math.max(0, page), pages - 1)
  const newest = [...history].reverse()

  return { entries: newest.slice(at * ORCHESTRATOR_PAGE, (at + 1) * ORCHESTRATOR_PAGE), page: at, pages }
}
