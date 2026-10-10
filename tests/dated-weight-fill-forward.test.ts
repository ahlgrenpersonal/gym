import { describe, expect, it } from "vitest";
import type { SetRecord, WorkoutSession } from "../lib/models";
import { toKg } from "../lib/recommendation";
import { fillForwardWeight } from "../lib/weight-fill-forward";
import type { WeightOverrides } from "../lib/weight-overrides";

function session(id: string, date: string): WorkoutSession {
  return {
    id,
    workoutType: "tuesday",
    status: id === "current" ? "active" : "completed",
    localDate: date,
    startTimestamp: Date.parse(`${date}T11:00:00Z`),
    exerciseOrder: ["lat_pulldown"],
  };
}

function set(workout: WorkoutSession, weight: number, setNumber = 2): SetRecord {
  return {
    id: `${workout.id}-${setNumber}`,
    sessionId: workout.id,
    workoutType: workout.workoutType,
    exerciseId: "lat_pulldown",
    exerciseName: "Lat Pulldown",
    setNumber,
    actualWeight: weight,
    weightUnit: "lb",
    weightKg: toKg(weight, "lb"),
    actualReps: 10,
    timestamp: workout.startTimestamp + setNumber * 60_000,
  };
}

const overrides: WeightOverrides = {
  "2026-10-10": { lat_pulldown: 110 },
  "2026-10-20": { lat_pulldown: 120 },
};
const previous = session("previous", "2026-10-08");
const current = session("current", "2026-10-13");
const input = {
  sessions: [previous, current],
  sets: [set(previous, 100)],
  currentSessionId: current.id,
  exerciseId: "lat_pulldown",
  displayUnit: "lb" as const,
  programWeightLb: 90,
  programWeightEffectiveLocalDate: "2026-09-03",
  weightOverrides: overrides,
};

describe("dated overrides and remembered actual weights", () => {
  it("overrides old history without selecting a future update", () => {
    expect(fillForwardWeight(input)).toEqual({
      weight: 110, source: "program_override", overrideDate: "2026-10-10",
    });
  });

  it("does not change a historical session before an override's effective date", () => {
    expect(fillForwardWeight({
      ...input, sessions: [previous, session("current", "2026-10-09")],
    })).toEqual({ weight: 100, source: "previous_workout" });
  });

  it("applies on the exact effective date using the stored local calendar date", () => {
    expect(fillForwardWeight({
      ...input,
      sessions: [previous, {
        ...current,
        localDate: "2026-10-10",
        startTimestamp: Date.parse("2026-10-09T15:00:00Z"),
      }],
    })).toEqual({ weight: 110, source: "program_override", overrideDate: "2026-10-10" });
  });

  it("supports legacy sessions that only have a local datetime", () => {
    expect(fillForwardWeight({
      ...input,
      sessions: [previous, { ...current, localDate: undefined, startLocalDateTime: "2026-10-13T07:00:00" }],
    })).toEqual({ weight: 110, source: "program_override", overrideDate: "2026-10-10" });
  });

  it("does not let an override reset a manual adjustment within the same session", () => {
    expect(fillForwardWeight({
      ...input, sets: [...input.sets, set(current, 105, 1), set(current, 100, 2)],
    })).toEqual({ weight: 100, source: "previous_set" });
  });

  it.each(["2026-10-10", "2026-10-12"])(
    "remembers actual set 2 when a prior workout on %s already follows the update",
    (date) => {
      const used = session("used", date);
      expect(fillForwardWeight({
        ...input,
        sessions: [previous, used, current],
        sets: [...input.sets, set(used, 110, 1), set(used, 105, 2), set(used, 100, 3)],
      })).toEqual({ weight: 105, source: "previous_workout" });
    },
  );

  it("applies a later override even after the previous update has been used", () => {
    const used = session("used", "2026-10-13");
    expect(fillForwardWeight({
      ...input,
      sessions: [previous, used, session("current", "2026-10-20")],
      sets: [...input.sets, set(used, 105)],
    })).toEqual({ weight: 120, source: "program_override", overrideDate: "2026-10-20" });
  });

  it("uses the latest override after a long gap rather than stepping through old updates", () => {
    expect(fillForwardWeight({
      ...input, sessions: [previous, session("current", "2026-12-01")],
    })).toEqual({ weight: 120, source: "program_override", overrideDate: "2026-10-20" });
  });

  it("does not consume an unused override when other exercises are logged", () => {
    const other = session("other", "2026-10-12");
    expect(fillForwardWeight({
      ...input,
      sessions: [previous, other, current],
      sets: [...input.sets, { ...set(other, 80), exerciseId: "incline_chest_press" }],
    })).toEqual({ weight: 110, source: "program_override", overrideDate: "2026-10-10" });
  });

  it("leaves other exercises on their existing carry-forward weights", () => {
    expect(fillForwardWeight({
      ...input,
      exerciseId: "incline_chest_press",
      sets: [{ ...set(previous, 80), exerciseId: "incline_chest_press" }],
    })).toEqual({ weight: 80, source: "previous_workout" });
  });

  it("does not pull later workout history into a historical session", () => {
    const future = session("future", "2026-10-22");
    expect(fillForwardWeight({
      ...input,
      sessions: [previous, current, future],
      sets: [...input.sets, set(future, 130)],
    })).toEqual({ weight: 110, source: "program_override", overrideDate: "2026-10-10" });
  });

  it("converts overrides into the selected display unit", () => {
    expect(fillForwardWeight({ ...input, displayUnit: "kg" })).toEqual({
      weight: 50, source: "program_override", overrideDate: "2026-10-10",
    });
  });
});
