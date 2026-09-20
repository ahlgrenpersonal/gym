import type { WorkoutSession } from "./models";

type RestUpdate = Pick<
  WorkoutSession,
  "activeRestEndTimestamp" | "activeRestExerciseId"
>;

export function restUpdateAfterSet({
  exerciseId,
  restSeconds,
  timestamp,
  activeRestEndTimestamp,
  activeRestExerciseId,
  preserveLongerRest = false,
}: {
  exerciseFinished: boolean;
  exerciseId: string;
  restSeconds: number;
  timestamp: number;
  activeRestEndTimestamp?: number | null;
  activeRestExerciseId?: string | null;
  preserveLongerRest?: boolean;
}): RestUpdate {
  const nextRestEndTimestamp = timestamp + restSeconds * 1000;
  if (
    preserveLongerRest &&
    activeRestEndTimestamp !== undefined &&
    activeRestEndTimestamp !== null &&
    activeRestEndTimestamp > nextRestEndTimestamp
  ) {
    return {
      activeRestEndTimestamp,
      activeRestExerciseId: activeRestExerciseId ?? exerciseId,
    };
  }
  return {
    activeRestEndTimestamp: nextRestEndTimestamp,
    activeRestExerciseId: exerciseId,
  };
}
