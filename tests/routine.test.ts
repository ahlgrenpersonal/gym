import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXERCISES,
  IMAGE_CROPS,
  workoutExercises,
} from "../lib/exercises";

describe("default workout routine", () => {
  it("places the shoulder press immediately after the incline chest press", () => {
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

    expect(legsAbs[3]).toBe(pushLateralRaise);
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

  it("prescribes three direct biceps-curl sets with the correct image", () => {
    const curl = DEFAULT_EXERCISES.find(
      (exercise) => exercise.id === "preacher_or_cable_curl",
    );

    expect(curl).toMatchObject({
      name: "Biceps Curl",
      targetSets: 3,
      minReps: 10,
      maxReps: 15,
    });
    expect(IMAGE_CROPS.preacher_or_cable_curl.asset).toBe(
      "workout-low-cable-biceps-curl.png",
    );
  });
});
