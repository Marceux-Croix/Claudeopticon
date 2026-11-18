/** The toasts of the pane: one text, and the failure handler of a pressed action. */

import type { EngineInterface } from 'claude-code'
import { toastText } from './card-text'

/**
 * Every toast goes through here, so its text is cleaned once: ticket text, file names and
 * error messages can hold control characters, and a toast with ESC could move a terminal's cursor.
 */
export function showToast($: EngineInterface, text: string): void {
  $.ui.toast(toastText(text))
}

/**
 * The catch for a button press whose job threw past its own handling: the user gets the reason in a
 * toast, never silence. A toast that itself fails is dropped, as there is nowhere left to tell.
 */
export function toastFailure($: EngineInterface, what: string): (error: unknown) => void {
  return error => {
    try {
      showToast($, `Could not ${what}: ${error instanceof Error ? error.message : String(error)}`)
    } catch {
      // Nowhere left to report.
    }
  }
}
