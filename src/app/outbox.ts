// Scores waiting on this phone for a signal. Kept in localStorage so they also
// survive the page being closed; sent in the order they were entered.
import type { ScoreSlot } from '../data/repo'

export interface Pending {
  key: string
  eventId: string
  slot: ScoreSlot
  /** null = clear the hole. */
  value: number | null
  /** Version of the stored score when the scorer made the change (null = the hole looked empty). */
  expected: number | null
  reason: string
  cardCode?: string
  at: string
}

const KEY = 'flagstick-outbox-v1'

function readAll(): Pending[] {
  try {
    const raw = localStorage.getItem(KEY)
    const xs = raw ? (JSON.parse(raw) as Pending[]) : []
    return Array.isArray(xs) ? xs : []
  } catch {
    return []
  }
}

function writeAll(xs: Pending[]): boolean {
  try {
    if (xs.length) localStorage.setItem(KEY, JSON.stringify(xs))
    else localStorage.removeItem(KEY)
    return true
  } catch {
    return false
  }
}

export const outbox = {
  list(eventId: string): Pending[] {
    return readAll().filter((x) => x.eventId === eventId)
  },
  /** Add or replace the waiting change for a slot. Returns false if this phone can't store it. */
  put(p: Pending): boolean {
    return writeAll([...readAll().filter((x) => x.key !== p.key), p])
  },
  remove(key: string): void {
    writeAll(readAll().filter((x) => x.key !== key))
  },
  get(key: string): Pending | undefined {
    return readAll().find((x) => x.key === key)
  },
}
