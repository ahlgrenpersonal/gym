"""Fit and validate explicit equations for workout completion-time gaps.

This is deliberately an experiment, not the production estimator. It fits
the user's proposed decomposition

    completion gap = applicable cooldown + delayed start + seconds/rep * reps

with bounded coefficients, robust loss, and optional grouping. Confirmed
equipment waits are excluded from coefficient fitting but retained in raw
session validation. Candidate choice and all scoring happen on whole held-out
sessions so adjacent sets from one workout never straddle train and test.

Python 3.10+, standard library only. Detailed records stay in ignored outputs;
the shareable audit contains aggregates only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
from collections import Counter
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from TimeEstimator import (
    MACHINES,
    REST_POLICY_CHANGE_DATE,
    PlannedSet,
    Session,
    TimeModel,
    error_summary,
    evaluate,
    load_history,
)
from scripts.validate_time_estimator import folds


DELAY_GROUPS = ("global", "rest", "previous_machine")
REP_GROUPS = ("global", "current_machine")
CORRECTIONS = ("identity", "fixed_1_15", "offset", "scale", "affine")
DELAY_BOUNDS = (0.0, 60.0)
REP_BOUNDS = (1.0, 6.0)
LEGACY_SWITCH_BOUNDS = (0.0, 600.0)
CROSS_REST_RATIO_BOUNDS = (0.0, 1.0)
SCALE_BOUNDS = (0.75, 1.50)
SESSION_OFFSET_BOUNDS = (0.0, 300.0)


@dataclass(frozen=True)
class Candidate:
    delay_group: str
    rep_group: str
    huber_delta: float
    shrinkage: float
    correction: str
    cross_rest: str = "fixed"

    @property
    def name(self) -> str:
        return (
            f"delay={self.delay_group}|rep={self.rep_group}|"
            f"huber={self.huber_delta:g}|shrink={self.shrinkage:g}|"
            f"correction={self.correction}|cross_rest={self.cross_rest}"
        )


@dataclass(frozen=True)
class GapRow:
    session_id: str
    previous_exercise: str
    current_exercise: str
    previous_rest_seconds: float
    current_reps: int
    applicable_rest_seconds: float
    observed_gap_seconds: float
    legacy_switch: bool


@dataclass
class GapModel:
    candidate: Candidate
    delay_seconds: dict[str, float]
    rep_seconds: dict[str, float]
    legacy_switch_seconds: float
    cross_rest_ratios: dict[str, float] | None = None
    session_scale: float = 1.0
    session_offset_seconds: float = 0.0
    training_gap_count: int = 0
    excluded_wait_gap_count: int = 0

    def __post_init__(self) -> None:
        if self.cross_rest_ratios is None:
            self.cross_rest_ratios = {}

    def delay(self, action: PlannedSet) -> float:
        if action.rest_seconds <= 0:
            return 0.0
        if self.candidate.delay_group == "global":
            key = "global"
        elif self.candidate.delay_group == "rest":
            key = f"rest:{float(action.rest_seconds)}"
        else:
            key = f"machine:{action.exercise_id}"
        return self.delay_seconds.get(key, self.delay_seconds.get("global", 0.0))

    def seconds_per_rep(self, action: PlannedSet) -> float:
        key = action.exercise_id if self.candidate.rep_group == "current_machine" else "global"
        return self.rep_seconds.get(key, self.rep_seconds.get("global", REP_BOUNDS[0]))

    def service(self, action: PlannedSet) -> float:
        return self.seconds_per_rep(action) * action.reps

    def cross_rest_ratio(self, previous: PlannedSet, current: PlannedSet) -> float:
        if self.candidate.cross_rest == "fixed":
            return 1.0
        if self.candidate.cross_rest == "pair":
            key = f"{previous.exercise_id}->{current.exercise_id}"
            return self.cross_rest_ratios.get(key, self.cross_rest_ratios.get("global", 1.0))
        return self.cross_rest_ratios.get("global", 1.0)

    def corrected(self, raw_seconds: float, floor_seconds: float) -> float:
        return max(floor_seconds, self.session_scale * raw_seconds + self.session_offset_seconds)


def _applicable_rest(session: Session, index: int) -> float:
    previous = session.observations[index - 1].action
    final_for_exercise = all(
        row.action.exercise_id != previous.exercise_id
        for row in session.observations[index:]
    )
    return previous.rest_seconds if session.carry_rest_between_exercises or not final_for_exercise else 0.0


def ordinary_rows(sessions: Iterable[Session]) -> tuple[list[GapRow], int]:
    """Return identifiable straight-set gaps and count confirmed waits omitted."""
    rows: list[GapRow] = []
    excluded_waits = 0
    for session in sessions:
        for index in range(1, len(session.observations)):
            previous = session.observations[index - 1]
            current = session.observations[index]
            if current.equipment_wait:
                excluded_waits += 1
                continue
            if previous.action.during_rest or current.action.during_rest:
                continue
            applicable = _applicable_rest(session, index)
            rows.append(
                GapRow(
                    session.session_id,
                    previous.action.exercise_id,
                    current.action.exercise_id,
                    previous.action.rest_seconds,
                    current.action.reps,
                    applicable,
                    (current.completed_at - previous.completed_at).total_seconds(),
                    applicable == 0
                    and previous.action.exercise_id != current.action.exercise_id,
                )
            )
    return rows, excluded_waits


def _delay_name(row: GapRow, group: str) -> str | None:
    if row.applicable_rest_seconds <= 0:
        return None
    if group == "global":
        return "delay:global"
    if group == "rest":
        return f"delay:rest:{float(row.previous_rest_seconds)}"
    return f"delay:machine:{row.previous_exercise}"


def _rep_name(row: GapRow, group: str) -> str:
    return "rep:global" if group == "global" else f"rep:machine:{row.current_exercise}"


def _features(row: GapRow, candidate: Candidate) -> dict[str, float]:
    result = {_rep_name(row, candidate.rep_group): float(row.current_reps)}
    delay = _delay_name(row, candidate.delay_group)
    if delay:
        result[delay] = 1.0
    if row.legacy_switch:
        result["legacy_switch"] = 1.0
    elif (
        candidate.cross_rest != "fixed"
        and row.applicable_rest_seconds > 0
        and row.previous_exercise != row.current_exercise
    ):
        suffix = (
            "global"
            if candidate.cross_rest == "global"
            else f"{row.previous_exercise}->{row.current_exercise}"
        )
        result[f"cross_rest:{suffix}"] = row.applicable_rest_seconds
    return result


def _parameter_bounds(name: str) -> tuple[float, float]:
    if name.startswith("delay:"):
        return DELAY_BOUNDS
    if name.startswith("rep:"):
        return REP_BOUNDS
    if name == "legacy_switch":
        return LEGACY_SWITCH_BOUNDS
    if name.startswith("cross_rest:"):
        return CROSS_REST_RATIO_BOUNDS
    raise ValueError(f"Unknown parameter: {name}")


def _bounded_huber_ridge(
    samples: list[tuple[dict[str, float], float]],
    priors: dict[str, float],
    penalties: dict[str, float],
    delta: float,
    max_iterations: int = 250,
) -> dict[str, float]:
    """Coordinate-descent IRLS for bounded Huber regression with ridge priors."""
    if not samples:
        raise ValueError("Gap regression requires samples")
    names = sorted({name for features, _ in samples for name in features})
    coefficients = {
        name: min(max(priors.get(name, sum(_parameter_bounds(name)) / 2), _parameter_bounds(name)[0]),
                  _parameter_bounds(name)[1])
        for name in names
    }
    for _ in range(max_iterations):
        residuals = [
            target - sum(features.get(name, 0.0) * value for name, value in coefficients.items())
            for features, target in samples
        ]
        weights = [1.0 if abs(value) <= delta else delta / abs(value) for value in residuals]
        largest_change = 0.0
        for name in names:
            numerator = penalties.get(name, 0.0) * priors.get(name, coefficients[name])
            denominator = penalties.get(name, 0.0)
            for (features, target), weight in zip(samples, weights):
                x = features.get(name, 0.0)
                if x == 0:
                    continue
                other = sum(
                    features.get(other_name, 0.0) * value
                    for other_name, value in coefficients.items()
                    if other_name != name
                )
                numerator += weight * x * (target - other)
                denominator += weight * x * x
            if denominator:
                lower, upper = _parameter_bounds(name)
                revised = min(max(numerator / denominator, lower), upper)
                largest_change = max(largest_change, abs(revised - coefficients[name]))
                coefficients[name] = revised
        if largest_change < 1e-8:
            break
    return coefficients


def _global_priors(rows: list[GapRow], delta: float) -> dict[str, float]:
    simple = Candidate("global", "global", delta, 0.0, "identity", "global")
    samples = [
        (
            _features(row, simple),
            row.observed_gap_seconds
            - (
                row.applicable_rest_seconds
                if row.previous_exercise == row.current_exercise
                else 0.0
            ),
        )
        for row in rows
    ]
    return _bounded_huber_ridge(
        samples,
        {
            "delay:global": 30.0,
            "rep:global": 3.0,
            "legacy_switch": 60.0,
            "cross_rest:global": 1.0,
        },
        {},
        delta,
    )


def _fit_gap_coefficients(sessions: list[Session], candidate: Candidate) -> GapModel:
    rows, excluded = ordinary_rows(sessions)
    if not rows:
        raise ValueError("No ordinary gaps available")
    global_priors = _global_priors(rows, candidate.huber_delta)
    samples = [
        (
            _features(row, candidate),
            row.observed_gap_seconds
            - (
                row.applicable_rest_seconds
                if (
                    row.previous_exercise == row.current_exercise
                    or candidate.cross_rest == "fixed"
                )
                else 0.0
            ),
        )
        for row in rows
    ]
    names = {name for features, _ in samples for name in features}
    priors: dict[str, float] = {}
    penalties: dict[str, float] = {}
    for name in names:
        if name.startswith("delay:"):
            priors[name] = global_priors.get("delay:global", 30.0)
            penalties[name] = candidate.shrinkage
        elif name.startswith("rep:"):
            priors[name] = global_priors.get("rep:global", 3.0)
            # A pseudo-observation at 12 reps has 144x a unit feature's
            # coefficient leverage.
            penalties[name] = candidate.shrinkage * 12.0**2
        elif name.startswith("cross_rest:"):
            priors[name] = global_priors.get("cross_rest:global", 1.0)
            penalties[name] = candidate.shrinkage * 180.0**2
        else:
            priors[name] = global_priors.get("legacy_switch", 60.0)
            penalties[name] = candidate.shrinkage
    coefficients = _bounded_huber_ridge(
        samples, priors, penalties, candidate.huber_delta
    )
    delays = {
        name.removeprefix("delay:"): value
        for name, value in coefficients.items()
        if name.startswith("delay:")
    }
    reps = {
        (name.removeprefix("rep:machine:") if name.startswith("rep:machine:") else "global"): value
        for name, value in coefficients.items()
        if name.startswith("rep:")
    }
    cross_rest = {
        name.removeprefix("cross_rest:"): value
        for name, value in coefficients.items()
        if name.startswith("cross_rest:")
    }
    delays.setdefault("global", global_priors.get("delay:global", 30.0))
    reps.setdefault("global", global_priors.get("rep:global", 3.0))
    cross_rest.setdefault("global", global_priors.get("cross_rest:global", 1.0))
    return GapModel(
        candidate,
        delays,
        reps,
        coefficients.get("legacy_switch", global_priors.get("legacy_switch", 60.0)),
        cross_rest,
        training_gap_count=len(rows),
        excluded_wait_gap_count=excluded,
    )


def _timeline_completions(session: Session, model: GapModel, *, floor: bool = False) -> list[float]:
    """Mirror the estimator's independent recovery clocks without setup cost."""
    completion = 0.0
    deadlines: dict[str, float] = {}
    previous: PlannedSet | None = None
    previous_primary: PlannedSet | None = None
    previous_primary_completion = 0.0
    completions: list[float] = []
    for observation in session.observations:
        action = observation.action
        required = deadlines.get(action.exercise_id, 0.0)
        if not action.during_rest and previous_primary is not None:
            delay = 0.0 if floor else model.delay(previous_primary)
            if previous_primary.exercise_id == action.exercise_id:
                chain_rest = previous_primary.rest_seconds
            elif session.carry_rest_between_exercises:
                if floor:
                    ratio = 1.0 if model.candidate.cross_rest == "fixed" else 0.0
                else:
                    ratio = model.cross_rest_ratio(previous_primary, action)
                chain_rest = previous_primary.rest_seconds * ratio
            else:
                chain_rest = 0.0
                delay = 0.0
            required = max(
                required, previous_primary_completion + chain_rest + delay
            )
        movement = 0.0
        if (
            not floor and previous is not None
            and previous.exercise_id != action.exercise_id
            and not session.carry_rest_between_exercises
            and not previous.during_rest and not action.during_rest
        ):
            movement = model.legacy_switch_seconds
        if action.during_rest or (previous and previous.during_rest):
            start = max(completion + movement, required)
        else:
            start = max(completion, required) + movement
        service = float(action.reps) if floor else model.service(action)
        end = start + service
        delay = 0.0 if floor else model.delay(action)
        deadlines[action.exercise_id] = end + action.rest_seconds + delay
        if not action.during_rest:
            previous_primary = action
            previous_primary_completion = end
        if action.during_rest and previous_primary is not None:
            if MACHINES[previous_primary.exercise_id].station == "cable_station":
                raise ValueError("Unsupported alternation away from the cable station")
        completion = end
        previous = action
        completions.append(end)
    return completions


def raw_prediction_seconds(session: Session, model: GapModel) -> float:
    points = _timeline_completions(session, model)
    return points[-1] - points[0]


def floor_seconds(session: Session, model: GapModel) -> float:
    points = _timeline_completions(session, model, floor=True)
    return points[-1] - points[0]


def _fit_session_correction(sessions: list[Session], model: GapModel) -> None:
    kind = model.candidate.correction
    if kind == "identity":
        return
    if kind == "fixed_1_15":
        model.session_scale = 1.15
        return
    predictions = [raw_prediction_seconds(session, model) for session in sessions]
    floors = [floor_seconds(session, model) for session in sessions]
    actual = [session.actual_seconds for session in sessions]

    def loss(scale: float, offset: float) -> float:
        return sum(
            abs(max(floor, scale * predicted + offset) - observed)
            for predicted, floor, observed in zip(predictions, floors, actual)
        )

    def best_offset(scale: float) -> float:
        residuals = sorted(a - scale * p for p, a in zip(predictions, actual))
        value = statistics.median(residuals)
        return min(max(value, SESSION_OFFSET_BOUNDS[0]), SESSION_OFFSET_BOUNDS[1])

    def best_scale(offset: float) -> float:
        choices = {SCALE_BOUNDS[0], 1.0, SCALE_BOUNDS[1]}
        choices.update(
            min(max((a - offset) / p, SCALE_BOUNDS[0]), SCALE_BOUNDS[1])
            for p, a in zip(predictions, actual) if p > 0
        )
        return min(choices, key=lambda value: (loss(value, offset), abs(value - 1)))

    scale, offset = 1.0, 0.0
    if kind == "offset":
        offset = best_offset(scale)
    elif kind == "scale":
        scale = best_scale(offset)
    else:
        for _ in range(20):
            revised_offset = best_offset(scale)
            revised_scale = best_scale(revised_offset)
            if abs(revised_scale - scale) < 1e-10 and abs(revised_offset - offset) < 1e-8:
                scale, offset = revised_scale, revised_offset
                break
            scale, offset = revised_scale, revised_offset
    model.session_scale = scale
    model.session_offset_seconds = offset


def fit_gap_model(sessions: list[Session], candidate: Candidate) -> GapModel:
    if not sessions:
        raise ValueError("At least one training session is required")
    model = _fit_gap_coefficients(sessions, candidate)
    _fit_session_correction(sessions, model)
    return model


def predict_seconds(session: Session, model: GapModel) -> float:
    return model.corrected(raw_prediction_seconds(session, model), floor_seconds(session, model))


def evaluate_gap_model(model: GapModel, sessions: Iterable[Session]) -> list[dict]:
    rows = []
    for session in sessions:
        predicted = predict_seconds(session, model)
        rows.append({
            "session_id": session.session_id,
            "date": session.local_date,
            "workout_type": session.workout_type,
            "set_count": len(session.observations),
            "actual_seconds": session.actual_seconds,
            "predicted_seconds": predicted,
            "error_seconds": predicted - session.actual_seconds,
        })
    return rows


def candidates() -> list[Candidate]:
    result: list[Candidate] = []
    structures = [
        ("global", "global"),
        ("rest", "global"),
        ("previous_machine", "global"),
        ("rest", "current_machine"),
        ("previous_machine", "current_machine"),
    ]
    for delay, rep in structures:
        strengths = (2.0,) if (delay, rep) == ("global", "global") else (2.0, 16.0)
        for delta in (60.0, 120.0, 1_000_000_000.0):
            for strength in strengths:
                for correction in CORRECTIONS:
                    for cross_rest in ("fixed", "global"):
                        result.append(
                            Candidate(
                                delay, rep, delta, strength, correction, cross_rest
                            )
                        )
    return result


def cross_validate(sessions: list[Session], candidate: Candidate, seed: int, count: int = 4) -> list[dict]:
    rows: list[dict] = []
    for fold_index, test in enumerate(folds(sessions, seed, min(count, len(sessions)))):
        test_ids = {session.session_id for session in test}
        training = [session for session in sessions if session.session_id not in test_ids]
        model = fit_gap_model(training, candidate)
        rows.extend({**row, "fold": fold_index} for row in evaluate_gap_model(model, test))
    return rows


def select_candidate(
    sessions: list[Session], seed: int, options: list[Candidate] | None = None
) -> tuple[Candidate, dict[str, dict], dict[str, list[dict]]]:
    options = options or candidates()
    rows: dict[str, list[dict]] = {candidate.name: [] for candidate in options}
    # The four correction variants share identical gap coefficients. Fit each
    # coefficient structure once per fold, then clone it before fitting the
    # small session-level correction.
    grouped: dict[tuple[str, str, float, float, str], list[Candidate]] = {}
    for candidate in options:
        key = (
            candidate.delay_group,
            candidate.rep_group,
            candidate.huber_delta,
            candidate.shrinkage,
            candidate.cross_rest,
        )
        grouped.setdefault(key, []).append(candidate)
    for fold_index, test in enumerate(folds(sessions, seed)):
        test_ids = {session.session_id for session in test}
        training = [session for session in sessions if session.session_id not in test_ids]
        for variants in grouped.values():
            base = _fit_gap_coefficients(training, variants[0])
            for candidate in variants:
                model = replace(
                    base,
                    candidate=candidate,
                    delay_seconds=dict(base.delay_seconds),
                    rep_seconds=dict(base.rep_seconds),
                    cross_rest_ratios=dict(base.cross_rest_ratios),
                )
                _fit_session_correction(training, model)
                rows[candidate.name].extend(
                    {**row, "fold": fold_index}
                    for row in evaluate_gap_model(model, test)
                )
    metrics = {name: error_summary(predictions) for name, predictions in rows.items()}
    chosen = min(
        options,
        key=lambda candidate: (
            metrics[candidate.name]["mae_minutes"],
            metrics[candidate.name]["rmse_minutes"],
            candidate.name,
        ),
    )
    return chosen, metrics, rows


def nested_selection(
    sessions: list[Session], seed: int, options: list[Candidate]
) -> tuple[list[dict], Counter[str]]:
    rows: list[dict] = []
    selections: Counter[str] = Counter()
    for outer_index, test in enumerate(folds(sessions, seed)):
        test_ids = {session.session_id for session in test}
        training = [session for session in sessions if session.session_id not in test_ids]
        chosen, _, _ = select_candidate(training, seed + 1000 + outer_index, options)
        selections[chosen.name] += 1
        model = fit_gap_model(training, chosen)
        rows.extend(
            {**row, "outer_fold": outer_index, "selected_candidate": chosen.name}
            for row in evaluate_gap_model(model, test)
        )
    return rows, selections


def baseline_cv(sessions: list[Session], seed: int) -> list[dict]:
    rows: list[dict] = []
    for fold_index, test in enumerate(folds(sessions, seed)):
        test_ids = {session.session_id for session in test}
        training = [session for session in sessions if session.session_id not in test_ids]
        rows.extend(
            {**row, "fold": fold_index}
            for row in evaluate(TimeModel.fit(training, "delay_fixed"), test)
        )
    return rows


def queue_adjusted_rows(model: GapModel, sessions: list[Session]) -> list[dict]:
    """Sensitivity only: replace each confirmed queue gap by its modeled gap."""
    result = []
    for session in sessions:
        adjusted_actual = session.actual_seconds
        completions = _timeline_completions(session, model)
        removed = 0.0
        for index in range(1, len(session.observations)):
            if not session.observations[index].equipment_wait:
                continue
            observed = (
                session.observations[index].completed_at
                - session.observations[index - 1].completed_at
            ).total_seconds()
            expected = completions[index] - completions[index - 1]
            excess = max(0.0, observed - expected)
            adjusted_actual -= excess
            removed += excess
        predicted = predict_seconds(session, model)
        result.append({
            "session_id": session.session_id,
            "date": session.local_date,
            "actual_seconds": adjusted_actual,
            "predicted_seconds": predicted,
            "error_seconds": predicted - adjusted_actual,
            "queue_seconds_removed": removed,
        })
    return result


def inspect_queue_candidates(sessions: list[Session]) -> list[dict]:
    """Conservative manual-review list, not an inferred wait label."""
    result = []
    for session in sessions:
        if not session.carry_rest_between_exercises:
            continue
        for index in range(1, len(session.observations)):
            previous = session.observations[index - 1]
            current = session.observations[index]
            if (
                previous.action.exercise_id == current.action.exercise_id
                or previous.action.during_rest or current.action.during_rest
            ):
                continue
            observed = (current.completed_at - previous.completed_at).total_seconds()
            conservative = (
                previous.action.rest_seconds + DELAY_BOUNDS[1]
                + REP_BOUNDS[1] * current.action.reps + 60.0
            )
            if observed > conservative:
                result.append({
                    "session_id": session.session_id,
                    "date": session.local_date,
                    "set_index": index + 1,
                    "previous_exercise": previous.action.exercise_id,
                    "current_exercise": current.action.exercise_id,
                    "observed_gap_seconds": observed,
                    "review_threshold_seconds": conservative,
                    "confirmed_wait": current.equipment_wait,
                })
    return result


def _paired_comparison(candidate_rows: list[dict], baseline_rows: list[dict]) -> dict:
    baseline = {row["session_id"]: abs(row["error_seconds"]) for row in baseline_rows}
    improvements = [
        baseline[row["session_id"]] - abs(row["error_seconds"])
        for row in candidate_rows
    ]
    return {
        "sessions": len(improvements),
        "mean_absolute_error_improvement_minutes": statistics.mean(improvements) / 60,
        "median_absolute_error_improvement_minutes": statistics.median(improvements) / 60,
        "candidate_wins": sum(value > 0 for value in improvements),
        "ties": sum(value == 0 for value in improvements),
        "baseline_wins": sum(value < 0 for value in improvements),
    }


def _public_coefficients(model: GapModel) -> dict:
    return {
        "delay_seconds": dict(sorted(model.delay_seconds.items())),
        "seconds_per_rep": dict(sorted(model.rep_seconds.items())),
        "legacy_switch_seconds": model.legacy_switch_seconds,
        "cross_machine_rest_ratios": dict(sorted(model.cross_rest_ratios.items())),
        "session_scale": model.session_scale,
        "session_offset_seconds": model.session_offset_seconds,
        "training_gap_count": model.training_gap_count,
        "excluded_wait_gap_count": model.excluded_wait_gap_count,
    }


def _promotion_assessment(
    selected_cv: dict,
    baseline_cv_metrics: dict,
    nested_metrics: dict,
    later_metrics: dict,
    later_baseline_metrics: dict,
    stability: Counter[str],
    repeats: int,
) -> dict:
    """Apply predeclared evidence gates; never promote from fit quality alone."""
    gates = {
        "selected_development_cv_mae_below_current": (
            selected_cv["mae_minutes"] < baseline_cv_metrics["mae_minutes"]
        ),
        "nested_selection_mae_below_current": (
            nested_metrics["mae_minutes"] < baseline_cv_metrics["mae_minutes"]
        ),
        "later_raw_mae_below_current": (
            later_metrics["mae_minutes"] < later_baseline_metrics["mae_minutes"]
        ),
        "later_absolute_bias_at_most_2_minutes": abs(later_metrics["bias_minutes"]) <= 2.0,
        "winner_selected_in_majority_of_split_seeds": (
            bool(stability) and max(stability.values()) > repeats / 2
        ),
    }
    passed = all(gates.values())
    return {
        "decision": "requires_prospective_validation" if passed else "rejected",
        "ready_for_schedule_optimization": False,
        "gates": gates,
        "reason": (
            "Retrospective gates passed, but a prospective configuration-specific week is still required."
            if passed
            else "The selected model does not beat the current estimator reliably on unseen sessions."
        ),
    }


def experiment(
    csv_path: Path,
    wait_events_path: Path | None = None,
    cutoff: str = "2026-09-14",
    seed: int = 20260919,
    repeats: int = 10,
) -> tuple[dict, dict]:
    if repeats < 1:
        raise ValueError("Repeats must be at least one")
    events = json.loads(wait_events_path.read_text(encoding="utf-8")) if wait_events_path else None
    if events is not None and not isinstance(events, list):
        raise ValueError("Wait-events file must contain an array")
    sessions, diagnostics = load_history(csv_path, REST_POLICY_CHANGE_DATE, events)
    development = [session for session in sessions if session.local_date < cutoff]
    later = [session for session in sessions if session.local_date >= cutoff]
    if len(development) < 8 or len(later) < 2:
        raise ValueError("Need at least eight development and two later sessions")

    options = candidates()
    selected, candidate_metrics, candidate_rows = select_candidate(development, seed, options)
    baseline_rows = baseline_cv(development, seed)
    nested_rows, nested_choices = nested_selection(development, seed + 7000, options)
    stability: Counter[str] = Counter()
    for repeat in range(repeats):
        choice, _, _ = select_candidate(development, seed + repeat * 97, options)
        stability[choice.name] += 1

    frozen = fit_gap_model(development, selected)
    later_rows = evaluate_gap_model(frozen, later)
    adjusted_rows = queue_adjusted_rows(frozen, later)
    baseline_frozen = TimeModel.fit(development, "delay_fixed")
    later_baseline_rows = evaluate(baseline_frozen, later)
    queue_review = inspect_queue_candidates(sessions)

    selected_cv_metrics = candidate_metrics[selected.name]
    baseline_cv_metrics = error_summary(baseline_rows)
    nested_metrics = error_summary(nested_rows)
    later_metrics = error_summary(later_rows)
    adjusted_metrics = error_summary(adjusted_rows)
    later_baseline_metrics = error_summary(later_baseline_rows)
    promotion = _promotion_assessment(
        selected_cv_metrics,
        baseline_cv_metrics,
        nested_metrics,
        later_metrics,
        later_baseline_metrics,
        stability,
        repeats,
    )

    ordered = sorted(
        candidate_metrics.items(),
        key=lambda item: (item[1]["mae_minutes"], item[1]["rmse_minutes"], item[0]),
    )
    private = {
        "version": 1,
        "target": "first-to-last completed/logged set span; first-set time excluded",
        "formula": "gap=applicable previous cooldown + bounded delayed-start term + bounded seconds-per-rep*next reps; current-policy incremental machine setup=0",
        "bounds": {
            "delayed_start_seconds": DELAY_BOUNDS,
            "seconds_per_rep": REP_BOUNDS,
            "legacy_no_cooldown_machine_switch_seconds": LEGACY_SWITCH_BOUNDS,
            "session_scale": SCALE_BOUNDS,
            "session_offset_seconds": SESSION_OFFSET_BOUNDS,
        },
        "cutoff": cutoff,
        "seed": seed,
        "repeats": repeats,
        "diagnostics": diagnostics,
        "candidate_count": len(options),
        "selected_candidate": selected.name,
        "selected_coefficients": _public_coefficients(frozen),
        "candidate_cv": candidate_metrics,
        "selected_cv_predictions": candidate_rows[selected.name],
        "selected_cv_metrics": selected_cv_metrics,
        "baseline_cv_metrics": baseline_cv_metrics,
        "development_paired_comparison": _paired_comparison(candidate_rows[selected.name], baseline_rows),
        "nested_selection_metrics": nested_metrics,
        "nested_selection_choices": dict(nested_choices),
        "nested_predictions": nested_rows,
        "selection_stability": dict(stability),
        "later_raw_metrics": later_metrics,
        "later_raw_predictions": later_rows,
        "later_queue_adjusted_sensitivity_metrics": adjusted_metrics,
        "later_queue_adjusted_predictions": adjusted_rows,
        "later_baseline_metrics": later_baseline_metrics,
        "later_paired_comparison": _paired_comparison(later_rows, later_baseline_rows),
        "manual_queue_review": queue_review,
        "promotion_assessment": promotion,
        "limitations": [
            "The export begins after the first set, so arrival and first-set time are not identifiable; the logged-span session offset is not door-to-door setup.",
            "Historical custom cooldown changes are unavailable; configured defaults are assumed.",
            "Machine and cooldown duration remain partly confounded because machines normally use only one default cooldown.",
            "Confirmed waits are excluded only from gap fitting, retained in raw validation, and replaced by modeled ordinary time only in a labeled sensitivity analysis.",
            "Queue review is conservative and manual; long same-machine gaps are not relabeled as equipment waits.",
            "Alternation is scored with independent recovery clocks but excluded from coefficient fitting because one observed gap cannot identify overlapping cooldowns.",
            "Retrospective candidate development cannot replace a future prospective week before schedule optimization.",
        ],
    }
    public = {
        "version": 1,
        "target": private["target"],
        "formula": private["formula"],
        "bounds": private["bounds"],
        "source_sha256": diagnostics["input_sha256"],
        "wait_events_sha256": hashlib.sha256(wait_events_path.read_bytes()).hexdigest() if wait_events_path else None,
        "cutoff": cutoff,
        "development_sessions": len(development),
        "later_sessions": len(later),
        "eligible_sessions": diagnostics["eligible_sessions"],
        "excluded_session_count": len(diagnostics["excluded_sessions"]),
        "confirmed_wait_gap_count": diagnostics["user_confirmed_wait_gap_count"],
        "queue_review_candidate_count": len(queue_review),
        "queue_review_confirmed_count": sum(row["confirmed_wait"] for row in queue_review),
        "candidate_count": len(options),
        "selected_candidate": selected.name,
        "selected_coefficients": _public_coefficients(frozen),
        "top_candidate_cv": [
            {"candidate": name, "metrics": metrics} for name, metrics in ordered[:10]
        ],
        "selected_cv_metrics": private["selected_cv_metrics"],
        "baseline_cv_metrics": private["baseline_cv_metrics"],
        "development_paired_comparison": private["development_paired_comparison"],
        "nested_selection_metrics": private["nested_selection_metrics"],
        "nested_selection_choices": private["nested_selection_choices"],
        "selection_stability": private["selection_stability"],
        "later_raw_metrics": private["later_raw_metrics"],
        "later_queue_adjusted_sensitivity_metrics": private["later_queue_adjusted_sensitivity_metrics"],
        "later_baseline_metrics": private["later_baseline_metrics"],
        "later_paired_comparison": private["later_paired_comparison"],
        "promotion_assessment": private["promotion_assessment"],
        "limitations": private["limitations"],
    }
    return private, public


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--wait-events", type=Path)
    parser.add_argument("--cutoff", default="2026-09-14")
    parser.add_argument("--seed", type=int, default=20260919)
    parser.add_argument("--repeats", type=int, default=10)
    parser.add_argument("--output", type=Path, default=Path("outputs/time-estimator/gap_equations_experiment.json"))
    parser.add_argument("--aggregate-output", type=Path, default=Path("time_estimator_gap_equations.json"))
    args = parser.parse_args()
    try:
        private, public = experiment(
            args.csv, args.wait_events, args.cutoff, args.seed, args.repeats
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(private, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        args.aggregate_output.parent.mkdir(parents=True, exist_ok=True)
        args.aggregate_output.write_text(json.dumps(public, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(json.dumps({
            "selected_candidate": public["selected_candidate"],
            "selected_cv_metrics": public["selected_cv_metrics"],
            "baseline_cv_metrics": public["baseline_cv_metrics"],
            "nested_selection_metrics": public["nested_selection_metrics"],
            "selection_stability": public["selection_stability"],
            "later_raw_metrics": public["later_raw_metrics"],
            "later_queue_adjusted_sensitivity_metrics": public["later_queue_adjusted_sensitivity_metrics"],
            "later_baseline_metrics": public["later_baseline_metrics"],
            "promotion_assessment": public["promotion_assessment"],
            "queue_review_candidate_count": public["queue_review_candidate_count"],
            "output": str(args.output),
            "aggregate_output": str(args.aggregate_output),
        }, indent=2))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, f"error: {error}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
