import { useApp } from '../app/context'
import { errorMessage } from '../data/errors'
import { ENTRY_STATUS_LABEL, type Entry, type EntryStatus, type Round, type RoundEntryStatus, type RoundOutStatus } from '../domain/types'
import { useReasonDialog } from './ui'

const OUT_LABEL: Record<RoundOutStatus, string> = { dnf: 'DNF', ns: 'NS' }

/**
 * Mark an entry WD / DQ / DNF / NS for the whole event, DNF / NS for one round
 * (multi-round events), or back to playing. Recorded in the event log.
 */
export function EntryStatusControl({ entry, rounds = [], roundStatuses = [], disabled, onDone, onError }: {
  entry: Entry
  rounds?: Round[]
  roundStatuses?: RoundEntryStatus[]
  disabled?: boolean
  onDone: () => void
  onError: (m: string) => void
}) {
  const { repo } = useApp()
  const dialog = useReasonDialog()
  const mine = roundStatuses.filter((x) => x.entryId === entry.id)
  const multi = rounds.length > 1
  const value = entry.status !== 'active' ? entry.status : mine[0] ? `${mine[0].roundId}|${mine[0].status}` : 'active'

  const change = async (to: string) => {
    if (to === value) return
    const [roundId, roundSt] = to.includes('|') ? (to.split('|') as [string, RoundOutStatus]) : [null, null]
    const round = rounds.find((r) => r.id === roundId)
    const title = to === 'active' ? 'Reinstate' : round ? `${OUT_LABEL[roundSt!]} in round ${round.roundNumber}` : ENTRY_STATUS_LABEL[to as EntryStatus]
    const note = await dialog.ask({
      title: `${title}?`,
      body: (
        <p>
          {to === 'active' ? 'The entry returns to the leaderboard rankings.'
            : round ? `Their round ${round.roundNumber} scores are left out: they stay ranked on the other rounds' leaderboards, are listed unranked overall, and scorekeepers can't enter round ${round.roundNumber} scores for them.`
            : 'Scores are kept but the entry is listed unranked at the bottom of the leaderboard.'}
        </p>
      ),
      label: 'Note',
      confirmLabel: title,
      danger: to !== 'active',
    })
    if (note === null) return
    try {
      // One status at a time: clear what's there, then set the new one.
      for (const x of mine) if (!(round && x.roundId === round.id)) await repo.setRoundEntryStatus(x.roundId, entry.id, null, note)
      if (round) {
        if (entry.status !== 'active') await repo.setEntryStatus(entry.id, 'active', note)
        await repo.setRoundEntryStatus(round.id, entry.id, roundSt, note)
      } else {
        await repo.setEntryStatus(entry.id, to as EntryStatus, note)
      }
      onDone()
    } catch (e) {
      onError(errorMessage(e))
    }
  }
  return (
    <>
      {dialog.element}
      <select aria-label="Entry status" value={value} disabled={disabled} onChange={(e) => void change(e.target.value)} style={{ width: 'auto', minHeight: 38 }}>
        <option value="active">Playing</option>
        <optgroup label={multi ? 'Whole event' : 'Status'}>
          <option value="dnf">DNF</option>
          <option value="ns">NS</option>
          <option value="wd">WD</option>
          <option value="dq">DQ</option>
        </optgroup>
        {multi && rounds.map((r) => (
          <optgroup key={r.id} label={`Round ${r.roundNumber} only`}>
            <option value={`${r.id}|dnf`} disabled={r.status === 'finalized'}>DNF in round {r.roundNumber}</option>
            <option value={`${r.id}|ns`} disabled={r.status === 'finalized'}>NS in round {r.roundNumber}</option>
          </optgroup>
        ))}
      </select>
    </>
  )
}
