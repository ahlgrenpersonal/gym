import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { WorkoutDatabase } from "../lib/db";
import { localDateKey, toLocalIso } from "../lib/local-date";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe("database migrations", () => {
  it("upgrades legacy set records in place without deleting workout history", async () => {
    const name = `migration-${Date.now()}-${Math.random()}`;
    names.push(name);
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      exercises: "&id, workoutType, order",
      sessions: "&id, status, workoutType, startTimestamp",
      exerciseStates: "&id, sessionId, exerciseId, [sessionId+exerciseId], status, order",
      sets: "&id, sessionId, exerciseId, setNumber, timestamp",
      settings: "&id",
    });
    await legacy.open();
    await legacy.table("sessions").add({
      id: "old-session",
      workoutType: "pull",
      status: "completed",
      startTimestamp: 1,
      exerciseOrder: ["lat_pulldown"],
    });
    await legacy.table("sets").add({
      id: "old-set",
      sessionId: "old-session",
      workoutType: "pull",
      exerciseId: "lat_pulldown",
      exerciseName: "Lat Pulldown",
      setNumber: 1,
      actualWeight: 100,
      weightUnit: "lb",
      actualReps: 10,
      timestamp: 2,
    });
    legacy.close();

    const upgraded = new WorkoutDatabase(name);
    await upgraded.open();
    const record = await upgraded.sets.get("old-set");
    expect(await upgraded.sessions.count()).toBe(1);
    expect(await upgraded.sets.count()).toBe(1);
    expect(record?.weightKg).toBeCloseTo(45.359237, 5);
    expect(record?.localDateTime).toBe(toLocalIso(2));
    expect(await upgraded.sessions.get("old-session")).toMatchObject({
      localDate: localDateKey(1),
      startLocalDateTime: toLocalIso(1),
    });
    upgraded.close();
  });
});
