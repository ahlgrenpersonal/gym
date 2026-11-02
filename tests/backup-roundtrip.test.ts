import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createBackup, restoreBackup } from "../lib/backup";
import { DATABASE_VERSION, ensureDefaults, WorkoutDatabase } from "../lib/db";
import { archiveStaleSessions } from "../lib/day-rollover";
import { localDateKey, toLocalIso } from "../lib/local-date";
import type { SetRecord, WorkoutBackup, WorkoutSession } from "../lib/models";
import { createWorkoutQueue } from "../lib/queue";
import { workoutExercises } from "../lib/exercises";
import { toKg } from "../lib/recommendation";
import { fillForwardWeight } from "../lib/weight-fill-forward";

const databases: WorkoutDatabase[] = [];
const now = new Date(2026, 10, 2, 10).getTime();
const tables = ["exercises", "sessions", "exerciseStates", "sets", "settings"] as const;

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});

async function database() {
  const result = new WorkoutDatabase(`backup-audit-${crypto.randomUUID()}`);
  databases.push(result);
  await ensureDefaults(result);
  return result;
}

async function populate(db: WorkoutDatabase) {
  await db.settings.put({ id: "settings", weightUnit: "kg" });
  await db.exercises.update("shoulder_press", {
    name: 'Custom shoulder press, "seat 3"', restSeconds: 195,
    targetSets: 4, minReps: 9, maxReps: 16, incrementLb: 2.5,
  });
  const sessions: WorkoutSession[] = [
    { id: "completed", workoutType: "pull", status: "completed",
      startTimestamp: now - 8 * 86_400_000, finishTimestamp: now - 8 * 86_400_000 + 3_600_000,
      exerciseOrder: ["seated_leg_curl", "lat_pulldown"] },
    { id: "archived", workoutType: "friday", status: "archived",
      startTimestamp: now - 3 * 86_400_000, finishTimestamp: now - 3 * 86_400_000 + 600_000,
      exerciseOrder: ["incline_chest_press"] },
    { id: "active", workoutType: "monday", status: "active", startTimestamp: now,
      exerciseOrder: workoutExercises(await db.exercises.toArray(), "monday").map((exercise) => exercise.id),
      activeRestExerciseId: "shoulder_press", activeRestEndTimestamp: now + 195_000 },
  ].map((session) => ({ ...session,
    localDate: localDateKey(session.startTimestamp),
    startLocalDateTime: toLocalIso(session.startTimestamp),
    ...(session.finishTimestamp === undefined ? {} : { finishLocalDateTime: toLocalIso(session.finishTimestamp) }),
  }));
  await db.sessions.bulkAdd(sessions);
  const queue = createWorkoutQueue(workoutExercises(await db.exercises.toArray(), "monday"), "active");
  await db.exerciseStates.bulkAdd(queue.map((state, index) => ({ ...state,
    status: index === 0 ? "complete" : index === 1 ? "current" : index === 2 ? "deferred" : "todo",
    ...(index === 1 ? { queuedStatus: "deferred" as const } : {}),
  })));
  const records: SetRecord[] = sessions.map((session, index) => ({
    id: `set-${index}`, sessionId: session.id, workoutType: session.workoutType,
    exerciseId: index === 0 ? "seated_leg_curl" : "incline_chest_press",
    exerciseName: index === 0 ? "Seated Leg Curl Machine" : 'Incline, "original name"',
    setNumber: 1, actualWeight: index === 0 ? 80 : 40.5,
    weightUnit: index === 0 ? "lb" : "kg", weightKg: index === 0 ? toKg(80, "lb") : 40.5,
    actualReps: index === 0 ? 20 : 13, timestamp: session.startTimestamp + 1000,
    localDateTime: toLocalIso(session.startTimestamp + 1000),
  }));
  await db.sets.bulkAdd(records);
}

function contents(backup: WorkoutBackup) {
  return Object.fromEntries(tables.map((table) => [table, backup[table]]));
}

describe("backup migration between installations", () => {
  it("preserves every field through JSON export, replacement import, reopen, and normal app initialization", async () => {
    const source = await database();
    await populate(source);
    const exported = await createBackup(source);
    // Actual files are serialized JSON, not objects passed directly in memory.
    const file = JSON.parse(JSON.stringify(exported)) as WorkoutBackup;
    expect(file.schemaVersion).toBe(DATABASE_VERSION);
    const target = await database();
    await target.sessions.add({ id: "replace-me", workoutType: "push", status: "completed",
      startTimestamp: 1, exerciseOrder: [] });
    await restoreBackup(target, file);
    target.close();
    await target.open();
    await ensureDefaults(target);
    await archiveStaleSessions(target, now + 2000);
    expect(contents(await createBackup(target))).toEqual(contents(exported));
    expect(await target.sessions.get("replace-me")).toBeUndefined();
    // A second import replaces rather than duplicates records.
    await restoreBackup(target, file);
    expect(contents(await createBackup(target))).toEqual(contents(exported));
    expect(contents(await createBackup(source))).toEqual(contents(exported));

    const next: WorkoutSession = { id: "next", workoutType: "tuesday", status: "active",
      localDate: "2026-11-03", startTimestamp: now + 86_400_000,
      exerciseOrder: ["seated_leg_curl"] };
    expect(fillForwardWeight({ sessions: [...file.sessions, next], sets: file.sets,
      currentSessionId: next.id, exerciseId: "seated_leg_curl", displayUnit: "lb",
    })).toEqual({ weight: 80, source: "previous_workout" });
  });

  it("rolls back all five tables if a validated import fails after replacement begins", async () => {
    const target = await database();
    await populate(target);
    const before = await createBackup(target);
    const malformed = JSON.parse(JSON.stringify(before)) as WorkoutBackup;
    malformed.sets.push({ ...malformed.sets[0] }); // Duplicate primary key: IndexedDB write fails.
    await expect(restoreBackup(target, malformed)).rejects.toThrow();
    expect(contents(await createBackup(target))).toEqual(contents(before));
    target.close();
    await target.open();
    expect(contents(await createBackup(target))).toEqual(contents(before));
  });

  it.each(["newer-schema", "missing-table", "invalid-set", "orphan-set", "invalid-settings"])(
    "rejects %s without changing any table", async (kind) => {
      const target = await database();
      await populate(target);
      const before = await createBackup(target);
      const invalid = JSON.parse(JSON.stringify(before));
      if (kind === "newer-schema") invalid.schemaVersion = DATABASE_VERSION + 1;
      if (kind === "missing-table") delete invalid.exerciseStates;
      if (kind === "invalid-set") invalid.sets[0].actualReps = "bad";
      if (kind === "orphan-set") invalid.sets[0].sessionId = "missing-session";
      if (kind === "invalid-settings") invalid.settings[0].weightUnit = "stones";
      await expect(restoreBackup(target, invalid)).rejects.toThrow();
      expect(contents(await createBackup(target))).toEqual(contents(before));
    },
  );

  it("imports older records with missing local date fields while preserving weights and UTC timestamps", async () => {
    const source = await database();
    await populate(source);
    const legacy = JSON.parse(JSON.stringify(await createBackup(source))) as WorkoutBackup;
    for (const session of legacy.sessions) {
      delete session.localDate;
      delete session.startLocalDateTime;
      delete session.finishLocalDateTime;
    }
    for (const record of legacy.sets) delete record.localDateTime;
    const target = await database();
    await restoreBackup(target, legacy);
    const restored = await createBackup(target);
    expect(restored.sets).toEqual(legacy.sets.map((record) => ({
      ...record, localDateTime: toLocalIso(record.timestamp),
    })));
    for (const session of restored.sessions) {
      expect(session.localDate).toBe(localDateKey(session.startTimestamp));
      expect(session.startLocalDateTime).toBe(toLocalIso(session.startTimestamp));
      if (session.finishTimestamp !== undefined) {
        expect(session.finishLocalDateTime).toBe(toLocalIso(session.finishTimestamp));
      }
    }
  });
});
