import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EVENT_STATUS_LABEL, type EventStatus } from '../domain/types'

export function FlagMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11 5v22" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M12.5 6.2 24 10.6l-11.5 4.4z" fill="#d6a63f" />
      <ellipse cx="11" cy="27.2" rx="6" ry="1.6" fill="rgba(255,255,255,.35)" />
    </svg>
  )
}

export function Notice({ kind, children }: { kind: 'error' | 'warn' | 'info'; children: ReactNode }) {
  const icon = kind === 'error' ? '⚠' : kind === 'warn' ? '!' : 'ℹ'
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{icon}</span>
      <div>{children}</div>
    </div>
  )
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  return error ? <Notice kind="error">{error}</Notice> : null
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted row" role="status">
      <span className="spin" aria-hidden="true" /> {label}
    </p>
  )
}

export function StatusBadge({ status }: { status: EventStatus }) {
  return <span className={`badge ${status}`}>{EVENT_STATUS_LABEL[status]}</span>
}

/** Accessible prompt for a reason / confirmation (native <dialog>). */
export function ReasonDialog(props: {
  open: boolean
  title: string
  body?: ReactNode
  label?: string
  required?: boolean
  confirmLabel: string
  danger?: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.open && !d.open) {
      setReason('')
      d.showModal()
    } else if (!props.open && d.open) d.close()
  }, [props.open])
  const askReason = props.label !== undefined
  return (
    <dialog ref={ref} onCancel={(e) => (e.preventDefault(), props.onCancel())} aria-labelledby="dlg-title">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (props.required && !reason.trim()) return
          props.onConfirm(reason.trim())
        }}
      >
        <h2 id="dlg-title">{props.title}</h2>
        {props.body && <div className="stack" style={{ marginBottom: '1rem' }}>{props.body}</div>}
        {askReason && (
          <div className="field">
            <label htmlFor="dlg-reason">{props.label}{props.required ? '' : ' (optional)'}</label>
            <input id="dlg-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} required={props.required} autoFocus maxLength={200} />
          </div>
        )}
        <div className="row end">
          <button type="button" className="btn quiet" onClick={props.onCancel}>Cancel</button>
          <button type="submit" className={`btn ${props.danger ? 'danger' : 'primary'}`} disabled={props.required && !reason.trim()}>
            {props.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}

/** Small helper: open a ReasonDialog imperatively. */
export function useReasonDialog() {
  const [state, setState] = useState<null | {
    title: string
    body?: ReactNode
    label?: string
    required?: boolean
    confirmLabel: string
    danger?: boolean
    resolve: (r: string | null) => void
  }>(null)
  const ask = (opts: { title: string; body?: ReactNode; label?: string; required?: boolean; confirmLabel: string; danger?: boolean }) =>
    new Promise<string | null>((resolve) => setState({ ...opts, resolve }))
  const element = (
    <ReasonDialog
      open={!!state}
      title={state?.title ?? ''}
      body={state?.body}
      label={state?.label}
      required={state?.required}
      confirmLabel={state?.confirmLabel ?? 'OK'}
      danger={state?.danger}
      onConfirm={(r) => {
        state?.resolve(r)
        setState(null)
      }}
      onCancel={() => {
        state?.resolve(null)
        setState(null)
      }}
    />
  )
  return { ask, element }
}

export function download(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
}
