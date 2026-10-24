import { useState } from 'react'
import { Link } from 'react-router'
import { useApp, usePath } from '../../app/context'
import { useAction } from '../../app/hooks'
import { ErrorNote, Notice, ScopeTabs, useReasonDialog } from '../../components/ui'
import { currentRound, formatTeeTime, isTeamEvent, nameOf, roundGroups } from '../../domain/derive'
import type { Group } from '../../domain/types'
import { useManage } from './ManageLayout'

function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number)
  const total = ((h ?? 0) * 60 + (m ?? 0) + mins) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function Groups() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const p = usePath()
  const { busy, error, run } = useAction()
  const dialog = useReasonDialog()
  const { event } = bundle
  const [roundId, setRoundId] = useState<string | null>(null)
  const round = bundle.rounds.find((r) => r.id === roundId) ?? currentRound(bundle)
  const roundGs = roundGroups(bundle, round.id)
  const prevRound = bundle.rounds.find((r) => r.roundNumber === round.roundNumber - 1)
  const isTeam = isTeamEvent(bundle)
  const shotgun = round.startType === 'shotgun'
  const final = event.status === 'finalized'
  const unit = isTeam ? 'team' : 'player'

  const [size, setSize] = useState(isTeam ? (event.teamSize >= 3 ? 1 : 2) : 4)
  const [first, setFirst] = useState('08:00')
  const [interval, setIntervalMins] = useState(10)
  const [newName, setNewName] = useState('')
  const [newTime, setNewTime] = useState('')
  const [newHole, setNewHole] = useState(1)

  const groups = [...roundGs].sort((a, b) => (shotgun ? a.startingHole - b.startingHole : (a.teeTime ?? '').localeCompare(b.teeTime ?? '')) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const entries = [...bundle.entries].sort((a, b) => nameOf(bundle, a).localeCompare(nameOf(bundle, b)))
  const groupOf = (entryId: string) => roundGs.find((g) => g.entryIds.includes(entryId))
  const unassigned = entries.filter((e) => !groupOf(e.id))

  const generate = () =>
    run(async () => {
      const list = [...unassigned]
      let i = 0
      const existing = roundGs.length
      const holeUse = new Map<number, number>()
      roundGs.forEach((g) => holeUse.set(g.startingHole, (holeUse.get(g.startingHole) ?? 0) + 1))
      while (list.length) {
        const chunk = list.splice(0, size)
        let name: string
        let teeTime: string | null
        let startingHole = 1
        if (shotgun) {
          // fill holes 1..18 once, then second groups (1B, 2B …)
          let hole = 1
          for (let pass = 0; pass < 5; pass++) {
            const h = Array.from({ length: 18 }, (_, k) => k + 1).find((x) => (holeUse.get(x) ?? 0) === pass)
            if (h) { hole = h; break }
          }
          holeUse.set(hole, (holeUse.get(hole) ?? 0) + 1)
          startingHole = hole
          const suffix = holeUse.get(hole)! > 1 ? String.fromCharCode(64 + holeUse.get(hole)!) : 'A'
          name = `Hole ${hole}${suffix}`
          teeTime = first
        } else {
          name = `Group ${existing + i + 1}`
          teeTime = addMinutes(first, (existing + i) * interval)
        }
        let n = 1
        while (roundGs.some((g) => g.name === name)) name = `${name} (${++n})`
        const gid = await repo.createGroup(round.id, event.id, { name, teeTime, startingHole })
        for (const e of chunk) await repo.assignEntry(round.id, event.id, e.id, gid)
        i++
      }
      await reload()
    })

  const copyPrevious = () =>
    run(async () => {
      if (!prevRound) return
      for (const g of roundGroups(bundle, prevRound.id)) {
        let name = g.name
        let n = 1
        while (roundGs.some((x) => x.name === name)) name = `${g.name} (${++n})`
        const gid = await repo.createGroup(round.id, event.id, { name, teeTime: g.teeTime, startingHole: g.startingHole })
        for (const id of g.entryIds) if (!groupOf(id)) await repo.assignEntry(round.id, event.id, id, gid)
      }
      await reload()
    })

  return (
    <>
      {dialog.element}
      <ErrorNote error={error} />
      <ScopeTabs label="Round" options={bundle.rounds.map((r) => ({ scope: r.id, label: `Round ${r.roundNumber}` }))} value={round.id} onChange={setRoundId} />
      {prevRound && roundGs.length === 0 && roundGroups(bundle, prevRound.id).length > 0 && (
        <p>
          <button className="btn" type="button" disabled={busy || final} onClick={() => void copyPrevious()}>Copy round {prevRound.roundNumber} groups</button>{' '}
          <span className="small muted">Same names, times and pairings; adjust afterwards.</span>
        </p>
      )}
      <p>
        {shotgun ? 'Shotgun start: each group begins on its own hole.' : 'Tee times: groups go off in order.'}{' '}
        <Link to={p(`manage/${event.id}/setup`)}>Change start type</Link>
      </p>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="panel">
          <h2>Make groups automatically</h2>
          <p className="small">Puts the {unassigned.length} {unit}{unassigned.length === 1 ? '' : 's'} not yet in a group into new groups, in alphabetical order. You can move anyone afterwards.</p>
          <div className="grid-2" style={{ gap: '0 1rem' }}>
            <div className="field">
              <label htmlFor="g-size">{isTeam ? 'Teams per group' : 'Players per group'}</label>
              <select id="g-size" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {(isTeam ? [1, 2] : [2, 3, 4, 5]).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="g-first">{shotgun ? 'Shotgun time' : 'First tee time'}</label>
              <input id="g-first" type="time" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            {!shotgun && (
              <div className="field">
                <label htmlFor="g-int">Minutes between groups</label>
                <input id="g-int" type="number" min={5} max={30} value={interval} onChange={(e) => setIntervalMins(Number(e.target.value) || 10)} />
              </div>
            )}
          </div>
          <button className="btn primary" type="button" disabled={busy || final || unassigned.length === 0} onClick={() => void generate()}>
            Make {Math.ceil(unassigned.length / size)} group{Math.ceil(unassigned.length / size) === 1 ? '' : 's'}
          </button>
        </section>
        <form className="panel" onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await repo.createGroup(round.id, event.id, { name: newName, teeTime: newTime || null, startingHole: newHole })
            setNewName('')
            await reload()
          })
        }}>
          <h2>Add one group</h2>
          <div className="field"><label htmlFor="ng-name">Name</label><input id="ng-name" type="text" required maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
          <div className="grid-2" style={{ gap: '0 1rem' }}>
            <div className="field"><label htmlFor="ng-time">{shotgun ? 'Start time' : 'Tee time'}</label><input id="ng-time" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} /></div>
            <div className="field"><label htmlFor="ng-hole">Starting hole</label>
              <select id="ng-hole" value={newHole} onChange={(e) => setNewHole(Number(e.target.value))}>{Array.from({ length: 18 }, (_, k) => <option key={k} value={k + 1}>{k + 1}</option>)}</select>
            </div>
          </div>
          <button className="btn" type="submit" disabled={busy || final || !newName.trim()}>Add group</button>
        </form>
      </div>

      {unassigned.length > 0 && roundGs.length > 0 && (
        <Notice kind="warn">{unassigned.length} {unit}{unassigned.length === 1 ? ' is' : 's are'} not in a group: {unassigned.map((e) => nameOf(bundle, e)).join('; ')}</Notice>
      )}

      <section className="panel">
        <h2>Groups{bundle.rounds.length > 1 ? `, round ${round.roundNumber}` : ''}</h2>
        {groups.length === 0 ? <p className="muted">No groups yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Group</th><th scope="col">{shotgun ? 'Hole / time' : 'Tee time / hole'}</th><th scope="col">{isTeam ? 'Teams' : 'Players'}</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRow key={g.id} group={g} disabled={busy || final}
                    members={g.entryIds.map((id) => bundle.entries.find((e) => e.id === id)).filter(Boolean).map((e) => nameOf(bundle, e!))}
                    onSave={(patch) => run(async () => { await repo.updateGroup(g.id, patch); await reload() })}
                    onDelete={async () => {
                      const ok = await dialog.ask({ title: `Delete ${g.name}?`, body: <p>Its {unit}s become unassigned. Scores are not affected.</p>, confirmLabel: 'Delete group', danger: true })
                      if (ok !== null) await run(async () => { await repo.deleteGroup(g.id); await reload() })
                    }} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {roundGs.length > 0 && (
        <section className="panel">
          <h2>Move {unit}s between groups</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{isTeam ? 'Team' : 'Player'}</th><th scope="col">Group</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{nameOf(bundle, e)}</td>
                    <td>
                      <select aria-label={`Group for ${nameOf(bundle, e)}`} value={groupOf(e.id)?.id ?? ''} disabled={busy || final} style={{ maxWidth: 260 }}
                        onChange={(ev) => void run(async () => { await repo.assignEntry(round.id, event.id, e.id, ev.target.value || null); await reload() })}>
                        <option value="">Not in a group</option>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.entryIds.length})</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

function GroupRow(props: { group: Group; members: string[]; disabled: boolean; onSave: (g: { name: string; teeTime: string | null; startingHole: number }) => Promise<unknown>; onDelete: () => void }) {
  const g = props.group
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(g.name)
  const [time, setTime] = useState(g.teeTime ?? '')
  const [hole, setHole] = useState(g.startingHole)
  if (editing)
    return (
      <tr>
        <td colSpan={4}>
          <div className="row">
            <input aria-label="Group name" type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} />
            <input aria-label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 140 }} />
            <label className="row" style={{ margin: 0, fontWeight: 400 }}>Hole
              <select aria-label="Starting hole" value={hole} onChange={(e) => setHole(Number(e.target.value))} style={{ width: 80 }}>
                {Array.from({ length: 18 }, (_, k) => <option key={k} value={k + 1}>{k + 1}</option>)}
              </select>
            </label>
            <button className="btn primary small" type="button" onClick={async () => { await props.onSave({ name, teeTime: time || null, startingHole: hole }); setEditing(false) }}>Save</button>
            <button className="btn quiet small" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </td>
      </tr>
    )
  return (
    <tr>
      <td><strong>{g.name}</strong></td>
      <td className="num" style={{ fontSize: '1.05rem' }}>{formatTeeTime(g.teeTime) || '—'}, hole {g.startingHole}</td>
      <td>{props.members.join('; ') || <span className="muted">Empty</span>}</td>
      <td className="n" style={{ whiteSpace: 'nowrap' }}>
        <button className="btn quiet small" type="button" disabled={props.disabled} onClick={() => setEditing(true)}>Edit</button>
        <button className="btn quiet small" type="button" disabled={props.disabled} onClick={props.onDelete}>Delete</button>
      </td>
    </tr>
  )
}
