import { useEffect, useState } from 'react'
import { useApp } from '../../app/context'
import { ErrorNote, Loading } from '../../components/ui'
import { errorMessage } from '../../data/errors'
import { formatStamp, nameOf } from '../../domain/derive'
import type { EventLogEntry, ScoreAudit } from '../../domain/types'
import { useManage } from './ManageLayout'

const ACTION_LABEL: Record<string, string> = {
  event_created: 'Event created',
  round_locked: 'Round locked',
  round_unlocked: 'Round unlocked',
  finalized: 'Results finalized',
  reopened: 'Final results reopened',
}
function describe(a: string): string {
  if (ACTION_LABEL[a]) return ACTION_LABEL[a]!
  const m = /^status:(\w+)->(\w+)$/.exec(a)
  if (m) return `Status: ${m[1]!.replace('_', ' ')} → ${m[2]!.replace('_', ' ')}`
  const e = /^entry_status:(\w+)->(\w+)$/.exec(a)
  if (e) return `Entry: ${e[1]!.toUpperCase()} → ${e[2]!.toUpperCase()}`
  return a
}

export function History() {
  const { bundle } = useManage()
  const { repo } = useApp()
  const [audit, setAudit] = useState<ScoreAudit[] | null>(null)
  const [log, setLog] = useState<EventLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyCorrections, setOnlyCorrections] = useState(false)

  useEffect(() => {
    Promise.all([repo.listAudit(bundle.event.id), repo.listEventLog(bundle.event.id)]).then(([a, l]) => {
      setAudit(a)
      setLog(l)
    }, (e) => setError(errorMessage(e)))
  }, [repo, bundle])

  const entryLabel = (id: string) => {
    const e = bundle.entries.find((x) => x.id === id)
    return e ? nameOf(bundle, e) : 'Removed entry'
  }
  const tz = bundle.event.timezone
  const shown = (audit ?? []).filter((a) => !onlyCorrections || a.action !== 'insert')

  return (
    <>
      <ErrorNote error={error} />
      <section className="panel">
        <h2>Event activity</h2>
        {!log ? <Loading /> : log.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Note</th><th scope="col">Who</th></tr></thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{formatStamp(l.at, tz)}</td>
                    <td>{describe(l.action)}</td>
                    <td className="small">{l.action.startsWith('entry_status') ? `${entryLabel(l.detail.split(' ')[0] ?? '')} ${l.detail.split(' ').slice(1).join(' ')}` : l.detail}</td>
                    <td className="small">{l.actorLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="split">
          <h2>Score history</h2>
          <label className="choice"><input type="checkbox" checked={onlyCorrections} onChange={(e) => setOnlyCorrections(e.target.checked)} /> <span>Only changes and deletions</span></label>
        </div>
        {!audit ? <Loading /> : shown.length === 0 ? <p className="muted">No score changes yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">When</th><th scope="col">{bundle.round.format === 'scramble_2' ? 'Team' : 'Player'}</th><th scope="col" className="n">Hole</th><th scope="col">Change</th><th scope="col">Reason</th><th scope="col">Who</th></tr></thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id}>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{formatStamp(a.changedAt, tz)}</td>
                    <td>{entryLabel(a.entryId)}</td>
                    <td className="n num" style={{ fontSize: '1.05rem' }}>{a.hole}</td>
                    <td>
                      {a.action === 'insert' && <>Entered <strong>{a.newStrokes}</strong></>}
                      {a.action === 'update' && <>Changed {a.oldStrokes} → <strong>{a.newStrokes}</strong></>}
                      {a.action === 'delete' && <>Cleared (was {a.oldStrokes})</>}
                    </td>
                    <td className="small">{a.reason || <span className="muted">—</span>}</td>
                    <td className="small">{a.changedByLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
