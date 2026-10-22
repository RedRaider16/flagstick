import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { usePath } from '../../app/context'
import { useBundle } from '../../app/hooks'
import { cellKey, useScoreWriter } from '../../app/useScoreWriter'
import { ErrorNote, Loading, Notice, useReasonDialog } from '../../components/ui'
import { buildLeaderboard, groupOfEntry, nameOf } from '../../domain/derive'
import { formatThru, formatToPar } from '../../scoring/leaderboard'
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
  const lb = useMemo(() => (bundle ? buildLeaderboard(bundle) : null), [bundle])

  if (error) return <ErrorNote error={error} />
  if (!bundle || !lb) return <Loading />
  if (bundle.holes.length !== 18) return <Notice kind="warn">Set up the course holes before entering scores.</Notice>

  const final = bundle.round.status === 'finalized'
  const draft = bundle.event.status === 'draft'
  const locked = bundle.round.status === 'locked'
  const rows = lb.rows.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))

  const commit = async (entryId: string, hole: number) => {
    const k = cellKey(entryId, hole)
    const raw = drafts[k]
    if (raw === undefined) return
    const existing = bundle.scores.find((s) => s.entryId === entryId && s.hole === hole)
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
      const r = await dialog.ask({ title: `Correct hole ${hole}?`, body: <p>{nameOf(bundle, bundle.entries.find((e) => e.id === entryId)!)}: {existing?.strokes ?? 'blank'} → {value ?? 'blank'}</p>, label: 'Reason (recorded in the history)', required: true, confirmLabel: 'Save correction' })
      if (r === null) return setDrafts(({ [k]: _drop, ...rest }) => rest)
      reason = r
    }
    await writer.save(entryId, hole, value, reason)
    setDrafts(({ [k]: _drop, ...rest }) => rest)
  }

  const problems = Object.entries(writer.cells).filter(([, c]) => c.kind === 'failed' || c.kind === 'conflict')

  return (
    <>
      {dialog.element}
      {final && <Notice kind="info">Results are final and read-only. Reopen them from Overview to make a correction.</Notice>}
      {draft && <Notice kind="warn">Publish the event before entering scores.</Notice>}
      {locked && <Notice kind="info">The round is locked. Your corrections ask for a reason and are recorded in History.</Notice>}
      {invalid && <Notice kind="error">{invalid}</Notice>}
      {problems.map(([k, c]) => {
        const [entryId, hole] = k.split(':')
        const entry = bundle.entries.find((e) => e.id === entryId)
        return (
          <Notice key={k} kind="error">
            {entry ? nameOf(bundle, entry) : 'Entry'}, hole {hole}: {c.kind === 'conflict' ? `someone else changed it to ${c.current?.strokes ?? 'blank'}. The grid now shows the stored value.` : 'message' in c ? c.message : ''}{' '}
            <button className="btn small" type="button" onClick={() => writer.clearCell(entryId!, Number(hole))}>Dismiss</button>
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
          Scorekeepers use the <Link to={p(`score/${bundle.event.id}`)}>hole-by-hole screen</Link>.
        </p>
      </div>
      <div className="panel" style={{ padding: '.5rem' }}>
        <div className="table-wrap">
          <table className="grid-scores">
            <caption className="sr-only">All scores. Rows are {bundle.round.format === 'scramble_2' ? 'teams' : 'players'}, columns are holes.</caption>
            <thead>
              <tr>
                <th scope="col" className="name">{bundle.round.format === 'scramble_2' ? 'Team' : 'Player'}</th>
                {bundle.holes.map((h) => <th key={h.number} scope="col">{h.number}<div className="small muted">{h.par}</div></th>)}
                <th scope="col">To par</th>
                <th scope="col">Thru</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const entry = bundle.entries.find((e) => e.id === r.entryId)!
                const g = groupOfEntry(bundle.groups, entry.id)
                return (
                  <tr key={r.entryId}>
                    <th scope="row" className="name" style={{ fontWeight: 600 }}>
                      {r.name}
                      <div className="small muted" style={{ fontWeight: 400 }}>{g?.name ?? 'No group'}{r.status !== 'active' ? `, ${r.status.toUpperCase()}` : ''}</div>
                    </th>
                    {bundle.holes.map((h) => {
                      const k = cellKey(r.entryId, h.number)
                      const s = bundle.scores.find((x) => x.entryId === r.entryId && x.hole === h.number)
                      const cell = writer.cells[k]
                      const value = drafts[k] ?? (cell?.kind === 'saving' && cell.value !== null ? String(cell.value) : s ? String(s.strokes) : '')
                      return (
                        <td key={h.number}>
                          <input
                            aria-label={`${r.name}, hole ${h.number}`}
                            inputMode="numeric"
                            value={value}
                            disabled={final || draft || cell?.kind === 'saving'}
                            className={`${drafts[k] !== undefined ? 'dirty' : ''} ${cell?.kind === 'failed' || cell?.kind === 'conflict' ? 'err' : ''}`}
                            style={s && s.strokes < h.par ? { color: 'var(--under)', fontWeight: 700 } : undefined}
                            onChange={(e) => {
                              setInvalid('')
                              setDrafts((d) => ({ ...d, [k]: e.target.value.replace(/\D/g, '').slice(0, 2) }))
                            }}
                            onBlur={() => void commit(r.entryId, h.number)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              if (e.key === 'Escape') setDrafts(({ [k]: _drop, ...rest }) => rest)
                            }}
                          />
                        </td>
                      )
                    })}
                    <td className="num" style={{ fontSize: '1.15rem', color: r.toPar !== null && r.toPar < 0 ? 'var(--under)' : undefined }}>{formatToPar(r.toPar)}</td>
                    <td className="num" style={{ fontSize: '1.15rem' }}>{formatThru(r)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
