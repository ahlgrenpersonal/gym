import { describe, expect, it } from "vitest";
import type { SetRecord, WorkoutSession } from "../lib/models";
import { toKg } from "../lib/recommendation";
import { fillForwardWeight } from "../lib/weight-fill-forward";

const session = (id: string, startTimestamp: number): WorkoutSession => ({
  id,
  workoutType: "push",
  status: id === "current" ? "active" : "completed",
  startTimestamp,
  exerciseOrder: ["incline_chest_press"],
});

const set = ({
  id,
  sessionId,
  setNumber,
  weight,
  reps = 10,
  timestamp,
}: {
  id: string;
  sessionId: string;
  setNumber: number;
  weight: number;
  reps?: number;
  timestamp: number;
}): SetRecord => ({
  id,
  sessionId,
  workoutType: "push",
  exerciseId: "incline_chest_press",
  exerciseName: "Incline Chest Press Machine",
  setNumber,
  actualWeight: weight,
  weightUnit: "lb",
  weightKg: toKg(weight, "lb"),
  actualReps: reps,
  timestamp,
});

describe("weight fill-forward", () => {
  it("uses set 2 from the most recent previous workout for today's first set", () => {
    const result = fillForwardWeight({
      sessions: [session("previous", 100), session("current", 200)],
      sets: [
        set({
          id: "previous-1",
          sessionId: "previous",
          setNumber: 1,
          weight: 50,
          timestamp: 110,
        }),
        set({
          id: "previous-2",
          sessionId: "previous",
          setNumber: 2,
          weight: 70,
          timestamp: 120,
        }),
        set({
          id: "previous-3",
          sessionId: "previous",
          setNumber: 3,
          weight: 60,
          timestamp: 130,
        }),
      ],
      currentSessionId: "current",
      exerciseId: "incline_chest_press",
      displayUnit: "lb",
    });

    expect(result).toEqual({ weight: 70, source: "previous_workout" });
  });

  it("uses set 1 when the most recent previous workout has only one set", () => {
    const result = fillForwardWeight({
      sessions: [
        session("older", 100),
        session("previous", 200),
        session("current", 300),
      ],
      sets: [
        set({
          id: "older-2",
          sessionId: "older",
          setNumber: 2,
          weight: 90,
          timestamp: 120,
        }),
        set({
          id: "previous-1",
          sessionId: "previous",
          setNumber: 1,
          weight: 65,
          timestamp: 220,
        }),
      ],
      currentSessionId: "current",
      exerciseId: "incline_chest_press",
      displayUnit: "lb",
    });

    expect(result).toEqual({ weight: 65, source: "previous_workout" });
  });

  it("fills the next set from the actual weight just used without adjustment", () => {
    const result = fillForwardWeight({
      sessions: [session("previous", 100), session("current", 200)],
      sets: [
        set({
          id: "previous-2",
          sessionId: "previous",
          setNumber: 2,
          weight: 70,
          timestamp: 120,
        }),
        set({
          id: "current-1",
          sessionId: "current",
          setNumber: 1,
          weight: 75,
          reps: 20,
          timestamp: 220,
        }),
      ],
      currentSessionId: "current",
      exerciseId: "incline_chest_press",
      displayUnit: "lb",
    });

    expect(result).toEqual({ weight: 75, source: "previous_set" });
  });

  it("uses the latest completed set after a manual override", () => {
    const result = fillForwardWeight({
      sessions: [session("current", 200)],
      sets: [
        set({
          id: "current-1",
          sessionId: "current",
          setNumber: 1,
          weight: 70,
          timestamp: 210,
        }),
        set({
          id: "current-2",
          sessionId: "current",
          setNumber: 2,
          weight: 80,
          timestamp: 220,
        }),
      ],
      currentSessionId: "current",
      exerciseId: "incline_chest_press",
      displayUnit: "lb",
    });

    expect(result).toEqual({ weight: 80, source: "previous_set" });
  });

  it("converts the copied weight into the selected display unit", () => {
    const result = fillForwardWeight({
      sessions: [session("previous", 100), session("current", 200)],
      sets: [
        set({
          id: "previous-2",
          sessionId: "previous",
          setNumber: 2,
          weight: 70,
          timestamp: 120,
        }),
      ],
      currentSessionId: "current",
      exerciseId: "incline_chest_press",
      displayUnit: "kg",
    });

    expect(result).toEqual({ weight: 32, source: "previous_workout" });
  });

  it("reports no suggestion when the exercise has no history", () => {
    expect(
      fillForwardWeight({
        sessions: [session("current", 200)],
        sets: [],
        currentSessionId: "current",
        exerciseId: "incline_chest_press",
        displayUnit: "lb",
      }),
    ).toEqual({ source: "none" });
  });

  it("carries the Push lateral-raise set-2 weight into Wednesday", () => {
    const previousPush: WorkoutSession = {
      id: "monday-push",
      workoutType: "push",
      status: "completed",
      startTimestamp: 100,
      exerciseOrder: ["lateral_raise"],
    };
    const currentWednesday: WorkoutSession = {
      id: "wednesday-legs",
      workoutType: "legs_abs",
      status: "active",
      startTimestamp: 200,
      exerciseOrder: ["lateral_raise"],
    };
    const lateralRaiseSets: SetRecord[] = [
      {
        id: "monday-lateral-1",
        sessionId: previousPush.id,
        workoutType: "push",
        exerciseId: "lateral_raise",
        exerciseName: "Machine or Cable Lateral Raise",
        setNumber: 1,
        actualWeight: 15,
        weightUnit: "lb",
        weightKg: toKg(15, "lb"),
        actualReps: 5,
        timestamp: 110,
      },
      {
        id: "monday-lateral-2",
        sessionId: previousPush.id,
        workoutType: "push",
        exerciseId: "lateral_raise",
        exerciseName: "Machine or Cable Lateral Raise",
        setNumber: 2,
        actualWeight: 10,
        weightUnit: "lb",
        weightKg: toKg(10, "lb"),
        actualReps: 7,
        timestamp: 120,
      },
    ];

    expect(
      fillForwardWeight({
        sessions: [previousPush, currentWednesday],
        sets: lateralRaiseSets,
        currentSessionId: currentWednesday.id,
        exerciseId: "lateral_raise",
        displayUnit: "lb",
      }),
    ).toEqual({ weight: 10, source: "previous_workout" });
  });
});
