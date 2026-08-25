import { describe, expect, it } from "vitest";
import {
  completeCurrentExercise,
  deferCurrentExercise,
  jumpToExercise,
} from "../lib/queue";
import type { WorkoutExerciseState } from "../lib/models";

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
