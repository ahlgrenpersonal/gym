import { describe, expect, it } from "vitest";
import {
  fourFullWeeksAndCurrentWeekStart,
  setsFromFourFullWeeksAndCurrentWeek,
} from "../lib/history-export";
import type { SetRecord } from "../lib/models";

function record(id: string, timestamp: number): SetRecord {
  return {
    id,
    sessionId: `session-${id}`,
    workoutType: "monday",
    exerciseId: "incline_chest_press",
    exerciseName: "Incline Chest Press Machine",
    setNumber: 1,
    actualWeight: 80,
    weightUnit: "lb",
    weightKg: 36.2874,
    actualReps: 10,
    timestamp,
  };
}

describe("four full weeks plus current week export", () => {
  it("starts at local Monday midnight four weeks before the current week", () => {
    const tuesday = new Date(2026, 8, 29, 10, 30).getTime();

    expect(fourFullWeeksAndCurrentWeekStart(tuesday)).toBe(
      new Date(2026, 7, 31).getTime(),
    );
  });

  it("includes the boundary and current week through now only", () => {
    const now = new Date(2026, 8, 29, 10, 30).getTime();
    const start = new Date(2026, 7, 31).getTime();
    const records = [
      record("too-old", start - 1),
      record("first", start),
      record("prior-week", new Date(2026, 8, 25, 8).getTime()),
      record("monday", new Date(2026, 8, 28, 8).getTime()),
      record("now", now),
      record("future", now + 1),
    ];

    expect(
      setsFromFourFullWeeksAndCurrentWeek(records, now).map(({ id }) => id),
    ).toEqual(["first", "prior-week", "monday", "now"]);
  });

  it("always includes all four complete preceding weeks", () => {
    const currentMonday = new Date(2026, 8, 28);

    for (let currentWeekday = 0; currentWeekday < 7; currentWeekday += 1) {
      const now = new Date(2026, 8, 28 + currentWeekday, 23, 59).getTime();
      const records: SetRecord[] = [];

      for (let priorWeek = 4; priorWeek >= 1; priorWeek -= 1) {
        const monday = new Date(
          currentMonday.getFullYear(),
          currentMonday.getMonth(),
          currentMonday.getDate() - priorWeek * 7,
        );
        const sunday = new Date(
          monday.getFullYear(),
          monday.getMonth(),
          monday.getDate() + 6,
          23,
          59,
          59,
          999,
        );
        records.push(
          record(`week-${priorWeek}-monday`, monday.getTime()),
          record(`week-${priorWeek}-sunday`, sunday.getTime()),
        );
      }

      expect(setsFromFourFullWeeksAndCurrentWeek(records, now)).toHaveLength(8);
    }
  });

  it("handles a Sunday without dropping the current week", () => {
    const sunday = new Date(2027, 0, 3, 23, 59).getTime();

    expect(fourFullWeeksAndCurrentWeekStart(sunday)).toBe(
      new Date(2026, 10, 30).getTime(),
    );
  });
});
