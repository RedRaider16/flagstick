import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApp, usePath } from '../../app/context'
import { useAction } from '../../app/hooks'
import { FormatEditor } from '../../components/FormatEditor'
import { ScoringFields, TeeSheetFields, type Scoring } from '../../components/SetupFields'
import { ErrorNote, Notice, useReasonDialog } from '../../components/ui'
import { nextYearSameWeekday, roundScores } from '../../domain/derive'
import { TEAM_SIZE_LABEL, TIEBREAK_LABEL, type Round, type StartType, type Tee, type TiebreakPolicy } from '../../domain/types'
import { defaultSegments, describeFormat, segmentsProblem, type Segment } from '../../scoring/formats'
import { TIMEZONES } from '../../domain/setup'
import { useManage } from './ManageLayout'

type TeeOption = Tee & { holeCount: number }

export function Setup() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const p = usePath()
  const { event } = bundle
  const ev = useAction()
  const rounds = useAction()
  const dialog = useReasonDialog()
  const [saved, setSaved] = useState(false)
  const [tees, setTees] = useState<TeeOption[]>([])
  const [form, setForm] = useState({
    name: event.name, timezone: event.timezone, description: event.description,
    tiebreakPolicy: event.tiebreakPolicy, teamSize: event.teamSize, cumulative: event.cumulative,
  })
  const final = event.status === 'finalized'
  const hasScores = bundle.scores.length > 0

  useEffect(() => {
    repo.courseDetail(event.courseId).then((d) => setTees(d.tees.map((t) => ({ ...t, holeCount: d.holes.filter((h) => h.teeId === t.id).length }))), () => setTees([]))
  }, [repo, event.courseId])

  return (
    <>
      {dialog.element}
      {event.isTemplate && (
        <Notice kind="info">
          This is the template for an annual event. It holds the setup only — rounds, formats, flights, fees — and is never published.
          Use <a href="#copy">Create this year's event</a> below to start a new edition, then register players there.
        </Notice>
      )}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="panel" onSubmit={(e) => {
          e.preventDefault()
          void ev.run(async () => {
            await repo.updateEvent(event.id, form)
            await reload()
            setSaved(true)
          })
        }}>
          <h2>Event details</h2>
          <ErrorNote error={ev.error} />
          <div className="field">
            <label htmlFor="s-name">Event name</label>
            <input id="s-name" type="text" required maxLength={120} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setSaved(false) }} />
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
          <fieldset disabled={hasScores || final}>
            <legend>Players or teams</legend>
            <div className="row">
              {[1, 2, 3, 4].map((n) => (
                <label key={n} className="choice" style={{ marginRight: '1rem' }}>
                  <input type="radio" name="size" checked={form.teamSize === n} onChange={() => setForm({ ...form, teamSize: n })} />
                  <span>{TEAM_SIZE_LABEL[n]}</span>
                </label>
              ))}
            </div>
            {hasScores ? <span className="hint">Fixed once scores are entered.</span>
              : form.teamSize !== event.teamSize && <Notice kind="warn">Saving resets every round to a {form.teamSize === 1 ? 'stroke play' : 'scramble'} format; adjust the rounds afterwards.</Notice>}
          </fieldset>
          {bundle.rounds.length > 1 && (
            <fieldset disabled={final}>
              <legend>Leaderboard across rounds</legend>
              <label className="choice">
                <input type="radio" name="cum" checked={form.cumulative} onChange={() => setForm({ ...form, cumulative: true })} />
                <span>One overall total<span className="hint">Rounds add up, e.g. a 36-hole championship.</span></span>
              </label>
              <label className="choice">
                <input type="radio" name="cum" checked={!form.cumulative} onChange={() => setForm({ ...form, cumulative: false })} />
                <span>Each round stands alone<span className="hint">Separate results per day, e.g. Saturday and Sunday competitions.</span></span>
              </label>
            </fieldset>
          )}
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
            {saved && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
          </div>
        </form>

        <section className="panel">
          <h2>Course</h2>
          <p><strong>{bundle.course?.name}</strong> <Link to={p(`courses/${event.courseId}`)}>Edit holes and tees</Link></p>
          <p className="small muted">Each round picks its tee below. In individual events, players on a different tee (seniors, ladies) are set on the Players page.</p>
        </section>
      </div>

      <section className="panel">
        <div className="split">
          <h2>Rounds</h2>
          <button className="btn" type="button" disabled={rounds.busy || final || bundle.rounds.length >= 6}
            onClick={() => void rounds.run(async () => { await repo.addRound(event.id); await reload() })}>
            Add a round
          </button>
        </div>
        <ErrorNote error={rounds.error} />
        {bundle.rounds.map((r) => (
          <RoundEditor key={`${r.id}-${event.teamSize}`} round={r} teamSize={event.teamSize} tees={tees} disabled={final || r.status === 'finalized'}
            hasScores={roundScores(bundle, r.id).length > 0} canDelete={bundle.rounds.length > 1}
            onSave={async (patch) => {
              await repo.updateRound(r.id, patch)
              if (r.roundNumber === 1 && patch.date && patch.date !== event.date) await repo.updateEvent(event.id, { date: patch.date })
              await reload()
            }}
            onDelete={async () => {
              const ok = await dialog.ask({ title: `Remove round ${r.roundNumber}?`, body: <p>Its groups are removed too. Rounds with scores can't be removed.</p>, confirmLabel: 'Remove round', danger: true })
              if (ok !== null) await rounds.run(async () => { await repo.deleteRound(r.id); await reload() })
            }} />
        ))}
      </section>

      <ScoringPanel />

      <CopyEvent />
    </>
  )
}

function RoundEditor(props: {
  round: Round
  teamSize: number
  tees: TeeOption[]
  disabled: boolean
  hasScores: boolean
  canDelete: boolean
  onSave: (patch: { date: string; teeId: string | null; segments: Segment[]; startType: StartType; useFlights: boolean; startTime: string | null; startingHole: number; groupSize: number; teeIntervalMinutes: number; groupsPerTime: number }) => Promise<void>
  onDelete: () => void
}) {
  const { round: r, teamSize } = props
  const { busy, error, run } = useAction()
  const initial = () => ({
    date: r.date, teeId: r.teeId, startType: r.startType, useFlights: r.useFlights,
    startTime: r.startTime, startingHole: r.startingHole, groupSize: r.groupSize, teeIntervalMinutes: r.teeIntervalMinutes, groupsPerTime: r.groupsPerTime ?? 1,
    segments: segmentsProblem(r.segments, teamSize) ? defaultSegments(teamSize) : r.segments,
  })
  const [f, setF] = useState(initial)
  const [saved, setSaved] = useState(false)
  const set = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setSaved(false) }
  const dirty = JSON.stringify(f) !== JSON.stringify(initial())
  const id = `r${r.roundNumber}`

  return (
    <form className="round-card" onSubmit={(e) => {
      e.preventDefault()
      void run(async () => { await props.onSave(f); setSaved(true) })
    }}>
      <div className="split">
        <h3 style={{ margin: 0 }}>Round {r.roundNumber}</h3>
        <span className="small muted">{describeFormat(f.segments, teamSize)}</span>
      </div>
      <ErrorNote error={error} />
      <fieldset disabled={props.disabled} className="grid-3">
        <div className="field">
          <label htmlFor={`${id}-date`}>Date</label>
          <input id={`${id}-date`} type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-tee`}>Tee</label>
          <select id={`${id}-tee`} value={f.teeId ?? ''} onChange={(e) => set({ teeId: e.target.value || null })}>
            <option value="">Not chosen</option>
            {props.tees.map((t) => <option key={t.id} value={t.id}>{t.name}{t.holeCount !== 18 ? ` (${t.holeCount}/18 holes set up)` : ''}</option>)}
          </select>
          {props.hasScores && <span className="hint">Par comes from this tee; changing it changes scores to par.</span>}
        </div>
      </fieldset>
      <TeeSheetFields id={`${id}-ts`} teamSize={teamSize} disabled={props.disabled} value={f} onChange={(v) => set(v)} />
      <fieldset disabled={props.disabled || props.hasScores}>
        <legend>Format</legend>
        <FormatEditor id={id} teamSize={teamSize} value={f.segments} onChange={(segments) => set({ segments })} />
        {props.hasScores && <span className="hint">The format is fixed once this round has scores.</span>}
      </fieldset>
      <label className="choice">
        <input type="checkbox" checked={f.useFlights} disabled={props.disabled} onChange={(e) => set({ useFlights: e.target.checked })} />
        <span>Rank this round by flight<span className="hint">Positions are ranked within each flight. Set up flights on the Flights tab.</span></span>
      </label>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy || props.disabled || !dirty || !!segmentsProblem(f.segments, teamSize)}>Save round {r.roundNumber}</button>
        {saved && !dirty && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
        <span className="spacer" />
        {props.canDelete && <button className="btn quiet small" type="button" disabled={busy || props.disabled || props.hasScores} onClick={props.onDelete}>Remove round</button>}
      </div>
    </form>
  )
}

/** Start next year's edition (or save a reusable template) from this event's setup. */
function CopyEvent() {
  const { bundle } = useManage()
  const { repo } = useApp()
  const p = usePath()
  const nav = useNavigate()
  const { event } = bundle
  const { busy, error, run } = useAction()
  const today = new Date().toISOString().slice(0, 10)
  let nextDate = nextYearSameWeekday(event.date)
  while (nextDate < today) nextDate = nextYearSameWeekday(nextDate)
  const year = (d: string) => d.slice(0, 4)
  const suggestName = (d: string) => {
    const base = event.name.replace(/\(template\)/gi, '').replace(/\btemplate\b/gi, '').replace(/\b(19|20)\d{2}\b/g, '').replace(/\s{2,}/g, ' ').trim()
    return event.name.match(/^(19|20)\d{2}\b/) ? `${year(d)} ${base}` : `${base} ${year(d)}`
  }
  const [date, setDate] = useState(nextDate)
  const [name, setName] = useState(suggestName(nextDate))
  const [touched, setTouched] = useState(false)
  const [asTemplate, setAsTemplate] = useState(false)

  return (
    <form id="copy" className="panel" onSubmit={(e) => {
      e.preventDefault()
      void run(async () => {
        const id = await repo.duplicateEvent(event.id, name.trim(), date, asTemplate)
        nav(p(`manage/${id}/setup`))
      })
    }}>
      <h2>{event.isTemplate ? "Create this year's event" : 'Copy this event'}</h2>
      <p className="small">
        Copies the setup: course, rounds and dates (moved to the new date), formats, flights, tie-break, entry fee and registration settings, and the admins.
        Players, teams, groups and scores are not copied — the new event starts as a draft with registration closed, so you can review it and then open sign-ups.
      </p>
      <ErrorNote error={error} />
      <div className="grid-2" style={{ gap: '0 1rem' }}>
        <div className="field">
          <label htmlFor="c-date">First day</label>
          <input id="c-date" type="date" required value={date} onChange={(e) => { setDate(e.target.value); if (!touched) setName(suggestName(e.target.value)) }} />
          {bundle.rounds.length > 1 && <span className="hint">All {bundle.rounds.length} rounds move together, keeping the same days apart.</span>}
        </div>
        <div className="field">
          <label htmlFor="c-name">Name</label>
          <input id="c-name" type="text" required maxLength={120} value={name} onChange={(e) => { setName(e.target.value); setTouched(true) }} />
        </div>
      </div>
      {!event.isTemplate && (
        <label className="choice">
          <input type="checkbox" checked={asTemplate} onChange={(e) => setAsTemplate(e.target.checked)} />
          <span>Save as a template instead<span className="hint">A template is never published; it's the master copy you start each year from.</span></span>
        </label>
      )}
      <button className="btn primary" type="submit" disabled={busy || !name.trim() || !date}>{busy ? 'Copying…' : asTemplate ? 'Save template' : 'Create event'}</button>
    </form>
  )
}

function ScoringPanel() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const { event } = bundle
  const { busy, error, run } = useAction()
  const initial: Scoring = { scoringBasis: event.scoringBasis, netAllowances: event.netAllowances, maxHandicapIndex: event.maxHandicapIndex, hidePurse: event.hidePurse }
  const [v, setV] = useState(initial)
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  const unrated = bundle.tees.filter((t) => bundle.rounds.some((r) => r.teeId === t.id) && (t.rating === null || t.slope === null))
  return (
    <section className="panel">
      <h2>Scoring</h2>
      <ErrorNote error={error} />
      <ScoringFields value={v} onChange={(x) => { setV(x); setSaved(false) }} teamSize={event.teamSize} methods={[...new Set(bundle.rounds.flatMap((r) => r.segments.map((s) => s.method)))]} disabled={event.status === 'finalized'} />
      {v.scoringBasis !== 'gross' && unrated.length > 0 && (
        <Notice kind="warn">Net scoring needs a course rating and slope for the {unrated.map((t) => t.name).join(' and ')} tee{unrated.length === 1 ? '' : 's'}. Add them under Courses.</Notice>
      )}
      <div className="row">
        <button className="btn primary" type="button" disabled={busy || !dirty} onClick={() => void run(async () => { await repo.updateEvent(event.id, v); await reload(); setSaved(true) })}>Save scoring</button>
        {saved && !dirty && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
      </div>
    </section>
  )
}
