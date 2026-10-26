// Form pieces shared by the step-by-step New Event screen and the Event & course tab.
import { SCORING_BASIS_LABEL, type NetAllowances, type ScoringBasis, type StartType } from '../domain/types'
import { DEFAULT_ALLOWANCES } from '../scoring/handicap'
import type { Method } from '../scoring/formats'

export interface TeeSheet {
  startType: StartType
  startTime: string | null
  startingHole: number
  groupSize: number
  teeIntervalMinutes: number
  groupsPerTime?: number
}

/** Shotgun or tee times, start time, first hole, group size. */
export function TeeSheetFields({ value, onChange, id, teamSize, disabled }: { value: TeeSheet; onChange: (v: TeeSheet) => void; id: string; teamSize: number; disabled?: boolean }) {
  const set = (patch: Partial<TeeSheet>) => onChange({ ...value, ...patch })
  const unit = teamSize > 1 ? 'teams' : 'players'
  const sizes = teamSize > 1 ? [1, 2] : [2, 3, 4, 5]
  return (
    <fieldset className="grid-3" disabled={disabled}>
      <div className="field">
        <label htmlFor={`${id}-st`}>Start</label>
        <select id={`${id}-st`} value={value.startType} onChange={(e) => set({ startType: e.target.value as StartType })}>
          <option value="tee_times">Tee times</option>
          <option value="shotgun">Shotgun</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-time`}>{value.startType === 'shotgun' ? 'Shotgun time' : 'First tee time'}</label>
        <input id={`${id}-time`} type="time" value={value.startTime ?? ''} onChange={(e) => set({ startTime: e.target.value || null })} />
      </div>
      {value.startType === 'tee_times' ? (
        <>
          <div className="field">
            <label htmlFor={`${id}-int`}>Minutes between tee times</label>
            <input id={`${id}-int`} type="number" min={5} max={30} value={value.teeIntervalMinutes} onChange={(e) => set({ teeIntervalMinutes: Math.min(30, Math.max(5, Number(e.target.value) || 10)) })} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-gpt`}>Groups per tee time</label>
            <select id={`${id}-gpt`} value={value.groupsPerTime ?? 1} onChange={(e) => set({ groupsPerTime: Number(e.target.value) })}>
              <option value={1}>1 group</option>
              <option value={2}>2 groups (1A, 1B)</option>
              <option value={3}>3 groups</option>
              <option value={4}>4 groups</option>
            </select>
          </div>
        </>
      ) : (
        <div className="field">
          <label htmlFor={`${id}-hole`}>First group starts on</label>
          <select id={`${id}-hole`} value={value.startingHole} onChange={(e) => set({ startingHole: Number(e.target.value) })}>
            {Array.from({ length: 18 }, (_, k) => <option key={k} value={k + 1}>Hole {k + 1}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-gs`}>{teamSize > 1 ? 'Teams per group' : 'Players per group'}</label>
        <select id={`${id}-gs`} value={value.groupSize} onChange={(e) => set({ groupSize: Number(e.target.value) })}>
          {[...new Set([...sizes, value.groupSize])].sort().map((n) => <option key={n} value={n}>{n} {unit}</option>)}
        </select>
      </div>
    </fieldset>
  )
}

/** Entries per group: 4 players, 2 two-person teams, or one team of 3–4. */
export const defaultGroupSize = (teamSize: number) => (teamSize === 1 ? 4 : teamSize === 2 ? 2 : 1)

export interface Scoring {
  scoringBasis: ScoringBasis
  netAllowances: NetAllowances
  maxHandicapIndex: number | null
  hidePurse: boolean
}

/** Gross / net / both, the net allowances for the formats in use, and the Index cap. */
export function ScoringFields({ value, onChange, teamSize, methods, disabled }: { value: Scoring; onChange: (v: Scoring) => void; teamSize: number; methods: Method[]; disabled?: boolean }) {
  const set = (patch: Partial<Scoring>) => onChange({ ...value, ...patch })
  const a = value.netAllowances
  const setA = (patch: Partial<NetAllowances>) => set({ netAllowances: { ...a, ...patch } })
  const pct = (v: string) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)))
  const used = new Set(methods)
  const scramble = a.scramble[teamSize] ?? DEFAULT_ALLOWANCES.scramble[teamSize] ?? []
  return (
    <fieldset disabled={disabled}>
      <legend>Gross or net</legend>
      <div className="row">
        {(Object.keys(SCORING_BASIS_LABEL) as ScoringBasis[]).map((k) => (
          <label key={k} className="choice" style={{ marginRight: '1rem' }}>
            <input type="radio" name="basis" checked={value.scoringBasis === k} onChange={() => set({ scoringBasis: k })} />
            <span>{SCORING_BASIS_LABEL[k]}</span>
          </label>
        ))}
      </div>
      {value.scoringBasis !== 'gross' && (
        <div className="net-box">
          <p className="small" style={{ marginTop: 0 }}>
            Net scores use each player's Handicap Index (with its source and date) and each tee's course rating and slope to work out a Course Handicap,
            then apply the allowance below. Defaults are the USGA's recommendations. This is not an official GHIN calculation.
          </p>
          <div className="grid-3">
            {used.has('individual') && (
              <div className="field"><label htmlFor="na-ind">Stroke play allowance (%)</label>
                <input id="na-ind" type="number" min={0} max={100} value={a.individual} onChange={(e) => setA({ individual: pct(e.target.value) })} /></div>
            )}
            {used.has('best_ball') && (
              <div className="field"><label htmlFor="na-bb">Best ball allowance (%)</label>
                <input id="na-bb" type="number" min={0} max={100} value={a.bestBall} onChange={(e) => setA({ bestBall: pct(e.target.value) })} /></div>
            )}
            {used.has('alt_shot') && (
              <div className="field"><label htmlFor="na-alt">Alternate shot (% of combined)</label>
                <input id="na-alt" type="number" min={0} max={100} value={a.altShot} onChange={(e) => setA({ altShot: pct(e.target.value) })} /></div>
            )}
            <div className="field"><label htmlFor="na-max">Maximum Handicap Index</label>
              <input id="na-max" type="text" inputMode="decimal" placeholder="No cap" value={value.maxHandicapIndex ?? ''}
                onChange={(e) => { const n = e.target.value.trim() === '' ? null : Number(e.target.value); set({ maxHandicapIndex: n === null || Number.isNaN(n) ? null : Math.min(54, Math.max(0, n)) }) }} /></div>
          </div>
          {used.has('scramble') && (
            <div className="field">
              <span className="label-like">Scramble team handicap, % of each Course Handicap (lowest first)</span>
              <div className="row">
                {scramble.map((w, i) => (
                  <input key={i} aria-label={`Player ${i + 1} %`} type="number" min={0} max={100} value={w} style={{ width: 80 }}
                    onChange={(e) => setA({ scramble: { ...a.scramble, [teamSize]: scramble.map((x, k) => (k === i ? pct(e.target.value) : x)) } })} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <label className="choice">
        <input type="checkbox" checked={value.hidePurse} onChange={(e) => set({ hidePurse: e.target.checked })} />
        <span>Hide prize money from spectators<span className="hint">Payouts still show for admins.</span></span>
      </label>
    </fieldset>
  )
}
