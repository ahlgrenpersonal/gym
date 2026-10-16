import { describe, expect, it } from "vitest";
import {
  completeCurrentExercise,
  deferCurrentExercise,
  jumpToExercise,
} from "../lib/queue";
import type { SetRecord, WorkoutExerciseState } from "../lib/models";

function state(
  id: string,
  order: number,
  status: WorkoutExerciseState["status"],
): WorkoutExerciseState {
  return {
    id,
    sessionId: "session",
    exerciseId: id,
    order,
    status,
    exerciseName: id,
    minReps: 8,
    maxReps: 12,
    targetSets: 3,
    restSeconds: 180,
    incrementLb: 5,
    imageKey: "lat_pulldown",
  };
}

function loggedSet(exerciseId: string, timestamp: number, sessionId = "session"): SetRecord {
  return { id: `${sessionId}:${exerciseId}:${timestamp}`, sessionId, exerciseId,
    workoutType: "wednesday", exerciseName: exerciseId, setNumber: 1,
    actualWeight: 10, weightUnit: "lb", weightKg: 4.536, actualReps: 10, timestamp };
}

function alt(id: string, order: number, status: WorkoutExerciseState["status"] = "current") {
  return { ...state(id, order, status), alternatesWithExerciseId: "anchor" };
}

describe("ALT completion navigation", () => {
  it("returns to the most recently logged unfinished main, not the anchor or nearest row", () => {
    const states = [state("older", 0, "todo"), state("recent", 1, "todo"),
      state("anchor", 2, "todo"), alt("abs", 3), state("next", 4, "todo")];
    const sets = [loggedSet("recent", 300), loggedSet("abs", 400),
      loggedSet("anchor", 200), loggedSet("older", 100)];
    const snapshot = structuredClone({ states, sets });
    const result = completeCurrentExercise(states, "abs", sets);
    expect(result.find((s) => s.status === "current")?.id).toBe("recent");
    expect(result.find((s) => s.id === "abs")?.status).toBe("complete");
    expect(result.filter((s) => s.status === "current")).toHaveLength(1);
    expect({ states, sets }).toEqual(snapshot);
  });

  it("ignores completed mains, ALT logs, missing exercises and other sessions", () => {
    const result = completeCurrentExercise([
      state("recent", 0, "todo"), state("anchor", 1, "todo"),
      state("finished", 2, "complete"), alt("sibling", 3, "todo"), alt("abs", 4),
    ], "abs", [loggedSet("recent", 100), loggedSet("finished", 200),
      loggedSet("sibling", 300), loggedSet("removed", 400), loggedSet("anchor", 500, "other")]);
    expect(result.find((s) => s.status === "current")?.id).toBe("recent");
  });

  it("can return to a last-used main below the ALT when exercises were done out of order", () => {
    const result = completeCurrentExercise([state("above", 0, "todo"), alt("abs", 1),
      state("recent", 2, "todo")], "abs", [loggedSet("recent", 100)]);
    expect(result.find((s) => s.status === "current")?.id).toBe("recent");
  });

  it.each(["todo", "deferred"] as const)("searches upward by order past completed rows (%s)", (status) => {
    const result = completeCurrentExercise([state("next", 4, "todo"), alt("abs", 3),
      state("done", 2, "complete"), state("nearest", 1, status), state("first", 0, "todo")], "abs");
    expect(result.find((s) => s.status === "current")?.id).toBe("nearest");
    expect(result.find((s) => s.id === "nearest")?.queuedStatus).toBe(status);
  });

  it("can fall back to an unfinished ALT sibling above", () => {
    const result = completeCurrentExercise([state("anchor", 0, "complete"),
      alt("sibling", 1, "todo"), alt("abs", 2), state("next", 3, "todo")], "abs");
    expect(result.find((s) => s.status === "current")?.id).toBe("sibling");
  });

  it("searches downward only when nothing unfinished is above", () => {
    const result = completeCurrentExercise([state("anchor", 0, "complete"), alt("abs", 1),
      state("done", 2, "complete"), state("next", 3, "deferred"), state("later", 4, "todo")], "abs");
    expect(result.find((s) => s.status === "current")?.id).toBe("next");
  });

  it("leaves no current exercise when the final ALT completes the workout", () => {
    const result = completeCurrentExercise([state("anchor", 0, "complete"), alt("abs", 1)], "abs",
      [loggedSet("anchor", 100)]);
    expect(result.every((s) => s.status === "complete")).toBe(true);
  });

  it("keeps normal main-exercise completion moving forward even with history", () => {
    const result = completeCurrentExercise([state("previous", 0, "todo"),
      state("main", 1, "current"), state("next", 2, "todo")], "main", [loggedSet("previous", 100)]);
    expect(result.find((s) => s.status === "current")?.id).toBe("next");
  });
});

describe("workout queue", () => {
  it("defers the current exercise and advances to the next normal item", () => {
    const result = deferCurrentExercise(
      [state("a", 0, "complete"), state("b", 1, "current"), state("c", 2, "todo")],
      "b",
    );
    expect(result.find((item) => item.id === "b")?.status).toBe("deferred");
    expect(result.find((item) => item.id === "c")?.status).toBe("current");
  });

  it("returns to the first deferred item after normal items are complete", () => {
    const result = completeCurrentExercise(
      [
        state("a", 0, "deferred"),
        state("b", 1, "complete"),
        state("c", 2, "current"),
      ],
      "c",
    );
    expect(result.find((item) => item.id === "a")?.status).toBe("current");
  });

  it("allows jumping to a deferred exercise without losing the current item", () => {
    const result = jumpToExercise(
      [state("a", 0, "current"), state("b", 1, "deferred")],
      "b",
    );
    expect(result.find((item) => item.id === "a")?.status).toBe("todo");
    expect(result.find((item) => item.id === "b")?.status).toBe("current");
  });

  it("does not reopen a completed exercise as an active queue item", () => {
    const original = [
      state("a", 0, "complete"),
      state("b", 1, "current"),
      state("c", 2, "todo"),
    ];
    const result = jumpToExercise(original, "a");

    expect(result).toBe(original);
    expect(result.map((item) => item.status)).toEqual(["complete", "current", "todo"]);
  });
});
