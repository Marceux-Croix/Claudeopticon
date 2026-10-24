// Engine cases through the fake engine: what the board and the list say about the todo files they
// show (counts on the buttons, unreadable files, the full-text switch).

import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'claudeopticon', props: { title: 'Claudeopticon', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never as { component: 'Pane'; requestId: string; props: never }

type Dollar = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

/** A pane over one todo file `PLAN.md` holding `text`; `failRead` makes its read throw. */
function rig(on: On, text: string, failRead = false) {
  mock.clock(on)
  on('fs.exists', (_$, e) => ({ value: !e.path.endsWith('archive') }))
  on('fs.list', () => ({ value: [{ name: 'PLAN.md', kind: 'file', size: 1, mtimeMs: 2, isLink: false }] }))
  on('fs.read', () => {
    if (failRead) {
      throw new Error('EACCES')
    }

    return { value: text }
  })
  on('agent.list', () => ({ value: [] }))
}

async function open($: Dollar) {
  await $.command.run({ command: 'claudeopticon', args: '' } as never).catch(() => undefined)

  return $.ui.mount({ plugin: 'claudeopticon', surface: 'desktop', ...PANE })
}

const labelsOf = async (ui: Awaited<ReturnType<typeof open>>) => (await ui.findAll({ type: 'Button' } as never)).map(button => String((button as { props?: { label?: string } }).props?.label))

const tickets = (open: number, done: number) => [...Array.from({ length: open }, (_, i) => `- [ ] #T${1000 + i} Open ${i}`), ...Array.from({ length: done }, (_, i) => `- [x] #T${2000 + i} Done ${i}`)].join('\n')

/** Property: "Show all N items" counts the tickets the view offers, never the done ones it does not draw. */
test('Show all counts the open tickets that the board and the list offer, not the done ones', async ($, on) => {
  rig(on, tickets(13, 20))
  const ui = await open($)
  expect((await labelsOf(ui)).filter(label => label.startsWith('Show all'))).toEqual(['Show all 13 items'])
  await ui.press({ key: 'todo-tickets' })
  expect((await labelsOf(ui)).filter(label => label.startsWith('Show all'))).toEqual(['Show all 13 items'])
})

/** Property: a todo file that cannot be read is named as unread, never shown as a file with no checkbox items. */
test('a todo file that cannot be read is said so, and is not shown as empty', async ($, on) => {
  rig(on, '', true)
  const ui = await open($)
  expect(await ui.find({ type: 'Text', text: /Could not read 1 todo file/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No checkbox items/ })).toBeUndefined()
})

/** Property: a board ticket whose card cuts its text offers the full text, since Send submits all of it. */
test('a board ticket cut at four lines offers Show full text, and the full text shows after the press', async ($, on) => {
  const tail = 'ENDMARK'
  rig(on, ['- [ ] #T1001 Short ticket', `- [ ] #T1002 ${Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')} ${tail}`].join('\n'))
  const ui = await open($)
  const drawn = async () => JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect((await labelsOf(ui)).filter(label => label.startsWith('Show full text'))).toEqual(['Show full text (1 long item)'])
  expect(await drawn()).not.toContain(tail)
  await ui.press({ key: 'file-text-board' })
  expect(await drawn()).toContain(tail)
  expect((await labelsOf(ui)).filter(label => label.includes('long item') || label.startsWith('Shorten'))).toEqual(['Shorten long items'])
})

/** The excluded population: a board with only short tickets offers no full-text button. */
test('a board of short tickets offers no Show full text', async ($, on) => {
  rig(on, '- [ ] #T1001 Short ticket\n- [ ] #T1002 Another short one')
  const ui = await open($)
  expect((await labelsOf(ui)).filter(label => label.startsWith('Show full text') || label.startsWith('Shorten'))).toEqual([])
})

/** The largest desktop cell width the cards must fill, in CSS px: 8.5 fell short on 2026-10-24. */
const WIDEST_CELL_PX = 10

/**
 * Property: every card is drawn at least as wide as the pane at any desktop cell width up to WIDEST_CELL_PX, so the desktop
 * scales it down to the pane's exact width: its edge lines up with the buttons outside the cards, and a Stop button placed
 * in cells stays clear of its badge.
 */
test('each full-width card is at least as wide as the pane at the widest desktop cell', async ($, on) => {
  rig(on, tickets(2, 0))
  const ui = await open($)
  const widths = (await ui.findAll({ type: 'Svg' } as never)).map(svg => Number((svg as { props?: { width?: number } }).props?.width))
  expect(widths.length).toBeGreaterThan(0)
  expect(Math.max(...widths)).toBeGreaterThanOrEqual(60 * WIDEST_CELL_PX)
})

/**
 * Property: no card is sent with a height. The desktop scales a card down to the pane; a given height kept its box
 * at the unscaled height, with the image centered in it, so stacked cards had gaps and side-by-side columns started at
 * different tops.
 */
test('no card is sent with a height, so a scaled card keeps its own proportions', async ($, on) => {
  rig(on, tickets(3, 0))
  const ui = await open($)
  const svgs = await ui.findAll({ type: 'Svg' } as never)
  expect(svgs.length).toBeGreaterThan(0)
  expect(svgs.filter(svg => (svg as { props?: { height?: number } }).props?.height !== undefined)).toEqual([])
})
