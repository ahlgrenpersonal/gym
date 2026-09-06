import type { WorkoutSession } from "./models";

type RestUpdate = Pick<
  WorkoutSession,
  "activeRestEndTimestamp" | "activeRestExerciseId"
>;

export function restUpdateAfterSet({
  exerciseId,
  restSeconds,
  timestamp,
}: {
  exerciseFinished: boolean;
  exerciseId: string;
  restSeconds: number;
  timestamp: number;
}): RestUpdate {
  return {
    activeRestEndTimestamp: timestamp + restSeconds * 1000,
    activeRestExerciseId: exerciseId,
  };
}
