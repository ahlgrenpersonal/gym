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
      workoutType: "push",
      status: "completed",
      startTimestamp: 10,
      localDate: localDateKey(10),
      startLocalDateTime: toLocalIso(10),
      finishTimestamp: 20,
      finishLocalDateTime: toLocalIso(20),
      exerciseOrder: ["incline_chest_press"],
    };
    await source.sessions.add(session);
    const backup = await createBackup(source);
    await ensureDefaults(target);
    await restoreBackup(target, backup);
    expect(await target.sessions.get("session-1")).toEqual(session);
    expect(await target.exercises.count()).toBe(14);
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
