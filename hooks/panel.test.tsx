import { expect, test } from 'claude-code/testing'

import { cardHeight } from './cards'

const PANE = {
  plugin: 'agent-crew',
  component: 'Pane',
  requestId: 'agent-crew',
  props: {
    title: 'Agent crew',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Ogni barra HUD e' un Text con dentro due Text (parte piena e vuota), tutte e tre larghe uguali:
// le barre intere sono i blocchi di testo piu' lunghi, le loro parti sono piu' corte.
const fullBars = async (m: any): Promise<any[]> => {
  const found: any[] = (await m.findAll({ type: 'Text', text: /^[█░]+$/ })).filter((t: any) => String(t.props.text ?? t.text ?? '') !== '')
  const len = (t: any) => String(t.props.text ?? t.text ?? '').length
  const max = Math.max(0, ...found.map(len))
  return max < 6 ? [] : found.filter(t => len(t) === max)
}

// Un task con un subagent che crea, sovrascrive ed elimina file; poi il pannello su entrambe le superfici.
test('il pannello disegna agenti, worktree e card su terminale e desktop', async ($, on) => {
  // Nulla sta sotto la mod: questi hook fanno la parte dell'engine.
  on('command.register', () => ({ value: { command: 'crew' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // Nella cartella c'è solo old.ts: gone.ts risulta eliminato.
  on('fs.list', () => ({ value: [{ name: 'old.ts', kind: 'file' }] }) as any)
  on('agent.spawn', () => ({ agentId: 'a1', model: 'haiku' }))
  on('tool.call', () => ({ result: {} }) as any)
  on('session.usage', () =>
    ({
      value: {
        startedAt: 0,
        context: { window: 200000, tokens: 50000, percent: 25 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 40, resetsAt: '1970-01-01T02:00:00Z' },
          { kind: 'seven_day', percentUsed: 10, resetsAt: '1970-01-04T00:00:00Z' },
        ],
      },
    }) as any,
  )
  // Il motore non disegna nulla nella fascia: serve solo quando la mod cede il posto (sondaggio aperto).
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e) as Record<string, any>
    return <Text>sondaggio</Text>
  })
  on('clock.every', () => ({ value: undefined }) as any)
  on('clock.now', () => ({ value: 1_000_000 }) as any)
  on('prompt.submit', (_, e: any) => e)
  on('turn.start', (_, e: any) => ({ turnId: e.turnId }) as any)
  on('turn.complete', (_, e: any) => ({ text: e.answer ?? '' }) as any)
  on('session.measure', (_, e: any) => ({ changed: e.changed }) as any)

  const ev = $ as any
  await ev.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true })
  await ev.turn.start({ turnId: 'm1' })
  await ev.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Helper', subagentType: 'general-purpose' })
  await ev.tool.call({ tool: 'Write', file_path: '/w/new.ts', content: 'a\nb' })
  await ev.tool.call({ tool: 'Write', file_path: '/w/old.ts', content: 'x', agentId: 'a1' })
  await ev.tool.call({ tool: 'Bash', command: 'rm gone.ts' })

  // Durante il lavoro: sul desktop solo gli sprite in esecuzione sono interattivi.
  const running = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const sprites = (await running.findAll({ type: 'Svg' })).filter(s => String(s.props.alt).includes(':'))
  expect(sprites.length).toBe(2)
  for (const s of sprites) {
    expect(s.props.isInteractive).toBe(String(s.props.alt).endsWith('running'))
    expect(s.props.height).toBe(32)
  }
  await running.unmount()

  await ev.turn.complete({ turnId: 's1', agentId: 'a1', answer: '' })
  await ev.turn.complete({ turnId: 'm1', answer: '' })

  // A lavoro concluso, desktop: niente frame interattivi, card con altezza fissata.
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = await desk.findAll({ type: 'Svg' })
  expect(svgs.some(s => s.props.isInteractive === true)).toBe(false)
  const cards = svgs.filter(s => /(creato|modificato|eliminato) da/.test(String(s.props.alt)))
  expect(cards.length).toBe(3)
  for (const c of cards) {
    expect(c.props.height).toBe(cardHeight(String(c.props.alt).includes('eliminato') ? 1 : 2))
  }
  expect(await desk.find({ type: 'Raster' })).toBeUndefined()
  await desk.unmount()

  // Terminale: sprite a celle, card a bordo; il worktree è chiuso e si riapre col pulsante.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  const rasters = await term.findAll({ type: 'Raster' })
  // Nel pannello restano solo gli sprite (8 colonne): l'HUD sta sopra il prompt.
  expect(rasters.length).toBe(2)
  expect(rasters.every(r => r.props.columns === 8)).toBe(true)
  expect(await term.find({ type: 'Text', text: /Vita/ })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /creato da Main agent/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /modificato da Helper/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /eliminato da Main agent/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /Lavoro concluso: 3 file toccati/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /✗ gone\.ts/ })).toBeUndefined()
  await term.press({ key: 'worktree-toggle' })
  expect(await term.find({ type: 'Text', text: /✗ gone\.ts/ })).toBeDefined()
  await term.unmount()

  // Nuova richiesta con la card chiusa a mano mentre gli agenti lavorano: solo i file toccati, non l'intero albero.
  await ev.prompt.submit({ text: 'altro lavoro' })
  await ev.turn.start({ turnId: 'm2' })
  await ev.tool.call({ tool: 'Write', file_path: '/w/fresh.ts', content: 'z' })
  const compact = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await compact.press({ key: 'worktree-toggle' }) // aperta -> chiusa
  expect(await compact.find({ type: 'Text', text: /fresh\.ts/ })).toBeDefined()
  expect(await compact.find({ type: 'Text', text: /old\.ts/ })).toBeUndefined()
  await compact.press({ key: 'worktree-toggle' }) // riaperta: albero completo
  expect(await compact.find({ type: 'Text', text: /old\.ts/ })).toBeDefined()
  await compact.unmount()
  await ev.turn.complete({ turnId: 'm2', answer: '' })

  // HUD sopra il prompt: Vita 90% (settimanale), Mana 60% (5h), Vigore 75% (contesto 25% usato).
  const band = {
    plugin: 'agent-crew',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 6,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 6 },
      view: {},
    },
  } as const

  const hudTerm = await $.ui.mount({ ...band, surface: 'terminal' } as any)
  // Solo nel CLI: una riga di padding sopra le barre.
  expect((await hudTerm.findAll({ type: 'Box' })).some(b => b.props.paddingTop === 1)).toBe(true)
  const hudRasters = await hudTerm.findAll({ type: 'Raster' })
  expect(hudRasters.length).toBe(3)
  expect(hudRasters.every(r => r.props.columns === 4)).toBe(true)
  expect(await hudTerm.find({ type: 'Text', text: /Vita/ })).toBeDefined()
  expect(await hudTerm.find({ type: 'Text', text: /Mana/ })).toBeDefined()
  expect(await hudTerm.find({ type: 'Text', text: /Vigore/ })).toBeDefined()
  expect(await hudTerm.find({ type: 'Text', text: /75%/ })).toBeDefined()
  expect(await hudTerm.find({ type: 'Text', text: /60%/ })).toBeDefined()
  expect(await hudTerm.find({ type: 'Text', text: /90%/ })).toBeDefined()
  // Il countdown c'e' in Vita (3g) e Mana (h m), non in Vigore: due soli testi di reset.
  expect(await hudTerm.find({ type: 'Text', text: /^\d+g \d+h$/ })).toBeDefined()
  expect(await hudTerm.find({ type: 'Text', text: /^\d+h \d+m$/ })).toBeDefined()
  // Le tre barre hanno la stessa lunghezza di riga di partenza: tutte seconda riga del loro blocco.
  expect((await fullBars(hudTerm)).length).toBe(3)
  await hudTerm.unmount()

  const hudDesk = await $.ui.mount({ ...band, surface: 'desktop' } as any)
  expect((await hudDesk.findAll({ type: 'Svg' })).length).toBe(3)
  expect((await hudDesk.findAll({ type: 'Box' })).some(b => b.props.paddingTop === 1)).toBe(false)
  expect(await hudDesk.find({ type: 'Raster' })).toBeUndefined()
  // Desktop: nessuna barra a caratteri, ma Box colorati con larghezza in percentuale (piena) e flexGrow (traccia).
  expect(await hudDesk.find({ type: 'Text', text: /[█░]/ })).toBeUndefined()
  const deskBoxes = await hudDesk.findAll({ type: 'Box' })
  const fills = deskBoxes.filter(b => b.props.backgroundColor !== undefined && /%$/.test(String(b.props.width ?? '')) && b.props.width !== '100%')
  expect(fills.map(b => b.props.width).sort()).toEqual(['60%', '75%', '90%'])
  expect(deskBoxes.filter(b => b.props.backgroundColor !== undefined && b.props.flexGrow === 1).length).toBe(3)
  // Blocchi Vita/Mana/Vigore con base flex 0 (width 0) e flexGrow: stessa larghezza anche senza countdown.
  expect(deskBoxes.filter(b => b.props.flexGrow === 1 && b.props.minWidth === 0 && b.props.width === 0).length).toBe(3)
  await hudDesk.unmount()

  // Ridimensionamento: etichette tutte insieme o nessuna, mai testo che va a capo.
  const labelsAt = async (bodyColumns: number) => {
    const m = await $.ui.mount({ ...band, props: { ...band.props, bodyColumns }, surface: 'terminal' } as any)
    const present = [
      (await m.find({ type: 'Text', text: /^Vita$/ })) !== undefined,
      (await m.find({ type: 'Text', text: /^Mana$/ })) !== undefined,
      (await m.find({ type: 'Text', text: /^Vigore$/ })) !== undefined,
    ]
    const bars = await fullBars(m)
    const hudTexts = (await m.findAll({ type: 'Text' })).filter(t => t.props.wrap !== undefined || bars.length > 0)
    const allTruncate = hudTexts.every(t => t.props.wrap === 'truncate-end')
    await m.unmount()
    return { present, bars: bars.length, allTruncate }
  }
  expect(await labelsAt(80)).toMatchObject({ present: [true, true, true], bars: 3, allTruncate: true })
  // A 80 colonne le tre barre sono uguali: (80 - 3*5 - 2*2) / 3 = 20.
  const wideHud = await $.ui.mount({ ...band, props: { ...band.props, bodyColumns: 80 }, surface: 'terminal' } as any)
  expect(await wideHud.find({ type: 'Text', text: /^Mana$/ })).toBeDefined()
  expect((await wideHud.findAll({ type: 'Text', text: /^[█░]{20}$/ })).length).toBe(3)
  await wideHud.unmount()
  expect(await labelsAt(55)).toMatchObject({ present: [false, false, false], bars: 3, allTruncate: true })
  expect(await labelsAt(45)).toMatchObject({ present: [false, false, false], bars: 3, allTruncate: true })
  // Troppo stretta: nessuna barra, la fascia lascia il posto al motore.
  expect(await labelsAt(20)).toMatchObject({ present: [false, false, false], bars: 0 })

  // Una misura senza limiti e senza percentuale di contesto non cancella i dati gia' noti.
  await ev.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })
  const hudKept = await $.ui.mount({ ...band, props: { ...band.props, bodyColumns: 80 }, surface: 'terminal' } as any)
  expect(await hudKept.find({ type: 'Text', text: /75%/ })).toBeDefined()
  expect(await hudKept.find({ type: 'Text', text: /60%/ })).toBeDefined()
  expect(await hudKept.find({ type: 'Text', text: /90%/ })).toBeDefined()
  expect(await hudKept.find({ type: 'Text', text: /Mana/ })).toBeDefined()
  await hudKept.unmount()

  // Con un sondaggio aperto la fascia cede il posto.
  const hudSurvey = await $.ui.mount({ ...band, props: { ...band.props, hasSurvey: true }, surface: 'terminal' } as any)
  expect(await hudSurvey.find({ type: 'Text', text: /Vita/ })).toBeUndefined()
  expect(await hudSurvey.find({ type: 'Text', text: /sondaggio/ })).toBeDefined()
  await hudSurvey.unmount()
})
