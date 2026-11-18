/** Todo file names: which files of a `.claude_todo/` folder are todo files, and which is the main one. */

/** The extensions of a todo file. A `.html` file is read and written the same as a `.md` file. */
export const TODO_EXTENSIONS = ['.md', '.html'] as const

/** True for the name or path of a todo file: it ends in `.md` or `.html`. */
export function isTodoFileName(name: string): boolean {
  return TODO_EXTENSIONS.some(ext => name.endsWith(ext))
}

/** True for the name of a main todo file, `TODO.md` or `TODO.html` in any case. */
export function isMainTodoName(name: string): boolean {
  const lower = name.toLowerCase()

  return TODO_EXTENSIONS.some(ext => lower === `todo${ext}`)
}

/** The main todo file among names: a `TODO.md` (any case) first, then a `TODO.html`; undefined when there is none. */
export function findMainTodo(names: readonly string[]): string | undefined {
  for (const ext of TODO_EXTENSIONS) {
    const found = names.find(name => name.toLowerCase() === `todo${ext}`)
    if (found !== undefined) {
      return found
    }
  }

  return undefined
}
