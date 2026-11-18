/** Todo file names: which files of a `.claude_todo/` folder are todo files, and which is the main one. */

/** The line grammar of a todo file: `md` reads Markdown checkbox lines only; `html` reads them and HTML checkbox items too (`html-items.ts`). */
export type TodoKind = 'md' | 'html'

/**
 * The kind of a todo file by its name or path: `html` for a `.html` name in any case, else `md`. Never guessed
 * from the content. The case is ignored as `listedName` and `isMainTodoName` ignore it, so the archive file
 * `TODO.HTML` that a disk lists for `todo.html` reads in its own kind.
 */
export function todoKind(name: string): TodoKind {
  return name.toLowerCase().endsWith('.html') ? 'html' : 'md'
}

/** The extensions of a todo file. A `.html` file also reads HTML checkbox items (`todoKind`). */
export const TODO_EXTENSIONS = ['.md', '.html'] as const

/** True for the name or path of a todo file: it ends in `.md` or `.html`, in any case (`X.MD` too,). */
export function isTodoFileName(name: string): boolean {
  const lower = name.toLowerCase()

  return TODO_EXTENSIONS.some(ext => lower.endsWith(ext))
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
