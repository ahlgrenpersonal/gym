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

  it("activates the five-day four-station schedule with 61 weekly sets", () => {
    expect(ACTIVE_ROUTINE_ID).toBe("weekday_four_station");
    expect(ACTIVE_WORKOUT_TYPES).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
    ]);

    const expected = {
      monday: [
        ["lat_pulldown", 3],
        ["chest_supported_row", 3],
        ["reverse_pec_deck", 2],
        ["triceps_pushdown", 2],
      ],
      tuesday: [
        ["incline_chest_press", 4],
        ["shoulder_press", 3],
        ["lateral_raise", 4],
        ["abdominal_crunch_machine", 2],
      ],
      wednesday: [
        ["lat_pulldown", 3],
        ["chest_supported_row", 3],
        ["reverse_pec_deck", 2],
        ["preacher_or_cable_curl", 3],
      ],
      thursday: [
        ["incline_chest_press", 4],
        ["shoulder_press", 3],
        ["lateral_raise", 5],
        ["abdominal_crunch_machine", 2],
      ],
      friday: [
        ["leg_press", 2],
        ["single_leg_extension", 2],
        ["preacher_or_cable_curl", 3],
        ["overhead_triceps_extension", 4],
        ["triceps_pushdown", 2],
      ],
    } as const;

    let weeklySets = 0;
    for (const workoutType of ACTIVE_WORKOUT_TYPES) {
      const exercises = workoutExercises(DEFAULT_EXERCISES, workoutType);
      expect(
        exercises.map((exercise) => [exercise.id, exercise.targetSets]),
      ).toEqual(expected[workoutType]);
      weeklySets += exercises.reduce(
        (total, exercise) => total + exercise.targetSets,
        0,
      );

      const stations = new Set(
        ROUTINE_PRESETS.weekday_four_station.workouts[
          workoutType
        ]?.entries.map((entry) => entry.station),
      );
      expect(stations.size).toBeLessThanOrEqual(4);
    }
    expect(weeklySets).toBe(61);
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
