import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { archiveStaleSessions } from "../lib/day-rollover";
import { ensureDefaults, WorkoutDatabase } from "../lib/db";
import { localDateKey, toLocalIso } from "../lib/local-date";
import type { SetRecord, WorkoutSession } from "../lib/models";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe("daily workout rollover", () => {
  it("archives yesterday's unfinished worksheet without deleting its sets", async () => {
    const name = `rollover-${Date.now()}-${Math.random()}`;
    names.push(name);
    const database = new WorkoutDatabase(name);
    await ensureDefaults(database);
    const startTimestamp = new Date(2026, 7, 7, 18, 0).getTime();
    const setTimestamp = new Date(2026, 7, 7, 18, 12).getTime();
    const today = new Date(2026, 7, 8, 9, 0).getTime();
    const session: WorkoutSession = {
      id: "yesterday",
      workoutType: "push",
      status: "active",
      startTimestamp,
      localDate: localDateKey(startTimestamp),
      startLocalDateTime: toLocalIso(startTimestamp),
      exerciseOrder: ["incline_chest_press"],
      activeRestEndTimestamp: setTimestamp + 90_000,
      activeRestExerciseId: "incline_chest_press",
    };
    const record: SetRecord = {
      id: "yesterday-set",
      sessionId: session.id,
      workoutType: "push",
      exerciseId: "incline_chest_press",
      exerciseName: "Incline Chest Press Machine",
      setNumber: 1,
      actualWeight: 100,
      weightUnit: "lb",
      weightKg: 45.359237,
      actualReps: 10,
      timestamp: setTimestamp,
      localDateTime: toLocalIso(setTimestamp),
    };
    await database.sessions.add(session);
    await database.sets.add(record);

    expect(await archiveStaleSessions(database, today)).toBe(1);
    expect(await database.sessions.get(session.id)).toMatchObject({
      status: "archived",
      finishTimestamp: setTimestamp,
      finishLocalDateTime: toLocalIso(setTimestamp),
      activeRestEndTimestamp: null,
      activeRestExerciseId: null,
    });
    expect(await database.sets.get(record.id)).toEqual(record);
    database.close();
  });

  it("leaves today's active worksheet available to resume", async () => {
    const name = `same-day-${Date.now()}-${Math.random()}`;
    names.push(name);
    const database = new WorkoutDatabase(name);
    await ensureDefaults(database);
    const now = new Date(2026, 7, 8, 18, 0).getTime();
    await database.sessions.add({
      id: "today",
      workoutType: "pull",
      status: "active",
      startTimestamp: now - 60_000,
      localDate: localDateKey(now),
      startLocalDateTime: toLocalIso(now - 60_000),
      exerciseOrder: [],
    });

    expect(await archiveStaleSessions(database, now)).toBe(0);
    expect((await database.sessions.get("today"))?.status).toBe("active");
    database.close();
  });
});
