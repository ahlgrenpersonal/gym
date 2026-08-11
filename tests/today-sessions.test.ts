import { describe, expect, it } from "vitest";
import { localDateKey, toLocalIso } from "../lib/local-date";
import type { WorkoutSession, WorkoutType } from "../lib/models";
import {
  activeSessionForWorkout,
  activeSessionsForLocalDay,
} from "../lib/today-sessions";

function session(
  id: string,
  workoutType: WorkoutType,
  timestamp: number,
  status: WorkoutSession["status"] = "active",
): WorkoutSession {
  return {
    id,
    workoutType,
    status,
    startTimestamp: timestamp,
    localDate: localDateKey(timestamp),
    startLocalDateTime: toLocalIso(timestamp),
    exerciseOrder: [],
  };
}

describe("same-day workout selection", () => {
  it("keeps independent Push, Pull, and Legs + Abs worksheets active on the same day", () => {
    const now = new Date(2026, 7, 11, 18, 0).getTime();
    const push = session("push-today", "push", now - 60_000);
    const pull = session("pull-today", "pull", now - 30_000);
    const legsAbs = session("legs-abs-today", "legs_abs", now - 15_000);
    const active = activeSessionsForLocalDay([push, pull, legsAbs], now);

    expect(active.map((item) => item.id)).toEqual([legsAbs.id, pull.id, push.id]);
    expect(activeSessionForWorkout(active, "push", now)?.id).toBe(push.id);
    expect(activeSessionForWorkout(active, "pull", now)?.id).toBe(pull.id);
    expect(activeSessionForWorkout(active, "legs_abs", now)?.id).toBe(legsAbs.id);
  });

  it("excludes completed and previous-day worksheets", () => {
    const now = new Date(2026, 7, 11, 18, 0).getTime();
    const yesterday = new Date(2026, 7, 10, 18, 0).getTime();
    const sessions = [
      session("push-complete", "push", now - 60_000, "completed"),
      session("pull-yesterday", "pull", yesterday),
    ];

    expect(activeSessionsForLocalDay(sessions, now)).toEqual([]);
  });
});
