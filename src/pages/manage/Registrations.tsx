import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useApp, usePath } from '../../app/context'
import { useAction } from '../../app/hooks'
import { download, ErrorNote, Loading, Notice, slug, useReasonDialog } from '../../components/ui'
import { formatStamp, isTeamEvent } from '../../domain/derive'
import {
  formatHandicapIndex,
  formatMoney,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  type PaymentMethod,
  type PaymentStatus,
  type Registration,
  type RegistrationAnswer,
  type RegistrationQuestion,
  type RegistrationSettings,
} from '../../domain/types'
import { toCsv } from '../../scoring/csv'
import { centsToDollars, dollarsToCents, isoToZonedInput, zonedInputToIso } from '../../domain/inputs'
import { QuestionsEditor, type QuestionDraft } from '../../components/QuestionsEditor'
import { EmailsPanel } from '../../components/EmailsPanel'
import { registrationState } from '../Register'
import { useManage } from './ManageLayout'

export function Registrations() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const p = usePath()
  const { event } = bundle
  const isTeam = isTeamEvent(bundle)
  const [regs, setRegs] = useState<Registration[] | null>(null)
  const [answers, setAnswers] = useState<RegistrationAnswer[]>([])
  const [filter, setFilter] = useState<'active' | 'waitlisted' | 'unpaid' | 'cancelled' | 'all'>('active')
  const list = useAction()
  const dialog = useReasonDialog()

  const load = useCallback(async () => {
    await repo.listRegistrations(event.id).then(setRegs, () => setRegs([]))
    await repo.listAnswers(event.id).then(setAnswers, () => setAnswers([]))
  }, [repo, event.id])
  useEffect(() => void load(), [load, bundle])

  const state = registrationState(bundle)
  const registerUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${p(`e/${event.publicCode}/register`)}`
  const shown = (regs ?? []).filter((r) =>
    filter === 'all' ? true
    : filter === 'active' ? r.status === 'confirmed'
    : filter === 'unpaid' ? r.status === 'confirmed' && r.paymentStatus === 'unpaid'
    : r.status === filter,
  )
  const confirmed = (regs ?? []).filter((r) => r.status === 'confirmed')
  const waitlisted = (regs ?? []).filter((r) => r.status === 'waitlisted')
  const collected = confirmed.reduce((s, r) => s + (r.paymentStatus === 'paid' ? r.amountPaidCents ?? 0 : 0), 0)
  const unpaid = confirmed.filter((r) => r.paymentStatus === 'unpaid').length

  const exportCsv = () => {
    const qs = bundle.questions
    const ans = (r: Registration, q: RegistrationQuestion, pos: number) => answers.find((a) => a.registrationId === r.id && a.questionId === q.id && a.position === (q.perPlayer ? pos : 0))?.value ?? ''
    const rows = (regs ?? []).flatMap((r) =>
      r.people.map((x) => [
        r.ref, r.status, isTeam ? r.teamName || bundle.teams.find((t) => t.id === r.teamId)?.name || '' : '', x.position,
        x.firstName, x.lastName, x.email, x.phone, formatHandicapIndex(x.handicapIndex),
        ...qs.map((q) => ans(r, q, x.position)),
        PAYMENT_STATUS_LABEL[r.paymentStatus], PAYMENT_METHOD_LABEL[r.paymentMethod], r.amountPaidCents === null ? '' : (r.amountPaidCents / 100).toFixed(2),
        r.registrantNote, r.adminNote, r.createdAt,
      ]),
    )
    download(`${slug(event.name)}-registrations-PRIVATE.csv`, toCsv(
      ['confirmation', 'status', 'team', 'player', 'first_name', 'last_name', 'email', 'phone', 'handicap_index', ...qs.map((q) => q.label), 'payment', 'method', 'amount', 'player_note', 'admin_note', 'registered_at'],
      rows,
    ))
  }

  return (
    <>
      {dialog.element}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <SettingsForm key={event.id + JSON.stringify(event.registration)} eventId={event.id} tz={event.timezone} settings={event.registration} teamSize={event.teamSize} onSaved={reload} />
        <section className="panel">
          <h2>Sign-up page</h2>
          <p>
            {state.canRegister ? <span className="badge in_progress">Open</span> : <span className="badge draft">Closed</span>}{' '}
            {state.canRegister && state.spotsLeft !== null && <>{state.spotsLeft} spot{state.spotsLeft === 1 ? '' : 's'} left.</>}
            {!state.canRegister && <span className="muted">{state.message}</span>}
          </p>
          {event.status === 'draft' && <Notice kind="info">Publish the event (Overview) before players can register.</Notice>}
          <p className="small" style={{ wordBreak: 'break-all' }}>{registerUrl}</p>
          <div className="row">
            <button className="btn" type="button" onClick={() => void navigator.clipboard?.writeText(registerUrl)}>Copy link</button>
            <Link className="btn quiet" to={p(`e/${event.publicCode}/register`)}>Open sign-up page</Link>
          </div>
          <dl className="reg-facts" style={{ marginTop: '1rem' }}>
            <dt>Registered</dt><dd>{confirmed.length} {isTeam ? 'team' : 'player'}{confirmed.length === 1 ? '' : 's'} ({bundle.players.length} players in the field)</dd>
            <dt>Waitlist</dt><dd>{waitlisted.length}</dd>
            <dt>Collected</dt><dd>{formatMoney(collected) || '$0.00'}{unpaid ? `, ${unpaid} unpaid` : ''}</dd>
          </dl>
          <p className="small muted">Players you add on the Players tab count toward the field limit but don't appear in this list.</p>
        </section>
      </div>

      <QuestionsPanel key={bundle.questions.map((q) => q.id + q.label).join("|")} />

      <section className="panel">
        <div className="split">
          <h2>Registrations</h2>
          <div className="row">
            <label htmlFor="reg-filter" className="sr-only">Show</label>
            <select id="reg-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ width: 'auto' }}>
              <option value="active">Registered ({confirmed.length})</option>
              <option value="unpaid">Unpaid ({unpaid})</option>
              <option value="waitlisted">Waitlist ({waitlisted.length})</option>
              <option value="cancelled">Cancelled ({(regs ?? []).filter((r) => r.status === 'cancelled').length})</option>
              <option value="all">All ({(regs ?? []).length})</option>
            </select>
            <button className="btn" type="button" onClick={exportCsv} disabled={!regs?.length}>Export CSV</button>
          </div>
        </div>
        <ErrorNote error={list.error} />
        {!regs ? <Loading /> : shown.length === 0 ? (
          <p className="muted">{regs.length === 0 ? 'No one has registered yet. Share the sign-up link when registration is open.' : 'Nothing in this view.'}</p>
        ) : (
          <div className="stack">
            {shown.map((r) => (
              <RegistrationCard key={r.id} reg={r} isTeam={isTeam} questions={bundle.questions} answers={answers.filter((a) => a.registrationId === r.id)} teamName={bundle.teams.find((t) => t.id === r.teamId)?.name ?? r.teamName} tz={event.timezone}
                feeCents={event.registration.entryFeeCents} disabled={list.busy || event.status === 'finalized'}
                onSavePayment={(pay) => list.run(async () => { await repo.updateRegistrationPayment(r.id, pay); await load() })}
                onPromote={() => list.run(async () => { await repo.promoteRegistration(r.id); await reload(); await load() })}
                onCancel={async () => {
                  const reason = await dialog.ask({
                    title: `Cancel ${r.ref}?`,
                    body: <p>{r.status === 'confirmed' ? `Removes ${r.people.map((x) => x.firstName).join(' and ')} from the field${isTeam ? ' and deletes the team' : ''}. ` : ''}The registration stays in the list as cancelled. Refunds are not automatic.</p>,
                    label: 'Reason', confirmLabel: 'Cancel registration', danger: true,
                  })
                  if (reason !== null) await list.run(async () => { await repo.cancelRegistration(r.id, reason); await reload(); await load() })
                }} />
            ))}
          </div>
        )}
      </section>

      <EmailsPanel eventId={event.id} tz={event.timezone} />
    </>
  )
}

function SettingsForm(props: { eventId: string; tz: string; settings: RegistrationSettings; teamSize: number; onSaved: () => Promise<void> }) {
  const isTeam = props.teamSize > 1
  const { repo } = useApp()
  const { busy, error, setError, run } = useAction()
  const [open, setOpen] = useState(props.settings.open)
  const [closes, setCloses] = useState(isoToZonedInput(props.settings.closesAt, props.tz))
  const [max, setMax] = useState(props.settings.maxPlayers === null ? '' : String(props.settings.maxPlayers))
  const [fee, setFee] = useState(centsToDollars(props.settings.entryFeeCents))
  const [instructions, setInstructions] = useState(props.settings.paymentInstructions)
  const [opens, setOpens] = useState(isoToZonedInput(props.settings.opensAt, props.tz))
  const [waitlist, setWaitlist] = useState(props.settings.waitlistLimit === null ? '' : String(props.settings.waitlistLimit))
  const [showField, setShowField] = useState(props.settings.showParticipants)
  const [saved, setSaved] = useState(false)

  return (
    <form className="panel" onSubmit={(e) => {
      e.preventDefault()
      setSaved(false)
      const maxN = max.trim() === '' ? null : Number(max)
      if (maxN !== null && (!Number.isInteger(maxN) || maxN < 1 || maxN > 500)) return setError('Field limit must be a whole number from 1 to 500, or blank for no limit.')
      if (isTeam && maxN !== null && maxN % props.teamSize !== 0) return setError(`Teams have ${props.teamSize} players, so use a field limit that divides by ${props.teamSize} (players, not teams).`)
      const waitN = waitlist.trim() === '' ? null : Number(waitlist)
      if (waitN !== null && (!Number.isInteger(waitN) || waitN < 0 || waitN > 500)) return setError('Waitlist limit must be a whole number from 0 to 500, or blank for no limit.')
      const opensIso = zonedInputToIso(opens, props.tz)
      const closesIso = zonedInputToIso(closes, props.tz)
      if (opensIso && closesIso && opensIso >= closesIso) return setError('Registration must open before it closes.')
      const feeC = dollarsToCents(fee)
      if (feeC === 'bad') return setError('Enter the entry fee in dollars, like 60 or 62.50.')
      void run(async () => {
        await repo.updateRegistrationSettings(props.eventId, {
          open, closesAt: closesIso, maxPlayers: maxN, entryFeeCents: feeC, paymentInstructions: instructions.trim(),
          opensAt: opensIso, waitlistLimit: waitN, showParticipants: showField,
        })
        await props.onSaved()
        setSaved(true)
      })
    }}>
      <h2>Registration settings</h2>
      <ErrorNote error={error} />
      <label className="choice">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        <span>Registration is open<span className="hint">Players can sign up on the public page while the event is published or in progress.</span></span>
      </label>
      <div className="grid-2" style={{ gap: '0 1rem', marginTop: '.5rem' }}>
        <div className="field">
          <label htmlFor="rs-open">Opens</label>
          <input id="rs-open" type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} />
          <span className="hint">Blank = as soon as registration is turned on.</span>
        </div>
        <div className="field">
          <label htmlFor="rs-close">Closes</label>
          <input id="rs-close" type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} />
          <span className="hint">In the event's time zone ({props.tz.replace('America/', '').replace('_', ' ')}). Blank = no closing time.</span>
        </div>
        <div className="field">
          <label htmlFor="rs-max">Field limit (players)</label>
          <input id="rs-max" type="number" inputMode="numeric" min={1} max={500} step={props.teamSize} value={max} onChange={(e) => setMax(e.target.value)} />
          <span className="hint">{isTeam ? `Count players, e.g. ${36 * props.teamSize} for 36 teams.` : 'Extra sign-ups go to the waitlist.'} Blank = no limit.</span>
        </div>
        <div className="field">
          <label htmlFor="rs-wait">Waitlist limit (players)</label>
          <input id="rs-wait" type="number" inputMode="numeric" min={0} max={500} value={waitlist} onChange={(e) => setWaitlist(e.target.value)} />
          <span className="hint">Once the field and waitlist are full, sign-ups stop. Blank = no limit.</span>
        </div>
        <div className="field">
          <label htmlFor="rs-fee">Entry fee per player ($)</label>
          <input id="rs-fee" type="text" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="e.g. 75" />
          <span className="hint">Shown on the sign-up page. Blank = not shown.</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="rs-pay">Payment instructions</label>
        <textarea id="rs-pay" maxLength={1000} value={instructions} onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Pay at the pro shop by Friday, or Venmo @your-name with your team name." />
        <span className="hint">Shown on the sign-up page and confirmation. Card payment inside Flagstick isn't set up yet.</span>
      </div>
      <label className="choice">
        <input type="checkbox" checked={showField} onChange={(e) => setShowField(e.target.checked)} />
        <span>Show who's registered on the event page<span className="hint">Names (and team names) only.</span></span>
      </label>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>Save settings</button>
        {saved && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
      </div>
    </form>
  )
}

function RegistrationCard(props: {
  reg: Registration
  isTeam: boolean
  questions: RegistrationQuestion[]
  answers: RegistrationAnswer[]
  teamName: string
  tz: string
  feeCents: number | null
  disabled: boolean
  onSavePayment: (p: { paymentStatus: PaymentStatus; paymentMethod: PaymentMethod; amountPaidCents: number | null; adminNote: string }) => Promise<unknown>
  onPromote: () => void
  onCancel: () => void
}) {
  const r = props.reg
  const expected = props.feeCents === null ? null : props.feeCents * r.people.length
  const [status, setStatus] = useState<PaymentStatus>(r.paymentStatus)
  const [method, setMethod] = useState<PaymentMethod>(r.paymentMethod)
  const [amount, setAmount] = useState(centsToDollars(r.amountPaidCents))
  const [note, setNote] = useState(r.adminNote)
  const [amountErr, setAmountErr] = useState<string | null>(null)
  const dirty = status !== r.paymentStatus || method !== r.paymentMethod || amount !== centsToDollars(r.amountPaidCents) || note !== r.adminNote
  const id = `rg-${r.id}`

  return (
    <article className="reg-card" aria-labelledby={`${id}-h`}>
      <div className="split">
        <div>
          <h3 id={`${id}-h`} style={{ margin: 0 }}>
            {props.isTeam ? props.teamName || r.people.map((x) => x.lastName).join(' / ') : `${r.people[0]?.firstName} ${r.people[0]?.lastName}`}
            {' '}<span className="code-chip" style={{ fontSize: '.9rem' }}>{r.ref}</span>
          </h3>
          <div className="small muted">
            Registered {formatStamp(r.createdAt, props.tz)}{r.source === 'admin' ? ' by admin' : ''}
            {r.status !== 'confirmed' && <> <span className={`badge ${r.status === 'waitlisted' ? 'provisional' : 'wd'}`}>{r.status === 'waitlisted' ? 'Waitlist' : 'Cancelled'}</span></>}
          </div>
        </div>
        <div className="row">
          {r.status === 'waitlisted' && <button className="btn primary small" type="button" disabled={props.disabled} onClick={props.onPromote}>Add to field</button>}
          {r.status !== 'cancelled' && <button className="btn quiet small" type="button" disabled={props.disabled} onClick={props.onCancel}>Cancel</button>}
        </div>
      </div>
      <table className="small" style={{ marginTop: '.4rem' }}>
        <thead><tr><th scope="col">Player</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col" className="n">HI</th>{props.questions.filter((q) => q.perPlayer).map((q) => <th key={q.id} scope="col">{q.label}</th>)}</tr></thead>
        <tbody>
          {r.people.map((x) => (
            <tr key={x.position}>
              <td>{x.firstName} {x.lastName}</td>
              <td>{x.email ? <a href={`mailto:${x.email}`}>{x.email}</a> : <span className="muted">—</span>}</td>
              <td>{x.phone ? <a href={`tel:${x.phone}`}>{x.phone}</a> : <span className="muted">—</span>}</td>
              <td className="n">{formatHandicapIndex(x.handicapIndex) || <span className="muted">—</span>}</td>
              {props.questions.filter((q) => q.perPlayer).map((q) => (
                <td key={q.id}>{props.answers.find((a) => a.questionId === q.id && a.position === x.position)?.value || <span className="muted">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {props.questions.filter((q) => !q.perPlayer).map((q) => {
        const v = props.answers.find((a) => a.questionId === q.id && a.position === 0)?.value
        return v ? <p key={q.id} className="small" style={{ margin: '.4rem 0 0' }}><strong>{q.label}</strong> {v}</p> : null
      })}
      {r.registrantNote && <p className="small" style={{ margin: '.4rem 0 0' }}><strong>Note:</strong> {r.registrantNote}</p>}
      {r.status !== 'cancelled' || r.paymentStatus !== 'unpaid' ? (
        <form className="row" style={{ marginTop: '.6rem', alignItems: 'flex-end' }} onSubmit={(e) => {
          e.preventDefault()
          const c = dollarsToCents(amount)
          if (c === 'bad') return setAmountErr('Amount must be in dollars, like 150.')
          setAmountErr(null)
          void props.onSavePayment({ paymentStatus: status, paymentMethod: method, amountPaidCents: c, adminNote: note.trim() })
        }}>
          <div>
            <label htmlFor={`${id}-st`} className="small">Payment</label>
            <select id={`${id}-st`} value={status} disabled={props.disabled} style={{ width: 'auto', minHeight: 38 }}
              onChange={(e) => {
                const v = e.target.value as PaymentStatus
                setStatus(v)
                if (v === 'paid' && !amount && expected !== null) setAmount(centsToDollars(expected))
              }}>
              {(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map((k) => <option key={k} value={k}>{PAYMENT_STATUS_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-m`} className="small">Method</label>
            <select id={`${id}-m`} value={method} disabled={props.disabled} style={{ width: 'auto', minHeight: 38 }} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((k) => <option key={k} value={k}>{PAYMENT_METHOD_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-a`} className="small">Amount ($)</label>
            <input id={`${id}-a`} type="text" inputMode="decimal" value={amount} disabled={props.disabled} onChange={(e) => setAmount(e.target.value)}
              placeholder={expected !== null ? centsToDollars(expected) : ''} style={{ width: 100, minHeight: 38 }} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor={`${id}-n`} className="small">Admin note</label>
            <input id={`${id}-n`} type="text" maxLength={500} value={note} disabled={props.disabled} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 38 }} />
          </div>
          <button className="btn small" type="submit" disabled={props.disabled || !dirty}>Save</button>
          {amountErr && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{amountErr}</span>}
        </form>
      ) : null}
    </article>
  )
}


/** The organizer's extra sign-up questions, saved straight away. */
function QuestionsPanel() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const { busy, error, run } = useAction()
  const initial: QuestionDraft[] = bundle.questions.map((q) => ({ id: q.id, label: q.label, kind: q.kind, choices: q.choices, required: q.required, perPlayer: q.perPlayer, sortOrder: q.sortOrder }))
  const [drafts, setDrafts] = useState<QuestionDraft[]>(initial)
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial)
  return (
    <section className="panel">
      <h2>Sign-up questions</h2>
      <p className="small">Name, email, phone and handicap index are always asked. Add anything else you need, like carts or shirt sizes. Answers are visible to admins only and are included in the CSV export.</p>
      <ErrorNote error={error} />
      <QuestionsEditor value={drafts} onChange={(d) => { setDrafts(d); setSaved(false) }} teamSize={bundle.event.teamSize} />
      <div className="row" style={{ marginTop: '.6rem' }}>
        <button className="btn primary" type="button" disabled={busy || !dirty} onClick={() => void run(async () => {
          const keep = new Set(drafts.map((d) => d.id).filter(Boolean))
          for (const q of bundle.questions) if (!keep.has(q.id)) await repo.deleteQuestion(q.id)
          for (const [i, d] of drafts.entries()) {
            const input = { label: d.label, kind: d.kind, choices: d.choices, required: d.required, perPlayer: d.perPlayer, sortOrder: i + 1 }
            if (d.id) await repo.updateQuestion(d.id, input)
            else await repo.createQuestion(bundle.event.id, input)
          }
          await reload()
          setSaved(true)
        })}>Save questions</button>
        {saved && !dirty && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
        {dirty && bundle.questions.length > drafts.filter((d) => d.id).length && <span className="small muted">Removing a question also removes its answers.</span>}
      </div>
    </section>
  )
}
