// Matching scorecards ("card back") for a single 18-hole round.
// Source: USGA Rules of Golf, Committee Procedures 5A(6). The Committee Procedures
// recommend that "last nine/six/three" mean holes 10–18, 13–18, 16–18 even when
// players start on different tees; we follow that for every start type.

export interface CardBackStep {
  label: string
  holes: number[]
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

export const CARD_BACK_STEPS: CardBackStep[] = [
  { label: 'holes 10–18', holes: range(10, 18) },
  { label: 'holes 13–18', holes: range(13, 18) },
  { label: 'holes 16–18', holes: range(16, 18) },
  { label: 'hole 18', holes: [18] },
  { label: 'holes 4–9', holes: range(4, 9) },
  { label: 'holes 7–9', holes: range(7, 9) },
  { label: 'hole 9', holes: [9] },
]

/** Score lookup for a complete card: hole number → strokes. */
export type Card = ReadonlyMap<number, number>

function sum(card: Card, holes: number[]): number {
  let s = 0
  for (const h of holes) {
    const v = card.get(h)
    if (v === undefined) throw new Error(`card-back requires a complete card; hole ${h} is missing`)
    s += v
  }
  return s
}

export interface CardBackResult<T> {
  /** Groups in finishing order. Members of the same inner array remain tied. */
  order: T[][]
  /** For each item, the step that separated it from the next group, if any. */
  decidedBy: Map<T, string>
}

/**
 * Order a group of entries that are tied on total using matching scorecards.
 * Recursively splits the group at each step; anything still level after the last
 * step stays tied.
 */
export function cardBack<T>(items: T[], cardOf: (t: T) => Card): CardBackResult<T> {
  const decidedBy = new Map<T, string>()
  const order = split(items, 0)
  return { order, decidedBy }

  function split(group: T[], stepIdx: number): T[][] {
    if (group.length <= 1) return [group]
    const step = CARD_BACK_STEPS[stepIdx]
    if (!step) return [group]
    const buckets = new Map<number, T[]>()
    for (const t of group) {
      const s = sum(cardOf(t), step.holes)
      const b = buckets.get(s)
      if (b) b.push(t)
      else buckets.set(s, [t])
    }
    const sortedKeys = [...buckets.keys()].sort((a, b) => a - b)
    if (sortedKeys.length > 1) {
      for (const k of sortedKeys) {
        const b = buckets.get(k)!
        if (b.length === 1) decidedBy.set(b[0]!, step.label)
      }
    }
    return sortedKeys.flatMap((k) => split(buckets.get(k)!, stepIdx + 1))
  }
}
