/** The types that the pane modules share: the cleaned UI components of one render, and the card helper. */

import type { EngineInterface } from 'claude-code'

type Table = ReturnType<EngineInterface['ui']['resolve']>

/** The components of one render: `Text` and `Button` are the cleaned versions (control characters out) that pane-render.tsx makes. */
export type PaneKit = {
  Box: Table['Box']
  Button: Table['Button']
  Text: Table['Text']
  Input: Extract<Table, { Input: unknown }>['Input'] | undefined
  Svg: Extract<Table, { Svg: unknown }>['Svg'] | undefined
}

/** The kit of the desktop pane, which has an `Svg`. */
export type DesktopKit = PaneKit & { Svg: NonNullable<PaneKit['Svg']> }

/** Draws one card image: its alt is cleaned, and no height is given (, see desktop-pane.tsx). */
export type CardFn = (key: string, drawn: { source: string; width: number; height: number; alt: string; isInteractive?: true }) => JSX.Element
