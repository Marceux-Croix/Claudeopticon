/** Path forms: Windows paths, PowerShell quoting, normalized comparison, relative paths and folders named by the environment. */

/**
 * A PowerShell expression for a path, built from its UTF-16 character codes: digits and commas only, so no
 * character in a file name (straight or curly quote, `$`, backtick) can end the string or run code.
 */
export function psPath(path: string): string {
  // UTF-16 code units, as `[char]` takes them: a name outside the BMP is two units (a surrogate pair), not one code point.
  const flat = path.replace(/\//g, '\\')

  return `[string]::new([char[]](${Array.from({ length: flat.length }, (_, i) => flat.charCodeAt(i)).join(',')}))`
}

/** True for a Windows absolute path, `C:/x` or `C:\x`. */
export const isWinPath = (path: string): boolean => /^[A-Za-z]:[\\/]/.test(path)

/** A Windows path with forward slashes and an upper-case drive letter, so two spellings compare equal. Any other path is returned as it is (a backslash is a legal POSIX name character). */
export function normPath(path: string): string {
  return isWinPath(path) ? path.replace(/\\/g, '/').replace(/^[a-z]:/, drive => drive.toUpperCase()) : path
}

/** A path made absolute against `base` with `.` and `..` segments folded; an absolute path is only folded. */
export function resolveAgainst(base: string, path: string): string {
  const isAbs = path.startsWith('/') || /^[A-Za-z]:\//.test(path)
  const parts = (isAbs ? path : `${base}/${path}`).split('/')
  const out: string[] = []
  for (const part of parts.slice(1)) {
    if (part === '..') {
      out.pop()
    } else if (part !== '' && part !== '.') {
      out.push(part)
    }
  }

  return `${parts[0]}/${out.join('/')}`
}

/**
 * A path with `.` and `..` segments folded and no trailing slash, absolute or relative (UCR-202): a
 * relative path keeps the `..` segments that lead out of its start (`../../x`), which
 * `resolveAgainst` cannot, as it needs an absolute base. A Windows path gets forward slashes first.
 * An empty relative result is `.`.
 */
export function foldPath(path: string): string {
  const flat = normPath(path)
  const lead = flat.startsWith('/') ? '/' : (/^[A-Z]:\//.exec(flat)?.[0] ?? '')
  const out: string[] = []
  for (const part of flat.slice(lead.length).split('/')) {
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop()
    } else if (part === '..' && lead === '') {
      out.push(part)
    } else if (part !== '' && part !== '.' && part !== '..') {
      out.push(part)
    }
  }
  const body = out.join('/')

  return lead === '' ? body || '.' : `${lead}${body}`
}

/** A real path from the repo root, or undefined when it lies outside the root. */
export function relIn(real: string | undefined, root: string | undefined): string | undefined {
  return real !== undefined && root !== undefined && real.startsWith(`${root}/`) ? real.slice(root.length + 1) : undefined
}

/** Two spellings of one path: Windows drive and slashes folded, and Unicode in NFC (macOS gives file names in NFD, git in NFC). */
export function samePath(a: string, b: string): boolean {
  return normPath(a).normalize('NFC') === normPath(b).normalize('NFC')
}

/**
 * True when git's session folder (`sessionFolder` of the REV_PARSE output) is the session's own folder,
 * the real path of `.` (UCR-150). Both must be known. A Windows path may differ in letter case too, as
 * that disk ignores it; a POSIX path must match exactly (NFC aside), since a case-sensitive disk can
 * hold both spellings as two folders.
 */
export function isSameFolder(gitSays: string | undefined, real: string | undefined): boolean {
  if (gitSays === undefined || real === undefined) {
    return false
  }
  const [a, b] = [gitSays, real].map(path => normPath(path).replace(/(.)\/+$/, '$1'))

  return samePath(a!, b!) || (isWinPath(a!) && caseKey(a!) === caseKey(b!))
}

/** One spelling of a path with letter case folded too, for disks that ignore case (macOS and Windows by default). */
const caseKey = (path: string): string => normPath(path).normalize('NFC').toLowerCase()

/**
 * True when two paths differ only by letter case (UCR-151): after a case-only rename on a disk that
 * ignores case, git lists the old case (`Docs/`) while the real path has the new one (`docs/`).
 */
export function isCaseOnly(listed: string, real: string): boolean {
  return !samePath(listed, real) && caseKey(listed) === caseKey(real)
}

/**
 * The name a folder's own listing gives to `name` (UCR-152): `name` itself when it is listed; else the
 * one entry that matches it without case (`todo.md` for `TODO.md`); else `name`. Two entries that match
 * without case (a disk that keeps case apart) give `name`, so no other file is taken for it.
 */
export function listedName(names: readonly string[], name: string): string {
  if (names.includes(name)) {
    return name
  }
  const near = names.filter(one => caseKey(one) === caseKey(name))

  return near.length === 1 ? near[0]! : name
}

/** True for an absolute path, POSIX (`/x`) or Windows (`C:/x`, `C:\x`). */
export const isAbsPath = (path: string): boolean => path.startsWith('/') || isWinPath(path)

/**
 * The forms of a folder named by an environment variable (HOME, USERPROFILE, CLAUDE_CONFIG_DIR), with
 * no trailing slash: a POSIX path as it is; a Windows path with forward slashes and an upper-case drive
 * (`d:\cfg\` gives `D:/cfg`); an MSYS path (`/d/cfg`, as Git for Windows tools print it) also as the
 * Windows path it stands for. Empty for a value that is not an absolute path (UCR-023).
 */
export function envDirs(value: string | undefined): string[] {
  const text = value?.trim() ?? ''
  if (!isAbsPath(text)) {
    return []
  }
  const bare = normPath(text).replace(/\/+$/, '')
  const one = bare === '' ? '/' : /^[A-Z]:$/.test(bare) ? `${bare}/` : bare
  const msys = /^\/([A-Za-z])(\/.*)?$/.exec(one)

  return msys === null ? [one] : [one, `${msys[1]!.toUpperCase()}:${msys[2] ?? '/'}`]
}
