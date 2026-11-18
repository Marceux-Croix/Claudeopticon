/** The text of `/claudeopticon-status`: a smoke check after a reload. Pure: the hook gathers the data, this module words it. */

import type { TodoFile } from '../types'

/** What the report states; the hook reads each field from the engine and the session state. */
export type StatusData = {
  version: string | undefined
  /** The session's project root, and the repo root the mod uses; undefined when not known. */
  projectRoot: string | undefined
  repoRoot: string | undefined
  /** The known todo folders: the path as given, and from the repo root (`rel`). */
  folders: readonly { path: string; rel: string; isOther: boolean }[]
  /** The files the scan kept (those with items) and the empty ones it found. */
  files: readonly TodoFile[]
  emptyFiles: readonly { folder: string; name: string }[]
  /** The option values by name, as the hook resolved them. */
  options: Readonly<Record<string, boolean | string | number>>
  /** When the scan the report is based on ended, ms since the epoch. */
  scannedAt: number
  /** The places the scan could not read, as the scan names them. */
  unread: readonly string[]
}

const COUNT_KEYS = ['in_progress', 'queued', 'pending', 'completed'] as const
const COUNT_LABEL = { in_progress: 'in progress', queued: 'queued', pending: 'open', completed: 'done' } as const

/** `.md`, `.html` or `other` by the file name's extension. */
export function fileKind(name: string): string {
  return /\.html$/i.test(name) ? '.html' : /\.md$/i.test(name) ? '.md' : 'other'
}

function countsOf(file: TodoFile): string {
  const by = new Map<string, number>()
  for (const item of file.items) {
    by.set(item.status, (by.get(item.status) ?? 0) + 1)
  }

  return COUNT_KEYS.map(key => `${by.get(key) ?? 0} ${COUNT_LABEL[key]}`).join(', ')
}

/** The report, one fact per line. */
export function statusReport(data: StatusData): string {
  const lines: string[] = []
  lines.push(`Claudeopticon ${data.version === undefined ? '(version not known)' : `v${data.version}`}`)
  lines.push(`Project root: ${data.projectRoot ?? '(not known)'}`)
  lines.push(`Repo root: ${data.repoRoot ?? '(not known)'}`)
  lines.push(`Todo folders (${data.folders.length}):`)
  for (const folder of data.folders) {
    lines.push(`  ${folder.rel}${folder.isOther ? ' (other)' : ' (primary)'}`)
  }
  lines.push(`Todo files (${data.files.length + data.emptyFiles.length}):`)
  for (const file of data.files) {
    lines.push(`  ${file.rel ?? file.folder}/${file.name}: ${fileKind(file.name)}, ${file.items.length} items (${countsOf(file)})`)
  }
  for (const file of data.emptyFiles) {
    lines.push(`  ${data.folders.find(one => one.path === file.folder)?.rel ?? file.folder}/${file.name}: ${fileKind(file.name)}, 0 items (empty)`)
  }
  if (data.files.length + data.emptyFiles.length === 0) {
    lines.push('  (none)')
  }
  lines.push('Options:')
  for (const [name, value] of Object.entries(data.options)) {
    lines.push(`  ${name}: ${String(value)}`)
  }
  lines.push(`Last scan: ${new Date(data.scannedAt).toISOString()}`)
  lines.push(data.unread.length === 0 ? 'Unread: none' : `Unread (${data.unread.length}): ${data.unread.join(', ')}`)

  return lines.join('\n')
}
