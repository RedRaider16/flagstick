import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { DemoRepo } from '../data/demoRepo'
import type { Repo, SessionUser } from '../data/repo'
import { liveConfigured, SupabaseRepo } from '../data/supabaseRepo'

let demoSingleton: DemoRepo | null = null
let liveSingleton: SupabaseRepo | null = null
export const getDemoRepo = () => (demoSingleton ??= new DemoRepo())
export const getLiveRepo = () => (liveConfigured ? (liveSingleton ??= new SupabaseRepo()) : null)

interface Ctx {
  repo: Repo
  /** Route prefix: '' for live, '/demo' for demo. */
  base: string
  user: SessionUser | null
  isOrganizer: boolean
  authReady: boolean
  refreshAuth: () => void
}

const RepoCtx = createContext<Ctx | null>(null)

export function RepoProvider({ repo, base, children }: { repo: Repo; base: string; children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [isOrganizer, setIsOrganizer] = useState(false)
  const [authReady, setAuthReady] = useState(false)

  const refreshAuth = useCallback(() => {
    void (async () => {
      try {
        const u = await repo.currentUser()
        setUser(u)
        setIsOrganizer(u ? await repo.isOrganizer() : false)
      } catch {
        setUser(null)
        setIsOrganizer(false)
      } finally {
        setAuthReady(true)
      }
    })()
  }, [repo])

  useEffect(() => {
    refreshAuth()
    return repo.onAuthChange(refreshAuth)
  }, [repo, refreshAuth])

  return <RepoCtx.Provider value={{ repo, base, user, isOrganizer, authReady, refreshAuth }}>{children}</RepoCtx.Provider>
}

export function useApp(): Ctx {
  const c = useContext(RepoCtx)
  if (!c) throw new Error('useApp outside RepoProvider')
  return c
}

/** Build an in-app path under the current mode ('/demo/...' or '/...'). */
export function usePath() {
  const { base } = useApp()
  return (p: string) => `${base}/${p.replace(/^\//, '')}`.replace(/\/$/, '') || '/'
}
