import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { FlagMark } from '../components/ui'
import type { DemoRepo, DemoRole } from '../data/demoRepo'
import { getDemoRepo, getLiveRepo, RepoProvider, useApp, usePath } from './context'

export function Shell({ mode }: { mode: 'demo' | 'live' }) {
  if (mode === 'demo') {
    return (
      <RepoProvider repo={getDemoRepo()} base="/demo">
        <Frame />
      </RepoProvider>
    )
  }
  const live = getLiveRepo()
  if (!live) return <NotConfigured />
  return (
    <RepoProvider repo={live} base="">
      <Frame />
    </RepoProvider>
  )
}

function Frame() {
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <ModeBanner />
      <AppBar />
      <main id="main">
        <Outlet />
      </main>
    </>
  )
}

function ModeBanner() {
  const { repo } = useApp()
  if (repo.mode === 'live') {
    return (
      <div className="mode-banner live no-print" role="note">
        <strong>Live tournament data</strong>
        <span>Shared with everyone who has access.</span>
        <span className="spacer" />
        <Link to="/demo" style={{ color: '#fff' }}>Try the demo</Link>
      </div>
    )
  }
  return <DemoBanner repo={repo as DemoRepo} />
}

function DemoBanner({ repo }: { repo: DemoRepo }) {
  const [role, setRole] = useState<DemoRole>(repo.role)
  const nav = useNavigate()
  useEffect(() => repo.onAuthChange(() => setRole(repo.role)), [repo])
  return (
    <div className="mode-banner demo no-print" role="note">
      <span><strong>Demo:</strong> fictional data, saved only in this browser. Nothing is shared or live.</span>
      <span className="spacer" />
      <label className="row" style={{ margin: 0, fontWeight: 400, gap: '.4rem', flexWrap: 'nowrap' }}>
        View as
        <select value={role} onChange={(e) => repo.setRole(e.target.value as DemoRole)} style={{ width: 'auto', minHeight: 32, padding: '.15rem .4rem' }}>
          <option value="admin">Administrator</option>
          <option value="scorekeeper">Scorekeeper (first group)</option>
          <option value="spectator">Spectator</option>
        </select>
      </label>
      <button
        type="button"
        className="btn small"
        style={{ minHeight: 32 }}
        onClick={() => {
          if (window.confirm('Reset the demo? Your changes to the demo data will be discarded.')) {
            repo.reset()
            nav('/demo')
          }
        }}
      >
        Reset
      </button>
      {getLiveRepo() && <Link to="/">Go to live site</Link>}
    </div>
  )
}

function AppBar() {
  const { user, isOrganizer, repo, authReady } = useApp()
  const p = usePath()
  const nav = useNavigate()
  return (
    <header className="appbar no-print">
      <div className="appbar-inner">
        <Link to={p('/')} className="brand">
          <FlagMark /> Flagstick
        </Link>
        <nav aria-label="Main">
          <NavLink to={p('/')} end>Events</NavLink>
          {isOrganizer && <NavLink to={p('courses')}>Courses</NavLink>}
          {isOrganizer && <NavLink to={p('new')}>New event</NavLink>}
          {repo.mode === 'live' && authReady && !user && <NavLink to={p('signin')}>Sign in</NavLink>}
          {repo.mode === 'live' && user && (
            <button
              type="button"
              onClick={async () => {
                await repo.signOut()
                nav(p('/'))
              }}
              title={user.email}
            >
              Sign out
            </button>
          )}
        </nav>
      </div>
    </header>
  )
}

function NotConfigured() {
  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <span className="brand"><FlagMark /> Flagstick</span>
        </div>
      </header>
      <main id="main">
        <div className="hero">
          <h1>Connected mode isn't set up on this site yet</h1>
          <p>
            This build has no Supabase project configured, so there is no shared, live data. You can still try every
            screen with fictional data in the demo.
          </p>
          <p>
            <Link className="btn primary" to="/demo">Open the demo</Link>
          </p>
          <p className="muted small">
            Site owner: set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> as repository
            variables and redeploy. See the README.
          </p>
        </div>
      </main>
    </>
  )
}

export function NotFound() {
  const p = usePath()
  return (
    <div>
      <h1>Page not found</h1>
      <p>That page doesn't exist. Check the link, or go back to the events list.</p>
      <Link className="btn" to={p('/')}>Go to events</Link>
    </div>
  )
}
