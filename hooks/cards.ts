// Card rendering helpers for the agent-crew hooks. Pure TypeScript: no deps, no DOM, no Node APIs.

export type CardColor = { border: string; text: string; dark1: string; dark2: string }

// 8 distinct hues. border = vivid color, text = same hue slightly lighter,
// dark1 = ~30% lightness, dark2 = ~15% lightness.
export const CARD_COLORS: CardColor[] = [
  { border: '#ff8000', text: '#ffa640', dark1: '#994d00', dark2: '#4d2600' }, // arancio
  { border: '#00e0ff', text: '#40e8ff', dark1: '#008699', dark2: '#00434d' }, // ciano
  { border: '#ff00cc', text: '#ff40dc', dark1: '#99007a', dark2: '#4d003d' }, // magenta
  { border: '#00ff66', text: '#40ff8c', dark1: '#00993d', dark2: '#004d1f' }, // verde
  { border: '#0066ff', text: '#40a6ff', dark1: '#003d99', dark2: '#001f4d' }, // blu
  { border: '#ff0000', text: '#ff4040', dark1: '#990000', dark2: '#4d0000' }, // rosso
  { border: '#ffe600', text: '#fff040', dark1: '#998a00', dark2: '#4d4500' }, // giallo
  { border: '#9900ff', text: '#c240ff', dark1: '#5c0099', dark2: '#2e004d' }, // viola
]

// Stable string hash: weighted sum of char codes.
function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h += name.charCodeAt(i) * (i + 1)
  }
  return h
}

export function colorFor(name: string): CardColor {
  return CARD_COLORS[hashName(name) % CARD_COLORS.length] ?? CARD_COLORS[0]!
}

export function baseName(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

export type CardLine = { text: string; color?: string }

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)) + '…'
}

export function cardSvg(opts: { path: string; lines: CardLine[]; width: number }): string {
  const W = Math.max(opts.width, 160)
  const H = 10 + 26 + 18 * opts.lines.length + 10

  const name = baseName(opts.path)
  const color = colorFor(name)
  const gid = 'g' + hashName(name)

  // Title mini-card: ~8.5px per monospace bold char at 13px, plus 20px padding.
  const maxTitleW = W - 20
  const maxNameChars = Math.max(1, Math.floor((maxTitleW - 20) / 8.5))
  const shownName = truncate(name, maxNameChars)
  const titleW = Math.round(shownName.length * 8.5 + 20)

  // Body lines: ~7.2px per monospace char at 12px, available width W - 24.
  const maxLineChars = Math.max(1, Math.floor((W - 24) / 7.2))

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`)
  parts.push(
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${color.dark1}"/>` +
      `<stop offset="1" stop-color="${color.dark2}"/>` +
      `</linearGradient></defs>`
  )
  parts.push(
    `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="6" fill="none" stroke="${color.border}" stroke-width="1.5"/>`
  )
  parts.push(
    `<rect x="10" y="8" width="${titleW}" height="22" rx="4" fill="url(#${gid})" stroke="${color.border}" stroke-width="1.5"/>`
  )
  parts.push(
    `<text x="20" y="24" font-family="ui-monospace,Menlo,monospace" font-size="13" font-weight="bold" fill="${color.text}">${escXml(shownName)}</text>`
  )
  opts.lines.forEach((line, i) => {
    const y = 44 + 18 * i
    const fill = line.color ?? '#cfcfcf'
    parts.push(
      `<text x="12" y="${y}" font-family="ui-monospace,Menlo,monospace" font-size="12" fill="${escXml(fill)}">${escXml(truncate(line.text, maxLineChars))}</text>`
    )
  })
  parts.push('</svg>')
  return parts.join('')
}
