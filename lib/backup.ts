import type { WorkoutDatabase } from "./db";
import { DATABASE_VERSION } from "./db";
import { localDateKey, toLocalIso } from "./local-date";
import type {
  AppSettings,
  ExerciseDefinition,
  SetRecord,
  WorkoutBackup,
  WorkoutExerciseState,
  WorkoutSession,
} from "./models";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validExercise(value: unknown): value is ExerciseDefinition {
  if (!isObject(value)) return false;
  return (
    isString(value.id) &&
    (value.workoutType === "push" ||
      value.workoutType === "pull" ||
      value.workoutType === "legs_abs") &&
    isFiniteNumber(value.order) &&
    isString(value.name) &&
    isFiniteNumber(value.minReps) &&
    isFiniteNumber(value.maxReps) &&
    isFiniteNumber(value.targetSets) &&
    isFiniteNumber(value.restSeconds) &&
    isFiniteNumber(value.incrementLb) &&
    isString(value.imageKey)
  );
}

function validSession(value: unknown): value is WorkoutSession {
  if (!isObject(value)) return false;
  return (
    isString(value.id) &&
    (value.workoutType === "push" ||
      value.workoutType === "pull" ||
      value.workoutType === "legs_abs") &&
    (value.status === "active" ||
      value.status === "completed" ||
      value.status === "archived") &&
    isFiniteNumber(value.startTimestamp) &&
    (value.localDate === undefined || isString(value.localDate)) &&
    (value.startLocalDateTime === undefined || isString(value.startLocalDateTime)) &&
    (value.finishLocalDateTime === undefined || isString(value.finishLocalDateTime)) &&
    Array.isArray(value.exerciseOrder) &&
    value.exerciseOrder.every(isString)
  );
}

function validState(value: unknown): value is WorkoutExerciseState {
  if (!isObject(value)) return false;
  return (
    isString(value.id) &&
    isString(value.sessionId) &&
    isString(value.exerciseId) &&
    isFiniteNumber(value.order) &&
    ["todo", "current", "deferred", "complete"].includes(String(value.status)) &&
    isString(value.exerciseName) &&
    isFiniteNumber(value.minReps) &&
    isFiniteNumber(value.maxReps) &&
    isFiniteNumber(value.targetSets) &&
    isFiniteNumber(value.restSeconds) &&
    isFiniteNumber(value.incrementLb) &&
    isString(value.imageKey)
  );
}

function validSet(value: unknown): value is SetRecord {
  if (!isObject(value)) return false;
  return (
    isString(value.id) &&
    isString(value.sessionId) &&
    (value.workoutType === "push" ||
      value.workoutType === "pull" ||
      value.workoutType === "legs_abs") &&
    isString(value.exerciseId) &&
    isString(value.exerciseName) &&
    isFiniteNumber(value.setNumber) &&
    isFiniteNumber(value.actualWeight) &&
    (value.weightUnit === "lb" || value.weightUnit === "kg") &&
    isFiniteNumber(value.weightKg) &&
    isFiniteNumber(value.actualReps) &&
    isFiniteNumber(value.timestamp) &&
    (value.localDateTime === undefined || isString(value.localDateTime))
  );
}

function validSettings(value: unknown): value is AppSettings {
  return (
    isObject(value) &&
    value.id === "settings" &&
    (value.weightUnit === "lb" || value.weightUnit === "kg")
  );
}

export function validateBackup(value: unknown): WorkoutBackup {
  if (!isObject(value) || value.format !== "workout-backup") {
    throw new Error("This is not a Workout backup file.");
  }
  if (!isFiniteNumber(value.schemaVersion) || value.schemaVersion > DATABASE_VERSION) {
    throw new Error("This backup was created by an unsupported database version.");
  }
  const collections = ["exercises", "sessions", "exerciseStates", "sets", "settings"];
  if (collections.some((key) => !Array.isArray(value[key]))) {
    throw new Error("The backup is missing required data collections.");
  }
  if (!(value.exercises as unknown[]).every(validExercise)) {
    throw new Error("The backup contains an invalid exercise definition.");
  }
  if (!(value.sessions as unknown[]).every(validSession)) {
    throw new Error("The backup contains an invalid workout session.");
  }
  if (!(value.exerciseStates as unknown[]).every(validState)) {
    throw new Error("The backup contains an invalid workout queue state.");
  }
  if (!(value.sets as unknown[]).every(validSet)) {
    throw new Error("The backup contains an invalid set record.");
  }
  if (!(value.settings as unknown[]).every(validSettings)) {
    throw new Error("The backup contains invalid settings.");
  }

  const sessionIds = new Set((value.sessions as WorkoutSession[]).map((item) => item.id));
  if (
    (value.exerciseStates as WorkoutExerciseState[]).some(
      (item) => !sessionIds.has(item.sessionId),
    ) ||
    (value.sets as SetRecord[]).some((item) => !sessionIds.has(item.sessionId))
  ) {
    throw new Error("The backup contains records that do not belong to a workout session.");
  }

  return value as unknown as WorkoutBackup;
}

export async function createBackup(database: WorkoutDatabase): Promise<WorkoutBackup> {
  const [exercises, sessions, exerciseStates, sets, settings] = await Promise.all([
    database.exercises.toArray(),
    database.sessions.toArray(),
    database.exerciseStates.toArray(),
    database.sets.toArray(),
    database.settings.toArray(),
  ]);
  return {
    format: "workout-backup",
    schemaVersion: DATABASE_VERSION,
    exportedAt: new Date().toISOString(),
    exercises,
    sessions,
    exerciseStates,
    sets,
    settings,
  };
}

export async function restoreBackup(
  database: WorkoutDatabase,
  unknownBackup: unknown,
): Promise<void> {
  const backup = validateBackup(unknownBackup);
  const sessions = backup.sessions.map((session) => ({
    ...session,
    localDate: session.localDate ?? localDateKey(session.startTimestamp),
    startLocalDateTime:
      session.startLocalDateTime ?? toLocalIso(session.startTimestamp),
    ...(session.finishTimestamp !== undefined
      ? {
          finishLocalDateTime:
            session.finishLocalDateTime ?? toLocalIso(session.finishTimestamp),
        }
      : {}),
  }));
  const sets = backup.sets.map((record) => ({
    ...record,
    localDateTime: record.localDateTime ?? toLocalIso(record.timestamp),
  }));
  await database.transaction(
    "rw",
    database.exercises,
    database.sessions,
    database.exerciseStates,
    database.sets,
    database.settings,
    async () => {
      await Promise.all([
        database.exercises.clear(),
        database.sessions.clear(),
        database.exerciseStates.clear(),
        database.sets.clear(),
        database.settings.clear(),
      ]);
      if (backup.exercises.length) await database.exercises.bulkAdd(backup.exercises);
      if (sessions.length) await database.sessions.bulkAdd(sessions);
      if (backup.exerciseStates.length)
        await database.exerciseStates.bulkAdd(backup.exerciseStates);
      if (sets.length) await database.sets.bulkAdd(sets);
      if (backup.settings.length) await database.settings.bulkAdd(backup.settings);
    },
  );
}

export function setsToCsv(sets: SetRecord[]): string {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const header = [
    "local_datetime",
    "timestamp_utc",
    "workout_type",
    "session_id",
    "exercise_id",
    "exercise_name",
    "set_number",
    "weight",
    "weight_unit",
    "reps",
  ];
  const rows = [...sets]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((set) =>
      [
        set.localDateTime ?? toLocalIso(set.timestamp),
        new Date(set.timestamp).toISOString(),
        set.workoutType,
        set.sessionId,
        set.exerciseId,
        set.exerciseName,
        set.setNumber,
        set.actualWeight,
        set.weightUnit,
        set.actualReps,
      ]
        .map(escape)
        .join(","),
    );
  return [header.map(escape).join(","), ...rows].join("\n");
}
