// Input validation shared by the UI and mirrored by database CHECK constraints.

export const MIN_STROKES = 1
export const MAX_STROKES = 20

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

/** Parse a hole score typed or tapped by a user. Blank is NOT zero — it is an error here;
 * clearing a score is a separate, explicit action. */
export function parseStrokes(input: unknown): Validated<number> {
  if (input === null || input === undefined) return { ok: false, error: 'Enter a score.' }
  const text = typeof input === 'number' ? String(input) : String(input).trim()
  if (text === '') return { ok: false, error: 'Enter a score.' }
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Scores must be whole numbers.' }
  const n = Number(text)
  if (n < MIN_STROKES) return { ok: false, error: `A hole score must be at least ${MIN_STROKES}.` }
  if (n > MAX_STROKES) return { ok: false, error: `A hole score can't be more than ${MAX_STROKES}.` }
  return { ok: true, value: n }
}

export function isValidHoleNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 18
}

export interface HoleInput {
  number: number
  par: number
  yardage: number | null
  strokeIndex: number
}

/** Validate a full 18-hole layout. Returns a list of human-readable problems (empty = valid). */
export function validateHoleLayout(holes: HoleInput[]): string[] {
  const errors: string[] = []
  if (holes.length !== 18) errors.push(`A course needs exactly 18 holes; found ${holes.length}.`)

  const seenHole = new Map<number, number>()
  const seenSi = new Map<number, number>()
  for (const h of holes) {
    const label = `Hole ${h.number}`
    if (!isValidHoleNumber(h.number)) errors.push(`Hole number "${h.number}" must be 1–18.`)
    else seenHole.set(h.number, (seenHole.get(h.number) ?? 0) + 1)

    if (!Number.isInteger(h.par) || h.par < 3 || h.par > 6) errors.push(`${label}: par must be 3, 4, 5 or 6.`)
    if (h.yardage !== null && (!Number.isInteger(h.yardage) || h.yardage < 50 || h.yardage > 800))
      errors.push(`${label}: yardage must be a whole number from 50 to 800, or blank.`)
    if (!Number.isInteger(h.strokeIndex) || h.strokeIndex < 1 || h.strokeIndex > 18)
      errors.push(`${label}: stroke index must be 1–18.`)
    else seenSi.set(h.strokeIndex, (seenSi.get(h.strokeIndex) ?? 0) + 1)
  }
  for (const [n, c] of seenHole) if (c > 1) errors.push(`Hole ${n} appears ${c} times.`)
  for (const [si, c] of seenSi) if (c > 1) errors.push(`Stroke index ${si} is used ${c} times; each must be used once.`)
  if (holes.length === 18) {
    for (let i = 1; i <= 18; i++) if (!seenHole.has(i)) errors.push(`Hole ${i} is missing.`)
  }
  return errors
}
