import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDefaults, WorkoutDatabase } from "../lib/db";
import type { WorkoutExerciseState, WorkoutSession } from "../lib/models";
import { completeCurrentExercise, jumpToExercise } from "../lib/queue";
import { restUpdateAfterSet } from "../lib/rest";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

function exerciseState(
  id: string,
  order: number,
  status: WorkoutExerciseState["status"],
): WorkoutExerciseState {
  return {
    id: `session:${id}`,
    sessionId: "session",
    exerciseId: id,
    order,
    status,
    exerciseName: id,
    minReps: 8,
    maxReps: 12,
    targetSets: 1,
    restSeconds: 180,
    incrementLb: 5,
    imageKey: "lat_pulldown",
  };
}

describe("rest timer persistence across machines", () => {
  it("keeps the same countdown after a final set advances and the user jumps again", async () => {
    const name = `rest-machine-switch-${Date.now()}-${Math.random()}`;
    names.push(name);
    const database = new WorkoutDatabase(name);
    await ensureDefaults(database);

    const session: WorkoutSession = {
      id: "session",
      workoutType: "pull",
      status: "active",
      startTimestamp: 500,
      exerciseOrder: ["row", "pulldown", "curl"],
      ...restUpdateAfterSet({
        exerciseFinished: true,
        exerciseId: "row",
        restSeconds: 180,
        timestamp: 1_000,
      }),
    };
    const afterFinalSet = completeCurrentExercise(
      [
        exerciseState("row", 0, "current"),
        exerciseState("pulldown", 1, "todo"),
        exerciseState("curl", 2, "todo"),
      ],
      "session:row",
    );
    const afterMachineJump = jumpToExercise(afterFinalSet, "session:curl");

    await database.transaction(
      "rw",
      database.sessions,
      database.exerciseStates,
      async () => {
        await database.sessions.add(session);
        await database.exerciseStates.bulkAdd(afterMachineJump);
      },
    );
    database.close();

    const reopened = new WorkoutDatabase(name);
    await reopened.open();
    expect(await reopened.sessions.get(session.id)).toMatchObject({
      activeRestEndTimestamp: 181_000,
      activeRestExerciseId: "row",
    });
    expect(
      (await reopened.exerciseStates.get("session:curl"))?.status,
    ).toBe("current");
    reopened.close();
  });
});
