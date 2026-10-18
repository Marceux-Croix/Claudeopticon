import { expect, test } from 'claude-code/testing'

import { cutReturnSlots, forgottenCut, isOldSessionList, KEPT_AGENTS, KEPT_SESSIONS, liveSessionIds, MAX_BASE, nextDropping, nextSessions, readDropping, readKeptAgents, readKeptBase, readKeptBlocks, readKeptCut, SESSION_DROP_CONFIRM_MS, SESSION_LIVE_MS, SESSION_TOUCH_MS, STORED_BRIEF, storedBrief } from '../hooks/kept-records'
import { readKeptUsage } from '../hooks/token-usage'

const ROW = { id: 'old', description: 'Old work', type: 'engineer', status: 'completed', startedAt: 0, toolCalls: 3, brief: 'old work' }

// ---------------------------------------------------------------- UCR-037

test('UCR-037 a stored row with bad fields is repaired or dropped, never kept as it is', () => {
  const rows = readKeptAgents([
    { ...ROW, id: 'claims', claims: 'not a list' },
    { ...ROW, id: 'progress', progress: { done: 'x', total: NaN } },
    { ...ROW, id: 'tokens', tokens: 'many' },
    { ...ROW, id: 'calls', toolCalls: Infinity },
    { ...ROW, id: 'status', status: 'weird' },
    { ...ROW, id: 'auto', autoClaims: [1, 'ok'] },
    { ...ROW, id: 'start', startedAt: NaN },
    { ...ROW, id: 'ended', endedAt: 'late', idleSince: {} },
    null,
    'text',
    { ...ROW, id: '' },
  ])
  expect(rows.map(row => row.id)).toEqual(['claims', 'progress', 'tokens', 'calls', 'status', 'auto', 'ended'])
  const by = (id: string) => rows.find(row => row.id === id)!
  expect(by('claims').claims).toBeUndefined()
  expect(by('progress').progress).toBeUndefined()
  expect(by('tokens').tokens).toBeUndefined()
  expect(by('calls').toolCalls).toBe(0)
  expect(by('status').status).toBe('ended')
  expect(by('auto').autoClaims).toEqual(['ok'])
  expect(by('ended').endedAt).toBeUndefined()
  expect(by('ended').idleSince).toBeUndefined()
  expect(readKeptUsage({ tokens: 'x', since: 1 })).toBeUndefined()
  expect(readKeptUsage({ tokens: Infinity, since: 1 })).toBeUndefined()
  expect(readKeptUsage({ tokens: 5, since: 1, atCompact: 'z' })).toEqual({ tokens: 5, since: 1 })
})

// ---------------------------------------------------------------- UCR-084

test('UCR-084 the kept count reads back when its compaction happened, so a load can mark it', () => {
  expect(readKeptUsage({ tokens: 5, since: 1, atCompact: 2, compactAt: 1000 })).toEqual({ tokens: 5, since: 1, atCompact: 2, compactAt: 1000 })
  expect(readKeptUsage({ tokens: 5, since: 1, atCompact: 2, compactAt: 'soon' })).toEqual({ tokens: 5, since: 1, atCompact: 2 })
  expect(readKeptUsage({ tokens: 5, since: 1, compactAt: Infinity })).toEqual({ tokens: 5, since: 1 })
})

// ---------------------------------------------------------------- UCR-078

/** Property: a stored label base is a whole number in range, and a stored row ID appears once. */
test('UCR-078 a stored base out of range and repeated row IDs are not taken as they are, in three constructed states', () => {
  // A valid value first, then the defects: too large (the A1e+300 label), negative, fractional, not finite.
  expect(readKeptBase(30)).toBe(30)
  expect(readKeptBase(1e300)).toBe(0)
  expect(readKeptBase(MAX_BASE)).toBe(MAX_BASE)
  expect(readKeptBase(MAX_BASE + 1)).toBe(0)
  expect(readKeptBase(-1)).toBe(0)
  expect(readKeptBase(2.5)).toBe(0)
  expect(readKeptBase(NaN)).toBe(0)
  expect(readKeptBase('30')).toBe(0)
  // Repeats behind a valid first row, at the end of the list, and of the first row itself: one row each, in its first place.
  const rows = readKeptAgents([{ ...ROW, id: 'a' }, { ...ROW, id: 'b' }, { ...ROW, id: 'a', toolCalls: 9 }, { ...ROW, id: 'c' }, { ...ROW, id: 'c' }])
  expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
  expect(rows[0]!.toolCalls).toBe(3)
  expect(readKeptCut(['x', 7, '', 'y'])).toEqual(['x', 'y'])
  expect(readKeptBlocks([['a'], 'no', [1], null])).toEqual([['a']])
  expect(readKeptBlocks(null)).toEqual([])
})

// ---------------------------------------------------------------- UCR-077

/** Property: a session that noted itself within SESSION_LIVE_MS is never pruned, however many sessions start after it. */
test('UCR-077 a live session stays in the list when 20 or more sessions start after it, in three constructed states', () => {
  const now = 10 * SESSION_LIVE_MS
  const others = Array.from({ length: KEPT_SESSIONS + 3 }, (_, i) => `n${i}`)
  const seen: Record<string, number> = Object.fromEntries(others.map(id => [id, now]))
  // The live session is first in the list, behind nothing; it noted itself a minute ago.
  // The older form: plain IDs, their times in the old seen map (the new form is in the UCR-077 one-key tests below).
  let next = nextSessions(['live', ...others], { ...seen, live: now - 60_000 }, 'me', now)
  expect(next.dropped).not.toContain('live')
  expect(next.list.map(([id]) => id)).toContain('live')
  // At the limit: noted exactly SESSION_LIVE_MS ago it is old; just inside, it is live.
  next = nextSessions(['live', ...others], { ...seen, live: now - SESSION_LIVE_MS }, 'me', now)
  expect(next.dropped).toContain('live')
  next = nextSessions(['live', ...others], { ...seen, live: now - SESSION_LIVE_MS + 1 }, 'me', now)
  expect(next.dropped).not.toContain('live')
  // The excluded population: a session with no time (older code) or an old time past the last 20 is dropped as before.
  next = nextSessions(['old', 'stale', ...others], { ...seen, stale: 0 }, 'me', now)
  expect(next.dropped).toEqual(['old', 'stale'])
  // Batch H4: the list holds the times itself (UCR-077), so the old `seen` result is now the time in each entry.
  expect(next.list[next.list.length - 1]).toEqual(['me', now])
  expect(next.list.some(([id]) => id === 'old')).toBe(false)
})

// ---------------------------------------------------------------- UCR-029, loop 1 narrowing

test('UCR-029 the stored brief never passes STORED_BRIEF characters, the kept IDs included', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `#t${String(i).padStart(4, '0')}`).join(' ')
  // State 1: a full head and a tail of many IDs (the old cut kept the head and added every ID).
  const many = storedBrief(`${'x '.repeat(400)}${ids(200)}`)
  expect(many.length).toBeLessThanOrEqual(STORED_BRIEF)
  expect(many).toContain('#t0000')
  // State 2: one character past the cap, with an ID across the cut.
  const edge = storedBrief(`${'y'.repeat(STORED_BRIEF - 3)} #t0042`)
  expect(edge.length).toBeLessThanOrEqual(STORED_BRIEF)
  expect(edge).toContain('#t0042')
  // State 3: IDs the head gives way to: an ID the shrinking head drops joins the kept ones.
  const pushed = storedBrief(`${'z'.repeat(400)} #t0777 ${'z'.repeat(150)} ${ids(60)}`)
  expect(pushed.length).toBeLessThanOrEqual(STORED_BRIEF)
  expect(pushed).toContain('#t0777')
  // A long #word is not an ID, and a short brief stays as it is.
  expect(storedBrief(`${'w '.repeat(400)}#t${'a'.repeat(40)}`)).not.toContain('#taaaa')
  expect(storedBrief('short')).toBe('short')
})

test('UCR-029 the stored brief holds no secret: in a short brief, across the cut, and in the IDs part', () => {
  // State 1: a short brief, which the old code stored as it was.
  expect(storedBrief('fix #t1 with pgpassword=hunter2 psql')).toBe('(hidden) #t1')
  // State 2: a secret across the cut at STORED_BRIEF.
  const across = storedBrief(`${'a '.repeat(295)}export db_pwd=hunter2 #t9`)
  expect(across).not.toContain('hunter')
  expect(across).toContain('#t9')
  // State 3: a brief already normalized (one line, lower case), as the store keeps it.
  expect(storedBrief('run curl -u admin:hunter2 https://x.test for #t0037')).toBe('(hidden) #t0037')
  expect(storedBrief('ship the parser #t2')).toBe('ship the parser #t2')
})

// ---------------------------------------------------------------- UCR-077, batch H4: the times in the list

const MIN = 60_000

/**
 * Property (UCR-077): a live session in the newest part of the list is never dropped, whether or not
 * it has a time. The list holds each time itself, so one write stores both, and two notes that race
 * can lose an entry but never leave one without its time. Ported from the verifier's V77-B (a race
 * between the two keys) and V77-C (a failed second write), which leave a session listed with no time.
 * Three states: a session with no time at the newest end (behind valid entries), one at the limit
 * of the newest part (the oldest of the last KEPT_SESSIONS), and (excluded) one with no time past
 * the newest part, which falls off as before.
 */
test('UCR-077 a session with no time in the newest part of the list is kept and given a time, in three constructed states', () => {
  const t0 = 1000 * MIN
  const others = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`)
  const seen = (ids: readonly string[], at: number) => Object.fromEntries(ids.map(id => [id, at]))
  // V77-B and V77-C leave C in the old list with no time, at its newest end.
  const ids = others(200)
  let list: unknown = [...ids, 'C']
  let next = nextSessions(list, seen(ids, t0), 's0', t0 + 1)
  expect(next.dropped).not.toContain('C')
  expect(next.list.find(([id]) => id === 'C')).toEqual(['C', t0 + 1])
  // 25 notes in the next 75 s (200 sessions at a 10 min interval note every 3 s): C keeps its time.
  list = next.list
  const drops: string[] = []
  for (let k = 1; k <= 25; k += 1) {
    next = nextSessions(list, undefined, `s${k}`, t0 + k * 3000)
    list = next.list
    drops.push(...next.dropped)
  }
  expect(drops).not.toContain('C')
  // At the limit: C is the oldest of the last KEPT_SESSIONS once `me` joins: kept, and given the time.
  const near = others(KEPT_SESSIONS - 2)
  next = nextSessions(['C', ...near], seen(near, t0), 'me', t0)
  expect(next.dropped).toEqual([])
  expect(next.list[0]).toEqual(['C', t0])
  // Excluded: one place further, past the newest part, a session with no time falls off.
  const far = others(KEPT_SESSIONS - 1)
  next = nextSessions(['C', ...far], seen(far, t0), 'me', t0)
  expect(next.dropped).toEqual(['C'])
})

test('UCR-077 one write holds the times: a race that loses an entry drops nothing, and the next note lists it again', () => {
  const t0 = 1000 * MIN
  let list: unknown = []
  for (let i = 0; i < 200; i += 1) {
    list = nextSessions(list, undefined, `s${i}`, t0 + i * 3000).list
  }
  // C and A read the same list; C writes, then A writes over it from its own read: C is not in the list.
  const read = list
  nextSessions(read, undefined, 'C', t0 + 600_000)
  const a = nextSessions(read, undefined, 's0', t0 + 600_001)
  expect(a.dropped).toEqual([])
  expect(a.list.some(([id]) => id === 'C')).toBe(false)
  // A session not in the list is never among the dropped, so its keys stay; its next note adds it again.
  const back = nextSessions(a.list, undefined, 'C', t0 + 600_000 + SESSION_TOUCH_MS)
  expect(back.isListed).toBe(false)
  expect(back.list[back.list.length - 1]).toEqual(['C', t0 + 600_000 + SESSION_TOUCH_MS])
  // A list in the new form needs no old times; a list with a plain ID does.
  expect(isOldSessionList(a.list)).toBe(false)
  expect(isOldSessionList(['x', ['y', 1]])).toBe(true)
})

test('UCR-077 200 live sessions noting one at a time for 24 hours drop nobody (the verifier V77-A)', () => {
  let list: unknown = []
  const dropped: string[] = []
  const step = SESSION_TOUCH_MS / 200
  for (let t = 0; t < 24 * 60 * MIN; t += step) {
    const next = nextSessions(list, undefined, `s${Math.round(t / step) % 200}`, t)
    list = next.list
    dropped.push(...next.dropped)
  }
  expect(dropped).toEqual([])
  expect((list as unknown[]).length).toBe(200)
})

// ---------------------------------------------------------------- UCR-114 (a): live cut rows

/**
 * Property (UCR-114): a cut row still live comes back, but never by pushing out another live row.
 * Three states: a full window whose oldest row ended (one slot), a full window whose oldest row is
 * live (no slot, at the limit), and a window with free places.
 */
test('UCR-114 a live cut row comes back only in a free place or in the place of an ended row', () => {
  const rows = (statuses: readonly ('running' | 'completed')[]) => statuses.map(status => ({ status }))
  const full = (head: readonly ('running' | 'completed')[]) => rows([...head, ...Array.from({ length: KEPT_AGENTS - head.length }, () => 'running' as const)])
  expect(cutReturnSlots(full(['completed']))).toBe(1)
  expect(cutReturnSlots(full(['completed', 'completed', 'running', 'completed']))).toBe(2)
  expect(cutReturnSlots(full(['running', 'completed']))).toBe(0)
  expect(cutReturnSlots(rows(['running', 'running']))).toBe(KEPT_AGENTS - 2)
})

// ---------------------------------------------------------------- UCR-029 (batch H5): old rows cleaned on load

test('UCR-029 a row stored by an older version is cleaned on load: its current call, description and brief', () => {
  const [row] = readKeptAgents([
    {
      ...ROW,
      // The verifier's old row: each field held a secret the old code never checked.
      doing: 'Bash: curl --password Hunter2xyz u',
      description: 'Login PGPASSWORD=Hunter2xyz #T0037',
      // normalize took out the `_` of mysql_pwd, so only the check of the normalized form sees it.
      brief: 'fix #t0037 with mysqlpwd=hunter2xyz',
    },
  ])
  expect(row!.doing).toBe('Bash: (hidden)')
  expect(row!.description).toBe('(hidden) #T0037')
  expect(row!.brief).toBe('(hidden) #t0037')
  expect(JSON.stringify(row)).not.toMatch(/hunter2/i)
})

test('UCR-029 the stored brief hides an old secret behind a valid head, at the cut, and in a name normalize changed', () => {
  // State 1: a valid head, then a secret whose `_` normalize took out.
  expect(storedBrief('ship the parser #t1 then export dbpass=hunter2xyz')).toBe('(hidden) #t1')
  // State 2: the secret at the end of the 600 characters kept.
  const edge = storedBrief(`${'a '.repeat(290)}#t2 mysqlpwd=hunter2xyz`)
  expect(edge).not.toContain('hunter2')
  expect(edge).toContain('#t2')
  // State 3: inside the words the normalized check shows (a word that only ends like a short name), a secret still counts.
  expect(storedBrief('bypass=1 #t3')).toBe('bypass=1 #t3')
  expect(storedBrief('bypass=1 sshkey=abc #t3')).toBe('(hidden) #t3')
  // A clean row keeps its text.
  const clean = readKeptAgents([{ ...ROW, doing: 'Bash: npm test' }])[0]!
  expect([clean.doing, clean.description, clean.brief]).toEqual(['Bash: npm test', 'Old work', 'old work'])
})

// ---------------------------------------------------------------- UCR-122, UCR-123 (I4)

/**
 * Property (UCR-122): the agents new in a refresh take places before a cut row returns. Three states:
 * a full window with an ended oldest row and one new agent (the ended place is the new agent's, no
 * return), a window with exactly one free place and one new agent (the limit: no return), and (the
 * population the count excludes) no new agent, where the return keeps its slot.
 */
test('UCR-122 a returning cut row never takes the place a new agent needs', () => {
  const rows = (statuses: readonly ('running' | 'completed')[]) => statuses.map(status => ({ status }))
  const full = (head: readonly ('running' | 'completed')[]) => rows([...head, ...Array.from({ length: KEPT_AGENTS - head.length }, () => 'running' as const)])
  expect(cutReturnSlots(full(['completed']), 1)).toBe(0)
  expect(cutReturnSlots(full(['completed', 'completed']), 1)).toBe(1)
  expect(cutReturnSlots(rows(Array.from({ length: KEPT_AGENTS - 1 }, () => 'running' as const)), 1)).toBe(0)
  expect(cutReturnSlots(rows(Array.from({ length: KEPT_AGENTS - 1 }, () => 'running' as const)), 0)).toBe(1)
  expect(cutReturnSlots(full(['completed']))).toBe(1)
  expect(cutReturnSlots(full(['running']), 5)).toBe(0)
})

/**
 * Property (UCR-123): a time in the future counts as now, so the entry ages out. Three states: a
 * future entry far past the last KEPT_SESSIONS (dropped once SESSION_LIVE_MS passes), the same entry
 * just inside the limit (kept), and (the excluded population) a past entry, whose own time stays.
 */
test('UCR-123 a session time in the future is treated as now and ages out', () => {
  const now = 10 * SESSION_LIVE_MS
  const others = Array.from({ length: KEPT_SESSIONS + 2 }, (_, i): [string, number] => [`n${i}`, now])
  const future = nextSessions([['F', now + 9e12], ...others], undefined, 'me', now)
  expect(future.dropped).not.toContain('F')
  expect(future.list.find(([id]) => id === 'F')![1]).toBe(now)
  // Written as now, it is old after SESSION_LIVE_MS, and then it falls off.
  const later = nextSessions(future.list, undefined, 'me', now + SESSION_LIVE_MS)
  expect(later.dropped).toContain('F')
  const edge = nextSessions(future.list, undefined, 'me', now + SESSION_LIVE_MS - 1)
  expect(edge.dropped).not.toContain('F')
  const past = nextSessions([['P', now - 5], ...others], undefined, 'me', now)
  expect(past.list.find(([id]) => id === 'P')![1]).toBe(now - 5)
})

/** Property (UCR-123): the ID of a session whose note in the stored list is recent is live; a stale or malformed entry is not. */
test('UCR-123 liveSessionIds names the sessions whose note is inside SESSION_LIVE_MS', () => {
  const now = 10 * SESSION_LIVE_MS
  const live = liveSessionIds([['A', now - SESSION_LIVE_MS + 1], ['B', now - SESSION_LIVE_MS], ['C', now + 1e9], ['D', Number.NaN], 'E', ['F']], now)
  expect([...live].sort()).toEqual(['A', 'C'])
  expect(liveSessionIds(undefined, now).size).toBe(0)
})

// ---------------------------------------------------------------- UCR-124, UCR-134 (J4)

/** Property: a row stored by an older version shows no secret in its step, claims or name once loaded. */
test('UCR-124 UCR-134 a stored step, claim or name with a secret is hidden on load, in three states', () => {
  const [clean, secret, edge] = readKeptAgents([
    // Behind a valid first case: clean values load as they are.
    { ...ROW, id: 'clean', name: 'parser', progress: { done: 1, total: 2, step: 'Run tests' }, claims: ['#T0037'] },
    // The secret in each field.
    { ...ROW, id: 'secret', name: 'PGPASSWORD=Hunter2xyz', progress: { done: 1, total: 2, step: 'export DB_PASSWORD=Hunter2xyz' }, claims: ['#T2', 'psql postgres://admin:Hunter2xyz@db/x #T0037'] },
    // At the limit: the secret on the last line of a multi-line step, after a clean line.
    { ...ROW, id: 'edge', progress: { done: 0, total: 1, step: 'Deploy\nexport DB_PASSWORD=Hunter2xyz' } },
  ])
  expect(clean).toMatchObject({ name: 'parser', progress: { step: 'Run tests' }, claims: ['#T0037'] })
  expect(secret).toMatchObject({ name: '(hidden)', progress: { step: '(hidden)' }, claims: ['#T2', '(hidden) #T0037'] })
  expect(edge?.progress?.step).toBe('Deploy\n(hidden)')
  expect(JSON.stringify([clean, secret, edge])).not.toMatch(/hunter2/i)
})

// ---------------------------------------------------------------- UCR-129 (J4)

/** Property: an ended listed agent older than every kept cut ID is treated as cut; a newer or live one never is. */
test('UCR-129 forgottenCut marks only ended agents listed before the first cut ID, in three states', () => {
  const listed = [
    { id: 'g0', status: 'completed' },
    { id: 'g1', status: 'running' },
    { id: 'g2', status: 'failed' },
    { id: 'k', status: 'completed' },
    { id: 'n', status: 'completed' },
  ]
  // Behind a valid first case: the first cut ID is k, so g0 and g2 (ended, older) are cut; the live g1 is not.
  expect([...forgottenCut(listed, id => id === 'k')]).toEqual(['g0', 'g2'])
  // At the limit: the first listed is a cut ID, so nothing is older than it.
  expect([...forgottenCut(listed, id => id === 'g0')]).toEqual([])
  // The excluded population: no listed agent is a cut ID (no mark), so nothing is cut; an agent after the mark (n) never is.
  expect([...forgottenCut(listed, () => false)]).toEqual([])
  expect(forgottenCut(listed, id => id === 'k').has('n')).toBe(false)
})

// ---------------------------------------------------------------- UCR-123 (J4)

/** Property: a dropped session's keys are cleared only by a note SESSION_DROP_CONFIRM_MS after it was found, which still finds it not live. */
test('UCR-123 nextDropping clears a session only on a second step that still finds it not live, in three states', () => {
  const t = 10 * SESSION_DROP_CONFIRM_MS
  // Behind a valid first case: found now, it waits; nothing is cleared.
  let step = nextDropping(new Map(), ['A'], new Set(), t)
  expect([...step.pending]).toEqual([['A', t]])
  expect(step.confirmed).toEqual([])
  // At the limit: 1 ms before the wait ends it still waits; at the end it is cleared.
  expect(nextDropping(step.pending, [], new Set(), t + SESSION_DROP_CONFIRM_MS - 1).confirmed).toEqual([])
  step = nextDropping(step.pending, [], new Set(), t + SESSION_DROP_CONFIRM_MS)
  expect(step.confirmed).toEqual(['A'])
  expect(step.pending.size).toBe(0)
  // The excluded population: a session live in the second read leaves the wait and is never cleared; one found while live is not added.
  const waiting = nextDropping(new Map(), ['A'], new Set(), t).pending
  const live = nextDropping(waiting, ['A'], new Set(['A']), t + SESSION_DROP_CONFIRM_MS)
  expect(live.confirmed).toEqual([])
  expect(live.pending.size).toBe(0)
  // A clock set back restarts the wait from the new time (UCR-130).
  expect([...nextDropping(waiting, [], new Set(), t - 7_200_000).pending]).toEqual([['A', t - 7_200_000]])
  expect(readDropping([['A', 5], ['', 1], ['B', 'x'], 'C'])).toEqual(new Map([['A', 5]]))
})

/** Property: nextSessions names the dropped sessions that have no time (a list of an older version), which are cleared at once. */
test('UCR-123 nextSessions names the untimed dropped sessions', () => {
  const others = Array.from({ length: KEPT_SESSIONS }, (_, i) => [`n${i}`, SESSION_LIVE_MS * 10 - 1] as [string, number])
  const next = nextSessions(['old', ['timed', 0], ...others], undefined, 'me', SESSION_LIVE_MS * 10)
  expect(next.dropped).toEqual(['old', 'timed'])
  expect(next.untimed).toEqual(['old'])
})

/**
 * Property (UCR-223): a stored row is read with the limits of a report: at least one step planned,
 * never more done than planned, a step of at most 120 characters, at most 20 claims. States: done
 * past total (the defect behind a valid first row), total 0 (the limit), and a long step with 500
 * claims (the fields the progress check alone leaves out).
 */
test('UCR-223 a stored row keeps the progress and claim limits of a report', () => {
  const rows = readKeptAgents([
    { ...ROW, id: 'ok', progress: { done: 1, total: 3, step: 'Run tests' }, claims: ['#T1'] },
    { ...ROW, id: 'over', progress: { done: 9, total: 3 } },
    { ...ROW, id: 'zero', progress: { done: 0, total: 0 } },
    { ...ROW, id: 'long', progress: { done: 1, total: 3, step: 's'.repeat(5000) }, claims: Array.from({ length: 500 }, (_, i) => `c${i}`) },
  ])
  const by = (id: string) => rows.find(row => row.id === id)!
  expect(by('ok').progress).toEqual({ done: 1, total: 3, step: 'Run tests' })
  expect(by('ok').claims).toEqual(['#T1'])
  expect(by('over').progress).toEqual({ done: 3, total: 3 })
  expect(by('zero').progress).toEqual({ done: 0, total: 1 })
  expect(by('long').progress!.step!.length).toBeLessThanOrEqual(120)
  expect(by('long').claims!.length).toBe(20)
})
