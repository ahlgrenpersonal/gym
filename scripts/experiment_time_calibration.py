"""Offline additive/multiplicative experiments; never overwrite the default model.

Machine coefficients use ordinary, unflagged repeat cycles. Session corrections
are fitted to INNER out-of-fold predictions, never to the outer test outcomes.
An outer nested selection audit guards against choosing a lucky candidate.
Python 3.10+, standard library only. Raw records stay under ignored outputs/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from TimeEstimator import (
    MACHINES, MODEL_KINDS, REP_SECONDS, SERVICE_FLOOR_SECONDS, SHRINKAGE_SAMPLES,
    DayPlan, PlannedSet, Session, TimeModel, error_summary, estimate, evaluate,
    load_history, transition_key,
)
from scripts.validate_time_estimator import folds


MACHINE_KINDS = ("machine_additive", "machine_cycle_scaled", "machine_cycle_affine")
BASE_KINDS = MODEL_KINDS + MACHINE_KINDS
GLOBAL_KINDS = ("identity", "fixed_1_15", "multiplier_mae", "multiplier_rmse", "offset_mae")
CANDIDATES = tuple(f"{base}|{correction}" for base in BASE_KINDS for correction in GLOBAL_KINDS)


def nonnegative_affine(samples, prior=(0.0, 0.0), strength=SHRINKAGE_SAMPLES):
    """Exact 2-variable nonnegative ridge least squares, including boundaries.

Samples are (dimensionless x, seconds y). Penalties on a and b have equal
units: strength*((a-prior_a)^2+(b-prior_b)^2). No optional dependencies.
"""
    if not samples:
        return prior
    n = len(samples) + strength
    sx = sum(x for x, _ in samples)
    sxx = sum(x * x for x, _ in samples) + strength
    sy = sum(y for _, y in samples) + strength * prior[0]
    sxy = sum(x * y for x, y in samples) + strength * prior[1]
    possibilities = [(0.0, 0.0), (max(0.0, sy / n), 0.0),
                     (0.0, max(0.0, sxy / sxx))]
    determinant = n * sxx - sx * sx
    if determinant > 1e-10:
        a, b = (sy * sxx - sx * sxy) / determinant, (n * sxy - sx * sy) / determinant
        if a >= 0 and b >= 0:
            possibilities.append((a, b))
    return min(possibilities, key=lambda pair: sum((y - pair[0] - pair[1] * x) ** 2
                                                  for x, y in samples) + strength *
               ((pair[0] - prior[0]) ** 2 + (pair[1] - prior[1]) ** 2))


@dataclass
class MachineCalibration(TimeModel):
    machine_additions: dict[str, float] = field(default_factory=dict)
    machine_multipliers: dict[str, float] = field(default_factory=dict)

    def cooldown_delay_seconds(self, action: PlannedSet) -> float:
        if action.rest_seconds == 0:
            return 0.0
        return self.machine_additions.get(action.exercise_id, 0.0) + (
            self.machine_multipliers.get(action.exercise_id, 1.0) - 1.0) * action.rest_seconds

    def service_seconds(self, action: PlannedSet) -> float:
        return self.machine_multipliers.get(action.exercise_id, 1.0) * (
            SERVICE_FLOOR_SECONDS + REP_SECONDS * action.reps)


def fit_base(sessions: list[Session], kind: str) -> TimeModel:
    if kind in MODEL_KINDS:
        return TimeModel.fit(sessions, kind)
    if not sessions or kind not in MACHINE_KINDS:
        raise ValueError("Unknown machine model or empty training set")
    # B = nominal repeat cycle. y = observed extra seconds beyond that cycle.
    samples, pools = defaultdict(list), defaultdict(list)
    for session in sessions:
        for previous, current in zip(session.observations, session.observations[1:]):
            a, b = previous.action, current.action
            if (a.exercise_id == b.exercise_id and not a.during_rest and not b.during_rest
                    and not current.equipment_wait and a.rest_seconds > 0):
                base = a.rest_seconds + SERVICE_FLOOR_SECONDS + REP_SECONDS * b.reps
                residual = (current.completed_at - previous.completed_at).total_seconds() - base
                samples[a.exercise_id].append((base, residual))
                pools[MACHINES[a.exercise_id].rest_seconds].append((base, residual))
    model = MachineCalibration(kind, {key: 10.0 for key in MACHINES}, {}, {},
                               {key: len(samples[key]) for key in MACHINES}, len(sessions))
    model.excluded_wait_calibration_gaps = sum(row.equipment_wait for session in sessions
                                             for row in session.observations[1:])
    for exercise, machine in MACHINES.items():
        values, pool = samples[exercise], pools[machine.rest_seconds]
        reference = machine.rest_seconds + SERVICE_FLOOR_SECONDS + REP_SECONDS * 12
        pooled_addition = max(0.0, statistics.mean(y for _, y in pool)) if pool else 0.0
        pooled_ratio = max(0.0, sum(x * y for x, y in pool) / sum(x * x for x, _ in pool)) if pool else 0.0
        if kind == "machine_additive":
            addition = max(0.0, (sum(y for _, y in values) + SHRINKAGE_SAMPLES * pooled_addition) /
                           (len(values) + SHRINKAGE_SAMPLES))
            ratio = 0.0
        elif kind == "machine_cycle_scaled":
            addition = 0.0
            ratio = max(0.0, (sum(x * y for x, y in values) +
                              SHRINKAGE_SAMPLES * reference ** 2 * pooled_ratio) /
                        (sum(x * x for x, _ in values) + SHRINKAGE_SAMPLES * reference ** 2))
        else:
            # Cycle lengths vary by reps. Pooling is deliberately conservative:
            # 4 pseudo-observations toward group addition and zero extra slope.
            addition, slope = nonnegative_affine([(x / reference, y) for x, y in values],
                                                (pooled_addition, 0.0))
            ratio = slope / reference
        model.machine_additions[exercise] = addition
        model.machine_multipliers[exercise] = 1.0 + ratio
    # Recalibrate transition residuals under the NEW rest/service coefficients.
    # Never stack old transition estimates on top of new machine allowances.
    groups, pairs = defaultdict(list), defaultdict(list)
    for session in sessions:
        for index, (previous, current) in enumerate(zip(session.observations, session.observations[1:])):
            a, b = previous.action, current.action
            if a.exercise_id == b.exercise_id or a.during_rest or b.during_rest or current.equipment_wait:
                continue
            final = all(row.action.exercise_id != a.exercise_id for row in session.observations[index + 1:])
            rest = model.effective_rest_seconds(a) if session.carry_rest_between_exercises or not final else 0.0
            residual = (current.completed_at - previous.completed_at).total_seconds() - rest - model.service_seconds(b)
            prefix = "carry|" if session.carry_rest_between_exercises else "legacy|"
            groups[prefix + transition_key(a.exercise_id, b.exercise_id)].append(residual)
            pairs[f"{prefix}{a.exercise_id}->{b.exercise_id}"].append(residual)
    for key, values in groups.items():
        model.transition_seconds[key] = max(0.0, statistics.mean(values))
        model.transition_sample_counts[key] = len(values)
    for key, values in pairs.items():
        policy, names = key.split("|")
        a, b = names.split("->")
        fallback = model.movement_seconds(a, b, policy == "carry")
        model.transition_pairs[key] = max(0.0, (sum(values) + SHRINKAGE_SAMPLES * fallback) /
                                          (len(values) + SHRINKAGE_SAMPLES))
        model.transition_sample_counts[key] = len(values)
    return model


class NominalFloor(TimeModel):
    """Nominal rests plus assumed 10+3*reps service, zero transition overhead."""
    def movement_seconds(self, previous, current, carry=True):
        return 0.0


def floor_seconds(plan: DayPlan) -> float:
    model = NominalFloor("fixed", {key: 10.0 for key in MACHINES}, {}, {}, {}, 1)
    return estimate(plan, model).logged_minutes * 60


def base_rows(model, sessions):
    return [{**row, "floor_seconds": floor_seconds(session.plan)}
            for row, session in zip(evaluate(model, sessions), sessions)]


def cross_fitted_base(sessions, kind, seed, count=3):
    rows = []
    for test in folds(sessions, seed, count):
        ids = {session.session_id for session in test}
        train = [session for session in sessions if session.session_id not in ids]
        if not train:
            raise ValueError("Need multiple training sessions for cross-fitting")
        rows.extend(base_rows(fit_base(train, kind), test))
    return rows


@dataclass(frozen=True)
class GlobalCorrection:
    kind: str = "identity"
    multiplier: float = 1.0
    offset_seconds: float = 0.0

    def apply(self, predicted, floor):
        return max(floor, self.multiplier * predicted + self.offset_seconds)


def fit_global(rows, kind):
    """Minimize TRAINING-OOF session loss, not set-gap or final test loss.

L1 candidates are its piecewise-linear breakpoints. L2 checks each active
floor-clipped interval analytically. This also permits fitted factors <1
without producing a prediction below the nominal timeline floor.
"""
    if not rows or kind not in GLOBAL_KINDS:
        raise ValueError("Unknown correction or empty calibration predictions")
    values = [(row["predicted_seconds"], row["actual_seconds"], row["floor_seconds"]) for row in rows]
    if any(not all(math.isfinite(v) for v in triple) or triple[0] <= 0 or
           triple[1] <= 0 or triple[2] < 0 for triple in values):
        raise ValueError("Global calibration requires finite positive spans and nonnegative floors")
    if kind in ("identity", "fixed_1_15"):
        return GlobalCorrection(kind, 1.15 if kind == "fixed_1_15" else 1.0)
    if kind == "offset_mae":
        candidates = {0.0} | {y - p for p, y, _ in values} | {f - p for p, _, f in values}
        offset = min(candidates, key=lambda a: (sum(abs(max(f, p + a) - y) for p, y, f in values), abs(a), a))
        return GlobalCorrection(kind, 1.0, offset)
    candidates = {0.0, 1.0} | {y / p for p, y, _ in values} | {f / p for p, _, f in values}
    if kind == "multiplier_rmse":
        boundaries = sorted({0.0} | {f / p for p, _, f in values}) + [math.inf]
        for lo, hi in zip(boundaries, boundaries[1:]):
            probe = (lo + hi) / 2 if math.isfinite(hi) else lo + 1
            active = [(p, y) for p, y, f in values if p * probe > f]
            if active:
                factor = sum(p * y for p, y in active) / sum(p * p for p, _ in active)
                if lo <= factor <= hi:
                    candidates.add(factor)
    power = 2 if kind == "multiplier_rmse" else 1
    factor = min(candidates, key=lambda k: (sum(abs(max(f, k * p) - y) ** power for p, y, f in values), abs(k - 1), k))
    return GlobalCorrection(kind, factor)


def corrected_rows(rows, correction, **metadata):
    result = []
    for row in rows:
        seconds = correction.apply(row["predicted_seconds"], row["floor_seconds"])
        result.append({**row, "base_predicted_seconds": row["predicted_seconds"],
                       "predicted_seconds": seconds, "error_seconds": seconds - row["actual_seconds"],
                       "global_multiplier": correction.multiplier,
                       "global_offset_seconds": correction.offset_seconds, **metadata})
    return result


def repeat_gap_rows(model, sessions):
    """Machine accuracy before global session correction; never infer waits."""
    groups = defaultdict(list)
    for session in sessions:
        timeline = estimate(session.plan, model).timeline
        for index, (a, b) in enumerate(zip(session.observations, session.observations[1:])):
            if (a.action.exercise_id == b.action.exercise_id and not a.action.during_rest
                    and not b.action.during_rest and not b.equipment_wait):
                groups[a.action.exercise_id].append({
                    "actual_seconds": (b.completed_at - a.completed_at).total_seconds(),
                    "predicted_seconds": timeline[index + 1]["completion_seconds"] - timeline[index]["completion_seconds"],
                })
    return groups


def repeat_gap_summary(rows):
    """Expose cycle denominators and seconds, not misleading 'sessions'."""
    metrics = error_summary(rows)
    return {"cycles": metrics["sessions"], "mae_seconds": 60 * metrics["mae_minutes"],
            "bias_seconds": 60 * metrics["bias_minutes"], "rmse_seconds": 60 * metrics["rmse_minutes"],
            "worst_absolute_error_seconds": 60 * metrics["worst_absolute_error_minutes"]}


def repeat_gap_cv(sessions, seed):
    combined = {base: defaultdict(list) for base in BASE_KINDS}
    for test in folds(sessions, seed):
        ids = {session.session_id for session in test}
        training = [session for session in sessions if session.session_id not in ids]
        for base in BASE_KINDS:
            for machine, rows in repeat_gap_rows(fit_base(training, base), test).items():
                combined[base][machine].extend(rows)
    return {base: {machine: repeat_gap_summary(rows) for machine, rows in groups.items()}
            for base, groups in combined.items()}


def compare_cv(sessions, seed=20260917, count=4):
    """Outer test sessions never enter base fits OR global-correction fits."""
    results = {key: [] for key in CANDIDATES}
    for index, test in enumerate(folds(sessions, seed, count)):
        ids = {session.session_id for session in test}
        train = [session for session in sessions if session.session_id not in ids]
        for base in BASE_KINDS:
            training_oof = cross_fitted_base(train, base, seed + 100 + index)
            predictions = base_rows(fit_base(train, base), test)
            for strategy in GLOBAL_KINDS:
                correction = fit_global(training_oof, strategy)
                results[f"{base}|{strategy}"].extend(corrected_rows(predictions, correction, fold=index))
    return results


def choose(metrics):
    return min(CANDIDATES, key=lambda key: (metrics[key]["mae_minutes"], CANDIDATES.index(key)))


def fit_pipeline(training, candidate, seed):
    base, strategy = candidate.split("|")
    correction = fit_global(cross_fitted_base(training, base, seed), strategy)
    return fit_base(training, base), correction


def nested_selection(sessions, seed):
    """Audit the complete candidate-choice procedure on still-untouched folds."""
    rows, choices = [], []
    for index, test in enumerate(folds(sessions, seed)):
        ids = {session.session_id for session in test}
        training = [session for session in sessions if session.session_id not in ids]
        inner = compare_cv(training, seed + 1000 + index, count=3)
        selected = choose({key: error_summary(value) for key, value in inner.items()})
        model, correction = fit_pipeline(training, selected, seed + 2000 + index)
        rows.extend(corrected_rows(base_rows(model, test), correction, fold=index, chosen_candidate=selected))
        choices.append({"fold": index, "chosen_candidate": selected, "training_sessions": len(training), "test_sessions": len(test)})
    return rows, choices


def queue_discount_seconds(development, session):
    """User-requested prior-machine mean-cycle proxy; NOT measured queue time."""
    gaps = defaultdict(list)
    for item in development:
        for previous, current in zip(item.observations, item.observations[1:]):
            if (previous.action.exercise_id == current.action.exercise_id and not previous.action.during_rest
                    and not current.action.during_rest and not current.equipment_wait):
                gaps[previous.action.exercise_id].append((current.completed_at - previous.completed_at).total_seconds())
    return sum(max(0.0, (b.completed_at - a.completed_at).total_seconds() - statistics.mean(gaps[a.action.exercise_id]))
               for a, b in zip(session.observations, session.observations[1:])
               if b.equipment_wait and gaps[a.action.exercise_id])


def experiment(csv_path, wait_events_path=None, cutoff="2026-09-14", seed=20260917, repeats=10):
    if repeats < 1:
        raise ValueError("repeats must be >=1")
    events = json.loads(wait_events_path.read_text(encoding="utf-8")) if wait_events_path else None
    sessions, diagnostic = load_history(csv_path, wait_events=events)
    development = [s for s in sessions if s.local_date < cutoff]
    later = [s for s in sessions if s.local_date >= cutoff]
    if len(development) < 8 or len(later) < 2:
        raise ValueError("Need >=8 development and >=2 retrospective later sessions")
    comparisons = compare_cv(development, seed)
    metrics = {key: error_summary(rows) for key, rows in comparisons.items()}
    selected = choose(metrics)
    stability = defaultdict(list)
    selected_counts = Counter()
    for split_seed in range(seed, seed + repeats):
        results = comparisons if split_seed == seed else compare_cv(development, split_seed)
        summary = {key: error_summary(rows) for key, rows in results.items()}
        selected_counts[choose(summary)] += 1
        for key, value in summary.items():
            stability[key].append(value["mae_minutes"])
    nested, choices = nested_selection(development, seed)
    later_results, frozen_coefficients, gap_metrics, queue_metrics, machine_coefficients = {}, {}, {}, {}, {}
    discounts = [queue_discount_seconds(development, session) for session in later]
    # All later candidate scores are diagnostics, NOT a second model-selection step.
    for base in BASE_KINDS:
        model = fit_base(development, base)
        if base in MACHINE_KINDS:
            machine_coefficients[base] = {"additions_seconds": model.machine_additions,
                                          "cycle_multipliers": model.machine_multipliers,
                                          "training_repeat_cycles": model.sample_counts}
        training_oof = cross_fitted_base(development, base, seed)
        raw = base_rows(model, later)
        groups = repeat_gap_rows(model, later)
        gap_metrics[base] = {key: repeat_gap_summary(rows) for key, rows in groups.items()}
        for strategy in GLOBAL_KINDS:
            key = f"{base}|{strategy}"
            correction = fit_global(training_oof, strategy)
            rows = corrected_rows(raw, correction)
            later_results[key] = rows
            frozen_coefficients[key] = asdict(correction)
            adjusted = [{**row, "actual_seconds": row["actual_seconds"] - discount} for row, discount in zip(rows, discounts)]
            queue_metrics[key] = error_summary(adjusted)
    selected_model = fit_base(development, selected.split("|")[0])
    public = {"version": 1, "target": "first-to-last logged/completed-set span; excludes arrival, warmup and first set",
              "source_sha256": diagnostic["input_sha256"],
              "wait_events_sha256": hashlib.sha256(wait_events_path.read_bytes()).hexdigest() if wait_events_path else None,
              "input_rows": diagnostic["input_rows"], "eligible_sessions": len(sessions),
              "excluded_sessions": len(diagnostic["excluded_sessions"]), "development_sessions": len(development),
              "later_sessions": len(later), "cutoff": cutoff, "seed": seed, "repeats": repeats,
              "selection": "Minimum session-level development CV MAE; global stage trained on inner OOF predictions; later outcomes never select candidate",
              "selected_candidate": selected, "candidate_cv": metrics,
              "nested_selection_metrics": error_summary(nested), "nested_selection_choices": choices,
              "repeated_split_winner_counts": dict(selected_counts),
              "repeated_split_cv": {key: {"mean_mae_minutes": statistics.mean(values), "min_mae_minutes": min(values),
                                           "max_mae_minutes": max(values)} for key, values in stability.items()},
              "later_raw_metrics": {key: error_summary(rows) for key, rows in later_results.items()},
              "later_queue_proxy_metrics": queue_metrics, "queue_proxy_discount_seconds": sum(discounts),
              "frozen_global_coefficients": frozen_coefficients,
              "frozen_machine_coefficients": machine_coefficients,
              "selected_development_model_coefficients": asdict(selected_model),
              "development_machine_repeat_gap_cv_without_global_correction": repeat_gap_cv(development, seed),
              "later_machine_repeat_gap_metrics_without_global_correction": gap_metrics,
              "limitations": ["Retrospective candidate ideas and known later outcomes; not a new blind test",
                              "18 development sessions and sparse legs/abs cannot identify every machine parameter reliably",
                              "Nested CV audits selection; repeated splits overlap and are not independent validation samples",
                              "Primary session loss is MAE; machine coefficients minimize explicit cycle-level squared error, followed by held-out session selection",
                              "Cycle affine slopes and additions are confounded under nearly fixed cooldowns; coefficients do not identify phone time or rep cadence",
                              "Machine additive and machine-rest-scaled models coincide on default-rest cycles; these are not independent supporting hypotheses",
                              "Machine gap metrics weight cycles, whereas primary validation weights complete sessions; improvement on one machine need not improve a whole day",
                              "Global correction is a prediction-only correction to the logged span, not a shorter timer or a new physiological rest prescription",
                              "Final correction is floored by the nominal-rest timeline with assumed 10+3*reps service and zero movement",
                              "Actual reps/order used as plan inputs; prospective rep uncertainty not validated",
                              "Confirmed wait omitted from training coefficients; raw later targets retain it; queue discount is a separately labeled sensitivity only",
                              "Default model and frozen Friday forecast untouched; no workout schedule, PWA data or timer change",
                              "Prospective and new-configuration evidence still required before optimizing next week's schedule"]}
    private = {"report": public, "development_predictions": comparisons, "nested_predictions": nested,
               "later_predictions": later_results, "diagnostic": diagnostic}
    return public, private


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--wait-events", type=Path)
    parser.add_argument("--cutoff", default="2026-09-14")
    parser.add_argument("--seed", type=int, default=20260917)
    parser.add_argument("--repeats", type=int, default=10)
    parser.add_argument("--output", type=Path, default=Path("outputs/time-estimator/calibration_experiment.json"))
    parser.add_argument("--aggregate-output", type=Path)
    args = parser.parse_args()
    try:
        public, private = experiment(args.csv, args.wait_events, args.cutoff, args.seed, args.repeats)
        for path, result in ((args.output, private), (args.aggregate_output, public)):
            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        key = public["selected_candidate"]
        print(json.dumps({"selected_candidate": key, "development_cv": public["candidate_cv"][key],
                          "nested_selection": public["nested_selection_metrics"],
                          "later_raw": public["later_raw_metrics"][key],
                          "later_queue_proxy": public["later_queue_proxy_metrics"][key],
                          "global_coefficients": public["frozen_global_coefficients"][key],
                          "repeated_split_winners": public["repeated_split_winner_counts"],
                          "output": str(args.output)}, indent=2))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, f"error: {error}\n")


if __name__ == "__main__":
    main()
