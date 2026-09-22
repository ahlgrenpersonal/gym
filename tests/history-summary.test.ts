import { describe, expect, it } from "vitest";
import { summarizeExercise } from "../app/WorkoutApp";
import type { SetRecord } from "../lib/models";

function setRecord(setNumber: number, weightKg: number, actualReps: number): SetRecord {
  return {
    id: "set-" + setNumber,
    sessionId: "session-1",
    workoutType: "monday",
    exerciseId: "lat_pulldown",
    exerciseName: "Lat Pulldown",
    setNumber,
    actualWeight: weightKg,
    weightUnit: "kg",
    weightKg,
    actualReps,
    timestamp: setNumber,
  };
}

describe("history exercise summaries", () => {
  it("uses centered dots between reps when every set has the same weight", () => {
    const records = [setRecord(1, 40, 12), setRecord(2, 40, 10), setRecord(3, 40, 8)];

    expect(summarizeExercise(records, "kg")).toBe("40 kg → 12 · 10 · 8");
  });

  it("continues to use centered dots between sets with different weights", () => {
    const records = [setRecord(1, 40, 12), setRecord(2, 45, 8)];

    expect(summarizeExercise(records, "kg")).toBe("40 kg × 12 · 45 kg × 8");
  });
});
