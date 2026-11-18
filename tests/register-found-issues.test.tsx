// Engine cases for the found-issues nudge.

import { expect, mock, test } from 'claude-code/testing'

import { mtimes, repoWith, open, sleep, clearMtimes, type TestApi, type OnApi } from './fake-repo'

// ----------------------------------------------------------------
// Property: through the engine, a turn that ends with a ticket it made still open gets one nudge
// prompt naming it; a ticket with a marker, or one made before the prompt, gets none.

/** Every prompt text the engine sees, the mod's own nudges included. */
function promptTexts(on: OnApi): string[] {
  const texts: string[] = []
  on('prompt.submit', (_$, e) => {
    texts.push(e.text)

    return { text: e.text, context: e.context }
  })

  return texts
}

async function turnWith($: TestApi, on: OnApi, line: string): Promise<string[]> {
  clearMtimes()
  mock.clock(on)
  const T = '/repo/.claude_todo/TODO.md'
  const files: Record<string, string> = { [T]: '- [ ] #T0001 old open item' }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'] })
  const texts = promptTexts(on)
  // The turn's own end below the mod: without an answer there, the mod's turn.complete hook gets no result.
  on('turn.complete', () => ({ text: '' }) as never)
  await open($)
  await $.prompt.submit({ text: 'fix the parser', asUser: true } as never)
  // The snapshot scan runs after the prompt, not awaited; the model's first edit comes well after it.
  await sleep(20)
  files[T] = `- [ ] #T0001 old open item\n${line}`
  mtimes[T] = 9
  await $.turn.complete({ reason: 'answer', turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never).catch(() => undefined)
  await sleep(30)

  return texts.filter(text => text.startsWith('Found-issues rule:'))
}

test('a turn that ends with a new open ticket gets one nudge prompt that names it', async ($, on) => {
  const nudges = await turnWith($, on, '- [ ] #T0002 new item')
  expect(nudges).toHaveLength(1)
  expect(nudges[0]).toContain('#T0002')
  expect(nudges[0]).not.toContain('#T0001')
})

for (const line of ['- [ ] #T0002 new item (blocked: needs X)', '- [ ] #T0002 new item (noted: not modular)', '- [x] #T0002 new item', '- [~] #T0002 new item (agent a1, due 12:00 UTC)']) {
  test(`no nudge for ${JSON.stringify(line)}`, async ($, on) => {
    expect(await turnWith($, on, line)).toEqual([])
  })
}

// ----------------------------------------------------------------, (review B, F1 to F3)

/** A fake repo with two old open tickets, a prompt hook that records prompt texts, and an answer below the turn end. */
function quietRepo($: TestApi, on: OnApi, log?: string[]) {
  clearMtimes()
  mock.clock(on)
  const T = '/repo/.claude_todo/TODO.md'
  const OLD = '- [ ] #T0001 old open item\n- [ ] #T0002 another old item'
  const files: Record<string, string> = { [T]: OLD }
  repoWith(on, files, { hasNearest: true, listed: ['.claude_todo/TODO.md'], ...(log === undefined ? {} : { log }) })
  const texts = promptTexts(on)
  on('turn.complete', () => ({ text: '' }) as never)

  return { T, OLD, files, nudges: () => texts.filter(text => text.startsWith('Found-issues rule:')) }
}

const answerEnd = ($: TestApi, extra: object = {}) =>
  $.turn.complete({ reason: 'answer', turnId: 't1', answer: '', durationMs: 1, isAborted: false, ...extra } as never).catch(() => undefined)

test('a first prompt before any scan (a reload) names no ticket that was on disk before it', async ($, on) => {
  const repo = quietRepo($, on)
  await $.prompt.submit({ text: 'fix the parser', asUser: true } as never)
  // The snapshot scan runs after the prompt, not awaited; the model's first edit comes well after it.
  await sleep(20)
  await answerEnd($)
  await sleep(30)
  expect(repo.nudges()).toEqual([])
})

test('a ticket written after the last scan tick and before the prompt is not made in the turn', async ($, on) => {
  const repo = quietRepo($, on)
  await open($)
  repo.files[repo.T] = `${repo.OLD}\n- [ ] #T0003 typed before the prompt`
  mtimes[repo.T] = 9
  await $.prompt.submit({ text: 'fix the parser', asUser: true } as never)
  // The snapshot scan runs after the prompt, not awaited; the model's first edit comes well after it.
  await sleep(20)
  await answerEnd($)
  await sleep(30)
  expect(repo.nudges()).toEqual([])
})

test('the fix keeps the rule: a ticket made after the prompt is still named', async ($, on) => {
  const repo = quietRepo($, on)
  await $.prompt.submit({ text: 'fix the parser', asUser: true } as never)
  // The snapshot scan runs after the prompt, not awaited; the model's first edit comes well after it.
  await sleep(20)
  repo.files[repo.T] = `${repo.OLD}\n- [ ] #T0004 made in the turn`
  mtimes[repo.T] = 9
  await answerEnd($)
  await sleep(30)
  expect(repo.nudges()).toHaveLength(1)
  expect(repo.nudges()[0]).toContain('#T0004')
  expect(repo.nudges()[0]).not.toContain('#T0001')
})

test('an aborted, an error and a refusal turn end read no todo file', async ($, on) => {
  const log: string[] = []
  quietRepo($, on, log)
  await open($)
  await $.prompt.submit({ text: 'go', asUser: true } as never)
  await sleep(20)
  const reads = () => log.filter(entry => entry.startsWith('read:')).length
  const before = reads()
  for (const reason of ['aborted', 'error', 'refusal']) {
    await answerEnd($, { reason, isAborted: reason === 'aborted' })
  }
  expect(reads() - before).toBe(0)
})
