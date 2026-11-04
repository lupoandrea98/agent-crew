export type Mood = 'running' | 'idle' | 'completed' | 'failed'

// Sprite 8-bit su griglia 16x16. Ogni pixel e' un quadratino da 4 unita' (viewBox 64).
// Legenda: '.' trasparente. Ogni layer e' una mappa carattere -> colore.

type Grid = string[]
type Palette = Record<string, string>

const BLANK = '................'

function grid(rows: Record<number, string>): Grid {
  return Array.from({ length: 16 }, (_, y) => rows[y] ?? BLANK)
}

const PX = 4

// Corpo + gambe. B = corpo, S = ombra.
const BODY: Grid = grid({
  2: '...BBBBBBBBBB...',
  3: '..BBBBBBBBBBBB..',
  4: '.BBBBBBBBBBBBBB.',
  5: '.BBBBBBBBBBBBBB.',
  6: '.BBBBBBBBBBBBBB.',
  7: 'BBBBBBBBBBBBBBBB',
  8: 'BBBBBBBBBBBBBBBB',
  9: '.BBBBBBBBBBBBBB.',
  10: '.BBBBBBBBBBBBBB.',
  11: '.SSSSSSSSSSSSSS.',
  12: '...BBB....BBB...',
  13: '...BBB....BBB...',
  14: '...SSS....SSS...',
})

const BODY_PALETTE: Record<Mood, Palette> = {
  running: { B: '#D97757', S: '#B85C3E' },
  idle: { B: '#D97757', S: '#B85C3E' },
  completed: { B: '#6BAA75', S: '#4E8A5A' },
  failed: { B: '#9A9A9A', S: '#6E6E6E' },
}

const INK: Palette = { K: '#1a1a1a', W: '#ffffff' }

// Occhi aperti (lampeggiano in running/idle)
const EYES_OPEN: Grid = grid({
  5: '....KW....KW....',
  6: '....KK....KK....',
})

// Occhi a arco sorridente (completed)
const EYES_HAPPY: Grid = grid({
  5: '....KK....KK....',
  6: '...K..K..K..K...',
})

// Occhi a X (failed)
const EYES_X: Grid = grid({
  5: '...K.K....K.K...',
  6: '....K......K....',
  7: '...K.K....K.K...',
})

const MOUTH_NEUTRAL: Grid = grid({
  8: '......KKKK......',
})

const MOUTH_HAPPY: Grid = grid({
  8: '......K..K......',
  9: '.......KK.......',
})

const MOUTH_SAD: Grid = grid({
  8: '.......KK.......',
  9: '......K..K......',
})

const EYES: Record<Mood, Grid> = {
  running: EYES_OPEN,
  idle: EYES_OPEN,
  completed: EYES_HAPPY,
  failed: EYES_X,
}

const MOUTH: Record<Mood, Grid> = {
  running: MOUTH_NEUTRAL,
  idle: MOUTH_NEUTRAL,
  completed: MOUTH_HAPPY,
  failed: MOUTH_SAD,
}

// Accessori nell'ordine dei slot: simbolo ASCII e overlay sul corpo.
interface Accessory {
  name: string
  symbol: string
  grid: Grid
  palette: Palette
}

export const ACCESSORIES: Accessory[] = [
  {
    name: 'cappellino',
    symbol: '^',
    grid: grid({
      1: '....CCCCCCCC....',
      2: '...CCCCCCCCCC...',
      3: '..DDDDDDDDDDDD..',
    }),
    palette: { C: '#3B5BA9', D: '#2E4678' },
  },
  {
    name: 'sciarpa',
    symbol: '~',
    grid: grid({
      10: '..RRRRRRRRRRRR..',
      11: '.............R..',
      12: '.............R..',
      13: '.............R..',
    }),
    palette: { R: '#C0392B' },
  },
  {
    name: 'pipa',
    symbol: 'b',
    grid: grid({
      8: '.............PP.',
      9: '..........TTTPP.',
      10: '.............PP.',
    }),
    palette: { T: '#D8C3A5', P: '#6B3E1F' },
  },
  {
    name: 'occhiali',
    symbol: '8',
    grid: grid({
      4: '...GGGG..GGGG...',
      5: '...G..GGGG..G...',
      6: '...G..G..G..G...',
      7: '...GGGG..GGGG...',
    }),
    palette: { G: '#222222' },
  },
  {
    name: 'corona',
    symbol: 'W',
    grid: grid({
      0: '...Y...Y...Y....',
      1: '...OOOOOOOOOO...',
    }),
    palette: { Y: '#F4C430', O: '#B8860B' },
  },
  {
    name: 'cravatta',
    symbol: 'v',
    grid: grid({
      10: '.......NN.......',
      11: '......NNNN......',
      12: '.......NN.......',
    }),
    palette: { N: '#1F1F1F' },
  },
]

const ASCII_FACE: Record<Mood, string> = {
  running: '(o_o)',
  completed: '(^_^)',
  failed: '(x_x)',
  idle: '(-_-)',
}

// Slot negativi o non finiti ricadono su un indice positivo nella lista.
function accessoryFor(slot: number): Accessory {
  const n = ACCESSORIES.length
  const s = Number.isFinite(slot) ? Math.floor(slot) : 0
  return ACCESSORIES[((s % n) + n) % n]!
}

// Converte le celle di un carattere in un unico path: una sotto-forma
// rettangolare per ogni run orizzontale di pixel uguali.
function toPath(g: Grid, ch: string): string {
  let d = ''
  for (let y = 0; y < g.length; y++) {
    const row = g[y] ?? ''
    let x = 0
    while (x < row.length) {
      if (row[x] !== ch) {
        x++
        continue
      }
      let w = 1
      while (x + w < row.length && row[x + w] === ch) w++
      d += `M${x * PX} ${y * PX}h${w * PX}v${PX}h${-w * PX}z`
      x += w
    }
  }
  return d
}

function layer(g: Grid, palette: Palette): string {
  let out = ''
  for (const ch of Object.keys(palette)) {
    const d = toPath(g, ch)
    if (d) out += `<path fill="${palette[ch]}" d="${d}"/>`
  }
  return out
}

// Lo SVG dipende solo da accessorio e mood: si calcola una volta sola.
const svgCache = new Map<string, string>()

export function claudeSvg(slot: number, mood: Mood): string {
  const acc = accessoryFor(slot)
  const key = `${ACCESSORIES.indexOf(acc)}:${mood}`
  const cached = svgCache.get(key)
  if (cached !== undefined) return cached
  const svg = renderSvg(acc, mood)
  svgCache.set(key, svg)
  return svg
}

function renderSvg(acc: Accessory, mood: Mood): string {
  const body = layer(BODY, BODY_PALETTE[mood])

  const blink =
    mood === 'running' || mood === 'idle'
      ? '<animate attributeName="opacity" values="1;0;1" keyTimes="0;0.93;0.97" dur="3s" calcMode="discrete" repeatCount="indefinite"/>'
      : ''
  const eyes = `<g>${blink}${layer(EYES[mood], INK)}</g>`
  const mouth = layer(MOUTH[mood], INK)

  const accessory = layer(acc.grid, acc.palette)

  let motion = ''
  if (mood === 'running') {
    motion =
      '<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" calcMode="discrete" dur="0.5s" repeatCount="indefinite"/>'
  } else if (mood === 'idle') {
    motion =
      '<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" calcMode="discrete" dur="2s" repeatCount="indefinite"/>'
  }

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" shape-rendering="crispEdges">' +
    `<g>${motion}${body}${eyes}${mouth}${accessory}</g>` +
    '</svg>'
  )
}

export function asciiClaude(slot: number, mood: Mood, frame = 0): string[] {
  const face = ASCII_FACE[mood]
  // Corpo e faccia fermi; in running alterna solo il piede sollevato.
  const legs = mood !== 'running' ? ' /   \\ ' : Math.floor(frame / 2) % 2 === 0 ? ' |   \\ ' : ' /   | '
  return [`   ${accessoryFor(slot).symbol}   `, ` ${face} `, legs]
}

// Barra a blocchi: '█' pieni e '░' vuoti. pct null => 0 pieni.
export function pixelBar(pct: number | null, width = 16): string {
  const w = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 16
  const p = pct === null || !Number.isFinite(pct) ? 0 : Math.min(100, Math.max(0, pct))
  const filled = Math.round((p / 100) * w)
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}

// --- Rendering a celle per il terminale (Raster) ---

// Sprite a risoluzione dimezzata: ogni sub-pixel copre 2x2 pixel dello sprite 16x16.
// 8 colonne x 8 sub-pixel = 4 righe di celle.
export const CLAUDE_COLUMNS = 8
export const CLAUDE_ROWS = 4
const SUB_ROWS = CLAUDE_ROWS * 2

type Pixels = (string | null)[][]

// I layer dipinti dopo sovrascrivono i precedenti: occhi, bocca e accessorio restano visibili sul corpo.
function paint(canvas: Pixels, g: Grid, palette: Palette, dy: number) {
  for (let y = 0; y < g.length; y++) {
    const row = g[y] ?? ''
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x] as string]
      const target = canvas[(y >> 1) + dy]
      if (color && target) target[x >> 1] = color
    }
  }
}

// Piedi: in running si alza un piede alla volta (cambio ogni 2 tick), togliendo l'ombra della sua gamba.
// Tutto il resto (corpo, occhi, bocca, accessorio) resta fermo: nessuno spostamento verticale.
function bodyForFrame(mood: Mood, frame: number): Grid {
  if (mood !== 'running') return BODY
  const lift = Math.floor(frame / 2) % 2 === 0 ? [3, 4, 5] : [10, 11, 12]
  return BODY.map((row, y) =>
    y === 14 ? row.split('').map((c, x) => (lift.includes(x) ? '.' : c)).join('') : row,
  )
}

// Facce native a bassa risoluzione: coordinate [riga, colonna] già in sub-pixel.
// Gli archi del 16x16 (EYES_HAPPY, MOUTH_HAPPY) dimezzati collassano e sembrano più occhi e più bocche.
type FaceCell = [number, number, string]
const K = '#1a1a1a'
const W = '#ffffff'
const OPEN_EYES: FaceCell[] = [[2, 2, W], [3, 2, K], [2, 5, W], [3, 5, K]]
// Nel terminale niente bocca: solo gli occhi, in ogni stato.
const FACE: Record<Mood, FaceCell[]> = {
  running: OPEN_EYES,
  idle: OPEN_EYES,
  completed: [[2, 2, K], [2, 5, K]],
  failed: [[2, 2, K], [3, 2, K], [2, 5, K], [3, 5, K]],
}

// Sprite composto come in claudeSvg, tutto ancorato alla stessa posizione.
export function claudePixels(slot: number, mood: Mood, frame: number): Pixels {
  const canvas: Pixels = Array.from({ length: SUB_ROWS }, () => Array<string | null>(8).fill(null))

  paint(canvas, bodyForFrame(mood, frame), BODY_PALETTE[mood], 0)
  for (const [r, c, color] of FACE[mood]) {
    const row = canvas[r]
    if (row) row[c] = color
  }
  const acc = accessoryFor(slot)
  paint(canvas, acc.grid, acc.palette, 0)
  return canvas
}

const DEFAULT_COLOR = 0x01000000
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '='
    out += i + 2 < bytes.length ? B64[c & 63]! : '='
  }
  return out
}

const rgb = (hex: string | null | undefined): number =>
  hex ? parseInt(hex.slice(1), 16) : DEFAULT_COLOR

// Celle di `RasterProps.cells`: due pixel per cella con i mezzi blocchi,
// terne little-endian u32 [codePoint, foreground, background].
export function claudeCells(slot: number, mood: Mood, frame: number): string {
  const px = claudePixels(slot, mood, frame)
  const words = new Uint32Array(CLAUDE_COLUMNS * CLAUDE_ROWS * 3)
  let i = 0
  for (let r = 0; r < CLAUDE_ROWS; r++) {
    for (let x = 0; x < CLAUDE_COLUMNS; x++) {
      const top = px[r * 2]?.[x] ?? null
      const bottom = px[r * 2 + 1]?.[x] ?? null
      let ch = 0x20
      let fg = DEFAULT_COLOR
      let bg = DEFAULT_COLOR
      if (top && bottom) {
        ch = 0x2580
        fg = rgb(top)
        bg = rgb(bottom)
      } else if (top) {
        ch = 0x2580
        fg = rgb(top)
      } else if (bottom) {
        ch = 0x2584
        fg = rgb(bottom)
      }
      words[i++] = ch
      words[i++] = fg
      words[i++] = bg
    }
  }
  const bytes = new Uint8Array(words.length * 4)
  words.forEach((w, k) => {
    bytes[k * 4] = w & 255
    bytes[k * 4 + 1] = (w >>> 8) & 255
    bytes[k * 4 + 2] = (w >>> 16) & 255
    bytes[k * 4 + 3] = (w >>> 24) & 255
  })
  return base64(bytes)
}
