import { useState } from 'react'
import { useApp } from '../../app/context'
import { useAction } from '../../app/hooks'
import { EntryStatusControl } from '../../components/EntryStatusControl'
import { ErrorNote, Notice, useReasonDialog } from '../../components/ui'
import { playerName, type Player, type Team } from '../../domain/types'
import { useManage } from './ManageLayout'

export function Teams() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const { busy, error, setError, run } = useAction()
  const dialog = useReasonDialog()
  const [name, setName] = useState('')
  const size = bundle.event.teamSize
  const [picks, setPicks] = useState<string[]>([])
  const final = bundle.event.status === 'finalized'

  if (size < 2)
    return <Notice kind="info">This event is individual stroke play, so it doesn't use teams. Change the event to a team format under Event &amp; course.</Notice>

  const onTeam = new Set(bundle.teams.flatMap((t) => t.playerIds))
  const free = bundle.players.filter((p) => !onTeam.has(p.id)).sort((x, y) => x.lastName.localeCompare(y.lastName))
  const byId = (id: string) => bundle.players.find((p) => p.id === id)
  const teams = [...bundle.teams].sort((x, y) => x.name.localeCompare(y.name))

  const autoPair = () =>
    run(async () => {
      const list = [...free]
      let n = bundle.teams.length + 1
      while (list.length >= size) {
        const members = list.splice(0, size)
        let teamName = defaultTeamName(members)
        if (bundle.teams.some((t) => t.name === teamName)) teamName = `Team ${n}`
        await repo.createTeam(bundle.event.id, teamName, members.map((m) => m.id))
        n++
      }
      await reload()
    })

  return (
    <>
      {dialog.element}
      <ErrorNote error={error} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="panel" onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            const chosen = picks.filter(Boolean)
            await repo.createTeam(bundle.event.id, name || defaultTeamName(chosen.map(byId).filter((x): x is Player => !!x)), chosen)
            setName('')
            setPicks([])
            await reload()
          })
        }}>
          <h2>Create a team</h2>
          {Array.from({ length: size }, (_, i) => (
            <PlayerSelect key={i} id={`t-${i}`} label={`Player ${i + 1}`} players={free} value={picks[i] ?? ''} exclude={picks.filter((_, j) => j !== i)}
              onChange={(v) => setPicks((x) => { const n = [...x]; n[i] = v; return n })} />
          ))}
          <div className="field">
            <label htmlFor="t-name">Team name <span className="hint" style={{ display: 'inline' }}>(optional — defaults to last names)</span></label>
            <input id="t-name" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn primary" type="submit" disabled={busy || final || picks.filter(Boolean).length < 1}>Create team</button>
        </form>
        <section className="panel">
          <h2>Players without a team</h2>
          {free.length === 0 ? <p className="muted">Everyone is on a team.</p> : (
            <>
              <p>{free.map(playerName).join(', ')}</p>
              <button className="btn" type="button" disabled={busy || final || free.length < size} onClick={() => void autoPair()}>
                Make teams of {size} in alphabetical order
              </button>
              {free.length % size !== 0 && <p className="small muted" style={{ marginTop: '.5rem' }}>{free.length % size} player{free.length % size === 1 ? '' : 's'} will be left over.</p>}
            </>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>{teams.length} team{teams.length === 1 ? '' : 's'}</h2>
        {teams.length === 0 ? <p className="muted">No teams yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Team</th><th scope="col">Players</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {teams.map((t) => (
                  <TeamRow key={t.id} team={t} size={size} free={free} byId={byId} disabled={final || busy}
                    onSave={(nm, ids) => run(async () => { await repo.updateTeam(t.id, bundle.event.id, nm, ids); await reload() })}
                    onDelete={async () => {
                      const ok = await dialog.ask({ title: `Delete ${t.name}?`, body: <p>Teams with scores can't be deleted — mark them WD instead.</p>, confirmLabel: 'Delete team', danger: true })
                      if (ok !== null) await run(async () => { await repo.deleteTeam(t.id); await reload() })
                    }}
                    status={(() => {
                      const entry = bundle.entries.find((e) => e.teamId === t.id)
                      return entry ? <EntryStatusControl entry={entry} disabled={final} onDone={() => void reload()} onError={setError} /> : null
                    })()}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

const defaultTeamName = (ps: Player[]) => ps.map((x) => x.lastName).join(' / ') || 'Team'

function PlayerSelect(props: { id: string; label: string; players: Player[]; value: string; exclude?: string[]; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">Choose a player</option>
        {props.players.filter((p) => !props.exclude?.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
      </select>
    </div>
  )
}

function TeamRow(props: {
  team: Team
  size: number
  free: Player[]
  byId: (id: string) => Player | undefined
  disabled: boolean
  status: React.ReactNode
  onSave: (name: string, ids: string[]) => Promise<unknown>
  onDelete: () => void
}) {
  const { team } = props
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(team.name)
  const [ids, setIds] = useState<string[]>(team.playerIds)
  const members = team.playerIds.map(props.byId).filter((p): p is Player => !!p)
  if (editing) {
    const options = [...members, ...props.free]
    return (
      <tr>
        <td colSpan={4}>
          <div className="row">
            <input aria-label="Team name" type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
            {Array.from({ length: props.size }, (_, i) => (
              <select key={i} aria-label={`Player ${i + 1}`} value={ids[i] ?? ''} style={{ width: 200 }}
                onChange={(e) => {
                  const next = [...ids]
                  next[i] = e.target.value
                  setIds(next)
                }}>
                <option value="">None</option>
                {options.filter((p) => p.id === ids[i] || !ids.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
              </select>
            ))}
            <button className="btn primary small" type="button" onClick={async () => { await props.onSave(name, ids.filter(Boolean)); setEditing(false) }}>Save</button>
            <button className="btn quiet small" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </td>
      </tr>
    )
  }
  return (
    <tr>
      <td><strong>{team.name}</strong></td>
      <td>
        {members.map(playerName).join(', ') || <span className="muted">No players</span>}
        {members.length !== props.size && <span className="badge wd" style={{ marginLeft: '.4rem' }}>Needs {props.size} players</span>}
      </td>
      <td>{props.status}</td>
      <td className="n" style={{ whiteSpace: 'nowrap' }}>
        <button className="btn quiet small" type="button" disabled={props.disabled} onClick={() => { setName(team.name); setIds(team.playerIds); setEditing(true) }}>Edit</button>
        <button className="btn quiet small" type="button" disabled={props.disabled} onClick={props.onDelete}>Delete</button>
      </td>
    </tr>
  )
}
