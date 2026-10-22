// CSV import (with row-level validation for a preview) and CSV export.
import Papa from 'papaparse'
import { validateHoleLayout, type HoleInput } from './validation'

export interface RowIssue {
  row: number // 1-based data row (header excluded)
  message: string
  severity: 'error' | 'warning'
}

export interface ImportPreview<T> {
  rows: T[]
  issues: RowIssue[]
  /** True when there are no errors (warnings are allowed). */
  ok: boolean
  columns: string[]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_')

function parse(text: string): { data: Record<string, string>[]; columns: string[]; parseErrors: RowIssue[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: norm,
  })
  const parseErrors: RowIssue[] = res.errors.map((e) => ({
    row: (e.row ?? 0) + 1,
    message: `CSV problem: ${e.message}`,
    severity: 'error',
  }))
  return { data: res.data, columns: res.meta.fields ?? [], parseErrors }
}

// ── Players ────────────────────────────────────────────────────────────────

export interface PlayerImportRow {
  firstName: string
  lastName: string
  email: string
  phone: string
  team: string
}

export const PLAYER_CSV_HEADER = 'first_name,last_name,email,phone,team'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parsePlayerCsv(text: string, existingNames: string[] = []): ImportPreview<PlayerImportRow> {
  const { data, columns, parseErrors } = parse(text)
  const issues: RowIssue[] = [...parseErrors]
  if (!columns.includes('first_name') || !columns.includes('last_name')) {
    issues.push({ row: 0, severity: 'error', message: 'The header row must include first_name and last_name.' })
    return { rows: [], issues, ok: false, columns }
  }
  const existing = new Set(existingNames.map((n) => n.toLowerCase()))
  const seen = new Map<string, number>()
  const rows: PlayerImportRow[] = data.map((r, i) => {
    const row = i + 1
    const p: PlayerImportRow = {
      firstName: (r.first_name ?? '').trim(),
      lastName: (r.last_name ?? '').trim(),
      email: (r.email ?? '').trim(),
      phone: (r.phone ?? '').trim(),
      team: (r.team ?? '').trim(),
    }
    if (!p.firstName && !p.lastName) issues.push({ row, severity: 'error', message: 'Name is blank.' })
    else if (!p.lastName) issues.push({ row, severity: 'error', message: 'Last name is required.' })
    else if (!p.firstName) issues.push({ row, severity: 'error', message: 'First name is required.' })
    if (p.firstName.length > 60 || p.lastName.length > 60)
      issues.push({ row, severity: 'error', message: 'Names must be 60 characters or fewer.' })
    if (p.email && !EMAIL_RE.test(p.email)) issues.push({ row, severity: 'error', message: `"${p.email}" isn't a valid email.` })
    if (p.phone && !/^[\d\s()+.-]{7,20}$/.test(p.phone))
      issues.push({ row, severity: 'error', message: `"${p.phone}" isn't a valid phone number.` })
    const key = `${p.firstName} ${p.lastName}`.toLowerCase()
    if (p.firstName && p.lastName) {
      const prev = seen.get(key)
      if (prev) issues.push({ row, severity: 'warning', message: `Same name as row ${prev}. Import both only if they are different people.` })
      else seen.set(key, row)
      if (existing.has(key)) issues.push({ row, severity: 'warning', message: 'A player with this name is already in the event.' })
    }
    return p
  })
  if (rows.length === 0 && !issues.length) issues.push({ row: 0, severity: 'error', message: 'No player rows found.' })

  // Team column sanity: in a 2-person scramble a team name should appear exactly twice.
  const teamCounts = new Map<string, number[]>()
  rows.forEach((r, i) => {
    if (!r.team) return
    const list = teamCounts.get(r.team.toLowerCase()) ?? []
    list.push(i + 1)
    teamCounts.set(r.team.toLowerCase(), list)
  })
  for (const [, list] of teamCounts)
    if (list.length > 2)
      issues.push({ row: list[2]!, severity: 'error', message: `Team "${rows[list[0]! - 1]!.team}" has more than two players.` })

  return { rows, issues, ok: !issues.some((x) => x.severity === 'error'), columns }
}

// ── Course holes ───────────────────────────────────────────────────────────

export const HOLE_CSV_HEADER = 'hole,par,yardage,stroke_index'

export function parseHoleCsv(text: string): ImportPreview<HoleInput> {
  const { data, columns, parseErrors } = parse(text)
  const issues: RowIssue[] = [...parseErrors]
  const required = ['hole', 'par', 'stroke_index']
  const missingCols = required.filter((c) => !columns.includes(c))
  if (missingCols.length) {
    issues.push({ row: 0, severity: 'error', message: `Missing column(s): ${missingCols.join(', ')}. Expected: ${HOLE_CSV_HEADER}` })
    return { rows: [], issues, ok: false, columns }
  }
  const toInt = (v: string | undefined): number => (v && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN)
  const rows: HoleInput[] = data.map((r, i) => {
    const yRaw = (r.yardage ?? '').trim()
    const h: HoleInput = {
      number: toInt(r.hole),
      par: toInt(r.par),
      yardage: yRaw === '' ? null : toInt(yRaw),
      strokeIndex: toInt(r.stroke_index),
    }
    if (Number.isNaN(h.number)) issues.push({ row: i + 1, severity: 'error', message: `Hole "${r.hole ?? ''}" isn't a whole number.` })
    if (Number.isNaN(h.par)) issues.push({ row: i + 1, severity: 'error', message: `Par "${r.par ?? ''}" isn't a whole number.` })
    if (h.yardage !== null && Number.isNaN(h.yardage))
      issues.push({ row: i + 1, severity: 'error', message: `Yardage "${yRaw}" isn't a whole number.` })
    if (Number.isNaN(h.strokeIndex))
      issues.push({ row: i + 1, severity: 'error', message: `Stroke index "${r.stroke_index ?? ''}" isn't a whole number.` })
    return h
  })
  if (!issues.some((x) => x.severity === 'error'))
    for (const m of validateHoleLayout(rows)) issues.push({ row: 0, severity: 'error', message: m })
  return { rows, issues, ok: !issues.some((x) => x.severity === 'error'), columns }
}

// ── Export ─────────────────────────────────────────────────────────────────

/** Neutralise spreadsheet formula injection while leaving plain numbers like "-3" alone. */
export function safeCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) return `'${s}`
  return s
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return Papa.unparse({ fields: header, data: rows.map((r) => r.map(safeCell)) }, { newline: '\r\n' })
}
