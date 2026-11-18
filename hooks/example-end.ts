/** The open example at the end of a todo text: a code fence or an HTML block that a blank line does not close. */

import { bare, lineMask, type TodoKind } from './todo-markdown'

/**
 * True when text added after `text` would sit inside an example: the text ends inside a code fence
 * or an HTML comment block that never closes. Read with `exampleMask`, so the rule
 * is the parser's own: a line added there is no item, and a ticket appended to such a file drops off
 * the board. The probe is an unindented line after a blank line, as a `## From` heading and an archived
 * block are put (`addToArchive` adds that blank line where it ends an HTML block): an HTML
 * block of type 6 or 7 (`<div>`, `<details>`, a lone tag) ends at a blank line, so it is no open example.
 * A `.html` file (`kind`) is probed with an `<h2>` line too: an unclosed HTML comment or `<pre>` element
 * there hides the HTML items put after it (`lineMask`).
 */
export function endsInExample(text: string, kind: TodoKind = 'md'): boolean {
  const lines = text.split('\n').map(bare)

  return lineMask([...lines, '', '## end probe'], kind).at(-1) === true || (kind === 'html' && lineMask([...lines, '', '<h2>end probe</h2>'], kind).at(-1) === true)
}
