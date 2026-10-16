p='hooks/register.tsx'
s=open(p).read()
a=s.index("async function deleteDuplicates($: EngineInterface)")
i=s.index("    const have = new Map<string, Map<string, number>>()", a)
j=s.index("    const run = async (argv: string[])", a)
s=s[:i]+s[j:]
i=s.index("    for (const dup of dupFolders) {\n      if (!(await isTrustedFolder", a)
j=s.index("      for (const file of verified) {", a)
new='''    // Only trusted folders are judged, with the same coverage rule the board uses.
    const trusted: typeof dupFolders = []
    const kept: string[] = []
    for (const dup of dupFolders) {
      if (await isTrustedFolder($, dup.path, central, realCentral)) {
        trusted.push(dup)
      } else {
        kept.push(`${dup.path} (not a folder this mod may delete from)`)
      }
    }
    const cover = await coverageOf($, central, trusted)
    let removed = 0
    for (const dup of trusted) {
      const verified: { path: string; text: string }[] = []
      // A folder that will not list keeps everything, its book too: nothing is known gone.
      const judged = cover.get(dup.path)
      let isAllGone = judged !== undefined
      for (const file of judged ?? []) {
        if (file.state === 'covered' && (await isPlainFile($, file.path))) {
          verified.push({ path: file.path, text: file.text })
        } else {
          isAllGone = false
          kept.push(file.path)
        }
      }
'''
s=s[:i]+new+s[j:]
# remove old duplicated declarations of kept/removed before loop
open(p,'w').write(s)
