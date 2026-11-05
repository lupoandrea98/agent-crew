import type { RateLimitRow } from '../types'

/** Le finestre dei limiti mostrate nell'HUD, in ordine fisso. */
const LIMIT_KINDS = ['five_hour', 'seven_day'] as const

/** Tiene solo le finestre 5h e settimanale, in ordine fisso. */
export const pickLimits = (all: ReadonlyArray<RateLimitRow>): RateLimitRow[] =>
  LIMIT_KINDS.flatMap(kind => {
    const r = all.find(x => x.kind === kind)
    return r ? [{ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }] : []
  })

// Soglie d'allerta sulla percentuale RESTANTE.
export const CONTEXT_YELLOW = 55
export const LIMIT_YELLOW = 50
export const LIMIT_RED = 20

/** Contesto (Vigore): giallo sotto il 55% (invito a fare /compact o a ripartire), altrimenti il colore base. */
export const contextColor = (leftPct: number | null, base: string): string =>
  leftPct !== null && leftPct < CONTEXT_YELLOW ? 'yellow' : base

/** Limiti di utilizzo (Vita e Mana): gialli sotto il 50%, rossi sotto il 20%, altrimenti il colore base. */
export const limitColor = (leftPct: number, base: string): string =>
  leftPct < LIMIT_RED ? 'red' : leftPct < LIMIT_YELLOW ? 'yellow' : base

const clampPct = (n: number): number => Math.min(100, Math.max(0, Math.round(n)))

/** Quanto resta di una risorsa (0-100) dato quanto e' stato usato. */
export const remainingPct = (usedPct: number): number => (Number.isFinite(usedPct) ? clampPct(100 - usedPct) : 0)

/** Percentuale di contesto usata, o null se non ancora nota (sessione nuova o appena compattata). */
export const contextPct = (context: { percent?: number | null } | undefined): number | null =>
  context && typeof context.percent === 'number' && Number.isFinite(context.percent)
    ? clampPct(context.percent)
    : null

/** Solo il conto alla rovescia: "2h 14m" per la finestra 5h, "3g 4h" per la settimanale. */
export const formatReset = (resetsAt: string | undefined, nowMs: number, kind: string): string => {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(at)) return 'n/d'
  const mins = Math.max(0, Math.floor((at - nowMs) / 60_000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (kind === 'seven_day') return d > 0 ? `${d}g ${h}h` : `${h}h`
  return `${Math.floor(mins / 60)}h ${m}m`
}

export type HudKind = 'life' | 'mana' | 'stamina'

/** Un blocco dell'HUD, con le stringhe gia' formattate. */
export type HudBlock = {
  kind: HudKind
  label: string
  /** Quanto resta (0-100), null se il dato manca. */
  left: number | null
  /** "75%" oppure "n/d". */
  pct: string
  /** Conto alla rovescia: solo per i blocchi da limite con dato. */
  reset?: string
  /** Colore d'allerta (o colore base). */
  alert: string
}

// Tabella unica, in ordine: Vita = settimanale, Mana = finestra 5h, Vigore = contesto.
// `base` ripete il colore di ICONS[kind].color (qui non si importa icons.ts).
const HUD_TABLE = [
  { kind: 'life', label: 'Vita', source: 'seven_day', base: 'red' },
  { kind: 'mana', label: 'Mana', source: 'five_hour', base: 'blue' },
  { kind: 'stamina', label: 'Vigore', source: 'context', base: 'green' },
] as const

/** I tre blocchi dell'HUD (sempre tre; dato mancante = n/d, barra vuota, niente countdown). */
export const hudBlocks = (limits: ReadonlyArray<RateLimitRow>, ctxUsed: number | null, nowMs: number): HudBlock[] =>
  HUD_TABLE.map(({ kind, label, source, base }): HudBlock => {
    if (source === 'context') {
      const left = ctxUsed === null ? null : remainingPct(ctxUsed)
      return { kind, label, left, pct: left === null ? 'n/d' : `${left}%`, alert: contextColor(left, base) }
    }
    const l = limits.find(x => x.kind === source)
    if (!l) return { kind, label, left: null, pct: 'n/d', alert: base }
    const left = remainingPct(l.percentUsed)
    return {
      kind,
      label,
      left,
      pct: `${left}%`,
      reset: formatReset(l.resetsAt, nowMs, source),
      alert: limitColor(left, base),
    }
  })

// Larghezze in celle della fascia HUD sopra il prompt.
const HUD_ICON = 5 // icona (4 colonne) + spazio
const HUD_GAP = 2 // spazio tra i blocchi
const HUD_PCT = 4 // "100%"
const HUD_MAX_BAR = 40

export type HudLayout = {
  /** false: nemmeno la versione piu' compatta entra, la fascia non si disegna. */
  show: boolean
  /** Le etichette Vita/Mana/Vigore compaiono tutte insieme o nessuna. */
  showLabels: boolean
  showReset: boolean
  /** Larghezza in celle della barra (uguale per tutti i blocchi; usata solo nel terminale). */
  bar: number
}

/**
 * Sceglie come disegnare l'HUD in `columns` celle senza mai andare a capo.
 * Scala: completo, senza etichette, senza countdown, fascia nascosta.
 * Le barre sono tutte uguali, si dividono lo spazio libero (max 40) e non sono mai piu' strette del testo che hanno sopra.
 */
export const hudLayout = (
  columns: number,
  blocks: ReadonlyArray<{ label: string; pct: string; reset?: string }>,
): HudLayout => {
  const cols = Number.isFinite(columns) ? Math.floor(columns) : 0
  const n = blocks.length
  const steps: Array<{ labels: boolean; reset: boolean; barMin: number }> = [
    { labels: true, reset: true, barMin: 8 },
    { labels: false, reset: true, barMin: 8 },
    { labels: false, reset: false, barMin: 6 },
  ]
  if (n > 0) {
    const bar = Math.min(HUD_MAX_BAR, Math.floor((cols - n * HUD_ICON - (n - 1) * HUD_GAP) / n))
    for (const step of steps) {
      const lines = blocks.map(
        b =>
          (step.labels ? b.label.length + 1 : 0) +
          Math.max(b.pct.length, HUD_PCT) +
          (b.reset && step.reset ? 1 + b.reset.length : 0),
      )
      if (bar >= Math.max(step.barMin, ...lines)) return { show: true, showLabels: step.labels, showReset: step.reset, bar }
    }
  }
  return { show: false, showLabels: false, showReset: false, bar: 0 }
}
