import type { ExerciseDefinition, SetRecord, WorkoutExerciseState } from "./models";

// Snapshot the resolved day plan, including every ALT sibling. Sessions with
// logged sets retain it; openWorkoutSession refreshes zero-set previews.
export function createWorkoutQueue(
  definitions: ExerciseDefinition[],
  sessionId: string,
): WorkoutExerciseState[] {
  return createInitialQueue(definitions.map((exercise, order) => ({
    id: `${sessionId}:${exercise.id}`,
    sessionId,
    exerciseId: exercise.id,
    order,
    status: "todo" as const,
    exerciseName: exercise.name,
    minReps: exercise.minReps,
    maxReps: exercise.maxReps,
    targetSets: exercise.targetSets,
    restSeconds: exercise.restSeconds,
    incrementLb: exercise.incrementLb,
    imageKey: exercise.imageKey,
    defaultWeightLb: exercise.defaultWeightLb,
    defaultWeightEffectiveLocalDate: exercise.defaultWeightEffectiveLocalDate,
    alternatesWithExerciseId: exercise.alternatesWithExerciseId,
  })));
}

function ordered(states: WorkoutExerciseState[]): WorkoutExerciseState[] {
  return [...states].sort((a, b) => a.order - b.order);
}

function demoteCurrent(state: WorkoutExerciseState): WorkoutExerciseState {
  if (state.status !== "current") return state;
  return {
    ...state,
    status: state.queuedStatus ?? "todo",
    queuedStatus: undefined,
  };
}

function makeCurrent(state: WorkoutExerciseState): WorkoutExerciseState {
  return {
    ...state,
    queuedStatus: state.status === "deferred" ? "deferred" : "todo",
    status: "current",
  };
}

export function createInitialQueue(
  states: WorkoutExerciseState[],
): WorkoutExerciseState[] {
  const firstId = ordered(states)[0]?.id;
  return states.map((state) =>
    state.id === firstId ? makeCurrent({ ...state, status: "todo" }) : state,
  );
}

export function jumpToExercise(
  states: WorkoutExerciseState[],
  targetId: string,
): WorkoutExerciseState[] {
  const target = states.find((state) => state.id === targetId);
  if (!target || target.status === "complete") return states;
  return states.map((state) => {
    if (state.id === targetId) return makeCurrent(demoteCurrent(state));
    return demoteCurrent(state);
  });
}

export function deferCurrentExercise(
  states: WorkoutExerciseState[],
  currentId: string,
): WorkoutExerciseState[] {
  const current = states.find((state) => state.id === currentId);
  if (!current) return states;
  let next = ordered(states).find(
    (state) => state.status === "todo" && state.order > current.order,
  );
  next ??= ordered(states).find((state) => state.status === "todo");

  return states.map((state) => {
    if (state.id === currentId) {
      return { ...state, status: "deferred", queuedStatus: undefined };
    }
    if (next && state.id === next.id) return makeCurrent(state);
    return demoteCurrent(state);
  });
}

function alternatingReturnTarget(
  states: WorkoutExerciseState[],
  current: WorkoutExerciseState,
  sets: readonly SetRecord[],
): WorkoutExerciseState | undefined {
  const available = ordered(states).filter(
    (state) => state.id !== current.id && state.status !== "complete",
  );
  const mains = available.filter((state) => !state.alternatesWithExerciseId);
  // Saved main-set history survives reopening and manual navigation.
  const latestMainSet = [...sets]
    .filter((record) => record.sessionId === current.sessionId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .find((record) => mains.some((state) => state.exerciseId === record.exerciseId));
  return mains.find((state) => state.exerciseId === latestMainSet?.exerciseId)
    ?? mains.filter((state) => state.order < current.order).at(-1)
    ?? mains.find((state) => state.order > current.order)
    // If all ordinary exercises are finished, allow remaining ALTs to be done.
    ?? available.filter((state) => state.order < current.order).at(-1)
    ?? available.find((state) => state.order > current.order);
}

/** Select an unfinished ordinary exercise after every ALT log, not just its last. */
export function queueAfterSet(
  states: WorkoutExerciseState[],
  currentId: string,
  exerciseFinished: boolean,
  sets: readonly SetRecord[] = [],
): WorkoutExerciseState[] {
  if (exerciseFinished) return completeCurrentExercise(states, currentId, sets);
  const current = states.find((state) => state.id === currentId);
  if (!current?.alternatesWithExerciseId) return states;
  const next = alternatingReturnTarget(states, current, sets);
  return next ? jumpToExercise(states, next.id) : states;
}

export function completeCurrentExercise(
  states: WorkoutExerciseState[],
  currentId: string,
  sets: readonly SetRecord[] = [],
): WorkoutExerciseState[] {
  const current = states.find((state) => state.id === currentId);
  if (!current) return states;
  const withoutCurrent = states.map((state) =>
    state.id === currentId
      ? { ...state, status: "complete" as const, queuedStatus: undefined }
      : demoteCurrent(state),
  );

  let next: WorkoutExerciseState | undefined;
  if (current.alternatesWithExerciseId) {
    next = alternatingReturnTarget(withoutCurrent, current, sets);
  } else {
    next = ordered(withoutCurrent).find(
      (state) => state.status === "todo" && state.order > current.order,
    );
    next ??= ordered(withoutCurrent).find((state) => state.status === "todo");
    next ??= ordered(withoutCurrent).find((state) => state.status === "deferred");
  }

  return withoutCurrent.map((state) =>
    next && state.id === next.id ? makeCurrent(state) : state,
  );
}

export function queueIsComplete(states: WorkoutExerciseState[]): boolean {
  return states.length > 0 && states.every((state) => state.status === "complete");
}
