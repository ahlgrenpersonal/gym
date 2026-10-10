import type {
  SetRecord,
  WeightUnit,
  WorkoutSession,
} from "./models";
import { localDateKey } from "./local-date";
import { recordWeightInUnit } from "./recommendation";
import { defaultStartingWeight } from "./starting-weight";
import { latestWeightOverride, type WeightOverrides } from "./weight-overrides";

export type WeightSuggestionSource =
  | "previous_set"
  | "previous_workout"
  | "program_override"
  | "program_update"
  | "none";

export interface WeightSuggestion {
  weight?: number;
  source: WeightSuggestionSource;
  overrideDate?: string;
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
  weightOverrides,
}: {
  sessions: WorkoutSession[];
  sets: SetRecord[];
  currentSessionId: string;
  exerciseId: string;
  displayUnit: WeightUnit;
  programWeightLb?: number;
  programWeightEffectiveLocalDate?: string;
  weightOverrides?: WeightOverrides;
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
    .filter(
      (session) =>
        !currentSession || session.startTimestamp <= currentSession.startTimestamp,
    )
    .filter((session) =>
      sets.some(
        (record) =>
          record.sessionId === session.id &&
          record.exerciseId === exerciseId,
      ),
    )
    .sort((a, b) => b.startTimestamp - a.startTimestamp)[0];

  // Actual sets in this session already took priority above. A new dated override
  // beats older history only until this exercise is logged on/after its date.
  // Unrelated workouts do not consume the override, and future dates never apply.
  const override = currentSession
    ? latestWeightOverride(exerciseId, sessionLocalDate(currentSession), weightOverrides)
    : undefined;
  if (
    override &&
    (!previousSession || sessionLocalDate(previousSession) < override.effectiveLocalDate)
  ) {
    return {
      weight: defaultStartingWeight(displayUnit, override.weightLb),
      source: "program_override",
      overrideDate: override.effectiveLocalDate,
    };
  }

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
