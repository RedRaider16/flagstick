// Saves hole scores with explicit per-cell state: saving → saved | queued | failed | conflict.
// Uses optimistic concurrency: every save sends the version the user last saw.
// A cell is a score slot: round + entry + hole, plus the player on best-ball holes.
//
// No signal: the score is kept on the phone (see outbox.ts) and sent, in order,
// as soon as the connection is back, including after the page is reopened.
// Each waiting score still carries the version the scorer saw, so a change made
// by someone else in the meantime shows up as a conflict instead of being overwritten.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError, errorMessage } from '../data/errors'
import type { ScoreSlot } from '../data/repo'
import type { EventBundle, Score } from '../domain/types'
import { useApp } from './context'
import { outbox, type Pending } from './outbox'

export type CellState =
  | { kind: 'saving'; value: number | null }
  | { kind: 'saved' }
  | { kind: 'queued'; value: number | null }
  | { kind: 'failed'; value: number | null; message: string }
  | { kind: 'conflict'; value: number | null; current: Score | null; message: string }

export const cellKey = (s: ScoreSlot) => `${s.roundId}|${s.entryId}|${s.playerId ?? ''}|${s.hole}`
export function parseCellKey(k: string): ScoreSlot {
  const [roundId, entryId, playerId, hole] = k.split('|')
  return { roundId: roundId!, entryId: entryId!, playerId: playerId || null, hole: Number(hole) }
}

const sameSlot = (s: Score, slot: ScoreSlot) =>
  s.roundId === slot.roundId && s.entryId === slot.entryId && s.hole === slot.hole && (s.playerId ?? null) === slot.playerId

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false
const RETRY_MS = 20_000

/** cardCode: save with a printed scorecard's QR code instead of the signed-in role. */
export function useScoreWriter(bundle: EventBundle | null, setBundle: (fn: (b: EventBundle | null) => EventBundle | null) => void, cardCode?: string) {
  const { repo } = useApp()
  const [cells, setCells] = useState<Record<string, CellState>>({})
  const eventId = bundle?.event.id
  const flushing = useRef(false)

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

  /** Send one change. Resolves to the stored score (null after a clear). */
  const send = useCallback(
    async (slot: ScoreSlot, value: number | null, expected: number | null, reason: string, code: string | undefined) => {
      if (value === null) {
        if (expected !== null) await repo.clearScore(slot, expected, reason, code)
        return null
      }
      return repo.setScore(slot, value, expected, reason, code)
    },
    [repo],
  )

  /** Keep a change on the phone; shows "waiting for signal". */
  const queue = (p: Pending) => {
    if (outbox.put(p)) setCell(p.key, { kind: 'queued', value: p.value })
    else setCell(p.key, { kind: 'failed', value: p.value, message: "No signal, and this phone can't store it. Write it on the card and try again." })
  }

  /** Outcome of a send that failed: queue it again, or show what's wrong. */
  const handleError = (k: string, slot: ScoreSlot, value: number | null, e: unknown, retry: () => void) => {
    if (e instanceof AppError && e.kind === 'network') return retry()
    outbox.remove(k)
    if (e instanceof AppError && e.kind === 'conflict' && e.current !== undefined) {
      applyLocal(slot, e.current)
      setCell(k, { kind: 'conflict', value, current: e.current, message: errorMessage(e) })
    } else {
      setCell(k, { kind: 'failed', value, message: errorMessage(e) })
    }
  }

  /** value null = clear the hole (it becomes missing, never 0). */
  const save = useCallback(
    async (slot: ScoreSlot, value: number | null, reason = '', expectedOverride?: number | null) => {
      if (!bundle) return
      const k = cellKey(slot)
      const existing = bundle.scores.find((s) => sameSlot(s, slot)) ?? null
      const waiting = outbox.get(k)
      // A change still waiting keeps the version seen when it was first made.
      const expected = expectedOverride !== undefined ? expectedOverride : waiting ? waiting.expected : existing?.version ?? null
      const backToStored = (value === null && !existing) || (value !== null && existing?.strokes === value)
      if (expectedOverride === undefined && backToStored) {
        if (waiting) {
          outbox.remove(k)
          setCell(k, null)
        }
        return
      }
      const p: Pending = { key: k, eventId: bundle.event.id, slot, value, expected, reason, cardCode, at: new Date().toISOString() }
      if (offline()) return queue(p)
      setCell(k, { kind: 'saving', value })
      try {
        const s = await send(slot, value, expected, reason, cardCode)
        outbox.remove(k)
        applyLocal(slot, s)
        setCell(k, { kind: 'saved' })
      } catch (e) {
        handleError(k, slot, value, e, () => queue(p))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bundle, send, applyLocal, cardCode],
  )

  /** Send everything waiting on this phone for this event, oldest first; stop at the first network failure. */
  const flush = useCallback(async () => {
    if (!eventId || flushing.current || offline()) return
    flushing.current = true
    try {
      for (const p of outbox.list(eventId).sort((a, b) => a.at.localeCompare(b.at))) {
        setCell(p.key, { kind: 'saving', value: p.value })
        try {
          const s = await send(p.slot, p.value, p.expected, p.reason, p.cardCode)
          outbox.remove(p.key)
          applyLocal(p.slot, s)
          setCell(p.key, { kind: 'saved' })
        } catch (e) {
          let stop = false
          handleError(p.key, p.slot, p.value, e, () => {
            setCell(p.key, { kind: 'queued', value: p.value })
            stop = true
          })
          if (stop) break
        }
      }
    } finally {
      flushing.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, send, applyLocal])

  // Show what's waiting from before (page reopened), then keep trying to send it.
  useEffect(() => {
    if (!eventId) return
    const waiting = outbox.list(eventId)
    if (waiting.length) setCells((c) => ({ ...c, ...Object.fromEntries(waiting.map((p) => [p.key, { kind: 'queued', value: p.value } as CellState])) }))
    void flush()
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    const t = setInterval(() => {
      if (outbox.list(eventId).length) void flush()
    }, RETRY_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      clearInterval(t)
    }
  }, [eventId, flush])

  /** Conflict resolution: keep what's stored now. */
  const acceptTheirs = (slot: ScoreSlot) => setCell(cellKey(slot), null)
  /** Conflict resolution: overwrite with my value against the version now stored. */
  const keepMine = (slot: ScoreSlot, reason = '') => {
    const c = cells[cellKey(slot)]
    if (!c || c.kind !== 'conflict') return
    void save(slot, c.value, reason, c.current?.version ?? null)
  }

  const waitingCount = Object.values(cells).filter((c) => c.kind === 'queued').length
  return { cells, save, acceptTheirs, keepMine, flush, waitingCount, clearCell: (slot: ScoreSlot) => setCell(cellKey(slot), null) }
}
