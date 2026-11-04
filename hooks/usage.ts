import type { RateLimitRow } from '../types'

const KINDS = ['five_hour', 'seven_day'] as const

/** Tiene solo le finestre 5h e settimanale, in ordine fisso. */
export const pickLimits = (all: ReadonlyArray<RateLimitRow>): RateLimitRow[] =>
  KINDS.flatMap(kind => {
    const r = all.find(x => x.kind === kind)
    return r ? [{ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }] : []
  })

export const labelFor = (kind: string): string =>
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? 'Sett' : kind

export const colorForPct = (pct: number): 'green' | 'yellow' | 'red' =>
  pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green'

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
