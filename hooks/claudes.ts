export type Mood = 'running' | 'idle' | 'completed' | 'failed'

// Sprite 8-bit su griglia 16x16. Ogni pixel e' un quadratino da 4 unita' (viewBox 64).
// Legenda: '.' trasparente. Ogni layer e' una mappa carattere -> colore.

export type Grid = string[]
export type Palette = Record<string, string>

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

// Il main agent (slot 0) e' sempre il mago; i subagent ruotano tra gli altri eroi.
export const ACCESSORIES: Accessory[] = [
  {
    name: 'mago',
    symbol: 'A',
    grid: grid({
      0: '.......HH.....OQ',
      1: '......HHHH....OO',
      2: '.....HHHYHH....T',
      3: '..DDDDDDDDDDDD.T',
      4: '...............T',
      5: '...............T',
      6: '...............T',
      7: '...............T',
      8: '...............T',
      9: '...............T',
      10: '...............T',
      11: '...............T',
      12: '...............T',
      13: '...............T',
      14: '...............T',
      15: '...............T',
    }),
    palette: { H: '#4B3F9E', D: '#352C73', Y: '#F4C430', T: '#8B5A2B', O: '#6FD3FF', Q: '#E8F8FF' },
  },
  {
    name: 'cavaliere',
    symbol: 'T',
    grid: grid({
      0: 'S......RR.......',
      1: 'S.....HHHH......',
      2: 'S..HHHHHHHHHH...',
      3: 'S.HHHHHHHHHHHH..',
      4: 'S.LLLLLLLLLLLL..',
      5: 'S...............',
      6: 'S...............',
      7: 'S...............',
      8: 'S...............',
      9: 'S...............',
      10: 'GGG.............',
      11: 'T...............',
      12: 'T...............',
      13: 'T...............',
    }),
    palette: { H: '#8E9AAF', L: '#5C6678', R: '#C0392B', S: '#D6DCE5', G: '#F4C430', T: '#6B3E1F' },
  },
  {
    name: 'ladro',
    symbol: 'v',
    grid: grid({
      1: '.....NNNNNN.....',
      2: '...NNNNNNNNNN...',
      3: '..NNNNNNNNNNNN..',
      4: '..NNN......NNN..',
      5: '..NN........NN..',
      6: '..NN........NN.S',
      7: '..NN........NN.S',
      8: '...............S',
      9: '...............S',
      10: '..............GG',
      11: '...............T',
      12: '...............T',
    }),
    palette: { N: '#3D2B56', S: '#D6DCE5', G: '#F4C430', T: '#6B3E1F' },
  },
  {
    name: 're',
    symbol: 'W',
    grid: grid({
      0: '...Y...YY...Y...',
      1: '...YYYYRRYYYY...',
      3: 'mM............Mm',
      4: 'mM............Mm',
      5: 'mM............Mm',
      6: 'mM............Mm',
      7: 'mM............Mm',
      8: 'mM............Mm',
      9: 'mM............Mm',
      10: 'mM............Mm',
      11: 'mM............Mm',
      12: 'mM............Mm',
      13: 'mM............Mm',
    }),
    palette: { Y: '#F4C430', R: '#C0392B', M: '#C0392B', m: '#8E2A20' },
  },
  {
    name: 'arciere',
    symbol: ')',
    grid: grid({
      0: '.............FF.',
      1: '.....GGGGG..FF..',
      2: '.B.GGGGGGGGGFF..',
      3: '.BDDDDDDDDDDDD..',
      4: 'B...............',
      5: 'B...............',
      6: 'B...............',
      7: 'B...............',
      8: 'B...............',
      9: 'B...............',
      10: 'B...............',
      11: 'B...............',
      12: '.B..............',
      13: '.B..............',
    }),
    palette: { G: '#3E8E41', D: '#2B6330', F: '#E9E4D0', B: '#8B5A2B' },
  },
  {
    name: 'chierico',
    symbol: '+',
    grid: grid({
      0: '.......YY.......',
      1: '......WWWW......',
      2: '.....WWYYWW.....',
      3: '..WWWWWWWWWWWW..',
      7: 'SSSS............',
      8: 'BYYB............',
      9: 'YYYY............',
      10: 'BYYB............',
      11: '.SS.............',
    }),
    palette: { W: '#F5F0E1', Y: '#F4C430', S: '#D6DCE5', B: '#3B5BA9' },
  },
  {
    name: 'barbaro',
    symbol: 'Y',
    grid: grid({
      0: '.H............H.',
      1: '.H..IIIIIIII..H.',
      2: '.HIIIIIIIIIIIIH.',
      3: '..IIIIIIIIIIII..',
      4: '..DDDDDDDDDDDD.T',
      5: '.............AAT',
      6: '.............AAT',
      7: '............AAAT',
      8: '............AAAT',
      9: '.............AAT',
      10: '...............T',
      11: '...............T',
      12: '...............T',
      13: '...............T',
    }),
    palette: { H: '#E9E4D0', I: '#8E9AAF', D: '#5C6678', A: '#B7BEC9', T: '#6B3E1F' },
  },
]

const ASCII_FACE: Record<Mood, string> = {
  running: '(o_o)',
  completed: '(^_^)',
  failed: '(x_x)',
  idle: '(-_-)',
}

// Slot 0 (o non valido/negativo) e' il mago; i subagent ruotano sugli altri eroi.
function accessoryFor(slot: number): Accessory {
  const n = ACCESSORIES.length
  const s = Number.isFinite(slot) ? Math.floor(slot) : 0
  if (s <= 0) return ACCESSORIES[0]!
  return ACCESSORIES[1 + ((s - 1) % (n - 1))]!
}

// Converte le celle di un carattere in un unico path: una sotto-forma
// rettangolare per ogni run orizzontale di pixel uguali.
export function toPath(g: Grid, ch: string, px = PX): string {
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
      d += `M${x * px} ${y * px}h${w * px}v${px}h${-w * px}z`
      x += w
    }
  }
  return d
}

/** Strato SVG: un path per ogni colore della palette. */
export function layer(g: Grid, palette: Palette): string {
  let out = ''
  for (const ch of Object.keys(palette)) {
    const d = toPath(g, ch)
    if (d) out += `<path fill="${palette[ch]}" d="${d}"/>`
  }
  return out
}

// Lo SVG dipende solo da accessorio e mood: si calcola una volta sola.
/** Svg quadrato di lato `size` (viewBox e dimensioni coincidono), pixel nitidi. */
export function pixelSvg(size: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    body +
    '</svg>'
  )
}

/** Memoizza una funzione pura a un argomento: il risultato si calcola una volta per chiave. */
export function memo<K, V>(fn: (k: K) => V): (k: K) => V {
  const cache = new Map<K, V>()
  return k => {
    if (cache.has(k)) return cache.get(k) as V
    const v = fn(k)
    cache.set(k, v)
    return v
  }
}

const svgFor = memo((key: string): string => {
  const [i, mood] = key.split(':') as [string, Mood]
  return renderSvg(ACCESSORIES[Number(i)] as Accessory, mood)
})

export function claudeSvg(slot: number, mood: Mood): string {
  return svgFor(`${ACCESSORIES.indexOf(accessoryFor(slot))}:${mood}`)
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

  // Rimbalzo: veloce in running, lento in idle, assente negli altri stati.
  const dur = mood === 'running' ? '0.5s' : mood === 'idle' ? '2s' : null
  const motion = dur
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>`
    : ''

  return pixelSvg(64, `<g>${motion}${body}${eyes}${mouth}${accessory}</g>`)
}

export function asciiClaude(slot: number, mood: Mood, frame = 0): string[] {
  const face = ASCII_FACE[mood]
  // Corpo e faccia fermi; in running alterna solo il piede sollevato.
  const legs = mood !== 'running' ? ' /   \\ ' : Math.floor(frame / 2) % 2 === 0 ? ' |   \\ ' : ' /   | '
  return [`   ${accessoryFor(slot).symbol}   `, ` ${face} `, legs]
}

// Barra a blocchi: '█' pieni e '░' vuoti. pct null => 0 pieni.
export function pixelBarParts(pct: number | null, width = 16): { filled: string; empty: string } {
  const w = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 16
  const p = pct === null || !Number.isFinite(pct) ? 0 : Math.min(100, Math.max(0, pct))
  const filled = Math.round((p / 100) * w)
  return { filled: '█'.repeat(filled), empty: '░'.repeat(w - filled) }
}

export function pixelBar(pct: number | null, width = 16): string {
  const { filled, empty } = pixelBarParts(pct, width)
  return filled + empty
}

// --- Rendering a celle per il terminale (Raster) ---

// Sprite a risoluzione dimezzata: ogni sub-pixel copre 2x2 pixel dello sprite 16x16.
// 8 colonne x 8 sub-pixel = 4 righe di celle.
export const CLAUDE_COLUMNS = 8
export const CLAUDE_ROWS = 4
const SUB_ROWS = CLAUDE_ROWS * 2

export type Pixels = (string | null)[][]

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
const K = INK.K as string
const W = INK.W as string
// Occhi sulle righe 3-4 dei sub-pixel (righe 6-9 dello sprite): piu' in basso di elmi e cappucci, che arrivano alla riga 4.
const OPEN_EYES: FaceCell[] = [[3, 2, W], [4, 2, K], [3, 5, W], [4, 5, K]]
// Nel terminale niente bocca: solo gli occhi, in ogni stato.
const FACE: Record<Mood, FaceCell[]> = {
  running: OPEN_EYES,
  idle: OPEN_EYES,
  completed: [[3, 2, K], [3, 5, K]],
  failed: [[3, 2, K], [4, 2, K], [3, 5, K], [4, 5, K]],
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
  return packCells(claudePixels(slot, mood, frame), CLAUDE_COLUMNS, CLAUDE_ROWS)
}

// Impacchetta una matrice di sub-pixel (2 per cella in verticale) nelle celle di un Raster.
export function packCells(px: Pixels, columns: number, rows: number): string {
  const words = new Uint32Array(columns * rows * 3)
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < columns; x++) {
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
