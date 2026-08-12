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
  it("retires superseded exercises without deleting their logged sets", async () => {
    const name = `routine-migration-${Date.now()}-${Math.random()}`;
    names.push(name);
    const previous = new Dexie(name);
    previous.version(3).stores({
      exercises: "&id, workoutType, order",
      sessions:
        "&id, status, workoutType, startTimestamp, localDate, [localDate+status], [workoutType+status]",
      exerciseStates:
        "&id, sessionId, exerciseId, [sessionId+exerciseId], status, order",
      sets:
        "&id, sessionId, exerciseId, setNumber, timestamp, [exerciseId+setNumber]",
      settings: "&id",
    });
    await previous.open();
    await previous.table("exercises").add({
      id: "cable_crunch",
      workoutType: "legs_abs",
      order: 2,
      name: "Kneeling Cable Crunch",
      minReps: 10,
      maxReps: 15,
      targetSets: 2,
      restSeconds: 90,
      incrementLb: 5,
      imageKey: "cable_crunch",
    });
    await previous.table("sets").add({
      id: "historic-ab-set",
      sessionId: "historic-session",
      workoutType: "legs_abs",
      exerciseId: "cable_crunch",
      exerciseName: "Kneeling Cable Crunch",
      setNumber: 1,
      actualWeight: 70,
      weightUnit: "lb",
      weightKg: 31.751466,
      actualReps: 12,
      timestamp: 2,
      localDateTime: toLocalIso(2),
    });
    previous.close();

    const upgraded = new WorkoutDatabase(name);
    await upgraded.open();

    expect(await upgraded.exercises.get("cable_crunch")).toBeUndefined();
    expect(await upgraded.exercises.get("abdominal_crunch_machine")).toBeDefined();
    expect(await upgraded.exercises.get("reverse_crunch")).toBeDefined();
    expect(await upgraded.sets.get("historic-ab-set")).toMatchObject({
      exerciseId: "cable_crunch",
      actualReps: 12,
    });
    upgraded.close();
  });
});
