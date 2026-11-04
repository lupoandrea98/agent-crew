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
  on('clock.every', () => ({ value: undefined }) as any)
  on('clock.now', () => ({ value: 1_000_000 }) as any)
  on('turn.start', (_, e: any) => ({ turnId: e.turnId }) as any)
  on('turn.complete', (_, e: any) => ({ text: e.answer ?? '' }) as any)

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
  expect((await term.findAll({ type: 'Raster' })).length).toBe(2)
  expect(await term.find({ type: 'Text', text: /creato da Main agent/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /modificato da Helper/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /eliminato da Main agent/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /Lavoro concluso: 3 file toccati/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /✗ gone\.ts/ })).toBeUndefined()
  await term.press({ key: 'worktree-toggle' })
  expect(await term.find({ type: 'Text', text: /✗ gone\.ts/ })).toBeDefined()
  await term.unmount()
})
