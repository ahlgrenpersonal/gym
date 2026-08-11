import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDefaults, WorkoutDatabase } from "../lib/db";
import { localDateKey, toLocalIso } from "../lib/local-date";
import type { SetRecord, WorkoutSession, WorkoutType } from "../lib/models";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe("mixed workout persistence", () => {
  it("preserves a completed set row from each partial same-day worksheet", async () => {
    const name = `mixed-persistence-${Date.now()}-${Math.random()}`;
    names.push(name);
    const database = new WorkoutDatabase(name);
    await ensureDefaults(database);
    const timestamp = new Date(2026, 7, 11, 18, 0).getTime();

    const makeSession = (workoutType: WorkoutType): WorkoutSession => ({
      id: `${workoutType}-session`,
      workoutType,
      status: "active",
      startTimestamp: timestamp,
      localDate: localDateKey(timestamp),
      startLocalDateTime: toLocalIso(timestamp),
      exerciseOrder: [],
    });
    const makeSet = (workoutType: WorkoutType): SetRecord => ({
      id: `${workoutType}-set`,
      sessionId: `${workoutType}-session`,
      workoutType,
      exerciseId: `${workoutType}-exercise`,
      exerciseName: `${workoutType} exercise`,
      setNumber: 1,
      actualWeight: 100,
      weightUnit: "lb",
      weightKg: 45.359237,
      actualReps: 10,
      timestamp,
      localDateTime: toLocalIso(timestamp),
    });

    await database.transaction("rw", database.sessions, database.sets, async () => {
      await database.sessions.bulkAdd([
        makeSession("push"),
        makeSession("pull"),
        makeSession("legs_abs"),
      ]);
      await database.sets.bulkAdd([
        makeSet("push"),
        makeSet("pull"),
        makeSet("legs_abs"),
      ]);
    });
    database.close();

    const reopened = new WorkoutDatabase(name);
    await reopened.open();
    const records = await reopened.sets.orderBy("timestamp").toArray();
    expect(records).toHaveLength(3);
    expect(new Set(records.map((record) => record.workoutType))).toEqual(
      new Set(["push", "pull", "legs_abs"]),
    );
    reopened.close();
  });
});
