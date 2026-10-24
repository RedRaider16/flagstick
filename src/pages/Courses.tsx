import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useApp, usePath } from '../app/context'
import { useAction, useTitle } from '../app/hooks'
import { CsvImport } from '../components/CsvImport'
import { ErrorNote, Loading, Notice } from '../components/ui'
import type { CourseDetail } from '../data/repo'
import { errorMessage } from '../data/errors'
import type { Course } from '../domain/types'
import { HOLE_CSV_HEADER, parseHoleCsv } from '../scoring/csv'
import { validateHoleLayout, type HoleInput } from '../scoring/validation'

export function Courses() {
  useTitle('Courses')
  const { repo, isOrganizer } = useApp()
  const p = usePath()
  const nav = useNavigate()
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const { busy, error, run } = useAction()

  useEffect(() => {
    repo.listCourses().then(setCourses, () => setCourses([]))
  }, [repo])

  if (!isOrganizer) return <Notice kind="warn">Only organizers can manage courses.</Notice>

  return (
    <>
      <h1>Courses</h1>
      <div className="grid-2">
        <section className="panel">
          <h2>Your courses</h2>
          {!courses ? <Loading /> : courses.length === 0 ? <p className="muted">No courses yet. Add one to get started.</p> : (
            <ul className="event-list">
              {courses.map((c) => (
                <li key={c.id}>
                  <div><strong>{c.name}</strong><div className="muted small">{c.city}</div></div>
                  <Link className="btn" to={p(`courses/${c.id}`)}>Edit tees and holes</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <form className="panel" onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            const id = await repo.createCourse(name, city)
            nav(p(`courses/${id}`))
          })
        }}>
          <h2>Add a course</h2>
          <ErrorNote error={error} />
          <div className="field">
            <label htmlFor="cname">Course name</label>
            <input id="cname" type="text" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ccity">City</label>
            <input id="ccity" type="text" maxLength={120} value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <button className="btn primary" type="submit" disabled={busy || !name.trim()}>Add course</button>
        </form>
      </div>
    </>
  )
}

const blankHoles = (): HoleInput[] => Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yardage: null, strokeIndex: i + 1 }))

export function CourseEditor() {
  const { courseId } = useParams()
  const { repo, isOrganizer } = useApp()
  const p = usePath()
  const [detail, setDetail] = useState<CourseDetail | null>(null)
  const [teeId, setTeeId] = useState<string | null>(null)
  const [holes, setHoles] = useState<HoleInput[]>(blankHoles())
  const [newTee, setNewTee] = useState('')
  const [saved, setSaved] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const { busy, error, setError, run } = useAction()
  useTitle(detail?.course.name ?? 'Course')

  const load = useCallback(async () => {
    try {
      const d = await repo.courseDetail(courseId!)
      setDetail(d)
      setTeeId((cur) => cur ?? d.tees[0]?.id ?? null)
    } catch (e) {
      setLoadErr(errorMessage(e))
    }
  }, [repo, courseId])
  useEffect(() => void load(), [load])

  useEffect(() => {
    if (!detail || !teeId) return
    const hs = detail.holes.filter((h) => h.teeId === teeId).sort((a, b) => a.number - b.number)
    setHoles(hs.length === 18 ? hs.map((h) => ({ number: h.number, par: h.par, yardage: h.yardage, strokeIndex: h.strokeIndex })) : blankHoles())
    setSaved(false)
  }, [detail, teeId])

  if (!isOrganizer) return <Notice kind="warn">Only organizers can edit courses.</Notice>
  if (loadErr) return <ErrorNote error={loadErr} />
  if (!detail) return <Loading />

  const problems = validateHoleLayout(holes)
  const setHole = (i: number, patch: Partial<HoleInput>) => {
    setSaved(false)
    setHoles((hs) => hs.map((h, k) => (k === i ? { ...h, ...patch } : h)))
  }
  const teeHasHoles = detail.holes.some((h) => h.teeId === teeId)
  const totalPar = holes.reduce((s, h) => s + (Number.isFinite(h.par) ? h.par : 0), 0)
  const totalYds = holes.reduce((s, h) => s + (h.yardage ?? 0), 0)

  return (
    <>
      <p className="no-print"><Link to={p('courses')}>Courses</Link></p>
      <h1>{detail.course.name}</h1>
      <p className="muted">{detail.course.city}</p>

      <section className="panel">
        <h2>Tees</h2>
        <div className="row" role="group" aria-label="Choose a tee">
          {detail.tees.map((t) => (
            <button key={t.id} type="button" className={`btn ${t.id === teeId ? 'primary' : ''}`} aria-pressed={t.id === teeId} onClick={() => setTeeId(t.id)}>
              {t.name}
            </button>
          ))}
          <form className="row" onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const id = await repo.createTee(courseId!, newTee)
              setNewTee('')
              setTeeId(id)
              await load()
            })
          }}>
            <label htmlFor="tee-name" className="sr-only">New tee name</label>
            <input id="tee-name" type="text" placeholder="New tee, e.g. Blue" value={newTee} maxLength={40} onChange={(e) => setNewTee(e.target.value)} style={{ width: 180 }} />
            <button className="btn" type="submit" disabled={!newTee.trim() || busy}>Add tee</button>
          </form>
        </div>
        {teeId && (() => {
          const tee = detail.tees.find((t) => t.id === teeId)!
          return <TeeRatingForm key={tee.id + tee.rating + tee.slope} teeName={tee.name} rating={tee.rating} slope={tee.slope}
            onSave={(r, sl) => run(async () => { await repo.updateTee(tee.id, { rating: r, slope: sl }); await load() })} busy={busy} />
        })()}
      </section>

      <ErrorNote error={error} />
      {!teeId ? <Notice kind="info">Add a tee (for example "White") to enter the hole layout.</Notice> : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <section className="panel">
            <h2>Holes {teeHasHoles ? '' : '(not saved yet)'}</h2>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Hole layout for the selected tee</caption>
                <thead>
                  <tr><th scope="col">Hole</th><th scope="col">Par</th><th scope="col">Yards</th><th scope="col">Stroke index</th></tr>
                </thead>
                <tbody>
                  {holes.map((h, i) => (
                    <tr key={h.number}>
                      <th scope="row" className="num" style={{ fontSize: '1.1rem' }}>{h.number}</th>
                      <td>
                        <select aria-label={`Hole ${h.number} par`} value={h.par} onChange={(e) => setHole(i, { par: Number(e.target.value) })} style={{ width: 80 }}>
                          {[3, 4, 5, 6].map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </td>
                      <td>
                        <input aria-label={`Hole ${h.number} yards`} type="number" inputMode="numeric" min={50} max={800} value={h.yardage ?? ''} style={{ width: 100 }}
                          onChange={(e) => setHole(i, { yardage: e.target.value === '' ? null : Number(e.target.value) })} />
                      </td>
                      <td>
                        <input aria-label={`Hole ${h.number} stroke index`} type="number" inputMode="numeric" min={1} max={18} value={Number.isFinite(h.strokeIndex) ? h.strokeIndex : ''} style={{ width: 80 }}
                          onChange={(e) => setHole(i, { strokeIndex: e.target.value === '' ? NaN : Number(e.target.value) })} />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Total</th>
                    <td className="num" style={{ fontSize: '1.1rem' }}>{totalPar}</td>
                    <td className="num" style={{ fontSize: '1.1rem' }}>{totalYds || '—'}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {problems.length > 0 && (
              <Notice kind="warn">
                Fix before saving:
                <ul>{problems.map((m) => <li key={m}>{m}</li>)}</ul>
              </Notice>
            )}
            <div className="row">
              <button className="btn primary" type="button" disabled={busy || problems.length > 0}
                onClick={() => void run(async () => {
                  setError(null)
                  await repo.saveHoles(teeId, holes)
                  await load()
                  setSaved(true)
                })}>
                Save holes
              </button>
              {saved && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
            </div>
          </section>
          <section className="panel">
            <h2>Import holes from CSV</h2>
            <p className="small">Fills the table on the left. Review it, then select Save holes.</p>
            <CsvImport<HoleInput>
              id="holes"
              header={HOLE_CSV_HEADER}
              example="1,4,384,7"
              parse={parseHoleCsv}
              columns={[
                { label: 'Hole', render: (r) => (Number.isNaN(r.number) ? '?' : r.number) },
                { label: 'Par', render: (r) => (Number.isNaN(r.par) ? '?' : r.par) },
                { label: 'Yards', render: (r) => r.yardage ?? '—' },
                { label: 'SI', render: (r) => (Number.isNaN(r.strokeIndex) ? '?' : r.strokeIndex) },
              ]}
              importLabel="Put into the table"
              onImport={async (rows) => {
                setHoles([...rows].sort((a, b) => a.number - b.number))
                setSaved(false)
              }}
            />
          </section>
        </div>
      )}
    </>
  )
}

/** Course rating and slope for one tee (needed for net scoring). */
function TeeRatingForm(props: { teeName: string; rating: number | null; slope: number | null; busy: boolean; onSave: (rating: number | null, slope: number | null) => Promise<unknown> }) {
  const [rating, setRating] = useState(props.rating === null ? '' : String(props.rating))
  const [slope, setSlope] = useState(props.slope === null ? '' : String(props.slope))
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  return (
    <form className="row" style={{ marginTop: '.8rem', alignItems: 'flex-end' }} onSubmit={(e) => {
      e.preventDefault()
      const r = rating.trim() === '' ? null : Number(rating)
      const sl = slope.trim() === '' ? null : Number(slope)
      if (r !== null && (Number.isNaN(r) || r < 50 || r > 90)) return setErr('Course rating is a number like 71.4 (between 50 and 90).')
      if (sl !== null && (!Number.isInteger(sl) || sl < 55 || sl > 155)) return setErr('Slope is a whole number from 55 to 155.')
      setErr(null)
      void props.onSave(r === null ? null : Math.round(r * 10) / 10, sl).then(() => setSaved(true))
    }}>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="tee-rating">{props.teeName} course rating</label>
        <input id="tee-rating" type="text" inputMode="decimal" placeholder="e.g. 71.4" value={rating} onChange={(e) => { setRating(e.target.value); setSaved(false) }} style={{ width: 120 }} />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="tee-slope">Slope</label>
        <input id="tee-slope" type="text" inputMode="numeric" placeholder="e.g. 125" value={slope} onChange={(e) => { setSlope(e.target.value); setSaved(false) }} style={{ width: 100 }} />
      </div>
      <button className="btn" type="submit" disabled={props.busy}>Save rating</button>
      {saved && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
      <span className="small muted" style={{ flexBasis: '100%' }}>From the scorecard or the USGA Course Rating database. Needed only for net scoring.</span>
      {err && <span className="small" role="alert" style={{ color: 'var(--danger)', flexBasis: '100%' }}>{err}</span>}
    </form>
  )
}
