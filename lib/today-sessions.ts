import { localDateKey } from "./local-date";
import type { SetRecord, WorkoutSession, WorkoutType } from "./models";

// An active database worksheet can be an empty preview. Only a saved set
// (including an ALT set) makes it a workout in progress.
export function sessionHasLoggedSets(sessionId: string, sets: SetRecord[]): boolean {
  return sets.some((record) => record.sessionId === sessionId);
}

export function activeSessionsForLocalDay(
  sessions: WorkoutSession[],
  timestamp = Date.now(),
): WorkoutSession[] {
  const date = localDateKey(timestamp);
  return sessions
    .filter(
      (session) =>
        session.status === "active" &&
        (session.localDate ?? localDateKey(session.startTimestamp)) === date,
    )
    .sort((a, b) => b.startTimestamp - a.startTimestamp);
}

export function activeSessionForWorkout(
  sessions: WorkoutSession[],
  workoutType: WorkoutType,
  timestamp = Date.now(),
): WorkoutSession | undefined {
  return activeSessionsForLocalDay(sessions, timestamp).find(
    (session) => session.workoutType === workoutType,
  );
}
