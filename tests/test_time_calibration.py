"""Leakage, algebra and reproducibility tests; never require private history."""

import json
import math
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from TimeEstimator import DayPlan, MACHINES, ObservedSet, PlannedSet, Session, estimate
from scripts import experiment_time_calibration as calibration
from test_time_estimator import session, write_csv


CHEST = "incline_chest_press"
ROW = "chest_supported_row"


def variable_session(identifier="one", machine=CHEST, addition=30, factor=1.1):
    beginning = datetime(2026, 9, 10, tzinfo=timezone.utc)
    observations = []
    for index, reps in enumerate((8, 10, 14, 18)):
        action = PlannedSet(machine, reps, MACHINES[machine].rest_seconds)
        if index:
            beginning += timedelta(seconds=addition + factor * (action.rest_seconds + 10 + 3 * reps))
        observations.append(ObservedSet(action, beginning))
    return Session(identifier, "2026-09-10", "push", tuple(observations))


def row(predicted=100, actual=110, floor=20):
    return {"predicted_seconds": predicted, "actual_seconds": actual, "floor_seconds": floor}


class AlgebraTests(unittest.TestCase):
    def test_affine_recovers_known_equation_without_pooling(self):
        a, b = calibration.nonnegative_affine([(1, 30), (2, 50), (3, 70)], strength=0)
        self.assertAlmostEqual(a, 10)
        self.assertAlmostEqual(b, 20)

    def test_affine_checks_nonnegative_boundaries(self):
        a, b = calibration.nonnegative_affine([(1, -5), (2, -10)], strength=0)
        self.assertEqual((a, b), (0, 0))
        a, b = calibration.nonnegative_affine([(1, 30), (2, 20), (3, 10)], strength=0)
        self.assertEqual((a, b), (20, 0))

    def test_empty_affine_uses_prior(self):
        self.assertEqual(calibration.nonnegative_affine([], (10, 2)), (10, 2))

    def test_new_machine_models_never_shorten_rest_and_zero_rest_has_no_extra(self):
        for kind in calibration.MACHINE_KINDS:
            model = calibration.fit_base([variable_session()], kind)
            action = PlannedSet(CHEST, 12, 180)
            self.assertGreaterEqual(model.effective_rest_seconds(action), 180)
            self.assertEqual(model.cooldown_delay_seconds(replace(action, rest_seconds=0)), 0)
            self.assertGreaterEqual(model.service_seconds(action), 46)

    def test_one_machine_cycle_equation_matches_timeline(self):
        model = calibration.fit_base([variable_session()], "machine_cycle_affine")
        plan = DayPlan((PlannedSet(CHEST, 8, 180), PlannedSet(CHEST, 14, 180)))
        expected = model.machine_additions[CHEST] + model.machine_multipliers[CHEST] * (180 + 10 + 42)
        self.assertAlmostEqual(estimate(plan, model).logged_minutes * 60, expected)
        self.assertEqual(estimate(plan, model).timeline[-1]["effective_rest_after_seconds"], 0)

    def test_confirmed_incoming_wait_does_not_fit_machine(self):
        ordinary = variable_session()
        marked = replace(ordinary, observations=(ordinary.observations[0],
                         replace(ordinary.observations[1], equipment_wait=True), *ordinary.observations[2:]))
        for kind in calibration.MACHINE_KINDS:
            fitted = calibration.fit_base([marked], kind)
            self.assertEqual(fitted.sample_counts[CHEST], 2)
            self.assertEqual(fitted.excluded_wait_calibration_gaps, 1)
        self.assertEqual(marked.actual_seconds, ordinary.actual_seconds)

    def test_nominal_floor_no_transition_but_full_cross_machine_rest(self):
        plan = DayPlan((PlannedSet(CHEST, 10, 180), PlannedSet(ROW, 10, 180)))
        self.assertEqual(calibration.floor_seconds(plan), 220)
        self.assertEqual(calibration.floor_seconds(replace(plan, carry_rest_between_exercises=False)), 40)

    def test_multiplier_mae_is_weighted_not_unweighted_ratio_median(self):
        correction = calibration.fit_global([row(10, 10), row(20, 20), row(100, 200)], "multiplier_mae")
        self.assertEqual(correction.multiplier, 2)

    def test_multiplier_rmse_recovers_through_origin_least_squares(self):
        correction = calibration.fit_global([row(100, 200), row(200, 300)], "multiplier_rmse")
        self.assertAlmostEqual(correction.multiplier, 1.6)

    def test_global_loss_minima_with_active_floors(self):
        samples = [row(100, 30, 50), row(200, 400, 100), row(30, 100, 40)]
        for kind, power in (("multiplier_mae", 1), ("multiplier_rmse", 2)):
            fitted = calibration.fit_global(samples, kind)
            loss = lambda k: sum(abs(max(s["floor_seconds"], k*s["predicted_seconds"]) - s["actual_seconds"]) ** power for s in samples)
            for k in (index / 100 for index in range(501)):
                self.assertLessEqual(loss(fitted.multiplier), loss(k) + 1e-6)

    def test_offset_mae_and_floor(self):
        fitted = calibration.fit_global([row(100, 130), row(200, 250), row(300, 340)], "offset_mae")
        self.assertEqual(fitted.offset_seconds, 40)
        self.assertEqual(calibration.GlobalCorrection("offset_mae", 1, -500).apply(100, 40), 40)

    def test_fixed_1_15_and_identity_are_reproducible_benchmarks(self):
        self.assertEqual(calibration.fit_global([row()], "fixed_1_15").multiplier, 1.15)
        self.assertEqual(calibration.fit_global([row()], "identity").multiplier, 1)

    def test_nonfinite_or_zero_global_inputs_rejected(self):
        for bad in (row(predicted=0), row(actual=0), row(floor=-1), row(predicted=math.nan)):
            with self.assertRaises(ValueError):
                calibration.fit_global([bad], "multiplier_mae")


class ValidationTests(unittest.TestCase):
    def samples(self):
        return [session(str(index), CHEST if index % 2 else ROW,
                        f"2026-09-{index + 1:02}", gap=230 + 10*index) for index in range(12)]

    def test_all_base_and_global_fits_exclude_outer_test_sessions(self):
        samples = self.samples()
        real_fit = calibration.fit_base
        training_ids = []
        def recorded(training, kind):
            training_ids.append({s.session_id for s in training})
            return real_fit(training, kind)
        outer_test = calibration.folds(samples, 17)[0]
        ids = {s.session_id for s in outer_test}
        # Run only the first outer fold; inner cross-fitting still uses real folds.
        real_folds = calibration.folds
        def first_outer(items, seed, count=4):
            return [outer_test] if items is samples else real_folds(items, seed, count)
        with patch.object(calibration, "fit_base", recorded), patch.object(calibration, "folds", first_outer):
            rows = calibration.compare_cv(samples, 17)
        self.assertTrue(training_ids)
        self.assertTrue(all(not ids & training for training in training_ids))
        self.assertTrue(all({r["session_id"] for r in value} == ids for value in rows.values()))

    def test_outer_outcome_change_cannot_change_its_prediction_or_global_factor(self):
        samples = self.samples()
        target = calibration.folds(samples, 17)[0][0]
        changed = replace(target, observations=(target.observations[0], replace(target.observations[1],
                          completed_at=target.observations[1].completed_at + timedelta(seconds=2000))))
        revised = [changed if s.session_id == target.session_id else s for s in samples]
        before, after = calibration.compare_cv(samples, 17), calibration.compare_cv(revised, 17)
        for key in calibration.CANDIDATES:
            a = next(r for r in before[key] if r["session_id"] == target.session_id)
            b = next(r for r in after[key] if r["session_id"] == target.session_id)
            self.assertEqual(a["predicted_seconds"], b["predicted_seconds"])
            self.assertEqual(a["global_multiplier"], b["global_multiplier"])
            self.assertEqual(a["global_offset_seconds"], b["global_offset_seconds"])
            self.assertNotEqual(a["actual_seconds"], b["actual_seconds"])

    def test_retrospective_later_outcome_does_not_select_candidate_or_coefficients(self):
        development = self.samples()
        later = [session("private-later1", date="2026-09-14"), session("private-later2", date="2026-09-15")]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "history.csv"
            write_csv(source, development + later)
            before, _ = calibration.experiment(source, repeats=1)
            write_csv(source, development + [replace(s, observations=(s.observations[0],
                        replace(s.observations[1], completed_at=s.observations[1].completed_at + timedelta(seconds=500)))) for s in later])
            after, _ = calibration.experiment(source, repeats=1)
        self.assertEqual(before["selected_candidate"], after["selected_candidate"])
        self.assertEqual(before["candidate_cv"], after["candidate_cv"])
        self.assertEqual(before["frozen_global_coefficients"], after["frozen_global_coefficients"])
        self.assertNotEqual(before["later_raw_metrics"], after["later_raw_metrics"])
        self.assertNotIn("private-later", json.dumps(before))

    def test_repeat_gap_error_labels_cycle_denominator(self):
        model = calibration.fit_base([variable_session()], "machine_additive")
        rows = calibration.repeat_gap_rows(model, [variable_session()])
        self.assertEqual(len(rows[CHEST]), 3)
        metrics = calibration.repeat_gap_summary(rows[CHEST])
        self.assertEqual(metrics["cycles"], 3)
        self.assertNotIn("sessions", metrics)
        self.assertIn("mae_seconds", metrics)


if __name__ == "__main__":
    unittest.main()
