import { expect, test } from 'claude-code/testing'

import { ACCESSORIES, claudePixels, claudeSvg, pixelBarParts } from './claudes'
import { ICONS, iconCells } from './icons'
import { contextColor, contextPct, hudBlocks, hudLayout, limitColor, remainingPct } from './usage'

test('colori d\'allerta: contesto giallo sotto il 55%, limiti gialli sotto il 50% e rossi sotto il 20%', async () => {
  expect(contextColor(100, 'green')).toBe('green')
  expect(contextColor(55, 'green')).toBe('green')
  expect(contextColor(54, 'green')).toBe('yellow')
  expect(contextColor(0, 'green')).toBe('yellow')
  expect(contextColor(null, 'green')).toBe('green')
  expect(limitColor(100, 'blue')).toBe('blue')
  expect(limitColor(50, 'blue')).toBe('blue')
  expect(limitColor(49, 'red')).toBe('yellow')
  expect(limitColor(20, 'red')).toBe('yellow')
  expect(limitColor(19, 'red')).toBe('red')
  expect(limitColor(0, 'blue')).toBe('red')
})

test('hudBlocks: Vita = settimanale, Mana = 5h (entrambe con reset), Vigore = contesto senza reset', async () => {
  const limits = [
    { kind: 'five_hour', percentUsed: 40, resetsAt: '1970-01-01T02:00:00Z' },
    { kind: 'seven_day', percentUsed: 10, resetsAt: '1970-01-04T00:00:00Z' },
  ]
  const [life, mana, stamina] = hudBlocks(limits, 25, 0) as [any, any, any]
  expect(hudBlocks(limits, 25, 0).map(b => b.kind)).toEqual(['life', 'mana', 'stamina'])
  expect(life).toMatchObject({ label: 'Vita', left: 90, pct: '90%', reset: '3g 0h', alert: 'red' })
  expect(mana).toMatchObject({ label: 'Mana', left: 60, pct: '60%', reset: '2h 0m', alert: 'blue' })
  expect(stamina).toMatchObject({ label: 'Vigore', left: 75, pct: '75%', alert: 'green' })
  expect(stamina.reset).toBeUndefined()
  // Soglie d'allerta che seguono il dato.
  const low = hudBlocks([{ kind: 'seven_day', percentUsed: 85, resetsAt: '1970-01-04T00:00:00Z' }], 60, 0)
  expect(low[0]!.alert).toBe('red')
  expect(low[2]!.alert).toBe('yellow')
  // Senza dati: sempre tre blocchi n/d, senza countdown.
  const empty = hudBlocks([], null, 0)
  expect(empty.length).toBe(3)
  for (const b of empty) expect(b).toMatchObject({ left: null, pct: 'n/d' })
  for (const b of empty) expect(b.reset).toBeUndefined()
  expect(empty.map(b => b.alert)).toEqual(['red', 'blue', 'green'])
})

test('pixelBarParts separa la parte piena da quella vuota', async () => {
  expect(pixelBarParts(50, 10)).toEqual({ filled: '█████', empty: '░░░░░' })
  expect(pixelBarParts(null, 4)).toEqual({ filled: '', empty: '░░░░' })
})

test('remainingPct e contextPct gestiscono valori limite e assenti', async () => {
  expect(remainingPct(0)).toBe(100)
  expect(remainingPct(40)).toBe(60)
  expect(remainingPct(150)).toBe(0)
  expect(remainingPct(Number.NaN)).toBe(0)
  expect(contextPct(undefined)).toBeNull()
  expect(contextPct({})).toBeNull()
  expect(contextPct({ percent: null })).toBeNull()
  expect(contextPct({ percent: 25.4 })).toBe(25)
  expect(contextPct({ percent: 140 })).toBe(100)
})

test('accessori fantasy validi e distinti; il main e il mago', async () => {
  expect(ACCESSORIES[0]!.name).toBe('mago')
  expect(new Set(ACCESSORIES.map(a => a.name)).size).toBe(ACCESSORIES.length)
  expect(new Set(ACCESSORIES.map(a => a.symbol)).size).toBe(ACCESSORIES.length)
  for (const a of ACCESSORIES) {
    expect(a.grid.length).toBe(16)
    for (const row of a.grid) {
      expect(row.length).toBe(16)
      for (const ch of row) if (ch !== '.') expect(a.palette[ch]).toBeDefined()
    }
  }
  // Il main (slot 0) non coincide con nessun subagent, nemmeno dopo un giro completo della lista.
  expect(claudeSvg(0, 'idle')).not.toBe(claudeSvg(1, 'idle'))
  expect(claudeSvg(1, 'idle')).toBe(claudeSvg(ACCESSORIES.length, 'idle'))
  expect(claudeSvg(0, 'idle')).not.toBe(claudeSvg(ACCESSORIES.length, 'idle'))
})

test('nel Raster gli occhi restano visibili con ogni accessorio e mood', async () => {
  const K = '#1a1a1a'
  const W = '#ffffff'
  for (let slot = 0; slot <= ACCESSORIES.length; slot++) {
    for (const mood of ['running', 'idle'] as const) {
      const px = claudePixels(slot, mood, 0)
      expect([px[3]![2], px[4]![2], px[3]![5], px[4]![5]]).toEqual([W, K, W, K])
    }
    const done = claudePixels(slot, 'completed', 0)
    expect([done[3]![2], done[3]![5]]).toEqual([K, K])
    const failed = claudePixels(slot, 'failed', 0)
    expect([failed[3]![2], failed[4]![2], failed[3]![5], failed[4]![5]]).toEqual([K, K, K, K])
  }
})

test('hudLayout degrada per larghezza senza mai rompere la riga', async () => {
  const sides = [
    { label: 'Vita', pct: '90%', reset: '3g 23h' },
    { label: 'Mana', pct: '60%', reset: '1h 43m' },
    { label: 'Vigore', pct: '75%' },
  ]
  // Completo: le tre barre sono uguali e si dividono lo spazio libero (max 40).
  expect(hudLayout(100, sides)).toMatchObject({ show: true, showLabels: true, showReset: true, bar: 27 })
  expect(hudLayout(200, sides)).toMatchObject({ bar: 40 })
  // 80 colonne: (80 - 3 icone da 5 - 2 spazi da 2) / 3 = 20 per barra.
  expect(hudLayout(80, sides)).toMatchObject({ show: true, showLabels: true, showReset: true, bar: 20 })
  // Prima spariscono le etichette (tutte), poi il countdown, poi la fascia.
  expect(hudLayout(55, sides)).toMatchObject({ show: true, showLabels: false, showReset: true, bar: 12 })
  expect(hudLayout(45, sides)).toMatchObject({ show: true, showLabels: false, showReset: false, bar: 8 })
  expect(hudLayout(20, sides).show).toBe(false)

  let labelsGone = false
  let resetGone = false
  let hidden = false
  for (let cols = 120; cols >= 0; cols--) {
    const lay = hudLayout(cols, sides)
    if (!lay.show) {
      hidden = true
      continue
    }
    // Una volta spariti etichette, countdown o fascia, non tornano a una larghezza minore.
    expect(hidden).toBe(false)
    if (!lay.showLabels) labelsGone = true
    if (!lay.showReset) resetGone = true
    if (labelsGone) expect(lay.showLabels).toBe(false)
    if (resetGone) expect(lay.showReset).toBe(false)
    expect(lay.bar).toBeGreaterThanOrEqual(6)
  }
  expect(hudLayout(Number.NaN, sides).show).toBe(false)
})

test('icone HUD: griglie 8x8 coerenti con la palette', async () => {
  for (const icon of Object.values(ICONS)) {
    expect(icon.big.length).toBe(8)
    for (const row of icon.big) expect(row.length).toBe(8)
    for (const ch of icon.big.join('')) {
      if (ch !== '.') expect(icon.palette[ch]).toBeDefined()
    }
  }
})

test('icone del terminale a mezzi blocchi: 4x4 pixel in 4x2 celle', async () => {
  const symbols = { life: 'R', mana: 'CBL', stamina: 'SHT' } as const
  for (const kind of ['life', 'mana', 'stamina'] as const) {
    const { small, palette } = ICONS[kind]
    expect(small.length).toBe(4)
    for (const row of small) expect(row.length).toBe(4)
    const used = new Set(small.join('').replace(/\./g, ''))
    for (const ch of used) expect(palette[ch]).toBeDefined()
    // Croce solo rossa, pozione e spada con tutti i loro colori.
    expect([...used].sort().join('')).toBe([...symbols[kind]].sort().join(''))
    // 4x2 celle, 3 parole u32 (12 byte) ciascuna: 96 byte = 128 caratteri base64.
    expect(iconCells(kind).length).toBe(128)
  }
  expect(ICONS.life.glyph).toBe('✚')
})
