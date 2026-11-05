import { layer, memo, packCells, pixelSvg } from './claudes'
import type { Grid, Palette, Pixels } from './claudes'

// Icone 8-bit dell'HUD: Vita (cuore), Mana (pozione blu), Vigore (fulmine).
export type IconKind = 'life' | 'mana' | 'stamina'

interface Icon {
  /** Arte 8x8 per il desktop (Svg). */
  big: Grid
  /** Arte 4x4 per il terminale: mezzi blocchi, 2 pixel per cella (Raster 4x2 celle). */
  small: Grid
  palette: Palette
  /** Ripiego testuale senza Svg/Raster. */
  glyph: string
  /** Colore pieno della barra associata. */
  color: string
  /** Colore scuro della parte vuota della barra sul desktop (stessa tinta del colore pieno). */
  track: string
}

export const ICONS: Record<IconKind, Icon> = {
  life: {
    big: [
      '.RR..RR.',
      'RLRRRRRR',
      'RRRRRRRR',
      'RRRRRRRR',
      '.RRRRRR.',
      '..RRRR..',
      '...RR...',
      '........',
    ],
    // Croce 3x3 a bracci uguali e sottili (1 pixel), appoggiata in basso a destra della griglia 4x4:
    // con 4 pixel non esiste un centro, quindi la croce centrata avrebbe il centro largo 2 e i bracci quasi invisibili.
    small: ['....', '..R.', '.RRR', '..R.'],
    palette: { R: '#E04646', L: '#FFB3B3' },
    glyph: '✚',
    color: 'red',
    track: '#4a1c1c',
  },
  mana: {
    big: [
      '..CCCC..',
      '...NN...',
      '...NN...',
      '..BBBB..',
      '.BLBBBB.',
      '.BLBBBB.',
      '.BBBBBB.',
      '..BBBB..',
    ],
    small: ['.CC.', '.BB.', 'BLBB', 'BBBB'],
    palette: { C: '#8B5A2B', N: '#CFE6FF', B: '#3B7DD8', L: '#9CC8FF' },
    glyph: '⚗',
    color: 'blue',
    track: '#1c2a4a',
  },
  stamina: {
    big: [
      '....GGG.',
      '...GGG..',
      '..GGG...',
      '.GGGGGG.',
      '...GGG..',
      '..GG....',
      '..G.....',
      '........',
    ],
    small: ['...S', 'H.S.', '.S..', 'T.H.'],
    palette: { G: '#4CAF50', S: '#8EE59A', H: '#4CAF50', T: '#2E7D32' },
    glyph: '†',
    color: 'green',
    track: '#1c3d22',
  },
}

export const ICON_COLUMNS = 4
export const ICON_ROWS = 2

/** Svg 32x32 (8x8 pixel da 4 unita'). */
export const iconSvg: (kind: IconKind) => string = memo(kind => {
  const { big, palette } = ICONS[kind]
  return pixelSvg(32, layer(big, palette))
})

/** Celle per Raster (4 colonne x 2 righe, 4x4 pixel a mezzi blocchi). */
export function iconCells(kind: IconKind): string {
  const { small, palette } = ICONS[kind]
  const px: Pixels = small.map(row => row.split('').map(ch => palette[ch] ?? null))
  return packCells(px, ICON_COLUMNS, ICON_ROWS)
}
