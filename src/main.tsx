import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import './styles.css'
import { NotFound, Shell } from './app/Shell'
import { Home } from './pages/Home'
import { SignIn } from './pages/SignIn'
import { NewEvent } from './pages/NewEvent'
import { Courses, CourseEditor } from './pages/Courses'
import { PublicEvent } from './pages/PublicEvent'
import { Register } from './pages/Register'
import { Registrations } from './pages/manage/Registrations'
import { ManageLayout } from './pages/manage/ManageLayout'
import { Overview } from './pages/manage/Overview'
import { Setup } from './pages/manage/Setup'
import { Players } from './pages/manage/Players'
import { Teams } from './pages/manage/Teams'
import { Groups } from './pages/manage/Groups'
import { Staff } from './pages/manage/Staff'
import { AdminScores } from './pages/manage/AdminScores'
import { History } from './pages/manage/History'
import { Exports } from './pages/manage/Exports'
import { PrintPairings, PrintScorecards } from './pages/manage/Print'
import { ScoreHome, ScoreGroup } from './pages/ScoreEntry'

const pages: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: 'signin', element: <SignIn /> },
  { path: 'new', element: <NewEvent /> },
  { path: 'courses', element: <Courses /> },
  { path: 'courses/:courseId', element: <CourseEditor /> },
  { path: 'e/:code', element: <PublicEvent /> },
  { path: 'e/:code/register', element: <Register /> },
  { path: 'score/:eventId', element: <ScoreHome /> },
  { path: 'score/:eventId/:groupId', element: <ScoreGroup /> },
  { path: 'manage/:eventId/print/pairings', element: <PrintPairings /> },
  { path: 'manage/:eventId/print/scorecards', element: <PrintScorecards /> },
  {
    path: 'manage/:eventId',
    element: <ManageLayout />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'setup', element: <Setup /> },
      { path: 'registration', element: <Registrations /> },
      { path: 'players', element: <Players /> },
      { path: 'teams', element: <Teams /> },
      { path: 'groups', element: <Groups /> },
      { path: 'staff', element: <Staff /> },
      { path: 'scores', element: <AdminScores /> },
      { path: 'history', element: <History /> },
      { path: 'exports', element: <Exports /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]

const router = createBrowserRouter(
  [
    { path: '/demo', element: <Shell mode="demo" />, children: pages },
    { path: '/', element: <Shell mode="live" />, children: pages },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
