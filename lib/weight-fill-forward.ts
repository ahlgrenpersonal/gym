import type {
  SetRecord,
  WeightUnit,
  WorkoutSession,
} from "./models";
import { localDateKey } from "./local-date";
import { recordWeightInUnit } from "./recommendation";
import { defaultStartingWeight } from "./starting-weight";

export type WeightSuggestionSource =
  | "previous_set"
  | "previous_workout"
  | "program_update"
  | "none";

export interface WeightSuggestion {
  weight?: number;
  source: WeightSuggestionSource;
}

function sessionLocalDate(session: WorkoutSession): string {
  return (
    session.localDate ??
    session.startLocalDateTime?.slice(0, 10) ??
    localDateKey(session.startTimestamp)
  );
}

export function fillForwardWeight({
  sessions,
  sets,
  currentSessionId,
  exerciseId,
  displayUnit,
  programWeightLb,
  programWeightEffectiveLocalDate,
}: {
  sessions: WorkoutSession[];
  sets: SetRecord[];
  currentSessionId: string;
  exerciseId: string;
  displayUnit: WeightUnit;
  programWeightLb?: number;
  programWeightEffectiveLocalDate?: string;
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

  const currentSession = sessions.find(
    (session) => session.id === currentSessionId,
  );
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
  const programIsInEffect =
    programWeightLb !== undefined &&
    (!programWeightEffectiveLocalDate ||
      !currentSession ||
      sessionLocalDate(currentSession) >= programWeightEffectiveLocalDate);
  const previousSessionPredatesProgram =
    !previousSession ||
    (!!programWeightEffectiveLocalDate &&
      sessionLocalDate(previousSession) < programWeightEffectiveLocalDate);

  if (programIsInEffect && previousSessionPredatesProgram) {
    return {
      weight: defaultStartingWeight(displayUnit, programWeightLb),
      source: "program_update",
    };
  }

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
