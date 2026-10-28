import type { WorkoutSession } from "./models";

// Upgrade the old lateral-raise rest in saved definitions and session snapshots
// at read time. Explicit custom durations remain intact; history is not rewritten.
export function currentRestSeconds(exerciseId: string, savedSeconds: number): number {
  return exerciseId === "lateral_raise" && savedSeconds === 120 ? 180 : savedSeconds;
}

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
