# Workout time estimator

This is an offline mathematical model, not a change to the PWA or routine.
It produces an ordered day's point estimate and a transparent completion
timeline. **The initial model did not pass the held-out bias gate.** It is
experimental, and must not be used to promise a 30-minute session or declare
a proposed schedule faster.

## Use

Python 3.10 or newer; standard library only. From the repository root:

```powershell
python TimeEstimator.py estimate time_estimator_examples.json --day tuesday
python TimeEstimator.py estimate time_estimator_examples.json --day tuesday_alternating_abs --json
python -m unittest discover -s tests -p test_time_estimator.py -v
```

The examples mirror the current trial's set counts, with assumed reps. They
are NOT connected to the running app. Four chest sets are included on both
press days. Examples use the app's displayed straight-set order unless
alternation is explicitly declared.

A minimal custom day:

```json
{
  "name": "Example day",
  "initial_setup_seconds": 60,
  "warmup_seconds": 120,
  "exercises": [
    {"exercise_id": "incline_chest_press", "sets": 4, "reps": [12, 11, 10, 8]},
    {"exercise_id": "shoulder_press", "sets": 3, "reps": 10, "rest_seconds": 180}
  ]
}
```

Reps can be a scalar or one value per set. Every exercise has an independent
cooldown override. Default rest is 180 seconds for chest/shoulder presses,
row, pulldown and leg press; 120 for lateral raise, reverse pec deck, curls,
triceps and leg extension; 90 for abs. A regression test checks these against
`lib/exercises.ts`.

Optional `set_order` lists every declared set, using IDs or
`{"exercise_id": "abdominal_crunch_machine", "during_rest": true}`. Only
abs or leg exercises may fill another exercise's rest. Cable-station
alternation is rejected. The model tracks recovery independently for every
exercise, whereas the PWA currently has one global cooldown timer: a filler
can reset that timer. The estimator does NOT change that behavior. For
alternating predictions its independent recovery assumption must be followed
outside the app timer.

The Python API is `estimate(DayPlan.from_dict(document), TimeModel.load())`.
`Prediction.minutes` is the point estimate; `timeline` explains every set.
`stations` counts physical equipment: the cable exercises share a station,
but their attachment changes can still cost time.

## What duration means

The export timestamps are set submissions/completions, not set starts.
Therefore the measurable target is:

`logged span = last submitted set time - first submitted set time`

The first set's execution, arrival, initial machine setup, warm-up and departure
are not observed. The CLI reports both the modeled full set sequence and the
comparable logged span. Supplied initial setup/warm-up affects only the full
sequence. The first set's effective service duration is modeled, not measured;
its accuracy cannot be established using this export alone. No cooldown is
charged after the session's final set.

The input CSV was transcribed from the user's full log to local ignored
`outputs/time-estimator/history.csv`, retaining timestamps, exercise names,
reps and order. Weights were unnecessary and omitted. Original UUIDs were
replaced with date-local IDs. The source-data hash is recorded in the model
and validation output. Raw history is deliberately NOT committed: this
repository has a public GitHub remote. A fresh full PWA CSV works directly.

## Explicit equations

For set `j` of exercise `e`, effective service duration is:

`D(e,j) = max(10 seconds, a[e] + 3 seconds * reps[j])`

The 3-second coefficient is an explicit modeling assumption, NOT a measured
rep cadence. `a[e]` absorbs average execution/logging, side changes and other
within-machine overhead. Those components are not individually identifiable
from completion times. For unilateral exercises a logged set retains the
app's existing convention; don't independently double it without checking
what a completion record includes.

For consecutive straight sets:

`next start = previous completion + previous cooldown + transition overhead`

`next completion = next start + D(next exercise, next reps)`

For a normal same-exercise transition overhead is zero; the calibrated
service absorbs its effective overhead. A machine change still receives the
PREVIOUS machine's full cooldown, followed by calibrated movement/setup.
This intentionally follows the user's rest-then-change policy. Transition
overhead is effective residual time, not identifiable walking or queue time.

For an explicit independent-muscle filler, travel can overlap recovery:

`filler start = max(previous completion + travel, filler's own recovery deadline)`

`return start = max(filler completion + return travel, primary recovery deadline)`

The primary deadline survives the filler. If the filler takes too long, the
return is delayed. If it fits in the rest, only the otherwise idle time is
saved; neither the primary execution nor its required recovery is subtracted.

Calibration uses closed-form statistics, without an optimizer:

- Within-machine residual: `observed next-completion gap - previous rest - 3*next reps`.
- Cross-machine residual: `observed gap - applicable previous rest - predicted next service`.
- Aggregate negative offsets clip to zero; prescribed rests are never shortened to force a fit.
- Four pseudo-observations pool sparse exercise/pair estimates toward their rest-duration or area group.
- Missing transition groups use explicit fallbacks: 30 seconds for a cable attachment change; 60 otherwise.

Four equations were compared: fixed 10-second offsets with fallback transitions;
rest-group pooled medians; exercise-specific pooled medians; and
exercise-specific pooled means. The median models are typical-duration point
forecasts; summing component medians is not a guaranteed median of total time,
and does not target the expected total as a mean model would. Mean models are
more sensitive to long pauses. The equation was chosen by development MAE,
not by how well it reproduced the already-known current week.

## Historical rest-policy change

Inspection of commit `27d787b` (September 5) established that the app formerly
cleared its cooldown after an exercise's final set; afterward it retained
the cooldown when changing machines. Mixing those regimes distorts estimates
of machine-change overhead.

Historical parsing therefore supports both policies, with separate transition
statistics. In the older policy a final exercise set has no cross-machine
cooldown; within-machine cooldowns still apply. The default historical cutoff
is September 6, the first full day after that commit. **This is a deployment
proxy, not proof of which app version was used.** Historical actual customized
cooldowns and skipped rests are also absent from the export.

CSV overrides `rest_seconds` and session-consistent
`carry_rest_between_exercises` (`true`/`false`) take precedence. New JSON plans
default to `carry_rest_between_exercises: true`. Change the parsing proxy with
`--rest-policy-change-date YYYY-MM-DD`, or `none` to assume full cross-machine
rest throughout. All remaining gaps shorter than assumed required rest are
reported, retained and not mislabeled as compliance.

Sparse transition warnings are separate from exercise-service warnings. For
example, the refitted model's current-policy cable-area-to-main transition
group has only one observation: the reported reverse-pec wait. Its unusually
large residual can therefore inflate estimates for a never-observed
lateral-raise-to-abs move. Likewise straight-set transition residuals are
not validated measurements of rest-overlapped filler travel. These are
documented extrapolation weaknesses, not precise physical walking costs.
Both per-pair and group sample counts are saved so future modeling can
address them without mistaking a queue episode for reliable gym geometry.

## Validation protocol and results

There are 326 submitted sets in 28 sessions. Twenty-two sessions are eligible
for this current-exercise/current-alternation model. Six whole sessions are
excluded, not silently filtered into misleading partial-session durations:
three include different historical row equipment or retired exercises, and
three use unsupported upper-body/cable interleaving. Long pauses and known
equipment-wait intervals remain in the target. This limits coverage claims:
the model is not validated on all original training variations.

Eighteen eligible pre-September-14 sessions form development data:
8 push, 7 pull and 3 legs/abs. Deterministic four-fold splits are stratified
by workout family, holding out complete sessions, never individual sets.
They span orders and set counts. Whole-family holdouts separately stress
extrapolation. Historical rest regimes are supported, but the newer regime's
sample is small. Folds do not assume independent set-level residuals.

The selected equation is frozen on those 18 sessions and then scored on four
September-14-to-17 sessions, including the new allocation and abs alternation.
These are retrospective holdouts: their outcomes were already discussed in
the conversation. They are not claimed to be blind future predictions.
Actual reps and observed order are treated as plan inputs. Pre-workout rep
uncertainty and unobserved warm-up are not validated by these scores.

| Equation | Development CV MAE | Development bias |
|---|---:|---:|
| Fixed overhead | 4.87 min | -4.15 min |
| Pooled median (selected) | 2.83 min | -1.05 min |
| Exercise median | 2.97 min | -0.68 min |
| Exercise mean | 3.19 min | +0.72 min |

Bias is prediction minus actual; negative means optimistic.

| Held-out day | Predicted logged span | Actual logged span | Shortfall |
|---|---:|---:|---:|
| Monday | 32:27 | 32:49 | 0:23 |
| Tuesday | 35:06 | 40:17 | 5:11 |
| Wednesday | 36:51 | 40:55 | 4:03 |
| Thursday | 37:41 | 47:17 | 9:36 |

Rounding individual durations can make their rounded differences differ by
one second. Holdout MAE is **4.80 minutes**, bias **-4.80**, and worst error
**9.59**. Only two of four predictions are within five minutes. The coarse
accuracy gates are MAE <=5 minutes, absolute bias <=2, worst error <=10.
The bias gate FAILS. Those thresholds are engineering goals, not statistical
confidence guarantees and not enough to enforce a hard 30-minute ceiling.

Whole-family development holdouts have MAE 3.55 minutes for legs/abs,
2.27 for pull, 5.00 for push. The push extrapolation worst error exceeds
10 minutes. New orders involving sparsely observed leg/abs machines or cable
transitions require particular caution, not an automatic accuracy claim.

An initial policy-unaware experiment was preserved locally. Its current-week
MAE was 5.08 minutes with -5.08 bias. Correcting the independently verified
rest-policy change improved the score modestly; it did not fix the underlying
unpredicted long intervals. The correction was motivated by code evidence,
but discovered after observing holdout failures, so even the improved score
is still retrospective and needs prospective replication.

### Where the current-week misses occur

The experiment exports one residual per consecutive completion gap.
Residuals sum exactly to the session error. They describe where predictions
missed, not the physiological or behavioral cause.

Thursday had 8.65 net unpredicted minutes within machines, 1.29 on machine
changes, offset by -0.34 on alternating segments. Its three chest gaps were
6:10, 7:34 and 5:06; together they exceeded the predicted chest gaps by 6.83
minutes. A lateral-raise gap contributed another 1.67. Merely counting machines
or increasing movement allowances would miss the main problem.

Wednesday's curl-to-reverse-pec completion gap was 6:57.610. The equation
predicted approximately 4:02.333, leaving 2:55.277 unpredicted. The user
reported waiting here, but the full gap also contains prior recovery,
movement/setup and execution/logging of the FIRST reverse-pec set. Subtracting
only a 2- or 3-minute cooldown would overstate pure equipment-wait time.

Tuesday's net within-machine residual was 3.57 minutes, dominated by one
6:52 chest completion gap; machine changes added 2.08, with -0.47 on
alternating segments. Monday's nearly accurate total hides offsetting errors:
row cycles were slower than predicted while a short machine-change gap was
faster. Good total accuracy on one day is not proof every component is right.

The old and new routines both contain 61 weekly sets when the extra chest
set is included. The first four days' different durations are not by themselves
a causal test of weekly schedule efficiency: rest policy, distribution of
work, rep counts, within-machine delays, waiting and Friday exposure differ.
The lesson is to validate the timing model and control those comparisons,
not conclude that reordering can predict or eliminate every long pause.

## Reproduce and preserve the audit

```powershell
python scripts/validate_time_estimator.py outputs/time-estimator/history.csv `
  --cutoff 2026-09-14 --seed 20260917 `
  --output outputs/time-estimator/validation.json `
  --aggregate-output outputs/time-estimator/aggregate_validation.json `
  --frozen-model outputs/time-estimator/frozen_model.json `
  --production-model outputs/time-estimator/refit_model.json
```

Full per-session predictions and gap diagnostics remain under ignored
`outputs/`. `time_estimator_validation.json` commits aggregate metrics,
assumptions and experiment provenance without raw records. The committed
`time_estimator_model.json` refits the chosen equation on all 22 eligible
sessions AFTER evaluation. Its measured holdout accuracy describes the frozen
18-session model, not this subsequently refitted model. Refit/in-sample
accuracy must not be substituted for held-out evidence.

```powershell
python TimeEstimator.py fit fresh-export.csv --kind pooled_median `
  --output outputs/time-estimator/candidate_model.json
```

`fit` calibrates, but does not validate or overwrite the default model unless
explicitly directed there. Model files have rest-default and version checks.
The default CLI includes an experimental warning. Its optional historical
development error band is +/-4.00 minutes, covering approximately 80% of
development CV errors but only 25% of this later holdout. It is explicitly
NOT a calibrated confidence/prediction interval for future sessions.

Next validation should freeze this refitted model before observing another
week. Keep actual planned reps/order and version/rest assumptions recorded,
then assess actual completed sessions without moving thresholds or tuning
the same test outcomes. If experimenting further on this week's outcomes,
reclassify them as development data and require a new final holdout.
Validate new allocations/configurations before optimizing against a short
daily ceiling; optimize an uncertainty-aware duration, not just a point
forecast. No schedule optimization is performed in this implementation.
