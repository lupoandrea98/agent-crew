import { expect, test } from 'claude-code/testing'

import type { AgentRow, FileTouch } from '../types'
import { applyPlan, deletedPaths, deletedTargets, diffLines, progress, relPath, touch, treeRows } from './worktree'

const agent = (over: Partial<AgentRow> = {}): AgentRow => ({
  id: 'a1',
  label: 'Helper',
  model: 'haiku',
  status: 'running',
  done: 0,
  total: 0,
  calls: 0,
  plan: [],
  slot: 1,
  ...over,
})

const file = (path: string, over: Partial<FileTouch> = {}): FileTouch => ({
  path,
  agentIds: ['a1'],
  kind: 'edit',
  status: 'done',
  added: 0,
  removed: 0,
  at: 0,
  ...over,
})

test('relPath: percorso relativo al cwd, senza falsi prefissi e con separatori Windows', async () => {
  expect(relPath('/w', '/w/a/b.ts')).toBe('a/b.ts')
  // Il prefisso "/w" non deve catturare "/w2": la cartella e' un'altra.
  expect(relPath('/w', '/w2/x.ts')).toBe('w2/x.ts')
  expect(relPath('/w/', '/w/a.ts')).toBe('a.ts')
  expect(relPath('C:\\proj', 'C:\\proj\\hooks\\usage.ts')).toBe('hooks/usage.ts')
  // Un percorso gia' relativo resta cosi'.
  expect(relPath('/w', 'a/b.ts')).toBe('a/b.ts')
})

test('deletedPaths: rm, git rm e unlink, con opzioni, sudo e comandi concatenati', async () => {
  expect(deletedPaths('rm -rf a.ts b.ts')).toEqual(['a.ts', 'b.ts'])
  expect(deletedPaths('git rm x.ts && echo ok')).toEqual(['x.ts'])
  expect(deletedPaths('sudo unlink y')).toEqual(['y'])
  // Glob e variabili non si possono risolvere: niente percorsi.
  expect(deletedPaths('rm *.ts $F')).toEqual([])
  expect(deletedPaths('echo ciao')).toEqual([])
})

test('deletedTargets: solo percorsi dentro il cwd, relativi e senza cartelle', async () => {
  expect(deletedTargets('/w', 'rm /w/a.ts')).toEqual(['a.ts'])
  expect(deletedTargets('/w', 'rm /etc/x')).toEqual([])
  expect(deletedTargets('/w', 'rm ../x')).toEqual([])
  expect(deletedTargets('/w', 'rm ./a.ts')).toEqual(['a.ts'])
  expect(deletedTargets('/w', 'rm dir/')).toEqual([])
  expect(deletedTargets('C:/proj', 'rm C:/other/x')).toEqual([])
})

test('touch: nuovo file, poi fusione sullo stesso percorso', async () => {
  const created = touch([], { path: 'a.ts', agentId: 'm', kind: 'write', status: 'done', added: 3, removed: 0 }, 10)
  expect(created).toEqual([
    { path: 'a.ts', agentIds: ['m'], kind: 'write', status: 'done', added: 3, removed: 0, at: 10 },
  ])

  // Stesso agente: un solo id. Agente diverso: si aggiunge.
  const sameAgent = touch(created, { path: 'a.ts', agentId: 'm', kind: 'write', status: 'done' }, 11)
  expect(sameAgent[0]!.agentIds).toEqual(['m'])
  const otherAgent = touch(sameAgent, { path: 'a.ts', agentId: 'a1', kind: 'write', status: 'done' }, 12)
  expect(otherAgent[0]!.agentIds).toEqual(['m', 'a1'])

  // Il tipo piu' forte vince: edit poi read resta edit; read poi edit diventa edit.
  const edited = touch([], { path: 'b.ts', agentId: 'm', kind: 'edit', status: 'done', added: 1, removed: 1 }, 1)
  const thenRead = touch(edited, { path: 'b.ts', agentId: 'm', kind: 'read', status: 'done' }, 2)
  expect(thenRead[0]!.kind).toBe('edit')
  const read = touch([], { path: 'c.ts', agentId: 'm', kind: 'read', status: 'active' }, 1)
  const thenEdit = touch(read, { path: 'c.ts', agentId: 'm', kind: 'edit', status: 'done' }, 2)
  expect(thenEdit[0]!.kind).toBe('edit')

  // Le righe si sommano solo quando il tool e' finito (status 'done').
  const active = touch([], { path: 'd.ts', agentId: 'm', kind: 'edit', status: 'active' }, 1)
  const stillActive = touch(active, { path: 'd.ts', agentId: 'm', kind: 'edit', status: 'active', added: 5, removed: 2 }, 2)
  expect(stillActive[0]!.added).toBe(0)
  expect(stillActive[0]!.removed).toBe(0)
  const finished = touch(stillActive, { path: 'd.ts', agentId: 'm', kind: 'edit', status: 'done', added: 2, removed: 1 }, 3)
  expect(finished[0]).toMatchObject({ added: 2, removed: 1, status: 'done', at: 3 })
})

test('diffLines: conta solo le righe davvero cambiate', async () => {
  expect(diffLines('a\nb\nc', 'a\nX\nc')).toEqual({ added: 1, removed: 1 })
  expect(diffLines('a\nb', 'a\nb')).toEqual({ added: 0, removed: 0 })
  expect(diffLines('', 'x\ny')).toEqual({ added: 2, removed: 0 })
  expect(diffLines('x\ny', '')).toEqual({ added: 0, removed: 2 })
  expect(diffLines(undefined, undefined)).toEqual({ added: 0, removed: 0 })
  expect(diffLines('a', 'b\nc')).toEqual({ added: 2, removed: 1 })
})

test('diffLines: ripiego su testi enormi, con una sola riga cambiata in mezzo', async () => {
  // 600 x 600 righe superano la soglia della tabella: si usa prefisso e suffisso comuni.
  const lines = Array.from({ length: 600 }, (_, i) => `riga ${i}`)
  const changed = [...lines]
  changed[300] = 'riga cambiata'
  expect(diffLines(lines.join('\n'), changed.join('\n'))).toEqual({ added: 1, removed: 1 })
})

test('applyPlan: items completo, advance, done (1-based) e start', async () => {
  const start = ['pending', 'pending', 'pending'] as const
  // items completo: stati sconosciuti diventano pending.
  expect(applyPlan([...start], { items: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'boh' }] })).toEqual([
    'completed',
    'in_progress',
    'pending',
  ])
  // advance: chiude quello in corso e avvia il successivo in attesa.
  expect(applyPlan(['completed', 'in_progress', 'pending'], { advance: true })).toEqual(['completed', 'completed', 'in_progress'])
  // done: indici 1-based; quelli fuori intervallo sono ignorati.
  expect(applyPlan(['pending', 'in_progress', 'pending'], { done: [1, 3, 9] })).toEqual(['completed', 'in_progress', 'completed'])
  // start: indice 1-based.
  expect(applyPlan(['pending', 'pending'], { start: 2 })).toEqual(['pending', 'in_progress'])
})

test('treeRows: i percorsi toccati restano anche oltre max, con cartelle intermedie e depth', async () => {
  const tree = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']
  const rows = treeRows(tree, [file('z/deep/f.ts')], 2)
  // Il file toccato e le sue cartelle sono sempre presenti, anche se max e' 2.
  expect(rows.map(r => r.path)).toEqual(['z', 'z/deep', 'z/deep/f.ts'])
  expect(rows.find(r => r.path === 'z/deep/f.ts')?.touch).toBeDefined()

  // Cartelle intermedie aggiunte e profondita' corretta.
  const nested = treeRows([], [file('src/hooks/usage.ts')])
  expect(nested).toEqual([
    { name: 'src', depth: 0, isDir: true, path: 'src', touch: undefined },
    { name: 'hooks', depth: 1, isDir: true, path: 'src/hooks', touch: undefined },
    { name: 'usage.ts', depth: 2, isDir: false, path: 'src/hooks/usage.ts', touch: nested[2]?.touch },
  ])
  expect(nested[2]?.touch?.path).toBe('src/hooks/usage.ts')
})

test('progress: completato, avanzamento reale, stima dai tool call, nessun dato', async () => {
  expect(progress(agent({ status: 'completed' }))).toEqual({ pct: 100, isEstimate: false })
  expect(progress(agent({ done: 3, total: 4 }))).toEqual({ pct: 75, isEstimate: false })

  const est = progress(agent({ calls: 3 }))
  expect(est.isEstimate).toBe(true)
  expect(est.pct).toBe(39)
  // La stima non supera il 90%, anche con tanti tool call.
  const many = progress(agent({ calls: 100 }))
  expect(many.isEstimate).toBe(true)
  expect(many.pct).toBeLessThanOrEqual(90)

  expect(progress(agent())).toEqual({ pct: null, isEstimate: true })
})
