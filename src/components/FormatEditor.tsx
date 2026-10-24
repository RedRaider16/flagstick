import { describeFormat, METHOD_LABEL, segmentsProblem, TEAM_METHODS, type Method, type Segment } from '../scoring/formats'

type Preset = 'individual' | 'scramble' | 'alt_shot' | 'best_ball' | 'mixed'

const SIXES: Segment[] = [
  { from: 1, to: 6, method: 'scramble', count: 1 },
  { from: 7, to: 12, method: 'alt_shot', count: 1 },
  { from: 13, to: 18, method: 'best_ball', count: 1 },
]

function presetOf(segs: Segment[]): Preset {
  if (segs.length !== 1) return 'mixed'
  return segs[0]!.method
}

const whole = (method: Method, count = 1): Segment[] => [{ from: 1, to: 18, method, count }]

/** Choose how a round is scored: one method for all 18 holes, or different methods by hole range. */
export function FormatEditor(props: { teamSize: number; value: Segment[]; onChange: (s: Segment[]) => void; disabled?: boolean; id: string }) {
  const { teamSize, value, onChange, disabled, id } = props
  if (teamSize === 1)
    return (
      <p className="small" style={{ margin: '.2rem 0 .6rem' }}>
        Individual stroke play: each player records their own score on every hole.
      </p>
    )
  const preset = presetOf(value)
  const bestCount = value.length === 1 && value[0]!.method === 'best_ball' ? value[0]!.count : Math.min(2, teamSize)
  const problem = segmentsProblem(value, teamSize)
  const setSeg = (i: number, patch: Partial<Segment>) => {
    const next = value.map((s, j) => (j === i ? { ...s, ...patch } : s))
    // Keep ranges contiguous: each segment starts after the previous one ends.
    for (let j = 1; j < next.length; j++) next[j] = { ...next[j]!, from: next[j - 1]!.to + 1 }
    onChange(next)
  }

  const choice = (p: Preset, label: string, hint: string, segs: () => Segment[]) => (
    <label className="choice">
      <input type="radio" name={`${id}-fmt`} checked={preset === p} disabled={disabled} onChange={() => onChange(segs())} />
      <span>{label}<span className="hint">{hint}</span></span>
    </label>
  )

  return (
    <div>
      {choice('scramble', 'Scramble', 'One team score per hole.', () => whole('scramble'))}
      {choice('alt_shot', 'Alternate shot', 'One team score per hole; players alternate shots.', () => whole('alt_shot'))}
      <label className="choice">
        <input type="radio" name={`${id}-fmt`} checked={preset === 'best_ball'} disabled={disabled} onChange={() => onChange(whole('best_ball', bestCount))} />
        <span>
          Best ball
          <span className="hint">
            Everyone plays their own ball; the lowest{' '}
            <select aria-label="Scores that count per hole" value={bestCount} disabled={disabled || preset !== 'best_ball'}
              onChange={(e) => onChange(whole('best_ball', Number(e.target.value)))} style={{ width: 'auto', minHeight: 32, display: 'inline-block' }}>
              {Array.from({ length: teamSize }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>{' '}
            score{bestCount === 1 ? '' : 's'} of {teamSize} count on each hole. A missing score is a pick-up, never zero.
          </span>
        </span>
      </label>
      {choice('mixed', 'Different formats by hole', 'e.g. the 666: scramble 1–6, alternate shot 7–12, best ball 13–18.', () => (teamSize === 2 ? SIXES : SIXES.map((s) => (s.method === 'alt_shot' ? { ...s, method: 'scramble' } : s))))}

      {preset === 'mixed' && (
        <div className="panel" style={{ padding: '.6rem .7rem', marginTop: '.4rem' }}>
          {value.map((s, i) => (
            <div key={i} className="seg-row">
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor={`${id}-f${i}`}>From</label>
                <input id={`${id}-f${i}`} type="number" value={s.from} disabled readOnly />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor={`${id}-t${i}`}>To</label>
                <input id={`${id}-t${i}`} type="number" min={s.from} max={18} value={s.to} disabled={disabled || i === value.length - 1}
                  onChange={(e) => setSeg(i, { to: Math.max(s.from, Math.min(17, Number(e.target.value) || s.from)) })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor={`${id}-m${i}`}>Format</label>
                <select id={`${id}-m${i}`} value={s.method} disabled={disabled} onChange={(e) => setSeg(i, { method: e.target.value as Method, count: 1 })}>
                  {TEAM_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor={`${id}-c${i}`}>Counting</label>
                <select id={`${id}-c${i}`} value={s.count} disabled={disabled || s.method !== 'best_ball'} onChange={(e) => setSeg(i, { count: Number(e.target.value) })}>
                  {Array.from({ length: teamSize }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{s.method === 'best_ball' ? `Best ${n}` : '—'}</option>)}
                </select>
              </div>
              <button type="button" className="btn quiet small" disabled={disabled || value.length <= 2}
                onClick={() => {
                  const next = value.filter((_, j) => j !== i)
                  next[0] = { ...next[0]!, from: 1 }
                  for (let j = 1; j < next.length; j++) next[j] = { ...next[j]!, from: next[j - 1]!.to + 1 }
                  next[next.length - 1] = { ...next[next.length - 1]!, to: 18 }
                  onChange(next)
                }}>Remove</button>
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn small" disabled={disabled || value.length >= 6 || value[value.length - 1]!.from >= 18}
              onClick={() => {
                const last = value[value.length - 1]!
                const mid = Math.floor((last.from + 18) / 2)
                onChange([...value.slice(0, -1), { ...last, to: mid }, { from: mid + 1, to: 18, method: 'scramble', count: 1 }])
              }}>Split the last range</button>
          </div>
        </div>
      )}
      <p className="small" style={{ margin: '.4rem 0 0' }} role={problem ? 'alert' : undefined}>
        {problem ? <span style={{ color: 'var(--danger)' }}>{problem}</span> : <>Format: <strong>{describeFormat(value, teamSize)}</strong></>}
      </p>
    </div>
  )
}
