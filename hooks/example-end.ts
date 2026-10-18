/** The open example at the end of a todo text: a code fence or an HTML block that a blank line does not close. */

import { bare, exampleMask } from './todo-markdown'

/**
 * True when text added after `text` would sit inside an example: the text ends inside a code fence
 * or an HTML comment block that never closes. Read with `exampleMask`, so the rule
 * is the parser's own: a line added there is no item, and a ticket appended to such a file drops off
 * the board. The probe is an unindented line after a blank line, as a `## From` heading and an archived
 * block are put (`addToArchive` adds that blank line where it ends an HTML block): an HTML
 * block of type 6 or 7 (`<div>`, `<details>`, a lone tag) ends at a blank line, so it is no open example.
 */
export function endsInExample(text: string): boolean {
  const lines = text.split('\n').map(bare)

  return exampleMask([...lines, '', '## end probe']).at(-1) === true
}
