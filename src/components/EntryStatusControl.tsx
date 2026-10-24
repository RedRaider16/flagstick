import { useApp } from '../app/context'
import { errorMessage } from '../data/errors'
import { ENTRY_STATUS_LABEL, type Entry, type EntryStatus } from '../domain/types'
import { useReasonDialog } from './ui'

/** Mark an entry WD / DQ / DNF / NS / active (recorded in the event log). */
export function EntryStatusControl({ entry, disabled, onDone, onError }: { entry: Entry; disabled?: boolean; onDone: () => void; onError: (m: string) => void }) {
  const { repo } = useApp()
  const dialog = useReasonDialog()
  const change = async (to: EntryStatus) => {
    if (to === entry.status) return
    const label = to === 'active' ? 'Reinstate' : ENTRY_STATUS_LABEL[to]
    const note = await dialog.ask({
      title: `${label}?`,
      body: <p>{to === 'active' ? 'The entry returns to the leaderboard rankings.' : 'Scores are kept but the entry is listed unranked at the bottom of the leaderboard.'}</p>,
      label: 'Note',
      confirmLabel: label,
      danger: to !== 'active',
    })
    if (note === null) return
    try {
      await repo.setEntryStatus(entry.id, to, note)
      onDone()
    } catch (e) {
      onError(errorMessage(e))
    }
  }
  return (
    <>
      {dialog.element}
      <select aria-label="Entry status" value={entry.status} disabled={disabled} onChange={(e) => void change(e.target.value as EntryStatus)} style={{ width: 'auto', minHeight: 38 }}>
        <option value="active">Playing</option>
        <option value="dnf">DNF</option>
        <option value="ns">NS</option>
        <option value="wd">WD</option>
        <option value="dq">DQ</option>
      </select>
    </>
  )
}
