import { useCallback, useEffect, useRef, useState } from 'react'
import type { Access } from '../data/repo'
import { errorMessage } from '../data/errors'
import type { EventBundle } from '../domain/types'
import { useApp } from './context'

/** Load an event and keep it fresh (realtime in live mode, local events in demo). */
export function useBundle(eventId: string | undefined) {
  const { repo } = useApp()
  const [bundle, setBundle] = useState<EventBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<'scores' | 'all' | null>(null)

  const reload = useCallback(async () => {
    if (!eventId) return
    try {
      setBundle(await repo.loadBundle(eventId))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [repo, eventId])

  useEffect(() => {
    setBundle(null)
    void reload()
  }, [reload])

  const roundId = bundle?.round.id
  useEffect(() => {
    if (!eventId || !roundId) return
    const flush = async () => {
      const what = pending.current
      pending.current = null
      if (what === 'scores') {
        try {
          const scores = await repo.listScores(roundId)
          setBundle((b) => (b ? { ...b, scores } : b))
        } catch {
          void reload()
        }
      } else if (what === 'all') void reload()
    }
    const unsub = repo.subscribe(eventId, roundId, (what) => {
      pending.current = pending.current === 'all' || what === 'all' ? 'all' : 'scores'
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 250)
    })
    setConnected(true)
    return () => {
      unsub()
      setConnected(false)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [repo, eventId, roundId, reload])

  return { bundle, setBundle, error, reload, connected }
}

export function useAccess(eventId: string | undefined) {
  const { repo, user } = useApp()
  const [access, setAccess] = useState<Access | null>(null)
  useEffect(() => {
    if (!eventId) return
    let live = true
    repo
      .access(eventId)
      .then((a) => live && setAccess(a))
      .catch(() => live && setAccess({ isOrganizer: false, role: null, groupIds: [] }))
    return () => {
      live = false
    }
  }, [repo, eventId, user])
  return access
}

/** Run an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError(errorMessage(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, setError, run }
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} | Flagstick` : 'Flagstick'
  }, [title])
}
