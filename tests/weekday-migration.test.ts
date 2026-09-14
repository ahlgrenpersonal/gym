import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { WorkoutDatabase } from "../lib/db";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe("weekday routine migration", () => {
  it("preserves existing history and active queues while updating future chest sets", async () => {
    const name = `weekday-migration-${Date.now()}-${Math.random()}`;
    names.push(name);
    const previous = new Dexie(name);
    previous.version(11).stores({
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
      id: "incline_chest_press",
      workoutType: "push",
      order: 0,
      name: "Incline Chest Press Machine",
      minReps: 8,
      maxReps: 12,
      targetSets: 3,
      restSeconds: 180,
      incrementLb: 5,
      imageKey: "incline_chest_press",
    });
    await previous.table("sessions").add({
      id: "existing-session",
      workoutType: "push",
      status: "active",
      startTimestamp: 1,
      localDate: "1970-01-01",
      startLocalDateTime: "1970-01-01T00:00:00.001",
      exerciseOrder: ["incline_chest_press"],
    });
    await previous.table("exerciseStates").add({
      id: "existing-session:incline_chest_press",
      sessionId: "existing-session",
      exerciseId: "incline_chest_press",
      order: 0,
      status: "current",
      exerciseName: "Incline Chest Press Machine",
      minReps: 8,
      maxReps: 12,
      targetSets: 3,
      restSeconds: 180,
      incrementLb: 5,
      imageKey: "incline_chest_press",
    });
    await previous.table("sets").add({
      id: "existing-set",
      sessionId: "existing-session",
      workoutType: "push",
      exerciseId: "incline_chest_press",
      exerciseName: "Incline Chest Press Machine",
      setNumber: 1,
      actualWeight: 70,
      weightUnit: "lb",
      weightKg: 31.751466,
      actualReps: 12,
      timestamp: 2,
      localDateTime: "1970-01-01T00:00:00.002",
    });
    previous.close();

    const upgraded = new WorkoutDatabase(name);
    await upgraded.open();

    expect(await upgraded.sessions.count()).toBe(1);
    expect(await upgraded.exerciseStates.count()).toBe(1);
    expect(await upgraded.sets.count()).toBe(1);
    expect(await upgraded.sets.get("existing-set")).toMatchObject({
      actualWeight: 70,
      actualReps: 12,
      workoutType: "push",
    });
    expect(
      await upgraded.exerciseStates.get(
        "existing-session:incline_chest_press",
      ),
    ).toMatchObject({ targetSets: 3, status: "current" });
    expect(await upgraded.exercises.get("incline_chest_press")).toMatchObject({
      targetSets: 4,
    });
    upgraded.close();
  });
});
