/** The links of agents to todo items: by ID, by claim, by Haiku match or by quoted text. */

import type { AgentRow, TodoFile, TodoItem } from '../types'
import { isEnded } from './agent-ends'
import { claimInfo, itemInfo, scoreInfo } from './claim-score'
import type { ItemInfo } from './claim-score'
import { fileId } from './item-keys'

const LINK_MIN_CHARS = 12

/** `file` is the file's pane ID (its folder and name), `index` the item's place in it. */
export type Link = { file: string; index: number; item: TodoItem }

/**
 * Which open todo items each live agent works on: every item whose ID (`#T12`, as a whole ID, so
 * `#T1` does not match `#T12`) its description or prompt names, and every item it claimed through
 * `report_progress` (by ID, quote or close paraphrase); when there is none, the first open item
 * whose text the prompt quotes. Ended agents and archived files link to nothing.
 */
export function linkAgents(list: readonly TodoFile[], rows: readonly AgentRow[]): Map<string, Link[]> {
  const index = linkIndexFor(list)
  const links = new Map<string, Link[]>()
  const seen = new Set<string>()
  const asked = new Set<string>()
  for (const row of rows) {
    if (isEnded(row.status)) {
      continue
    }
    seen.add(row.id)
    for (const claim of [...(row.claims ?? []), ...(row.autoClaims ?? [])]) {
      asked.add(claimKey(claim))
    }
    asked.add(briefKey(row.brief))
    const found = memoLinks(index, row)
    if (found.length > 0) {
      links.set(row.id, found)
    }
  }
  // Rows that left the list leave the memo, and claims and briefs no row has leave the best-item
  // cache, so neither grows over a long session.
  for (const id of [...index.byRow.keys()]) {
    if (!seen.has(id)) {
      index.byRow.delete(id)
    }
  }
  for (const key of [...bestCache.keys()]) {
    if (!asked.has(key)) {
      bestCache.delete(key)
    }
  }

  return links
}

/**
 * The links of one row as linkAgents gives them, for a row outside the list being drawn (an ended
 * agent read as live, UCR-090). It never clears the memo of the other rows, so the next redraw
 * stays warm.
 */
export function linkOne(list: readonly TodoFile[], row: AgentRow): Link[] {
  return isEnded(row.status) ? [] : linkRow(linkIndexFor(list), row)
}

/** The row's links from the memo when its brief and claims are as last time (the memo lives as long as the todo version). */
function memoLinks(index: LinkIndex, row: AgentRow): Link[] {
  const sig = `${row.brief}\u0000${(row.claims ?? []).join('\u0001')}\u0000${(row.autoClaims ?? []).join('\u0001')}`
  let memo = index.byRow.get(row.id)
  if (memo === undefined || memo.sig !== sig) {
    memo = { sig, found: linkRow(index, row) }
    index.byRow.set(row.id, memo)
  }

  return memo.found
}

/** The open items of one todo version, each prepared once, with an ID map; plus the per-agent memo. */
type LinkIndex = {
  files: readonly TodoFile[]
  items: readonly (readonly TodoItem[])[]
  counts: readonly number[]
  open: { link: Link; info: ItemInfo; content: string }[]
  byId: Map<string, Link[]>
  byRow: Map<string, { sig: string; found: Link[] }>
  /** This version's number, and the first place in `open` of each item content (ID and text). */
  version: number
  firstAt: Map<string, number>
  /** The version before this one, and the first places in `open` of the contents it did not have. */
  prevVersion: number
  added: readonly number[]
}

let linkIndex: LinkIndex | undefined
let versions = 0

/** What a score depends on: the item's ID and text. Two items with one content score the same against any claim. */
function contentOf(item: TodoItem): string {
  return `${item.id?.toLowerCase() ?? ''}\u0000${item.text}`
}

/** The index for `list`; rebuilt when a file or its items array was replaced (every scan makes new ones) or an item count changed. */
function linkIndexFor(list: readonly TodoFile[]): LinkIndex {
  const last = linkIndex
  if (last !== undefined && last.files.length === list.length && list.every((file, i) => last.files[i] === file && last.items[i] === file.items && last.counts[i] === file.items.length)) {
    return last
  }
  const open: LinkIndex['open'] = []
  const byId = new Map<string, Link[]>()
  const firstAt = new Map<string, number>()
  for (const file of list) {
    if (file.isArchived === true) {
      continue
    }
    const id = fileId(file)
    file.items.forEach((item, index) => {
      if (item.status === 'completed') {
        return
      }
      const link = { file: id, index, item }
      const content = contentOf(item)
      if (!firstAt.has(content)) {
        firstAt.set(content, open.length)
      }
      open.push({ link, info: itemInfo(item), content })
      if (item.id !== undefined) {
        const key = item.id.toLowerCase()
        byId.set(key, [...(byId.get(key) ?? []), link])
      }
    })
  }
  const added = [...firstAt.values()].filter(at => last === undefined || !last.firstAt.has(open[at]!.content))
  versions += 1
  const built: LinkIndex = { files: [...list], items: list.map(file => file.items), counts: list.map(file => file.items.length), open, byId, byRow: new Map(), version: versions, firstAt, prevVersion: last?.version ?? -1, added }
  linkIndex = built

  return built
}

/**
 * The best open item of each claim (and the first item each brief quotes), kept across todo
 * versions (UCR-090): `top` is the best score, `ties` the contents that reach it. The next version
 * scores only the contents that are new in it, since every other content scores as before. When
 * every best content left, the claim is scored over all items again.
 */
type Best = { version: number; top: number; ties: string[] }
const bestCache = new Map<string, Best>()

const claimKey = (claim: string) => `c\u0000${claim}`
const briefKey = (brief: string) => `b\u0000${brief}`

/** How many item scores the linking has computed: the measure of its work, for the tests. */
let scored = 0
export function linkWork(): number {
  return scored
}

/** Forgets every cached link, as a fresh load of the module would: for the tests' cold runs. */
export function resetLinkCache(): void {
  linkIndex = undefined
  bestCache.clear()
}

/** Scores the contents at `places` into `best`: a higher score starts the ties over, an equal one joins them. */
function scoreInto(best: Best, index: LinkIndex, places: Iterable<number>, scoreOf: (info: ItemInfo) => number): Best {
  let out = best
  for (const at of places) {
    const one = index.open[at]!
    scored += 1
    const score = scoreOf(one.info)
    if (score > out.top) {
      out = { ...out, top: score, ties: [one.content] }
    } else if (score > 0 && score === out.top) {
      out.ties.push(one.content)
    }
  }

  return out
}

/** The first open item with the highest score above 0, as a plain scan in list order finds it. */
function bestOpen(index: LinkIndex, key: string, scoreOf: (info: ItemInfo) => number): Link | undefined {
  const cached = bestCache.get(key)
  let best: Best
  if (cached !== undefined && cached.version === index.version) {
    best = cached
  } else {
    const live = cached?.ties.filter(content => index.firstAt.has(content)) ?? []
    best =
      cached !== undefined && cached.version === index.prevVersion && (cached.top === 0 || live.length > 0)
        ? scoreInto({ version: index.version, top: cached.top, ties: live }, index, index.added, scoreOf)
        : scoreInto({ version: index.version, top: 0, ties: [] }, index, index.firstAt.values(), scoreOf)
    bestCache.set(key, best)
  }
  let first: number | undefined
  for (const content of best.ties) {
    const at = index.firstAt.get(content)
    if (at !== undefined && (first === undefined || at < first)) {
      first = at
    }
  }

  return first === undefined ? undefined : index.open[first]!.link
}

/** The links of one live agent: by ID, by claim, else by the first item whose text the brief quotes. */
function linkRow(index: LinkIndex, row: AgentRow): Link[] {
  const found: Link[] = []
  const add = (link: Link) => {
    if (!found.some(one => one.file === link.file && one.index === link.index)) {
      found.push(link)
    }
  }
  // IDs in the brief: one scan, each looked up in the ID map; list order is kept, as the old filter gave it.
  const named = new Set([...row.brief.matchAll(/#([0-9a-z]+)/g)].map(match => match[1]!))
  const byId = [...named].flatMap(id => index.byId.get(id) ?? [])
  if (byId.length > 1) {
    const rank = new Map(index.open.map((one, at) => [one.link, at] as const))
    byId.sort((x, y) => rank.get(x)! - rank.get(y)!)
  }
  byId.forEach(add)
  for (const claim of [...(row.claims ?? []), ...(row.autoClaims ?? [])]) {
    const info = claimInfo(claim)
    const best = bestOpen(index, claimKey(claim), one => scoreInfo(info, one))
    if (best !== undefined) {
      add(best)
    }
  }
  if (found.length === 0) {
    const one = bestOpen(index, briefKey(row.brief), info => (info.t.length >= LINK_MIN_CHARS && row.brief.includes(info.t) ? 1 : 0))
    if (one !== undefined) {
      found.push(one)
    }
  }

  return found
}
