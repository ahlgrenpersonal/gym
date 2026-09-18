"""Reproducible model experiments; all raw predictions remain local by default.

Explicit equations are compared using session-level stratified folds on
pre-cutoff data. The winning equation is then frozen before scoring the later
chronological holdout. No set from a test session calibrates its prediction.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from TimeEstimator import MODEL_KINDS, REST_POLICY_CHANGE_DATE, Session, TimeModel, diagnose, error_summary, evaluate, load_history


def folds(sessions: list[Session], seed: int = 20260917, count: int = 4) -> list[list[Session]]:
    """Group every set from a session; spread push/pull/legs across folds."""
    strata = defaultdict(list)
    for session in sessions:
        strata[session.workout_type].append(session)
    result = [[] for _ in range(count)]
    rng = random.Random(seed)
    offset = 0
    for key in sorted(strata):
        group = list(strata[key])
        rng.shuffle(group)
        for index, session in enumerate(group):
            result[(offset + index) % count].append(session)
        offset += len(group)
    return [group for group in result if group]


def cross_validate(sessions: list[Session], kind: str, seed: int = 20260917) -> list[dict]:
    rows = []
    for index, test in enumerate(folds(sessions, seed)):
        test_ids = {session.session_id for session in test}
        training = [session for session in sessions if session.session_id not in test_ids]
        if not training:
            raise ValueError("Too few sessions for cross validation")
        predictions = evaluate(TimeModel.fit(training, kind), test)
        rows.extend({**row, "fold": index} for row in predictions)
    return rows


def configuration_stress(sessions: list[Session], kind: str) -> dict:
    """Hold out each whole workout family; tests extrapolation, not selection."""
    result = {}
    for family in sorted({session.workout_type for session in sessions}):
        train = [session for session in sessions if session.workout_type != family]
        test = [session for session in sessions if session.workout_type == family]
        if train:
            result[family] = error_summary(evaluate(TimeModel.fit(train, kind), test))
    return result


def run_experiment(csv_path: Path, cutoff: str = "2026-09-14", seed: int = 20260917,
                   rest_policy_change_date: str | None = REST_POLICY_CHANGE_DATE,
                   wait_events_path: Path | None = None) -> tuple[dict, TimeModel, TimeModel]:
    wait_events = json.loads(wait_events_path.read_text(encoding="utf-8")) if wait_events_path else None
    if wait_events is not None and not isinstance(wait_events, list):
        raise ValueError("Wait-events file must contain an array")
    sessions, diagnostics = load_history(csv_path, rest_policy_change_date, wait_events)
    diagnostics["wait_events_sha256"] = (hashlib.sha256(wait_events_path.read_bytes()).hexdigest()
                                         if wait_events_path else None)
    development = [session for session in sessions if session.local_date < cutoff]
    holdout = [session for session in sessions if session.local_date >= cutoff]
    if len(development) < 8 or len(holdout) < 2:
        raise ValueError("Need >=8 development and >=2 chronological holdout sessions")
    candidates = {}
    cv_rows = {}
    for kind in MODEL_KINDS:
        cv_rows[kind] = cross_validate(development, kind, seed)
        candidates[kind] = error_summary(cv_rows[kind])
    # Selection never reads the chronological test outcomes.
    chosen = min(MODEL_KINDS, key=lambda kind: (candidates[kind]["mae_minutes"], MODEL_KINDS.index(kind)))
    frozen = TimeModel.fit(development, chosen)
    test_rows = evaluate(frozen, holdout)
    holdout_metrics = error_summary(test_rows)
    # These are useful coarse-forecast gates, not guarantees of a 30-min ceiling.
    gates = {"mae_at_most_5_minutes": holdout_metrics["mae_minutes"] <= 5,
             "absolute_bias_at_most_2_minutes": abs(holdout_metrics["bias_minutes"]) <= 2,
             "worst_error_at_most_10_minutes": holdout_metrics["worst_absolute_error_minutes"] <= 10}
    production = TimeModel.fit(sessions, chosen)
    production.empirical_error_seconds = candidates[chosen]["absolute_error_p80_seconds"]
    production.error_sample_count = len(development)
    validation = {"status": "retrospective_only" if all(gates.values()) else "experimental_failed_forecast_gates",
                  "coarse_forecast_gates_pass": all(gates.values()), "coarse_forecast_gates": gates,
                  "holdout_metrics": holdout_metrics, "development_cv_metrics": candidates[chosen],
                  "input_sha256": diagnostics["input_sha256"], "cutoff": cutoff, "seed": seed,
                  "rest_policy_change_date_proxy": rest_policy_change_date,
                  "requires_prospective_validation": True}
    frozen.validation = validation
    production.validation = validation
    result = {"version": 1, "target": "first-to-last completed/logged set span; first-set time excluded",
              "selection": "lowest development session-level four-fold CV MAE; candidate ideas are retrospective, later outcomes not used to select coefficients or equation",
              "cutoff": cutoff, "seed": seed, "diagnostics": diagnostics,
              "development_sessions": len(development), "holdout_sessions": len(holdout),
              "candidate_cv": candidates, "chosen_model": chosen,
              "development_predictions": cv_rows[chosen], "holdout_metrics": holdout_metrics,
              "holdout_predictions": test_rows, "coarse_forecast_gates": gates,
              "holdout_gap_diagnostics": {session.local_date: diagnose(frozen, session) for session in holdout},
              "coarse_forecast_gates_pass": all(gates.values()),
              "configuration_stress_development_only": configuration_stress(development, chosen),
              "production_refit_sessions": len(sessions),
              "limitations": ["Retrospective holdout: these outcomes were already discussed in chat; a future unseen week is still needed",
                              "Actual reps/order used as planned inputs; pre-workout rep uncertainty not validated",
                              "Historical customized cooldowns/skips are not exported; defaults assumed",
                              "Excluded configurations and all short-cooldown gaps are disclosed in diagnostics",
                              "Only user-confirmed waiting gaps are excluded from calibration via optional sidecar; all validation targets retain long intervals",
                              "Explicit cooldown-overhead equations fix cadence/logging at 3 seconds per rep plus 10 seconds; residuals are not identifiable phone delays",
                              "Machine and default cooldown duration are confounded; custom-rest scaling and delay effects during alternation require prospective testing",
                              "Production model refits all eligible sessions AFTER evaluation; holdout score describes frozen development model",
                              "80th-percentile CV absolute-error range is indicative, not a calibrated confidence interval",
                              "Whole-family holdouts test extrapolation; sparse legs/abs coverage limits new allocation claims"]}
    return result, frozen, production


def aggregate_report(result: dict) -> dict:
    """Shareable audit: no individual set/session records or identifiers."""
    diagnostic = result["diagnostics"]
    chosen = result["chosen_model"]
    radius = result["candidate_cv"][chosen]["absolute_error_p80_seconds"]
    test = result["holdout_predictions"]
    return {"version": 1, "target": result["target"], "selection": result["selection"],
            "source_sha256": diagnostic["input_sha256"], "cutoff": result["cutoff"], "seed": result["seed"],
            "input_rows": diagnostic["input_rows"], "input_sessions": diagnostic["input_sessions"],
            "eligible_sessions": diagnostic["eligible_sessions"],
            "excluded_session_count": len(diagnostic["excluded_sessions"]),
            "short_assumed_cooldown_gap_count": len(diagnostic["gaps_shorter_than_assumed_required_rest"]),
            "rest_policy_change_date_proxy": diagnostic["historical_rest_policy_change_date_proxy"],
            "rest_policy_source": diagnostic["historical_rest_policy_source"], "rest_source": diagnostic["rest_source"],
            "user_confirmed_wait_gap_count": diagnostic["user_confirmed_wait_gap_count"],
            "wait_events_sha256": diagnostic["wait_events_sha256"],
            "development_sessions": result["development_sessions"], "holdout_sessions": result["holdout_sessions"],
            "candidate_cv": result["candidate_cv"], "chosen_model": chosen,
            "holdout_metrics": result["holdout_metrics"], "coarse_forecast_gates": result["coarse_forecast_gates"],
            "coarse_forecast_gates_pass": result["coarse_forecast_gates_pass"],
            "configuration_stress_development_only": result["configuration_stress_development_only"],
            "production_refit_sessions": result["production_refit_sessions"],
            "indicative_development_error_band_minutes": radius / 60,
            "development_band_coverage_on_later_holdout": sum(abs(row["error_seconds"]) <= radius for row in test) / len(test),
            "limitations": result["limitations"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--cutoff", default="2026-09-14")
    parser.add_argument("--seed", type=int, default=20260917)
    parser.add_argument("--wait-events", type=Path, help="Private JSON array of user-confirmed incoming gaps: session_id and 1-based set_index")
    parser.add_argument("--rest-policy-change-date", default=REST_POLICY_CHANGE_DATE,
                        help="Historical deployment proxy; use 'none' to assume current full cooldown throughout")
    parser.add_argument("--output", type=Path, default=Path("outputs/time-estimator/validation.json"))
    parser.add_argument("--production-model", type=Path, help="Optionally save coefficients after all-data refit")
    parser.add_argument("--frozen-model", type=Path, help="Optionally save development-only model")
    parser.add_argument("--aggregate-output", type=Path, help="Save an audit without raw session records")
    args = parser.parse_args()
    try:
        policy_date = None if args.rest_policy_change_date == "none" else args.rest_policy_change_date
        result, frozen, production = run_experiment(args.csv, args.cutoff, args.seed, policy_date, args.wait_events)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        if args.production_model:
            production.save(args.production_model)
        if args.frozen_model:
            frozen.save(args.frozen_model)
        if args.aggregate_output:
            args.aggregate_output.parent.mkdir(parents=True, exist_ok=True)
            args.aggregate_output.write_text(json.dumps(aggregate_report(result), indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(json.dumps({"chosen_model": result["chosen_model"], "candidate_cv": result["candidate_cv"],
                          "holdout_metrics": result["holdout_metrics"], "holdout_predictions": result["holdout_predictions"],
                          "coarse_forecast_gates": result["coarse_forecast_gates"],
                          "excluded_sessions": result["diagnostics"]["excluded_sessions"],
                          "configuration_stress": result["configuration_stress_development_only"],
                          "output": str(args.output)}, indent=2))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, f"error: {error}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
