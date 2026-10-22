import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../../app/context'
import { useAction } from '../../app/hooks'
import { ErrorNote, Loading, Notice } from '../../components/ui'
import type { StaffMember, StaffRole } from '../../domain/types'
import { useManage } from './ManageLayout'

export function Staff() {
  const { bundle } = useManage()
  const { repo, user } = useApp()
  const { busy, error, run } = useAction()
  const [staff, setStaff] = useState<StaffMember[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('scorekeeper')
  const groups = [...bundle.groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  const load = useCallback(() => repo.listStaff(bundle.event.id).then(setStaff), [repo, bundle.event.id])
  useEffect(() => void load(), [load])

  const toggle = (s: StaffMember, gid: string) =>
    run(async () => {
      const next = s.groupIds.includes(gid) ? s.groupIds.filter((x) => x !== gid) : [...s.groupIds, gid]
      await repo.setStaffGroups(s.id, bundle.event.id, next)
      await load()
    })

  return (
    <>
      <ErrorNote error={error} />
      {repo.mode === 'demo' && (
        <Notice kind="info">In the demo, "View as Scorekeeper" uses the first scorekeeper below. In live mode, each person signs in with their own email.</Notice>
      )}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="panel" onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await repo.inviteStaff(bundle.event.id, email, role)
            setEmail('')
            await load()
          })
        }}>
          <h2>Add a scorekeeper or admin</h2>
          <div className="field">
            <label htmlFor="sf-email">Their email address</label>
            <input id="sf-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <fieldset>
            <legend>Role</legend>
            <label className="choice"><input type="radio" name="role" checked={role === 'scorekeeper'} onChange={() => setRole('scorekeeper')} />
              <span>Scorekeeper<span className="hint">Enters scores only for the groups you tick below.</span></span></label>
            <label className="choice"><input type="radio" name="role" checked={role === 'admin'} onChange={() => setRole('admin')} />
              <span>Administrator<span className="hint">Full control of this event, including corrections and final results.</span></span></label>
          </fieldset>
          <button className="btn primary" type="submit" disabled={busy || !email.includes('@')}>Add</button>
        </form>
        <section className="panel">
          <h2>How scorekeepers get in</h2>
          <ol className="small" style={{ paddingLeft: '1.1rem', margin: 0 }}>
            <li>Add their email here and tick their group(s).</li>
            <li>Send them this site's link. They choose Sign in and use that same email.</li>
            <li>After signing in they see this event under "Your events" and can score only their groups.</li>
          </ol>
          <p className="small muted" style={{ marginTop: '.6rem' }}>The event code alone never lets anyone enter scores.</p>
        </section>
      </div>
      <section className="panel">
        <h2>Staff</h2>
        {!staff ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Signed in</th><th scope="col">Groups they can score</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td>{s.email}</td>
                    <td>{s.role === 'admin' ? 'Administrator' : 'Scorekeeper'}</td>
                    <td>{s.userId ? 'Yes' : <span className="muted">Not yet</span>}</td>
                    <td>
                      {s.role === 'admin' ? <span className="muted">All groups</span> : groups.length === 0 ? <span className="muted">Create groups first</span> : (
                        <div className="row" style={{ gap: '.2rem .8rem' }}>
                          {groups.map((g) => (
                            <label key={g.id} className="choice" style={{ padding: 0 }}>
                              <input type="checkbox" checked={s.groupIds.includes(g.id)} disabled={busy} onChange={() => void toggle(s, g.id)} />
                              <span>{g.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="n">
                      {!(s.role === 'admin' && s.userId === user?.id) && (
                        <button className="btn quiet small" type="button" disabled={busy} onClick={() => void run(async () => { await repo.removeStaff(s.id); await load() })}>Remove</button>
                      )}
                    </td>
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
