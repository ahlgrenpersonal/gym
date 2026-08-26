import { describe, expect, it } from "vitest";
import type { SetRecord, WorkoutSession } from "../lib/models";
import { repShortcutsFromHistory } from "../lib/rep-shortcuts";

const session = (id: string, startTimestamp: number): WorkoutSession => ({
  id,
  workoutType: "pull",
  status: id === "current" ? "active" : "completed",
  startTimestamp,
  exerciseOrder: ["lat_pulldown"],
});

const set = (
  sessionId: string,
  setNumber: number,
  actualReps: number,
  timestamp: number,
): SetRecord => ({
  id: `${sessionId}-${setNumber}`,
  sessionId,
  workoutType: "pull",
  exerciseId: "lat_pulldown",
  exerciseName: "Lat Pulldown",
  setNumber,
  actualWeight: 80,
  weightUnit: "lb",
  weightKg: 36.2874,
  actualReps,
  timestamp,
});

describe("rep shortcuts", () => {
  it("centers the buttons on set 2 from the most recent previous workout", () => {
    expect(
      repShortcutsFromHistory({
        sessions: [
          session("older", 100),
          session("previous", 200),
          session("current", 300),
        ],
        sets: [
          set("older", 2, 20, 120),
          set("previous", 1, 15, 210),
          set("previous", 2, 12, 220),
          set("previous", 3, 7, 230),
          set("current", 1, 30, 310),
        ],
        currentSessionId: "current",
        exerciseId: "lat_pulldown",
        fallback: [8, 10, 12],
      }),
    ).toEqual([11, 12, 13]);
  });

  it("uses set 1 when the previous workout has no second set", () => {
    expect(
      repShortcutsFromHistory({
        sessions: [session("previous", 100), session("current", 200)],
        sets: [set("previous", 1, 8, 110)],
        currentSessionId: "current",
        exerciseId: "lat_pulldown",
        fallback: [8, 10, 12],
      }),
    ).toEqual([7, 8, 9]);
  });

  it("uses the exercise range when there is no earlier history", () => {
    expect(
      repShortcutsFromHistory({
        sessions: [session("current", 200)],
        sets: [],
        currentSessionId: "current",
        exerciseId: "lat_pulldown",
        fallback: [8, 10, 12],
      }),
    ).toEqual([8, 10, 12]);
  });
});
