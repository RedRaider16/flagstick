import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { useAction } from '../app/hooks'
import { formatStamp } from '../domain/derive'
import { EMAIL_KIND_LABEL, type EmailLog, type EmailSettings } from '../domain/types'
import { ErrorNote, Notice } from './ui'

const STATUS: Record<EmailLog['status'], string> = { pending: 'Waiting to send', sending: 'Sending', sent: 'Sent', failed: 'Not sent yet' }
const looksLikeEmail = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s.trim())

/** Confirmation emails for one event: the sending settings (organizers) and what was sent. */
export function EmailsPanel({ eventId, tz }: { eventId: string; tz: string }) {
  const { repo } = useApp()
  const [settings, setSettings] = useState<EmailSettings | null | undefined>(undefined)
  const [log, setLog] = useState<EmailLog[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const act = useAction()

  const load = useCallback(async () => {
    await repo.emailSettings().then(setSettings, () => setSettings(null))
    await repo.listEmails(eventId).then(setLog, () => setLog([]))
  }, [repo, eventId])
  useEffect(() => {
    void load()
    const t = setInterval(() => void repo.listEmails(eventId).then(setLog, () => {}), 30_000)
    return () => clearInterval(t)
  }, [load, repo, eventId])

  const failed = (log ?? []).filter((m) => m.status === 'failed').length
  return (
    <section className="panel">
      <h2>Confirmation emails</h2>
      <p className="small muted">
        Each player with an email address gets a message when they register, go on the waitlist, come off it, or are cancelled:
        their confirmation number, the dates, the fee and payment instructions, and a link to the event page.
      </p>
      {settings === null && <p className="small muted">Only organizers can change the sending settings.</p>}
      {settings && !settings.enabled && <Notice kind="info">Emails are off. Nothing is sent until an organizer turns them on below.</Notice>}
      {settings && <SettingsForm key={JSON.stringify(settings)} value={settings} onSave={(s) => act.run(async () => { await repo.saveEmailSettings(s); await load() })} busy={act.busy} />}
      <ErrorNote error={act.error} />
      {failed > 0 && <Notice kind="warn">{failed} email{failed === 1 ? '' : 's'} couldn't be sent yet. They're retried automatically; check the address if it keeps failing.</Notice>}
      {log && log.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '.75rem' }}>
          <table>
            <thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {log.map((m) => (
                <tr key={m.id}>
                  <td className="small">{formatStamp(m.createdAt, tz)}</td>
                  <td className="small" style={{ wordBreak: 'break-all' }}>{m.toEmail}</td>
                  <td>
                    <button className="btn quiet small" type="button" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>{EMAIL_KIND_LABEL[m.kind]}</button>
                    {open === m.id && <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '.4rem 0 0' }}>{`Subject: ${m.subject}\n\n${m.body}`}</pre>}
                  </td>
                  <td className="small">
                    {STATUS[m.status]}{m.status === 'sent' && m.sentAt ? `, ${formatStamp(m.sentAt, tz)}` : ''}
                    {m.status === 'failed' && m.lastError && <div className="flag-gap">{m.lastError}</div>}
                  </td>
                  <td>
                    {(m.status === 'failed' || m.status === 'sent') && (
                      <button className="btn quiet small" type="button" disabled={act.busy} onClick={() => void act.run(async () => { await repo.resendEmail(m.id); await load() })}>Send again</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log && log.length === 0 && <p className="small muted">No emails for this event yet.</p>}
    </section>
  )
}

function SettingsForm({ value, onSave, busy }: { value: EmailSettings; onSave: (s: EmailSettings) => Promise<void>; busy: boolean }) {
  const [f, setF] = useState(value)
  const [msg, setMsg] = useState<string | null>(null)
  const problem =
    f.enabled && !looksLikeEmail(f.fromAddress) ? 'Enter the address emails come from before turning them on.'
    : f.fromAddress && !looksLikeEmail(f.fromAddress) ? 'The from address doesn\'t look like an email address.'
    : f.replyTo && !looksLikeEmail(f.replyTo) ? 'The reply-to address doesn\'t look like an email address.'
    : !f.fromName.trim() ? 'Give a sender name.' : null
  return (
    <details className="small" open={!value.enabled} style={{ margin: '.5rem 0' }}>
      <summary>Sending settings (all events)</summary>
      <form onSubmit={async (e) => {
        e.preventDefault()
        if (problem) return
        await onSave(f)
        setMsg('Saved.')
      }}>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="em-name">Sender name</label>
            <input id="em-name" value={f.fromName} maxLength={60} onChange={(e) => setF({ ...f, fromName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="em-from">From address</label>
            <input id="em-from" type="email" placeholder="tournaments@yourdomain.com" value={f.fromAddress} onChange={(e) => setF({ ...f, fromAddress: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="em-reply">Replies go to</label>
            <input id="em-reply" type="email" value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} />
          </div>
        </div>
        <label className="choice">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          <span>Send confirmation emails<span className="hint">The from address must be on a domain verified with the email service, or messages won't be delivered.</span></span>
        </label>
        {problem && <div className="flag-gap" role="alert">{problem}</div>}
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || !!problem}>Save</button>
          {msg && <span role="status">{msg}</span>}
        </div>
      </form>
    </details>
  )
}
