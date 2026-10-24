// Converting between form inputs and stored values.

/** "2026-10-30T18:00" in the event's zone ⇄ ISO. datetime-local has no zone, so we
 * interpret it in the event's time zone using the offset at that moment. */
export function zonedInputToIso(local: string, tz: string): string | null {
  if (!local) return null
  const [d, t] = local.split('T')
  const [y, m, day] = d!.split('-').map(Number)
  const [hh, mm] = t!.split(':').map(Number)
  const guess = Date.UTC(y!, m! - 1, day!, hh!, mm!)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {})
  const asIfUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!)
  return new Date(guess - (asIfUtc - guess)).toISOString()
}
export function isoToZonedInput(iso: string | null, tz: string): string {
  if (!iso) return ''
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {})
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
export const dollarsToCents = (s: string): number | null | 'bad' => {
  const t = s.replace(/[$,\s]/g, '')
  if (!t) return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'bad'
  return Math.round(Number(t) * 100)
}
export const centsToDollars = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''))

