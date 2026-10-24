import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApp, usePath } from '../app/context'
import { useAction, useTitle } from '../app/hooks'
import { FormatEditor } from '../components/FormatEditor'
import { ErrorNote, Notice } from '../components/ui'
import type { NewEventInput } from '../data/repo'
import { TEAM_SIZE_LABEL, TIEBREAK_LABEL, type Course, type StartType, type Tee, type TiebreakPolicy } from '../domain/types'
import { defaultSegments, segmentsProblem } from '../scoring/formats'

export const TIMEZONES = ['America/Chicago', 'America/Denver', 'America/New_York', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu']

export function NewEvent() {
  useTitle('New event')
  const { repo, isOrganizer } = useApp()
  const p = usePath()
  const nav = useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [tees, setTees] = useState<(Tee & { holeCount: number })[]>([])
  const { busy, error, run } = useAction()
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [f, setF] = useState<NewEventInput>({
    name: '', courseId: '', teeId: null, date: new Date().toISOString().slice(0, 10),
    timezone: TIMEZONES.includes(browserTz) ? browserTz : 'America/Chicago', description: '',
    teamSize: 1, segments: defaultSegments(1), startType: 'tee_times', tiebreak: 'share',
  })
  const set = (patch: Partial<NewEventInput>) => setF((x) => ({ ...x, ...patch }))

  useEffect(() => {
    repo.listCourses().then((cs) => {
      setCourses(cs)
      if (cs[0]) setF((x) => (x.courseId ? x : { ...x, courseId: cs[0]!.id }))
    })
  }, [repo])

  useEffect(() => {
    if (!f.courseId) return
    repo.courseDetail(f.courseId).then((d) => {
      const ts = d.tees.map((t) => ({ ...t, holeCount: d.holes.filter((h) => h.teeId === t.id).length }))
      setTees(ts)
      setF((x) => ({ ...x, teeId: ts.find((t) => t.holeCount === 18)?.id ?? ts[0]?.id ?? null }))
    })
  }, [repo, f.courseId])

  if (!isOrganizer)
    return <Notice kind="warn">Only organizers can create events. In live mode, the site owner adds organizers in Supabase (see README).</Notice>

  if (courses.length === 0)
    return (
      <>
        <h1>New event</h1>
        <Notice kind="info">Add a course first — events need a course and tee.</Notice>
        <Link className="btn primary" to={p('courses')}>Add a course</Link>
      </>
    )

  return (
    <form style={{ maxWidth: 720 }} onSubmit={(e) => {
      e.preventDefault()
      void run(async () => {
        const id = await repo.createEvent(f)
        nav(p(`manage/${id}`))
      })
    }}>
      <h1>New event</h1>
      <ErrorNote error={error} />
      <section className="panel">
        <div className="field">
          <label htmlFor="ev-name">Event name</label>
          <input id="ev-name" type="text" required maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="ev-course">Course</label>
            <select id="ev-course" value={f.courseId} onChange={(e) => set({ courseId: e.target.value })}>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ev-tee">Tee</label>
            <select id="ev-tee" value={f.teeId ?? ''} onChange={(e) => set({ teeId: e.target.value || null })}>
              <option value="">Choose later</option>
              {tees.map((t) => <option key={t.id} value={t.id}>{t.name}{t.holeCount !== 18 ? ' (holes not set up)' : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ev-date">Date</label>
            <input id="ev-date" type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ev-tz">Time zone</label>
            <select id="ev-tz" value={f.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {TIMEZONES.map((t) => <option key={t} value={t}>{t.replace('America/', '').replace('_', ' ')}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ev-desc">Description <span className="hint" style={{ display: 'inline' }}>(shown to spectators)</span></label>
          <textarea id="ev-desc" maxLength={2000} value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
      </section>

      <section className="panel">
        <fieldset>
          <legend>Players or teams</legend>
          <div className="row">
            {[1, 2, 3, 4].map((n) => (
              <label key={n} className="choice" style={{ marginRight: '1rem' }}>
                <input type="radio" name="size" checked={f.teamSize === n} onChange={() => set({ teamSize: n, segments: defaultSegments(n) })} />
                <span>{TEAM_SIZE_LABEL[n]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Format{' '}<span className="hint" style={{ display: 'inline' }}>(round 1; add more rounds and flights after creating)</span></legend>
          <FormatEditor id="new" teamSize={f.teamSize} value={f.segments} onChange={(segments) => set({ segments })} />
        </fieldset>
        <fieldset>
          <legend>Start</legend>
          {(['tee_times', 'shotgun'] as StartType[]).map((k) => (
            <label key={k} className="choice">
              <input type="radio" name="start" checked={f.startType === k} onChange={() => set({ startType: k })} />
              <span>{k === 'tee_times' ? 'Tee times' : 'Shotgun start'}<span className="hint">{k === 'shotgun' ? 'Groups start on different holes at the same time.' : 'Groups go off in order at set times.'}</span></span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>How ties are handled</legend>
          {(Object.keys(TIEBREAK_LABEL) as TiebreakPolicy[]).map((k) => (
            <label key={k} className="choice">
              <input type="radio" name="tiebreak" checked={f.tiebreak === k} onChange={() => set({ tiebreak: k })} />
              <span>{TIEBREAK_LABEL[k]}<span className="hint">{k === 'share' ? 'Tied players share the position. Decide winners another way (playoff, split).' : 'Only applies when every tied player has a complete card. Anything still tied stays tied.'}</span></span>
            </label>
          ))}
        </fieldset>
      </section>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy || !f.name.trim() || !f.courseId || !!segmentsProblem(f.segments, f.teamSize)}>{busy ? 'Creating…' : 'Create event'}</button>
        <span className="muted small">Starts as a draft that only staff can see.</span>
      </div>
    </form>
  )
}
