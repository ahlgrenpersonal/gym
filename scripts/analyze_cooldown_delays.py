"""Reproduce effective-cooldown profiling and equation comparison, privately.

No actual set-start times are available: cadence and logging are assumptions,
so extra overhead is not identified phone time. All output is aggregate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from TimeEstimator import MODEL_KINDS, TimeModel, DayPlan, error_summary, estimate, evaluate, load_history
from scripts.validate_time_estimator import aggregate_report, cross_validate, run_experiment


def cooldown_profile(sessions, rep_seconds=3.0):
    groups = defaultdict(list)
    for session in sessions:
        for previous, current in zip(session.observations, session.observations[1:]):
            a, b = previous.action, current.action
            if a.exercise_id != b.exercise_id or a.during_rest or b.during_rest or current.equipment_wait or not a.rest_seconds:
                continue
            residual = (current.completed_at - previous.completed_at).total_seconds() - a.rest_seconds - rep_seconds * b.reps - 10
            groups[f"rest|{a.rest_seconds:g}"].append(residual)
            groups[f"machine|{a.exercise_id}"].append(residual)
    return {key: {"cycles": len(values), "mean_residual_seconds": statistics.mean(values),
                  "median_residual_seconds": statistics.median(values),
                  "standard_deviation_seconds": statistics.stdev(values) if len(values) > 1 else None,
                  "negative_residual_fraction": sum(value < 0 for value in values) / len(values)}
            for key, values in sorted(groups.items())}


def adjusted_wait_sensitivity(model, development, holdout):
    """Requested prior-machine mean-gap proxy; NOT a measured queue duration.

    Replacing the whole completion gap assumes new-machine setup/service are
    comparable to a repeat cycle of the previous exercise. Keep raw primary.
    """
    ordinary = defaultdict(list)
    for session in development:
        for a, b in zip(session.observations, session.observations[1:]):
            if (a.action.exercise_id == b.action.exercise_id and not a.action.during_rest and
                    not b.action.during_rest and not b.equipment_wait):
                ordinary[a.action.exercise_id].append((b.completed_at - a.completed_at).total_seconds())
    rows = evaluate(model, holdout)
    discounts = []
    for session, row in zip(holdout, rows):
        for previous, current in zip(session.observations, session.observations[1:]):
            if current.equipment_wait and ordinary[previous.action.exercise_id]:
                proxy = statistics.mean(ordinary[previous.action.exercise_id])
                gap = (current.completed_at - previous.completed_at).total_seconds()
                discount = max(0.0, gap - proxy)
                row["actual_seconds"] -= discount
                discounts.append({"prior_machine_mean_gap_seconds": proxy, "proxy_discount_seconds": discount,
                                  "reference_cycles": len(ordinary[previous.action.exercise_id])})
    return {"metrics": error_summary(rows), "discounts": discounts,
            "interpretation": "Sensitivity only: prior-machine repeat gap substitutes a different-machine completion gap; setup/service mismatch remains unknown"}


def audit(csv_path: Path, wait_events_path: Path | None = None, cutoff="2026-09-14", seed=20260917,
          split_repeats=20, baseline_model_path: Path | None = None, benchmark_date="2026-09-18"):
    if split_repeats < 1:
        raise ValueError("split_repeats must be >=1")
    datetime.strptime(benchmark_date, "%Y-%m-%d")
    result, frozen, production = run_experiment(csv_path, cutoff, seed, wait_events_path=wait_events_path)
    events = json.loads(wait_events_path.read_text(encoding="utf-8")) if wait_events_path else None
    sessions, _ = load_history(csv_path, wait_events=events)
    development = [session for session in sessions if session.local_date < cutoff]
    holdout = [session for session in sessions if session.local_date >= cutoff]
    baseline = TimeModel.fit(development, "pooled_median")
    stability = {}
    for kind in MODEL_KINDS:
        scores = [error_summary(cross_validate(development, kind, candidate_seed))["mae_minutes"]
                  for candidate_seed in range(seed, seed + split_repeats)]
        stability[kind] = {"mean_cv_mae_minutes": statistics.mean(scores), "min_cv_mae_minutes": min(scores),
                           "max_cv_mae_minutes": max(scores), "split_repeats": split_repeats}
    report = {"version": 1, "validation": aggregate_report(result),
              "development_profile": cooldown_profile(development), "all_eligible_profile": cooldown_profile(sessions),
              "development_cadence_sensitivity": {str(cadence): cooldown_profile(development, cadence)
                                                 for cadence in (2.0, 3.0, 4.0)},
              "development_split_stability": stability,
              "baseline_raw_later_metrics": error_summary(evaluate(baseline, holdout)),
              "baseline_queue_proxy_sensitivity": adjusted_wait_sensitivity(baseline, development, holdout),
              "candidate_queue_proxy_sensitivity": adjusted_wait_sensitivity(frozen, development, holdout),
              "frozen_development_delay_seconds": frozen.cooldown_delay_fixed_seconds,
              "all_eligible_refit_delay_seconds": production.cooldown_delay_fixed_seconds,
              "limitations": ["Candidates proposed after observing this week's misses; later evaluation is retrospective, not a fresh blind test",
                              "Repeated splits overlap: they test sensitivity, not 20 independent validation samples",
                              "Default rest and exercise identity are confounded, so timer length causing phone use is not identified",
                              "The residual depends on assumed rep cadence and logging overhead; negative residuals are retained before aggregate clipping",
                              "Raw durations remain the primary target; only a separately labeled user-requested queue-proxy sensitivity discounts the confirmed wait",
                              "No schedule, PWA timer or recorded history changes; optimizer readiness still requires prospective and configuration-specific evidence"]}
    if baseline_model_path:
        old_production = TimeModel.load(baseline_model_path)
        examples = json.loads(Path(__file__).resolve().parents[1].joinpath("time_estimator_examples.json").read_text(encoding="utf-8"))
        friday = DayPlan.from_dict(examples["days"]["friday"])
        benchmark_training = [session for session in sessions if session.local_date < benchmark_date]
        # Reruns after Friday must not train Friday's benchmark on its outcome.
        benchmark_model = TimeModel.fit(benchmark_training, result["chosen_model"])
        old, new = estimate(friday, old_production), estimate(friday, benchmark_model)
        report["pre_outcome_friday_benchmarks"] = {
            "benchmark_date": benchmark_date, "candidate_training_sessions": len(benchmark_training),
            "baseline_model_sha256": hashlib.sha256(baseline_model_path.read_bytes()).hexdigest(),
            "plan": "committed Friday example, 13 straight sets, assumed 12 reps per set; no arrival/setup/warmup",
            "baseline_logged_minutes": old.logged_minutes, "candidate_logged_minutes": new.logged_minutes,
            "baseline_full_sequence_minutes": old.minutes, "candidate_full_sequence_minutes": new.minutes,
            "note": "Frozen before Friday outcomes; one future session alone cannot establish optimizer readiness"}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--wait-events", type=Path)
    parser.add_argument("--baseline-model", type=Path)
    parser.add_argument("--cutoff", default="2026-09-14")
    parser.add_argument("--seed", type=int, default=20260917)
    parser.add_argument("--split-repeats", type=int, default=20)
    parser.add_argument("--benchmark-date", default="2026-09-18", help="Freeze benchmark training before this local date")
    parser.add_argument("--output", type=Path, default=Path("outputs/time-estimator/cooldown_audit.json"))
    args = parser.parse_args()
    try:
        report = audit(args.csv, args.wait_events, args.cutoff, args.seed, args.split_repeats, args.baseline_model, args.benchmark_date)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(json.dumps({"chosen_model": report["validation"]["chosen_model"],
                          "baseline_raw_later_metrics": report["baseline_raw_later_metrics"],
                          "candidate_raw_later_metrics": report["validation"]["holdout_metrics"],
                          "candidate_queue_proxy_sensitivity": report["candidate_queue_proxy_sensitivity"],
                          "pre_outcome_friday_benchmarks": report.get("pre_outcome_friday_benchmarks"),
                          "output": str(args.output)}, indent=2))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, f"error: {error}\n")


if __name__ == "__main__":
    main()
