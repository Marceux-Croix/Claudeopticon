p='hooks/register.tsx'
s=open(p).read()
a=s.index("/**\n * Moves the work to one central todo")
b=s.index("/** One file of a duplicate folder, as the coverage check judged it.")
new='''/**
 * The parts of a ticket line that a fold compares: everything but the item's own leading `#T<n>` ID,
 * kept letter for letter (bullet, box, spacing, text), and that ID. Undefined for any other line.
 */
export function foldParts(line: string): { key: string; id: string } | undefined {
  const m = /^(\\s*[-*+] \\[[ xX~>]\\]\\s+)#([A-Za-z]+\\d+)(?=\\s|$)(.*)$/.exec(line.trimEnd())

  return m === null ? undefined : { key: `${m[1]}#${m[3]}`, id: m[2]! }
}

/**
 * Moves the work to one central todo, `<root of the main checkout>/.claude_todo/`: the non-blank
 * lines of every other folder's files go into the central file of the same name (archive files into
 * the central `archive/`), in order, under a `## From <place>` heading. A line the central file
 * already holds (exactly, after the file's recorded renames) is not copied again. A ticket line
 * identical, apart from its own ID, to a ticket line of the central file or one queued for it in
 * this press is folded: not copied, its ID mapped to the existing ticket's (references follow, and
 * the fold is recorded so Delete knows). Any other ticket whose ID the central folder uses gets the
 * next free ID. Each target file is written once, if it did not change since it was read; the sources
 * are never touched. Then the folders are found again (the one discovery outside startup), the
 * sources join the duplicates, and a folder not fully covered leaves them again. Off in a linked
 * worktree and when the main folder would be the global one.
 */
async function consolidate($: EngineInterface): Promise<void> {
  const central = centralFolder()
  if (isWorking || central === undefined || !canConsolidate()) {
    return
  }
  isWorking = true
  try {
    await dropUncovered($, true)
    if (!canConsolidate()) {
      return
    }
    const realCentral = await realOf($, central)
    const sources: { path: string; real: string; rel: string; wasPrimary: boolean }[] = []
    for (const one of visibleFolders()) {
      if (one.path === central || (realCentral !== undefined && one.real === realCentral) || !one.path.startsWith('/')) {
        continue
      }
      const real = one.real ?? (await realOf($, one.path))
      if (real !== undefined) {
        sources.push({ path: one.path, real, rel: one.rel, wasPrimary: !one.isOther })
      }
    }
    if (sources.length === 0) {
      return
    }
    const used = new Set<string>()
    const texts = new Map<string, string>()
    const centralText = async (name: string) => {
      const held = texts.get(name)
      if (held !== undefined) {
        return held
      }
      const path = `${central}/${name}`
      // An existing central file that cannot be read aborts the press: it is never written over.
      const text = (await $.fs.exists(path).catch(() => false)) ? await readStrict($, path) : ''
      texts.set(name, text)

      return text
    }
    for (const name of await mdFiles($, central)) {
      for (const line of itemLines(await centralText(name))) {
        const id = ITEM_ID.exec(line)?.[1]
        if (id !== undefined) {
          used.add(id.toLowerCase())
        }
      }
    }
    // Per target: the central lines still free to cover a source line, and the tickets a fold may join.
    const free = new Map<string, Map<string, number>>()
    const tickets = new Map<string, Map<string, string>>()
    const stateFor = async (name: string) => {
      if (!free.has(name)) {
        const held = new Map<string, number>()
        const ids = new Map<string, string>()
        for (const line of nonBlankLines(await centralText(name))) {
          held.set(coverKey(line), (held.get(coverKey(line)) ?? 0) + 1)
          const parts = foldParts(line)
          if (parts !== undefined && !ids.has(parts.key)) {
            ids.set(parts.key, parts.id)
          }
        }
        free.set(name, held)
        tickets.set(name, ids)
      }

      return { held: free.get(name)!, ids: tickets.get(name)! }
    }
    type Block = { place: string; lines: string[] }
    type Commit = { target?: string; file: string; renames: Record<string, string>; folds: string[]; told: string[] }
    const sections = new Map<string, Block[]>()
    const commits: Commit[] = []
    for (const source of sources) {
      const place = placeOf(source.rel)
      for (const name of await mdFiles($, source.path)) {
        const path = `${source.path}/${name}`
        const lines = nonBlankLines(await readText($, path))
        const { held, ids } = await stateFor(name)
        const old = renameMap[path] ?? {}
        const oldFolds = new Set(foldMap[path] ?? [])
        const fold: Record<string, string> = {}
        const folded: string[] = []
        const told: string[] = []
        const toCopy: string[] = []
        for (const line of lines) {
          // Already in the central file: exactly, after this file's renames. A recorded fold may share its line.
          const key = coverKey(applyRenames(line, old))
          if ((held.get(key) ?? 0) > 0) {
            if (!oldFolds.has(line)) {
              held.set(key, (held.get(key) ?? 0) - 1)
            }
            continue
          }
          const parts = foldParts(line)
          const target = parts === undefined ? undefined : ids.get(parts.key)
          if (parts !== undefined && target !== undefined) {
            if (target.toLowerCase() !== parts.id.toLowerCase()) {
              fold[parts.id.toLowerCase()] = target
            }
            folded.push(line)
            told.push(`- ${place}/${name}: #${parts.id} folded into #${target}`)
            continue
          }
          toCopy.push(line)
        }
        const fresh = renumberLines(toCopy, used)
        const all = { ...old, ...fold, ...fresh.renames }
        const out = toCopy.map(line => applyRenames(line, all))
        told.push(...fresh.pairs.map(pair => `- ${place}/${name}: #${pair.from} is now #${pair.to}`))
        for (const line of out) {
          const parts = foldParts(line)
          if (parts !== undefined && !ids.has(parts.key)) {
            ids.set(parts.key, parts.id)
          }
        }
        if (out.length > 0) {
          sections.set(name, [...(sections.get(name) ?? []), { place, lines: out }])
        }
        commits.push({ ...(out.length > 0 ? { target: name } : {}), file: path, renames: { ...fold, ...fresh.renames }, folds: folded, told })
      }
    }
    let files = 0
    const told: string[] = []
    const skipped = new Set<string>()
    const commit = (one: Commit) => {
      if (Object.keys(one.renames).length > 0) {
        renameMap = { ...renameMap, [one.file]: { ...(renameMap[one.file] ?? {}), ...one.renames } }
      }
      if (one.folds.length > 0) {
        foldMap = { ...foldMap, [one.file]: [...new Set([...(foldMap[one.file] ?? []), ...one.folds])] }
      }
      told.push(...one.told)
    }
    for (const one of commits.filter(c => c.target === undefined)) {
      commit(one)
    }
    for (const [name, blocks] of sections) {
      const path = `${central}/${name}`
      // The target may have changed since the press read it: then it is not written, and its sources stay uncovered.
      const now = (await $.fs.exists(path).catch(() => false)) ? await readStrict($, path) : ''
      if (now !== (await centralText(name))) {
        skipped.add(`${DIR}/${name}`)
        continue
      }
      await writeFile($, path, appendSections(now, blocks))
      files += 1
      for (const one of commits.filter(c => c.target === name)) {
        commit(one)
      }
      // The renumbering is kept as each file lands, so a press that fails later still knows it.
      await saveMeta($)
    }
    // The union of the old record and the new sources, in memory at once; the coverage check then
    // lets go of any folder that is not fully in the central one.
    const fresh = sources.map(one => ({ path: one.path, real: one.real, ...(one.wasPrimary ? { wasPrimary: true as const } : {}) }))
    dupFolders = [...dupFolders.filter(one => !fresh.some(now => now.path === one.path)), ...fresh]
    await saveRecord($)
    await dropUncovered($, true)
    pendingRenames = [...pendingRenames, ...told]
    // The one discovery outside startup: the git index again, now with the central folder in it.
    todoFolders = undefined
    folderSearch = undefined
    nearestSeen = undefined
    await ensureFolders($)
    await scan($, true)
    if (skipped.size > 0) {
      $.ui.toast(`Not written, changed meanwhile: ${[...skipped].join(', ')}. Their folders stay on the board. Press Consolidate todos again.`)
    }
    $.ui.toast(`Consolidated ${files} ${files === 1 ? 'file' : 'files'} into ${DIR}/ at the repo root.${skipped.size === 0 ? ' The old folders are off the board.' : ''}${told.length > 0 ? ` ${told.map(line => line.slice(2)).join('; ')}` : ''}`)
  } catch (error) {
    $.ui.toast(`Could not consolidate: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isWorking = false
    redraw($)
  }
}

'''
s=s[:a]+new+s[b:]
open(p,'w').write(s)
