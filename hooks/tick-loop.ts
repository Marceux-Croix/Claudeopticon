/** The ticker that scans, refreshes and resyncs the board. */

import type { EngineInterface, Timer } from 'claude-code'
import { isEnded } from './agent-ends'
import { clock } from './card-format'
import { elapsedSince, isDeadlinePast } from './clock-elapsed'
import { expireSpaces } from './ticket-spaces'
import { refreshAgents } from './agent-refresh'
import { CLOCK_MS, IDLE_DRAW_MS, NOTE_MS, RESYNC_EVERY, SCAN_EVERY, TICK_MS } from './pane-constants'
import { redraw } from './pane-redraw'
import { peerStep } from './peer-sync'
import { S, layout, pendingTools } from './state'
import { showToast } from './toasts'
import { scan } from './todo-scan'

let ticker: Timer | undefined

let ticks = 0

/**
 * Once a minute, rebuilds what the pane shows from the source: every todo and archive file reread
 * whatever its mtime, `categories.json` reloaded, the agent list asked again, and a redraw. It
 * catches what the quick checks can miss: an edit that kept a file's mtime, a categories file
 * changed by hand, an agent whose status changed while none was live.
 */
async function resync($: EngineInterface): Promise<void> {
  await scan($, true)
  S.lastClock = 0
  await refreshAgents($)
  redraw($)
}

export function start($: EngineInterface): void {
  if (ticker !== undefined) {
    return
  }
  ticker = $.clock.every(TICK_MS, () => {
    ticks += 1
    void (async () => {
      const now = await $.clock.now()
      S.wallMs = now
      if (S.recatNote !== undefined && isDeadlinePast(S.recatNote.until, now, NOTE_MS)) {
        S.recatNote = undefined
        redraw($)
      }
      // The spaces of tickets that left go after SPACE_MS; a token report that came within CLOCK_MS of the last draw is drawn; the top card scrolls its time axis.
      if (expireSpaces(layout, now)) {
        redraw($)
      }
      // Both throttles timed with elapsedSince: after a clock set back, the redraws go on.
      const sinceBurn = elapsedSince(S.lastBurnDraw, now)
      S.lastBurnDraw = sinceBurn.from
      if (S.isBurnDirty && sinceBurn.ms >= CLOCK_MS) {
        S.isBurnDirty = false
        S.lastBurnDraw = now
        redraw($)
      }
      const sinceIdle = elapsedSince(S.lastIdleDraw, now)
      S.lastIdleDraw = sinceIdle.from
      if (sinceIdle.ms >= IDLE_DRAW_MS) {
        S.lastIdleDraw = now
        S.clockMs = Math.max(S.clockMs, now)
        redraw($)
      }
      void peerStep($, now).catch(() => undefined)
      if (ticks % RESYNC_EVERY === 0) {
        await resync($)

        return
      }
      // A live agent keeps the agent list checked.
      if (pendingTools.size > 0 || S.agentRows.some(row => !isEnded(row.status))) {
        await refreshAgents($)
      }
      if (ticks % SCAN_EVERY === 0) {
        await scan($)
      }
    })().then(
      () => {
        tickFailures = 0
        isTickToastShown = false
      },
      (error: unknown) => noteTickFailure($, error),
    )
  })
}

/** The ticks in a row whose work threw: a board that cannot refresh says so once. */
let tickFailures = 0

const TICK_FAILS_TO_TOAST = 3

let isTickToastShown = false

/** Counts a tick that threw and, at TICK_FAILS_TO_TOAST in a row, says why once (shown again only after a tick works): the ticker goes on, and the board would otherwise go stale with no word. */
function noteTickFailure($: EngineInterface, error: unknown): void {
  tickFailures += 1
  if (tickFailures >= TICK_FAILS_TO_TOAST && !isTickToastShown) {
    isTickToastShown = true
    try {
      showToast($, `The board could not refresh ${tickFailures} times in a row (${error instanceof Error ? error.message : String(error)}). It is tried again every second.`)
    } catch {
      // A toast that fails has nowhere left to tell.
    }
  }
}
