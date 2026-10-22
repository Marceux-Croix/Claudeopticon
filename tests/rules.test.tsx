import { expect, test } from 'claude-code/testing'

import { RULES, RULES_BLOCK, withRules } from '../hooks/rules'
import { nextTicketIds } from '../hooks/ticket-ids'
import { CHECKBOX, parseTodo } from '../hooks/todo-markdown'

test('the rules tell Claude to report a title when it works on tickets itself', () => {
  expect(RULES).toContain('report_progress` with `title`')
})

test('the rules tell Claude to close finished work in the same turn', () => {
  expect(RULES).toContain('check it off (`- [x]`) in the same turn, before your final reply')
  expect(RULES).toContain('Never leave finished work open or in progress')
  expect(RULES).toContain('When an agent you started for an item finishes, check its result and close the item if the work is done')
})

/** Property (UCR-178): the rules say what the archive step does: only a done ticket whose subtasks are all done moves. */
test('UCR-178 the rules say a done ticket with an open subtask stays', () => {
  expect(RULES).toContain('moves each done ticket whose subtasks are all done')
  expect(RULES).toContain('a done ticket with an open subtask stays until that subtask is done')
  expect(RULES).not.toContain('moves each done ticket (with')
})

test('UCR-185 withRules adds the rules block once, and none when the option is off', () => {
  const plain = { blocks: [{ name: 'claudeMd', text: 'mine' }] }
  expect(withRules(plain, true).blocks).toEqual([{ name: 'claudeMd', text: 'mine' }, { name: RULES_BLOCK, text: RULES }])
  // State 1: a block of the mod's name is there already, after another block: nothing is added.
  const twice = { blocks: [{ name: 'claudeMd', text: 'mine' }, { name: RULES_BLOCK, text: 'kept' }] }
  expect(withRules(twice, true)).toBe(twice)
  // State 2: the option off, with and without the block.
  expect(withRules(plain, false)).toBe(plain)
  expect(withRules(twice, false)).toBe(twice)
  // State 3: a block whose name only starts like the mod's still gets the rules.
  expect(withRules({ blocks: [{ name: 'claudeopticon-old', text: 'x' }] }, true).blocks.map(block => block.name)).toEqual(['claudeopticon-old', RULES_BLOCK])
  // Run twice, the rules show once.
  expect(withRules(withRules(plain, true), true).blocks.filter(block => block.name === RULES_BLOCK).length).toBe(1)
})

test('UCR-190 the box forms the rules name are the ones the parser reads, and the forms they rule out are not items', () => {
  for (const [box, status] of [[' ', 'pending'], ['>', 'queued'], ['~', 'in_progress'], ['x', 'completed'], ['X', 'completed']] as const) {
    expect(RULES).toContain(`[${box}]`)
    expect(parseTodo(`- [${box}] a`)[0]?.status).toBe(status)
  }
  expect(RULES).toContain('one space after the dash')
  expect(RULES).toContain('A numbered line (`1. [ ] a`) or two spaces after the dash is not an item')
  expect(CHECKBOX.test('1. [ ] a')).toBe(false)
  expect(CHECKBOX.test('-  [ ] a')).toBe(false)
})

/**
 * Property (UCR-209): the rules tell Claude the ID forms the mod offers: 4 characters, and 5 when a 5-character ID is
 * in use (one `#T12345` tag gives `T12346` at once, batch M) or the 4-character ones run out.
 */
test('UCR-209 the rules allow the 5-character IDs the mod offers past T9ZZZ', () => {
  expect(RULES).toContain('the mod gives 5 (`#T10000`, `#T12346`) when a 5-character ID is in use or the 4-character ones run out')
  expect(RULES).not.toContain('used up')
  // The offer the rules describe: past T9ZZZ, or after one `#T1xxxx` tag (VALUE_END is T20000), the next ID has 5 characters.
  expect(nextTicketIds(['T9ZZZ'], 1)).toEqual(['T10000'])
  expect(nextTicketIds(['T0001', 'T12345'], 1)).toEqual(['T12346'])
})

/** Property (UCR-239): the rules forbid the global todo folder and send Claude to the nearest project folder when the repo root holds it. */
test('the rules tell Claude what queued means, when to queue a ticket, and that the mod queues a stopped one', () => {
  expect(RULES).toContain('`- [>]` queued')
  expect(RULES).toContain('Queued column')
  expect(RULES).toContain('set it to `[>]`, not `[ ]`')
  expect(RULES).not.toContain('`[>]` as in progress')
})

test('UCR-239 the rules never send Claude to the global todo folder', () => {
  const lines = RULES.split('\n')
  const rule = lines.find(line => line.includes('global todo folder'))
  expect(rule).toBeDefined()
  expect(rule).toContain('Never make or use the global todo folder, `~/.claude/.claude_todo/`')
  expect(rule).toContain('`$CLAUDE_CONFIG_DIR`')
  expect(rule).toContain("When the repo root is that folder's parent")
  expect(rule).toContain('use the nearest project folder instead')
  // The rule comes right after the root rule it makes an exception to, and the root rule is unchanged.
  const at = lines.indexOf(rule!)
  expect(lines[at - 1]).toBe("- Todo items go in `.claude_todo/` at the root of the repo's main checkout (a git worktree uses the main checkout's). Create the folder when the repo has none. Each repo keeps its own items, and only its own. Other `.claude_todo/` folders in the repo also show on the board: keep each item in the folder it is in.")
})

test('#T008R the rules tell Claude to send its session name once, as session, without the ref', () => {
  expect(RULES).toContain('as `session`')
  expect(RULES).toContain('This session is')
  expect(RULES).toContain('without the bracketed ref')
})

test('#T008U the rules tell Claude to release a ticket it queued for others, and to ask the owner of a claimed ticket first', () => {
  expect(RULES).toContain('release it: call `mcp__claudeopticon__report_progress` with `release`')
  expect(RULES).toContain('or only to order or triage the work')
  expect(RULES).toContain('ask that session with SendMessage before you take it')
  expect(RULES).toContain('call ListAgents and ask each other session')
  expect(RULES).toContain('When another session asks you for a ticket you claim and you agree, release it')
})
