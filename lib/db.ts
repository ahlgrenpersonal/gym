import Dexie, { type Table } from "dexie";
import {
  DEFAULT_EXERCISES,
  DEFAULT_SETTINGS,
  RETIRED_EXERCISE_IDS,
} from "./exercises";
import { localDateKey, toLocalIso } from "./local-date";
import type {
  AppSettings,
  ExerciseDefinition,
  SetRecord,
  WorkoutExerciseState,
  WorkoutSession,
} from "./models";
import { toKg } from "./recommendation";

export const DATABASE_NAME = "workout-tracker";
export const DATABASE_VERSION = 6;

export class WorkoutDatabase extends Dexie {
  exercises!: Table<ExerciseDefinition, string>;
  sessions!: Table<WorkoutSession, string>;
  exerciseStates!: Table<WorkoutExerciseState, string>;
  sets!: Table<SetRecord, string>;
  settings!: Table<AppSettings, string>;

  constructor(name = DATABASE_NAME) {
    super(name);

    this.version(1).stores({
      exercises: "&id, workoutType, order",
      sessions: "&id, status, workoutType, startTimestamp",
      exerciseStates: "&id, sessionId, exerciseId, [sessionId+exerciseId], status, order",
      sets: "&id, sessionId, exerciseId, setNumber, timestamp",
      settings: "&id",
    });

    this.version(2)
      .stores({
        exercises: "&id, workoutType, order",
        sessions:
          "&id, status, workoutType, startTimestamp, [workoutType+status]",
        exerciseStates:
          "&id, sessionId, exerciseId, [sessionId+exerciseId], status, order",
        sets:
          "&id, sessionId, exerciseId, setNumber, timestamp, [exerciseId+setNumber]",
        settings: "&id",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<SetRecord, string>("sets")
          .toCollection()
          .modify((record) => {
            if (!Number.isFinite(record.weightKg)) {
              record.weightKg = toKg(record.actualWeight, record.weightUnit);
            }
          });
      });

    this.version(3)
      .stores({
        exercises: "&id, workoutType, order",
        sessions:
          "&id, status, workoutType, startTimestamp, localDate, [localDate+status], [workoutType+status]",
        exerciseStates:
          "&id, sessionId, exerciseId, [sessionId+exerciseId], status, order",
        sets:
          "&id, sessionId, exerciseId, setNumber, timestamp, [exerciseId+setNumber]",
        settings: "&id",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<SetRecord, string>("sets")
          .toCollection()
          .modify((record) => {
            if (!record.localDateTime) {
              record.localDateTime = toLocalIso(record.timestamp);
            }
          });
        await transaction
          .table<WorkoutSession, string>("sessions")
          .toCollection()
          .modify((session) => {
            if (!session.localDate) {
              session.localDate = localDateKey(session.startTimestamp);
            }
            if (!session.startLocalDateTime) {
              session.startLocalDateTime = toLocalIso(session.startTimestamp);
            }
            if (session.finishTimestamp !== undefined && !session.finishLocalDateTime) {
              session.finishLocalDateTime = toLocalIso(session.finishTimestamp);
            }
          });
      });

    this.version(4)
      .stores({
        exercises: "&id, workoutType, order",
        sessions:
          "&id, status, workoutType, startTimestamp, localDate, [localDate+status], [workoutType+status]",
        exerciseStates:
          "&id, sessionId, exerciseId, [sessionId+exerciseId], status, order",
        sets:
          "&id, sessionId, exerciseId, setNumber, timestamp, [exerciseId+setNumber]",
        settings: "&id",
      })
      .upgrade(async (transaction) => {
        const exercises = transaction.table<ExerciseDefinition, string>("exercises");
        await exercises.bulkDelete([...RETIRED_EXERCISE_IDS]);
        await exercises.bulkPut(
          DEFAULT_EXERCISES.filter(
            (exercise) =>
              exercise.id === "abdominal_crunch_machine" ||
              exercise.id === "reverse_crunch",
          ).map((exercise) => ({ ...exercise })),
        );
      });
    this.version(5)
      .stores({
        exercises: "&id, workoutType, order",
        sessions:
          "&id, status, workoutType, startTimestamp, localDate, [localDate+status], [workoutType+status]",
        exerciseStates:
          "&id, sessionId, exerciseId, [sessionId+exerciseId], status, order",
        sets:
          "&id, sessionId, exerciseId, setNumber, timestamp, [exerciseId+setNumber]",
        settings: "&id",
      })
      .upgrade(async (transaction) => {
        const exercises = transaction.table<ExerciseDefinition, string>("exercises");
        await exercises.bulkDelete([...RETIRED_EXERCISE_IDS]);
        await exercises.bulkPut(
          DEFAULT_EXERCISES.filter(
            (exercise) =>
              exercise.id === "single_leg_extension" ||
              exercise.id === "abdominal_crunch_machine",
          ).map((exercise) => ({ ...exercise })),
        );
      });
    this.version(6)
      .stores({
        exercises: "&id, workoutType, order",
        sessions:
          "&id, status, workoutType, startTimestamp, localDate, [localDate+status], [workoutType+status]",
        exerciseStates:
          "&id, sessionId, exerciseId, [sessionId+exerciseId], status, order",
        sets:
          "&id, sessionId, exerciseId, setNumber, timestamp, [exerciseId+setNumber]",
        settings: "&id",
      })
      .upgrade(async (transaction) => {
        const exercises = transaction.table<ExerciseDefinition, string>("exercises");
        await exercises.bulkDelete([...RETIRED_EXERCISE_IDS]);
        await exercises.put({
          ...DEFAULT_EXERCISES.find(
            (exercise) => exercise.id === "preacher_or_cable_curl",
          )!,
        });
      });
    this.on("populate", async () => {
      await this.exercises.bulkAdd(DEFAULT_EXERCISES.map((item) => ({ ...item })));
      await this.settings.add({ ...DEFAULT_SETTINGS });
    });
  }
}

export const db = new WorkoutDatabase();

export async function ensureDefaults(database: WorkoutDatabase = db): Promise<void> {
  await database.open();
  await database.transaction(
    "rw",
    database.exercises,
    database.settings,
    async () => {
      await database.exercises.bulkDelete([...RETIRED_EXERCISE_IDS]);
      const existingIds = new Set((await database.exercises.toArray()).map((item) => item.id));
      const missing = DEFAULT_EXERCISES.filter((item) => !existingIds.has(item.id));
      if (missing.length) {
        await database.exercises.bulkAdd(missing.map((item) => ({ ...item })));
      }
      if (!(await database.settings.get("settings"))) {
        await database.settings.add({ ...DEFAULT_SETTINGS });
      }
    },
  );
}

export async function deleteWorkoutSession(
  sessionId: string,
  database: WorkoutDatabase = db,
): Promise<void> {
  await database.transaction(
    "rw",
    database.sessions,
    database.exerciseStates,
    database.sets,
    async () => {
      await database.sets.where("sessionId").equals(sessionId).delete();
      await database.exerciseStates.where("sessionId").equals(sessionId).delete();
      await database.sessions.delete(sessionId);
    },
  );
}

export async function resetAllData(database: WorkoutDatabase = db): Promise<void> {
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
      await database.exercises.bulkAdd(DEFAULT_EXERCISES.map((item) => ({ ...item })));
      await database.settings.add({ ...DEFAULT_SETTINGS });
    },
  );
}
