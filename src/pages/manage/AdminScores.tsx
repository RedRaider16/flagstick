import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { usePath } from '../../app/context'
import { useBundle } from '../../app/hooks'
import { cellKey, parseCellKey, useScoreWriter } from '../../app/useScoreWriter'
import { ErrorNote, Loading, Notice, ScopeTabs, useReasonDialog } from '../../components/ui'
import type { ScoreSlot } from '../../data/repo'
import { buildEventLeaderboard, currentRound, entryPlayers, groupOfEntry, hasPlayerHoles, isTeamEvent, nameOf, roundGroups, roundHoles, slotScore } from '../../domain/derive'
import { playerName } from '../../domain/types'
import { isPlayerHole } from '../../scoring/formats'
import { formatToPar } from '../../scoring/leaderboard'
import { parseStrokes } from '../../scoring/validation'
import { useManage } from './ManageLayout'

/** Admin grid: every entry × every hole. Used for checking cards and making corrections. */
export function AdminScores() {
  const { bundle: outer } = useManage()
  const p = usePath()
  // Own copy so local saves show immediately; realtime keeps it fresh.
  const { bundle, setBundle, error } = useBundle(outer.event.id)
  const writer = useScoreWriter(bundle, setBundle)
  const dialog = useReasonDialog()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')
  const [invalid, setInvalid] = useState('')
  const [roundId, setRoundId] = useState<string | null>(null)
  const round = bundle ? bundle.rounds.find((r) => r.id === roundId) ?? currentRound(bundle) : null
  const lb = useMemo(() => (bundle && round ? buildEventLeaderboard(bundle, round.id) : null), [bundle, round])

  if (error) return <ErrorNote error={error} />
  if (!bundle || !lb || !round) return <Loading />
  const holes = roundHoles(bundle, round)
  if (holes.length !== 18) return <Notice kind="warn">Choose a tee with all 18 holes set up for this round before entering scores.</Notice>

  const final = round.status === 'finalized'
  const draft = bundle.event.status === 'draft' || bundle.event.isTemplate
  const locked = round.status === 'locked'
  const isTeam = isTeamEvent(bundle)
  const perPlayer = isTeam && hasPlayerHoles(round)
  const rows = lb.groups.flatMap((g) => g.rows).filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))

  const commit = async (slot: ScoreSlot) => {
    const { entryId, hole } = slot
    const k = cellKey(slot)
    const raw = drafts[k]
    if (raw === undefined) return
    const existing = slotScore(bundle, slot.roundId, entryId, slot.playerId, hole)
    if (raw.trim() === '' && !existing) {
      setDrafts(({ [k]: _drop, ...rest }) => rest)
      return
    }
    let value: number | null = null
    if (raw.trim() !== '') {
      const v = parseStrokes(raw)
      if (!v.ok) {
        setInvalid(`Hole ${hole}: ${v.error}`)
        return
      }
      value = v.value
    }
    if (existing && existing.strokes === value) {
      setDrafts(({ [k]: _drop, ...rest }) => rest)
      return
    }
    let reason = ''
    if (locked) {
      const r = await dialog.ask({ title: `Correct hole ${hole}?`, body: <p>{slotLabel(slot)}: {existing?.strokes ?? 'blank'} → {value ?? 'blank'}</p>, label: 'Reason (recorded in the history)', required: true, confirmLabel: 'Save correction' })
      if (r === null) return setDrafts(({ [k]: _drop, ...rest }) => rest)
      reason = r
    }
    await writer.save(slot, value, reason)
    setDrafts(({ [k]: _drop, ...rest }) => rest)
  }

  function slotLabel(slot: ScoreSlot) {
    const entry = bundle!.entries.find((e) => e.id === slot.entryId)
    const pl = slot.playerId ? bundle!.players.find((x) => x.id === slot.playerId) : null
    return `${entry ? nameOf(bundle!, entry) : 'Entry'}${pl ? ` (${playerName(pl)})` : ''}`
  }
  const problems = Object.entries(writer.cells).filter(([, c]) => c.kind === 'failed' || c.kind === 'conflict')

  return (
    <>
      {dialog.element}
      <ScopeTabs label="Round" options={bundle.rounds.map((r) => ({ scope: r.id, label: `Round ${r.roundNumber}` }))} value={round.id} onChange={(v) => { setRoundId(v); setDrafts({}) }} />
      {final && <Notice kind="info">Results are final and read-only. Reopen them from Overview to make a correction.</Notice>}
      {draft && <Notice kind="warn">Publish the event before entering scores.</Notice>}
      {locked && <Notice kind="info">The round is locked. Your corrections ask for a reason and are recorded in History.</Notice>}
      {invalid && <Notice kind="error">{invalid}</Notice>}
      {problems.map(([k, c]) => {
        const slot = parseCellKey(k)
        return (
          <Notice key={k} kind="error">
            {slotLabel(slot)}, hole {slot.hole}: {c.kind === 'conflict' ? `someone else changed it to ${c.current?.strokes ?? 'blank'}. The grid now shows the stored value.` : 'message' in c ? c.message : ''}{' '}
            <button className="btn small" type="button" onClick={() => writer.clearCell(slot)}>Dismiss</button>
          </Notice>
        )
      })}
      <div className="split" style={{ marginBottom: '.75rem' }}>
        <div className="field" style={{ margin: 0, minWidth: 240 }}>
          <label htmlFor="flt">Find</label>
          <input id="flt" type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name" />
        </div>
        <p className="small muted" style={{ margin: 0, maxWidth: '46ch' }}>
          Type a score and press Enter or Tab to save. Delete the number to clear a hole. Blank cells are missing scores, not zeros.
          {perPlayer && ' On best-ball holes enter each player\'s score on their own line; the team line shows what counts.'}
          Scorekeepers use the <Link to={p(`score/${bundle.event.id}`)}>hole-by-hole screen</Link>.
        </p>
      </div>
      <div className="panel" style={{ padding: '.5rem' }}>
        <div className="table-wrap">
          <table className="grid-scores">
            <caption className="sr-only">All scores for round {round.roundNumber}. Rows are {isTeam ? 'teams' : 'players'}, columns are holes.</caption>
            <thead>
              <tr>
                <th scope="col" className="name">{isTeam ? 'Team' : 'Player'}</th>
                {holes.map((h) => <th key={h.number} scope="col">{h.number}<div className="small muted">{h.par}</div></th>)}
                <th scope="col">To par</th>
                <th scope="col">Thru</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const entry = bundle.entries.find((e) => e.id === r.entryId)!
                const g = groupOfEntry(roundGroups(bundle, round.id), entry.id, round.id)
                const cell0 = r.rounds[0]
                const lines: { playerId: string | null; label: string }[] = [
                  { playerId: null, label: r.name },
                  ...(perPlayer ? entryPlayers(bundle, entry).map((pl) => ({ playerId: pl.id, label: playerName(pl) })) : []),
                ]
                return lines.map((ln, li) => (
                  <tr key={`${r.entryId}-${ln.playerId ?? 'e'}`} className={li > 0 ? 'sub-line' : undefined}>
                    <th scope="row" className="name" style={{ fontWeight: li === 0 ? 600 : 400 }}>
                      {li === 0 ? ln.label : <span style={{ paddingLeft: '.8rem' }}>{ln.label}</span>}
                      {li === 0 && <div className="small muted" style={{ fontWeight: 400 }}>{g?.name ?? 'No group'}{r.status !== 'active' ? `, ${r.status.toUpperCase()}` : ''}</div>}
                    </th>
                    {holes.map((h) => {
                      const playerHole = isPlayerHole(round.segments, h.number)
                      if (playerHole !== (ln.playerId !== null)) {
                        // Team line on a best-ball hole: show what counts (read-only). Player line elsewhere: n/a.
                        const v = ln.playerId === null ? cell0?.holeScores.get(h.number) : undefined
                        return <td key={h.number} className="num muted" style={{ textAlign: 'center' }}>{v ?? ''}</td>
                      }
                      const slot: ScoreSlot = { roundId: round.id, entryId: r.entryId, playerId: ln.playerId, hole: h.number }
                      const k = cellKey(slot)
                      const s = slotScore(bundle, round.id, r.entryId, ln.playerId, h.number)
                      const cell = writer.cells[k]
                      const value = drafts[k] ?? ((cell?.kind === 'saving' || cell?.kind === 'queued') && cell.value !== null ? String(cell.value) : s ? String(s.strokes) : '')
                      return (
                        <td key={h.number}>
                          <input
                            aria-label={`${ln.label}, hole ${h.number}`}
                            inputMode="numeric"
                            value={value}
                            disabled={final || draft || cell?.kind === 'saving'}
                            className={`${drafts[k] !== undefined ? 'dirty' : ''} ${cell?.kind === 'failed' || cell?.kind === 'conflict' ? 'err' : ''}`}
                            style={s && s.strokes < h.par ? { color: 'var(--under)', fontWeight: 700 } : undefined}
                            onChange={(e) => {
                              setInvalid('')
                              setDrafts((d) => ({ ...d, [k]: e.target.value.replace(/\D/g, '').slice(0, 2) }))
                            }}
                            onBlur={() => void commit(slot)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              if (e.key === 'Escape') setDrafts(({ [k]: _drop, ...rest }) => rest)
                            }}
                          />
                        </td>
                      )
                    })}
                    <td className="num" style={{ fontSize: '1.15rem', color: li === 0 && cell0?.toPar != null && cell0.toPar < 0 ? 'var(--under)' : undefined }}>{li === 0 && cell0?.holesPlayed ? formatToPar(cell0.toPar) : ''}</td>
                    <td className="num" style={{ fontSize: '1.15rem' }}>{li === 0 ? (cell0?.complete ? 'F' : cell0?.holesPlayed || '—') : ''}</td>
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
