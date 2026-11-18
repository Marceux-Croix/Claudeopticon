/** Moving a file to the trash and opening the archive, per platform. */

import type { EngineInterface } from 'claude-code'
import { isWinPath, psPath, samePath } from './path-forms'
import { MAC_SIGNS, openCommand, platformFrom } from './platform-commands'
import { RUN_LIMIT_MS, TIMED_OUT } from './time-limit'
import { withWriteLock } from './write-lock'
import { isArchiveFile } from './archive'
import { boundedJob, fsBounded, noteTimedOut, realOf, runInTime } from './fs-bounds'
import { hasEntry, isTrustedDir } from './path-trust'
import { S } from './state'
import { showToast } from './toasts'
import { writeIfUnchanged } from './todo-io'

/**
 * The platform, asked once and kept in `unameCache`: the answer of `uname -s`; when that is empty,
 * `Darwin` if a file only macOS has is there (MAC_SIGNS), so neither the opener nor the trash falls
 * to the Linux commands on a Mac; else empty.
 */
async function platformName($: EngineInterface): Promise<string> {
  if (S.unameCache === undefined) {
    // Bounded: a uname that hangs is an empty answer, told once; the macOS signs decide then.
    const asked = await runInTime($, ['uname', '-s'])
    if (asked === TIMED_OUT) {
      noteTimedOut($, ['uname'])
    }
    const uname = ((asked === TIMED_OUT ? undefined : asked)?.stdout ?? '').trim()
    let hasMacSign = false
    for (const sign of uname === '' ? MAC_SIGNS : []) {
      hasMacSign ||= await fsBounded($, () => $.fs.exists(sign)).catch(() => false)
    }
    S.unameCache = platformFrom(uname, hasMacSign)
  }

  return S.unameCache
}

/** The command lines that send a file to the OS trash, in the order they are tried. */
async function trashCommands($: EngineInterface, path: string): Promise<string[][]> {
  if (isWinPath(path)) {
    // DeleteFile deletes outright, with no word, where there is no Recycle Bin: so only a local fixed
    // drive, and never when a Recycle Bin is set to delete at once (NukeOnDelete).
    const bin = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket'
    const script = [
      `$p = ${psPath(path)}`,
      "if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($p)).DriveType -ne 'Fixed') { exit 3 }",
      `$keys = @(Get-Item -LiteralPath '${bin}' -ErrorAction SilentlyContinue) + @(Get-ChildItem -LiteralPath '${bin}\\Volume' -ErrorAction SilentlyContinue)`,
      'if ($keys | Where-Object { $_.GetValue(\'NukeOnDelete\') -eq 1 }) { exit 4 }',
      'Add-Type -AssemblyName Microsoft.VisualBasic',
      "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')",
    ].join('; ')

    return [['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script]]
  }
  if ((await platformName($)) === 'Darwin') {
    // The macOS `trash` CLI takes no `--`; the path is absolute, so it cannot look like a flag.
    const quoted = path.replace(/[\\"]/g, char => `\\${char}`)

    return [['/usr/bin/trash', path], ['osascript', '-e', `tell application "Finder" to delete POSIX file "${quoted}"`]]
  }

  return [['gio', 'trash', '--', path], ['trash-put', '--', path], ['kioclient5', 'move', path, 'trash:/']]
}

/**
 * Makes sure the archive file can be opened, under the writer lock: the folder must be trusted and
 * archive/ its own real path. An existing file must be a plain `.md` or `.html` file. A missing one is created
 * empty, with the existence check as the last call before the write, so a file an archive move made
 * a moment ago is never overwritten. Returns why not, or undefined when it is ready.
 */
async function readyArchive($: EngineInterface, path: string): Promise<string | undefined> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  const folder = dir.slice(0, dir.lastIndexOf('/'))
  if (!(await isTrustedDir($, folder))) {
    return 'its folder is not safe to change'
  }
  if (!(await fsBounded($, () => $.fs.exists(dir)).catch(() => false))) {
    // archive/ is made by the write below.
  } else if (!samePath((await realOf($, dir)) ?? '', dir)) {
    return 'archive/ is a symlink'
  }
  // The existence check is the last call before the write.
  if (await hasEntry($, path)) {
    return (await isArchiveFile($, path)) ? undefined : 'it is not a plain .md or .html file (a symlink?)'
  }
  // Made only while still missing or empty: a file an archive move wrote meanwhile is never written over.
  await writeIfUnchanged($, path, '', '', { mayCreate: true }).catch(() => undefined)

  return (await isArchiveFile($, path)) ? undefined : 'it could not be made'
}

/** Opens the archive file in the OS default app, making it first when it is missing; a toast says so when that fails or the file is not safe to open. */
export async function openArchive($: EngineInterface): Promise<void> {
  const path = S.archiveLink
  if (path === undefined) {
    return
  }
  const why = await withWriteLock(() => readyArchive($, path))
  if (why !== undefined) {
    showToast($, `Not opened: ${path} (${why})`)

    return
  }
  const argv = openCommand(path, isWinPath(path) ? '' : await platformName($))
  // Bounded: an opener that never returns (a permission dialog) is told, never waited on for good.
  const result = await runInTime($, argv)
  if (result === TIMED_OUT) {
    showToast($, `Could not open ${path}: \`${argv[0] ?? ''}\` did not return within ${RUN_LIMIT_MS / 1000} s`)

    return
  }
  // explorer.exe exits 1 even when it opened the file; any other command must exit 0.
  const isOk = result !== undefined && (result.exitCode === 0 || (argv[0] === 'explorer.exe' && result.exitCode === 1))
  if (!isOk) {
    showToast($, `Could not open ${path}`)
  }
}

/**
 * Sends one file to the OS trash. True only if a command exited 0 and the file is gone. There is no
 * fallback to `rm` or any other outright delete: when no trash method works, the file stays.
 */
export async function trashFile($: EngineInterface, path: string): Promise<{ isOk: boolean; tried: string[] }> {
  const tried: string[] = []
  // Every outside call here is bounded: this runs under the writer lock, and a command that never returns
  // (a Finder permission dialog) must not stop every todo write of the session.
  const commands = await boundedJob($, trashCommands($, path))
  if (commands === TIMED_OUT) {
    return { isOk: false, tried: ['uname: timed out'] }
  }
  for (const argv of commands) {
    const result = await runInTime($, argv)
    if (result === TIMED_OUT) {
      // It may still finish later: no second command is tried on the same file.
      tried.push(`${argv[0] ?? ''}: timed out after ${RUN_LIMIT_MS / 1000} s`)
      break
    }
    if (result?.exitCode === 0 && !(await fsBounded($, () => $.fs.exists(path)).catch(() => true))) {
      return { isOk: true, tried }
    }
    // Per command: not found (it did not start, or the shell said 127), or the code it exited with.
    const name = argv[0] ?? ''
    tried.push(result === undefined || result.exitCode === 127 ? `${name}: not found` : result.exitCode === 0 ? `${name}: exited 0 but the file is still there` : `${name}: exited ${result.exitCode}`)
  }

  return { isOk: false, tried }
}
