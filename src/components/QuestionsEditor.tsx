// Edit the organizer's sign-up questions (used by the setup steps and the Registration tab).
import { QUESTION_KIND_LABEL, type QuestionKind } from '../domain/types'

export interface QuestionDraft {
  /** Set for questions already saved. */
  id?: string
  label: string
  kind: QuestionKind
  choices: string[]
  required: boolean
  perPlayer: boolean
  sortOrder: number
}

export const PRESET_QUESTIONS: { label: string; q: Omit<QuestionDraft, 'sortOrder'> }[] = [
  { label: 'Cart', q: { label: 'Do you need a cart?', kind: 'yes_no', choices: [], required: true, perPlayer: true } },
  { label: 'Shirt size', q: { label: 'Shirt size', kind: 'choice', choices: ['S', 'M', 'L', 'XL', 'XXL'], required: false, perPlayer: true } },
  { label: 'Tee time request', q: { label: 'Tee time or pairing request', kind: 'text', choices: [], required: false, perPlayer: false } },
]

export function questionProblem(q: QuestionDraft): string | null {
  if (!q.label.trim()) return 'Each question needs some text.'
  if (q.kind === 'choice' && q.choices.map((c) => c.trim()).filter(Boolean).length < 2) return `"${q.label}" needs at least two options.`
  return null
}

export function QuestionsEditor({ value, onChange, teamSize }: { value: QuestionDraft[]; onChange: (v: QuestionDraft[]) => void; teamSize: number }) {
  const set = (i: number, patch: Partial<QuestionDraft>) => onChange(value.map((q, k) => (k === i ? { ...q, ...patch } : q)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...value]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x!)
    onChange(next)
  }
  const add = (q: Omit<QuestionDraft, 'sortOrder'>) => onChange([...value, { ...q, sortOrder: value.length + 1 }])
  return (
    <div>
      {value.length === 0 && <p className="muted small">No extra questions.</p>}
      {value.map((q, i) => {
        const problem = questionProblem(q)
        const id = `q-${i}`
        return (
          <div key={q.id ?? `new-${i}`} className="question-row">
            <div className="grid-q">
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor={`${id}-l`}>Question</label>
                <input id={`${id}-l`} type="text" maxLength={120} value={q.label} onChange={(e) => set(i, { label: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor={`${id}-k`}>Answer</label>
                <select id={`${id}-k`} value={q.kind} onChange={(e) => set(i, { kind: e.target.value as QuestionKind })}>
                  {(Object.keys(QUESTION_KIND_LABEL) as QuestionKind[]).map((k) => <option key={k} value={k}>{QUESTION_KIND_LABEL[k]}</option>)}
                </select>
              </div>
            </div>
            {q.kind === 'choice' && (
              <div className="field" style={{ margin: '.4rem 0 0' }}>
                <label htmlFor={`${id}-c`}>Options, separated by commas</label>
                <input id={`${id}-c`} type="text" value={q.choices.join(', ')} onChange={(e) => set(i, { choices: e.target.value.split(',').map((c) => c.trimStart()) })} />
              </div>
            )}
            <div className="row" style={{ marginTop: '.3rem', gap: '.2rem 1rem' }}>
              <label className="choice" style={{ padding: 0 }}><input type="checkbox" checked={q.required} onChange={(e) => set(i, { required: e.target.checked })} /> <span>Required</span></label>
              {teamSize > 1 && (
                <label className="choice" style={{ padding: 0 }}><input type="checkbox" checked={q.perPlayer} onChange={(e) => set(i, { perPlayer: e.target.checked })} /> <span>Ask each player</span></label>
              )}
              <span className="spacer" />
              <button className="btn quiet small" type="button" aria-label={`Move "${q.label}" up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn quiet small" type="button" aria-label={`Move "${q.label}" down`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="btn quiet small" type="button" onClick={() => onChange(value.filter((_, k) => k !== i))}>Remove</button>
            </div>
            {problem && <p className="small" role="alert" style={{ color: 'var(--danger)', margin: '.2rem 0 0' }}>{problem}</p>}
          </div>
        )
      })}
      <div className="row" style={{ marginTop: '.5rem' }}>
        <button className="btn small" type="button" onClick={() => add({ label: '', kind: 'text', choices: [], required: false, perPlayer: false })}>Add a question</button>
        {PRESET_QUESTIONS.filter((p) => !value.some((q) => q.label === p.q.label)).map((p) => (
          <button key={p.label} className="btn quiet small" type="button" onClick={() => add({ ...p.q, perPlayer: teamSize > 1 && p.q.perPlayer })}>+ {p.label}</button>
        ))}
      </div>
    </div>
  )
}
