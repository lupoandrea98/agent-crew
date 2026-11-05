import { expect, test } from 'claude-code/testing'

import { ACCESSORIES, claudePixels, claudeSvg } from './claudes'
import { ICONS, iconCells } from './icons'
import { contextPct, hudKindFor, hudLayout, labelFor, lifeColor, remainingPct, sideColor } from './usage'
import { pixelBarParts } from './claudes'

test('colori d\'allerta: Vita gialla sotto il 55%, Mana/Vigore gialli sotto il 50% e rossi sotto il 20%', async () => {
  expect(lifeColor(100, 'red')).toBe('red')
  expect(lifeColor(55, 'red')).toBe('red')
  expect(lifeColor(54, 'red')).toBe('yellow')
  expect(lifeColor(0, 'red')).toBe('yellow')
  expect(lifeColor(null, 'red')).toBe('red')
  expect(sideColor(100, 'blue')).toBe('blue')
  expect(sideColor(50, 'blue')).toBe('blue')
  expect(sideColor(49, 'green')).toBe('yellow')
  expect(sideColor(20, 'green')).toBe('yellow')
  expect(sideColor(19, 'green')).toBe('red')
  expect(sideColor(0, 'blue')).toBe('red')
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

test('etichette HUD', async () => {
  expect(labelFor('five_hour')).toBe('Mana')
  expect(labelFor('seven_day')).toBe('Vigore')
  expect(hudKindFor('five_hour')).toBe('mana')
  expect(hudKindFor('seven_day')).toBe('stamina')
  expect(hudKindFor('altro')).toBeUndefined()
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
    { label: 'Mana', pct: '60%', reset: '1h 43m' },
    { label: 'Vigore', pct: '90%', reset: '3g 23h' },
  ]
  // Completo: le tre barre sono uguali e si dividono lo spazio libero (max 40).
  const wide = hudLayout(100, sides)
  expect(wide).toMatchObject({ show: true, showLabels: true, showReset: true, lifeBar: 27, sideBars: [27, 27] })
  expect(hudLayout(200, sides)).toMatchObject({ lifeBar: 40, sideBars: [40, 40] })
  // 80 colonne: (80 - 3 icone da 5 - 2 spazi da 2) / 3 = 20 per barra.
  expect(hudLayout(80, sides)).toMatchObject({ show: true, showLabels: true, showReset: true, lifeBar: 20, sideBars: [20, 20] })
  // Prima spariscono le etichette (tutte), poi il countdown, poi la fascia.
  expect(hudLayout(55, sides)).toMatchObject({ show: true, showLabels: false, showReset: true, lifeBar: 12, sideBars: [12, 12] })
  expect(hudLayout(45, sides)).toMatchObject({ show: true, showLabels: false, showReset: false, lifeBar: 8, sideBars: [8, 8] })
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
    expect(lay.lifeBar).toBeGreaterThanOrEqual(6)
    expect(lay.sideBars.length).toBe(2)
    // Le tre barre sono sempre uguali.
    for (const bar of lay.sideBars) expect(bar).toBe(lay.lifeBar)
  }
  // Senza limiti noti c'e' solo il testo "Mana e Vigore n/d".
  expect(hudLayout(60, []).show).toBe(true)
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
