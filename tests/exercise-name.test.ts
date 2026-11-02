import { expect, it } from "vitest";
import { currentExerciseName } from "../lib/exercise-name";
import { DEFAULT_EXERCISES, workoutExercises } from "../lib/exercises";
import { setsToCsv } from "../lib/backup";
import type { SetRecord } from "../lib/models";

it("corrects legacy chest labels without changing identity, prescriptions or stored inputs", () => {
  const definition = {
    ...DEFAULT_EXERCISES.find((exercise) => exercise.id === "incline_chest_press")!,
    name: "Incline Chest Press Machine",
  };
  const original = structuredClone(definition);
  const resolved = workoutExercises([definition], "monday")[0];
  expect(resolved.name).toBe("Chest Press");
  expect(resolved.id).toBe(definition.id);
  expect(resolved.defaultWeightLb).toBe(definition.defaultWeightLb);
  expect(definition).toEqual(original);
  expect(currentExerciseName(definition.id, "My custom chest press")).toBe("My custom chest press");
  expect(currentExerciseName("other", definition.name)).toBe(definition.name);
});

it("exports old sets with the corrected label and all original performance data", () => {
  const record: SetRecord = {
    id: "old-set", sessionId: "old-session", workoutType: "monday",
    exerciseId: "incline_chest_press", exerciseName: "Incline Chest Press Machine",
    setNumber: 2, actualWeight: 50, weightUnit: "lb", weightKg: 22.6796185,
    actualReps: 8, timestamp: Date.parse("2020-01-06T15:00:00.000Z"),
    localDateTime: "2020-01-06T10:00:00.000",
  };
  const original = structuredClone(record);
  expect(setsToCsv([record]).split("\n")[1]).toBe(
    '"2020-01-06T10:00:00.000","2020-01-06T15:00:00.000Z","monday","old-session","incline_chest_press","Chest Press","2","50","lb","8"',
  );
  expect(record).toEqual(original);
});
