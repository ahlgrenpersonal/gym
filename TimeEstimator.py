"""Offline, explicit workout-time estimator. Python 3.10+, no dependencies.

Input is an ORDERED day. Cooldown starts at the completion/submission of a set,
including when changing machines. Nothing here accesses the PWA database.
Calibrated service is effective execution/logging/within-machine overhead,
not identifiable pure rep cadence. See docs/time-estimator.md.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class Machine:
    rest_seconds: int
    station: str
    area: str
    can_fill_rest: bool = False


# Mirrors lib/exercises.ts; reverse pec deck is in the main area.
MACHINES = {
    "incline_chest_press": Machine(180, "incline_chest_press", "main"),
    "shoulder_press": Machine(180, "shoulder_press", "main"),
    "lat_pulldown": Machine(180, "lat_pulldown", "main"),
    "chest_supported_row": Machine(180, "chest_supported_row", "main"),
    "reverse_pec_deck": Machine(120, "reverse_pec_deck", "main"),
    "lateral_raise": Machine(120, "cable_station", "near_main"),
    "preacher_or_cable_curl": Machine(120, "cable_station", "near_main"),
    "triceps_pushdown": Machine(120, "cable_station", "near_main"),
    "overhead_triceps_extension": Machine(120, "cable_station", "near_main"),
    "leg_press": Machine(180, "leg_press", "other", True),
    "single_leg_extension": Machine(120, "single_leg_extension", "main", True),
    "abdominal_crunch_machine": Machine(90, "abdominal_crunch_machine", "main", True),
}
DELAY_MODEL_KINDS = ("delay_fixed", "delay_scaled", "delay_rest_group", "delay_machine")
MODEL_KINDS = ("fixed", "pooled_median", "exercise_median", "exercise_mean") + DELAY_MODEL_KINDS
REP_SECONDS = 3.0
SERVICE_FLOOR_SECONDS = 10.0
SHRINKAGE_SAMPLES = 4
DEFAULT_MODEL = Path(__file__).with_name("time_estimator_model.json")
REST_POLICY_CHANGE_DATE = "2026-09-06"  # First full day after commit 27d787b; deployment proxy.


def number(value: Any, label: str, minimum: float = 0) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a finite number, not a boolean")
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a finite number") from error
    if not math.isfinite(result) or result < minimum:
        raise ValueError(f"{label} must be finite and >= {minimum}")
    return result


def integer(value: Any, label: str, minimum: int = 1) -> int:
    result = number(value, label, minimum)
    if not result.is_integer():
        raise ValueError(f"{label} must be an integer")
    return int(result)


@dataclass(frozen=True)
class PlannedSet:
    exercise_id: str
    reps: int
    rest_seconds: float
    during_rest: bool = False

    def __post_init__(self) -> None:
        if self.exercise_id not in MACHINES:
            raise ValueError(f"Unknown exercise_id: {self.exercise_id}")
        object.__setattr__(self, "reps", integer(self.reps, "reps"))
        object.__setattr__(self, "rest_seconds", number(self.rest_seconds, "rest_seconds"))
        if not isinstance(self.during_rest, bool):
            raise ValueError("during_rest must be a boolean")
        if self.during_rest and not MACHINES[self.exercise_id].can_fill_rest:
            raise ValueError("Only abs/leg exercises may be marked during_rest")


@dataclass(frozen=True)
class DayPlan:
    sets: tuple[PlannedSet, ...]
    initial_setup_seconds: float = 0
    warmup_seconds: float = 0
    name: str = "workout"
    carry_rest_between_exercises: bool = True

    def __post_init__(self) -> None:
        if not self.sets:
            raise ValueError("A day must contain at least one set")
        if not all(isinstance(action, PlannedSet) for action in self.sets):
            raise ValueError("sets must contain PlannedSet objects")
        object.__setattr__(self, "sets", tuple(self.sets))
        object.__setattr__(self, "initial_setup_seconds", number(self.initial_setup_seconds, "initial_setup_seconds"))
        object.__setattr__(self, "warmup_seconds", number(self.warmup_seconds, "warmup_seconds"))
        if not isinstance(self.carry_rest_between_exercises, bool):
            raise ValueError("carry_rest_between_exercises must be boolean")
        if self.sets[0].during_rest:
            raise ValueError("The first set cannot fill a preceding rest")

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> DayPlan:
        if not isinstance(value, dict) or not isinstance(value.get("exercises"), list):
            raise ValueError("Plan must contain an exercises array")
        blocks: dict[str, list[PlannedSet]] = {}
        for entry in value["exercises"]:
            if not isinstance(entry, dict):
                raise ValueError("Each exercise must be an object")
            exercise = entry.get("exercise_id")
            if exercise not in MACHINES:
                raise ValueError(f"Unknown exercise_id: {exercise}")
            if exercise in blocks:
                raise ValueError("Declare each exercise once; use set_order to revisit it")
            count = integer(entry.get("sets"), "sets")
            raw_reps = entry.get("reps")
            reps = raw_reps if isinstance(raw_reps, list) else [raw_reps] * count
            if len(reps) != count:
                raise ValueError("A reps array must have one entry per set")
            rest = number(entry.get("rest_seconds", MACHINES[exercise].rest_seconds), "rest_seconds")
            blocks[exercise] = [PlannedSet(exercise, integer(rep, "reps"), rest) for rep in reps]
        order = value.get("set_order")
        if order is None:
            actions = [action for block in blocks.values() for action in block]
        else:
            if not isinstance(order, list):
                raise ValueError("set_order must be an array")
            used: Counter[str] = Counter()
            actions = []
            for item in order:
                exercise = item if isinstance(item, str) else item.get("exercise_id") if isinstance(item, dict) else None
                filler = item.get("during_rest", False) if isinstance(item, dict) else False
                if exercise not in blocks or used[exercise] >= len(blocks[exercise]):
                    raise ValueError("set_order contains an undeclared exercise or too many sets")
                original = blocks[exercise][used[exercise]]
                actions.append(PlannedSet(exercise, original.reps, original.rest_seconds, filler))
                used[exercise] += 1
            if any(used[exercise] != len(block) for exercise, block in blocks.items()):
                raise ValueError("set_order must include every declared set")
        return cls(tuple(actions), number(value.get("initial_setup_seconds", 0), "initial_setup_seconds"),
                   number(value.get("warmup_seconds", 0), "warmup_seconds"), str(value.get("name", "workout")),
                   value.get("carry_rest_between_exercises", True))


@dataclass(frozen=True)
class ObservedSet:
    action: PlannedSet
    completed_at: datetime
    equipment_wait: bool = False  # User-confirmed incoming gap; never inferred from its length.


@dataclass(frozen=True)
class Session:
    session_id: str
    local_date: str
    workout_type: str
    observations: tuple[ObservedSet, ...]
    carry_rest_between_exercises: bool = True

    @property
    def actual_seconds(self) -> float:
        return (self.observations[-1].completed_at - self.observations[0].completed_at).total_seconds()

    @property
    def plan(self) -> DayPlan:
        return DayPlan(tuple(row.action for row in self.observations), name=self.workout_type,
                       carry_rest_between_exercises=self.carry_rest_between_exercises)


def load_history(path: str | Path, rest_policy_change_date: str | None = REST_POLICY_CHANGE_DATE,
                 wait_events: list[dict[str, Any]] | None = None) -> tuple[list[Session], dict[str, Any]]:
    """Read PWA CSV; never merge sessions/days or silently deduplicate records.

    Retired exercises/different row apparatus are out of scope. Unsupported
    upper-body interleaving is excluded at whole-session level. Abs/leg filler
    inference uses order only, never observed gap lengths or held-out targets.
    """
    path = Path(path)
    if rest_policy_change_date is not None:
        datetime.strptime(rest_policy_change_date, "%Y-%m-%d")
    groups: dict[str, list[tuple[dict[str, str], datetime]]] = defaultdict(list)
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"timestamp_utc", "session_id", "exercise_id", "reps", "workout_type"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"CSV missing columns: {sorted(required - set(reader.fieldnames or []))}")
        for row in reader:
            if any(not row.get(key) for key in required):
                raise ValueError("CSV required values cannot be empty")
            timestamp = datetime.fromisoformat(row["timestamp_utc"].replace("Z", "+00:00"))
            if timestamp.utcoffset() is None:
                raise ValueError("timestamp_utc must contain a timezone")
            if not row["session_id"]:
                raise ValueError("session_id cannot be empty")
            integer(row["reps"], "reps")
            groups[row["session_id"]].append((row, timestamp))
    excluded, sessions, short_gaps = [], [], []
    for identifier, rows in groups.items():
        rows.sort(key=lambda item: item[1])
        if len({time for _, time in rows}) != len(rows):
            raise ValueError(f"Duplicate submission timestamp in {identifier}")
        dates = {(row.get("local_datetime") or row["timestamp_utc"])[:10] for row, _ in rows}
        for date in dates:
            datetime.strptime(date, "%Y-%m-%d")
        types = {row["workout_type"] for row, _ in rows}
        if len(dates) != 1 or len(types) != 1:
            raise ValueError(f"Session {identifier} spans multiple dates or workout types")
        reasons = set()
        for row, _ in rows:
            if row["exercise_id"] not in MACHINES:
                reasons.add(f"unsupported exercise: {row['exercise_id']}")
            if row["exercise_id"] == "chest_supported_row" and row.get("exercise_name") == "Chest-Supported Row":
                reasons.add("different historical row apparatus")
        if len(rows) < 2:
            reasons.add("fewer than two logged sets")
        if reasons:
            excluded.append({"session_id": identifier, "date": min(dates), "reasons": sorted(reasons)})
            continue
        ids = [row["exercise_id"] for row, _ in rows]
        fillers = [False] * len(rows)
        for index, exercise in enumerate(ids):
            if not MACHINES[exercise].can_fill_rest or index == 0:
                continue
            before = next((ids[j] for j in range(index - 1, -1, -1) if ids[j] != exercise), None)
            after = next((ids[j] for j in range(index + 1, len(ids)) if ids[j] != exercise), None)
            if before and before == after:
                fillers[index] = True
        primary = [exercise for exercise, filler in zip(ids, fillers) if not filler]
        runs = [exercise for index, exercise in enumerate(primary) if index == 0 or exercise != primary[index - 1]]
        repeated_upper = any(runs.count(exercise) > 1 and not MACHINES[exercise].can_fill_rest for exercise in set(runs))
        cable_alternation = any(filler and next((ids[j] for j in range(index - 1, -1, -1) if ids[j] != ids[index]), None)
                                in {key for key, machine in MACHINES.items() if machine.station == "cable_station"}
                                for index, filler in enumerate(fillers))
        if repeated_upper or cable_alternation:
            excluded.append({"session_id": identifier, "date": min(dates),
                             "reasons": ["unsupported upper-body interleaving or cable-station alternation"]})
            continue
        observations = tuple(ObservedSet(PlannedSet(row["exercise_id"], integer(row["reps"], "reps"),
                                  number(row.get("rest_seconds") or MACHINES[row["exercise_id"]].rest_seconds, "rest_seconds"),
                                  fillers[index]), time) for index, (row, time) in enumerate(rows))
        explicit_policies = {str(row.get("carry_rest_between_exercises") or "").strip().lower() for row, _ in rows} - {""}
        if explicit_policies - {"true", "false"} or len(explicit_policies) > 1:
            raise ValueError("CSV carry_rest_between_exercises must be consistent true/false per session")
        carry = next(iter(explicit_policies)) == "true" if explicit_policies else (
            rest_policy_change_date is None or min(dates) >= rest_policy_change_date)
        for index, (previous, current) in enumerate(zip(observations, observations[1:])):
            gap = (current.completed_at - previous.completed_at).total_seconds()
            final = all(row.action.exercise_id != previous.action.exercise_id for row in observations[index + 1:])
            expected_rest = previous.action.rest_seconds if carry or not final else 0
            if not previous.action.during_rest and not current.action.during_rest and gap < expected_rest:
                short_gaps.append({"session_id": identifier, "from": previous.action.exercise_id,
                                   "to": current.action.exercise_id, "gap_seconds": gap,
                                   "assumed_required_rest_seconds": expected_rest})
        sessions.append(Session(identifier, min(dates), next(iter(types)), observations, carry))
    sessions.sort(key=lambda session: (session.local_date, session.observations[0].completed_at))
    if not sessions:
        raise ValueError("No eligible sessions in CSV")
    # A private sidecar can flag a user-confirmed wait without rewriting CSV.
    # Exclude only that incoming calibration gap; keep every validation target.
    marked: set[tuple[str, int]] = set()
    for event in wait_events or []:
        if not isinstance(event, dict):
            raise ValueError("Each wait event must be an object")
        identifier = event.get("session_id")
        if not isinstance(identifier, str) or not identifier:
            raise ValueError("Wait event session_id must be a nonempty string")
        index = integer(event.get("set_index"), "wait event set_index", minimum=2)
        key = (identifier, index)
        if key in marked:
            raise ValueError("Duplicate wait event")
        marked.add(key)
        matches = [position for position, session in enumerate(sessions) if session.session_id == identifier]
        if not matches or index > len(sessions[matches[0]].observations):
            raise ValueError("Wait event must identify an eligible session and existing incoming gap")
        position = matches[0]
        observations = list(sessions[position].observations)
        observations[index - 1] = replace(observations[index - 1], equipment_wait=True)
        sessions[position] = replace(sessions[position], observations=tuple(observations))
    return sessions, {"input_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                      "input_sessions": len(groups), "input_rows": sum(map(len, groups.values())),
                      "eligible_sessions": len(sessions), "excluded_sessions": excluded,
                      "user_confirmed_wait_gap_count": len(marked),
                      "gaps_shorter_than_assumed_required_rest": short_gaps,
                      "historical_rest_policy_change_date_proxy": rest_policy_change_date,
                      "historical_rest_policy_source": "Optional CSV override; otherwise commit 27d787b date proxy (not observed deployment)",
                      "rest_source": "CSV rest_seconds if supplied; otherwise current defaults (historical settings unknown)"}


def transition_key(previous: str, current: str) -> str:
    a, b = MACHINES[previous], MACHINES[current]
    return "same_station_attachment" if a.station == b.station else f"{a.area}->{b.area}"


@dataclass
class TimeModel:
    kind: str
    service_offsets: dict[str, float]
    transition_seconds: dict[str, float]
    transition_pairs: dict[str, float]
    sample_counts: dict[str, int]
    training_sessions: int
    empirical_error_seconds: float | None = None
    error_sample_count: int = 0
    validation: dict[str, Any] | None = None
    transition_sample_counts: dict[str, int] = field(default_factory=dict)
    cooldown_delay_fixed_seconds: float = 0.0
    cooldown_delay_ratio: float = 0.0
    cooldown_delays_by_rest: dict[str, float] = field(default_factory=dict)
    cooldown_delay_ratios_by_exercise: dict[str, float] = field(default_factory=dict)
    excluded_wait_calibration_gaps: int = 0

    def cooldown_delay_seconds(self, action: PlannedSet) -> float:
        """Effective extra overhead after the PREVIOUS set, not pure phone time.

        Explicit delay models fix service at 10+3*reps to avoid counting this
        residual twice. Scaling to unseen custom rests is extrapolation.
        """
        rest = action.rest_seconds
        if rest == 0 or self.kind not in DELAY_MODEL_KINDS:
            return 0.0
        if self.kind == "delay_fixed":
            return self.cooldown_delay_fixed_seconds
        if self.kind == "delay_rest_group":
            return self.cooldown_delays_by_rest.get(str(float(rest)), self.cooldown_delay_ratio * rest)
        if self.kind == "delay_scaled":
            return self.cooldown_delay_ratio * rest
        ratio = self.cooldown_delay_ratios_by_exercise.get(action.exercise_id, self.cooldown_delay_ratio)
        return ratio * rest

    def effective_rest_seconds(self, action: PlannedSet) -> float:
        return action.rest_seconds + self.cooldown_delay_seconds(action)

    def service_seconds(self, action: PlannedSet) -> float:
        return max(SERVICE_FLOOR_SECONDS, self.service_offsets.get(action.exercise_id, 10.0) + REP_SECONDS * action.reps)

    def movement_seconds(self, previous: str, current: str, carry: bool = True) -> float:
        if previous == current:
            return 0.0
        group = transition_key(previous, current)
        prefix = "carry|" if carry else "legacy|"
        return self.transition_pairs.get(f"{prefix}{previous}->{current}", self.transition_seconds.get(
            prefix + group, 30.0 if group == "same_station_attachment" else 60.0))

    @classmethod
    def fit(cls, sessions: Iterable[Session], kind: str = "pooled_median") -> TimeModel:
        """Closed-form means/medians with four-sample pooling, no optimizer.

        Effective offset = same-machine gap - prior rest - 3 * next reps.
        Transition = cross-machine gap - prior rest - next effective service.
        Explicit delay candidates fix service at 10+3*reps, placing the
        remaining residual after the previous cooldown instead. Confirmed
        incoming wait gaps do not calibrate either offset or transition.
        Negative aggregate offsets clip at zero, never inventing negative setup
        or shortening prescribed rest. Long gaps remain in validation targets.
        """
        sessions = list(sessions)
        if not sessions:
            raise ValueError("Calibration requires at least one session")
        if kind not in MODEL_KINDS:
            raise ValueError(f"Unknown model kind: {kind}")
        explicit_delay = kind in DELAY_MODEL_KINDS
        reducer = statistics.mean if kind == "exercise_mean" or explicit_delay else statistics.median
        offsets: dict[str, list[float]] = defaultdict(list)
        pools: dict[int, list[float]] = defaultdict(list)
        delay_samples: list[tuple[PlannedSet, float]] = []
        for session in sessions:
            for previous, current in zip(session.observations, session.observations[1:]):
                a, b = previous.action, current.action
                if a.exercise_id == b.exercise_id and not a.during_rest and not b.during_rest and not current.equipment_wait:
                    extra = (current.completed_at - previous.completed_at).total_seconds() - a.rest_seconds - REP_SECONDS * b.reps
                    offsets[b.exercise_id].append(extra)
                    pools[MACHINES[b.exercise_id].rest_seconds].append(extra)
                    if a.rest_seconds > 0:
                        delay_samples.append((a, extra - 10.0))
        service, counts = {}, {}
        for exercise, machine in MACHINES.items():
            values = offsets[exercise]
            pooled = max(0.0, reducer(pools[machine.rest_seconds])) if pools[machine.rest_seconds] else 10.0
            if kind == "fixed" or explicit_delay:
                value = 10.0
            elif kind == "pooled_median" or not values:
                value = pooled
            else:
                value = (len(values) * reducer(values) + SHRINKAGE_SAMPLES * pooled) / (len(values) + SHRINKAGE_SAMPLES)
            service[exercise] = max(0.0, value)
            counts[exercise] = len(values)
        model = cls(kind, service, {}, {}, counts, len(sessions))
        model.excluded_wait_calibration_gaps = sum(row.equipment_wait for session in sessions for row in session.observations[1:])
        if explicit_delay:
            model._fit_cooldown_delays(delay_samples)
            model.sample_counts = {exercise: sum(a.exercise_id == exercise for a, _ in delay_samples)
                                   for exercise in MACHINES}
        if kind == "fixed":
            return model
        groups: dict[str, list[float]] = defaultdict(list)
        pairs: dict[str, list[float]] = defaultdict(list)
        for session in sessions:
            for index, (previous, current) in enumerate(zip(session.observations, session.observations[1:])):
                a, b = previous.action, current.action
                if a.exercise_id == b.exercise_id or a.during_rest or b.during_rest or current.equipment_wait:
                    continue
                final_for_exercise = all(row.action.exercise_id != a.exercise_id for row in session.observations[index + 1:])
                rest = model.effective_rest_seconds(a) if session.carry_rest_between_exercises or not final_for_exercise else 0.0
                extra = (current.completed_at - previous.completed_at).total_seconds() - rest - model.service_seconds(b)
                prefix = "carry|" if session.carry_rest_between_exercises else "legacy|"
                groups[prefix + transition_key(a.exercise_id, b.exercise_id)].append(extra)
                pairs[f"{prefix}{a.exercise_id}->{b.exercise_id}"].append(extra)
        for group, values in groups.items():
            model.transition_seconds[group] = max(0.0, reducer(values))
            model.transition_sample_counts[group] = len(values)
        for pair, values in pairs.items():
            policy, names = pair.split("|")
            a, b = names.split("->")
            fallback = model.movement_seconds(a, b, policy == "carry")
            model.transition_pairs[pair] = max(0.0, (len(values) * reducer(values) + SHRINKAGE_SAMPLES * fallback) / (len(values) + SHRINKAGE_SAMPLES))
            model.transition_sample_counts[pair] = len(values)
        return model

    def _fit_cooldown_delays(self, samples: list[tuple[PlannedSet, float]]) -> None:
        """Signed residuals aggregated before clipping; long pauses retained.

        Compare a constant, a least-squares through-origin rest multiplier,
        per-rest means, and machine ratios pooled toward the rest group.
        R and machine are confounded in exports using only default rests.
        """
        if not samples:
            return
        self.cooldown_delay_fixed_seconds = max(0.0, statistics.mean(value for _, value in samples))
        self.cooldown_delay_ratio = max(0.0, sum(a.rest_seconds * value for a, value in samples) /
                                        sum(a.rest_seconds ** 2 for a, _ in samples))
        by_rest: dict[str, list[float]] = defaultdict(list)
        by_exercise: dict[str, list[tuple[PlannedSet, float]]] = defaultdict(list)
        for action, value in samples:
            by_rest[str(float(action.rest_seconds))].append(value)
            by_exercise[action.exercise_id].append((action, value))
        self.cooldown_delays_by_rest = {key: max(0.0, statistics.mean(values)) for key, values in by_rest.items()}
        if self.kind == "delay_machine":
            for exercise, machine in MACHINES.items():
                values = by_exercise[exercise]
                rest = float(machine.rest_seconds)
                pooled = self.cooldown_delays_by_rest.get(str(rest), self.cooldown_delay_ratio * rest) / rest
                direct = (sum(a.rest_seconds * value for a, value in values) /
                          sum(a.rest_seconds ** 2 for a, _ in values)) if values else pooled
                self.cooldown_delay_ratios_by_exercise[exercise] = max(0.0,
                    (len(values) * direct + SHRINKAGE_SAMPLES * pooled) / (len(values) + SHRINKAGE_SAMPLES))

    def save(self, path: str | Path) -> None:
        """Generated model output: coefficients/counts only, never raw records."""
        formula = ("service=10+3*reps; effective rest=nominal previous rest+calibrated previous-set residual allowance"
                   if self.kind in DELAY_MODEL_KINDS else
                   "service=max(10, offset[exercise]+3*reps); explicit completion/rest timeline")
        payload = {"version": 1, "formula": formula,
                   "rest_defaults": {key: value.rest_seconds for key, value in MACHINES.items()},
                   "limitations": "Effective overhead is not pure cadence. Historical rest settings unknown. Error range is empirical, not a guaranteed confidence interval.",
                   "model": asdict(self)}
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path = DEFAULT_MODEL) -> TimeModel:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if payload.get("version") != 1:
            raise ValueError("Unsupported model file version")
        if payload.get("rest_defaults") != {key: value.rest_seconds for key, value in MACHINES.items()}:
            raise ValueError("Model rest defaults differ from estimator; recalibrate")
        model = cls(**payload["model"])
        if model.kind not in MODEL_KINDS:
            raise ValueError("Unknown model kind in file")
        for mapping in (model.service_offsets, model.transition_seconds, model.transition_pairs,
                        model.cooldown_delays_by_rest, model.cooldown_delay_ratios_by_exercise):
            for key, value in mapping.items():
                number(value, key)
        number(model.cooldown_delay_fixed_seconds, "cooldown_delay_fixed_seconds")
        number(model.cooldown_delay_ratio, "cooldown_delay_ratio")
        for key in model.cooldown_delays_by_rest:
            if str(float(number(key, "cooldown group", minimum=1))) != key:
                raise ValueError("Cooldown group keys must be positive normalized floats")
        if not set(model.cooldown_delay_ratios_by_exercise).issubset(MACHINES):
            raise ValueError("Unknown exercise in cooldown delay coefficients")
        if model.kind in DELAY_MODEL_KINDS and any(value != 10.0 for value in model.service_offsets.values()):
            raise ValueError("Explicit delay models require fixed service offsets to prevent double counting")
        if set(model.service_offsets) != set(MACHINES) or set(model.sample_counts) != set(MACHINES):
            raise ValueError("Model must include coefficients and sample counts for every supported exercise")
        for key, value in model.sample_counts.items():
            integer(value, key, minimum=0)
        for key, value in model.transition_sample_counts.items():
            integer(value, key, minimum=0)
        integer(model.error_sample_count, "error_sample_count", minimum=0)
        integer(model.excluded_wait_calibration_gaps, "excluded_wait_calibration_gaps", minimum=0)
        integer(model.training_sessions, "training_sessions")
        if model.empirical_error_seconds is not None:
            number(model.empirical_error_seconds, "empirical_error_seconds")
        return model


@dataclass(frozen=True)
class Prediction:
    minutes: float
    logged_minutes: float
    stations: int
    set_count: int
    empirical_range_minutes: tuple[float, float] | None
    warnings: tuple[str, ...]
    timeline: tuple[dict[str, Any], ...]


def estimate(plan: DayPlan, model: TimeModel) -> Prediction:
    """Straight sets rest BEFORE movement/setup, including machine changes.

    Explicit filler/return travel can overlap rest. Each exercise deadline
    survives abs/leg insertion; unlike the PWA, this has independent clocks.
    No final cooldown is charged. Initial setup/warm-up is user-supplied only.
    """
    completion = plan.initial_setup_seconds + plan.warmup_seconds
    deadline: dict[str, float] = {}
    primary_deadline = completion
    timeline, warnings = [], []
    previous: PlannedSet | None = None
    previous_primary: str | None = None
    first_completion = 0.0
    remaining = Counter(action.exercise_id for action in plan.sets)
    for index, action in enumerate(plan.sets):
        if action.during_rest and previous_primary is not None and MACHINES[previous_primary].station == "cable_station":
            raise ValueError("Do not leave the cable station for a rest filler")
        movement = model.movement_seconds(previous.exercise_id, action.exercise_id, plan.carry_rest_between_exercises) if previous else 0.0
        required_ready = deadline.get(action.exercise_id, 0.0)
        if not action.during_rest:
            required_ready = max(required_ready, primary_deadline)
        if action.during_rest or (previous and previous.during_rest):
            start = max(completion + movement, required_ready)
        else:
            start = max(completion, required_ready) + movement
        service = model.service_seconds(action)
        end = start + service
        rest_deadline_used = index + 1 < len(plan.sets) and (
            remaining[action.exercise_id] > 1 or (not action.during_rest and plan.carry_rest_between_exercises))
        timeline.append({"set_index": index + 1, "exercise_id": action.exercise_id, "reps": action.reps,
                         "during_rest": action.during_rest, "start_seconds": start, "completion_seconds": end,
                         "idle_and_transition_seconds": start - completion,
                         "movement_seconds": movement, "effective_service_seconds": service,
                         "nominal_rest_after_seconds": action.rest_seconds,
                         "modeled_extra_overhead_after_seconds": model.cooldown_delay_seconds(action) if rest_deadline_used else 0.0,
                         "effective_rest_after_seconds": model.effective_rest_seconds(action) if rest_deadline_used else 0.0})
        deadline[action.exercise_id] = end + model.effective_rest_seconds(action)
        remaining[action.exercise_id] -= 1
        if not action.during_rest:
            primary_deadline = end + (model.effective_rest_seconds(action) if plan.carry_rest_between_exercises or remaining[action.exercise_id] else 0)
            previous_primary = action.exercise_id
        completion, previous = end, action
        if index == 0:
            first_completion = end
    for exercise in sorted({action.exercise_id for action in plan.sets}):
        if model.sample_counts.get(exercise, 0) < 4:
            warnings.append(f"Sparse direct calibration for {exercise}: {model.sample_counts.get(exercise, 0)} adjacent cycles; pooled assumptions apply")
    prefix = "carry|" if plan.carry_rest_between_exercises else "legacy|"
    used_pairs = {(a.exercise_id, b.exercise_id) for a, b in zip(plan.sets, plan.sets[1:])
                  if a.exercise_id != b.exercise_id}
    for a, b in sorted(used_pairs):
        pair = f"{prefix}{a}->{b}"
        count = model.transition_sample_counts.get(pair, 0)
        if count < 4:
            group = prefix + transition_key(a, b)
            group_count = model.transition_sample_counts.get(group, 0)
            warnings.append(f"Sparse transition {a}->{b}: {count} direct / {group_count} area-group observations; residuals can include queues, especially unreliable for new orders or rest-overlapped travel")
    if any(action.during_rest for action in plan.sets):
        warnings.append("Alternation requires independent recovery tracking; the PWA currently has one global timer")
        if model.kind in DELAY_MODEL_KINDS:
            warnings.append("Straight-set delay allowances are extrapolated into alternation; actively filling rest may change delayed-start behavior")
    if model.kind in DELAY_MODEL_KINDS:
        warnings.append("Extra cooldown overhead is a residual under assumed cadence/logging, not identifiable phone time; machine and default rest duration are confounded")
        if any(action.rest_seconds != MACHINES[action.exercise_id].rest_seconds for action in plan.sets):
            warnings.append("Custom-rest delay scaling is unvalidated extrapolation; no causal effect of changing the timer has been established")
    warnings.append("Excludes unprovided arrival/setup/warm-up and cannot predict a particular equipment queue")
    if not model.validation or not model.validation.get("coarse_forecast_gates_pass", False):
        warnings.append("EXPERIMENTAL: this model has not passed all forecast-accuracy gates; do not use it to promise a 30-minute ceiling")
    elif model.validation.get("requires_prospective_validation", True):
        warnings.append("Only retrospectively evaluated; a future unseen period is still needed before schedule optimization")
    radius = model.empirical_error_seconds
    interval = (max(0.0, completion - radius) / 60, (completion + radius) / 60) if radius is not None else None
    return Prediction(completion / 60, (completion - first_completion) / 60,
                      len({MACHINES[action.exercise_id].station for action in plan.sets}), len(plan.sets),
                      interval, tuple(warnings), tuple(timeline))


def error_summary(rows: list[dict[str, Any]]) -> dict[str, float | int]:
    if not rows:
        raise ValueError("At least one prediction is required")
    errors = [row["predicted_seconds"] - row["actual_seconds"] for row in rows]
    absolute = sorted(map(abs, errors))
    return {"sessions": len(rows), "mae_minutes": statistics.mean(absolute) / 60,
            "bias_minutes": statistics.mean(errors) / 60,
            "rmse_minutes": math.sqrt(statistics.mean(error * error for error in errors)) / 60,
            "worst_absolute_error_minutes": max(absolute) / 60,
            "within_5_minutes": sum(error <= 300 for error in absolute) / len(absolute),
            "absolute_error_p80_seconds": absolute[max(0, math.ceil(0.8 * len(absolute)) - 1)]}


def evaluate(model: TimeModel, sessions: Iterable[Session]) -> list[dict[str, Any]]:
    rows = []
    for session in sessions:
        prediction = estimate(session.plan, model)
        rows.append({"session_id": session.session_id, "date": session.local_date,
                     "workout_type": session.workout_type, "set_count": len(session.observations),
                     "stations": prediction.stations, "actual_seconds": session.actual_seconds,
                     "predicted_seconds": prediction.logged_minutes * 60,
                     "error_seconds": prediction.logged_minutes * 60 - session.actual_seconds})
    return rows


def diagnose(model: TimeModel, session: Session) -> list[dict[str, Any]]:
    """Completion-gap residuals, not causal estimates of waiting or rep time."""
    timeline = estimate(session.plan, model).timeline
    rows = []
    for index, (previous, current) in enumerate(zip(session.observations, session.observations[1:])):
        a, b = previous.action, current.action
        actual = (current.completed_at - previous.completed_at).total_seconds()
        predicted = timeline[index + 1]["completion_seconds"] - timeline[index]["completion_seconds"]
        category = "alternation" if a.during_rest or b.during_rest else "within_machine" if a.exercise_id == b.exercise_id else "machine_change"
        rows.append({"from_set": index + 1, "to_set": index + 2, "from_exercise": a.exercise_id,
                     "to_exercise": b.exercise_id, "category": category,
                     "previous_rest_seconds": a.rest_seconds, "actual_gap_seconds": actual,
                     "predicted_gap_seconds": predicted, "unpredicted_seconds": actual - predicted,
                     "predicted_effective_service_seconds": timeline[index + 1]["effective_service_seconds"],
                     "predicted_movement_seconds": timeline[index + 1]["movement_seconds"]})
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prediction = commands.add_parser("estimate", help="Predict an ordered JSON day")
    prediction.add_argument("plan", type=Path)
    prediction.add_argument("--day", help="Choose a named day from a days object")
    prediction.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    prediction.add_argument("--json", action="store_true", help="Include explanatory timeline")
    fitting = commands.add_parser("fit", help="Calibrate a local CSV; does not validate accuracy")
    fitting.add_argument("csv", type=Path)
    fitting.add_argument("--kind", choices=MODEL_KINDS, default="pooled_median")
    fitting.add_argument("--rest-policy-change-date", default=REST_POLICY_CHANGE_DATE,
                         help="Historical deployment proxy; 'none' assumes current full cooldown throughout")
    fitting.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "fit":
            sessions, diagnostics = load_history(args.csv, None if args.rest_policy_change_date == "none" else args.rest_policy_change_date)
            model = TimeModel.fit(sessions, args.kind)
            model.save(args.output)
            print(json.dumps({"saved": str(args.output), "diagnostics": diagnostics}, indent=2))
        else:
            document = json.loads(args.plan.read_text(encoding="utf-8"))
            if args.day:
                if not isinstance(document, dict):
                    raise ValueError("Named-day input must contain a days object")
                if args.day not in document.get("days", {}):
                    raise ValueError(f"No day named {args.day}")
                document = document["days"][args.day]
            result = estimate(DayPlan.from_dict(document), TimeModel.load(args.model))
            if args.json:
                print(json.dumps(asdict(result), indent=2, allow_nan=False))
            else:
                print(f"Estimated set-sequence time: {result.minutes:.1f} minutes")
                print(f"Comparable first-to-last logged span: {result.logged_minutes:.1f} minutes")
                print(f"{result.set_count} sets; {result.stations} physical stations")
                if result.empirical_range_minutes:
                    low, high = result.empirical_range_minutes
                    print(f"Indicative empirical error range: {low:.1f}-{high:.1f} minutes (not guaranteed)")
                for warning in result.warnings:
                    print(f"Note: {warning}")
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(2, f"error: {error}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
