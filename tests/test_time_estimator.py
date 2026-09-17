"""Synthetic invariant tests: no private workout export is required."""

import csv
import json
import re
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

from TimeEstimator import (
    MACHINES, DayPlan, ObservedSet, PlannedSet, Session, TimeModel,
    diagnose, error_summary, estimate, load_history,
)
from scripts.validate_time_estimator import aggregate_report, cross_validate, folds, run_experiment


ROOT = Path(__file__).resolve().parents[1]
CHEST = "incline_chest_press"
SHOULDER = "shoulder_press"
ABS = "abdominal_crunch_machine"
ROW = "chest_supported_row"


def action(exercise=CHEST, reps=10, rest=None, filler=False):
    return PlannedSet(exercise, reps, MACHINES[exercise].rest_seconds if rest is None else rest, filler)


def simple_model():
    return TimeModel("fixed", {key: 0.0 for key in MACHINES},
                     {policy + group: 0.0 for policy in ("carry|", "legacy|")
                      for group in ("main->main", "main->near_main", "near_main->main",
                                    "near_main->near_main", "main->other", "other->main",
                                    "same_station_attachment")}, {}, {key: 10 for key in MACHINES}, 1)


def session(identifier, exercise=CHEST, date="2026-09-10", gap=240, carry=True):
    beginning = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    return Session(identifier, date, "push" if exercise == CHEST else "pull", (
        ObservedSet(action(exercise), beginning),
        ObservedSet(action(exercise), beginning + timedelta(seconds=gap)),
    ), carry)


def write_csv(path, sessions):
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["timestamp_utc", "local_datetime", "workout_type",
                                                    "session_id", "exercise_id", "exercise_name", "reps",
                                                    "rest_seconds", "carry_rest_between_exercises"])
        writer.writeheader()
        for item in sessions:
            for observed in item.observations:
                writer.writerow({"timestamp_utc": observed.completed_at.isoformat(), "local_datetime": item.local_date,
                                 "workout_type": item.workout_type, "session_id": item.session_id,
                                 "exercise_id": observed.action.exercise_id, "exercise_name": "Seated Row Machine",
                                 "reps": observed.action.reps, "rest_seconds": observed.action.rest_seconds,
                                 "carry_rest_between_exercises": str(item.carry_rest_between_exercises).lower()})


class ArithmeticTests(unittest.TestCase):
    def test_first_set_included_but_no_final_cooldown(self):
        result = estimate(DayPlan((action(),)), simple_model())
        self.assertEqual(result.minutes, .5)
        self.assertEqual(result.logged_minutes, 0)

    def test_cooldown_on_machine_change(self):
        result = estimate(DayPlan((action(), action(), action(SHOULDER))), simple_model())
        self.assertEqual(result.minutes * 60, 450)
        self.assertEqual(result.logged_minutes * 60, 420)
        self.assertEqual(result.timeline[-1]["start_seconds"], 420)

    def test_two_minute_rest_and_ninety_second_rest(self):
        result = estimate(DayPlan((action("reverse_pec_deck"), action(ABS), action(ABS))), simple_model())
        self.assertEqual(result.minutes * 60, 300)

    def test_transition_after_full_rest(self):
        model = simple_model()
        model.transition_seconds["carry|main->main"] = 60
        result = estimate(DayPlan((action(), action(SHOULDER))), model)
        self.assertEqual(result.minutes * 60, 300)

    def test_legacy_final_machine_rest_skipped(self):
        plan = DayPlan((action(), action(), action(SHOULDER)), carry_rest_between_exercises=False)
        result = estimate(plan, simple_model())
        self.assertEqual(result.minutes * 60, 270)

    def test_abs_fillers_preserve_chest_recovery(self):
        plan = DayPlan((action(), action(ABS, filler=True), action(), action(ABS, filler=True), action()))
        result = estimate(plan, simple_model())
        self.assertEqual(result.minutes * 60, 450)
        self.assertEqual([row["start_seconds"] for row in result.timeline], [0, 30, 210, 240, 420])

    def test_filler_travel_overlaps_rest_and_is_not_subtracted_twice(self):
        model = simple_model()
        model.transition_seconds["carry|main->main"] = 20
        result = estimate(DayPlan((action(), action(ABS, filler=True), action())), model)
        self.assertEqual(result.minutes * 60, 240)
        self.assertEqual(result.timeline[1]["start_seconds"], 50)
        self.assertEqual(result.timeline[2]["start_seconds"], 210)

    def test_long_filler_delays_return(self):
        result = estimate(DayPlan((action(), action(ABS, reps=100, filler=True), action())), simple_model())
        self.assertEqual(result.minutes * 60, 360)

    def test_filler_own_rest_is_enforced(self):
        result = estimate(DayPlan((action(rest=0), action(ABS, filler=True), action(rest=0),
                                   action(ABS, filler=True))), simple_model())
        self.assertEqual(result.timeline[-1]["start_seconds"], 150)

    def test_initial_setup_and_warmup_not_in_logged_span(self):
        result = estimate(DayPlan((action(), action()), initial_setup_seconds=60, warmup_seconds=120), simple_model())
        self.assertEqual(result.minutes * 60, 420)
        self.assertEqual(result.logged_minutes * 60, 210)

    def test_reps_sets_and_cooldown_increase_time(self):
        model = simple_model()
        baseline = estimate(DayPlan((action(), action())), model).minutes
        for plan in [DayPlan((action(reps=15), action(reps=15))), DayPlan((action(), action(), action())),
                     DayPlan((action(rest=240), action(rest=240)))]:
            self.assertGreater(estimate(plan, model).minutes, baseline)

    def test_cable_attachments_share_one_station(self):
        result = estimate(DayPlan((action("triceps_pushdown"), action("overhead_triceps_extension"))), simple_model())
        self.assertEqual(result.stations, 1)

    def test_queue_time_is_not_claimed_identifiable(self):
        sample = session("test", gap=300)
        rows = diagnose(simple_model(), sample)
        self.assertEqual(rows[0]["unpredicted_seconds"], 90)
        self.assertNotIn("queue_seconds", rows[0])


class InputTests(unittest.TestCase):
    def test_block_input_scalar_and_list_reps(self):
        plan = DayPlan.from_dict({"exercises": [
            {"exercise_id": CHEST, "sets": 2, "reps": [12, 8]},
            {"exercise_id": SHOULDER, "sets": 3, "reps": 10, "rest_seconds": 150}]})
        self.assertEqual([item.reps for item in plan.sets], [12, 8, 10, 10, 10])
        self.assertEqual(plan.sets[-1].rest_seconds, 150)

    def test_explicit_alternation_order(self):
        plan = DayPlan.from_dict({"exercises": [{"exercise_id": CHEST, "sets": 2, "reps": 10},
                                               {"exercise_id": ABS, "sets": 1, "reps": 12}],
                                  "set_order": [CHEST, {"exercise_id": ABS, "during_rest": True}, CHEST]})
        self.assertTrue(plan.sets[1].during_rest)

    def test_bad_numbers(self):
        for value in (True, None, 0, -1, float("nan"), float("inf"), 1.5):
            with self.subTest(reps=value), self.assertRaises(ValueError):
                action(reps=value)
        for value in (-1, True, float("nan"), float("inf")):
            with self.subTest(rest=value), self.assertRaises(ValueError):
                action(rest=value)

    def test_direct_api_normalizes_numeric_strings(self):
        result = estimate(DayPlan((action(reps="10", rest="180"),), "60", "120"), simple_model())
        self.assertEqual(result.minutes, 3.5)

    def test_only_legs_and_abs_can_fill_rest(self):
        with self.assertRaises(ValueError):
            action(ROW, filler=True)
        for key in (ABS, "single_leg_extension", "leg_press"):
            self.assertTrue(action(key, filler=True).during_rest)

    def test_cable_station_cannot_be_left_for_alternation(self):
        with self.assertRaises(ValueError):
            estimate(DayPlan((action("lateral_raise"), action(ABS, filler=True))), simple_model())

    def test_invalid_set_order(self):
        base = {"exercises": [{"exercise_id": CHEST, "sets": 2, "reps": 10}]}
        for order in ([CHEST], [CHEST, CHEST, CHEST], [ROW, CHEST], "wrong"):
            with self.subTest(order=order), self.assertRaises(ValueError):
                DayPlan.from_dict({**base, "set_order": order})

    def test_empty_unknown_and_mismatched_plan(self):
        for value in ({"exercises": []}, {"exercises": [{"exercise_id": "typo", "sets": 1, "reps": 10}]},
                      {"exercises": [{"exercise_id": CHEST, "sets": 2, "reps": [10]}]}):
            with self.subTest(plan=value), self.assertRaises(ValueError):
                DayPlan.from_dict(value)
        with self.assertRaises(ValueError):
            DayPlan((action(ABS, filler=True),))

    def test_cooldowns_match_app_definitions(self):
        source = (ROOT / "lib/exercises.ts").read_text(encoding="utf-8")
        for exercise, machine in MACHINES.items():
            match = re.search(r'id: "' + exercise + r'",(?:(?!\bid: ").)*?restSeconds: (\d+)', source, re.S)
            self.assertIsNotNone(match, exercise)
            self.assertEqual(int(match.group(1)), machine.rest_seconds, exercise)


class CalibrationTests(unittest.TestCase):
    def test_closed_form_effective_service(self):
        model = TimeModel.fit([session("one", gap=260)], "exercise_mean")
        self.assertEqual(model.service_offsets[CHEST], 50)
        self.assertEqual(model.service_seconds(action()), 80)

    def test_mean_and_median_candidates_differ(self):
        samples = [session(str(index), gap=gap) for index, gap in enumerate((240, 240, 360))]
        median = TimeModel.fit(samples, "exercise_median")
        mean = TimeModel.fit(samples, "exercise_mean")
        self.assertEqual(median.service_offsets[CHEST], 30)
        self.assertEqual(mean.service_offsets[CHEST], 70)

    def test_no_negative_effective_overhead(self):
        model = TimeModel.fit([session("short", gap=100)])
        self.assertGreaterEqual(model.service_offsets[CHEST], 0)
        self.assertGreaterEqual(model.service_seconds(action()), 10)

    def test_model_serialization_round_trip(self):
        model = TimeModel.fit([session("one")])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json"
            model.save(path)
            self.assertEqual(TimeModel.load(path), model)
            payload = json.loads(path.read_text())
            self.assertNotIn("session_id", json.dumps(payload))
            payload["rest_defaults"][CHEST] = 120
            path.write_text(json.dumps(payload))
            with self.assertRaises(ValueError):
                TimeModel.load(path)

    def test_invalid_calibration(self):
        with self.assertRaises(ValueError):
            TimeModel.fit([])
        with self.assertRaises(ValueError):
            TimeModel.fit([session("one")], "unknown")

    def test_error_summary_independent_arithmetic(self):
        summary = error_summary([{"predicted_seconds": 120, "actual_seconds": 60},
                                 {"predicted_seconds": 60, "actual_seconds": 180}])
        self.assertEqual(summary["mae_minutes"], 1.5)
        self.assertEqual(summary["bias_minutes"], -.5)

    def test_experimental_model_warns(self):
        result = estimate(DayPlan((action(),)), simple_model())
        self.assertTrue(any("EXPERIMENTAL" in warning for warning in result.warnings))

    def test_sparse_transition_warns_even_with_many_exercise_samples(self):
        model = simple_model()
        result = estimate(DayPlan((action(), action(SHOULDER))), model)
        self.assertTrue(any("Sparse transition" in warning for warning in result.warnings))

    def test_missing_model_coefficient_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json"
            simple_model().save(path)
            payload = json.loads(path.read_text())
            del payload["model"]["service_offsets"][CHEST]
            path.write_text(json.dumps(payload))
            with self.assertRaises(ValueError):
                TimeModel.load(path)

    def test_nonfinite_saved_coefficient_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json"
            simple_model().save(path)
            payload = json.loads(path.read_text())
            payload["model"]["service_offsets"][CHEST] = float("nan")
            path.write_text(json.dumps(payload))
            with self.assertRaises(ValueError):
                TimeModel.load(path)


class HistoryAndValidationTests(unittest.TestCase):
    def test_history_order_and_explicit_policy_preserved(self):
        sample = session("one", carry=False)
        sample = replace(sample, observations=tuple(reversed(sample.observations)))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            write_csv(path, [sample])
            samples, diagnostics = load_history(path)
            self.assertFalse(samples[0].carry_rest_between_exercises)
            self.assertEqual(samples[0].actual_seconds, 240)
            self.assertEqual(diagnostics["input_rows"], 2)

    def test_duplicate_timestamp_rejected(self):
        sample = session("duplicate")
        sample = replace(sample, observations=(sample.observations[0], sample.observations[0]))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            write_csv(path, [sample])
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                load_history(path)

    def test_timezone_and_empty_csv_values_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            for timestamps in (("2026-09-10T07:00:00", "2026-09-10T07:04:00"), ("", "2026-09-10T07:04:00Z")):
                path.write_text("timestamp_utc,session_id,exercise_id,reps,workout_type\n" +
                                "\n".join(f"{value},one,{CHEST},10,push" for value in timestamps))
                with self.assertRaises(ValueError):
                    load_history(path)

    def test_historical_policy_date_proxy(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            path.write_text("timestamp_utc,session_id,exercise_id,reps,workout_type\n"
                            f"2026-09-04T07:00:00Z,old,{CHEST},10,push\n"
                            f"2026-09-04T07:04:00Z,old,{CHEST},10,push\n"
                            f"2026-09-10T07:00:00Z,new,{CHEST},10,push\n"
                            f"2026-09-10T07:04:00Z,new,{CHEST},10,push\n")
            samples, _ = load_history(path)
            self.assertEqual([item.carry_rest_between_exercises for item in samples], [False, True])
            samples, _ = load_history(path, None)
            self.assertTrue(all(item.carry_rest_between_exercises for item in samples))

    def test_folds_reproducible_and_session_disjoint(self):
        samples = [session(str(index), CHEST if index % 2 else ROW) for index in range(12)]
        partition = folds(samples)
        self.assertEqual(partition, folds(samples))
        self.assertEqual(sorted(item.session_id for group in partition for item in group),
                         sorted(item.session_id for item in samples))
        self.assertTrue(all({item.workout_type for item in group} == {"push", "pull"} for group in partition))
        self.assertEqual(len(cross_validate(samples, "pooled_median")), 12)

    def test_holdout_outcomes_do_not_change_equation_selection(self):
        development = [session(str(index), CHEST if index % 2 else ROW, f"2026-09-{index + 1:02}")
                       for index in range(10)]
        heldout = [session("h1", date="2026-09-14"), session("h2", date="2026-09-15")]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            write_csv(path, development + heldout)
            original, frozen, _ = run_experiment(path)
            write_csv(path, development + [session("h1", date="2026-09-14", gap=1800),
                                           session("h2", date="2026-09-15", gap=1800)])
            altered, other_frozen, _ = run_experiment(path)
            self.assertEqual(original["chosen_model"], altered["chosen_model"])
            self.assertEqual(frozen.service_offsets, other_frozen.service_offsets)
            self.assertEqual(frozen.transition_pairs, other_frozen.transition_pairs)
            self.assertNotEqual(original["holdout_metrics"], altered["holdout_metrics"])
            aggregate = aggregate_report(original)
            self.assertNotIn("session_id", json.dumps(aggregate))
            radius = original["candidate_cv"][original["chosen_model"]]["absolute_error_p80_seconds"]
            expected = sum(abs(item["error_seconds"]) <= radius for item in original["holdout_predictions"]) / 2
            self.assertEqual(aggregate["development_band_coverage_on_later_holdout"], expected)

    def test_gap_residuals_sum_to_session_error(self):
        sample = session("one", gap=270)
        residuals = diagnose(simple_model(), sample)
        predicted = estimate(sample.plan, simple_model()).logged_minutes * 60
        self.assertAlmostEqual(sum(row["unpredicted_seconds"] for row in residuals), sample.actual_seconds - predicted)


class CLITests(unittest.TestCase):
    def test_committed_example_and_model(self):
        result = subprocess.run([sys.executable, str(ROOT / "TimeEstimator.py"), "estimate",
                                 str(ROOT / "time_estimator_examples.json"), "--day", "tuesday", "--json"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertGreater(output["minutes"], 0)
        self.assertEqual(output["set_count"], 13)


if __name__ == "__main__":
    unittest.main()
