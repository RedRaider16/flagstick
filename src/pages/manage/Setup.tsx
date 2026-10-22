import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useApp, usePath } from '../../app/context'
import { useAction } from '../../app/hooks'
import { ErrorNote, Notice } from '../../components/ui'
import { FORMAT_LABEL, TIEBREAK_LABEL, type Format, type StartType, type Tee, type TiebreakPolicy } from '../../domain/types'
import { TIMEZONES } from '../NewEvent'
import { useManage } from './ManageLayout'

export function Setup() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const p = usePath()
  const { event, round } = bundle
  const ev = useAction()
  const rd = useAction()
  const [saved, setSaved] = useState<string | null>(null)
  const [tees, setTees] = useState<(Tee & { holeCount: number })[]>([])
  const [form, setForm] = useState({ name: event.name, date: event.date, timezone: event.timezone, description: event.description, tiebreakPolicy: event.tiebreakPolicy })
  const [rForm, setRForm] = useState({ teeId: round.teeId, format: round.format, startType: round.startType })
  const final = event.status === 'finalized'
  const hasScores = bundle.scores.length > 0

  useEffect(() => {
    repo.courseDetail(event.courseId).then((d) => setTees(d.tees.map((t) => ({ ...t, holeCount: d.holes.filter((h) => h.teeId === t.id).length }))), () => setTees([]))
  }, [repo, event.courseId])

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <form className="panel" onSubmit={(e) => {
        e.preventDefault()
        void ev.run(async () => {
          await repo.updateEvent(event.id, form)
          await reload()
          setSaved('event')
        })
      }}>
        <h2>Event details</h2>
        <ErrorNote error={ev.error} />
        <div className="field">
          <label htmlFor="s-name">Event name</label>
          <input id="s-name" type="text" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-date">Date</label>
          <input id="s-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-tz">Time zone</label>
          <select id="s-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {[...new Set([form.timezone, ...TIMEZONES])].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-desc">Description</label>
          <textarea id="s-desc" maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <fieldset disabled={final}>
          <legend>How ties are handled</legend>
          {(Object.keys(TIEBREAK_LABEL) as TiebreakPolicy[]).map((k) => (
            <label key={k} className="choice">
              <input type="radio" name="tb" checked={form.tiebreakPolicy === k} onChange={() => setForm({ ...form, tiebreakPolicy: k })} />
              <span>{TIEBREAK_LABEL[k]}</span>
            </label>
          ))}
          {event.status === 'in_progress' && <span className="hint">Changing this during play re-orders tied players on the leaderboard immediately.</span>}
        </fieldset>
        <div className="row">
          <button className="btn primary" type="submit" disabled={ev.busy}>Save details</button>
          {saved === 'event' && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
        </div>
      </form>

      <form className="panel" onSubmit={(e) => {
        e.preventDefault()
        void rd.run(async () => {
          await repo.updateRound(round.id, rForm)
          await reload()
          setSaved('round')
        })
      }}>
        <h2>Course, format and start</h2>
        <ErrorNote error={rd.error} />
        <p>Course: <strong>{bundle.course?.name}</strong> <Link to={p(`courses/${event.courseId}`)}>Edit holes</Link></p>
        <div className="field">
          <label htmlFor="s-tee">Tee</label>
          <select id="s-tee" value={rForm.teeId ?? ''} disabled={final} onChange={(e) => setRForm({ ...rForm, teeId: e.target.value || null })}>
            <option value="">Not chosen</option>
            {tees.map((t) => <option key={t.id} value={t.id}>{t.name}{t.holeCount !== 18 ? ` (${t.holeCount}/18 holes set up)` : ''}</option>)}
          </select>
          {hasScores && <span className="hint">Par comes from this tee. Changing it now changes everyone's score to par.</span>}
        </div>
        <fieldset disabled={hasScores || final}>
          <legend>Format</legend>
          {(Object.keys(FORMAT_LABEL) as Format[]).map((k) => (
            <label key={k} className="choice">
              <input type="radio" name="fmt" checked={rForm.format === k} onChange={() => setRForm({ ...rForm, format: k })} />
              <span>{FORMAT_LABEL[k]}</span>
            </label>
          ))}
          {hasScores ? (
            <span className="hint">The format is fixed once scores are entered.</span>
          ) : rForm.format !== round.format ? (
            <Notice kind="warn">Switching format rebuilds the leaderboard entries and clears group assignments. Players and teams are kept.</Notice>
          ) : null}
        </fieldset>
        <fieldset disabled={final}>
          <legend>Start</legend>
          {(['tee_times', 'shotgun'] as StartType[]).map((k) => (
            <label key={k} className="choice">
              <input type="radio" name="st" checked={rForm.startType === k} onChange={() => setRForm({ ...rForm, startType: k })} />
              <span>{k === 'tee_times' ? 'Tee times' : 'Shotgun start'}</span>
            </label>
          ))}
        </fieldset>
        <div className="row">
          <button className="btn primary" type="submit" disabled={rd.busy || final}>Save course and format</button>
          {saved === 'round' && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
        </div>
      </form>
    </div>
  )
}
