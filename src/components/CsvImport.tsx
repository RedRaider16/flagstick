import { useState, type ReactNode } from 'react'
import type { ImportPreview } from '../scoring/csv'

/** Paste or choose a CSV, see a validated preview, then confirm. */
export function CsvImport<T>(props: {
  id: string
  header: string
  example: string
  parse: (text: string) => ImportPreview<T>
  columns: { label: string; render: (row: T) => ReactNode }[]
  onImport: (rows: T[]) => Promise<void>
  importLabel: string
}) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview<T> | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const check = (t: string) => {
    setText(t)
    setDone(null)
    setErr(null)
    setPreview(t.trim() ? props.parse(t) : null)
  }

  const issuesByRow = new Map<number, string[]>()
  preview?.issues.forEach((i) => issuesByRow.set(i.row, [...(issuesByRow.get(i.row) ?? []), `${i.severity === 'error' ? 'Error' : 'Warning'}: ${i.message}`]))
  const fileErrors = preview?.issues.filter((i) => i.row === 0) ?? []
  const errorCount = preview?.issues.filter((i) => i.severity === 'error').length ?? 0

  return (
    <div className="stack">
      <p className="small muted">
        Columns: <code>{props.header}</code>. Example: <code>{props.example}</code>
      </p>
      <div className="row">
        <label className="btn" htmlFor={`${props.id}-file`} style={{ marginBottom: 0 }}>Choose CSV file</label>
        <input id={`${props.id}-file`} className="sr-only" type="file" accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) check(await f.text())
            e.target.value = ''
          }} />
        <span className="muted small">or paste below</span>
      </div>
      <label htmlFor={`${props.id}-text`} className="sr-only">CSV text</label>
      <textarea id={`${props.id}-text`} value={text} onChange={(e) => check(e.target.value)} placeholder={`${props.header}\n${props.example}`} spellCheck={false}
        style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '.9rem' }} />
      {preview && (
        <>
          {fileErrors.map((i, k) => (
            <div key={k} className={`notice ${i.severity === 'error' ? 'error' : 'warn'}`} role="alert">{i.message}</div>
          ))}
          {preview.rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Import preview</caption>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    {props.columns.map((c) => <th key={c.label} scope="col">{c.label}</th>)}
                    <th scope="col">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => {
                    const msgs = issuesByRow.get(i + 1)
                    const bad = msgs?.some((m) => m.startsWith('Error'))
                    return (
                      <tr key={i} style={bad ? { background: 'var(--danger-tint)' } : msgs ? { background: 'var(--pending-tint)' } : undefined}>
                        <td>{i + 1}</td>
                        {props.columns.map((c) => <td key={c.label}>{c.render(r)}</td>)}
                        <td className="small">{msgs ? msgs.join(' ') : 'OK'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="row">
            <button className="btn primary" type="button" disabled={!preview.ok || busy || preview.rows.length === 0}
              onClick={async () => {
                setBusy(true)
                setErr(null)
                try {
                  await props.onImport(preview.rows)
                  setDone(`Imported ${preview.rows.length} row${preview.rows.length === 1 ? '' : 's'}.`)
                  setText('')
                  setPreview(null)
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              {busy ? 'Importing…' : props.importLabel}
            </button>
            <span className="small muted">
              {errorCount ? `Fix ${errorCount} error${errorCount === 1 ? '' : 's'} to import.` : `${preview.rows.length} row${preview.rows.length === 1 ? '' : 's'} ready.`}
            </span>
          </div>
        </>
      )}
      {err && <div className="notice error" role="alert">{err}</div>}
      {done && <div className="notice info" role="status">{done}</div>}
    </div>
  )
}
