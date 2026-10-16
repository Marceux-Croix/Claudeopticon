p='hooks/register.tsx'
s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1,a[:80]
    s=s.replace(a,b)

# state
rep("let renameMap: Record<string, Record<string, string>> = {}\n","""let renameMap: Record<string, Record<string, string>> = {}
/** By source file (absolute path): the source lines (trailing spaces cut) folded into an identical central ticket, not copied. */
let foldMap: Record<string, string[]> = {}
/** What the last coverage check looked at, so the board's scan checks again only after a file changed. */
let lastCoverageSig: string | undefined
""")
# saveRecord / saveMeta
a=s.index("/** Writes the duplicate record and the renumbering record to the store. */")
b=s.index("/** Keeps the recorded duplicates that still exist on disk")
s=s[:a]+'''/** Writes the renumbering and fold records to the store. */
async function saveMeta($: EngineInterface): Promise<void> {
  const meta = metaKey()
  if (meta !== undefined) {
    await $.store.set(meta, { primary: dupFolders.filter(one => one.wasPrimary === true).map(one => one.path), renames: renameMap, folds: foldMap }).catch(() => undefined)
  }
}

/** Writes the duplicate record and the renumbering record to the store. */
async function saveRecord($: EngineInterface): Promise<void> {
  const key = dupKey()
  if (key === undefined) {
    return
  }
  await $.store.set(key, dupFolders.map(one => one.path)).catch(() => undefined)
  await saveMeta($)
}

'''+s[b:]
rep("as { primary?: unknown; renames?: unknown } | undefined","as { primary?: unknown; renames?: unknown; folds?: unknown } | undefined")
rep("""    renameMap = { ...(kept.renames as typeof renameMap), ...renameMap }
  }""","""    renameMap = { ...(kept.renames as typeof renameMap), ...renameMap }
  }
  if (typeof kept?.folds === 'object' && kept.folds !== null) {
    foldMap = { ...(kept.folds as typeof foldMap), ...foldMap }
  }""")
rep("""  dupFolders = alive
  if (alive.length !== paths.length) {
    // An empty list is the cleared record.
    await saveRecord($)
  }
}""","""  dupFolders = alive
  if (alive.length !== paths.length) {
    // An empty list is the cleared record.
    await saveRecord($)
  }
  await dropUncovered($, true)
}""")

# coverage block, inserted before isTrustedFolder docs
marker="/**\n * Whether files may be removed from a recorded duplicate folder"
cov='''/** One file of a duplicate folder, as the coverage check judged it. `empty`: no non-blank line. */
type FileCover = { name: string; path: string; text: string; state: 'covered' | 'uncovered' | 'empty' }

/**
 * The one coverage rule, for the board and for Delete: a file of a duplicate folder is covered when
 * every non-blank line of it, after its recorded renames, is a line of the central file of the same
 * name, and a central line covers only one source line. A line recorded as folded (`foldMap`) may
 * share its central line; no other line may. Folders are judged in order, sharing the central lines.
 * A file that cannot be read counts as uncovered. A central file that cannot be read throws.
 */
async function coverageOf($: EngineInterface, central: string, folders: readonly { path: string }[]): Promise<Map<string, FileCover[]>> {
  const have = new Map<string, Map<string, number>>()
  const covers = async (name: string) => {
    let held = have.get(name)
    if (held === undefined) {
      held = new Map()
      const path = `${central}/${name}`
      const text = (await $.fs.exists(path).catch(() => false)) ? await readStrict($, path) : ''
      for (const line of nonBlankLines(text)) {
        held.set(coverKey(line), (held.get(coverKey(line)) ?? 0) + 1)
      }
      have.set(name, held)
    }

    return held
  }
  const out = new Map<string, FileCover[]>()
  for (const dup of folders) {
    const files: FileCover[] = []
    for (const name of await mdFiles($, dup.path)) {
      const path = `${dup.path}/${name}`
      const text = await readStrict($, path).catch(() => undefined)
      if (text === undefined) {
        files.push({ name, path, text: '', state: 'uncovered' })
        continue
      }
      const lines = nonBlankLines(text)
      if (lines.length === 0) {
        files.push({ name, path, text, state: 'empty' })
        continue
      }
      const renames = renameMap[path] ?? {}
      const folded = new Set(foldMap[path] ?? [])
      const held = await covers(name)
      const left = new Map(held)
      const isCovered = lines.every(line => {
        const key = coverKey(applyRenames(line, renames))
        const n = left.get(key) ?? 0
        if (!folded.has(line)) {
          left.set(key, n - 1)
        }

        return n > 0
      })
      if (isCovered) {
        // The lines used stay used for the next file.
        for (const [key, n] of left) {
          held.set(key, n)
        }
      }
      files.push({ name, path, text, state: isCovered ? 'covered' : 'uncovered' })
    }
    out.set(dup.path, files)
  }

  return out
}

/** The names and mtimes of the `.md` files of the central folder and the duplicate folders: a cheap sign that a coverage check is due. */
async function coverageSignature($: EngineInterface, central: string): Promise<string> {
  const parts: string[] = []
  for (const folder of [central, ...dupFolders.map(one => one.path)]) {
    for (const [dir, prefix] of [[folder, ''], [`${folder}/archive`, 'archive/']] as const) {
      if (await $.fs.exists(dir).catch(() => false)) {
        for (const entry of await $.fs.list(dir).catch(() => [])) {
          if (entry.kind === 'file' && entry.name.endsWith('.md')) {
            parts.push(`${dir}/${prefix}${entry.name}:${entry.mtimeMs}:${entry.size}`)
          }
        }
      }
    }
  }

  return parts.join('|')
}

/**
 * A recorded duplicate counts only while all its non-blank lines are covered by the central folder.
 * A folder that is not leaves the record (and the store), shows on the board again, and is a
 * Consolidate source again. Checked at load, at each full resync, before Consolidate and Delete, and
 * at the board's scan whenever a file of those folders changed. Off where Consolidate and Delete are.
 */
async function dropUncovered($: EngineInterface, isForced = false): Promise<void> {
  const central = centralFolder()
  if (central === undefined || centralBlocked || dupFolders.length === 0) {
    return
  }
  try {
    const sign = await coverageSignature($, central)
    if (!isForced && sign === lastCoverageSig) {
      return
    }
    lastCoverageSig = sign
    const cover = await coverageOf($, central, dupFolders)
    const kept = dupFolders.filter(one => !(cover.get(one.path) ?? []).some(file => file.state === 'uncovered'))
    if (kept.length !== dupFolders.length) {
      dupFolders = kept
      lastCoverageSig = undefined
      await saveRecord($)
    }
  } catch {
    // A central file that cannot be read changes nothing: the record stays as it was.
  }
}

'''
rep(marker,cov+marker)

# scan
rep("""  if (isFull) {
    await loadDuplicates($).catch(() => undefined)
  }
  const folders = visibleFolders()""","""  if (isFull) {
    await loadDuplicates($).catch(() => undefined)
  } else {
    await dropUncovered($)
  }
  const folders = visibleFolders()""")
open(p,'w').write(s)
