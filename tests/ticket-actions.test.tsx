import { expect, test } from 'claude-code/testing'

import { DONE_ACTION, QUEUE_ACTION, REOPEN_ACTION, SEND_ACTION, START_ACTION, STATUS_ACTION, TICKET_GLYPHS } from '../hooks/ticket-actions'

test('send and status actions build a prompt that names the path and the item text', async () => {
  const send = SEND_ACTION.prompt('/repo/.claude_todo/A.md', '- [ ] #T0001 Fix x')
  expect(send).toContain('/repo/.claude_todo/A.md')
  expect(send).toContain('#T0001 Fix x')
  const status = STATUS_ACTION.prompt('/repo/.claude_todo/A.md', 'Fix x')
  expect(status).toContain('/repo/.claude_todo/A.md')
  expect(status).toContain('Fix x')
  expect(status).not.toBe(send)
  expect(SEND_ACTION.mark).toBeUndefined()
  expect(STATUS_ACTION.mark).toBeUndefined()
})

test('the manual moves write a box and ask Claude nothing', async () => {
  expect([QUEUE_ACTION.mark, START_ACTION.mark, DONE_ACTION.mark, REOPEN_ACTION.mark]).toEqual(['queued', 'in_progress', 'completed', 'pending'])
  for (const action of [QUEUE_ACTION, START_ACTION, DONE_ACTION, REOPEN_ACTION]) {
    expect(action.prompt('/repo/x.md', 'text')).toBe('')
  }
})

test('every action has a distinct name and glyph, and TICKET_GLYPHS holds exactly the six glyphs', async () => {
  const all = [SEND_ACTION, STATUS_ACTION, QUEUE_ACTION, START_ACTION, DONE_ACTION, REOPEN_ACTION]
  expect(new Set(all.map(a => a.name)).size).toBe(6)
  expect(TICKET_GLYPHS.size).toBe(6)
  for (const a of all) {
    expect(TICKET_GLYPHS.has(a.glyph)).toBe(true)
    expect(a.tip).not.toBe('')
    expect(a.toast).not.toBe('')
  }
  expect(TICKET_GLYPHS.has('x')).toBe(false)
})
