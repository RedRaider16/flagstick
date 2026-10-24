// The event leaderboard with its controls: which round (or overall), gross or
// net, and place money. Used by the public page and the admin overview.
import { useMemo, useState } from 'react'
import { boardRounds, cardDetail } from '../app/board'
import { basesOf, buildEventLeaderboard, currentRound, isTeamEvent, leaderboardPayouts, leaderboardScopes, type Basis, type Scope } from '../domain/derive'
import type { EventBundle } from '../domain/types'
import { describeAllowances } from '../scoring/handicap'
import { Leaderboard } from './Leaderboard'
import { ScopeTabs } from './ui'

export function EventBoard({ bundle, live, showGaps }: { bundle: EventBundle; live?: boolean; showGaps?: boolean }) {
  const scopes = useMemo(() => leaderboardScopes(bundle), [bundle])
  const [scope, setScope] = useState<Scope | null>(null)
  const active: Scope = scope && scopes.some((x) => x.scope === scope) ? scope : bundle.event.cumulative && scopes[0]?.scope === 'overall' ? 'overall' : currentRound(bundle).id
  const bases = basesOf(bundle.event.scoringBasis)
  const [basisPick, setBasis] = useState<Basis | null>(null)
  const basis: Basis = basisPick && bases.includes(basisPick) ? basisPick : bases[0]!
  const lb = useMemo(() => buildEventLeaderboard(bundle, active, basis), [bundle, active, basis])
  const payouts = useMemo(() => leaderboardPayouts(bundle, lb, basis, active), [bundle, lb, basis, active])
  const isTeam = isTeamEvent(bundle)
  const label = scopes.find((x) => x.scope === active)?.label ?? 'Leaderboard'
  const rounds = active === 'overall' ? bundle.rounds : bundle.rounds.filter((r) => r.id === active)
  const allowances = basis === 'net'
    ? `Net: ${[...new Set(rounds.map((r) => describeAllowances(r.segments, bundle.event.teamSize, bundle.event.netAllowances)))].join('; ')}, from each player's Handicap Index and the tee's rating and slope${bundle.event.maxHandicapIndex !== null ? ` (Index capped at ${bundle.event.maxHandicapIndex.toFixed(1)})` : ''}. Not an official handicap calculation.`
    : undefined

  return (
    <>
      <div className="row no-print" style={{ gap: '.5rem 1.5rem', alignItems: 'flex-start' }}>
        <ScopeTabs label="Leaderboard view" options={scopes} value={active} onChange={setScope} />
        {bases.length > 1 && <ScopeTabs label="Gross or net" options={bases.map((x) => ({ scope: x, label: x === 'gross' ? 'Gross' : 'Net' }))} value={basis} onChange={setBasis} />}
      </div>
      <Leaderboard lb={lb} rounds={boardRounds(bundle, active)} detail={basis === 'gross' ? cardDetail(bundle) : undefined} showGaps={showGaps}
        title={`${label}${bases.length > 1 || basis === 'net' ? ` — ${basis}` : ''}${isTeam ? ' teams' : ''}`} isTeam={isTeam} live={live}
        payouts={payouts} footnote={allowances} />
    </>
  )
}
