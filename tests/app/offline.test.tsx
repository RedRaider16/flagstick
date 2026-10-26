// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { RepoProvider } from '../../src/app/context'
import { outbox } from '../../src/app/outbox'
import { cellKey, useScoreWriter } from '../../src/app/useScoreWriter'
import { DemoRepo } from '../../src/data/demoRepo'
import { AppError } from '../../src/data/errors'
import type { ScoreSlot } from '../../src/data/repo'
import type { EventBundle } from '../../src/domain/types'

/** Demo store whose network can be switched off. */
class FlakyRepo extends DemoRepo {
  down = false
  sent: number[] = []
  override async setScore(...a: Parameters<DemoRepo['setScore']>) {
    if (this.down) throw new AppError('Network problem — check your connection and try again.', 'network')
    this.sent.push(a[1])
    return super.setScore(...a)
  }
}

const setOnline = (v: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v })

async function setup(repo: FlakyRepo) {
  const start = await repo.loadBundle('ev-classic')
  const wrapper = ({ children }: { children: ReactNode }) => <RepoProvider repo={repo} base="/demo">{children}</RepoProvider>
  const hook = renderHook(() => {
    const [b, setB] = useState<EventBundle | null>(start)
    return { b, w: useScoreWriter(b, setB) }
  }, { wrapper })
  const entry = start.groups.find((g) => g.id === 'gr-c1')!.entryIds[0]!
  // A hole nobody has scored yet.
  const hole = [...Array(18).keys()].map((i) => i + 1).find((h) => !start.scores.some((s) => s.entryId === entry && s.hole === h))!
  const slot: ScoreSlot = { roundId: 'rd-classic', entryId: entry, playerId: null, hole }
  return { hook, slot }
}

beforeEach(() => {
  localStorage.clear()
  setOnline(true)
})

describe('scores with no signal', () => {
  it('keeps the score on the phone and sends it when the signal returns', async () => {
    const repo = new FlakyRepo()
    repo.setRole('admin')
    const { hook, slot } = await setup(repo)
    repo.down = true
    setOnline(false)
    await act(() => hook.result.current.w.save(slot, 5))
    expect(hook.result.current.w.cells[cellKey(slot)]).toEqual({ kind: 'queued', value: 5 })
    expect(outbox.list('ev-classic')).toHaveLength(1)
    expect(repo.sent).toEqual([])
    // Changing it again while offline replaces the waiting score.
    await act(() => hook.result.current.w.save(slot, 6))
    expect(outbox.list('ev-classic').map((p) => p.value)).toEqual([6])

    repo.down = false
    setOnline(true)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(hook.result.current.w.cells[cellKey(slot)]).toEqual({ kind: 'saved' }))
    expect(repo.sent).toEqual([6])
    expect(outbox.list('ev-classic')).toEqual([])
    expect(hook.result.current.b!.scores.find((s) => s.entryId === slot.entryId && s.hole === slot.hole)!.strokes).toBe(6)
  })

  it('a save that fails mid-flight on a dropped signal is kept too, and survives reopening the page', async () => {
    const repo = new FlakyRepo()
    repo.setRole('admin')
    const first = await setup(repo)
    repo.down = true // phone thinks it's online, the request fails
    await act(() => first.hook.result.current.w.save(first.slot, 4))
    expect(first.hook.result.current.w.cells[cellKey(first.slot)]?.kind).toBe('queued')
    first.hook.unmount()

    repo.down = false
    await setup(repo) // page reopened: picks up the waiting score and sends it
    await waitFor(() => expect(outbox.list('ev-classic')).toEqual([]))
    expect(repo.sent).toEqual([4])
  })

  it('if someone else scored the hole meanwhile, it asks instead of overwriting', async () => {
    const repo = new FlakyRepo()
    repo.setRole('admin')
    const { hook, slot } = await setup(repo)
    setOnline(false)
    await act(() => hook.result.current.w.save(slot, 5))
    // Another scorer saves 3 on the same hole while this phone has no signal.
    await repo.setScore(slot, 3, null, '')
    setOnline(true)
    await act(() => hook.result.current.w.flush())
    const c = hook.result.current.w.cells[cellKey(slot)]
    expect(c?.kind).toBe('conflict')
    expect(outbox.list('ev-classic')).toEqual([])
  })
})
