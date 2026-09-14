import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createBackup, restoreBackup, validateBackup } from "../lib/backup";
import { ensureDefaults, WorkoutDatabase } from "../lib/db";
import { localDateKey, toLocalIso } from "../lib/local-date";
import type { WorkoutSession } from "../lib/models";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe("backup export and import", () => {
  it("round-trips the entire database", async () => {
    const sourceName = `backup-source-${Date.now()}-${Math.random()}`;
    const targetName = `backup-target-${Date.now()}-${Math.random()}`;
    names.push(sourceName, targetName);
    const source = new WorkoutDatabase(sourceName);
    const target = new WorkoutDatabase(targetName);
    await ensureDefaults(source);
    const session: WorkoutSession = {
      id: "session-1",
      workoutType: "wednesday",
      status: "completed",
      startTimestamp: 10,
      localDate: localDateKey(10),
      startLocalDateTime: toLocalIso(10),
      finishTimestamp: 20,
      finishLocalDateTime: toLocalIso(20),
      exerciseOrder: ["lat_pulldown"],
    };
    await source.sessions.add(session);
    await source.sets.add({
      id: "weekday-set",
      sessionId: session.id,
      workoutType: "wednesday",
      exerciseId: "lat_pulldown",
      exerciseName: "Lat Pulldown",
      setNumber: 1,
      actualWeight: 90,
      weightUnit: "lb",
      weightKg: 40.823313,
      actualReps: 10,
      timestamp: 15,
      localDateTime: toLocalIso(15),
    });
    const backup = await createBackup(source);
    await ensureDefaults(target);
    await restoreBackup(target, backup);
    expect(await target.sessions.get("session-1")).toEqual(session);
    expect(await target.sets.get("weekday-set")).toMatchObject({
      workoutType: "wednesday",
      exerciseId: "lat_pulldown",
      actualWeight: 90,
      actualReps: 10,
    });
    expect(await target.exercises.count()).toBe(12);
    source.close();
    target.close();
  });

  it("rejects invalid data before modifying the database", async () => {
    const name = `backup-invalid-${Date.now()}-${Math.random()}`;
    names.push(name);
    const database = new WorkoutDatabase(name);
    await ensureDefaults(database);
    await database.sessions.add({
      id: "keep-me",
      workoutType: "pull",
      status: "active",
      startTimestamp: 1,
      exerciseOrder: [],
    });
    expect(() => validateBackup({ format: "workout-backup" })).toThrow();
    await expect(
      restoreBackup(database, { format: "workout-backup" }),
    ).rejects.toThrow();
    expect(await database.sessions.get("keep-me")).toBeTruthy();
    database.close();
  });
});
