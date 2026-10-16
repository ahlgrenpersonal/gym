# Workout PWA

A mobile-first, offline-capable weekday gym tracker. The active routine uses 11–12
time-driving sets plus two alternating sets per day. Abs, single-leg extensions,
and seated leg curls share recovery windows. It retains the previous classic split as
a reversible preset. Workout data stays in the browser's
IndexedDB database; this repository contains no user workout records.

## Use the hosted app

After GitHub Pages is enabled with **GitHub Actions** as its source, the app is
available at:

<https://ahlgrenpersonal.github.io/gym/>

On iPhone, open that address in Safari, tap **Share**, then **Add to Home
Screen**.

## Run locally

Requires Node.js 22.13 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

## Verify and build

```bash
pnpm test
pnpm lint
pnpm build
```

The production build uses `/gym/` as its base path for GitHub Pages. The
service worker caches the app shell for offline use without storing workout
records in the cache.

## Planning notes

- [Schedule experiments and timing model](docs/schedule-experiments.md)
- [Workout time estimator](docs/time-estimator.md)

## Alternating-set schedule (October 13 update)

| Day | Main exercise above ALT rows | Alternating work |
| --- | --- | --- |
| Monday / Friday | Shoulder press | Abs 1 + single-leg extension 1 (each leg) |
| Tuesday / Thursday | Reverse pec deck | Abs 1 + seated leg curl 1 |
| Wednesday | Shoulder press | Abs 2; no alternating leg work; leg press finishes the day |

Both ALT rows stay together directly below their main exercise. Choose either
when a machine is available, between its sets or after its final set; the app
does not force an interleaving order. Logging any ALT leaves the cooldown
entirely unchanged, including when no timer is running. Do not pair them with
chest press, pulldown, or the separate cable station.

After the final set of an ALT exercise, selection returns to the most recently
logged non-ALT exercise in that session that still has sets left. If none is
available, it searches upward for the nearest unfinished row, then downward.
Unfinished ALT siblings and deferred rows are eligible for this fallback.
The return target is derived from saved sets, so reopening the app preserves
this behavior without new database fields. Normal exercise advancement and
ALT cooldown suppression are unchanged.

The seated leg curl starts at 1 set of 10–15 reps on each pull day. It originally
had no prescribed starting weight; the October 17 override now suggests 90 lb
as a provisional calibration load. Chest press also moves to 90 lb on that date,
after the October 16 workout. Actual logged weights, including manual reductions,
carry forward after each override is used. Unknown starting weights remain blank
instead of suggesting the old generic 100 lb fallback. Main-exercise sets are unchanged.

New definitions are added by `ensureDefaults` without a schema migration.
An opened day is a preview, not "in progress", until at least one set is logged
(including an ALT set). `lib/workout-session.ts` refreshes a same-day empty preview
from the current routine whenever opened, so it picks up new exercise ordering.
It reuses the empty session ID and replaces only its queue; no workout history is
rewritten. Once any set is saved, reopening preserves that session's order,
targets, progress and cooldown. Completed and previous-day sessions are untouched.
The set check and preview refresh run in one database transaction. Regression
coverage lives in `tests/workout-session.test.tsx`.

The main menu shows **COMPLETED THIS WEEK** for each plan day with a completed
session in the current local Monday–Sunday week. This is derived from saved
sessions, not a separate flag: it resets next Monday and remains visible during
an empty preview or an in-progress repeat (alongside the progress text). Completion
uses the finish timestamp, falling back to the start timestamp for older records.
Buttons and workout-opening behavior are unchanged: repeating a completed day
creates a separate session ID and never overwrites its prior sets. No migration
or history rewrite is needed. Weekly boundary and menu rendering tests live in
`tests/weekly-completion.test.tsx`.

## Updating prescribed weights

Repository-level assistant instructions in [AGENTS.md](AGENTS.md) direct future
coding sessions here before any weight update. The database and default-exercise
code also point to the override map at the places where a mistaken update would
otherwise start.

Add dated entries to `WEIGHT_OVERRIDES` in `lib/weight-overrides.ts`. Dates use
the workout's local calendar (`YYYY-MM-DD`); weights are in pounds and are
converted for kilogram display. For example, the October 10 update sets lat
pulldowns to 110 lb and biceps curls to 35 lb. Future changes need only a new
date with the affected exercise IDs and weights, plus the usual PWA cache bump
in `public/sw.js`. Do not change the database version or rewrite old defaults.

Weight selection follows this order:

1. The latest actual set in the current session, including manual adjustments.
2. The newest effective override for that exercise, if its latest earlier
   workout predates the override (or it has no history).
3. The existing carry-forward rule: set 2 of the latest earlier workout with
   that exercise, falling back to set 1. Legacy starting defaults remain the
   fallback for exercises without newer history.

Once a set is logged on/after the override date, actual weights take over again,
even if the user chose a lighter weight. Workouts without that exercise do not
consume its override. Skipping weeks does not expire an unused override, and
future-dated entries do not apply early. Keep older entries for historical-date
resolution. Dates intentionally have day-level granularity: a workout already
logged on the effective date takes precedence; use a later effective date when
the update should follow that workout. Avoid retroactively editing used entries.

Run `pnpm test` and `pnpm build` after changes. Tests cover override data validity,
date selection, manual adjustments, multiple updates, existing installations,
unit conversion, and the visible override label. No logged history is rewritten.

Guardrails in `tests/weight-overrides.test.ts` pin the existing legacy weight
baselines; `tests/pull-weight-update.test.ts` verifies that opening and initializing
an existing installation preserves its records. Failures explicitly direct the
developer to `WEIGHT_OVERRIDES`, rather than a weight-only database migration.
Do not relax these assertions for ordinary weight updates. Legitimate schema or
exercise lifecycle changes can update the tests deliberately, with an explanation.

## Data safety

- Each completed set is stored locally with its entered weight, rep count,
  exercise ID, weekday or legacy workout type, epoch timestamp, and local ISO
  datetime.
- A workout resumes on the same local calendar day. Unfinished workouts are
  archived at the next local midnight and remain available in History.
- JSON backup and CSV export are available in Settings.
- Replacing a phone, clearing Safari website data, or removing the installed
  PWA may remove local IndexedDB data, so export backups regularly.
