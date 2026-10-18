import "fake-indexeddb/auto";
import Dexie from "dexie";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkoutScreen } from "../app/WorkoutApp";
import { ensureDefaults, WorkoutDatabase } from "../lib/db";
import { DEFAULT_EXERCISES, workoutExercises } from "../lib/exercises";
import type { SetRecord, WorkoutExerciseState, WorkoutSession, WorkoutType } from "../lib/models";
import { completeCurrentExercise, createWorkoutQueue, deferCurrentExercise, jumpToExercise, queueIsComplete } from "../lib/queue";
import { toKg } from "../lib/recommendation";
import { restUpdateAfterSet } from "../lib/rest";
import { fillForwardWeight } from "../lib/weight-fill-forward";

const databases: WorkoutDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});

function session(day: WorkoutType): WorkoutSession {
  return { id: "test-session", workoutType: day, status: "active",
    startTimestamp: 1_000, localDate: "2026-10-14", exerciseOrder: [] };
}
function queue(day: WorkoutType) {
  return createWorkoutQueue(workoutExercises(DEFAULT_EXERCISES, day), "test-session");
}
const noop = () => undefined;
function render(states: WorkoutExerciseState[], workout: WorkoutSession) {
  return renderToStaticMarkup(<WorkoutScreen
    session={workout} states={states} sets={[]} unit="lb"
    suggestedWeight={undefined} weightSuggestionSource="none" usingDefaultWeight={true}
    draftWeight="" draftReps="" error=""
    onWeightChange={noop} onRepsChange={noop} onCompleteSet={noop}
    onDefer={noop} onJump={noop} onRestAdjust={noop} onRestSkip={noop} onExit={noop}
  />);
}

describe("multiple alternating sets", () => {
  it.each(["monday", "tuesday", "thursday", "friday"] as const)(
    "%s snapshots and renders both ALT siblings immediately below their anchor", (day) => {
      const states = queue(day);
      const alts = states.filter((state) => state.alternatesWithExerciseId);
      expect(alts).toHaveLength(2);
      expect(alts.map((state) => state.targetSets)).toEqual([1, 2]);
      const anchor = states.findIndex((state) => state.exerciseId === alts[0].alternatesWithExerciseId);
      expect(states.slice(anchor + 1, anchor + 3)).toEqual(alts);
      expect(alts[1].alternatesWithExerciseId).toBe(alts[0].alternatesWithExerciseId);
      // Rendering sorts by stored order, not input array order.
      const markup = render([...states].reverse(), session(day));
      const labels = [...markup.matchAll(/<button aria-label="([^"]+)" class="queue-row/g)]
        .map((match) => match[1]);
      expect(labels).toEqual(states.map((state) => `${state.exerciseName}${state.alternatesWithExerciseId ? ", alternating exercise" : ""}`));
      expect(markup.match(/class="queue-alt-label"/g)).toHaveLength(2);
      expect(markup).not.toContain("queue-alternating");
    },
  );

  it("keeps Wednesday's two abs sets in one row with the correct target", () => {
    const states = queue("wednesday");
    const alts = states.filter((state) => state.alternatesWithExerciseId);
    expect(alts).toHaveLength(1);
    expect(alts[0]).toMatchObject({ exerciseId: "abdominal_crunch_machine", targetSets: 2 });
    expect(render(states, session("wednesday"))).toContain('class="queue-count">0/2');
  });

  it("returns to the last-used main after two ALT sets across a database reopen, preserving rest", async () => {
    const database = new WorkoutDatabase(`alt-return-${crypto.randomUUID()}`);
    databases.push(database);
    await ensureDefaults(database);
    const workout = { ...session("wednesday"),
      activeRestEndTimestamp: 181_000, activeRestExerciseId: "shoulder_press" };
    await database.sessions.add(workout);
    const absId = `${workout.id}:abdominal_crunch_machine`;
    const mainId = `${workout.id}:shoulder_press`;
    const states = jumpToExercise(queue("wednesday"), absId);
    await database.exerciseStates.bulkPut(states);
    const mainSet: SetRecord = { id: "main-set", sessionId: workout.id, workoutType: "wednesday",
      exerciseId: "shoulder_press", exerciseName: "Shoulder Press", setNumber: 1,
      actualWeight: 70, weightUnit: "lb", weightKg: toKg(70, "lb"), actualReps: 12, timestamp: 1_000 };
    const firstAlt: SetRecord = { ...mainSet, id: "abs-1", exerciseId: "abdominal_crunch_machine",
      exerciseName: "Abs", timestamp: 2_000 };
    await database.sets.bulkAdd([mainSet, firstAlt]);
    // Logging an intermediate ALT set does not finish the exercise or advance.
    expect((await database.exerciseStates.get(absId))?.status).toBe("current");
    database.close();
    await database.open();
    const savedSets = await database.sets.toArray();
    const savedStates = await database.exerciseStates.where("sessionId").equals(workout.id).toArray();
    const next = completeCurrentExercise(savedStates, absId, savedSets);
    await database.exerciseStates.bulkPut(next);
    await database.sets.add({ ...firstAlt, id: "abs-2", setNumber: 2, timestamp: 3_000 });
    await database.sessions.update(workout.id, restUpdateAfterSet({ exerciseId: firstAlt.exerciseId,
      restSeconds: 90, timestamp: 3_000, exerciseFinished: true, suppressRest: true }));
    expect((await database.exerciseStates.get(absId))?.status).toBe("complete");
    expect((await database.exerciseStates.get(mainId))?.status).toBe("current");
    expect(await database.sessions.get(workout.id)).toEqual(workout);
    expect(await database.sets.get(mainSet.id)).toEqual(mainSet);
    expect(await database.sets.get(firstAlt.id)).toEqual(firstAlt);
    expect(await database.sets.count()).toBe(3);
  });

  it("lets either ALT be chosen/deferred without losing the anchor or other ALT", () => {
    let states = queue("tuesday");
    const anchorId = "test-session:reverse_pec_deck";
    const absId = "test-session:abdominal_crunch_machine";
    const curlId = "test-session:seated_leg_curl";
    states = jumpToExercise(states, anchorId);
    states = jumpToExercise(states, absId);
    states = deferCurrentExercise(states, absId);
    expect(states.find((state) => state.id === absId)?.status).toBe("deferred");
    expect(states.find((state) => state.id === curlId)?.status).toBe("current");
    states = completeCurrentExercise(states, curlId);
    expect(states.find((state) => state.id === anchorId)?.status).toBe("todo");
    expect(queueIsComplete(states)).toBe(false);
    states = jumpToExercise(states, anchorId);
    states = jumpToExercise(states, absId);
    states = completeCurrentExercise(states, absId);
    expect(states.find((state) => state.id === curlId)?.status).toBe("complete");
    expect(states.find((state) => state.id === absId)?.status).toBe("complete");
    expect(states.filter((state) => state.status === "current")).toHaveLength(1);
    expect(queueIsComplete(states)).toBe(false);
  });

  it.each(["monday", "tuesday", "wednesday", "thursday", "friday"] as const)(
    "%s: every ALT set leaves active, expired, or absent rest unchanged", (day) => {
      for (const initialRest of [
        { activeRestEndTimestamp: 181_000, activeRestExerciseId: "shoulder_press" },
        { activeRestEndTimestamp: 5_000, activeRestExerciseId: "reverse_pec_deck" },
        { activeRestEndTimestamp: null, activeRestExerciseId: null },
        {},
      ]) {
        let rest = { ...initialRest };
        for (const alt of queue(day).filter((state) => state.alternatesWithExerciseId)) {
          for (let set = 1; set <= alt.targetSets; set++) {
            const update = restUpdateAfterSet({ exerciseId: alt.exerciseId,
              restSeconds: alt.restSeconds, timestamp: 60_000 * set,
              exerciseFinished: set === alt.targetSets,
              suppressRest: alt.alternatesWithExerciseId !== undefined });
            expect(update).toEqual({});
            rest = { ...rest, ...update };
            expect(rest).toEqual(initialRest);
          }
        }
      }
    },
  );

  it("shows the leg-curl visual, manual load prompt and no-added-cooldown label", () => {
    const states = jumpToExercise(queue("tuesday"), "test-session:seated_leg_curl");
    const markup = render(states, session("tuesday"));
    expect(markup).toContain("workout-seated-leg-curl.svg");
    expect(markup).toContain("Choose a starting weight");
    expect(markup).toContain("ALT · no added cooldown");
    expect(markup).not.toContain("Starting point: 100");
    expect(markup).not.toContain("Rest 2:00");
  });

  it("adds the new definition without altering existing prescriptions, history or active snapshots", async () => {
    const database = new WorkoutDatabase(`alt-upgrade-${crypto.randomUUID()}`);
    databases.push(database);
    await database.open();
    // Simulate the prior release (no seated curl), including user custom settings.
    await database.exercises.delete("seated_leg_curl");
    await database.exercises.update("shoulder_press", { restSeconds: 195 });
    const oldExercises = await database.exercises.toArray();
    const oldSession = { ...session("tuesday"), exerciseOrder: ["reverse_pec_deck", "single_leg_extension"],
      activeRestEndTimestamp: 181_000, activeRestExerciseId: "reverse_pec_deck" };
    const oldStates = createWorkoutQueue([
      { ...DEFAULT_EXERCISES.find((exercise) => exercise.id === "reverse_pec_deck")!, targetSets: 2 },
      { ...DEFAULT_EXERCISES.find((exercise) => exercise.id === "single_leg_extension")!,
        targetSets: 1, alternatesWithExerciseId: "reverse_pec_deck" },
    ], oldSession.id);
    const oldSet: SetRecord = { id: "old-set", sessionId: oldSession.id, workoutType: "tuesday",
      exerciseId: "reverse_pec_deck", exerciseName: "Reverse Pec Deck", setNumber: 1,
      actualWeight: 80, weightUnit: "lb", weightKg: toKg(80, "lb"), actualReps: 10, timestamp: 2_000 };
    await database.sessions.add(oldSession);
    await database.exerciseStates.bulkAdd(oldStates);
    await database.sets.add(oldSet);
    await ensureDefaults(database);
    await ensureDefaults(database); // Repair must be idempotent.
    expect(database.verno).toBe(12);
    expect(await database.exercises.count()).toBe(oldExercises.length + 1);
    for (const exercise of oldExercises) expect(await database.exercises.get(exercise.id)).toEqual(exercise);
    expect(await database.sessions.toArray()).toEqual([oldSession]);
    expect((await database.exerciseStates.toArray()).sort((a, b) => a.order - b.order)).toEqual(oldStates);
    expect(await database.sets.toArray()).toEqual([oldSet]);
    const nextQueue = createWorkoutQueue(workoutExercises(await database.exercises.toArray(), "thursday"), "new-session");
    await database.exerciseStates.bulkAdd(nextQueue);
    database.close();
    await database.open();
    expect((await database.exerciseStates.where("sessionId").equals("new-session").toArray())
      .sort((a, b) => a.order - b.order)).toEqual(nextQueue);
    expect(nextQueue.filter((state) => state.alternatesWithExerciseId).map((state) => state.exerciseId))
      .toEqual(["abdominal_crunch_machine", "seated_leg_curl"]);
  });

  it("leaves the first leg-curl load unprescribed, then remembers an actual logged load", () => {
    const first = session("tuesday");
    const exercise = DEFAULT_EXERCISES.find((item) => item.id === "seated_leg_curl")!;
    expect(exercise.defaultWeightLb).toBeUndefined();
    const input = { sessions: [first], sets: [] as SetRecord[], currentSessionId: first.id,
      exerciseId: exercise.id, displayUnit: "lb" as const, programWeightLb: exercise.defaultWeightLb };
    expect(fillForwardWeight(input)).toEqual({ source: "none" });
    const recorded: SetRecord = { id: "curl-set", sessionId: first.id, workoutType: "tuesday",
      exerciseId: exercise.id, exerciseName: exercise.name, setNumber: 1,
      actualWeight: 25, weightUnit: "lb", weightKg: toKg(25, "lb"), actualReps: 12, timestamp: 2_000 };
    expect(fillForwardWeight({ ...input, sets: [recorded] })).toEqual({ weight: 25, source: "previous_set" });
    const next = { ...first, id: "next", startTimestamp: 10_000, localDate: "2026-10-16" };
    expect(fillForwardWeight({ ...input, sessions: [first, next], sets: [recorded], currentSessionId: next.id }))
      .toEqual({ weight: 25, source: "previous_workout" });
  });

  it.each([false, true])("persists consecutive ALT logs without touching rest (reverse order: %s)", async (reverse) => {
    const database = new WorkoutDatabase(`alt-rest-${crypto.randomUUID()}`);
    databases.push(database);
    await ensureDefaults(database);
    const original = { ...session("tuesday"),
      activeRestEndTimestamp: 181_000, activeRestExerciseId: "reverse_pec_deck" };
    await database.sessions.add(original);
    let states = queue("tuesday");
    const alts = states.filter((state) => state.alternatesWithExerciseId);
    if (reverse) alts.reverse();
    for (const [index, alt] of alts.entries()) {
      states = jumpToExercise(states, alt.id);
      for (let setNumber = 1; setNumber <= alt.targetSets; setNumber++) {
        const exerciseFinished = setNumber === alt.targetSets;
        const timestamp = 60_000 * (index * 2 + setNumber);
        if (exerciseFinished) states = completeCurrentExercise(states, alt.id);
        await database.transaction("rw", database.sessions, database.exerciseStates, database.sets, async () => {
          await database.sets.add({ id: `alt-${index}-${setNumber}`, sessionId: original.id, workoutType: "tuesday",
            exerciseId: alt.exerciseId, exerciseName: alt.exerciseName, setNumber,
            actualWeight: 25, weightUnit: "lb", weightKg: toKg(25, "lb"), actualReps: 10, timestamp });
          await database.exerciseStates.bulkPut(states);
          await database.sessions.update(original.id, restUpdateAfterSet({ exerciseId: alt.exerciseId,
            exerciseFinished, restSeconds: alt.restSeconds, timestamp,
            suppressRest: alt.alternatesWithExerciseId !== undefined }));
        });
        expect((await database.exerciseStates.get(alt.id))?.status)
          .toBe(exerciseFinished ? "complete" : "current");
        expect(await database.sessions.get(original.id)).toEqual(original);
      }
    }
    database.close();
    await database.open();
    expect(await database.sessions.get(original.id)).toEqual(original);
    expect(await database.sets.count()).toBe(3);
    for (const alt of alts) expect((await database.exerciseStates.get(alt.id))?.status).toBe("complete");
  });
});
