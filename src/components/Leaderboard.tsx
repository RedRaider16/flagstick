import { Fragment, useState } from 'react'
import { formatMoney, TIEBREAK_LABEL } from '../domain/types'
import type { EventLeaderboard, EvRow } from '../scoring/event'
import { formatToPar } from '../scoring/leaderboard'

export interface BoardRound {
  id: string
  label: string
  /** Par for the counting score (best 2 balls on a par 4 = 8). */
  holes: { number: number; par: number }[]
}

/** Player lines under a team's card (best-ball holes). */
export type CardDetail = (entryId: string, roundId: string) => { name: string; scores: Map<number, number> }[]

export function Leaderboard(props: {
  lb: EventLeaderboard
  rounds: BoardRound[]
  title: string
  isTeam: boolean
  live?: boolean
  showGaps?: boolean
  detail?: CardDetail
  /** Place money by entry (cents); shows a Payout column when non-empty. */
  payouts?: Map<string, number>
  /** Extra footer line, e.g. the net allowances used. */
  footnote?: string
}) {
  const { lb, rounds } = props
  const [open, setOpen] = useState<string | null>(null)
  const multi = rounds.length > 1
  const pay = props.payouts && props.payouts.size > 0 ? props.payouts : null
  const cols = 5 + (multi ? rounds.length : 0) + (pay ? 1 : 0)
  const rows = lb.groups.flatMap((g) => g.rows)
  const anyScores = rows.some((r) => r.holesPlayed > 0 || r.status !== 'active')
  const split = lb.groups.length > 1 || lb.groups.some((g) => g.name)

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
            {props.title}. {lb.final ? 'Final results.' : 'Provisional results; scores may change.'}
            {split ? ' Positions are ranked within each flight.' : ''} Select a row to see the hole-by-hole card.
          </caption>
          <thead>
            <tr>
              <th scope="col">Pos</th>
              <th scope="col">{props.isTeam ? 'Team' : 'Player'}</th>
              <th scope="col" className="n">To par</th>
              <th scope="col" className="n">Thru</th>
              {multi && rounds.map((r) => <th key={r.id} scope="col" className="n gross">{r.label.replace('Round ', 'R')}</th>)}
              <th scope="col" className="n gross">{multi ? 'Total' : 'Score'}</th>
              {pay && <th scope="col" className="n">{lb.final ? 'Payout' : 'Projected'}</th>}
            </tr>
          </thead>
          {rows.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={cols} className="muted">No {props.isTeam ? 'teams' : 'players'} yet.</td>
              </tr>
            </tbody>
          )}
          {lb.groups.map((g) => (
            <tbody key={g.flightId ?? g.name}>
              {split && g.rows.length > 0 && (
                <tr className="flight-row">
                  <th colSpan={cols} scope="colgroup">{g.name}</th>
                </tr>
              )}
              {g.rows.map((r) => (
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
                      {r.note && <small className="flag-gap">Not ranked: {r.note}</small>}
                      {props.showGaps && r.rounds.some((c) => c.gaps.length > 0) && (
                        <small className="flag-gap">
                          Missing {r.rounds.map((c, i) => (c.gaps.length ? `${multi ? `R${i + 1} ` : ''}hole ${c.gaps.join(', ')}` : '')).filter(Boolean).join('; ')}
                        </small>
                      )}
                    </td>
                    <td className={`topar ${r.toPar !== null && r.toPar < 0 && r.status === 'active' ? 'under' : ''}`}>
                      {r.status === 'active' ? formatToPar(r.toPar) : '—'}
                    </td>
                    <td className="thru">{r.status === 'active' ? r.thru : ''}</td>
                    {multi && r.rounds.map((c) => <td key={c.roundId} className="gross">{c.complete ? c.gross : c.holesPlayed ? <span className="muted">{c.gross}</span> : '—'}</td>)}
                    <td className="gross">{r.gross ?? '—'}</td>
                    {pay && <td className="n num">{pay.has(r.entryId) ? formatMoney(pay.get(r.entryId)) : ''}</td>}
                  </tr>
                  {open === r.entryId && (
                    <tr>
                      <td colSpan={cols} style={{ background: 'var(--page)' }}>
                        {rounds.map((rd, i) => (
                          <div key={rd.id}>
                            {multi && <div className="small" style={{ fontWeight: 600, margin: '.3rem 0' }}>{rd.label}</div>}
                            <HoleStrip row={r} roundIndex={i} holes={rd.holes} players={nonEmpty(props.detail?.(r.entryId, rd.id))} />
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="board-foot">
        <div>
          Tie-break: {TIEBREAK_LABEL[lb.tiebreak]}.
          {lb.groups.some((g) => g.unresolvedTies.length > 0) && ' Some ties could not be separated and stand as ties.'}
        </div>
        <div>
          Thru shows holes completed; F = finished; * = started on a hole other than 1. WD, DQ, DNF and NS are unranked.
          {props.footnote && <> {props.footnote}</>}
          {pay && !lb.final && ' Projected payouts follow the current standings; ties share the places they cover.'}
          {!anyScores && ' No scores yet.'}
        </div>
      </div>
    </section>
  )
}

const nonEmpty = <T,>(xs: T[] | undefined) => (xs && xs.length ? xs : undefined)

export function HoleStrip({ row, roundIndex = 0, holes, players }: {
  row: EvRow
  roundIndex?: number
  holes: { number: number; par: number }[]
  players?: { name: string; scores: Map<number, number> }[]
}) {
  const card = row.rounds[roundIndex]?.holeScores ?? new Map<number, number>()
  const half = (from: number) => {
    const hs = holes.filter((h) => h.number >= from && h.number < from + 9)
    const line = (label: string, get: (n: number) => number | undefined, cls: (v: number, par: number) => string, key: string) => {
      let tot = 0
      let count = 0
      return (
        <div role="row" style={{ display: 'contents' }} key={key}>
          {players && <div className="nm" role="rowheader">{label}</div>}
          {hs.map((h) => {
            const v = get(h.number)
            if (v !== undefined) {
              tot += v
              count++
            }
            return (
              <div key={h.number} role="cell" className={v === undefined ? 'sc-missing' : cls(v, h.par)}>
                {v ?? '·'}
                {v === undefined && <span className="sr-only">no score</span>}
              </div>
            )
          })}
          <div className="tot" role="cell">{count ? tot : '—'}</div>
        </div>
      )
    }
    return (
      <div className={`card-strip ${players ? 'with-names' : ''}`} role="table" aria-label={from === 1 ? 'Front nine' : 'Back nine'}>
        <div role="row" style={{ display: 'contents' }}>
          {players && <div className="h nm" role="columnheader">Hole</div>}
          {hs.map((h) => <div key={h.number} className="h" role="columnheader">{h.number}</div>)}
          <div className="h tot" role="columnheader">{from === 1 ? 'Out' : 'In'}</div>
        </div>
        <div role="row" style={{ display: 'contents' }}>
          {players && <div className="p nm" role="rowheader">Par</div>}
          {hs.map((h) => <div key={h.number} className="p" role="cell">{h.par}</div>)}
          <div className="p tot" role="cell">{hs.reduce((s, h) => s + h.par, 0)}</div>
        </div>
        {players?.map((p, i) => line(p.name, (n) => p.scores.get(n), () => 'sc-player', `p${i}`))}
        {line(players ? 'Counts' : '', (n) => card.get(n), (v, par) => (v < par ? 'sc-under' : ''), 'team')}
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
