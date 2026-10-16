p='hooks/register.tsx'
s=open(p).read()
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:90],s.count(a))
    s=s.replace(a,b)
# strict reads in consolidate
a=s.index("async function consolidate($: EngineInterface)")
b=s.index("/** One file of a duplicate folder, as the coverage check judged it.")
body=s[a:b]
body=body.replace("const text = (await $.fs.exists(path).catch(() => false)) ? await readStrict($, path) : ''","const text = (await $.fs.exists(path)) ? await readStrict($, path) : ''")
body=body.replace("for (const name of await mdFiles($, central)) {","for (const name of await mdFiles($, central, true)) {")
body=body.replace("const now = (await $.fs.exists(path).catch(() => false)) ? await readStrict($, path) : ''","const now = (await $.fs.exists(path)) ? await readStrict($, path) : ''")
body=body.replace("""    const commits: Commit[] = []
    for (const source of sources) {
      const place = placeOf(source.rel)
      for (const name of await mdFiles($, source.path)) {
        const path = `${source.path}/${name}`
        const lines = nonBlankLines(await readText($, path))
""","""    const commits: Commit[] = []
    // A source that will not list or read stays on the board: nothing of it was copied.
    const unreadable = new Set<string>()
    for (const source of sources) {
      const place = placeOf(source.rel)
      const names = await mdFiles($, source.path, true).catch(() => undefined)
      if (names === undefined) {
        unreadable.add(source.path)
        continue
      }
      for (const name of names) {
        const path = `${source.path}/${name}`
        const text = await readStrict($, path).catch(() => undefined)
        if (text === undefined) {
          unreadable.add(source.path)
          continue
        }
        const lines = nonBlankLines(text)
""")
# keep only old renames/folds that present lines needed; new copies use no old renames
body=body.replace("""        const fold: Record<string, string> = {}
        const folded: string[] = []""","""        const fold: Record<string, string> = {}
        // What the lines already in the central file still need of the old record; the rest is stale.
        const keepOld: Record<string, string> = {}
        const keepFolds: string[] = []
        const folded: string[] = []""")
body=body.replace("""          if ((held.get(key) ?? 0) > 0) {
            if (!oldFolds.has(line)) {
              held.set(key, (held.get(key) ?? 0) - 1)
            }
            continue
          }""","""          if ((held.get(key) ?? 0) > 0) {
            if (oldFolds.has(line)) {
              keepFolds.push(line)
            } else {
              held.set(key, (held.get(key) ?? 0) - 1)
            }
            for (const [, id] of line.matchAll(/#([A-Za-z]+\\d+)\\b/g)) {
              if (id !== undefined && old[id.toLowerCase()] !== undefined) {
                keepOld[id.toLowerCase()] = old[id.toLowerCase()]!
              }
            }
            continue
          }""")
body=body.replace("""        const all = { ...old, ...fold, ...fresh.renames }
        const out = toCopy.map(line => applyRenames(line, all))""","""        // New copies take no old renaming: a recreated file must not inherit a stale one.
        const now = { ...fold, ...fresh.renames }
        const out = toCopy.map(line => applyRenames(line, now))""")
body=body.replace("commits.push({ ...(out.length > 0 ? { target: name } : {}), file: path, renames: { ...fold, ...fresh.renames }, folds: folded, told })","commits.push({ ...(out.length > 0 ? { target: name } : {}), file: path, renames: { ...keepOld, ...now }, folds: [...keepFolds, ...folded], told })")
body=body.replace("""      if (Object.keys(one.renames).length > 0) {
        renameMap = { ...renameMap, [one.file]: { ...(renameMap[one.file] ?? {}), ...one.renames } }
      }
      if (one.folds.length > 0) {
        foldMap = { ...foldMap, [one.file]: [...new Set([...(foldMap[one.file] ?? []), ...one.folds])] }
      }""","""      // Always replaced, an empty one too: a file copied again must not keep an older renumbering.
      renameMap = { ...renameMap, [one.file]: one.renames }
      foldMap = { ...foldMap, [one.file]: [...new Set(one.folds)] }""")
body=body.replace("const fresh = sources.map(one =>","const fresh = sources.filter(one => !unreadable.has(one.path)).map(one =>")
body=body.replace("""${skipped.size === 0 ? ' The old folders are off the board.' : ''}${told.length > 0 ? ` ${told.map(line => line.slice(2)).join('; ')}` : ''}`)""","""${skipped.size === 0 && unreadable.size === 0 ? ' The old folders are off the board.' : ''}${told.length > 0 ? ` Renumbered: ${told.map(line => line.slice(2)).join('; ')}` : ''}`)""")
s=s[:a]+body+s[b:]
# coverageOf strict listing: list failure -> undefined entry
rep("""  const out = new Map<string, FileCover[]>()
  for (const dup of folders) {
    const files: FileCover[] = []
    for (const name of await mdFiles($, dup.path)) {""","""  const out = new Map<string, FileCover[] | undefined>()
  for (const dup of folders) {
    const files: FileCover[] = []
    // A folder that will not list is not judged: nothing is known of it.
    const names = await mdFiles($, dup.path, true).catch(() => undefined)
    if (names === undefined) {
      out.set(dup.path, undefined)
      continue
    }
    for (const name of names) {""")
rep("Promise<Map<string, FileCover[]>> {\n  const have","Promise<Map<string, FileCover[] | undefined>> {\n  const have")
open(p,'w').write(s)
