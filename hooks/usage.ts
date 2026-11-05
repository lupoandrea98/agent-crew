import type { RateLimitRow } from '../types'

const KINDS = ['five_hour', 'seven_day'] as const

/** Tiene solo le finestre 5h e settimanale, in ordine fisso. */
export const pickLimits = (all: ReadonlyArray<RateLimitRow>): RateLimitRow[] =>
  KINDS.flatMap(kind => {
    const r = all.find(x => x.kind === kind)
    return r ? [{ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }] : []
  })

export const labelFor = (kind: string): string =>
  kind === 'five_hour' ? 'Mana' : kind === 'seven_day' ? 'Vigore' : kind

/** Icona e colore fisso della barra HUD di una finestra di utilizzo. */
export const hudKindFor = (kind: string): 'mana' | 'stamina' | undefined =>
  kind === 'five_hour' ? 'mana' : kind === 'seven_day' ? 'stamina' : undefined

export const colorForPct = (pct: number): 'green' | 'yellow' | 'red' =>
  pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green'

// Soglie d'allerta sulla percentuale RESTANTE.
export const LIFE_YELLOW = 55
export const SIDE_YELLOW = 50
export const SIDE_RED = 20

/** Vita: gialla sotto il 55% (invito a fare /compact o a ripartire), altrimenti il colore base. */
export const lifeColor = (leftPct: number | null, base: string): string =>
  leftPct !== null && leftPct < LIFE_YELLOW ? 'yellow' : base

/** Mana e Vigore: gialli sotto il 50%, rossi sotto il 20%, altrimenti il colore base. */
export const sideColor = (leftPct: number, base: string): string =>
  leftPct < SIDE_RED ? 'red' : leftPct < SIDE_YELLOW ? 'yellow' : base

/** Quanto resta di una risorsa (0-100) dato quanto e' stato usato. */
export const remainingPct = (usedPct: number): number =>
  Number.isFinite(usedPct) ? Math.min(100, Math.max(0, Math.round(100 - usedPct))) : 0

/** Percentuale di contesto usata, o null se non ancora nota (sessione nuova o appena compattata). */
export const contextPct = (context: { percent?: number | null } | undefined): number | null =>
  context && typeof context.percent === 'number' && Number.isFinite(context.percent)
    ? Math.min(100, Math.max(0, Math.round(context.percent)))
    : null

// Larghezze in celle della fascia HUD sopra il prompt.
const HUD_ICON = 5 // icona (4 colonne) + spazio
const HUD_GAP = 2 // spazio tra i blocchi
const HUD_PCT = 4 // "100%" (la Vita, che non ha il testo reale nei lati)
const HUD_LIFE_LABEL = 'Vita'
const HUD_MAX_LIFE_BAR = 40
const HUD_NO_LIMITS = 'Mana e Vigore n/d'.length

export type HudLayout = {
  /** false: nemmeno la versione piu' compatta entra, la fascia non si disegna. */
  show: boolean
  /** Le etichette Vita/Mana/Vigore compaiono tutte insieme o nessuna. */
  showLabels: boolean
  showReset: boolean
  lifeBar: number
  /** Larghezza della barra di ogni blocco Mana/Vigore, nell'ordine di `sides`. */
  sideBars: number[]
}

/**
 * Sceglie come disegnare l'HUD in `columns` celle senza mai andare a capo.
 * Scala: completo, senza etichette, senza countdown, fascia nascosta.
 * `sides` sono i blocchi Mana/Vigore presenti (etichetta, percentuale e countdown gia' formattati):
 * la barra di ciascuno e' larga quanto la riga di testo sopra di lei, cosi' finiscono nello stesso punto.
 * Senza countdown non c'e' una riga da seguire e la barra ha una larghezza minima fissa.
 */
export const hudLayout = (
  columns: number,
  sides: ReadonlyArray<{ label: string; pct: string; reset: string }>,
): HudLayout => {
  const cols = Number.isFinite(columns) ? Math.floor(columns) : 0
  const steps: Array<{ labels: boolean; reset: boolean; lifeMin: number }> = [
    { labels: true, reset: true, lifeMin: 8 },
    { labels: false, reset: true, lifeMin: 8 },
    { labels: false, reset: false, lifeMin: 6 },
  ]
  for (const step of steps) {
    const lines = sides.map(
      s => (step.labels ? s.label.length + 1 : 0) + s.pct.length + (step.reset ? 1 + s.reset.length : 0),
    )
    const lifeLine = (step.labels ? HUD_LIFE_LABEL.length + 1 : 0) + HUD_PCT
    if (sides.length === 0) {
      const room = cols - (HUD_GAP + HUD_NO_LIMITS) - HUD_ICON
      if (room >= Math.max(lifeLine, step.lifeMin)) {
        return { show: true, showLabels: step.labels, showReset: step.reset, lifeBar: Math.min(HUD_MAX_LIFE_BAR, room), sideBars: [] }
      }
      continue
    }
    // Tutte le barre hanno la stessa larghezza e si dividono lo spazio libero; mai piu' strette del testo che hanno sopra.
    const blocks = sides.length + 1
    const minBar = Math.max(lifeLine, step.lifeMin, ...lines)
    const bar = Math.min(HUD_MAX_LIFE_BAR, Math.floor((cols - blocks * HUD_ICON - sides.length * HUD_GAP) / blocks))
    if (bar >= minBar) {
      return {
        show: true,
        showLabels: step.labels,
        showReset: step.reset,
        lifeBar: bar,
        sideBars: sides.map(() => bar),
      }
    }
  }
  return { show: false, showLabels: false, showReset: false, lifeBar: 0, sideBars: [] }
}

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
