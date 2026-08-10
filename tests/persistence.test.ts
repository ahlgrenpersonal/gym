import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDefaults, WorkoutDatabase } from "../lib/db";
import type { SetRecord, WorkoutSession } from "../lib/models";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe("active workout persistence", () => {
  it("keeps an individually completed set after the database is closed and reopened", async () => {
    const name = `active-persistence-${Date.now()}-${Math.random()}`;
    names.push(name);
    const firstConnection = new WorkoutDatabase(name);
    await ensureDefaults(firstConnection);

    const session: WorkoutSession = {
      id: "active-session",
      workoutType: "push",
      status: "active",
      startTimestamp: 10,
      exerciseOrder: ["incline_chest_press"],
    };
    const record: SetRecord = {
      id: "persisted-set",
      sessionId: session.id,
      workoutType: "push",
      exerciseId: "incline_chest_press",
      exerciseName: "Incline Chest Press Machine",
      setNumber: 1,
      actualWeight: 100,
      weightUnit: "lb",
      weightKg: 45.359237,
      actualReps: 10,
      timestamp: 11,
    };

    await firstConnection.transaction(
      "rw",
      firstConnection.sessions,
      firstConnection.sets,
      async () => {
        await firstConnection.sessions.add(session);
        await firstConnection.sets.add(record);
      },
    );
    firstConnection.close();

    const reopened = new WorkoutDatabase(name);
    await reopened.open();
    expect(await reopened.sessions.get(session.id)).toEqual(session);
    expect(await reopened.sets.get(record.id)).toEqual(record);
    reopened.close();
  });
});
