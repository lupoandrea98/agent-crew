import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, FileTouch } from '../types'
import { baseName, cardSvg, colorFor } from './cards'
import { CLAUDE_COLUMNS, CLAUDE_ROWS, asciiClaude, claudeCells, claudeSvg, pixelBar } from './claudes'
import { colorForPct, formatReset, labelFor, pickLimits } from './usage'
import {
  IGNORED,
  applyPlan,
  deletedPaths,
  isAnyRunning,
  lineCount,
  progress,
  relPath,
  touch,
  treeRows,
} from './worktree'

const PANE = 'agent-crew'
const MAIN = 'main'
const COLORS = ['yellow', 'cyan', 'magenta', 'green', 'blue', 'red'] as const
const PLAN_TOOLS = new Set(['TodoWrite', 'mcp__ccd_turn__update_plan'])
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])
const TICK_MS = 250

// Il frame d'animazione deriva dall'orologio: nessuno stato da salvare, il timer chiede solo il ridisegno.
let ticker: { cancel: () => void } | undefined
// Tiene vivo il conto alla rovescia dei reset anche a riposo.
let usageTicker: { cancel: () => void } | undefined

// Cambia il tag quando cambiano i campi di uno stato: scarta ciò che una versione precedente ha salvato.
const agents = atom({ plugin: 'agent-crew', key: 'agents' } as const, [], { shape: 'agents-2' })
const files = atom({ plugin: 'agent-crew', key: 'files' } as const, [], { shape: 'files-1' })
const tree = atom({ plugin: 'agent-crew', key: 'tree' } as const, [], { shape: 'tree-1' })
const cwdAtom = atom({ plugin: 'agent-crew', key: 'cwd' } as const, '', { shape: 'cwd-1' })
const limits = atom({ plugin: 'agent-crew', key: 'limits' } as const, [], { shape: 'limits-1' })
const worktreeOpen = atom({ plugin: 'agent-crew', key: 'worktreeOpen' } as const, true, { shape: 'worktree-open-1' })

const blank = (
  id: string,
  label: string,
  type: string,
  model: string,
  slot: number,
  status: AgentRow['status'] = 'running',
): AgentRow => ({
  id,
  label,
  type,
  model,
  status,
  done: 0,
  total: 0,
  source: 'plan',
  calls: 0,
  plan: [],
  slot,
})

const withMain = (list: AgentRow[]): AgentRow[] =>
  list.some(a => a.id === MAIN) ? list : [blank(MAIN, 'Main agent', 'main', '…', 0, 'idle'), ...list]

const patch = (id: string, fn: (a: AgentRow) => Partial<AgentRow>) => (list: AgentRow[]) =>
  withMain(list).map(a => (a.id === id ? { ...a, ...fn(a) } : a))

const colorOf = (list: AgentRow[], id: string) =>
  id === MAIN ? '#D97757' : COLORS[(list.find(a => a.id === id)?.slot ?? 0) % COLORS.length]

const nameColor = (a: AgentRow) => (a.id === MAIN ? '#D97757' : COLORS[a.slot % COLORS.length])

async function loadTree($: any, cwd: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, prefix: string, depth: number) => {
    if (depth > 3 || out.length >= 300) return
    let entries: Array<{ name: string; kind: string }> = []
    try {
      entries = await $.fs.list(dir)
    } catch {
      return
    }
    for (const en of entries) {
      if (IGNORED.has(en.name) || out.length >= 300) continue
      if (en.kind === 'dir') {
        out.push(`${prefix}${en.name}/`)
        await walk(`${dir}/${en.name}`, `${prefix}${en.name}/`, depth + 1)
      } else if (en.kind === 'file') {
        out.push(`${prefix}${en.name}`)
      }
    }
  }
  await walk(cwd, '', 0)
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'crew',
      description: 'Apre il pannello con i Claude di main agent e subagent',
    })
    await update($, cwdAtom, () => e.cwd)
    await update($, agents, withMain)
    await update($, tree, () => [])
    void loadTree($, e.cwd).then(t => update($, tree, () => t))
    void $.ui.open({ id: PANE, title: 'Agent crew' })

    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => {
      // Niente ridisegni a lavoro concluso: l'ultimo frame resta fermo.
      void read($, agents).then(list => {
        if (isAnyRunning(list)) $.ui.invalidate('ui.render')
      })
    })

    usageTicker?.cancel()
    usageTicker = $.clock.every(60_000, () => {
      $.ui.invalidate('ui.render')
    })
    void $.session
      .usage()
      .then(u => update($, limits, () => pickLimits(u.rateLimits)))
      .catch(() => undefined)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, limits, () => pickLimits(e.rateLimits))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    ticker?.cancel()
    ticker = undefined
    usageTicker?.cancel()
    usageTicker = undefined

    return next(e)
  })

  on('command.run', { command: 'crew' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent crew' })

    return { text: 'Pannello Agent crew aperto.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    if (res.agentId) {
      await update($, agents, list => {
        const base = withMain(list)
        return [
          ...base,
          blank(res.agentId as string, e.description || e.subagentType, e.subagentType, res.model, base.length),
        ]
      })
    }

    return res
  })

  on('prompt.submit', async ($, e, next) => {
    // Una nuova richiesta di lavoro (non uno slash command) riparte da zero:
    // via gli agent conclusi e le loro barre, via le card dei file.
    if (!(e as unknown as { command?: unknown }).command) {
      await update($, agents, list => {
        const kept = list.filter(a => a.id === MAIN || a.status === 'running')
        return withMain(kept).map((a, i) =>
          a.id === MAIN
            ? { ...blank(MAIN, 'Main agent', 'main', a.model, 0), status: 'running' as const }
            : { ...a, slot: i },
        )
      })
      await update($, files, () => [])
      await update($, worktreeOpen, () => true)
      const cwd = await read($, cwdAtom)
      void loadTree($, cwd).then(t => update($, tree, () => t))
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, agents, patch(e.agentId ?? MAIN, () => ({ status: 'running' })))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    await update($, agents, patch(e.agentId ?? MAIN, () => ({ model: e.model })))

    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const tool = String(e.tool)
    const args = e as unknown as Record<string, any>
    await update($, agents, patch(id, a => ({ calls: a.calls + 1 })))

    if (PLAN_TOOLS.has(tool)) {
      // TodoWrite porta `todos`, update_plan `items` (o advance/done/start).
      const items = args.items ?? args.todos
      await update($, agents, patch(id, a => {
        const plan = applyPlan(a.plan, { ...args, items })
        return {
          plan,
          total: plan.length,
          done: plan.filter(s => s === 'completed').length,
          source: plan.length > 0 ? 'plan' : a.source,
        }
      }))
    }

    if (FILE_TOOLS.has(tool)) {
      const cwd = await read($, cwdAtom)
      const raw = args.file_path ?? args.notebook_path
      if (typeof raw === 'string') {
        const path = relPath(cwd, raw)
        // Un Write su un file già presente nel worktree lo sovrascrive: conta come modifica.
        const existed = tool === 'Write' && (await read($, tree)).includes(path)
        const kind = tool === 'Edit' || tool === 'NotebookEdit' || existed ? 'edit' : tool === 'Write' ? 'write' : 'read'
        await update($, files, list => touch(list, { path, agentId: id, kind, status: 'active' }, Date.now()))
        const ran = await next(e)
        const added = tool === 'Edit' ? lineCount(args.new_string) : tool === 'Write' ? lineCount(args.content) : 0
        const removed = tool === 'Edit' ? lineCount(args.old_string) : 0
        await update($, files, list =>
          touch(list, { path, agentId: id, kind, status: 'done', added, removed }, Date.now()),
        )

        return ran
      }
    }

    if (tool === 'Bash' && typeof args.command === 'string') {
      const cwd = await read($, cwdAtom)
      const targets = deletedPaths(args.command)
        .map(p => (p.startsWith('/') && !(cwd && p.startsWith(cwd)) ? '' : relPath(cwd, p).replace(/^(\.\/)+/, '')))
        .filter(p => p !== '' && !p.startsWith('..') && !p.endsWith('/'))
      if (targets.length > 0) {
        const ran = await next(e)
        for (const path of targets) {
          const slash = path.lastIndexOf('/')
          const dir = slash >= 0 ? `${cwd}/${path.slice(0, slash)}` : cwd
          const name = path.slice(slash + 1)
          let gone = true
          try {
            const entries: Array<{ name: string }> = await $.fs.list(dir)
            gone = !entries.some(en => en.name === name)
          } catch {
            gone = true
          }
          if (gone) {
            await update($, files, list => touch(list, { path, agentId: id, kind: 'delete', status: 'done' }, Date.now()))
          }
        }

        return ran
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // Fine turno: l'agente è concluso (anche il main) e la sua barra va al 100%.
    // Un id che non è tra gli agenti noti (o assente) è il turno del main: va comunque chiuso.
    const known = await read($, agents)
    const id = e.agentId && known.some(a => a.id === e.agentId) ? e.agentId : MAIN
    const refused = (e as unknown as { reason?: string }).reason === 'refusal'
    await update($, agents, patch(id, a => ({
      status: refused ? 'failed' : 'completed',
      plan: a.plan.map(() => 'completed' as const),
      done: a.plan.length > 0 ? a.plan.length : a.done,
      total: a.plan.length > 0 ? a.plan.length : a.total,
    })))
    // Niente "active" appeso a un agente che ha finito.
    await update($, files, list =>
      list.map(f => (f.agentIds.includes(id) ? { ...f, status: 'done' as const } : f)),
    )
    // A lavoro concluso il worktree si chiude, così si vedono subito i file modificati.
    if (!isAnyRunning(await read($, agents))) await update($, worktreeOpen, () => false)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e) as Record<string, any>
    const { Box, Text, Button } = ui
    // Il ramo si sceglie dalla superficie: nel terminale l'Svg non si disegna, anche se la tabella lo espone.
    const isTerminal = (e as unknown as { surface?: string }).surface === 'terminal'
    const Svg = isTerminal ? undefined : ui.Svg
    const Raster = isTerminal ? ui.Raster : undefined
    const frame = Math.floor((await $.clock.now()) / TICK_MS)
    const list = await read($, agents)
    const touched = await read($, files)
    const paths = await read($, tree)
    const finished = !isAnyRunning(list)
    const edited = touched.filter(f => f.kind !== 'read')
    const nameOf = (id: string) => list.find(a => a.id === id)?.label ?? id
    const isOpen = await read($, worktreeOpen)
    const usage = await read($, limits)
    const now = await $.clock.now()

    const usageBlock = (
      <Box flexDirection="row" gap={2} alignSelf="flex-end">
        {usage.length === 0 ? (
          <Text dimColor>Utilizzo piano n/d</Text>
        ) : (
          usage.map(l => {
            const pct = Math.round(l.percentUsed)
            return (
              <Box key={l.kind} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>{labelFor(l.kind)}</Text>
                  <Text bold color={colorForPct(pct)}>{pct}%</Text>
                </Box>
                <Text color={colorForPct(pct)}>{pixelBar(pct, 10)}</Text>
                <Text dimColor>{formatReset(l.resetsAt, now, l.kind)}</Text>
              </Box>
            )
          })
        )}
      </Box>
    )

    const agentRow = (a: AgentRow) => {
      const { pct, isEstimate } = progress(a)
      return (
        <Box key={a.id} flexDirection="row" gap={1} alignItems="center">
          {Svg ? (
            <Svg source={claudeSvg(a.slot, a.status)} alt={`${a.label}: ${a.status}`} width={32} height={32} isInteractive />
          ) : Raster ? (
            <Raster
              key={`claude-${a.id}`}
              columns={CLAUDE_COLUMNS}
              rows={CLAUDE_ROWS}
              cells={claudeCells(a.slot, a.status, frame)}
            />
          ) : (
            <Box flexDirection="column">
              {asciiClaude(a.slot, a.status, frame).map((line, i) => (
                <Text key={String(i)}>{line}</Text>
              ))}
            </Box>
          )}
          <Box flexDirection="column" flexGrow={1}>
            <Text bold color={nameColor(a)}>{a.label}</Text>
            <Text dimColor>{a.model}</Text>
            <Box flexDirection="row" gap={1}>
              <Text color={a.status === 'completed' ? 'green' : 'cyan'}>{pixelBar(pct)}</Text>
              <Text>{pct === null ? '…' : `${isEstimate ? '~' : ''}${pct}%`}</Text>
            </Box>
          </Box>
        </Box>
      )
    }

    const paneProps = (e as unknown as {
      props?: { bodyColumns?: number; placement?: string; scroll?: { bodyRows?: number } }
    }).props
    const cols = paneProps?.bodyColumns ?? 40
    // Agganciato di lato il corpo riempie l'altezza del pannello, così lo spacer spinge l'utilizzo in fondo.
    const minHeight = paneProps?.placement === 'dock' ? paneProps.scroll?.bodyRows : undefined
    const cardWidth = Math.max(180, cols * 8 - 16)
    const touchLabel = (f: FileTouch) =>
      f.kind === 'delete' ? 'eliminato' : f.kind === 'write' ? 'creato' : 'modificato'

    return (
      <Box flexDirection="column" gap={1} flexGrow={1} minHeight={minHeight}>
        {list.filter(a => a.status !== 'idle').map(agentRow)}
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Button key="worktree-toggle" plain onPress={() => void update($, worktreeOpen, o => !o)}>
            <Text bold>{isOpen ? '▾' : '▸'} Worktree</Text>
          </Button>
          {isOpen &&
            treeRows(paths, touched).map(r => {
              const t = r.touch
              const mark = !t ? '  ' : t.status === 'active' ? '▶ ' : t.kind === 'delete' ? '✗ ' : '✓ '
              const color = t ? colorOf(list, t.agentIds[t.agentIds.length - 1] ?? MAIN) : undefined
              return (
                <Text key={r.path} color={color} bold={t?.status === 'active'} dimColor={!t}>
                  {'  '.repeat(r.depth)}{mark}{r.name}{r.isDir ? '/' : ''}
                </Text>
              )
            })}
        </Box>
        {finished && edited.length > 0 && (
          <Text dimColor>Lavoro concluso: {edited.length} file toccati.</Text>
        )}
        {finished &&
          edited.map(f => {
            const name = baseName(f.path)
            const c = colorFor(name)
            const who = `${touchLabel(f)} da ${f.agentIds.map(nameOf).join(', ')}`
            const removedFile = f.kind === 'delete'
            return Svg ? (
              <Svg
                key={f.path}
                source={cardSvg({
                  path: f.path,
                  width: cardWidth,
                  lines: removedFile
                    ? [{ text: who, color: '#e5534b' }]
                    : [
                        { text: who },
                        { text: `+${f.added}  −${f.removed}`, color: f.removed > f.added ? '#e5534b' : '#57ab5a' },
                      ],
                })}
                alt={removedFile ? `${name}: ${who}` : `${name}: ${who}, +${f.added} −${f.removed}`}
                width={cardWidth}
              />
            ) : (
              <Box key={f.path} flexDirection="column" borderStyle="bold" borderColor={removedFile ? 'red' : c.border} paddingX={1}>
                <Text bold color={removedFile ? 'red' : c.text}>{name}</Text>
                <Text dimColor={!removedFile} color={removedFile ? 'red' : undefined}>{who}</Text>
                {!removedFile && (
                  <Text>
                    <Text color="green">+{f.added}</Text> <Text color="red">−{f.removed}</Text>
                  </Text>
                )}
              </Box>
            )
          })}
        <Box flexGrow={1} />
        {usageBlock}
      </Box>
    )
  })
}
