# Workout time estimator

This is an offline mathematical model, not a change to the PWA or routine.
It produces an ordered day's point estimate and a transparent completion
timeline. **The current cooldown model still fails the raw held-out bias gate.** It is
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

## Current explicit cooldown-overhead equations

The offline default now uses `delay_fixed`. Extra overhead is attributed to
the PREVIOUS set's cooldown, not hidden in the NEXT set's service:

`service(next) = 10 seconds + 3 seconds * next reps`

`effective rest(previous) = prescribed rest(previous) + allowance(previous)`

`straight completion gap = effective rest(previous) + transition + service(next)`

This decomposition assumes cadence/logging; it does NOT measure phone use or
actual set starts. Service offsets are fixed at 10 for explicit delay models,
preventing double counting. No allowance is charged before the first set,
after the session's last set, for a zero-rest action, or at a legacy machine
change that skips rest. Independent exercise deadlines retain effective rest
across a leg/abs filler. Whether active alternation changes delayed-start
behavior is unestablished and explicitly warned about. App timers are unchanged.

Four additional `fit --kind` equations are available:

- `delay_fixed`: mean signed residual, aggregated before clipping to zero.
- `delay_scaled`: through-origin least squares, `allowance = ratio * rest`.
- `delay_rest_group`: means per observed rest, scaled fallback for unseen rests.
- `delay_machine`: machine rest ratios, four pseudo-observations pooled toward
  the rest group. Custom-rest scaling is unvalidated extrapolation.

Only adjacent ordinary same-exercise cycles calibrate the allowance, with
residual `gap - previous rest - 3*next reps - 10`. Negative residuals remain
in statistics; clipping each sample would inflate the estimate. Cross-machine
calibration subtracts previous effective rest and next service before estimating
transition overhead. All four original equations remain load-compatible.

### Empirical observation and validation

Pre-trial development data contains 127 eligible same-machine cycles:

| Nominal rest | Cycles | Mean effective extra residual | Median |
|---|---:|---:|---:|
| 120 seconds | 61 | 17.1 seconds | 7.3 seconds |
| 180 seconds | 59 | 33.9 seconds | 15.5 seconds |
| 90 seconds (abs) | 7 | 53.5 seconds | 47.7 seconds |

Chest's mean residual is 39.6 seconds versus row's 1.6, despite identical
180-second timers. Exercise identity and default timer length are confounded;
abs/leg coverage is sparse. Longer timers CAUSING more phone use is not proved.
The audit also profiles assumed 2-, 3- and 4-second cadence sensitivity.

The fixed allowance is 26.90 seconds on 18 development sessions and 29.66
after refitting all 22 eligible sessions. The current default models roughly
2:30 or 3:30 effective rest BEFORE movement and the next set's assumed service.

| Equation | Development session-held-out CV MAE |
|---|---:|
| Previous pooled median | 2.83 min |
| Fixed extra allowance (selected) | 2.79 min |
| Scaled allowance | 2.92 min |
| Rest-group allowance | 2.87 min |
| Machine-specific allowance | 3.09 min |

This selection advantage is small, not strong evidence of superiority. Across
20 consecutive deterministic split seeds, average CV MAE is 2.82 minutes for
fixed allowance versus 2.96 for pooled median. Splits overlap: sensitivity
checks, not independent new samples. All eight candidates use identical
session-disjoint folds. Ideas were proposed after seeing later failures;
selection/coefficients use development data only but later evaluation is
retrospective, NOT a fresh blind test. Accuracy gates are unchanged.

| Raw four-session later score | Previous baseline | Fixed allowance |
|---|---:|---:|
| MAE | 4.80 min | 3.22 min |
| Bias (prediction minus actual) | -4.80 min | -2.31 min |
| Worst error | 9.59 min | 6.82 min |
| Within five minutes | 2/4 | 3/4 |

The new frozen model forecasts observed Tuesday order/reps at 37:33 versus
40:17 actual, and Thursday at 40:28 versus 47:17 actual. Thursday still misses
substantially. Raw bias exceeds the unchanged two-minute gate: NOT certified
optimizer-ready. Development p80 error is 5.98 minutes; the indicative +/-
band covers 3/4 later sessions. It is NOT a calibrated prediction interval.

The confirmed Wednesday queue is flagged by a private sidecar, never inferred
from gap length. Only its incoming calibration gap is excluded; raw targets
still include it. A separate requested sensitivity substitutes the development
mean prior-machine curl completion gap (2:51.212, 14 cycles) for the different-
machine gap, discounting 4:06.398. Comparable setup/service is assumed, NOT
measured. Under that proxy, baseline MAE is 3.80 minutes and new-model MAE is
3.50, with new bias -1.28. Discounting the wait INCREASES the new model's
Wednesday absolute error; it is not an unconditional accuracy win.

The old coefficients and pre-Friday benchmarks were preserved before observing
Friday. At 13 straight sets and assumed 12 reps, forecasts are 37:09 versus
41:14 logged span (38:16 versus 42:00 full modeled sequence), excluding
unprovided arrival/setup/warmup. Score these before refitting. One future
Friday cannot establish reliable counterfactual optimization by itself.

`time_estimator_validation.json` preserves the INITIAL baseline audit;
`time_estimator_cooldown_validation.json` records the extension. The aggregate
`time_estimator_cooldown_audit.json` adds profiles, split/cadence sensitivities,
queue-proxy comparison and frozen Friday benchmarks. None contain individual
set/session records or identifiers. Raw CSV and wait sidecar stay private.

```powershell
python scripts/analyze_cooldown_delays.py outputs/time-estimator/history.csv `
  --wait-events outputs/time-estimator/wait_events.json `
  --baseline-model outputs/time-estimator/baseline_model_before_cooldown.json `
  --benchmark-date 2026-09-18 `
  --output outputs/time-estimator/cooldown_audit.json
python scripts/validate_time_estimator.py outputs/time-estimator/history.csv `
  --wait-events outputs/time-estimator/wait_events.json `
  --output outputs/time-estimator/cooldown_experiment.json `
  --production-model outputs/time-estimator/candidate_model.json `
  --aggregate-output outputs/time-estimator/candidate_validation.json
```

The optional sidecar is an array of
`{"session_id": "ID from your CSV", "set_index": 10}` objects. The index is the
incoming gap's destination among ALL ordered submitted session sets, counting
from one, not per-exercise set number. Eligible membership, indexes and duplicate
flags are checked. The export is never rewritten. Only confirmed waits are
excluded from calibration, not arbitrary long pauses.
Benchmark training excludes sessions on or after the explicit benchmark date,
so a later rerun cannot silently train that forecast on its own outcome. The
baseline model must be the preserved pre-outcome snapshot, not a later refit.

## Initial baseline equations (retained for comparison)

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
example, the INITIAL refitted model's current-policy cable-area-to-main
group had only one observation: the reported reverse-pec wait. Its unusually
large residual inflated a never-observed lateral-raise-to-abs move. The current
default excludes that user-confirmed incoming calibration gap; an unobserved
transition now gets a fallback and sparse-data warning. Straight-set residuals are
not validated measurements of rest-overlapped filler travel. These are
documented extrapolation weaknesses, not precise physical walking costs.
Both per-pair and group sample counts are saved so future modeling can
address them without mistaking a queue episode for reliable gym geometry.

## Initial baseline validation protocol and results

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
assumptions and experiment provenance without raw records. The INITIAL model
at commit `c98d340` refitted pooled medians on all 22 eligible sessions AFTER
evaluation. The current default instead refits the fixed allowance, as described
above. Each measured later accuracy score describes its frozen development
18-session model, not this subsequently refitted model. Refit/in-sample
accuracy must not be substituted for held-out evidence.

```powershell
python TimeEstimator.py fit fresh-export.csv --kind pooled_median `
  --output outputs/time-estimator/candidate_model.json
```

`fit` calibrates, but does not validate or overwrite the default model unless
explicitly directed there. Model files have rest-default and version checks.
The default CLI includes an experimental warning. The INITIAL model's optional
development error band was +/-4.00 minutes, covering approximately 80% of
development CV errors but only 25% of this later holdout. It is explicitly
NOT a calibrated confidence/prediction interval for future sessions.

Next validation should freeze the current refitted model before observing another
week. Keep actual planned reps/order and version/rest assumptions recorded,
then assess actual completed sessions without moving thresholds or tuning
the same test outcomes. If experimenting further on this week's outcomes,
reclassify them as development data and require a new final holdout.
Validate new allocations/configurations before optimizing against a short
daily ceiling; optimize an uncertainty-aware duration, not just a point
forecast. No schedule optimization is performed in this implementation.

## Additive and multiplicative calibration experiment (September 18)

`scripts/experiment_time_calibration.py` adds a separate, reproducible experiment.
It does not modify `TimeEstimator.py`, the default coefficient file, the PWA,
or the prospective Friday benchmark frozen before Friday outcomes.

The experiment compares 11 base equations with five session corrections,
for 55 bounded combinations. Existing pooled/machine means and medians,
fixed/scaled/per-rest/per-machine cooldown models are included. Three new
machine-cycle equations use `B = previous nominal rest + 10 + 3*next reps`:

| New equation | Ordinary repeat-cycle prediction |
|---|---|
| Machine additive | `B + a[machine]` |
| Machine cycle multiplier | `k[machine] * B` |
| Machine affine cycle | `a[machine] + k[machine] * B` |

Additions are nonnegative and machine factors are at least one. The multiplier
scales both the prior rest and the next set's modeled service. Additions are
attached to the prior positive cooldown, not added to final-set recovery or
zero cooldowns. Consequently, changing machines uses the PREVIOUS machine's
rest correction and NEXT machine's service correction. Transitions are refitted
under these coefficients to avoid stacking an old offset on a new correction.
Abs/leg alternation and historical carry/legacy rest policy still use the
existing completion timeline. New custom rests/orders remain extrapolations.

Cycle coefficients minimize explicit squared residual error. Sparse machine
coefficients pool toward their default-rest group with strength four; affine
fits use an exact two-parameter nonnegative ridge solution, with cycle length
normalized by that machine's nominal 12-rep cycle. This is prediction calibration,
not identification of pure execution speed or phone delay. Machine-additive and
machine-rest-scaled equations coincide on default-rest repeat cycles, so their
agreement is not independent evidence. Affine intercepts/slopes are weakly
identified over a narrow rep range, and legs have especially few observations.

The five final session corrections are identity, fixed `1.15*T`, an MAE-fitted
multiplier, an RMSE-fitted multiplier, and an MAE-fitted additive offset.
They act on the first-to-last logged span ONLY, not warmup/setup, timers or
physiological recovery recommendations. Outputs cannot fall below an explicit
nominal-rest timeline with assumed `10+3*reps` service and zero movement.
MAE fitting checks exact piecewise-linear breakpoints; RMSE fitting checks
each floor-clipped interval's analytical minimum. Thus a fitted factor can
be below one without silently shortening the plan's prescribed rests.

Every outer test is a whole held-out session. The final correction is fitted
on three-fold INNER out-of-fold training-session predictions, not on optimistic
in-sample base fits or outer test outcomes. All combinations share the same
four development folds. Selection minimizes session-level development CV MAE,
not individual gap error or this week's already-known durations. A further
nested selection audit chooses among candidates inside each outer training
fold before evaluating that fold. Ten overlapping split seeds test sensitivity,
not ten independent datasets. The four later sessions are retrospective
diagnostics, not a fresh blind test, and do not select coefficients/candidates.

| Equation/correction | Development CV MAE | Later raw MAE |
|---|---:|---:|
| Current fixed-delay model, no final correction | 2.79 min | 3.22 min |
| Same + MAE-fitted global multiplier (selected) | 2.64 min | 3.56 min |
| Same + RMSE-fitted global multiplier | 2.78 min | 3.83 min |
| Same + MAE-fitted global offset | 2.68 min | 3.22 min |
| Same + fixed 1.15 multiplier | 6.45 min | 3.77 min |
| Machine additive, no final correction | 3.09 min | 2.74 min |
| Machine cycle multiplier, no final correction | 3.13 min | 2.71 min |
| Machine affine cycle, no final correction | 3.18 min | 2.69 min |

The development-selected global factor, refitted on 18 training sessions'
out-of-fold predictions, is **0.983709**. It reduces development CV MAE by
only about nine seconds, while worsening later raw MAE by about 20 seconds.
Its four training-fold factors range from 0.9385 to 0.9862. Across ten splits
it wins only three times; the winning equation/correction changes. Mean CV
MAE across those seeds is 2.81 versus 2.89 minutes for uncorrected fixed delay.
The fully nested candidate-selection procedure has MAE **2.89 minutes**,
not the selected candidate's more optimistic 2.64-minute score. None of these
small-sample results establishes a reliable improvement worth promoting.

The former pooled-median baseline plus fixed 1.15 happens to improve later raw
MAE from 4.80 to 2.50 minutes, but worsens development MAE from 2.83 to 4.59.
That is a warning against choosing a multiplier because it fits the week's
misses. With effective cooldown overhead already included, stacking 1.15
double-compensates on average in development and produces late-week positive
bias of 3.40 minutes for the current model.

Machine-specific corrections help some components, not all. Development
held-out cycle MAE for machine-additive versus fixed delay is 20.8 versus
30.6 seconds for row and 16.9 versus 31.7 for pushdown, but 57.4 versus 51.1
for shoulder press and 115.1 versus 102.7 for leg press (only THREE leg cycles).
These count cycles, not independent sessions; aggregate session predictions
remain the primary decision metric. A whole-session factor does not demonstrate
more accurate individual machine components.

The confirmed Wednesday reverse-pec queue stays in the primary target. The
separate prior-machine mean-cycle proxy discounts 4:06.398 from that session
without editing its records. Selected global-multiplier MAE becomes 3.51
minutes versus the uncorrected current model's 3.50; discounting the queue
does not provide clear evidence in favor of the global factor either.

```powershell
python scripts/experiment_time_calibration.py outputs/time-estimator/history.csv `
  --wait-events outputs/time-estimator/wait_events.json --repeats 10 `
  --aggregate-output time_estimator_calibration_experiment.json
python -m unittest discover -s tests -p 'test_time*.py' -v
```

The committed aggregate audit contains all candidate metrics, sample counts,
coefficients, source checksum, split sensitivity and nested-selection results.
Individual predictions remain in ignored `outputs/time-estimator/`. Synthetic
tests mutate outer-test and later outcomes and verify that their own prediction,
training correction and development selection cannot use those outcomes.
The current default and Friday forecast are intentionally preserved. Any
candidate promotion still requires prospective and configuration-specific
validation; this experiment does not declare the optimizer ready.
