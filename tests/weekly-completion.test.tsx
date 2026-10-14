import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeScreen } from "../app/WorkoutApp";
import type { WorkoutSession, WorkoutType } from "../lib/models";
import { activeSessionsForLocalDay, completedWorkoutTypesForLocalWeek } from "../lib/today-sessions";

const now = new Date(2026, 9, 14, 12).getTime();
const monday = new Date(2026, 9, 12).getTime();
const noop = () => undefined;

function completed(id: string, workoutType: WorkoutType, timestamp: number): WorkoutSession {
  return { id, workoutType, status: "completed", startTimestamp: timestamp - 60_000,
    finishTimestamp: timestamp, exerciseOrder: [] };
}

function menu(sessions: WorkoutSession[], timestamp = now) {
  return renderToStaticMarkup(<HomeScreen onStart={noop} sets={[]}
    activeSessions={activeSessionsForLocalDay(sessions, timestamp)}
    completedWorkoutTypes={completedWorkoutTypesForLocalWeek(sessions, timestamp)} />);
}

function dayButton(markup: string, day: string): string {
  const button = markup.match(new RegExp(`<button class="workout-choice ${day}-choice[^]*?</button>`));
  expect(button).not.toBeNull();
  return button![0];
}

describe("current-week completion labels", () => {
  it("marks Monday, Tuesday and Wednesday, even when performed out of order", () => {
    const sessions = [
      completed("mon", "monday", new Date(2026, 9, 12, 9).getTime()),
      completed("wed", "wednesday", new Date(2026, 9, 13, 9).getTime()),
      completed("tue", "tuesday", new Date(2026, 9, 14, 9).getTime()),
    ];
    expect(completedWorkoutTypesForLocalWeek(sessions, now))
      .toEqual(new Set(["monday", "tuesday", "wednesday"]));
    const markup = menu(sessions);
    for (const day of ["monday", "tuesday", "wednesday"]) {
      expect(dayButton(markup, day)).toContain("COMPLETED THIS WEEK");
    }
    for (const day of ["thursday", "friday"]) {
      expect(dayButton(markup, day)).not.toContain("COMPLETED");
    }
    expect(markup).not.toContain("IN PROGRESS");
    expect(markup.match(/class="workout-choice/g)).toHaveLength(5);
    expect(markup).not.toContain("disabled");
  });

  it("ignores incomplete, archived, previous-week and future sessions", () => {
    const sessions: WorkoutSession[] = [
      { ...completed("empty", "monday", now), status: "active" },
      { ...completed("partial", "tuesday", now), status: "archived" },
      completed("last-week", "wednesday", monday - 1),
      completed("future", "thursday", now + 1),
      completed("next-week", "friday", new Date(2026, 9, 19, 8).getTime()),
    ];
    expect(completedWorkoutTypesForLocalWeek(sessions, now).size).toBe(0);
    expect(menu(sessions)).not.toContain("COMPLETED");
  });

  it("keeps completion through Sunday and resets at local Monday midnight", () => {
    const sessions = [completed("mon", "monday", monday)];
    for (let day = 0; day < 7; day++) {
      const time = new Date(2026, 9, 12 + day, 23, 59, 59, 999).getTime();
      expect(completedWorkoutTypesForLocalWeek(sessions, time).has("monday")).toBe(true);
    }
    const nextMonday = new Date(2026, 9, 19).getTime();
    expect(completedWorkoutTypesForLocalWeek(sessions, nextMonday).size).toBe(0);
    expect(menu(sessions, nextMonday)).not.toContain("COMPLETED");
    // Resetting a display must not change the saved completion.
    expect(sessions[0].status).toBe("completed");
  });

  it.each([
    [2026, 0, 1, 2025, 11, 29], // Year boundary.
    [2026, 2, 8, 2026, 2, 2],   // US spring daylight-saving Sunday.
    [2026, 10, 1, 2026, 9, 26], // US autumn daylight-saving Sunday / month boundary.
  ])("uses calendar boundaries for %i-%i-%i", (year, month, day, startYear, startMonth, startDay) => {
    const timestamp = new Date(year, month, day, 23, 59).getTime();
    const start = new Date(startYear, startMonth, startDay).getTime();
    const sessions = [completed("before", "tuesday", start - 1), completed("at", "monday", start)];
    expect(completedWorkoutTypesForLocalWeek(sessions, timestamp)).toEqual(new Set(["monday"]));
  });

  it("supports legacy completed sessions without a finish timestamp", () => {
    const old: WorkoutSession = { id: "old", workoutType: "friday", status: "completed",
      startTimestamp: now - 60_000, exerciseOrder: [] };
    expect(completedWorkoutTypesForLocalWeek([old], now)).toEqual(new Set(["friday"]));
  });

  it("uses completion time for a session crossing the weekly boundary", () => {
    const overnight = { ...completed("overnight", "friday", monday), startTimestamp: monday - 60_000 };
    expect(completedWorkoutTypesForLocalWeek([overnight], now)).toEqual(new Set(["friday"]));
  });

  it("shows one label per day even if the workout was completed twice", () => {
    const sessions = [completed("first", "monday", now - 1_000), completed("repeat", "monday", now)];
    expect(menu(sessions).match(/COMPLETED THIS WEEK/g)).toHaveLength(1);
    expect(sessions.map((s) => s.id)).toEqual(["first", "repeat"]);
  });

  it("does not clear a completion when that day has an empty preview", () => {
    const sessions: WorkoutSession[] = [completed("done", "wednesday", now - 1_000),
      { ...completed("preview", "wednesday", now), status: "active", finishTimestamp: undefined }];
    expect(dayButton(menu(sessions), "wednesday")).toContain("COMPLETED THIS WEEK");
    expect(menu(sessions)).not.toContain("IN PROGRESS");
  });
});
