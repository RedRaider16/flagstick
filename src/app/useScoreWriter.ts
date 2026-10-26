// Saves hole scores with explicit per-cell state: saving → saved | failed | conflict.
// Uses optimistic concurrency: every save sends the version the user last saw.
// A cell is a score slot: round + entry + hole, plus the player on best-ball holes.
import { useCallback, useState } from 'react'
import { AppError, errorMessage } from '../data/errors'
import type { ScoreSlot } from '../data/repo'
import type { EventBundle, Score } from '../domain/types'
import { useApp } from './context'

export type CellState =
  | { kind: 'saving'; value: number | null }
  | { kind: 'saved' }
  | { kind: 'failed'; value: number | null; message: string }
  | { kind: 'conflict'; value: number | null; current: Score | null; message: string }

export const cellKey = (s: ScoreSlot) => `${s.roundId}|${s.entryId}|${s.playerId ?? ''}|${s.hole}`
export function parseCellKey(k: string): ScoreSlot {
  const [roundId, entryId, playerId, hole] = k.split('|')
  return { roundId: roundId!, entryId: entryId!, playerId: playerId || null, hole: Number(hole) }
}

const sameSlot = (s: Score, slot: ScoreSlot) =>
  s.roundId === slot.roundId && s.entryId === slot.entryId && s.hole === slot.hole && (s.playerId ?? null) === slot.playerId

/** cardCode: save with a printed scorecard's QR code instead of the signed-in role. */
export function useScoreWriter(bundle: EventBundle | null, setBundle: (fn: (b: EventBundle | null) => EventBundle | null) => void, cardCode?: string) {
  const { repo } = useApp()
  const [cells, setCells] = useState<Record<string, CellState>>({})

  const setCell = (k: string, s: CellState | null) =>
    setCells((c) => {
      const n = { ...c }
      if (s) n[k] = s
      else delete n[k]
      return n
    })

  const applyLocal = useCallback(
    (slot: ScoreSlot, score: Score | null) =>
      setBundle((b) => {
        if (!b) return b
        const rest = b.scores.filter((s) => !sameSlot(s, slot))
        return { ...b, scores: score ? [...rest, score] : rest }
      }),
    [setBundle],
  )

  /** value null = clear the hole (it becomes missing, never 0). */
  const save = useCallback(
    async (slot: ScoreSlot, value: number | null, reason = '', expectedOverride?: number | null) => {
      if (!bundle) return
      const k = cellKey(slot)
      const existing = bundle.scores.find((s) => sameSlot(s, slot)) ?? null
      const expected = expectedOverride !== undefined ? expectedOverride : existing?.version ?? null
      if (value === null && !existing) return
      if (value !== null && existing && existing.strokes === value && expectedOverride === undefined) return
      setCell(k, { kind: 'saving', value })
      try {
        if (value === null) {
          await repo.clearScore(slot, expected!, reason, cardCode)
          applyLocal(slot, null)
        } else {
          const s = await repo.setScore(slot, value, expected, reason, cardCode)
          applyLocal(slot, s)
        }
        setCell(k, { kind: 'saved' })
      } catch (e) {
        if (e instanceof AppError && e.kind === 'conflict' && e.current !== undefined) {
          applyLocal(slot, e.current)
          setCell(k, { kind: 'conflict', value, current: e.current, message: errorMessage(e) })
        } else {
          setCell(k, { kind: 'failed', value, message: errorMessage(e) })
        }
      }
    },
    [bundle, repo, applyLocal, cardCode],
  )

  /** Conflict resolution: keep what's stored now. */
  const acceptTheirs = (slot: ScoreSlot) => setCell(cellKey(slot), null)
  /** Conflict resolution: overwrite with my value against the version now stored. */
  const keepMine = (slot: ScoreSlot, reason = '') => {
    const c = cells[cellKey(slot)]
    if (!c || c.kind !== 'conflict') return
    void save(slot, c.value, reason, c.current?.version ?? null)
  }

  return { cells, save, acceptTheirs, keepMine, clearCell: (slot: ScoreSlot) => setCell(cellKey(slot), null) }
}
