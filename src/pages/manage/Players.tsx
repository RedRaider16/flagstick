import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../../app/context'
import { useAction } from '../../app/hooks'
import { CsvImport } from '../../components/CsvImport'
import { EntryStatusControl } from '../../components/EntryStatusControl'
import { ErrorNote, Notice, useReasonDialog } from '../../components/ui'
import type { PlayerInput } from '../../data/repo'
import { formatHandicapIndex, parseHandicapIndex, playerName, type PlayerContact, type PlayerHandicap } from '../../domain/types'
import { parsePlayerCsv, PLAYER_CSV_HEADER, type PlayerImportRow } from '../../scoring/csv'
import { isTeamEvent, teeOf } from '../../domain/derive'
import { useManage } from './ManageLayout'

const empty: PlayerInput = { firstName: '', lastName: '', email: '', phone: '' }

export function Players() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const { busy, error, setError, run } = useAction()
  const dialog = useReasonDialog()
  const [contacts, setContacts] = useState<PlayerContact[]>([])
  const [handicaps, setHandicaps] = useState<PlayerHandicap[]>([])
  const [form, setForm] = useState<PlayerInput>(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState<PlayerInput>(empty)
  const isTeam = isTeamEvent(bundle)
  // Individual events: players may play a different tee than the round's (seniors, ladies).
  const roundTees = new Set(bundle.rounds.map((r) => r.teeId))
  const showTee = !isTeam && bundle.tees.length > 1
  const final = bundle.event.status === 'finalized'

  const loadContacts = useCallback(() => repo.listContacts(bundle.event.id).then(setContacts, () => setContacts([])), [repo, bundle.event.id])
  useEffect(() => void loadContacts(), [loadContacts, bundle])
  const loadHcp = useCallback(() => repo.listHandicaps(bundle.event.id).then(setHandicaps, () => setHandicaps([])), [repo, bundle.event.id])
  useEffect(() => void loadHcp(), [loadHcp, bundle])
  const hcpOf = (id: string) => handicaps.find((h) => h.playerId === id)
  const editHcp = async (pl: { id: string; firstName: string; lastName: string }) => {
    const cur = hcpOf(pl.id)
    const v = await dialog.ask({
      title: `Handicap index for ${pl.firstName} ${pl.lastName}`,
      body: <p>{cur ? `Currently ${formatHandicapIndex(cur.handicapIndex)} (${cur.source}, ${cur.asOf}). ` : ''}Enter the Handicap Index, e.g. 12.4 or +1.2. Leave blank to remove it. This is recorded with today's date and the source "Entered by admin". It is not used in results yet.</p>,
      label: 'Handicap index',
      confirmLabel: 'Save',
    })
    if (v === null) return
    const parsed = parseHandicapIndex(v)
    if (!parsed.ok) return setError(parsed.error)
    await run(async () => {
      await repo.setPlayerHandicap(pl.id, parsed.value, 'Entered by admin', new Date().toISOString().slice(0, 10))
      await loadHcp()
    })
  }

  const players = [...bundle.players].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
  const contactOf = (id: string) => contacts.find((c) => c.playerId === id)
  const teamOf = (id: string) => bundle.teams.find((t) => t.playerIds.includes(id))
  const entryOf = (id: string) => bundle.entries.find((e) => e.playerId === id)

  const importRows = async (rows: PlayerImportRow[]) => {
    const created: { id: string; team: string }[] = []
    for (const r of rows) {
      const id = await repo.addPlayer(bundle.event.id, { firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone })
      created.push({ id, team: r.team })
    }
    if (isTeam) {
      const byTeam = new Map<string, string[]>()
      created.filter((c) => c.team).forEach((c) => byTeam.set(c.team, [...(byTeam.get(c.team) ?? []), c.id]))
      for (const [name, ids] of byTeam) {
        const existing = bundle.teams.find((t) => t.name.toLowerCase() === name.toLowerCase())
        if (existing) await repo.updateTeam(existing.id, bundle.event.id, existing.name, [...existing.playerIds, ...ids])
        else await repo.createTeam(bundle.event.id, name, ids)
      }
    }
    await reload()
  }

  return (
    <>
      {dialog.element}
      <ErrorNote error={error} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="panel" onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await repo.addPlayer(bundle.event.id, form)
            setForm(empty)
            await reload()
            document.getElementById('p-first')?.focus()
          })
        }}>
          <h2>Add a player</h2>
          <div className="grid-2" style={{ gap: '0 1rem' }}>
            <div className="field"><label htmlFor="p-first">First name</label><input id="p-first" type="text" required maxLength={60} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
            <div className="field"><label htmlFor="p-last">Last name</label><input id="p-last" type="text" required maxLength={60} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
            <div className="field"><label htmlFor="p-email">Email <span className="hint" style={{ display: 'inline' }}>(optional, private)</span></label><input id="p-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="p-phone">Phone <span className="hint" style={{ display: 'inline' }}>(optional, private)</span></label><input id="p-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <button className="btn primary" type="submit" disabled={busy || final || !form.firstName.trim() || !form.lastName.trim()}>Add player</button>
          <p className="small muted" style={{ marginTop: '.6rem' }}>Email and phone are visible only to this event's admins. Spectators see names only.</p>
        </form>
        <section className="panel">
          <h2>Import players from CSV</h2>
          <CsvImport<PlayerImportRow>
            id="players"
            header={PLAYER_CSV_HEADER}
            example={isTeam ? 'Ava,Stone,ava@example.com,,Eagles' : 'Ava,Stone,ava@example.com,,'}
            parse={(t) => parsePlayerCsv(t, bundle.players.map(playerName))}
            columns={[
              { label: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
              { label: 'Email', render: (r) => r.email },
              ...(isTeam ? [{ label: 'Team', render: (r: PlayerImportRow) => r.team }] : []),
            ]}
            importLabel="Import players"
            onImport={importRows}
          />
          {isTeam && <p className="small muted">The team column groups players into teams of {bundle.event.teamSize}. Leave it blank to pair players later.</p>}
        </section>
      </div>

      <section className="panel">
        <h2>{players.length} player{players.length === 1 ? '' : 's'}</h2>
        {players.length === 0 ? <p className="muted">No players yet. Add them above or import a CSV.</p> : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Players</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col" className="n">HI</th>
                  {showTee && <th scope="col">Tee</th>}
                  {isTeam ? <th scope="col">Team</th> : <th scope="col">Status</th>}
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {players.map((pl) => {
                  const c = contactOf(pl.id)
                  const entry = entryOf(pl.id)
                  if (editing === pl.id)
                    return (
                      <tr key={pl.id}>
                        <td colSpan={showTee ? 7 : 6}>
                          <form className="row" onSubmit={(e) => {
                            e.preventDefault()
                            void run(async () => {
                              await repo.updatePlayer(pl.id, bundle.event.id, edit)
                              setEditing(null)
                              await reload()
                            })
                          }}>
                            <input aria-label="First name" type="text" value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} style={{ width: 130 }} />
                            <input aria-label="Last name" type="text" value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} style={{ width: 130 }} />
                            <input aria-label="Email" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} style={{ width: 200 }} />
                            <input aria-label="Phone" type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} style={{ width: 140 }} />
                            <button className="btn primary small" type="submit" disabled={busy}>Save</button>
                            <button className="btn quiet small" type="button" onClick={() => setEditing(null)}>Cancel</button>
                          </form>
                        </td>
                      </tr>
                    )
                  return (
                    <tr key={pl.id}>
                      <td><strong>{playerName(pl)}</strong></td>
                      <td className="small">{c?.email || <span className="muted">—</span>}</td>
                      <td className="small">{c?.phone || <span className="muted">—</span>}</td>
                      <td className="n">
                        <button type="button" className="btn quiet small" disabled={final} onClick={() => void editHcp(pl)}
                          title={hcpOf(pl.id) ? `${hcpOf(pl.id)!.source}, ${hcpOf(pl.id)!.asOf}` : 'Add handicap index'}
                          aria-label={`Handicap index for ${playerName(pl)}: ${formatHandicapIndex(hcpOf(pl.id)?.handicapIndex) || 'none'}. Edit`}>
                          {formatHandicapIndex(hcpOf(pl.id)?.handicapIndex) || '+ Add'}
                        </button>
                      </td>
                      {showTee && (
                        <td>
                          <select aria-label={`Tee for ${playerName(pl)}`} value={pl.teeId ?? ''} disabled={final || busy} style={{ width: 'auto', minHeight: 36 }}
                            onChange={(e) => void run(async () => { await repo.setPlayerTee(pl.id, e.target.value || null); await reload() })}>
                            <option value="">Round tee{roundTees.size === 1 && teeOf(bundle, [...roundTees][0]) ? ` (${teeOf(bundle, [...roundTees][0])!.name})` : ''}</option>
                            {bundle.tees.filter((t) => !roundTees.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </td>
                      )}
                      {isTeam ? (
                        <td>{teamOf(pl.id)?.name ?? <span className="muted">No team</span>}</td>
                      ) : (
                        <td>{entry && <EntryStatusControl entry={entry} disabled={final} onDone={() => void reload()} onError={setError} />}</td>
                      )}
                      <td className="n" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn quiet small" type="button" disabled={final} onClick={() => {
                          setEditing(pl.id)
                          setEdit({ firstName: pl.firstName, lastName: pl.lastName, email: c?.email ?? '', phone: c?.phone ?? '' })
                        }}>Edit</button>
                        <button className="btn quiet small" type="button" disabled={final} onClick={async () => {
                          const ok = await dialog.ask({ title: `Remove ${playerName(pl)}?`, body: <p>Players with scores can't be removed — mark them WD instead.</p>, confirmLabel: 'Remove player', danger: true })
                          if (ok !== null) await run(async () => { await repo.removePlayer(pl.id); await reload() })
                        }}>Remove</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {isTeam && bundle.players.some((pl) => !teamOf(pl.id)) && (
          <Notice kind="info">Some players aren't on a team yet. Pair them on the Teams tab.</Notice>
        )}
      </section>
    </>
  )
}
