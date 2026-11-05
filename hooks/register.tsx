import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, FileTouch } from '../types'
import { baseName, cardHeight, cardSvg, colorFor } from './cards'
import { CLAUDE_COLUMNS, CLAUDE_ROWS, asciiClaude, claudeCells, claudeSvg, pixelBar, pixelBarParts } from './claudes'
import { ICONS, ICON_COLUMNS, ICON_ROWS, iconCells, iconSvg } from './icons'
import type { IconKind } from './icons'
import { contextPct, hudBlocks, hudLayout, pickLimits } from './usage'
import {
  IGNORED,
  applyPlan,
  deletedTargets,
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
// Il pannello ha disegnato lo sprite ASCII di ripiego: lì non c'è un Raster da aggiornare con blit, serve il ridisegno.
let asciiSeen = false
// Tiene vivo il conto alla rovescia dei reset anche a riposo.
let usageTicker: { cancel: () => void } | undefined

// Cambia il tag quando cambiano i campi di uno stato: scarta ciò che una versione precedente ha salvato.
const agents = atom({ plugin: 'agent-crew', key: 'agents' } as const, [], { shape: 'agents-3' })
const files = atom({ plugin: 'agent-crew', key: 'files' } as const, [], { shape: 'files-1' })
const tree = atom({ plugin: 'agent-crew', key: 'tree' } as const, [], { shape: 'tree-1' })
const cwdAtom = atom({ plugin: 'agent-crew', key: 'cwd' } as const, '', { shape: 'cwd-1' })
const limits = atom({ plugin: 'agent-crew', key: 'limits' } as const, [], { shape: 'limits-1' })
const context = atom({ plugin: 'agent-crew', key: 'context' } as const, { percent: null }, { shape: 'context-1' })
const worktreeOpen = atom({ plugin: 'agent-crew', key: 'worktreeOpen' } as const, true, { shape: 'worktree-open-1' })

const blank = (
  id: string,
  label: string,
  model: string,
  slot: number,
  status: AgentRow['status'] = 'running',
): AgentRow => ({
  id,
  label,
  model,
  status,
  done: 0,
  total: 0,
  calls: 0,
  plan: [],
  slot,
})

const mainRow = (model: string, status: AgentRow['status'] = 'idle'): AgentRow =>
  blank(MAIN, 'Main agent', model, 0, status)

const withMain = (list: AgentRow[]): AgentRow[] =>
  list.some(a => a.id === MAIN) ? list : [mainRow('…'), ...list]

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

const reloadTree = ($: any, cwd: string) => {
  void loadTree($, cwd).then(t => update($, tree, () => t))
}

const openPane = ($: any) => $.ui.open({ id: PANE, title: 'Agent crew' })

const touchFile = ($: any, t: Parameters<typeof touch>[1]) => update($, files, list => touch(list, t, Date.now()))

/** True se `path` (relativo a `cwd`) è ancora nella sua cartella; se la cartella non si legge, false. */
async function exists($: any, cwd: string, path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? `${cwd}/${path.slice(0, slash)}` : cwd
  const name = path.slice(slash + 1)
  try {
    const entries: Array<{ name: string }> = await $.fs.list(dir)
    return entries.some(en => en.name === name)
  } catch {
    return false
  }
}

type UsageResult = {
  /** Almeno un dato è stato aggiornato (e quindi il ridisegno è già stato chiesto). */
  updated: boolean
  /** Limiti e contesto sono entrambi noti. */
  complete: boolean
}

/** Aggiorna limiti e contesto solo con i dati presenti: una lettura vuota non cancella quelli noti. */
async function applyUsage(
  $: any,
  rateLimits: Parameters<typeof pickLimits>[0] | undefined,
  ctx: Parameters<typeof contextPct>[0],
): Promise<UsageResult> {
  const lim = pickLimits(rateLimits ?? [])
  const pct = contextPct(ctx)
  if (lim.length > 0) await update($, limits, () => lim)
  if (pct !== null) await update($, context, () => ({ percent: pct }))
  const updated = lim.length > 0 || pct !== null
  if (updated) $.ui.invalidate('ui.render')
  return { updated, complete: lim.length > 0 && pct !== null }
}

/** Rilegge l'utilizzo dalla sessione e lo applica. */
async function refreshUsage($: any): Promise<UsageResult> {
  try {
    const u = await $.session.usage()
    return await applyUsage($, u.rateLimits, u.context)
  } catch {
    return { updated: false, complete: false }
  }
}

/** Elementi della superficie di un render; nel terminale segna che serve il frame d'animazione. */
function surfaceOf($: any, e: { surface: string }) {
  const ui = $.ui.resolve(e) as Record<string, any>
  // Il ramo si sceglie dalla superficie: nel terminale l'Svg non si disegna, anche se la tabella lo espone.
  const isTerminal = e.surface === 'terminal'
  if (isTerminal) terminalSeen = true
  return { ui, isTerminal, Svg: isTerminal ? undefined : ui.Svg, Raster: isTerminal ? ui.Raster : undefined }
}

/** Un pixel-art in un solo punto: Svg sul desktop, Raster nel terminale, altrimenti il ripiego. */
function pixelArt(
  s: { Svg?: any; Raster?: any },
  p: {
    key: string
    /** Chiave dell'Svg, se deve cambiare (rimonta) più della chiave del Raster. */
    svgKey?: string
    svg: string
    alt: string
    size: number
    isInteractive?: boolean
    cells: string
    columns: number
    rows: number
    fallback: unknown
  },
) {
  const { Svg, Raster } = s
  if (Svg) {
    return (
      <Svg
        key={p.svgKey ?? p.key}
        source={p.svg}
        alt={p.alt}
        width={p.size}
        height={p.size}
        isInteractive={p.isInteractive}
      />
    )
  }
  if (Raster) return <Raster key={p.key} columns={p.columns} rows={p.rows} cells={p.cells} />
  return p.fallback
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
    reloadTree($, e.cwd)
    void openPane($)

    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => {
      if (!terminalSeen) return
      void read($, agents).then(async list => {
        // Niente ridisegni a lavoro concluso: l'ultimo frame resta fermo.
        const running = list.filter(a => a.status === 'running')
        if (running.length === 0) return
        // Sprite ASCII: nessun Raster da aggiornare, serve il ridisegno.
        if (asciiSeen) {
          $.ui.invalidate('ui.render')
          return
        }
        // Il Raster si ripittura con blit, senza rieseguire il render di pannello e HUD.
        const frame = Math.floor((await $.clock.now()) / TICK_MS)
        for (const a of running) {
          // Un blit rifiutato (Raster non montato o di altra misura) si ignora: il prossimo render lo riallinea.
          void Promise.resolve($.ui.blit({ requestId: PANE, key: `claude-${a.id}`, cells: claudeCells(a.slot, 'running', frame) })).catch(
            () => {},
          )
        }
      })
    })

    usageTicker?.cancel()
    usageTicker = $.clock.every(60_000, () => {
      // Il countdown va comunque ridisegnato: un solo invalidate, quello di applyUsage se ha aggiornato qualcosa.
      void refreshUsage($).then(r => {
        if (!r.updated) $.ui.invalidate('ui.render')
      })
    })
    // Lettura iniziale, con qualche ripetizione finche' non arriva un dato completo.
    cancelUsageRetries()
    void refreshUsage($).then(({ complete }) => {
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
    await applyUsage($, e.rateLimits, e.context)

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
    await openPane($)

    return { text: 'Pannello Agent crew aperto.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    if (res.agentId) {
      await update($, agents, list => {
        const base = withMain(list)
        return [
          ...base,
          blank(res.agentId as string, e.description || e.subagentType, res.model, base.length),
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
    if (!e.command && !e.isMeta && !AUTOMATIC_ORIGINS.has(e.origin?.kind ?? '')) {
      await update($, agents, list => {
        const kept = list.filter(a => a.id === MAIN || a.status === 'running')
        return withMain(kept).map((a, i) => (a.id === MAIN ? mainRow(a.model, 'running') : { ...a, slot: i }))
      })
      await update($, files, () => [])
      await update($, worktreeOpen, () => true)
      reloadTree($, await read($, cwdAtom))
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
        }
      }))
    }

    if (FILE_TOOLS.has(tool)) {
      const cwd = await read($, cwdAtom)
      const raw = args.file_path ?? args.notebook_path
      if (typeof raw === 'string') {
        const path = relPath(cwd, raw)
        // Un Write su un file già presente nel worktree lo sovrascrive: conta come modifica.
        // L'albero è limitato (profondità 3, 300 voci): se non lo trova si controlla la cartella.
        const existed = tool === 'Write' && ((await read($, tree)).includes(path) || (await exists($, cwd, path)))
        const kind = fileKind(tool, existed)
        await touchFile($, { path, agentId: id, kind, status: 'active' })
        const ran = await next(e)
        // Edit: solo le righe davvero cambiate, come il diff nativo; Write: tutte le righe del contenuto.
        const edit = tool === 'Edit' ? diffLines(args.old_string, args.new_string) : undefined
        const added = edit ? edit.added : tool === 'Write' ? lineCount(args.content) : 0
        const removed = edit ? edit.removed : 0
        await touchFile($, { path, agentId: id, kind, status: 'done', added, removed })

        return ran
      }
    }

    if (tool === 'Bash' && typeof args.command === 'string') {
      const cwd = await read($, cwdAtom)
      const targets = deletedTargets(cwd, args.command)
      if (targets.length > 0) {
        const ran = await next(e)
        for (const path of targets) {
          if (!(await exists($, cwd, path))) {
            await touchFile($, { path, agentId: id, kind: 'delete', status: 'done' })
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
    const refused = e.reason === 'refusal'
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
    const surface = surfaceOf($, e)
    const { ui, Svg, Raster } = surface
    const { Box, Text, Button } = ui
    if (!Svg && !Raster) asciiSeen = true
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
          {pixelArt(surface, {
            // Il frame interattivo serve solo all'animazione: a lavoro fermo basta un'immagine, che non cattura la rotella.
            // La chiave del Raster coincide con quella del blit del ticker.
            key: `claude-${a.id}`,
            svgKey: `claude-${a.id}-${a.status}`,
            svg: claudeSvg(a.slot, a.status),
            alt: `${a.label}: ${a.status}`,
            size: 32,
            isInteractive: a.status === 'running',
            cells: claudeCells(a.slot, a.status, frame),
            columns: CLAUDE_COLUMNS,
            rows: CLAUDE_ROWS,
            fallback: (
              <Box flexDirection="column">
                {asciiClaude(a.slot, a.status, frame).map((line, i) => (
                  <Text key={String(i)}>{line}</Text>
                ))}
              </Box>
            ),
          })}
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

    const cols = e.props.bodyColumns ?? 40

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

  // HUD da videogioco nella fascia sopra il prompt: Vita (settimanale, con reset), Mana (5h, con reset), Vigore (contesto).
  // Barre piene = risorsa disponibile; dato mancante = n/d. Ogni blocco ha due righe (testo, barra): le tre barre stanno alla stessa altezza.
  // Terminale: barre a caratteri dimensionate da hudLayout. Desktop: barre di Box in percentuale, senza misure in celle.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const surface = surfaceOf($, e)
    const { ui, isTerminal } = surface
    const { Box, Text } = ui
    const now = await $.clock.now()
    const usage = await read($, limits)
    const ctxUsed = (await read($, context)).percent

    const hudIcon = (kind: IconKind) =>
      pixelArt(surface, {
        key: `icon-${kind}`,
        svg: iconSvg(kind),
        alt: kind,
        size: 16,
        cells: iconCells(kind),
        columns: ICON_COLUMNS,
        rows: ICON_ROWS,
        fallback: <Text color={ICONS[kind].color}>{ICONS[kind].glyph}</Text>,
      })
    // Terminale: barra a caratteri; il colore d'allerta tinge solo la parte piena, quella vuota resta del colore base.
    const hudBar = (pct: number | null, width: number, alert: string, base: string) => {
      const { filled, empty } = pixelBarParts(pct, width)
      return (
        <Text wrap="truncate-end">
          <Text color={alert} wrap="truncate-end">{filled}</Text>
          <Text color={base} wrap="truncate-end">{empty}</Text>
        </Text>
      )
    }
    // Desktop: la barra non si misura in caratteri (font proporzionale) ma in percentuale della larghezza del blocco.
    // I blocchi hanno width 0 (base flex 0) e flexGrow 1: si dividono lo spazio in parti uguali. Senza, la base
    // sarebbe la larghezza del contenuto e il Vigore (senza countdown) risulterebbe piu' stretto.
    const hudBarBoxes = (pct: number | null, alert: string, track: string) => (
      <Box flexDirection="row" height={1} width="100%">
        <Box width={`${pct ?? 0}%`} backgroundColor={alert} />
        <Box flexGrow={1} backgroundColor={track} />
      </Box>
    )

    const blocks = hudBlocks(usage, ctxUsed, now)
    // Il layout sceglie etichette e countdown perche' tutto stia in una riga: se non entra, la fascia cede.
    const lay = hudLayout(e.props.bodyColumns, blocks)
    if (!lay.show) return next(e)

    return (
      <Box
        flexDirection="row"
        gap={2}
        alignItems="flex-start"
        flexWrap="nowrap"
        paddingTop={isTerminal ? 1 : 0}
        width={isTerminal ? undefined : '100%'}
      >
        {blocks.map(b => (
          <Box
            key={b.kind}
            flexDirection="row"
            gap={1}
            flexShrink={isTerminal ? 0 : 1}
            flexGrow={isTerminal ? undefined : 1}
            minWidth={isTerminal ? undefined : 0}
            width={isTerminal ? undefined : 0}
          >
            {hudIcon(b.kind)}
            <Box flexDirection="column" flexGrow={isTerminal ? undefined : 1} minWidth={isTerminal ? undefined : 0}>
              <Box flexDirection="row" gap={1}>
                {lay.showLabels && <Text dimColor wrap="truncate-end">{b.label}</Text>}
                <Text bold color={b.alert} wrap="truncate-end">{b.pct}</Text>
                {lay.showReset && b.reset && <Text dimColor wrap="truncate-end">{b.reset}</Text>}
              </Box>
              {isTerminal
                ? hudBar(b.left, lay.bar, b.alert, ICONS[b.kind].color)
                : hudBarBoxes(b.left, b.alert, ICONS[b.kind].track)}
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
