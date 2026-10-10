# Workout PWA maintenance

## Read before changing prescribed weights

Weight changes use the dated `WEIGHT_OVERRIDES` map in
`lib/weight-overrides.ts`, resolved by `lib/weight-fill-forward.ts`.
Read those files and README.md's "Updating prescribed weights" section first.

- For a requested weight increase/decrease, append the effective local date
  (`YYYY-MM-DD`), affected exercise IDs, and weights in pounds to the map.
- Do not implement a weight-only update by editing `defaultWeightLb` or
  `defaultWeightEffectiveLocalDate` in `lib/exercises.ts`, bumping
  `DATABASE_VERSION`, adding a database migration, or rewriting stored records.
  Existing defaults and old migrations are historical compatibility code, not
  examples to copy for new weight prescriptions.
- Preserve the selection rules: actual sets in the current session win; an
  unused effective override wins over older history; afterward actual logged
  weights carry forward (including manual reductions). Other exercises do not
  consume an override. Never rewrite workout history to apply a prescription.
- Keep past override entries. Dates have day-level granularity: a workout
  already logged on that date wins, so choose a later date if needed.
- Bump the PWA shell cache in `public/sw.js` when shipping an app update.
  Run `pnpm test` and `pnpm build`. Commit/push only when authorized.

## If a weight-update guardrail fails

`tests/weight-overrides.test.ts` pins legacy weight defaults, and
`tests/pull-weight-update.test.ts` checks an existing installation stays intact
through initialization. Their failure messages point to the override map.
Do not update those expectations merely to make a weight-only migration pass;
move the prescription to `WEIGHT_OVERRIDES` instead. Genuine schema or exercise
lifecycle changes may require intentional test updates, with a documented reason
and preservation tests. The guardrails do not forbid legitimate migrations.

## Scope and verification

- Preserve unrelated local work; `anita/` is a separate app with its own guidance.
  Do not change it as part of work on this PWA unless requested.
- The database and workout history belong to the user. Ordinary set logging
  still writes to IndexedDB; resolving a weight suggestion must not.
