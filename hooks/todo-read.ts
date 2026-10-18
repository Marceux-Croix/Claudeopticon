/** The result of one todo file read: its text, no file there, or a read that failed and why. */

/**
 * What a read of a todo file gave. `missing`: nothing stands at the path. `failed`: the file
 * is there (or that cannot be told) and did not read; it is never an empty file, and never absent.
 * `error` is what the engine threw, when it threw.
 */
export type TodoRead = { kind: 'ok'; text: string } | { kind: 'missing'; error?: unknown } | { kind: 'failed'; reason: string; error?: unknown }

/** The words of a failure: the error's message, else its text. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The words of a read that gave no text. */
export const readReason = (read: Exclude<TodoRead, { kind: 'ok' }>): string => (read.kind === 'missing' ? 'no such file' : read.reason)

/** A todo file that did not read, named: the error that stops a caller that needs every file. */
export class TodoReadError extends Error {
  readonly path: string
  readonly reason: string

  constructor(path: string, reason: string) {
    super(`${path} did not read: ${reason}`)
    this.path = path
    this.reason = reason
  }
}
