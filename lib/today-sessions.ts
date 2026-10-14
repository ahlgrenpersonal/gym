import { localDateKey } from "./local-date";
import type { SetRecord, WorkoutSession, WorkoutType } from "./models";

// An active database worksheet can be an empty preview. Only a saved set
// (including an ALT set) makes it a workout in progress.
export function sessionHasLoggedSets(sessionId: string, sets: SetRecord[]): boolean {
  return sets.some((record) => record.sessionId === sessionId);
}

// Display-only weekly completion, grouped by the plan's day, not the calendar
// weekday it was performed on. Use local Monday midnight (not a fixed-hour
// subtraction, which fails across daylight-saving changes). A repeat never
// clears a previous completion and does not prevent opening another session.
export function completedWorkoutTypesForLocalWeek(
  sessions: WorkoutSession[],
  timestamp = Date.now(),
): Set<WorkoutType> {
  const today = new Date(timestamp);
  const daysSinceMonday = (today.getDay() + 6) % 7;
  const weekStart = new Date(
    today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday,
  ).getTime();
  return new Set(sessions.filter((session) => {
    // Older completed records may not have a finish timestamp.
    const completedAt = session.finishTimestamp ?? session.startTimestamp;
    return session.status === "completed" && completedAt >= weekStart && completedAt <= timestamp;
  }).map((session) => session.workoutType));
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
