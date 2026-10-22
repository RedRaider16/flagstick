# Flagstick

Golf tournament management for local events of roughly 16–120 players: set up the
course, players, teams and groups; score hole by hole on a phone; follow a live
leaderboard; finalize results with a full audit trail.

The frontend is a static site on **GitHub Pages**. Shared data, sign-in, permissions
and live updates come from **Supabase** (Postgres + Auth + Realtime). There is no
server of our own.

- **Demo mode** — `https://<you>.github.io/flagstick/demo` — fictional data that lives
  only in your browser. No account, no credentials, nothing shared. Every screen is
  labelled "Demo".
- **Live mode** — `https://<you>.github.io/flagstick/` — real, shared tournament data.
  Requires the Supabase setup below. Labelled "Live tournament data".

> Browser storage is used only by the demo. Live scoring is always written to the
> database and pushed to other devices; nothing pretends local storage is shared.

---

## Phase 1 status

**Works now**

| Area | What you can do |
|---|---|
| Events | Create (name, course, tee, date, time zone, description), move through Draft → Published → In progress → Final, pause, delete drafts |
| Formats | Individual stroke play (gross) and two-person scramble (gross), one 18-hole round |
| Courses | Courses with multiple tees; par, yardage and stroke index per hole; manual entry or validated CSV import |
| Players | Add, edit, remove; CSV import with a row-by-row preview and errors; private email/phone kept off public screens |
| Teams | Two-person teams, manual or "pair alphabetically", CSV `team` column |
| Groups | Tee-time or shotgun starts; automatic group generation; per-group tee time and starting hole; move entries between groups |
| Scorekeepers | Invite by email, assign groups; they can score only those groups |
| Score entry | Mobile hole-by-hole screen in playing order from the group's starting hole, one-tap scores, saved / saving / failed / conflict states, retry |
| Corrections | Admin grid of every hole; locked rounds require a reason; every insert/change/clear is in the history |
| Leaderboard | To par, thru, gross, ties (T2), WD/DQ, provisional vs final, configurable tie-break, live updates |
| Admin | Dashboard with setup checklist and blockers, lock/unlock, finalize, reopen (with reason), activity log |
| Output | CSV exports (leaderboard, hole-by-hole, pairings, private roster), printable pairings and scorecards |

**Not yet (later phases)** — net scoring and handicaps, skins, best ball, Stableford,
match play, flights, multi-round/multi-day, reflighting, front/back/overall
competitions, closest to the pin, payouts, leagues, offline score queue. See
[Roadmap](#roadmap) for how the data model makes room for these.

Scoring rules are specified in **[docs/SCORING.md](docs/SCORING.md)**.

---

## Run it locally

Requires Node 22.22+ (React Router 8's minimum).

```bash
npm install
npm run dev          # http://localhost:5173/flagstick/demo
npm test             # 75 tests: scoring engine + database security
npm run build        # typecheck + production build into dist/
```

Without a `.env.local`, only the demo works; `/flagstick/` explains that live mode
isn't configured. To use live mode locally, copy `.env.example` to `.env.local` and
fill in the two Supabase values.

---

## Set up live mode (Supabase) — one time

### 1. Create the project
1. At [supabase.com](https://supabase.com), create a **new project** (for example
   `flagstick`). Use a new project rather than the Rabbit Drive one: both apps have
   tables named `players`, `teams` and `scores`.
2. Wait for it to finish provisioning.

### 2. Create the database
1. **SQL Editor → New query**.
2. Paste all of `supabase/migrations/20261021000000_phase1.sql` and **Run**.
   Expect "Success. No rows returned".
3. Make yourself an organizer (only organizers can create courses and events):
   ```sql
   insert into organizers (email) values ('you@example.com');
   ```
   Use lowercase, and the same address you'll sign in with.

*(Alternatively, with the Supabase CLI: `supabase link` then `supabase db push`.)*

### 3. Configure sign-in
**Authentication → URL Configuration**
- **Site URL:** `https://redraider16.github.io/flagstick/`
- **Redirect URLs:** add `https://redraider16.github.io/flagstick/**` and, for local
  development, `http://localhost:5173/flagstick/**`

**Authentication → Emails → Magic Link template.** Add the code so people whose phone
opens the link in a different browser can type it instead:
```html
<p>Your Flagstick sign-in code: <strong>{{ .Token }}</strong></p>
<p>Or <a href="{{ .ConfirmationURL }}">sign in with this link</a>.</p>
```

**⚠ Set up custom SMTP before event day.** Supabase's built-in email sender allows
only **2 emails per hour for the whole project** — enough to test, not enough for a
dozen scorekeepers signing in on a Saturday morning. Under **Authentication → Emails →
SMTP Settings**, connect any SMTP provider (for example Resend, Brevo, Amazon SES, or
a Google Workspace / Microsoft 365 mailbox with SMTP enabled), then raise the email
rate limit under **Authentication → Rate Limits**.

### 4. Get the public connection values
**Project Settings → API Keys**: copy the **Project URL** and the **publishable key**
(`sb_publishable_…`).

The publishable key is designed to be public. Row Level Security and database
functions decide what each visitor can do. **Never** put a secret key (`sb_secret_…`)
or the legacy `service_role` key in this repository, in GitHub variables, or in the
browser.

---

## Deploy to GitHub Pages

1. Create an empty **public** repository named `flagstick` (no README).
2. Push this project to it:
   ```bash
   git remote add origin https://github.com/RedRaider16/flagstick.git
   git push -u origin main
   ```
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. Put your Project URL and publishable key in **`.env.production`** (committed).
   Both values are public by design — they end up in the site's JavaScript anyway.
   Delete the file to publish a demo-only site.
5. **Actions → Test and deploy to GitHub Pages → Run workflow** (or push to `main`).
   The workflow runs the tests, builds with the right base path
   (`/<repository-name>/`), and deploys.
6. Open `https://redraider16.github.io/flagstick/`.

If you rename the repository, the base path follows automatically. For a custom
domain, set a repository variable `VITE_BASE_PATH=/` and add the domain under
Settings → Pages.

**Deep links and refresh** — GitHub Pages has no server rewrites, so the build copies
`index.html` to `404.html`. Opening or refreshing `/flagstick/e/K7M2QX` serves that
file, the app boots, and the router shows the right page. (The HTTP status for such
a first load is 404, which browsers ignore; it only matters to search engines.)

---

## Running an event

1. **Courses → Add a course**, add a tee (e.g. "White"), enter or import the 18 holes.
2. **New event**: name, course, tee, date, format (stroke play or scramble), start
   type, and how ties are handled.
3. **Players**: add or import. For scrambles, then **Teams**.
4. **Groups**: generate groups, set tee times or shotgun holes, adjust.
5. **Scorekeepers**: add their emails, tick the groups each one scores.
6. **Overview → Publish**. Spectators can now open the leaderboard with the event code
   or link (pairings visible, no scores yet).
7. **Overview → Start scoring** when groups tee off. Scorekeepers sign in, see the event
   under "Your events", and land on their group's hole-by-hole screen.
8. Watch the leaderboard; use **Scores** to check cards and correct mistakes.
9. **Lock round** when cards are in (scorekeepers can't change anything; your
   corrections require a reason), resolve any WD/DQ, then **Finalize results**.
10. **Export & print** for CSVs and printed results.

### Roles

| Role | Can do | How they get it |
|---|---|---|
| Organizer | Create courses and events | A row in `organizers` (SQL editor) |
| Administrator | Everything in that event: setup, scores, corrections, finalize, reopen | Event creator, or added as Administrator on the Scorekeepers tab |
| Scorekeeper | Enter/clear scores for assigned groups while the event is In progress and the round is unlocked | Added on the Scorekeepers tab, then signs in with that email |
| Spectator | View published events: pairings, leaderboard, hole-by-hole cards (names only) | Event code or link; no account |

The event code only *finds* an event. It never grants edit or scoring access.

---

## How data stays correct

### Permissions are enforced in the database
- **Row Level Security** on every table. Drafts are visible to the event's staff
  only; published events are readable by anyone; contact details, the score history
  and the activity log are visible to the event's admins only.
- **Score writes go only through `set_score()` / `clear_score()`** — direct inserts,
  updates and deletes on `scores` are revoked from browser roles. The functions check
  that the caller is an admin of that event or a scorekeeper assigned to the group
  containing that entry; that the event is in progress, the round is not locked (for
  scorekeepers) or not final (for everyone); that the entry is active; and that the
  score is a whole number 1–20 on hole 1–18.
- **Status changes go only through functions** (`set_event_status`, `set_round_lock`,
  `finalize_round`, `reopen_round`, `set_entry_status`). The `status` columns can't be
  updated directly, even by admins, so every change is validated and logged.
- **Constraints** keep the data consistent: composite foreign keys make it impossible
  to put one event's entry in another event's group or round; an entry can be in only
  one group per round; a player can be on only one team per event; teams have at most
  two players; stroke indexes are unique per tee; a player or team with scores can't
  be deleted (mark them WD instead).

### Concurrent edits: optimistic concurrency per hole
Each hole score row has a `version`. A save sends the version the person last saw
(or "empty"). If someone else saved that hole in between, the database refuses with
HTTP 409 and returns the current value. The phone then shows *"Someone else changed
this hole to 5. Yours: 4"* with **Keep 5** / **Use 4**. Nothing is silently
overwritten, and two people entering the same empty hole can never create two rows
(`unique (round_id, entry_id, hole)`).

Why this rather than "last write wins" or locking: two scorekeepers rarely touch the
same hole, so conflicts are rare. When they do happen they are real disagreements
that a human should resolve, and nobody is blocked waiting for a lock.

### Audit trail
A trigger writes every score insert, change and deletion to `score_audit` (old
value, new value, who, when, reason) — including edits made directly in the SQL
editor. Status changes, locks, finalization, reopening and WD/DQ go to `event_log`.
Both appear on the **History** tab.

### Missing is never zero
A hole without a score has no row. Totals and to-par use only scored holes, the
leaderboard shows "thru", and finalizing is blocked until every active entry has 18
scores or is marked WD/DQ.

---

## Tests

`npm test` runs:

- **`tests/scoring/`** — leaderboard totals, to-par with incomplete rounds, standard
  competition ranking, both tie-break policies including multi-way ties and
  unresolvable ties, WD/DQ ordering, shotgun rotation and gap detection, score
  validation, CSV import validation and formula-injection-safe export.
- **`tests/db/`** — applies the real migration to an in-process Postgres
  ([PGlite](https://pglite.dev)) with a small emulation of Supabase's `auth.uid()`,
  `anon`/`authenticated` roles and default grants, then signs in as different users.
  It proves, among other things, that a scorekeeper can't score another event or an
  unassigned group, that spectators can't see drafts or contact details, that stale
  edits get 409, that locked/final rounds reject changes, that reopening needs a
  reason and is logged, and that browser roles can't write `scores` or change
  statuses directly.

The emulation is close to Supabase but not identical; after setting up your project,
run through the event checklist above once with a test event.

---

## Project layout

```
src/
  scoring/        pure TypeScript scoring engine (no UI, no I/O)
  domain/         types and UI-facing derivations
  data/           Repo interface; DemoRepo (browser) and SupabaseRepo (live)
  app/            routing shell, context, hooks, score saving
  pages/          screens (public leaderboard, score entry, admin tabs, print)
  components/     leaderboard, CSV import, dialogs
supabase/migrations/   schema, RLS, functions (run in order)
tests/            vitest: scoring/ and db/
docs/SCORING.md   exact scoring rules and assumptions
```

## Roadmap

The schema already separates the concepts later phases need:

- **Rounds** carry their own format, tee, start type and status, so multi-round and
  multi-day events add rows rather than columns, and different rounds can use
  different formats.
- **Entries** (the thing that's ranked) are separate from players and teams, so
  **flights** become a `flight_id` on entries (or an `entry_flights` table per round
  for reflighting), and reflighting creates new assignments without touching original
  rounds, teams or scores.
- **Best ball** needs individual scores inside a team entry: add a nullable
  `player_id` to `scores` (with a unique index that includes it) and compute the team
  score in the engine.
- **Net scoring** will store Handicap Index (with source and date), and calculate
  Course Handicap and Playing Handicap separately using tee rating/slope (already on
  `tees`) and format allowances, after checking current World Handicap System rules.
  No GHIN integration or official-compliance claims unless that is actually built and
  authorized.
- **Skins, Stableford, front/back/overall, CTP and payouts** are additional pure
  functions in `src/scoring/` over the same score rows, plus small result tables.
- **Offline scoring** will add an IndexedDB queue on the device, replayed in order
  through `set_score()`, reusing the existing version/409 conflict handling.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Connected mode isn't set up" | Check the two values in `.env.production`, push, and let the workflow redeploy |
| Sign-in email never arrives | Check spam; the built-in sender allows 2 emails/hour — set up custom SMTP |
| Sign-in link opens the site but you're not signed in | Add the site to Authentication → Redirect URLs exactly as above |
| "Only organizers can create events" | Insert your lowercase email into `organizers` |
| Scorekeeper sees no events | Their sign-in email must match the one on the Scorekeepers tab exactly |
| Scorekeeper sees "Scoring is not open" | Event must be **In progress** and the round unlocked |
| Leaderboard not updating live | Check Database → Publications → `supabase_realtime` includes `scores` (the migration adds it) |
