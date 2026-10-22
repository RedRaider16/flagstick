import { describe, expect, it } from 'vitest'
import { parseStrokes, validateHoleLayout } from '../../src/scoring/validation'
import { parseHoleCsv, parsePlayerCsv, safeCell, toCsv } from '../../src/scoring/csv'

describe('parseStrokes', () => {
  it('accepts whole numbers 1–20', () => {
    expect(parseStrokes('4')).toEqual({ ok: true, value: 4 })
    expect(parseStrokes(1)).toEqual({ ok: true, value: 1 })
    expect(parseStrokes(' 20 ')).toEqual({ ok: true, value: 20 })
  })
  it.each([['', 'Enter a score.'], [null, 'Enter a score.'], ['0', 'at least 1'], ['21', "can't be more than 20"], ['4.5', 'whole numbers'], ['-3', 'whole numbers'], ['x', 'whole numbers']])(
    'rejects %j',
    (input, msg) => {
      const r = parseStrokes(input)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain(msg)
    },
  )
})

const validLayout = () =>
  Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yardage: 400, strokeIndex: i + 1 }))

describe('validateHoleLayout', () => {
  it('accepts a valid 18-hole layout', () => {
    expect(validateHoleLayout(validLayout())).toEqual([])
  })
  it('rejects duplicate stroke indexes and bad pars', () => {
    const l = validLayout()
    l[1]!.strokeIndex = 1
    l[2]!.par = 7
    const errs = validateHoleLayout(l)
    expect(errs.some((e) => e.includes('Stroke index 1 is used 2 times'))).toBe(true)
    expect(errs.some((e) => e.includes('Hole 3: par'))).toBe(true)
  })
  it('rejects missing holes', () => {
    expect(validateHoleLayout(validLayout().slice(0, 17))[0]).toContain('exactly 18')
  })
})

describe('parsePlayerCsv', () => {
  it('parses a valid file with flexible headers and a BOM', () => {
    const csv = '﻿First Name,Last Name,Email,Phone,Team\nAva,Stone,ava@example.com,555-123-4567,Eagles\nBen,Ruiz,,,Eagles\n'
    const p = parsePlayerCsv(csv)
    expect(p.ok).toBe(true)
    expect(p.rows).toHaveLength(2)
    expect(p.rows[0]).toEqual({ firstName: 'Ava', lastName: 'Stone', email: 'ava@example.com', phone: '555-123-4567', team: 'Eagles' })
  })
  it('reports row-level errors and warnings', () => {
    const csv = 'first_name,last_name,email\nAva,,a@x.co\n,Stone,bad-email\nCal,Diaz,\nCal,Diaz,\n'
    const p = parsePlayerCsv(csv, ['Cal Diaz'])
    expect(p.ok).toBe(false)
    const msgs = p.issues.map((i) => `${i.row}:${i.severity}:${i.message}`)
    expect(msgs.some((m) => m.startsWith('1:error:Last name'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('2:error:First name'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('2:error:') && m.includes('valid email'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('4:warning:Same name as row 3'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('3:warning:A player with this name'))).toBe(true)
  })
  it('requires name columns', () => {
    expect(parsePlayerCsv('name,email\nA,b@c.de').ok).toBe(false)
  })
  it('rejects a team with more than two players', () => {
    const p = parsePlayerCsv('first_name,last_name,team\nA,A,X\nB,B,X\nC,C,x\n')
    expect(p.ok).toBe(false)
    expect(p.issues[0]!.message).toContain('more than two')
  })
})

describe('parseHoleCsv', () => {
  const header = 'hole,par,yardage,stroke_index\n'
  it('parses a valid course', () => {
    const body = Array.from({ length: 18 }, (_, i) => `${i + 1},4,${300 + i},${18 - i}`).join('\n')
    const p = parseHoleCsv(header + body)
    expect(p.ok).toBe(true)
    expect(p.rows[17]).toEqual({ number: 18, par: 4, yardage: 317, strokeIndex: 1 })
  })
  it('allows blank yardage but rejects non-numbers', () => {
    const body = Array.from({ length: 18 }, (_, i) => `${i + 1},4,,${i + 1}`).join('\n')
    expect(parseHoleCsv(header + body).ok).toBe(true)
    const bad = parseHoleCsv(header + body.replace('1,4,,1', '1,four,,1'))
    expect(bad.ok).toBe(false)
    expect(bad.issues[0]!.message).toContain('Par "four"')
  })
  it('reports missing columns', () => {
    expect(parseHoleCsv('hole,par\n1,4').issues[0]!.message).toContain('stroke_index')
  })
})

describe('CSV export', () => {
  it('neutralises formula injection but keeps negative numbers', () => {
    expect(safeCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(safeCell('@SUM(A1)')).toBe(`'@SUM(A1)`)
    expect(safeCell('-3')).toBe('-3')
    expect(safeCell('+2')).toBe('+2')
    expect(safeCell(null)).toBe('')
  })
  it('quotes commas', () => {
    expect(toCsv(['a', 'b'], [['x,y', 1]])).toBe('a,b\r\n"x,y",1')
  })
})
