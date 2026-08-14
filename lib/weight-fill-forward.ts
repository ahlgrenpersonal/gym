import type {
  SetRecord,
  WeightUnit,
  WorkoutSession,
} from "./models";
import { recordWeightInUnit } from "./recommendation";

export type WeightSuggestionSource =
  | "previous_set"
  | "previous_workout"
  | "none";

export interface WeightSuggestion {
  weight?: number;
  source: WeightSuggestionSource;
}

export function fillForwardWeight({
  sessions,
  sets,
  currentSessionId,
  exerciseId,
  displayUnit,
}: {
  sessions: WorkoutSession[];
  sets: SetRecord[];
  currentSessionId: string;
  exerciseId: string;
  displayUnit: WeightUnit;
}): WeightSuggestion {
  const currentPreviousSet = sets
    .filter(
      (record) =>
        record.sessionId === currentSessionId &&
        record.exerciseId === exerciseId,
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (currentPreviousSet) {
    return {
      weight: recordWeightInUnit(currentPreviousSet, displayUnit),
      source: "previous_set",
    };
  }

  const previousSession = sessions
    .filter((session) => session.id !== currentSessionId)
    .filter((session) =>
      sets.some(
        (record) =>
          record.sessionId === session.id &&
          record.exerciseId === exerciseId,
      ),
    )
    .sort((a, b) => b.startTimestamp - a.startTimestamp)[0];

  if (!previousSession) return { source: "none" };

  const previousSets = sets
    .filter(
      (record) =>
        record.sessionId === previousSession.id &&
        record.exerciseId === exerciseId,
    )
    .sort((a, b) => a.setNumber - b.setNumber || a.timestamp - b.timestamp);
  const workingSet =
    previousSets.find((record) => record.setNumber === 2) ??
    previousSets.find((record) => record.setNumber === 1) ??
    previousSets[0];

  return workingSet
    ? {
        weight: recordWeightInUnit(workingSet, displayUnit),
        source: "previous_workout",
      }
    : { source: "none" };
}
