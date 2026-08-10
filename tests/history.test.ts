import { describe, expect, it } from "vitest";
import { exerciseHistoryRows } from "../lib/history";
import type { SetRecord, WorkoutSession } from "../lib/models";

describe("exercise history", () => {
  it("shows logged sets from an active workout immediately", () => {
    const session: WorkoutSession = {
      id: "active-session",
      workoutType: "pull",
      status: "active",
      startTimestamp: 100,
      exerciseOrder: ["lat_pulldown"],
    };
    const record: SetRecord = {
      id: "set-1",
      sessionId: session.id,
      workoutType: "pull",
      exerciseId: "lat_pulldown",
      exerciseName: "Lat Pulldown",
      setNumber: 1,
      actualWeight: 100,
      weightUnit: "lb",
      weightKg: 45.359237,
      actualReps: 10,
      timestamp: 101,
    };

    const rows = exerciseHistoryRows([session], [record], "lat_pulldown");
    expect(rows).toHaveLength(1);
    expect(rows[0].session.status).toBe("active");
    expect(rows[0].records).toEqual([record]);
  });
});
