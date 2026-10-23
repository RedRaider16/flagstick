import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useApp, usePath } from '../../app/context'
import { useAction } from '../../app/hooks'
import { download, ErrorNote, Loading, Notice, slug, useReasonDialog } from '../../components/ui'
import { formatStamp } from '../../domain/derive'
import {
  formatHandicapIndex,
  formatMoney,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  type PaymentMethod,
  type PaymentStatus,
  type Registration,
  type RegistrationSettings,
} from '../../domain/types'
import { toCsv } from '../../scoring/csv'
import { registrationState } from '../Register'
import { useManage } from './ManageLayout'

/** "2026-10-30T18:00" in the event's zone ⇄ ISO. datetime-local has no zone, so we
 * interpret it in the event's time zone using the offset at that moment. */
function zonedInputToIso(local: string, tz: string): string | null {
  if (!local) return null
  const [d, t] = local.split('T')
  const [y, m, day] = d!.split('-').map(Number)
  const [hh, mm] = t!.split(':').map(Number)
  const guess = Date.UTC(y!, m! - 1, day!, hh!, mm!)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {})
  const asIfUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!)
  return new Date(guess - (asIfUtc - guess)).toISOString()
}
function isoToZonedInput(iso: string | null, tz: string): string {
  if (!iso) return ''
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {})
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
const dollarsToCents = (s: string): number | null | 'bad' => {
  const t = s.replace(/[$,\s]/g, '')
  if (!t) return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'bad'
  return Math.round(Number(t) * 100)
}
const centsToDollars = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''))

export function Registrations() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const p = usePath()
  const { event } = bundle
  const isTeam = bundle.round.format === 'scramble_2'
  const [regs, setRegs] = useState<Registration[] | null>(null)
  const [filter, setFilter] = useState<'active' | 'waitlisted' | 'unpaid' | 'cancelled' | 'all'>('active')
  const list = useAction()
  const dialog = useReasonDialog()

  const load = useCallback(() => repo.listRegistrations(event.id).then(setRegs, () => setRegs([])), [repo, event.id])
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
    const rows = (regs ?? []).flatMap((r) =>
      r.people.map((x) => [
        r.ref, r.status, isTeam ? r.teamName || bundle.teams.find((t) => t.id === r.teamId)?.name || '' : '', x.position,
        x.firstName, x.lastName, x.email, x.phone, formatHandicapIndex(x.handicapIndex),
        PAYMENT_STATUS_LABEL[r.paymentStatus], PAYMENT_METHOD_LABEL[r.paymentMethod], r.amountPaidCents === null ? '' : (r.amountPaidCents / 100).toFixed(2),
        r.registrantNote, r.adminNote, r.createdAt,
      ]),
    )
    download(`${slug(event.name)}-registrations-PRIVATE.csv`, toCsv(
      ['confirmation', 'status', 'team', 'player', 'first_name', 'last_name', 'email', 'phone', 'handicap_index', 'payment', 'method', 'amount', 'player_note', 'admin_note', 'registered_at'],
      rows,
    ))
  }

  return (
    <>
      {dialog.element}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <SettingsForm key={event.id + JSON.stringify(event.registration)} eventId={event.id} tz={event.timezone} settings={event.registration} isTeam={isTeam} onSaved={reload} />
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
              <RegistrationCard key={r.id} reg={r} isTeam={isTeam} teamName={bundle.teams.find((t) => t.id === r.teamId)?.name ?? r.teamName} tz={event.timezone}
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
    </>
  )
}

function SettingsForm(props: { eventId: string; tz: string; settings: RegistrationSettings; isTeam: boolean; onSaved: () => Promise<void> }) {
  const { repo } = useApp()
  const { busy, error, setError, run } = useAction()
  const [open, setOpen] = useState(props.settings.open)
  const [closes, setCloses] = useState(isoToZonedInput(props.settings.closesAt, props.tz))
  const [max, setMax] = useState(props.settings.maxPlayers === null ? '' : String(props.settings.maxPlayers))
  const [fee, setFee] = useState(centsToDollars(props.settings.entryFeeCents))
  const [instructions, setInstructions] = useState(props.settings.paymentInstructions)
  const [saved, setSaved] = useState(false)

  return (
    <form className="panel" onSubmit={(e) => {
      e.preventDefault()
      setSaved(false)
      const maxN = max.trim() === '' ? null : Number(max)
      if (maxN !== null && (!Number.isInteger(maxN) || maxN < 1 || maxN > 500)) return setError('Field limit must be a whole number from 1 to 500, or blank for no limit.')
      if (props.isTeam && maxN !== null && maxN % 2 === 1) return setError('This is a two-person team event, so use an even field limit (players, not teams).')
      const feeC = dollarsToCents(fee)
      if (feeC === 'bad') return setError('Enter the entry fee in dollars, like 60 or 62.50.')
      void run(async () => {
        await repo.updateRegistrationSettings(props.eventId, {
          open, closesAt: zonedInputToIso(closes, props.tz), maxPlayers: maxN, entryFeeCents: feeC, paymentInstructions: instructions.trim(),
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
          <label htmlFor="rs-close">Closes</label>
          <input id="rs-close" type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} />
          <span className="hint">In the event's time zone ({props.tz.replace('America/', '').replace('_', ' ')}). Blank = no closing time.</span>
        </div>
        <div className="field">
          <label htmlFor="rs-max">Field limit (players)</label>
          <input id="rs-max" type="number" inputMode="numeric" min={1} max={500} step={props.isTeam ? 2 : 1} value={max} onChange={(e) => setMax(e.target.value)} />
          <span className="hint">{props.isTeam ? 'Count players, e.g. 72 for 36 teams.' : 'Extra sign-ups go to the waitlist.'} Blank = no limit.</span>
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
        <thead><tr><th scope="col">Player</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col" className="n">HI</th></tr></thead>
        <tbody>
          {r.people.map((x) => (
            <tr key={x.position}>
              <td>{x.firstName} {x.lastName}</td>
              <td>{x.email ? <a href={`mailto:${x.email}`}>{x.email}</a> : <span className="muted">—</span>}</td>
              <td>{x.phone ? <a href={`tel:${x.phone}`}>{x.phone}</a> : <span className="muted">—</span>}</td>
              <td className="n">{formatHandicapIndex(x.handicapIndex) || <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

