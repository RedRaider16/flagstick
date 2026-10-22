import { Fragment, useState } from 'react'
import type { Hole } from '../domain/types'
import { TIEBREAK_LABEL } from '../domain/types'
import { formatThru, formatToPar, type Leaderboard as LB, type LbRow } from '../scoring/leaderboard'

export function Leaderboard(props: {
  lb: LB
  holes: Hole[]
  title: string
  isTeam: boolean
  live?: boolean
  showGaps?: boolean
}) {
  const { lb, holes } = props
  const [open, setOpen] = useState<string | null>(null)
  const ranked = lb.rows.filter((r) => r.holesPlayed > 0 || r.status !== 'active').length

  return (
    <section className="board" aria-label={props.title}>
      <div className="board-head">
        <h2>{props.title}</h2>
        <span className={`badge ${lb.final ? 'final' : 'provisional'}`}>{lb.final ? 'Final results' : 'Provisional'}</span>
        <span className="spacer" />
        {props.live && !lb.final && <span className="live-dot">Live</span>}
      </div>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">
            {props.title}. {lb.final ? 'Final results.' : 'Provisional results; scores may change.'} Select a row to see the hole-by-hole card.
          </caption>
          <thead>
            <tr>
              <th scope="col">Pos</th>
              <th scope="col">{props.isTeam ? 'Team' : 'Player'}</th>
              <th scope="col" className="n">To par</th>
              <th scope="col" className="n">Thru</th>
              <th scope="col" className="n gross">Gross</th>
            </tr>
          </thead>
          <tbody>
            {lb.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">No {props.isTeam ? 'teams' : 'players'} yet.</td>
              </tr>
            )}
            {lb.rows.map((r) => (
              <Fragment key={r.entryId}>
                <tr
                  className={`row-btn ${r.status !== 'active' ? 'out' : ''}`}
                  onClick={() => setOpen(open === r.entryId ? null : r.entryId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setOpen(open === r.entryId ? null : r.entryId)
                    }
                  }}
                  tabIndex={0}
                  aria-expanded={open === r.entryId}
                >
                  <td className="pos">{r.positionLabel}</td>
                  <td className="who">
                    {r.name}
                    {r.tiebreakNote && <small>{r.tiebreakNote}</small>}
                    {props.showGaps && r.gaps.length > 0 && <small className="flag-gap">Missing hole {r.gaps.join(', ')}</small>}
                  </td>
                  <td className={`topar ${r.toPar !== null && r.toPar < 0 && r.status === 'active' ? 'under' : ''}`}>
                    {r.status === 'dq' ? '—' : formatToPar(r.toPar)}
                  </td>
                  <td className="thru">{formatThru(r)}</td>
                  <td className="gross">{r.gross ?? '—'}</td>
                </tr>
                {open === r.entryId && (
                  <tr>
                    <td colSpan={5} style={{ background: '#fafbfa' }}>
                      <HoleStrip row={r} holes={holes} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="board-foot">
        <div>
          Tie-break: {TIEBREAK_LABEL[lb.tiebreak]}.
          {lb.unresolvedTies.length > 0 && ' Some ties could not be separated and stand as ties.'}
        </div>
        <div>
          Thru shows holes completed; F = finished; * = started on a hole other than 1. {ranked === 0 && 'No scores yet.'}
        </div>
      </div>
    </section>
  )
}

export function HoleStrip({ row, holes }: { row: LbRow; holes: Hole[] }) {
  const half = (from: number) => {
    const hs = holes.filter((h) => h.number >= from && h.number < from + 9)
    let tot = 0
    let count = 0
    return (
      <div className="card-strip" role="table" aria-label={from === 1 ? 'Front nine' : 'Back nine'}>
        <div role="row" style={{ display: 'contents' }}>
          {hs.map((h) => (
            <div key={h.number} className="h" role="columnheader">{h.number}</div>
          ))}
          <div className="h tot" role="columnheader">{from === 1 ? 'Out' : 'In'}</div>
        </div>
        <div role="row" style={{ display: 'contents' }}>
          {hs.map((h) => (
            <div key={h.number} className="p" role="cell">{h.par}</div>
          ))}
          <div className="p tot" role="cell">{hs.reduce((s, h) => s + h.par, 0)}</div>
        </div>
        <div role="row" style={{ display: 'contents' }}>
          {hs.map((h) => {
            const v = row.holeScores.get(h.number)
            if (v !== undefined) {
              tot += v
              count++
            }
            return (
              <div key={h.number} role="cell" className={v === undefined ? 'sc-missing' : v < h.par ? 'sc-under' : ''}>
                {v ?? '·'}
                {v === undefined && <span className="sr-only">no score</span>}
              </div>
            )
          })}
          <div className="tot" role="cell">{count ? tot : '—'}</div>
        </div>
      </div>
    )
  }
  if (!holes.length) return <p className="muted">The course layout isn't set up yet.</p>
  return (
    <div>
      {half(1)}
      {half(10)}
    </div>
  )
}
