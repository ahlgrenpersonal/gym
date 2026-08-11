import { localDateKey } from "./local-date";
import type { WorkoutSession, WorkoutType } from "./models";

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
