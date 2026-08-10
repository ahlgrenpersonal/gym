import type { WorkoutExerciseState } from "./models";

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

export function completeCurrentExercise(
  states: WorkoutExerciseState[],
  currentId: string,
): WorkoutExerciseState[] {
  const current = states.find((state) => state.id === currentId);
  if (!current) return states;
  const withoutCurrent = states.map((state) =>
    state.id === currentId
      ? { ...state, status: "complete" as const, queuedStatus: undefined }
      : demoteCurrent(state),
  );

  let next = ordered(withoutCurrent).find(
    (state) => state.status === "todo" && state.order > current.order,
  );
  next ??= ordered(withoutCurrent).find((state) => state.status === "todo");
  next ??= ordered(withoutCurrent).find((state) => state.status === "deferred");

  return withoutCurrent.map((state) =>
    next && state.id === next.id ? makeCurrent(state) : state,
  );
}

export function queueIsComplete(states: WorkoutExerciseState[]): boolean {
  return states.length > 0 && states.every((state) => state.status === "complete");
}
