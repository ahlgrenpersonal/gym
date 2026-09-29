import type { WorkoutSession } from "./models";

type RestUpdate = Pick<
  WorkoutSession,
  "activeRestEndTimestamp" | "activeRestExerciseId"
>;

export function restUpdateAfterSet({
  exerciseId,
  restSeconds,
  timestamp,
  suppressRest = false,
}: {
  exerciseFinished: boolean;
  exerciseId: string;
  restSeconds: number;
  timestamp: number;
  suppressRest?: boolean;
}): RestUpdate {
  if (suppressRest) return {};
  const nextRestEndTimestamp = timestamp + restSeconds * 1000;
  return {
    activeRestEndTimestamp: nextRestEndTimestamp,
    activeRestExerciseId: exerciseId,
  };
}
