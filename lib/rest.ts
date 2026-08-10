import type { WorkoutSession } from "./models";

type RestUpdate = Pick<
  WorkoutSession,
  "activeRestEndTimestamp" | "activeRestExerciseId"
>;

export function restUpdateAfterSet({
  exerciseFinished,
  exerciseId,
  restSeconds,
  timestamp,
}: {
  exerciseFinished: boolean;
  exerciseId: string;
  restSeconds: number;
  timestamp: number;
}): RestUpdate {
  if (exerciseFinished) {
    return {
      activeRestEndTimestamp: null,
      activeRestExerciseId: null,
    };
  }

  return {
    activeRestEndTimestamp: timestamp + restSeconds * 1000,
    activeRestExerciseId: exerciseId,
  };
}
