import { expect, test } from 'claude-code/testing'

import { findTickets, narrowTickets } from '../hooks/ticket-lookup'
import { moveQuestion } from '../hooks/ticket-prompts'
import { parseTodo } from '../hooks/todo-markdown'
import type { TodoFile } from '../types'

/** The pick move_ticket makes: the first match, in the folder when one is given. */
const findTicket = (list: readonly TodoFile[], ref: string, folder?: string) => (folder === undefined ? findTickets(list, ref) : narrowTickets(findTickets(list, ref), folder))[0]

test('findTicket finds a live item by ID first, else by its quoted text, and never in the archive', async () => {
  const list: TodoFile[] = [
    { name: 'A.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] #T1 Review the terms of service\n- [ ] Ship the new parser and roll back') },
    { name: 'archive/B.md', folder: '.claude_todo', mtimeMs: 1, items: parseTodo('- [x] #T9 Old thing'), isArchived: true },
  ]
  expect(findTicket(list, '#T1')?.item.text).toBe('#T1 Review the terms of service')
  expect(findTicket(list, 't1')?.file).toBe('A.md')
  expect(findTicket(list, 'Ship the new parser and roll back')?.item.status).toBe('pending')
  expect(findTicket(list, '#T9')).toBeUndefined()
  expect(findTicket(list, 'nothing like it')).toBeUndefined()
  const question = moveQuestion('.claude_todo/A.md', list[0]!.items[0]!, 'in_progress', 'The review is not finished.', true)
  expect(question).toContain('from done to in progress')
  expect(question).toContain('You moved it by hand.')
  expect(question.endsWith('?')).toBe(true)
})

test('a folder input picks a move_ticket target exactly, never by a word in the reference', async () => {
  const mk = (folder: string, rel: string, name: string, text: string): TodoFile => ({ name, folder, rel, mtimeMs: 1, items: parseTodo(text) })
  const list = [
    mk('/r/a/.claude_todo', 'a/.claude_todo', 'TODO.md', '- [ ] #T1 First'),
    mk('/r/b/.claude_todo', 'b/.claude_todo', 'TODO.md', '- [ ] #T1 Second'),
    mk('/r/b/.claude_todo', 'b/.claude_todo', 'MORE.md', '- [ ] #T1 Third'),
  ]
  const hits = findTickets(list, 'mark #T1 as done')
  expect(hits.length).toBe(3)
  expect(narrowTickets(hits, 'a').length).toBe(0)
  expect(narrowTickets(hits, 'a/.claude_todo').map(one => one.item.text)).toEqual(['#T1 First'])
  expect(narrowTickets(hits, 'b/.claude_todo/MORE.md').map(one => one.item.text)).toEqual(['#T1 Third'])
  expect(narrowTickets(hits, '/r/b/.claude_todo/').length).toBe(2)
  expect(findTicket(list, '#T1', 'b/.claude_todo/TODO.md')?.item.text).toBe('#T1 Second')
})

test('a reference finds an ID with letters in it', () => {
  const list = [{ name: 'A.md', folder: '/repo/.claude_todo', mtimeMs: 1, items: parseTodo(['- [ ] #T002A Alpha', '- [ ] #T0005 Beta', '- [ ] #T2 Gamma'].join('\n')) }]
  expect(findTickets(list, '#T002A').map(one => one.item.text)).toEqual(['#T002A Alpha'])
  expect(findTickets(list, 'mark t002a done').map(one => one.item.text)).toEqual(['#T002A Alpha'])
  // The all-digit forms and a word that looks like an ID but names nothing.
  expect(findTickets(list, 'move utf8 item #T2').map(one => one.item.text)).toEqual(['#T2 Gamma'])
  expect(findTickets(list, 'T0005').map(one => one.item.text)).toEqual(['#T0005 Beta'])
})

// ---------------------------------------------------------------- 

test('an older ID after the text is no item ID, but a reference to it still finds its line', () => {
  const mk = (text: string): TodoFile[] => [{ name: 'A.md', folder: '/repo/.claude_todo', mtimeMs: 1, items: parseTodo(text) }]
  // Before numbering: the line has no ID, and #PROJ7 names it.
  const before = mk('- [ ] #T0001 Other\n- [ ] Fix the parser #PROJ7')
  expect(before[0]!.items.map(item => item.id)).toEqual(['T0001', undefined])
  expect(findTickets(before, 'mark #PROJ7 done').map(one => one.item.text)).toEqual(['Fix the parser #PROJ7'])
  // After numbering gave it a leading #T ID, and in another case.
  const after = mk('- [ ] #T0001 Other\n- [ ] #T0002 Fix the parser #PROJ7')
  expect(findTickets(after, 'proj7').map(one => one.item.text)).toEqual(['#T0002 Fix the parser #PROJ7'])
  // An item whose own ID it is still wins over a line that only names it.
  expect(findTickets(mk('- [ ] #PROJ7 Lead\n- [ ] see #PROJ7'), '#PROJ7').map(one => one.item.text)).toEqual(['#PROJ7 Lead'])
})

// ---------------------------------------------------------------- 

/**
 * Property: a bare word of a description never picks a ticket by a `#` tag in its text; only a `#`
 * word of the reference, or a reference that is one ID and nothing else, names a tag.
 */
test('the tag fallback needs the # form or a whole-ID reference: a bare word goes to the text match', () => {
  const list: TodoFile[] = [{ name: 'T.md', folder: '/r/.claude_todo', mtimeMs: 1, items: parseTodo('- [ ] #T0008 Fix the parser #PROJ7\n- [ ] #T0009 Port the encoder #h264\n- [ ] #T0010 Decoder for h264 streams') }]
  const texts = (ref: string) => findTickets(list, ref).map(one => one.item.text)
  // The state: a bare word in the middle of a description. It shares too few words with T0010 for a text
  // match, so nothing is found: never the #h264 line by its tag.
  expect(texts('Fix the h264 decoder streams')).toEqual([])
  // At the limits of the reference: the bare word first, and last.
  expect(texts('h264 decoder streams')).toEqual(['#T0010 Decoder for h264 streams'])
  expect(texts('the decoder streams for h264')).toEqual(['#T0010 Decoder for h264 streams'])
  // The population that still names a tag: the # form anywhere, and a reference that is the ID alone, in any case.
  expect(texts('the encoder #h264')).toEqual(['#T0009 Port the encoder #h264'])
  expect(texts('h264')).toEqual(['#T0009 Port the encoder #h264'])
  expect(texts('proj7')).toEqual(['#T0008 Fix the parser #PROJ7'])
  expect(texts(' #PROJ7 ')).toEqual(['#T0008 Fix the parser #PROJ7'])
})

// ---------------------------------------------------------------- remainder

/** Property: the ID lookup follows the # rule too: a short or other-letter bare word of a description never picks a ticket by ID. */
test('a bare short ID word in a description is text: "Update the T2 dashboard" goes to the text match', () => {
  const list: TodoFile[] = [{ name: 'A.md', folder: '/r/.claude_todo', mtimeMs: 0, items: parseTodo('- [ ] #T0004 Update the dashboard\n- [ ] #T0009 Fix the decoder #h264\n- [ ] #T2 Old') }]
  const ids = (ref: string) => findTickets(list, ref).map(one => one.item.id)
  // The P109 state.
  expect(ids('Update the T2 dashboard')).toEqual(['T0004'])
  // At the limits of the reference: the bare short word first, and last.
  expect(ids('T2 update the dashboard')).toEqual(['T0004'])
  expect(ids('update the dashboard t2')).toEqual(['T0004'])
  // The excluded population: the # form anywhere, a reference that is the ID alone, and the mod's own form bare.
  expect(ids('Update the #T2 dashboard')).toEqual(['T2'])
  expect(ids('T2')).toEqual(['T2'])
  expect(ids('mark t0009 done')).toEqual(['T0009'])
})

/** Property: an ID inside inline code names no ticket, by ID or as a tag. */
test('a lookup of an ID that a line holds only in inline code does not find that line', () => {
  // The state: a documentation line and an unrelated one.
  const list: TodoFile[] = [{ name: 'TODO.md', folder: '/r', mtimeMs: 1, items: parseTodo('- [ ] Explain the `#T002B` form in the README\n- [ ] Fix the cache') }]
  const texts = (ref: string) => findTickets(list, ref).map(one => one.item.text)
  expect(texts('#T002B')).toEqual([])
  // Behind a valid first case: the real ticket with that ID is found, the documentation line is not.
  const both: TodoFile[] = [{ name: 'TODO.md', folder: '/r', mtimeMs: 1, items: parseTodo('- [ ] Explain the `#T002B` form\n- [ ] #T002B Fix the parser') }]
  expect(findTickets(both, '#T002B').map(one => one.item.text)).toEqual(['#T002B Fix the parser'])
  // At the limit: an old-form tag in code at the end of the line is no tag either; outside code it still is.
  const tags: TodoFile[] = [{ name: 'TODO.md', folder: '/r', mtimeMs: 1, items: parseTodo('- [ ] Explain `#PROJ7`\n- [ ] Fix the parser #PROJ8') }]
  expect(findTickets(tags, '#PROJ7').map(one => one.item.text)).toEqual([])
  expect(findTickets(tags, '#PROJ8').map(one => one.item.text)).toEqual(['Fix the parser #PROJ8'])
})
