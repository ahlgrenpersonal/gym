"""Algebra and timeline tests for the explicit gap-equation experiment."""

import unittest
from collections import Counter
from datetime import datetime, timedelta, timezone
from dataclasses import replace

from TimeEstimator import MACHINES, ObservedSet, PlannedSet, Session
from scripts import experiment_gap_equations as gap


CHEST = "incline_chest_press"
ROW = "chest_supported_row"


def observed_session(actions, gaps, identifier="session", carry=True):
    timestamp = datetime(2026, 9, 10, tzinfo=timezone.utc)
    observations = [ObservedSet(actions[0], timestamp)]
    for action, seconds in zip(actions[1:], gaps):
        timestamp += timedelta(seconds=seconds)
        observations.append(ObservedSet(action, timestamp))
    return Session(identifier, "2026-09-10", "test", tuple(observations), carry)


def candidate(cross_rest="fixed", correction="identity"):
    return gap.Candidate(
        "global", "global", 1_000_000_000.0, 2.0, correction, cross_rest
    )


class SolverTests(unittest.TestCase):
    def test_bounded_solver_recovers_known_delay_and_rep_slope(self):
        samples = [
            ({"delay:global": 1.0, "rep:global": reps}, 20 + 2 * reps)
            for reps in (5, 8, 12, 15, 20)
        ]
        fitted = gap._bounded_huber_ridge(
            samples,
            {"delay:global": 30.0, "rep:global": 3.0},
            {},
            1_000_000_000.0,
        )
        self.assertAlmostEqual(fitted["delay:global"], 20.0, places=5)
        self.assertAlmostEqual(fitted["rep:global"], 2.0, places=5)

    def test_coefficients_respect_interpretable_bounds(self):
        fitted = gap._bounded_huber_ridge(
            [({"delay:global": 1.0, "rep:global": 100.0}, 10_000.0)],
            {"delay:global": 30.0, "rep:global": 3.0},
            {},
            60.0,
        )
        self.assertGreaterEqual(fitted["delay:global"], 0)
        self.assertLessEqual(fitted["delay:global"], 60)
        self.assertGreaterEqual(fitted["rep:global"], 1)
        self.assertLessEqual(fitted["rep:global"], 6)


class TimelineTests(unittest.TestCase):
    def model(self, cross_rest="fixed", correction="identity"):
        return gap.GapModel(
            candidate(cross_rest, correction),
            {"global": 0.0},
            {"global": 2.0},
            0.0,
            {"global": 0.5},
        )

    def test_same_machine_keeps_full_cooldown(self):
        action = PlannedSet(CHEST, 10, MACHINES[CHEST].rest_seconds)
        session = observed_session([action, action], [200])
        self.assertEqual(gap.raw_prediction_seconds(session, self.model("global")), 200)

    def test_cross_machine_can_overlap_advisory_cooldown(self):
        chest = PlannedSet(CHEST, 10, MACHINES[CHEST].rest_seconds)
        row = PlannedSet(ROW, 10, MACHINES[ROW].rest_seconds)
        session = observed_session([chest, row], [110])
        # Half of the 180-second timer plus 20 seconds for ten reps.
        self.assertEqual(gap.raw_prediction_seconds(session, self.model("global")), 110)
        self.assertEqual(gap.raw_prediction_seconds(session, self.model("fixed")), 200)

    def test_fixed_global_benchmark_scales_but_never_below_floor(self):
        action = PlannedSet(CHEST, 10, MACHINES[CHEST].rest_seconds)
        session = observed_session([action, action], [200])
        model = self.model(correction="fixed_1_15")
        gap._fit_session_correction([session], model)
        self.assertEqual(model.session_scale, 1.15)
        self.assertAlmostEqual(gap.predict_seconds(session, model), 230)


class DataTreatmentTests(unittest.TestCase):
    def test_confirmed_wait_excludes_only_its_incoming_gap(self):
        action = PlannedSet(CHEST, 10, MACHINES[CHEST].rest_seconds)
        session = observed_session([action, action, action], [500, 200])
        marked = replace(
            session,
            observations=(
                session.observations[0],
                replace(session.observations[1], equipment_wait=True),
                session.observations[2],
            ),
        )
        rows, excluded = gap.ordinary_rows([marked])
        self.assertEqual(excluded, 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(marked.actual_seconds, session.actual_seconds)

    def test_candidate_family_contains_robust_ls_and_scaling_controls(self):
        options = gap.candidates()
        self.assertTrue(any(item.huber_delta == 1_000_000_000.0 for item in options))
        self.assertTrue(any(item.correction == "fixed_1_15" for item in options))
        self.assertTrue(any(item.cross_rest == "global" for item in options))

    def test_holdout_outcome_cannot_change_fit_or_holdout_prediction(self):
        action = PlannedSet(CHEST, 10, MACHINES[CHEST].rest_seconds)
        training = [
            observed_session([action, action, action], [210, 215], "train-1"),
            observed_session([action, action, action], [205, 220], "train-2"),
        ]
        holdout = observed_session([action, action], [210], "holdout")
        changed_outcome = observed_session([action, action], [900], "holdout")

        fitted = gap.fit_gap_model(training, candidate())
        self.assertEqual(fitted.delay_seconds, gap.fit_gap_model(training, candidate()).delay_seconds)
        self.assertEqual(fitted.rep_seconds, gap.fit_gap_model(training, candidate()).rep_seconds)
        self.assertEqual(
            gap.predict_seconds(holdout, fitted),
            gap.predict_seconds(changed_outcome, fitted),
        )

    def test_promotion_rejects_holdout_regression_and_unstable_selection(self):
        assessment = gap._promotion_assessment(
            {"mae_minutes": 2.0},
            {"mae_minutes": 2.9},
            {"mae_minutes": 2.4},
            {"mae_minutes": 5.4, "bias_minutes": -5.4},
            {"mae_minutes": 3.2},
            Counter({"winner": 2, "runner_up": 2, "third": 1}),
            5,
        )
        self.assertEqual(assessment["decision"], "rejected")
        self.assertFalse(assessment["ready_for_schedule_optimization"])
        self.assertFalse(assessment["gates"]["later_raw_mae_below_current"])
        self.assertFalse(
            assessment["gates"]["winner_selected_in_majority_of_split_seeds"]
        )


if __name__ == "__main__":
    unittest.main()
