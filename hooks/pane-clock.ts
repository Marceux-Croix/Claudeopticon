/** The clock reading that the render and the stores share. */

import { S } from './state'

export function nowSync(): number {
  return Math.max(S.wallMs, S.clockMs)
}
