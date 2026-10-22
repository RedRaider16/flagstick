// Saves hole scores with explicit per-cell state: saving → saved | failed | conflict.
// Uses optimistic concurrency: every save sends the version the user last saw.
import { useCallback, useState } from 'react'
import { AppError, errorMessage } from '../data/errors'
import type { EventBundle, Score } from '../domain/types'
import { useApp } from './context'

export type CellState =
  | { kind: 'saving'; value: number | null }
  | { kind: 'saved' }
  | { kind: 'failed'; value: number | null; message: string }
  | { kind: 'conflict'; value: number | null; current: Score | null; message: string }

export const cellKey = (entryId: string, hole: number) => `${entryId}:${hole}`

export function useScoreWriter(bundle: EventBundle | null, setBundle: (fn: (b: EventBundle | null) => EventBundle | null) => void) {
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
    (entryId: string, hole: number, score: Score | null) =>
      setBundle((b) => {
        if (!b) return b
        const rest = b.scores.filter((s) => !(s.entryId === entryId && s.hole === hole))
        return { ...b, scores: score ? [...rest, score] : rest }
      }),
    [setBundle],
  )

  /** value null = clear the hole (it becomes missing, never 0). */
  const save = useCallback(
    async (entryId: string, hole: number, value: number | null, reason = '', expectedOverride?: number | null) => {
      if (!bundle) return
      const k = cellKey(entryId, hole)
      const existing = bundle.scores.find((s) => s.entryId === entryId && s.hole === hole) ?? null
      const expected = expectedOverride !== undefined ? expectedOverride : existing?.version ?? null
      if (value === null && !existing) return
      if (value !== null && existing && existing.strokes === value && expectedOverride === undefined) return
      setCell(k, { kind: 'saving', value })
      try {
        if (value === null) {
          await repo.clearScore(bundle.round.id, entryId, hole, expected!, reason)
          applyLocal(entryId, hole, null)
        } else {
          const s = await repo.setScore(bundle.round.id, entryId, hole, value, expected, reason)
          applyLocal(entryId, hole, s)
        }
        setCell(k, { kind: 'saved' })
      } catch (e) {
        if (e instanceof AppError && e.kind === 'conflict' && e.current !== undefined) {
          applyLocal(entryId, hole, e.current)
          setCell(k, { kind: 'conflict', value, current: e.current, message: errorMessage(e) })
        } else {
          setCell(k, { kind: 'failed', value, message: errorMessage(e) })
        }
      }
    },
    [bundle, repo, applyLocal],
  )

  /** Conflict resolution: keep what's stored now. */
  const acceptTheirs = (entryId: string, hole: number) => setCell(cellKey(entryId, hole), null)
  /** Conflict resolution: overwrite with my value against the version now stored. */
  const keepMine = (entryId: string, hole: number, reason = '') => {
    const c = cells[cellKey(entryId, hole)]
    if (!c || c.kind !== 'conflict') return
    void save(entryId, hole, c.value, reason, c.current?.version ?? null)
  }

  return { cells, save, acceptTheirs, keepMine, clearCell: (e: string, h: number) => setCell(cellKey(e, h), null) }
}
