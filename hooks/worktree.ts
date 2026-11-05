import type { AgentRow, FileTouch } from '../types'

export const IGNORED = new Set(['node_modules', '.git', 'dist', '.next', '.DS_Store'])

const slashes = (s: string): string => s.replace(/\\/g, '/')

/** Radice del cwd con `/` come separatore e senza slash finale. */
const rootOf = (cwd: string): string => slashes(cwd).replace(/\/+$/, '')

/** True se `p` (già con `/`) è la radice o sta dentro di essa. */
const isInside = (root: string, p: string): boolean => root !== '' && (p === root || p.startsWith(root + '/'))

export const relPath = (cwd: string, p: string): string => {
  const q = slashes(p)
  const root = rootOf(cwd)
  if (isInside(root, q)) return q.slice(root.length).replace(/^\/+/, '')
  return q.replace(/^\/+/, '')
}

const rank = { read: 0, edit: 1, write: 2, delete: 3 } as const

/** Percorsi eliminati da `rm`, `git rm` o `unlink` in un comando shell; glob e variabili sono ignorati. */
export const deletedPaths = (command: string): string[] => {
  const out: string[] = []
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = (part.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(t => t.replace(/^(["'])(.*)\1$/, '$2'))
    let i = tokens[0] === 'sudo' ? 1 : 0
    if (tokens[i] === 'git' && tokens[i + 1] === 'rm') i += 2
    else if (tokens[i] === 'rm' || tokens[i] === 'unlink') i += 1
    else continue
    for (const t of tokens.slice(i)) {
      if (t.startsWith('-') || /[*?$`]/.test(t)) continue
      out.push(t)
    }
  }
  return out
}

/** Percorsi (relativi al cwd) eliminati da un comando shell; scarta quelli assoluti fuori dal cwd. */
export const deletedTargets = (cwd: string, command: string): string[] => {
  const root = rootOf(cwd)
  return deletedPaths(command)
    .map(p => (/^([A-Za-z]:)?[\\/]/.test(p) && !isInside(root, slashes(p)) ? '' : relPath(cwd, p).replace(/^(\.\/)+/, '')))
    .filter(p => p !== '' && !p.startsWith('..') && !p.endsWith('/'))
}

/** Aggiunge o fonde un accesso a un file; il tipo più "forte" vince. */
export const touch = (
  list: FileTouch[],
  t: { path: string; agentId: string; kind: FileTouch['kind']; status: FileTouch['status']; added?: number; removed?: number },
  now: number,
): FileTouch[] => {
  const found = list.find(f => f.path === t.path)
  if (!found) {
    return [
      ...list,
      {
        path: t.path,
        agentIds: [t.agentId],
        kind: t.kind,
        status: t.status,
        added: t.added ?? 0,
        removed: t.removed ?? 0,
        at: now,
      },
    ]
  }
  return list.map(f =>
    f.path !== t.path
      ? f
      : {
          ...f,
          agentIds: f.agentIds.includes(t.agentId) ? f.agentIds : [...f.agentIds, t.agentId],
          kind: rank[t.kind] > rank[f.kind] ? t.kind : f.kind,
          status: t.status,
          added: f.added + (t.status === 'done' ? (t.added ?? 0) : 0),
          removed: f.removed + (t.status === 'done' ? (t.removed ?? 0) : 0),
          at: now,
        },
  )
}

export const lineCount = (s: unknown): number =>
  typeof s === 'string' && s.length > 0 ? s.split('\n').length : 0

/**
 * Righe aggiunte e tolte da un Edit, contando solo quelle davvero cambiate (sottosequenza comune più lunga),
 * come fa un diff: le righe rimaste uguali in `old_string` e `new_string` non contano.
 */
export const diffLines = (oldText: unknown, newText: unknown): { added: number; removed: number } => {
  const a = typeof oldText === 'string' && oldText.length > 0 ? oldText.split('\n') : []
  const b = typeof newText === 'string' && newText.length > 0 ? newText.split('\n') : []
  // Testi molto lunghi: ripiego sul solo prefisso/suffisso comune, per non pesare sul ridisegno.
  if (a.length * b.length > 250_000) {
    let start = 0
    while (start < a.length && start < b.length && a[start] === b[start]) start++
    let end = 0
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
    return { added: b.length - start - end, removed: a.length - start - end }
  }
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, row[j - 1] ?? 0)
    }
    prev = row
  }
  const common = prev[b.length] ?? 0
  return { added: b.length - common, removed: a.length - common }
}

/** Tipo di accesso di un tool sui file; un Write su un file già presente è una modifica. */
export const fileKind = (tool: string, existed: boolean): FileTouch['kind'] =>
  tool === 'Edit' || tool === 'NotebookEdit' || existed ? 'edit' : tool === 'Write' ? 'write' : 'read'

/** Percentuale stimata dai tool call: sale e si ferma prima del 90%. */
const estimate = (calls: number): number =>
  Math.min(90, Math.round(100 * (1 - Math.pow(0.85, calls))))

export const progress = (a: AgentRow): { pct: number | null; isEstimate: boolean } => {
  if (a.status === 'completed') return { pct: 100, isEstimate: false }
  if (a.total > 0) {
    return { pct: Math.round((a.done / a.total) * 100), isEstimate: false }
  }
  if (a.calls > 0) return { pct: estimate(a.calls), isEstimate: true }
  return { pct: null, isEstimate: true }
}

/** Applica un update_plan (items completo, oppure advance/done/start) a una lista di stati. */
export const applyPlan = (
  prev: AgentRow['plan'],
  input: { items?: Array<{ status?: string }>; advance?: boolean; done?: number[]; start?: number },
): AgentRow['plan'] => {
  const ok = (s?: string): AgentRow['plan'][number] =>
    s === 'completed' || s === 'in_progress' ? s : 'pending'
  let next = input.items ? input.items.map(i => ok(i.status)) : [...prev]
  if (input.advance) {
    const cur = next.indexOf('in_progress')
    if (cur >= 0) next[cur] = 'completed'
    const nxt = next.indexOf('pending')
    if (nxt >= 0) next[nxt] = 'in_progress'
  }
  for (const n of input.done ?? []) if (next[n - 1]) next[n - 1] = 'completed'
  if (input.start && next[input.start - 1]) next[input.start - 1] = 'in_progress'
  return next
}

export type TreeRow = { name: string; depth: number; isDir: boolean; path: string; touch?: FileTouch }

/** Albero in righe piatte: unione di worktree e file toccati, al massimo `max` righe. */
export const treeRows = (tree: string[], files: FileTouch[], max = 40): TreeRow[] => {
  const by = new Map(files.map(f => [f.path, f]))
  const all = new Set<string>(tree)
  for (const f of files) {
    const parts = f.path.split('/')
    for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join('/') + '/')
    all.add(f.path)
  }
  const sorted = [...all].sort((a, b) => a.localeCompare(b))
  const hot = new Set<string>()
  for (const f of files) {
    const parts = f.path.split('/')
    for (let i = 1; i <= parts.length; i++) hot.add(parts.slice(0, i).join('/') + (i < parts.length ? '/' : ''))
  }
  // Prima i percorsi con attività; il resto riempie lo spazio che avanza.
  const keep = new Set<string>(sorted.filter(p => hot.has(p)))
  for (const p of sorted) if (keep.size < max) keep.add(p)
  return sorted
    .filter(p => keep.has(p))
    .map(p => {
      const isDir = p.endsWith('/')
      const clean = isDir ? p.slice(0, -1) : p
      const parts = clean.split('/')
      return { name: parts[parts.length - 1] ?? clean, depth: parts.length - 1, isDir, path: clean, touch: by.get(p) }
    })
}

export const isAnyRunning = (agents: AgentRow[]) => agents.some(a => a.status === 'running')
