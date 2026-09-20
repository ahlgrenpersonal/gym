import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXERCISES,
  IMAGE_CROPS,
  workoutExercises,
} from "../lib/exercises";
import {
  ACTIVE_ROUTINE_ID,
  ACTIVE_WORKOUT_TYPES,
  ROUTINE_PRESETS,
} from "../lib/routine";

describe("default workout routine", () => {
  it("keeps the reversible classic split with the agreed fourth chest set", () => {
    const push = DEFAULT_EXERCISES.filter(
      (exercise) => exercise.workoutType === "push",
    );

    expect(push.map((exercise) => exercise.id)).toEqual([
      "incline_chest_press",
      "shoulder_press",
      "lateral_raise",
      "triceps_pushdown",
      "overhead_triceps_extension",
    ]);
    expect(push[1]).toMatchObject({
      name: "Shoulder Press Machine",
      targetSets: 3,
      minReps: 8,
      maxReps: 12,
      imageKey: "shoulder_press",
    });
    expect(IMAGE_CROPS.shoulder_press.asset).toBe(
      "workout-shoulder-press.png",
    );
    expect(workoutExercises(DEFAULT_EXERCISES, "push")[0]).toMatchObject({
      id: "incline_chest_press",
      targetSets: 4,
    });
  });

  it("shares three lateral-raise sets with Legs + Abs in fourth position", () => {
    const legsAbs = workoutExercises(DEFAULT_EXERCISES, "legs_abs");

    expect(legsAbs.map((exercise) => exercise.id)).toEqual([
      "leg_press",
      "single_leg_extension",
      "abdominal_crunch_machine",
      "lateral_raise",
    ]);
    const pushLateralRaise = workoutExercises(DEFAULT_EXERCISES, "push").find(
      (exercise) => exercise.id === "lateral_raise",
    );

    expect(legsAbs[3]?.id).toBe(pushLateralRaise?.id);
    expect(legsAbs[3]).toMatchObject({
      targetSets: 3,
      imageKey: "lateral_raise",
      additionalWorkoutOrders: { legs_abs: 3 },
    });
  });

  it("keeps Pull to four complementary exercises", () => {
    const pull = DEFAULT_EXERCISES.filter(
      (exercise) => exercise.workoutType === "pull",
    );

    expect(pull.map((exercise) => exercise.id)).toEqual([
      "lat_pulldown",
      "chest_supported_row",
      "reverse_pec_deck",
      "preacher_or_cable_curl",
    ]);

    const seatedRow = pull[1];

    expect(seatedRow).toMatchObject({
      id: "chest_supported_row",
      name: "Seated Row Machine",
      targetSets: 3,
      minReps: 8,
      maxReps: 12,
      imageKey: "chest_supported_row",
    });
    expect(IMAGE_CROPS.chest_supported_row.asset).toBe(
      "workout-seated-row-machine.jpg",
    );
  });

  it("activates the balanced five-day schedule with equal time-driving sets", () => {
    expect(ACTIVE_ROUTINE_ID).toBe("weekday_balanced");
    expect(ACTIVE_WORKOUT_TYPES).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
    ]);

    const expected = {
      monday: [
        ["incline_chest_press", 3, null],
        ["shoulder_press", 2, null],
        ["abdominal_crunch_machine", 1, "shoulder_press"],
        ["lateral_raise", 3, null],
        ["triceps_pushdown", 2, null],
        ["overhead_triceps_extension", 1, null],
      ],
      tuesday: [
        ["lat_pulldown", 3, null],
        ["chest_supported_row", 3, null],
        ["reverse_pec_deck", 2, null],
        ["single_leg_extension", 1, "reverse_pec_deck"],
        ["preacher_or_cable_curl", 3, null],
      ],
      wednesday: [
        ["incline_chest_press", 2, null],
        ["shoulder_press", 2, null],
        ["abdominal_crunch_machine", 2, "shoulder_press"],
        ["leg_press", 2, null],
        ["lateral_raise", 3, null],
        ["overhead_triceps_extension", 2, null],
      ],
      thursday: [
        ["lat_pulldown", 3, null],
        ["chest_supported_row", 3, null],
        ["reverse_pec_deck", 2, null],
        ["single_leg_extension", 1, "reverse_pec_deck"],
        ["preacher_or_cable_curl", 3, null],
      ],
      friday: [
        ["incline_chest_press", 3, null],
        ["shoulder_press", 2, null],
        ["abdominal_crunch_machine", 1, "shoulder_press"],
        ["lateral_raise", 3, null],
        ["triceps_pushdown", 2, null],
        ["overhead_triceps_extension", 1, null],
      ],
    } as const;
    const expectedRestSeconds = {
      monday: 1_500,
      tuesday: 1_560,
      wednesday: 1_560,
      thursday: 1_560,
      friday: 1_500,
    } as const;
    const expectedWeeklySets = {
      incline_chest_press: 8,
      shoulder_press: 6,
      lateral_raise: 9,
      triceps_pushdown: 4,
      overhead_triceps_extension: 4,
      lat_pulldown: 6,
      chest_supported_row: 6,
      reverse_pec_deck: 4,
      preacher_or_cable_curl: 6,
      leg_press: 2,
      single_leg_extension: 2,
      abdominal_crunch_machine: 4,
    };

    let weeklySets = 0;
    const weeklySetsByExercise: Record<string, number> = {};
    for (const workoutType of ACTIVE_WORKOUT_TYPES) {
      const exercises = workoutExercises(DEFAULT_EXERCISES, workoutType);
      const entries =
        ROUTINE_PRESETS.weekday_balanced.workouts[workoutType]?.entries ?? [];
      expect(
        entries.map((entry) => [
          entry.exerciseId,
          entry.targetSets,
          entry.alternatesWith ?? null,
        ]),
      ).toEqual(expected[workoutType]);
      expect(
        exercises
          .filter((exercise) => exercise.alternatesWithExerciseId)
          .map((exercise) => [
            exercise.id,
            exercise.alternatesWithExerciseId,
          ]),
      ).toEqual(
        entries
          .filter((entry) => entry.alternatesWith)
          .map((entry) => [entry.exerciseId, entry.alternatesWith]),
      );
      for (const entry of entries.filter((item) => item.alternatesWith)) {
        const alternatingIndex = entries.findIndex(
          (item) => item.exerciseId === entry.exerciseId,
        );
        const mainIndex = entries.findIndex(
          (item) => item.exerciseId === entry.alternatesWith,
        );
        expect(alternatingIndex).toBe(mainIndex + 1);
      }
      weeklySets += exercises.reduce(
        (total, exercise) => total + exercise.targetSets,
        0,
      );
      for (const exercise of exercises) {
        weeklySetsByExercise[exercise.id] =
          (weeklySetsByExercise[exercise.id] ?? 0) + exercise.targetSets;
      }

      const timeDrivingEntries = entries.filter(
        (entry) => entry.alternatesWith === undefined,
      );
      expect(
        timeDrivingEntries.reduce(
          (total, entry) => total + (entry.targetSets ?? 0),
          0,
        ),
      ).toBe(11);
      expect(
        new Set(timeDrivingEntries.map((entry) => entry.station)).size,
      ).toBeLessThanOrEqual(4);

      const restSeconds = timeDrivingEntries.reduce((total, entry, index) => {
        const exercise = DEFAULT_EXERCISES.find(
          (candidate) => candidate.id === entry.exerciseId,
        );
        if (!exercise) throw new Error(`Unknown exercise: ${entry.exerciseId}`);
        const sets = entry.targetSets ?? exercise.targetSets;
        const restGaps =
          index === timeDrivingEntries.length - 1 ? sets - 1 : sets;
        return total + restGaps * exercise.restSeconds;
      }, 0);
      expect(restSeconds).toBe(expectedRestSeconds[workoutType]);
    }
    expect(weeklySets).toBe(61);
    expect(weeklySetsByExercise).toEqual(expectedWeeklySets);
  });

  it("prescribes three direct biceps-curl sets with the correct image", () => {
    const curl = DEFAULT_EXERCISES.find(
      (exercise) => exercise.id === "preacher_or_cable_curl",
    );

    expect(curl).toMatchObject({
      name: "Biceps Curl",
      targetSets: 3,
      minReps: 8,
      maxReps: 12,
    });
    expect(IMAGE_CROPS.preacher_or_cable_curl.asset).toBe(
      "workout-low-cable-biceps-curl.png",
    );
  });

  it("uses the agreed weights and hypertrophy rep ranges", () => {
    const plan = Object.fromEntries(
      DEFAULT_EXERCISES.map((exercise) => [
        exercise.id,
        {
          weight: exercise.defaultWeightLb,
          effective: exercise.defaultWeightEffectiveLocalDate,
          reps: [exercise.minReps, exercise.maxReps],
        },
      ]),
    );

    expect(plan).toEqual({
      incline_chest_press: { weight: 80, effective: "2026-09-10", reps: [8, 12] },
      shoulder_press: { weight: 70, effective: "2026-09-10", reps: [8, 12] },
      lateral_raise: { weight: 10, effective: "2026-09-03", reps: [8, 15] },
      triceps_pushdown: { weight: 40, effective: "2026-09-03", reps: [8, 15] },
      overhead_triceps_extension: {
        weight: 30,
        effective: "2026-09-03",
        reps: [8, 15],
      },
      lat_pulldown: { weight: 90, effective: "2026-09-03", reps: [8, 12] },
      chest_supported_row: { weight: 120, effective: "2026-09-10", reps: [8, 12] },
      reverse_pec_deck: { weight: 70, effective: "2026-09-10", reps: [10, 15] },
      preacher_or_cable_curl: { weight: 30, effective: "2026-09-03", reps: [8, 12] },
      leg_press: { weight: 140, effective: "2026-09-03", reps: [10, 15] },
      single_leg_extension: { weight: 60, effective: "2026-09-03", reps: [8, 12] },
      abdominal_crunch_machine: {
        weight: 100,
        effective: "2026-09-10",
        reps: [10, 15],
      },
    });
  });
});
