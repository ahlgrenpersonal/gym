# Schedule experiments and timing model

This is the durable planning record for workout-schedule experiments. Update it
after each completed trial week so future schedule changes are based on measured
results rather than remembered estimates.

## Active schedule from 2026-09-21

The primary balancing variable is **time-driving sets**. Abdominal-crunch sets
performed inside shoulder-press recovery and single-leg-extension sets performed
inside reverse-pec-deck recovery are counted as physical volume but not as full
standalone time. The ordering below is intentional.

| Day | Ordered work | Physical sets | Time-driving sets | Prescribed timed rest | Effective stations | Planning estimate |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Monday | Chest 3; shoulder 2 + abs 1; lateral 3; pushdown 2; overhead extension 1 | 12 | 11 | 25 min | 3 | ~37.5 min |
| Tuesday | Pulldown 3; row 3; reverse pec 2 + leg extension 1; biceps 3 | 12 | 11 | 26 min | 4 | ~38.4 min |
| Wednesday | Chest 2; shoulder 2 + abs 2; leg press 2; lateral 3; overhead extension 2 | 13 | 11 | 26 min | 4 | ~39.5 min |
| Thursday | Pulldown 3; row 3; reverse pec 2 + leg extension 1; biceps 3 | 12 | 11 | 26 min | 4 | ~38.4 min |
| Friday | Chest 3; shoulder 2 + abs 1; lateral 3; pushdown 2; overhead extension 1 | 12 | 11 | 25 min | 3 | ~37.5 min |

These are the estimator's first-to-last logged-set point values, not promises.
Current held-out timing error is roughly three minutes for an ordinary session,
and unpredictable equipment queues can add more. Recent-performance projections
put the approximate time-driving rep loads at Monday 119, Tuesday 115,
Wednesday 123, Thursday 115, and Friday 119.

Weekly physical volume is preserved: chest 8 sets, shoulder 6, pulldown 6, row
6, reverse pec 4, lateral raise 9, biceps 6, pushdown 4, overhead extension 4,
abs 4, leg extension 2, and leg press 2 (61 total). Press/delt/triceps work is
Monday, Wednesday, Friday; pull/rear-delt/biceps work is Tuesday and Thursday.

The PWA carries the alternating relationship as explicit exercise metadata.
Alternating rows are light blue and appear immediately below the main exercise:
abs below shoulder press, and single-leg extension below reverse pec deck. When
an alternating set is logged, its cooldown cannot shorten a longer cooldown
already running from the main exercise; the timer keeps whichever end time is
later. If no cooldown is running, the alternating exercise starts its own.

## What the two measured schedules showed

Duration is measured from completion of the first logged set to completion of
the final logged set. It excludes arrival, initial setup and the first set, plus
anything after the final set. That limitation is consistent across comparisons.

| Schedule | Daily logged spans | Weekly total | Daily mean | Range | Population SD |
| --- | --- | ---: | ---: | ---: | ---: |
| Original split, 2026-09-07 to 2026-09-11 | 37:33, 35:21, 33:06, 39:07, 41:30 | 3:06:37 | 37:19 | 8:24 | 2:55 |
| Failed weekday trial, 2026-09-14 to 2026-09-18 | 32:49, 40:17, 40:55, 47:17, 32:00 | 3:13:19 | 38:40 | 15:17 | 5:40 |

The failed trial was worse for evenness and slightly worse for average time.
Its main design error was balancing exercise labels or physical stations instead
of the number and length of actual recovery intervals. It concentrated too many
sets and long-rest presses on Tuesday/Thursday while leaving Monday/Friday much
lighter. Equal station counts did not imply equal session times, and the initial
estimates did not adequately model normal post-timer overrun.

Wednesday also contains a manually identified queue anomaly: the gap from the
last biceps set at 07:58:14.086 to the first reverse-pec-deck set at 08:05:11.696
was 6:57.610. The normal preceding biceps-gap estimate is about 2:48.650, so
about 4:08.960 was equipment waiting. Removing that excess changes the failed
week to about 3:09:10 total and 37:50 per day, but its range remains 15:17 and
its standard deviation about 5:35. The schedule was therefore uneven even when
the known wait is discounted.

Friday validates the alternating-set premise: 13 physical sets, including two
leg-extension sets interleaved with biceps, produced only 11 time-driving sets
and a 32:00.454 logged span. Alternating work is not literally zero effort, but
its marginal clock cost can be close to zero when it fits inside required rest.

## Timing model

Treat a session as a sequence of completed-set timestamps, not simply as a
count of exercises:

```text
estimated session time
  = daily constant
  + sum(set execution time from reps and exercise type)
  + sum(prescribed recovery after every non-final timed set)
  + sum(empirical post-timer overrun)
  + explicit exceptional delays
```

For a gap after set `i`, the working equation is:

```text
gap(i -> i+1) = cooldown(i) + overrun(machine, cooldown) + execution(i+1)
```

Set execution is modeled from reps, with exercise-specific coefficients when
the data support them. Overrun is the ordinary delay between the timer ending
and starting/completing the next set; it may scale with cooldown length and
machine context. Fixed setup between machines is zero in the planning model
because setup normally happens during the previous cooldown. A single global
daily constant covers unobserved initial overhead. The current export cannot
identify arrival time, so that constant cannot be cleanly learned from the
first logged timestamp alone.

Exceptional queue waits must be manually annotated, removed, or corrected
before fitting. They should not be learned as normal recovery behavior. Report
both raw and queue-adjusted comparisons whenever a trial contains one.

## Estimator status and validation rules

The current simple estimator has held-out MAE 3.22 minutes, bias -2.31 minutes
(optimistic), worst error 6.82 minutes, and 3 of 4 held-out sessions within five
minutes. A more detailed gap-equation experiment improved development
cross-validation MAE to 2.03 minutes but scored 5.37 minutes on the later raw
holdout and 4.34 minutes after queue correction. It overfit and is not the
planning model. Details and reproduction commands are in
[`time-estimator.md`](time-estimator.md).

Future calibration may try bounded machine/recovery additive constants,
cooldown multipliers, rep-time coefficients, and a final global scale. Keep a
term only if it improves held-out sessions that contain varied exercise
configurations. Evaluate MAE, signed bias, worst-case error, and within-five-
minute coverage; never select a model using training error alone.

## Trial decision rule

After the active schedule has a complete Monday-Friday week:

1. Record each first-to-last-set span and manually annotate queue waits.
2. Compare both raw and queue-adjusted results with the two baselines above.
3. Prefer a daily range below 8:24, which beats the original split's evenness.
4. Treat any ordinary, queue-free day above 42 minutes as a failure to balance.
5. Preserve weekly exercise volume unless hypertrophy goals are deliberately
   changed; a faster week caused by silently deleting volume is not an
   optimization.
6. Refit or revise the estimator only after the trial is scored, then document
   the new held-out metrics here.

The schedule is designed to improve evenness because every day has exactly 11
time-driving sets and only a one-minute spread in prescribed timed rest. That is
a stronger structural basis than the failed trial, but the prediction remains a
testable hypothesis until the week is completed.
