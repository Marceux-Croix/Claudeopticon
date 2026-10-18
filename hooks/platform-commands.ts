/** The system commands per platform: which platform it is, the opener, and why a trash command failed. */

import { isWinPath } from './path-forms'

/**
 * Files only macOS has, read when `uname -s` gives nothing (UCR-022). `sw_vers` and `osascript` ship
 * with every macOS. `/usr/bin/trash` is no sign: trash-cli installs it on Linux (UCR-022).
 */
export const MAC_SIGNS = ['/usr/bin/sw_vers', '/usr/bin/osascript']

/** The platform name: the `uname -s` answer, else `Darwin` when a macOS file is there, else empty (unknown). */
export function platformFrom(uname: string, hasMacSign: boolean): string {
  return uname !== '' ? uname : hasMacSign ? 'Darwin' : ''
}

/**
 * The command line that opens an absolute file path in the OS default app. No shell, and the path
 * is absolute, so it cannot look like a flag.
 */
export function openCommand(path: string, platform: string): string[] {
  if (isWinPath(path)) {
    return ['explorer.exe', path.replace(/\//g, '\\')]
  }

  return platform === 'Darwin' ? ['open', path] : ['xdg-open', path]
}

/** Why no trash command worked: each command and what it did. Nothing was tried when the platform is unknown. */
export function trashReason(tried: readonly string[], isWin: boolean, platform: string): string {
  if (isWin) {
    return `PowerShell could not move it to the Recycle Bin${tried.length > 0 ? ` (${tried.join('; ')})` : ''}`
  }
  const notFound = tried.length > 0 && tried.every(one => one.endsWith(': not found'))
  const which = tried.length === 0 ? 'no trash command was tried' : tried.join('; ')

  return `${platform === '' ? 'platform unknown, uname gave no answer; ' : ''}${which}${notFound && platform !== 'Darwin' ? '; install gio or trash-cli' : ''}`
}
