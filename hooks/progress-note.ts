/** The note that tells an agent about the progress tool, added to the prompt of each agent. */

/** Appended to each agent's prompt: about 100 tokens, and each report rides along with a tool call. */
export const progressNote = (progressTool: string): string => `

Progress: if you have the ${progressTool} tool, call it once you have a plan, with done (steps finished), total (steps planned) and step (a few words on the current step). If your task covers items in the project's .claude_todo/ files, also pass items: each one quoted from its line, or its #T ID. Call it again after each step, in the same message as your next tool call. Raise total if the plan grows; pass items again only if they change.`
