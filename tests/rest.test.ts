import { describe, expect, it } from "vitest";
import { currentRestSeconds, restUpdateAfterSet } from "../lib/rest";
import { DEFAULT_EXERCISES, workoutExercises } from "../lib/exercises";

describe("rest timer transitions", () => {
  it("uses three minutes for saved lateral-raise definitions and in-progress snapshots", () => {
    const saved = DEFAULT_EXERCISES.map((exercise) => exercise.id === "lateral_raise"
      ? { ...exercise, restSeconds: 120 } : exercise);
    for (const day of ["monday", "wednesday", "friday"] as const) {
      expect(workoutExercises(saved, day).find((exercise) => exercise.id === "lateral_raise")?.restSeconds).toBe(180);
    }
    expect(saved.find((exercise) => exercise.id === "lateral_raise")?.restSeconds).toBe(120);
    expect(restUpdateAfterSet({ exerciseFinished: false, exerciseId: "lateral_raise",
      restSeconds: currentRestSeconds("lateral_raise", 120), timestamp: 1_000,
    }).activeRestEndTimestamp).toBe(181_000);
    expect(currentRestSeconds("lateral_raise", 195)).toBe(195);
    expect(currentRestSeconds("triceps_pushdown", 120)).toBe(120);
  });
  it("starts rest after a set when the athlete remains on the same exercise", () => {
    expect(
      restUpdateAfterSet({
        exerciseFinished: false,
        exerciseId: "lat_pulldown",
        restSeconds: 180,
        timestamp: 1_000,
      }),
    ).toEqual({
      activeRestEndTimestamp: 181_000,
      activeRestExerciseId: "lat_pulldown",
    });
  });

  it("also starts rest after the final set on a machine", () => {
    expect(
      restUpdateAfterSet({
        exerciseFinished: true,
        exerciseId: "lat_pulldown",
        restSeconds: 180,
        timestamp: 1_000,
      }),
    ).toEqual({
      activeRestEndTimestamp: 181_000,
      activeRestExerciseId: "lat_pulldown",
    });
  });

  it("does not modify an existing cooldown after an alternating set", () => {
    const activeRest = {
      activeRestEndTimestamp: 181_000,
      activeRestExerciseId: "shoulder_press",
    };
    const update = restUpdateAfterSet({
      exerciseFinished: true,
      exerciseId: "abdominal_crunch_machine",
      restSeconds: 90,
      timestamp: 31_000,
      suppressRest: true,
    });

    expect(update).toEqual({});
    expect({ ...activeRest, ...update }).toEqual(activeRest);
  });

  it("does not start a cooldown after an alternating set", () => {
    expect(
      restUpdateAfterSet({
        exerciseFinished: false,
        exerciseId: "abdominal_crunch_machine",
        restSeconds: 90,
        timestamp: 31_000,
        suppressRest: true,
      }),
    ).toEqual({});
  });

  it("still starts cooldown normally for a non-alternating set", () => {
    expect(
      restUpdateAfterSet({
        exerciseFinished: false,
        exerciseId: "abdominal_crunch_machine",
        restSeconds: 90,
        timestamp: 31_000,
      }),
    ).toEqual({
      activeRestEndTimestamp: 121_000,
      activeRestExerciseId: "abdominal_crunch_machine",
    });
  });
});
