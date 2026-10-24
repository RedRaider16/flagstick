// Step-by-step event setup, modelled on how the annual events were built in
// Golf Genius: start point → event & days → format → flights → tee sheet →
// registration → scoring & prizes → review. Everything is created in one call.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useApp, usePath } from '../app/context'
import { useAction, useTitle } from '../app/hooks'
import { FormatEditor } from '../components/FormatEditor'
import { QuestionsEditor } from '../components/QuestionsEditor'
import { ScoringFields, TeeSheetFields } from '../components/SetupFields'
import { ErrorNote, Loading, Notice } from '../components/ui'
import type { EventSetup, RoundSetup } from '../data/repo'
import { eventFormatText, formatDate, nextYearSameWeekday } from '../domain/derive'
import { centsToDollars, dollarsToCents, isoToZonedInput, zonedInputToIso } from '../domain/inputs'
import {
  allProblems, blankSetup, draftPayoutSlots, FLIGHT_PRESETS, nameForYear, setupFromBundle, STEPS, stepProblems, TIMEZONES,
  withRoundCount, withTeamSize, type StepKey,
} from '../domain/setup'
import { formatMoney, SCORING_BASIS_LABEL, SIDE_GAME_LABEL, TEAM_SIZE_LABEL, TIEBREAK_LABEL, type Course, type GolfEvent, type Hole, type SideGameKind, type Tee, type TiebreakPolicy } from '../domain/types'
import { describeFormat } from '../scoring/formats'
import { formatAmounts, parseAmounts } from './manage/Payouts'

export { TIMEZONES }

const DRAFT_KEY = 'flagstick-new-event-draft'
type Draft = { step: StepKey; setup: EventSetup; source: string | null }

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}
function saveDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* storage unavailable: the draft just isn't kept */
  }
}

export function NewEvent() {
  useTitle('New event')
  const { repo, isOrganizer } = useApp()
  const p = usePath()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = new Date().toISOString().slice(0, 10)
  const fresh = (): Draft => ({ step: 'start', setup: blankSetup(today, TIMEZONES.includes(browserTz) ? browserTz : 'America/Chicago'), source: null })
  const [draft, setDraft] = useState<Draft>(() => (params.get('from') ? fresh() : loadDraft() ?? fresh()))
  const { step, setup: s } = draft
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [tees, setTees] = useState<Tee[]>([])
  const [holes, setHoles] = useState<Hole[]>([])
  const [showErrors, setShowErrors] = useState(false)
  const create = useAction()

  useEffect(() => saveDraft(draft), [draft])
  useEffect(() => {
    repo.listCourses().then(setCourses, () => setCourses([]))
  }, [repo])
  useEffect(() => {
    if (!s.courseId) return setTees([])
    repo.courseDetail(s.courseId).then((d) => { setTees(d.tees); setHoles(d.holes) }, () => { setTees([]); setHoles([]) })
  }, [repo, s.courseId])

  const counts = useMemo(() => Object.fromEntries(tees.map((t) => [t.id, holes.filter((h) => h.teeId === t.id).length])), [tees, holes])
  const set = (patch: Partial<EventSetup>) => setDraft((d) => ({ ...d, setup: { ...d.setup, ...patch } }))
  const setRound = (i: number, patch: Partial<RoundSetup>) => set({ rounds: s.rounds.map((r, k) => (k === i ? { ...r, ...patch } : r)) })
  const go = (k: StepKey) => { setShowErrors(false); setDraft((d) => ({ ...d, step: k })); window.scrollTo({ top: 0 }) }
  const idx = STEPS.findIndex((x) => x.key === step)
  const problems = stepProblems(s, step, counts)
  const blocking = problems.filter((x) => !/holes set up/.test(x))

  if (!isOrganizer) return <Notice kind="warn">Only organizers can create events. Sign in with an organizer account.</Notice>
  if (!courses) return <Loading />
  if (courses.length === 0)
    return (
      <>
        <h1>New event</h1>
        <Notice kind="info">Add a course first — events are played on one of your courses.</Notice>
        <Link className="btn primary" to={p('courses')}>Add a course</Link>
      </>
    )

  const next = () => {
    if (blocking.length) return setShowErrors(true)
    go(STEPS[idx + 1]!.key)
  }

  const submit = (asTemplate: boolean) =>
    create.run(async () => {
      const id = await repo.createEventSetup({ ...s, isTemplate: asTemplate })
      saveDraft(null)
      nav(p(`manage/${id}`))
    })

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="split">
        <h1>New event</h1>
        {step !== 'start' && (
          <button className="btn quiet small" type="button" onClick={() => { if (window.confirm('Start over? This clears what you have entered.')) setDraft(fresh()) }}>Start over</button>
        )}
      </div>
      <ol className="stepper" aria-label="Setup steps">
        {STEPS.map((x, i) => (
          <li key={x.key} className={`${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}`}>
            <button type="button" disabled={i > idx || (i === 0 && step !== 'start')} aria-current={i === idx ? 'step' : undefined} onClick={() => go(x.key)}>
              <span className="n" aria-hidden="true">{i < idx ? '✓' : i + 1}</span> {x.label}
            </button>
          </li>
        ))}
      </ol>

      <section className="panel">
        {step === 'start' && <StartStep onPick={(setup, source) => setDraft({ step: 'basics', setup, source })} blank={fresh().setup} />}
        {step === 'basics' && (
          <>
            <h2>Event &amp; days</h2>
            {draft.source && <Notice kind="info">Copied from <strong>{draft.source}</strong>. Dates have moved to the new first day; check them below. Players aren't copied.</Notice>}
            <div className="field">
              <label htmlFor="w-name">Event name</label>
              <input id="w-name" type="text" maxLength={120} value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. 2027 Jimmy Roger Showdown" />
            </div>
            <div className="grid-2" style={{ gap: '0 1rem' }}>
              <div className="field">
                <label htmlFor="w-course">Course</label>
                <select id="w-course" value={s.courseId} onChange={(e) => set({ courseId: e.target.value, rounds: s.rounds.map((r) => ({ ...r, teeId: null })) })}>
                  <option value="">Choose a course</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span className="hint"><Link to={p('courses')}>Add or edit courses</Link></span>
              </div>
              <div className="field">
                <label htmlFor="w-tz">Time zone</label>
                <select id="w-tz" value={s.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                  {[...new Set([s.timezone, ...TIMEZONES])].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="w-rounds">Number of rounds</label>
              <select id="w-rounds" value={s.rounds.length} onChange={(e) => set(withRoundCount(s, Number(e.target.value)))} style={{ maxWidth: 200 }}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'round' : 'rounds'}</option>)}
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Round</th><th scope="col">Date</th><th scope="col">Tee</th></tr></thead>
                <tbody>
                  {s.rounds.map((r, i) => (
                    <tr key={i}>
                      <th scope="row">Round {i + 1}</th>
                      <td><input aria-label={`Round ${i + 1} date`} type="date" value={r.date} onChange={(e) => setRound(i, { date: e.target.value })} /></td>
                      <td>
                        <select aria-label={`Round ${i + 1} tee`} value={r.teeId ?? ''} onChange={(e) => setRound(i, { teeId: e.target.value || null })} disabled={!s.courseId}>
                          <option value="">{s.courseId ? 'Choose later' : 'Choose a course first'}</option>
                          {tees.map((t) => <option key={t.id} value={t.id}>{t.name}{counts[t.id] !== 18 ? ` (${counts[t.id]}/18 holes)` : ''}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="field" style={{ marginTop: '.8rem' }}>
              <label htmlFor="w-desc">Description (optional)</label>
              <textarea id="w-desc" maxLength={2000} value={s.description} onChange={(e) => set({ description: e.target.value })} placeholder="Shown on the public event page." />
            </div>
          </>
        )}

        {step === 'format' && (
          <>
            <h2>Format</h2>
            <fieldset>
              <legend>Players or teams</legend>
              <div className="row">
                {[1, 2, 3, 4].map((n) => (
                  <label key={n} className="choice" style={{ marginRight: '1rem' }}>
                    <input type="radio" name="w-size" checked={s.teamSize === n} onChange={() => set(withTeamSize(s, n))} />
                    <span>{TEAM_SIZE_LABEL[n]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {s.rounds.map((r, i) => (
              <div key={i} className="round-card">
                <div className="split">
                  <h3 style={{ margin: 0 }}>Round {i + 1}{s.rounds.length > 1 && <span className="muted small"> · {formatDate(r.date)}</span>}</h3>
                  {i > 0 && <button className="btn quiet small" type="button" onClick={() => setRound(i, { segments: s.rounds[i - 1]!.segments })}>Same as round {i}</button>}
                </div>
                <FormatEditor id={`w-r${i}`} teamSize={s.teamSize} value={r.segments} onChange={(segments) => setRound(i, { segments })} />
              </div>
            ))}
            {s.rounds.length > 1 && (
              <fieldset>
                <legend>Results across rounds</legend>
                <label className="choice"><input type="radio" name="w-cum" checked={s.cumulative} onChange={() => set({ cumulative: true })} />
                  <span>One overall total<span className="hint">Rounds add up (Jimmy Roger, Best of the Rest, City Championship).</span></span></label>
                <label className="choice"><input type="radio" name="w-cum" checked={!s.cumulative} onChange={() => set({ cumulative: false })} />
                  <span>Each round stands alone<span className="hint">Separate results each day (United Way).</span></span></label>
              </fieldset>
            )}
            <fieldset>
              <legend>Ties</legend>
              {(Object.keys(TIEBREAK_LABEL) as TiebreakPolicy[]).map((k) => (
                <label key={k} className="choice"><input type="radio" name="w-tb" checked={s.tiebreak === k} onChange={() => set({ tiebreak: k })} /><span>{TIEBREAK_LABEL[k]}</span></label>
              ))}
            </fieldset>
          </>
        )}

        {step === 'flights' && (
          <>
            <h2>Flights</h2>
            <p className="small">Flights split the field into divisions, each ranked on its own. You assign players or teams to flights after they register (or fill flights from a round's results, as United Way does for Sunday). Skip this step for an unflighted event.</p>
            {s.flights.length === 0 ? <p className="muted">No flights.</p> : (
              <ol className="flight-list">
                {s.flights.map((f, i) => (
                  <li key={i} className="row">
                    <input aria-label={`Flight ${i + 1} name`} type="text" maxLength={40} value={f} onChange={(e) => set({ flights: s.flights.map((x, k) => (k === i ? e.target.value : x)) })} style={{ flex: 1 }} />
                    <button className="btn quiet small" type="button" aria-label={`Move ${f} up`} disabled={i === 0} onClick={() => { const n = [...s.flights]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; set({ flights: n }) }}>↑</button>
                    <button className="btn quiet small" type="button" aria-label={`Remove ${f}`} onClick={() => set({ flights: s.flights.filter((_, k) => k !== i), payouts: s.payouts.filter((x) => x.flightName !== f) })}>Remove</button>
                  </li>
                ))}
              </ol>
            )}
            <div className="row">
              <button className="btn small" type="button" onClick={() => set({ flights: [...s.flights, ''] })}>Add a flight</button>
              {FLIGHT_PRESETS.filter((f) => !s.flights.includes(f)).map((f) => (
                <button key={f} className="btn quiet small" type="button" onClick={() => set({ flights: [...s.flights, f] })}>+ {f}</button>
              ))}
            </div>
            {s.flights.length > 0 && (
              <fieldset style={{ marginTop: '1rem' }}>
                <legend>Rank by flight in</legend>
                {s.rounds.map((r, i) => (
                  <label key={i} className="choice"><input type="checkbox" checked={r.useFlights} onChange={(e) => setRound(i, { useFlights: e.target.checked })} />
                    <span>Round {i + 1}{i === 0 && !s.cumulative && s.rounds.length > 1 ? <span className="hint">Untick if flights are set from this round's results.</span> : null}</span></label>
                ))}
              </fieldset>
            )}
          </>
        )}

        {step === 'teesheet' && (
          <>
            <h2>Tee sheet</h2>
            <p className="small">How each round starts. Groups are made on the Groups tab once players are in; these are the defaults it uses.</p>
            {s.rounds.map((r, i) => (
              <div key={i} className="round-card">
                <div className="split">
                  <h3 style={{ margin: 0 }}>Round {i + 1}<span className="muted small"> · {formatDate(r.date)}</span></h3>
                  {i > 0 && <button className="btn quiet small" type="button" onClick={() => { const pr = s.rounds[i - 1]!; setRound(i, { startType: pr.startType, startTime: pr.startTime, startingHole: pr.startingHole, groupSize: pr.groupSize, teeIntervalMinutes: pr.teeIntervalMinutes }) }}>Same as round {i}</button>}
                </div>
                <TeeSheetFields id={`w-ts${i}`} teamSize={s.teamSize} value={r} onChange={(v) => setRound(i, v)} />
              </div>
            ))}
          </>
        )}

        {step === 'registration' && <RegistrationStep s={s} set={set} />}
        {step === 'prizes' && <PrizesStep s={s} set={set} tees={tees} holes={holes} />}
        {step === 'review' && <Review s={s} tees={tees} courses={courses} problems={allProblems(s, counts)} />}

        {showErrors && blocking.length > 0 && (
          <Notice kind="error"><ul style={{ margin: 0 }}>{blocking.map((x) => <li key={x}>{x}</li>)}</ul></Notice>
        )}
        {problems.length > blocking.length && <Notice kind="warn">{problems.filter((x) => /holes set up/.test(x)).join(' ')}</Notice>}
        <ErrorNote error={create.error} />

        {step !== 'start' && (
          <div className="row wizard-nav">
            <button className="btn" type="button" onClick={() => go(STEPS[idx - 1]!.key)}>Back</button>
            <span className="spacer" />
            {step === 'review' ? (
              <>
                <button className="btn" type="button" disabled={create.busy || allProblems(s, counts).length > 0} onClick={() => void submit(true)}>Save as template</button>
                <button className="btn primary" type="button" disabled={create.busy || allProblems(s, counts).length > 0} onClick={() => void submit(false)}>{create.busy ? 'Creating…' : 'Create event'}</button>
              </>
            ) : (
              <button className="btn primary" type="button" onClick={next}>Next: {STEPS[idx + 1]!.label}</button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/** Start from scratch, a template, or a past event. */
function StartStep({ onPick, blank }: { onPick: (s: EventSetup, source: string | null) => void; blank: EventSetup }) {
  const { repo } = useApp()
  const [params] = useSearchParams()
  const [events, setEvents] = useState<GolfEvent[] | null>(null)
  const [source, setSource] = useState<GolfEvent | null>(null)
  const [date, setDate] = useState('')
  const { busy, error, run } = useAction()
  useEffect(() => {
    repo.myEvents().then((es) => {
      setEvents(es)
      const pre = params.get('from') ? es.find((e) => e.id === params.get('from')) : undefined
      if (pre) {
        setSource(pre)
        setDate(pre.isTemplate ? pre.date : nextYearSameWeekday(pre.date))
      }
    }, () => setEvents([]))
  }, [repo, params])
  if (!events) return <Loading />
  const templates = events.filter((e) => e.isTemplate)
  const past = events.filter((e) => !e.isTemplate)
  const pick = (e: GolfEvent) => { setSource(e); setDate(e.isTemplate ? e.date : nextYearSameWeekday(e.date)) }

  return (
    <>
      <h2>Where do you want to start?</h2>
      <div className="start-grid">
        <button type="button" className="start-card" onClick={() => onPick(blank, null)}>
          <strong>Blank event</strong>
          <span>Set everything up from scratch.</span>
        </button>
        {templates.map((e) => (
          <button key={e.id} type="button" className={`start-card ${source?.id === e.id ? 'on' : ''}`} onClick={() => pick(e)} aria-pressed={source?.id === e.id}>
            <strong>{e.name.replace(/\s*\(template\)/i, '')}</strong>
            <span>Template · {TEAM_SIZE_LABEL[e.teamSize]}</span>
          </button>
        ))}
      </div>
      {past.length > 0 && (
        <div className="field" style={{ marginTop: '1rem' }}>
          <label htmlFor="w-past">Or copy a past event</label>
          <select id="w-past" value={source && !source.isTemplate ? source.id : ''} onChange={(e) => { const ev = past.find((x) => x.id === e.target.value); if (ev) pick(ev) }}>
            <option value="">Choose an event</option>
            {past.map((e) => <option key={e.id} value={e.id}>{e.name} ({formatDate(e.date)})</option>)}
          </select>
        </div>
      )}
      {source && (
        <div className="round-card">
          <p style={{ marginTop: 0 }}>Start from <strong>{source.name}</strong>: rounds, formats, flights, tee sheet, registration settings and questions, scoring, side games and payouts are copied. Players are not.</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="w-first">First day of the new event</label>
              <input id="w-first" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <button className="btn primary" type="button" disabled={busy || !date} onClick={() => void run(async () => {
              const b = await repo.loadBundle(source.id)
              onPick(setupFromBundle(b, date, nameForYear(source.name, date)), source.name)
            })}>Continue</button>
          </div>
          <ErrorNote error={error} />
        </div>
      )}
    </>
  )
}

function RegistrationStep({ s, set }: { s: EventSetup; set: (p: Partial<EventSetup>) => void }) {
  const r = s.registration
  const setR = (patch: Partial<typeof r>) => set({ registration: { ...r, ...patch } })
  const [fee, setFee] = useState(centsToDollars(r.entryFeeCents))
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v)) || 0))
  return (
    <>
      <h2>Registration</h2>
      <label className="choice">
        <input type="checkbox" checked={r.open} onChange={(e) => setR({ open: e.target.checked })} />
        <span>Take sign-ups online<span className="hint">Players register on the public page once you publish the event. Templates never take sign-ups.</span></span>
      </label>
      <div className="grid-2" style={{ gap: '0 1rem', marginTop: '.5rem' }}>
        <div className="field">
          <label htmlFor="w-opens">Opens</label>
          <input id="w-opens" type="datetime-local" value={isoToZonedInput(r.opensAt, s.timezone)} onChange={(e) => setR({ opensAt: zonedInputToIso(e.target.value, s.timezone) })} />
          <span className="hint">Blank = as soon as it's published.</span>
        </div>
        <div className="field">
          <label htmlFor="w-closes">Closes</label>
          <input id="w-closes" type="datetime-local" value={isoToZonedInput(r.closesAt, s.timezone)} onChange={(e) => setR({ closesAt: zonedInputToIso(e.target.value, s.timezone) })} />
          <span className="hint">Blank = no closing time.</span>
        </div>
        <div className="field">
          <label htmlFor="w-max">Field limit (players)</label>
          <input id="w-max" type="number" min={1} max={500} step={s.teamSize} value={r.maxPlayers ?? ''} onChange={(e) => setR({ maxPlayers: num(e.target.value) })} />
          <span className="hint">{s.teamSize > 1 ? `Players, e.g. ${36 * s.teamSize} for 36 teams. ` : ''}Blank = no limit.</span>
        </div>
        <div className="field">
          <label htmlFor="w-wait">Waitlist limit (players)</label>
          <input id="w-wait" type="number" min={0} max={500} value={r.waitlistLimit ?? ''} onChange={(e) => setR({ waitlistLimit: num(e.target.value) })} />
          <span className="hint">Blank = no limit.</span>
        </div>
        <div className="field">
          <label htmlFor="w-fee">Entry fee per player ($)</label>
          <input id="w-fee" type="text" inputMode="decimal" value={fee} placeholder="e.g. 75" onChange={(e) => {
            setFee(e.target.value)
            const c = dollarsToCents(e.target.value)
            if (c !== 'bad') setR({ entryFeeCents: c })
          }} />
          {dollarsToCents(fee) === 'bad' && <span className="hint" role="alert" style={{ color: 'var(--danger)' }}>Enter dollars, like 75 or 62.50.</span>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="w-pay">Payment instructions</label>
        <textarea id="w-pay" maxLength={1000} value={r.paymentInstructions} onChange={(e) => setR({ paymentInstructions: e.target.value })} placeholder="e.g. Pay at the pro shop by Friday." />
      </div>
      <label className="choice">
        <input type="checkbox" checked={r.showParticipants} onChange={(e) => setR({ showParticipants: e.target.checked })} />
        <span>Show who's registered on the event page</span>
      </label>
      <h3>Sign-up questions</h3>
      <p className="small">Name, email, phone and handicap index are always asked.</p>
      <QuestionsEditor value={s.questions} onChange={(questions) => set({ questions })} teamSize={s.teamSize} />
    </>
  )
}

function PrizesStep({ s, set, tees, holes }: { s: EventSetup; set: (p: Partial<EventSetup>) => void; tees: Tee[]; holes: Hole[] }) {
  const slots = draftPayoutSlots(s)
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(slots.map((x) => [slotKey(x), formatAmounts(s.payouts.find((t) => t.basis === x.basis && t.roundNumber === x.roundNumber && t.flightName === x.flightName)?.amountsCents ?? [])])))
  const roundHoles = (i: number) => holes.filter((h) => h.teeId === s.rounds[i]?.teeId).sort((a, b) => a.number - b.number)
  const unrated = tees.filter((t) => s.rounds.some((r) => r.teeId === t.id) && (t.rating === null || t.slope === null))
  const setAmounts = (x: (typeof slots)[number], v: string) => {
    setText({ ...text, [slotKey(x)]: v })
    const parsed = parseAmounts(v)
    if (parsed === 'bad') return
    const rest = s.payouts.filter((t) => !(t.basis === x.basis && t.roundNumber === x.roundNumber && t.flightName === x.flightName))
    set({ payouts: parsed.some((c) => c > 0) ? [...rest, { basis: x.basis, roundNumber: x.roundNumber, flightName: x.flightName, amountsCents: parsed }] : rest })
  }
  const addGame = (roundNumber: number, kind: SideGameKind) => {
    const hs = roundHoles(roundNumber - 1)
    const pars = (n: number) => hs.filter((h) => h.par === n).map((h) => h.number)
    set({ sideGames: [...s.sideGames, {
      roundNumber, kind, name: kind === 'skins' ? 'Skins' : SIDE_GAME_LABEL[kind], basis: 'gross', carryover: false, purseCents: 0, perHoleCents: 0,
      holes: kind === 'closest_to_pin' ? pars(3) : kind === 'long_drive' ? pars(5).slice(0, 2) : [], sortOrder: s.sideGames.length + 1,
    }] })
  }
  const setGame = (i: number, patch: Partial<EventSetup['sideGames'][number]>) => set({ sideGames: s.sideGames.map((g, k) => (k === i ? { ...g, ...patch } : g)) })

  return (
    <>
      <h2>Scoring &amp; prizes</h2>
      <ScoringFields value={s} onChange={(v) => set(v)} teamSize={s.teamSize} methods={[...new Set(s.rounds.flatMap((r) => r.segments.map((x) => x.method)))]} />
      {s.scoringBasis !== 'gross' && unrated.length > 0 && (
        <Notice kind="warn">Net scoring needs a course rating and slope for the {unrated.map((t) => t.name).join(' and ')} tee{unrated.length === 1 ? '' : 's'}. You can add them under Courses any time before scoring.</Notice>
      )}

      <h3>Side games</h3>
      {s.rounds.map((_, ri) => {
        const games = s.sideGames.map((g, i) => ({ g, i })).filter(({ g }) => g.roundNumber === ri + 1)
        return (
          <div key={ri} className="round-card">
            <div className="split">
              <h4 style={{ margin: 0 }}>{s.rounds.length > 1 ? `Round ${ri + 1}` : 'This round'}</h4>
              <div className="row">
                {(['skins', 'closest_to_pin', 'long_drive'] as SideGameKind[]).map((k) => (
                  <button key={k} className="btn small" type="button" onClick={() => addGame(ri + 1, k)}>+ {SIDE_GAME_LABEL[k]}</button>
                ))}
              </div>
            </div>
            {games.length === 0 && <p className="muted small">None.</p>}
            {games.map(({ g, i }) => (
              <div key={i} className="question-row">
                <div className="grid-3">
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor={`w-g${i}-n`}>{SIDE_GAME_LABEL[g.kind]}</label>
                    <input id={`w-g${i}-n`} type="text" maxLength={60} value={g.name} onChange={(e) => setGame(i, { name: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor={`w-g${i}-m`}>{g.kind === 'skins' ? 'Total purse ($)' : 'Prize per hole ($)'}</label>
                    <input id={`w-g${i}-m`} type="text" inputMode="decimal" placeholder="None" defaultValue={centsToDollars(g.kind === 'skins' ? g.purseCents || null : g.perHoleCents || null)}
                      onChange={(e) => { const c = dollarsToCents(e.target.value); if (c !== 'bad') setGame(i, g.kind === 'skins' ? { purseCents: c ?? 0 } : { perHoleCents: c ?? 0 }) }} />
                  </div>
                  {g.kind === 'skins' && (
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor={`w-g${i}-b`}>Scores</label>
                      <select id={`w-g${i}-b`} value={g.basis} onChange={(e) => setGame(i, { basis: e.target.value as 'gross' | 'net' })}>
                        <option value="gross">Gross</option><option value="net">Net</option>
                      </select>
                    </div>
                  )}
                </div>
                {g.kind === 'skins' ? (
                  <label className="choice"><input type="checkbox" checked={g.carryover} onChange={(e) => setGame(i, { carryover: e.target.checked })} /> <span>Carryover</span></label>
                ) : (
                  <div className="hole-picks" style={{ marginTop: '.5rem' }} role="group" aria-label={`${g.name} holes`}>
                    {Array.from({ length: 18 }, (_, k) => k + 1).map((n) => {
                      const par = roundHoles(ri).find((h) => h.number === n)?.par
                      return (
                        <label key={n} className={`hole-pick ${g.holes.includes(n) ? 'on' : ''}`}>
                          <input type="checkbox" checked={g.holes.includes(n)} onChange={(e) => setGame(i, { holes: e.target.checked ? [...g.holes, n].sort((a, b) => a - b) : g.holes.filter((x) => x !== n) })} />
                          <span>{n}{par && <small>par {par}</small>}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
                <div className="row"><span className="spacer" /><button className="btn quiet small" type="button" onClick={() => set({ sideGames: s.sideGames.filter((_, k) => k !== i) })}>Remove</button></div>
              </div>
            ))}
          </div>
        )
      })}

      <h3>Place money</h3>
      <p className="small">Amounts for each finishing place, separated by commas (e.g. <code>600, 300, 150</code>). Leave blank for no payout. Ties share the places they cover.</p>
      <div className="table-wrap">
        <table>
          <tbody>
            {slots.map((x) => (
              <tr key={slotKey(x)}>
                <th scope="row" style={{ fontWeight: 600 }}>{x.label}</th>
                <td>
                  <input aria-label={`Payouts for ${x.label}`} type="text" inputMode="decimal" value={text[slotKey(x)] ?? ''} placeholder="e.g. 600, 300, 150" onChange={(e) => setAmounts(x, e.target.value)} />
                  {parseAmounts(text[slotKey(x)] ?? '') === 'bad' && <span className="hint" role="alert" style={{ color: 'var(--danger)' }}>Use dollar amounts separated by commas.</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

const slotKey = (x: { basis: string; roundNumber: number | null; flightName: string | null }) => `${x.basis}|${x.roundNumber ?? ''}|${x.flightName ?? ''}`

function Review({ s, tees, courses, problems }: { s: EventSetup; tees: Tee[]; courses: Course[]; problems: string[] }) {
  const teeName = (id: string | null) => tees.find((t) => t.id === id)?.name ?? 'not chosen'
  const fakeBundle = { event: { teamSize: s.teamSize }, rounds: s.rounds.map((r, i) => ({ ...r, roundNumber: i + 1 })) } as never
  const r = s.registration
  return (
    <>
      <h2>Review</h2>
      {problems.length > 0 && <Notice kind="error">Fix these first:<ul>{problems.map((x) => <li key={x}>{x}</li>)}</ul></Notice>}
      <dl className="review">
        <dt>Event</dt><dd><strong>{s.name || '—'}</strong> at {courses.find((c) => c.id === s.courseId)?.name ?? '—'}</dd>
        <dt>Format</dt><dd>{eventFormatText(fakeBundle)}{s.rounds.length > 1 ? (s.cumulative ? ', one overall total' : ', each round separate') : ''}. {TIEBREAK_LABEL[s.tiebreak]}.</dd>
        <dt>Rounds</dt>
        <dd>
          <ul>
            {s.rounds.map((x, i) => (
              <li key={i}>
                Round {i + 1}: {formatDate(x.date)}, {teeName(x.teeId)} tees, {x.startType === 'shotgun' ? `shotgun${x.startTime ? ` at ${x.startTime}` : ''} from hole ${x.startingHole}` : `tee times${x.startTime ? ` from ${x.startTime}` : ''}, every ${x.teeIntervalMinutes} min`}, {x.groupSize} {s.teamSize > 1 ? 'team' : 'player'}{x.groupSize === 1 ? '' : 's'} per group
                {s.rounds.some((y) => describeFormat(y.segments, s.teamSize) !== describeFormat(x.segments, s.teamSize)) && ` — ${describeFormat(x.segments, s.teamSize)}`}
              </li>
            ))}
          </ul>
        </dd>
        <dt>Flights</dt><dd>{s.flights.length ? s.flights.join(', ') : 'None'}</dd>
        <dt>Registration</dt>
        <dd>
          {r.open ? 'Online sign-ups' : 'No online sign-ups yet'}
          {r.maxPlayers !== null && `, ${r.maxPlayers} players`}{r.waitlistLimit !== null && ` + ${r.waitlistLimit} waitlist`}
          {r.entryFeeCents !== null && `, ${formatMoney(r.entryFeeCents)} per player`}
          {s.questions.length > 0 && `. Questions: ${s.questions.map((q) => q.label).join('; ')}`}
        </dd>
        <dt>Scoring</dt><dd>{SCORING_BASIS_LABEL[s.scoringBasis]}{s.hidePurse ? '; prize money hidden from spectators' : ''}</dd>
        <dt>Side games</dt><dd>{s.sideGames.length ? s.sideGames.map((g) => `${g.name}${s.rounds.length > 1 ? ` (R${g.roundNumber})` : ''}`).join(', ') : 'None'}</dd>
        <dt>Place money</dt><dd>{s.payouts.length ? formatMoney(s.payouts.reduce((a, t) => a + t.amountsCents.reduce((x, y) => x + y, 0), 0)) : 'None'}</dd>
      </dl>
      <p className="small muted">The event starts as a draft that only you can see. Publish it from its Overview when you're ready{r.open ? ' — sign-ups open then' : ''}. "Save as template" keeps it as the master copy you start from each year.</p>
    </>
  )
}
