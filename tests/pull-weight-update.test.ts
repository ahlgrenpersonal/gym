import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { DATABASE_VERSION, ensureDefaults, WorkoutDatabase } from "../lib/db";
import { DEFAULT_EXERCISES, workoutExercises } from "../lib/exercises";
import type { SetRecord, WorkoutSession } from "../lib/models";
import { toKg } from "../lib/recommendation";
import { fillForwardWeight } from "../lib/weight-fill-forward";

const updates = [
  { id: "lat_pulldown", previousWeight: 100, weight: 110 },
  { id: "preacher_or_cable_curl", previousWeight: 30, weight: 35 },
];
const effectiveDate = "2026-10-10";
const databases: WorkoutDatabase[] = [];
const names: string[] = [];
const overrideGuidance =
  "Weight-only updates belong in WEIGHT_OVERRIDES in lib/weight-overrides.ts, not database migrations or stored-default rewrites. See AGENTS.md before changing this expectation.";

afterEach(async () => {
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe("October pulldown and biceps weight update", () => {
  it("uses the new weights for fresh installs on both pull days", async () => {
    const name = `fresh-pull-weights-${crypto.randomUUID()}`;
    names.push(name);
    const database = new WorkoutDatabase(name);
    databases.push(database);
    await database.open();
    expect(database.verno).toBe(DATABASE_VERSION);

    for (const day of ["tuesday", "thursday"] as const) {
      const exercises = workoutExercises(await database.exercises.toArray(), day);
      for (const update of updates) {
        const exercise = exercises.find((item) => item.id === update.id)!;
        expect(exercise).toMatchObject({
          targetSets: 3,
          minReps: 8,
          maxReps: 12,
        });
        const current: WorkoutSession = {
          id: "current",
          workoutType: day,
          status: "active",
          localDate: effectiveDate,
          startTimestamp: Date.parse("2026-10-10T11:00:00Z"),
          exerciseOrder: exercises.map((item) => item.id),
        };
        expect(fillForwardWeight({
          sessions: [current],
          sets: [],
          currentSessionId: current.id,
          exerciseId: update.id,
          displayUnit: "lb",
          programWeightLb: exercise.defaultWeightLb,
          programWeightEffectiveLocalDate: exercise.defaultWeightEffectiveLocalDate,
        })).toEqual({
          weight: update.weight,
          source: "program_override",
          overrideDate: effectiveDate,
        });
      }
    }
  });

  it("works on an existing installation without migrating or rewriting stored data", async () => {
    const name = `migrate-pull-weights-${crypto.randomUUID()}`;
    names.push(name);
    const previous = new Dexie(name);
    previous.version(12).stores({
      exercises: "&id, workoutType, order",
      sessions:
        "&id, status, workoutType, startTimestamp, localDate, [localDate+status], [workoutType+status]",
      exerciseStates:
        "&id, sessionId, exerciseId, [sessionId+exerciseId], status, order",
      sets:
        "&id, sessionId, exerciseId, setNumber, timestamp, [exerciseId+setNumber]",
      settings: "&id",
    });
    const oldExercises = DEFAULT_EXERCISES.map((exercise) => ({
      ...exercise,
      // Custom settings must survive, including settings on the updated exercises.
      restSeconds: exercise.restSeconds + 15,
      ...(updates.some((update) => update.id === exercise.id)
        ? {
            defaultWeightLb: exercise.id === "lat_pulldown" ? 90 : 30,
            defaultWeightEffectiveLocalDate: "2026-09-03",
          }
        : {}),
    }));
    const oldSession: WorkoutSession = {
      id: "previous",
      workoutType: "thursday",
      status: "completed",
      startTimestamp: Date.parse("2026-10-08T11:00:00Z"),
      localDate: "2026-10-08",
      exerciseOrder: updates.map((update) => update.id),
    };
    const oldSets: SetRecord[] = updates.map((update, index) => ({
      id: `previous-${update.id}`,
      sessionId: oldSession.id,
      workoutType: oldSession.workoutType,
      exerciseId: update.id,
      exerciseName: DEFAULT_EXERCISES.find((exercise) => exercise.id === update.id)!.name,
      setNumber: 2,
      actualWeight: update.previousWeight,
      weightUnit: "lb",
      weightKg: toKg(update.previousWeight, "lb"),
      actualReps: 15,
      timestamp: oldSession.startTimestamp + (index + 1) * 60_000,
    }));
    const oldState = {
      ...oldExercises[0],
      id: "previous:incline_chest_press",
      sessionId: oldSession.id,
      exerciseId: "incline_chest_press",
      status: "complete",
    };
    const settings = { id: "settings", weightUnit: "lb" };
    await previous.open();
    await previous.table("exercises").bulkAdd(oldExercises);
    await previous.table("sessions").add(oldSession);
    await previous.table("sets").bulkAdd(oldSets);
    await previous.table("exerciseStates").add(oldState);
    await previous.table("settings").add(settings);
    previous.close();

    const upgraded = new WorkoutDatabase(name);
    databases.push(upgraded);
    await upgraded.open();
    await ensureDefaults(upgraded);
    expect(upgraded.verno, overrideGuidance).toBe(12);
    expect(await upgraded.sessions.toArray()).toEqual([oldSession]);
    expect(await upgraded.exerciseStates.toArray()).toEqual([oldState]);
    expect(await upgraded.settings.toArray()).toEqual([settings]);
    expect(await upgraded.sets.count()).toBe(oldSets.length);
    for (const record of oldSets) {
      expect(await upgraded.sets.get(record.id)).toEqual(record);
    }
    expect(await upgraded.exercises.count()).toBe(oldExercises.length);
    for (const oldExercise of oldExercises) {
      expect(await upgraded.exercises.get(oldExercise.id), overrideGuidance).toEqual(oldExercise);
    }

    for (const update of updates) {
      const exercise = (await upgraded.exercises.get(update.id))!;
      const current: WorkoutSession = {
        ...oldSession,
        id: "current",
        status: "active",
        localDate: effectiveDate,
        startTimestamp: Date.parse("2026-10-10T11:00:00Z"),
      };
      const input = {
        sessions: [oldSession, current],
        sets: oldSets,
        currentSessionId: current.id,
        exerciseId: update.id,
        displayUnit: "lb" as const,
        programWeightLb: exercise.defaultWeightLb,
        programWeightEffectiveLocalDate: exercise.defaultWeightEffectiveLocalDate,
      };
      expect(fillForwardWeight(input)).toEqual({
        weight: update.weight,
        source: "program_override",
        overrideDate: effectiveDate,
      });
      expect(fillForwardWeight({
        ...input,
        sessions: [oldSession, { ...current, localDate: "2026-10-09" }],
      })).toEqual({ weight: update.previousWeight, source: "previous_workout" });

      // An actual set at a manually chosen weight still takes priority.
      const manualSet = {
        ...oldSets.find((record) => record.exerciseId === update.id)!,
        id: "manual-set",
        sessionId: current.id,
        timestamp: current.startTimestamp + 60_000,
      };
      expect(fillForwardWeight({ ...input, sets: [...oldSets, manualSet] })).toEqual({
        weight: update.previousWeight,
        source: "previous_set",
      });
      expect(fillForwardWeight({
        ...input,
        currentSessionId: "next",
        sessions: [oldSession, current, { ...current, id: "next", localDate: "2026-10-13", startTimestamp: current.startTimestamp + 3 * 86_400_000 }],
        sets: [...oldSets, manualSet],
      })).toEqual({ weight: update.previousWeight, source: "previous_workout" });
    }
  });
});
