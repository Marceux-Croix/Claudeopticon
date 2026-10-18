/** Finding a ticket by ID or quoted text in the todo files, and narrowing the hits to one folder. */

import type { TodoFile, TodoItem } from '../types'
import { claimScore } from './claim-score'
import { codeSpansOut, ID_SRC } from './todo-markdown'

export type Found = { file: string; folder: string; rel: string; item: TodoItem }

/** The ID form the mod writes: `T`, a digit, then 3 or more base-36 characters. A bare word of this form names an ID. */
const MOD_FORM = /^[Tt]\d[0-9A-Za-z]{3,}$/

/**
 * Every live item a reference may name: all items with its `#T` ID (folders may share IDs), else
 * all items whose text holds as a `#` word an ID the reference writes with its `#`, or that is the
 * whole reference (an older ID after the text: `#PROJ7`, `PROJ7`), else the items of
 * the best text match. Archived files are left out. Several files may match.
 */
export function findTickets(list: readonly TodoFile[], ref: string): Found[] {
  const all = list
    .filter(file => file.isArchived !== true)
    .flatMap(file => file.items.map(item => ({ file: file.name, folder: file.folder, rel: file.rel ?? file.folder, item })))
  // Every ID word of the reference, in order; the first that names an item wins (`T002A` as well as `T2`). The # rule
  // of the tag fallback below holds here too: a `#` word of any ID form, the reference that is one ID and
  // nothing else, or a bare word in the mod's own form (`T` and 4 or more characters, `T0005`, `t002a`). A short or
  // other-letter bare word of a description (`Update the T2 dashboard`, `h264`) is text, and goes to the text match.
  const isWhole = new RegExp(`^#?(${ID_SRC})$`).test(ref.trim())
  for (const word of ref.matchAll(new RegExp(`(#?)\\b(${ID_SRC})\\b`, 'g'))) {
    if (word[1] === '' && !isWhole && !MOD_FORM.test(word[2]!)) {
      continue
    }
    const id = word[2]!.toLowerCase()
    const byId = all.filter(one => one.item.id?.toLowerCase() === id)
    if (byId.length > 0) {
      return byId
    }
  }
  // An older ID after the text (`- [ ] Fix the parser #PROJ7`) is no item ID, but it still names its line:
  // the items whose text holds it as a `#` word, when no item has it as its ID, also once numbering gave the line a `#T` ID.
  // Only a `#` word of the reference, or a reference that is one ID and nothing else, names a tag: a bare word
  // of a description (`Fix the h264 decoder`) is text, and goes to the text match.
  const whole = new RegExp(`^#?(${ID_SRC})$`).exec(ref.trim())
  const tags = whole !== null ? [whole] : [...ref.matchAll(new RegExp(`#(${ID_SRC})\\b`, 'g'))]
  for (const word of tags) {
    const tag = new RegExp(`#${word[1]!}\\b`, 'i')
    // A word inside inline code is an example, never a tag, as it is never an item's own ID.
    const byTag = all.filter(one => tag.test(codeSpansOut(one.item.text)))
    if (byTag.length > 0) {
      return byTag
    }
  }
  const scored = all.map(one => ({ one, score: claimScore(ref, one.item) })).filter(x => x.score > 0)
  const best = Math.max(0, ...scored.map(x => x.score))

  return scored.filter(x => x.score === best).map(x => x.one)
}

/**
 * The matches in the one place `folder` names, exactly: a folder path as the prompts give it
 * (`mods/x/.claude_todo`, or the absolute one), or a file path in it (`mods/x/.claude_todo/TODO.md`).
 * No word search: a stray word in the reference never picks a folder.
 */
export function narrowTickets(hits: readonly Found[], folder: string): Found[] {
  const clean = folder.trim().replace(/^\.\//, '').replace(/\/+$/, '')

  return hits.filter(one => [one.rel, one.folder, `${one.rel}/${one.file}`, `${one.folder}/${one.file}`].includes(clean))
}
