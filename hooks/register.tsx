import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, FileTouch } from '../types'
import { baseName, cardHeight, cardSvg, colorFor } from './cards'
import { CLAUDE_COLUMNS, CLAUDE_ROWS, asciiClaude, claudeCells, claudeSvg, pixelBar, pixelBarParts } from './claudes'
import { ICONS, ICON_COLUMNS, ICON_ROWS, iconCells, iconSvg } from './icons'
import type { IconKind } from './icons'
import {
  contextPct,
  formatReset,
  hudKindFor,
  hudLayout,
  labelFor,
  lifeColor,
  pickLimits,
  remainingPct,
  sideColor,
} from './usage'
import {
  IGNORED,
  applyPlan,
  deletedPaths,
  diffLines,
  fileKind,
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
// Origini di un prompt che non è una nuova richiesta della persona (PromptOrigin.kind).
const AUTOMATIC_ORIGINS = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'coordinator',
  'observer',
  'observer-activity',
  'auto-continuation',
])

// Il frame d'animazione deriva dall'orologio: nessuno stato da salvare, il timer chiede solo il ridisegno.
let ticker: { cancel: () => void } | undefined
// Solo il terminale usa il frame: sul desktop lo sprite si anima da sé e i ridisegni a 4 Hz fanno scattare lo scroll.
let terminalSeen = false
// Tiene vivo il conto alla rovescia dei reset anche a riposo.
let usageTicker: { cancel: () => void } | undefined

// Cambia il tag quando cambiano i campi di uno stato: scarta ciò che una versione precedente ha salvato.
const agents = atom({ plugin: 'agent-crew', key: 'agents' } as const, [], { shape: 'agents-2' })
const files = atom({ plugin: 'agent-crew', key: 'files' } as const, [], { shape: 'files-1' })
const tree = atom({ plugin: 'agent-crew', key: 'tree' } as const, [], { shape: 'tree-1' })
const cwdAtom = atom({ plugin: 'agent-crew', key: 'cwd' } as const, '', { shape: 'cwd-1' })
const limits = atom({ plugin: 'agent-crew', key: 'limits' } as const, [], { shape: 'limits-1' })
const context = atom({ plugin: 'agent-crew', key: 'context' } as const, { percent: null }, { shape: 'context-1' })
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

const agentColor = (a: Pick<AgentRow, 'id' | 'slot'>) => (a.id === MAIN ? '#D97757' : COLORS[a.slot % COLORS.length])

const colorOf = (list: AgentRow[], id: string) => agentColor({ id, slot: list.find(a => a.id === id)?.slot ?? 0 })

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

/** True se `path` (relativo a `cwd`) non è più nella sua cartella. */
async function isGone($: any, cwd: string, path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? `${cwd}/${path.slice(0, slash)}` : cwd
  const name = path.slice(slash + 1)
  try {
    const entries: Array<{ name: string }> = await $.fs.list(dir)
    return !entries.some(en => en.name === name)
  } catch {
    return true
  }
}

/** Rilegge l'utilizzo e aggiorna i dati solo se la lettura ne contiene: una lettura vuota non cancella quelli noti. */
async function refreshUsage($: any): Promise<boolean> {
  try {
    const u = await $.session.usage()
    const lim = pickLimits(u.rateLimits ?? [])
    const pct = contextPct(u.context)
    if (lim.length > 0) await update($, limits, () => lim)
    if (pct !== null) await update($, context, () => ({ percent: pct }))
    if (lim.length > 0 || pct !== null) $.ui.invalidate('ui.render')
    return lim.length > 0 && pct !== null
  } catch {
    return false
  }
}

// Subito dopo l'avvio la sessione puo' non essere ancora legata o non avere una lettura: si riprova a distanza.
const USAGE_RETRY_MS = [500, 2000, 5000]
let usageRetries: Array<{ cancel: () => void }> = []
const cancelUsageRetries = () => {
  usageRetries.forEach(t => t.cancel())
  usageRetries = []
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
        if (terminalSeen && isAnyRunning(list)) $.ui.invalidate('ui.render')
      })
    })

    usageTicker?.cancel()
    usageTicker = $.clock.every(60_000, () => {
      $.ui.invalidate('ui.render')
      void refreshUsage($)
    })
    // Lettura iniziale, con qualche ripetizione finche' non arriva un dato completo.
    cancelUsageRetries()
    void refreshUsage($).then(complete => {
      if (complete) return
      usageRetries = USAGE_RETRY_MS.map(ms =>
        $.clock.after(ms, () => {
          void refreshUsage($)
        }),
      )
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, limits, () => pickLimits(e.rateLimits))
    await update($, context, () => ({ percent: contextPct(e.context) }))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    ticker?.cancel()
    ticker = undefined
    usageTicker?.cancel()
    usageTicker = undefined
    cancelUsageRetries()

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
    // Una nuova richiesta della persona (non uno slash command) riparte da zero:
    // via gli agent conclusi e le loro barre, via le card dei file.
    // Le consegne automatiche (rapporto di un subagent, notifica di task, altra sessione) non azzerano nulla,
    // altrimenti il rapporto di un subagent cancellerebbe i file che ha appena modificato.
    const { command, isMeta, origin } = e as unknown as { command?: unknown; isMeta?: boolean; origin?: { kind?: string } }
    if (!command && !isMeta && !AUTOMATIC_ORIGINS.has(origin?.kind ?? '')) {
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
    void refreshUsage($)

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
        const kind = fileKind(tool, existed)
        await update($, files, list => touch(list, { path, agentId: id, kind, status: 'active' }, Date.now()))
        const ran = await next(e)
        // Edit: solo le righe davvero cambiate, come il diff nativo; Write: tutte le righe del contenuto.
        const edit = tool === 'Edit' ? diffLines(args.old_string, args.new_string) : undefined
        const added = edit ? edit.added : tool === 'Write' ? lineCount(args.content) : 0
        const removed = edit ? edit.removed : 0
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
          if (await isGone($, cwd, path)) {
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
    if (isTerminal) terminalSeen = true
    const now = await $.clock.now()
    const frame = Math.floor(now / TICK_MS)
    const list = await read($, agents)
    const touched = await read($, files)
    const paths = await read($, tree)
    const finished = !isAnyRunning(list)
    const edited = touched.filter(f => f.kind !== 'read')
    const nameOf = (id: string) => list.find(a => a.id === id)?.label ?? id
    const isOpen = await read($, worktreeOpen)

    const agentRow = (a: AgentRow) => {
      const { pct, isEstimate } = progress(a)
      return (
        <Box key={a.id} flexDirection="row" gap={1} alignItems="center">
          {Svg ? (
            // Il frame interattivo serve solo all'animazione: a lavoro fermo basta un'immagine, che non cattura la rotella.
            <Svg
              key={`claude-${a.id}-${a.status}`}
              source={claudeSvg(a.slot, a.status)}
              alt={`${a.label}: ${a.status}`}
              width={32}
              height={32}
              isInteractive={a.status === 'running'}
            />
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
            <Text bold color={agentColor(a)}>{a.label}</Text>
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

    const cardWidth = Math.max(180, cols * 8 - 16)
    const touchLabel = (f: FileTouch) =>
      f.kind === 'delete' ? 'eliminato' : f.kind === 'write' ? 'creato' : 'modificato'

    const treeRow = (r: ReturnType<typeof treeRows>[number]) => {
      const t = r.touch
      const mark = !t ? '  ' : t.status === 'active' ? '▶ ' : t.kind === 'delete' ? '✗ ' : '✓ '
      const color = t ? colorOf(list, t.agentIds[t.agentIds.length - 1] ?? MAIN) : undefined
      return (
        <Text key={r.path} color={color} bold={t?.status === 'active'} dimColor={!t}>
          {'  '.repeat(r.depth)}{mark}{r.name}{r.isDir ? '/' : ''}
        </Text>
      )
    }
    // Card chiusa mentre gli agenti lavorano: niente albero intero, solo i file che stanno toccando.
    const compactView = !isOpen && !finished

    const worktreeBox = (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Button key="worktree-toggle" plain onPress={() => void update($, worktreeOpen, o => !o)}>
          <Text bold>{isOpen ? '▾' : '▸'} Worktree</Text>
        </Button>
        {isOpen && treeRows(paths, touched).map(treeRow)}
        {compactView && treeRows([], touched).map(treeRow)}
      </Box>
    )

    const fileCard = (f: FileTouch) => {
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
                  {
                    text: `+${f.added}  −${f.removed}`,
                    spans: [
                      { text: `+${f.added}`, color: '#57ab5a' },
                      { text: '  ' },
                      { text: `−${f.removed}`, color: '#e5534b' },
                    ],
                  },
                ],
          })}
          alt={removedFile ? `${name}: ${who}` : `${name}: ${who}, +${f.added} −${f.removed}`}
          width={cardWidth}
          height={cardHeight(removedFile ? 1 : 2)}
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
    }

    return (
      <Box flexDirection="column" gap={1} flexGrow={1}>
        {list.filter(a => a.status !== 'idle').map(agentRow)}
        {worktreeBox}
        {finished && edited.length > 0 && (
          <Text dimColor>Lavoro concluso: {edited.length} file toccati.</Text>
        )}
        {finished && edited.length === 0 && list.some(a => a.id === MAIN && (a.status === 'completed' || a.status === 'failed')) && (
          <Text dimColor>Lavoro concluso: nessun file modificato.</Text>
        )}
        {finished && edited.map(fileCard)}
      </Box>
    )
  })

  // HUD da videogioco nella fascia sopra il prompt: Vita (contesto), Mana (5h), Vigore (settimanale).
  // Barre piene = risorsa disponibile. Ogni blocco ha due righe (testo, barra): le tre barre stanno alla stessa altezza.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e) as Record<string, any>
    const { Box, Text } = ui
    const isTerminal = (e as unknown as { surface?: string }).surface === 'terminal'
    const Svg = isTerminal ? undefined : ui.Svg
    const Raster = isTerminal ? ui.Raster : undefined
    if (isTerminal) terminalSeen = true
    const now = await $.clock.now()
    const usage = await read($, limits)
    const ctxUsed = (await read($, context)).percent

    const hudIcon = (kind: IconKind) =>
      Svg ? (
        <Svg key={`icon-${kind}`} source={iconSvg(kind)} alt={kind} width={16} height={16} />
      ) : Raster ? (
        <Raster key={`icon-${kind}`} columns={ICON_COLUMNS} rows={ICON_ROWS} cells={iconCells(kind)} />
      ) : (
        <Text color={ICONS[kind].color}>{ICONS[kind].glyph}</Text>
      )
    const lifePct = ctxUsed === null ? null : remainingPct(ctxUsed)
    const lifeAlert = lifeColor(lifePct, ICONS.life.color)
    // Il colore d'allerta tinge solo la parte piena; quella vuota resta del colore base.
    const hudBar = (pct: number | null, width: number, alert: string, base: string) => {
      const { filled, empty } = pixelBarParts(pct, width)
      return (
        <Text wrap="truncate-end">
          <Text color={alert} wrap="truncate-end">{filled}</Text>
          <Text color={base} wrap="truncate-end">{empty}</Text>
        </Text>
      )
    }

    // Blocchi Mana/Vigore presenti, con le stringhe che il layout deve misurare.
    const sideBlocks = usage.flatMap(l => {
      const kind = hudKindFor(l.kind)
      if (!kind) return []
      const left = remainingPct(l.percentUsed)
      return [{ l, kind, left, label: labelFor(l.kind), pct: `${left}%`, reset: formatReset(l.resetsAt, now, l.kind) }]
    })
    // Il layout sceglie etichette, countdown e larghezze perche' tutto stia in una riga: se non entra, la fascia cede.
    const lay = hudLayout(e.props.bodyColumns, sideBlocks)
    if (!lay.show) return next(e)

    return (
      <Box flexDirection="row" gap={2} alignItems="flex-start" flexWrap="nowrap" paddingTop={isTerminal ? 1 : 0}>
        <Box flexDirection="row" gap={1} flexShrink={0}>
          {hudIcon('life')}
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              {lay.showLabels && <Text dimColor wrap="truncate-end">Vita</Text>}
              <Text bold color={lifeAlert} wrap="truncate-end">
                {lifePct === null ? 'n/d' : `${lifePct}%`}
              </Text>
            </Box>
            {hudBar(lifePct, lay.lifeBar, lifeAlert, ICONS.life.color)}
          </Box>
        </Box>
        {sideBlocks.length === 0 ? (
          <Text dimColor wrap="truncate-end">Mana e Vigore n/d</Text>
        ) : (
          sideBlocks.map(({ l, kind, left, label, pct, reset }, i) => {
            const alert = sideColor(left, ICONS[kind].color)
            return (
              <Box key={l.kind} flexDirection="row" gap={1} flexShrink={0}>
                {hudIcon(kind)}
                <Box flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    {lay.showLabels && <Text dimColor wrap="truncate-end">{label}</Text>}
                    <Text bold color={alert} wrap="truncate-end">{pct}</Text>
                    {lay.showReset && <Text dimColor wrap="truncate-end">{reset}</Text>}
                  </Box>
                  {hudBar(left, lay.sideBars[i] ?? 8, alert, ICONS[kind].color)}
                </Box>
              </Box>
            )
          })
        )}
      </Box>
    )
  })
}
