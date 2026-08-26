import type { SetRecord, WorkoutSession } from "./models";

export function repShortcutsFromHistory({
  sessions,
  sets,
  currentSessionId,
  exerciseId,
  fallback,
}: {
  sessions: WorkoutSession[];
  sets: SetRecord[];
  currentSessionId: string;
  exerciseId: string;
  fallback: number[];
}): number[] {
  const previousSession = sessions
    .filter((session) => session.id !== currentSessionId)
    .filter((session) =>
      sets.some(
        (record) =>
          record.sessionId === session.id && record.exerciseId === exerciseId,
      ),
    )
    .sort((a, b) => b.startTimestamp - a.startTimestamp)[0];

  if (!previousSession) return fallback;

  const previousSets = sets
    .filter(
      (record) =>
        record.sessionId === previousSession.id &&
        record.exerciseId === exerciseId,
    )
    .sort((a, b) => a.setNumber - b.setNumber || a.timestamp - b.timestamp);
  const referenceSet =
    previousSets.find((record) => record.setNumber === 2) ??
    previousSets.find((record) => record.setNumber === 1) ??
    previousSets[0];

  if (!referenceSet) return fallback;

  return [
    Math.max(1, referenceSet.actualReps - 1),
    referenceSet.actualReps,
    referenceSet.actualReps + 1,
  ].filter((value, index, values) => values.indexOf(value) === index);
}
