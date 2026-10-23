import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useApp, usePath } from '../app/context'
import { useTitle } from '../app/hooks'
import { ErrorNote, Loading, Notice } from '../components/ui'
import { errorMessage } from '../data/errors'
import { formatDate } from '../domain/derive'
import {
  formatMoney,
  parseHandicapIndex,
  type EventBundle,
  type RegisterResult,
  type RegistrantInput,
} from '../domain/types'

const blank = (): RegistrantInput => ({ firstName: '', lastName: '', email: '', phone: '', handicapIndex: '' })
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Shared availability logic for the event page and the sign-up page. */
export function registrationState(b: EventBundle): { canRegister: boolean; message: string; spotsLeft: number | null } {
  const r = b.event.registration
  const spotsLeft = r.maxPlayers === null ? null : Math.max(0, r.maxPlayers - b.players.length)
  if (b.event.status !== 'published' && b.event.status !== 'in_progress') return { canRegister: false, message: 'Registration is not open.', spotsLeft }
  if (!r.open) return { canRegister: false, message: 'Registration is closed.', spotsLeft }
  if (r.closesAt && Date.now() >= Date.parse(r.closesAt)) return { canRegister: false, message: 'Registration has closed.', spotsLeft }
  return { canRegister: true, message: spotsLeft === 0 ? 'The field is full. New sign-ups join the waitlist.' : '', spotsLeft }
}

export function formatCloses(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' })
  } catch {
    return new Date(iso).toLocaleString()
  }
}

export function Register() {
  const { code } = useParams()
  const { repo } = useApp()
  const p = usePath()
  const [bundle, setBundle] = useState<EventBundle | null>(null)
  const [missing, setMissing] = useState(false)
  const [people, setPeople] = useState<RegistrantInput[]>([blank()])
  const [teamName, setTeamName] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RegisterResult | null>(null)
  useTitle(bundle ? `Register: ${bundle.event.name}` : 'Register')

  useEffect(() => {
    repo.findEventByCode(code ?? '').then(async (e) => {
      if (!e) return setMissing(true)
      const b = await repo.loadBundle(e.id)
      setBundle(b)
      setPeople(b.round.format === 'scramble_2' ? [blank(), blank()] : [blank()])
    }, () => setMissing(true))
  }, [repo, code])

  if (missing)
    return (
      <>
        <h1>Event not found</h1>
        <p>No published event uses the code <strong>{code}</strong>. Check the link with the organizer.</p>
      </>
    )
  if (!bundle) return <Loading />

  const { event } = bundle
  const isTeam = bundle.round.format === 'scramble_2'
  const state = registrationState(bundle)
  const fee = event.registration.entryFeeCents

  if (result)
    return (
      <div style={{ maxWidth: 560 }}>
        <h1>{result.status === 'confirmed' ? "You're registered" : "You're on the waitlist"}</h1>
        <Notice kind={result.status === 'confirmed' ? 'info' : 'warn'}>
          {result.status === 'confirmed' ? (
            <>
              {isTeam ? <>Your team{result.teamName ? <> <strong>{result.teamName}</strong></> : null} is</> : <>You're</>} in the field for <strong>{event.name}</strong>.
            </>
          ) : (
            <>The field for <strong>{event.name}</strong> is full. The organizer will contact you if a spot opens.</>
          )}
        </Notice>
        <p>
          Confirmation number <span className="code-chip">{result.ref}</span>. Keep it in case you need to contact the organizer.
        </p>
        {event.registration.paymentInstructions && result.status === 'confirmed' && (
          <section className="panel">
            <h2>Payment</h2>
            {fee !== null && <p><strong>{formatMoney(fee)}</strong> per player.</p>}
            <p style={{ whiteSpace: 'pre-wrap' }}>{event.registration.paymentInstructions}</p>
          </section>
        )}
        <p className="small muted">This site doesn't send confirmation emails yet. Take a screenshot of this page for your records.</p>
        <Link className="btn" to={p(`e/${event.publicCode}`)}>Back to the event</Link>
      </div>
    )

  const set = (i: number, patch: Partial<RegistrantInput>) => {
    setPeople((ps) => ps.map((x, k) => (k === i ? { ...x, ...patch } : x)))
    // Clear the error for a field as soon as it's edited; it's re-checked on submit.
    setErrors((e) => {
      const keys = Object.keys(patch).map((f) => `${i}.${f}`)
      if (!keys.some((k) => k in e)) return e
      const next = { ...e }
      keys.forEach((k) => delete next[k])
      return next
    })
  }

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {}
    people.forEach((x, i) => {
      if (!x.firstName.trim()) e[`${i}.firstName`] = 'Enter a first name.'
      if (!x.lastName.trim()) e[`${i}.lastName`] = 'Enter a last name.'
      if (i === 0 && !x.email.trim()) e[`${i}.email`] = 'Enter an email so the organizer can reach you.'
      else if (x.email.trim() && !EMAIL_RE.test(x.email.trim())) e[`${i}.email`] = "That email address doesn't look right."
      if (x.phone.trim() && !/^[\d\s()+.-]{7,20}$/.test(x.phone.trim())) e[`${i}.phone`] = 'Enter a phone number like 432-555-0100.'
      const h = parseHandicapIndex(x.handicapIndex)
      if (!h.ok) e[`${i}.handicapIndex`] = h.error
    })
    if (isTeam && people[0]!.email.trim() && people[0]!.email.trim().toLowerCase() === people[1]!.email.trim().toLowerCase())
      e['1.email'] = 'Each player needs their own email address.'
    return e
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    setSubmitError(null)
    if (Object.keys(e).length) {
      document.getElementById(`reg-${Object.keys(e)[0]!.replace('.', '-')}`)?.focus()
      return
    }
    setBusy(true)
    try {
      const normalized = people.map((x) => {
        const h = parseHandicapIndex(x.handicapIndex)
        return { ...x, handicapIndex: h.ok && h.value !== null ? String(h.value) : '' }
      })
      setResult(await repo.register(event.publicCode, normalized, teamName, note))
      window.scrollTo({ top: 0 })
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <p className="small"><Link to={p(`e/${event.publicCode}`)}>{event.name}</Link></p>
      <h1>Register{isTeam ? ' your team' : ''}</h1>
      <p className="muted">
        {formatDate(event.date)} at {bundle.course?.name ?? 'the course'}.{' '}
        {isTeam ? 'Two-person scramble: sign up both players together.' : 'Individual stroke play.'}
      </p>
      <dl className="reg-facts">
        {fee !== null && (<><dt>Entry fee</dt><dd>{formatMoney(fee)} per player{isTeam ? ` (${formatMoney(fee * 2)} per team)` : ''}</dd></>)}
        {event.registration.closesAt && (<><dt>Closes</dt><dd>{formatCloses(event.registration.closesAt, event.timezone)}</dd></>)}
        {state.spotsLeft !== null && (<><dt>Spots left</dt><dd>{state.spotsLeft === 0 ? 'None (waitlist)' : `${state.spotsLeft} player${state.spotsLeft === 1 ? '' : 's'}`}</dd></>)}
      </dl>

      {!state.canRegister ? (
        <Notice kind="warn">{state.message} Contact the organizer if you have questions.</Notice>
      ) : (
        <form onSubmit={submit} noValidate>
          {state.message && <Notice kind="warn">{state.message}</Notice>}
          <ErrorNote error={submitError} />
          {people.map((x, i) => (
            <fieldset key={i} className="panel" style={{ padding: '1rem 1.1rem' }}>
              <legend style={{ fontSize: '1.1rem' }}>{isTeam ? (i === 0 ? 'Player 1 (you)' : 'Player 2 (partner)') : 'Your details'}</legend>
              <div className="grid-2" style={{ gap: '0 1rem' }}>
                <Field id={`reg-${i}-firstName`} label="First name" error={errors[`${i}.firstName`]}>
                  <input id={`reg-${i}-firstName`} type="text" autoComplete={i === 0 ? 'given-name' : 'off'} maxLength={60} value={x.firstName} onChange={(e) => set(i, { firstName: e.target.value })} aria-invalid={!!errors[`${i}.firstName`]} />
                </Field>
                <Field id={`reg-${i}-lastName`} label="Last name" error={errors[`${i}.lastName`]}>
                  <input id={`reg-${i}-lastName`} type="text" autoComplete={i === 0 ? 'family-name' : 'off'} maxLength={60} value={x.lastName} onChange={(e) => set(i, { lastName: e.target.value })} aria-invalid={!!errors[`${i}.lastName`]} />
                </Field>
                <Field id={`reg-${i}-email`} label={i === 0 ? 'Email' : 'Email (optional)'} error={errors[`${i}.email`]}>
                  <input id={`reg-${i}-email`} type="email" autoComplete={i === 0 ? 'email' : 'off'} value={x.email} onChange={(e) => set(i, { email: e.target.value })} aria-invalid={!!errors[`${i}.email`]} />
                </Field>
                <Field id={`reg-${i}-phone`} label="Phone (optional)" error={errors[`${i}.phone`]}>
                  <input id={`reg-${i}-phone`} type="tel" autoComplete={i === 0 ? 'tel' : 'off'} value={x.phone} onChange={(e) => set(i, { phone: e.target.value })} aria-invalid={!!errors[`${i}.phone`]} />
                </Field>
                <Field id={`reg-${i}-handicapIndex`} label="Handicap index (optional)" hint="As shown in your GHIN app, e.g. 12.4. Use + for plus handicaps, e.g. +1.2." error={errors[`${i}.handicapIndex`]}>
                  <input id={`reg-${i}-handicapIndex`} type="text" inputMode="decimal" maxLength={5} value={x.handicapIndex} onChange={(e) => set(i, { handicapIndex: e.target.value })} aria-invalid={!!errors[`${i}.handicapIndex`]} style={{ maxWidth: 140 }} />
                </Field>
              </div>
            </fieldset>
          ))}
          {isTeam && (
            <div className="field">
              <label htmlFor="reg-team">Team name (optional)</label>
              <input id="reg-team" type="text" maxLength={60} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Defaults to your last names" />
            </div>
          )}
          <div className="field">
            <label htmlFor="reg-note">Note to the organizer (optional)</label>
            <textarea id="reg-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. tee time request, cart partner" />
          </div>
          {event.registration.paymentInstructions && (
            <section className="panel" style={{ background: 'var(--gold-tint)', borderColor: 'var(--gold)' }}>
              <h2 style={{ fontSize: '1.15rem' }}>Payment</h2>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{event.registration.paymentInstructions}</p>
            </section>
          )}
          <p className="small muted">
            Your name appears on the public pairings and leaderboard. Email, phone and handicap are visible only to the organizer.
          </p>
          <button className="btn primary" type="submit" disabled={busy} style={{ minHeight: 'var(--tap)', minWidth: 200 }}>
            {busy ? 'Registering…' : state.spotsLeft === 0 ? 'Join the waitlist' : isTeam ? 'Register team' : 'Register'}
          </button>
        </form>
      )}
    </div>
  )
}

function Field(props: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.hint && !props.error && <span className="hint">{props.hint}</span>}
      {props.error && <span className="hint" role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{props.error}</span>}
    </div>
  )
}
