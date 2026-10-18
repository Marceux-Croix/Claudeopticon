import { expect, test } from 'claude-code/testing'

import { tryWriteLock, withWriteLock } from '../hooks/write-lock'

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

test('writers run one after another, in call order, never overlapping', async () => {
  const log: string[] = []
  const job = (name: string, ms: number) => async () => {
    log.push(`start ${name}`)
    await new Promise(resolve => setTimeout(resolve, ms))
    log.push(`end ${name}`)

    return name
  }
  const results = await Promise.all([withWriteLock(job('a', 20)), withWriteLock(job('b', 1)), withWriteLock(job('c', 1))])
  expect(results).toEqual(['a', 'b', 'c'])
  expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
})

test('a failed job rejects its caller but does not break the chain', async () => {
  const bad = withWriteLock(async () => {
    throw new Error('boom')
  })
  const good = withWriteLock(async () => 'ok')
  let message = ''
  try {
    await bad
  } catch (error) {
    message = (error as Error).message
  }
  expect(message).toBe('boom')
  expect(await good).toBe('ok')
  expect(await withWriteLock(async () => 'later')).toBe('later')
})

test('tryWriteLock runs when the lock is free and skips while a writer holds it', async () => {
  expect(await tryWriteLock(async () => 'free')).toBe('free')
  let release: () => void = () => undefined
  const held = withWriteLock(() => new Promise<void>(resolve => { release = resolve }))
  // The job starts on a later microtask; wait until it has set `release`.
  await tick()
  let ran = false
  expect(await tryWriteLock(async () => { ran = true; return 'x' })).toBeUndefined()
  expect(ran).toBe(false)
  release()
  await held
  await tick()
  expect(await tryWriteLock(async () => 'again')).toBe('again')
})

// ---------------------------------------------------------------- UCR-067

test('UCR-067 tryWriteLock skips while any writer holds or waits for the lock, and runs once it is free', async () => {
  let release = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const ran: string[] = []
  // State 1: one writer runs.
  const first = withWriteLock(async () => {
    await held
    ran.push('first')
  })
  expect(await tryWriteLock(async () => ran.push('scan 1'))).toBeUndefined()
  // State 2: a second writer waits behind the first.
  const second = withWriteLock(async () => {
    ran.push('second')
  })
  expect(await tryWriteLock(async () => ran.push('scan 2'))).toBeUndefined()
  release()
  await first
  // State 3: the first is done, the second may still be counted until its turn ends.
  await second
  await Promise.resolve()
  expect(await tryWriteLock(async () => 'scan 3')).toBe('scan 3')
  expect(ran).toEqual(['first', 'second'])
})
