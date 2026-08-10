import type { SetRecord, WorkoutSession } from "./models";

export interface ExerciseHistoryRow {
  session: WorkoutSession;
  records: SetRecord[];
}

export function exerciseHistoryRows(
  sessions: WorkoutSession[],
  sets: SetRecord[],
  exerciseId: string,
): ExerciseHistoryRow[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const grouped = new Map<string, SetRecord[]>();

  for (const record of sets) {
    if (record.exerciseId !== exerciseId || !sessionsById.has(record.sessionId)) {
      continue;
    }
    const records = grouped.get(record.sessionId) ?? [];
    records.push(record);
    grouped.set(record.sessionId, records);
  }

  return [...grouped.entries()]
    .map(([sessionId, records]) => ({
      session: sessionsById.get(sessionId)!,
      records: [...records].sort((a, b) => a.setNumber - b.setNumber),
    }))
    .sort((a, b) => b.session.startTimestamp - a.session.startTimestamp);
}
