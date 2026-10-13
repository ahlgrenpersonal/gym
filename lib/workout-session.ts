import type { WorkoutDatabase } from "./db";
import { workoutExercises } from "./exercises";
import { localDateKey, toLocalIso } from "./local-date";
import { createId, type WorkoutSession, type WorkoutType } from "./models";
import { createWorkoutQueue } from "./queue";
import { activeSessionsForLocalDay } from "./today-sessions";

/**
 * Opening a day is a preview until its first set is logged. Refresh an empty
 * preview from the current routine, but never rewrite a started workout.
 * Read/check/write in one transaction so another tab's saved sets win and
 * simultaneous opens cannot create duplicate drafts. No set records are edited.
 */
export async function openWorkoutSession(
  database: WorkoutDatabase,
  workoutType: WorkoutType,
  timestamp = Date.now(),
): Promise<WorkoutSession> {
  return database.transaction(
    "rw",
    [database.sessions, database.sets, database.exerciseStates, database.exercises],
    async () => {
      const candidates = activeSessionsForLocalDay(
        await database.sessions.where("[workoutType+status]").equals([workoutType, "active"]).toArray(),
        timestamp,
      );
      // Prefer actual progress over a newer empty worksheet from an old version.
      for (const session of candidates) {
        if (await database.sets.where("sessionId").equals(session.id).count()) {
          return session;
        }
      }

      const definitions = workoutExercises(await database.exercises.toArray(), workoutType);
      if (!definitions.length) throw new Error("No exercises found for this workout.");
      const session: WorkoutSession = {
        id: candidates[0]?.id ?? createId("session"),
        workoutType,
        status: "active",
        startTimestamp: timestamp,
        localDate: localDateKey(timestamp),
        startLocalDateTime: toLocalIso(timestamp),
        exerciseOrder: definitions.map((exercise) => exercise.id),
        activeRestEndTimestamp: null,
        activeRestExerciseId: null,
      };
      // Only the chosen zero-set draft's queue is replaced. Logged sessions and
      // historical/completed sessions (even empty ones) are never touched here.
      await database.exerciseStates.where("sessionId").equals(session.id).delete();
      await database.exerciseStates.bulkAdd(createWorkoutQueue(definitions, session.id));
      await database.sessions.put(session);
      return session;
    },
  );
}
