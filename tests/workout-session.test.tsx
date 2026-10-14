import "fake-indexeddb/auto";
import Dexie from "dexie";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { HomeScreen, WorkoutScreen } from "../app/WorkoutApp";
import { ensureDefaults, WorkoutDatabase } from "../lib/db";
import { DEFAULT_EXERCISES, workoutExercises } from "../lib/exercises";
import { localDateKey, toLocalIso } from "../lib/local-date";
import type { SetRecord, WorkoutSession } from "../lib/models";
import { createWorkoutQueue, deferCurrentExercise } from "../lib/queue";
import { activeSessionsForLocalDay, completedWorkoutTypesForLocalWeek, sessionHasLoggedSets } from "../lib/today-sessions";
import { openWorkoutSession } from "../lib/workout-session";

const now = new Date(2026, 9, 14, 8).getTime();
const databases: WorkoutDatabase[] = [];
const noop = () => undefined;

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});

async function database() {
  const result = new WorkoutDatabase(`preview-${crypto.randomUUID()}`);
  databases.push(result);
  await ensureDefaults(result);
  return result;
}

function session(id = "preview", timestamp = now - 60_000): WorkoutSession {
  return { id, workoutType: "wednesday", status: "active", startTimestamp: timestamp,
    localDate: localDateKey(timestamp), startLocalDateTime: toLocalIso(timestamp),
    exerciseOrder: ["leg_press", "incline_chest_press"],
    activeRestEndTimestamp: now + 180_000, activeRestExerciseId: "leg_press" };
}

function record(workout: WorkoutSession, exerciseId = "incline_chest_press"): SetRecord {
  return { id: `${workout.id}-set`, sessionId: workout.id, workoutType: workout.workoutType,
    exerciseId, exerciseName: exerciseId, setNumber: 1, actualWeight: 80,
    weightUnit: "lb", weightKg: 36.287, actualReps: 12, timestamp: now };
}

async function seedOldPlan(db: WorkoutDatabase, workout: WorkoutSession) {
  const definitions = workout.exerciseOrder.map((id) => DEFAULT_EXERCISES.find((e) => e.id === id)!);
  const queue = createWorkoutQueue(definitions, workout.id);
  const deferred = deferCurrentExercise(queue, queue[0].id);
  await db.sessions.add(workout);
  await db.exerciseStates.bulkAdd(deferred);
  return deferred;
}

function home(sessions: WorkoutSession[], sets: SetRecord[]) {
  return renderToStaticMarkup(<HomeScreen onStart={noop}
    completedWorkoutTypes={completedWorkoutTypesForLocalWeek(sessions, now)}
    activeSessions={activeSessionsForLocalDay(sessions, now)} sets={sets} />);
}

describe("opening a workout versus starting it", () => {
  it("does not label an empty day in progress, even if another day has sets", () => {
    const draft = session();
    const other = { ...session("other"), workoutType: "tuesday" as const };
    expect(sessionHasLoggedSets(draft.id, [record(other)])).toBe(false);
    const markup = home([draft], [record(other)]);
    expect(markup).not.toContain("IN PROGRESS");
    expect(markup).not.toContain("tap to resume");
    expect(markup).toContain('class="choice-number">03</span>');
  });

  it.each(["incline_chest_press", "abdominal_crunch_machine"])(
    "the first logged %s set marks only that day in progress", (exerciseId) => {
      const started = session("started");
      const newerDraft = session("empty", now);
      const tuesday = { ...session("tuesday"), workoutType: "tuesday" as const };
      const sets = [record(started, exerciseId)];
      expect(sessionHasLoggedSets(started.id, sets)).toBe(true);
      const markup = home([started, newerDraft, tuesday], sets);
      expect(markup.match(/IN PROGRESS/g)).toHaveLength(1);
      expect(markup).toContain("1 set logged · tap to resume");
      expect(markup).not.toContain("0 sets logged");
    },
  );

  it.each([false, true])("workout heading reflects saved sets (started: %s)", (started) => {
    const workout = session();
    const markup = renderToStaticMarkup(<WorkoutScreen session={workout}
      states={createWorkoutQueue(workoutExercises(DEFAULT_EXERCISES, "wednesday"), workout.id)}
      sets={started ? [record(workout)] : []} unit="lb" suggestedWeight={80}
      weightSuggestionSource="none" usingDefaultWeight={true} draftWeight="80" draftReps=""
      error="" onWeightChange={noop} onRepsChange={noop} onCompleteSet={noop}
      onDefer={noop} onJump={noop} onRestAdjust={noop} onRestSkip={noop} onExit={noop} />);
    expect(markup).toContain(started ? "WORKOUT IN PROGRESS" : "READY TO START");
    expect(markup).toContain(`class="live-pill">${started ? "LIVE" : "PREVIEW"}</span>`);
  });

  it("refreshes an existing empty Wednesday to leg-press-last, including ALT and settings", async () => {
    const db = await database();
    const draft = session();
    await seedOldPlan(db, draft);
    await db.exercises.update("shoulder_press", { restSeconds: 195 });
    const opened = await openWorkoutSession(db, "wednesday", now);
    expect(opened.id).toBe(draft.id);
    expect(opened.exerciseOrder).toEqual([
      "incline_chest_press", "shoulder_press", "abdominal_crunch_machine",
      "lateral_raise", "overhead_triceps_extension", "leg_press",
    ]);
    expect(opened.activeRestEndTimestamp).toBeNull();
    expect(opened.activeRestExerciseId).toBeNull();
    expect(opened.startTimestamp).toBe(now);
    const expected = createWorkoutQueue(workoutExercises(await db.exercises.toArray(), "wednesday"), draft.id);
    db.close();
    await db.open();
    expect(await db.sessions.get(draft.id)).toEqual(opened);
    expect((await db.exerciseStates.where("sessionId").equals(draft.id).toArray())
      .sort((a, b) => a.order - b.order)).toEqual(expected);
    expect(expected.find((s) => s.exerciseId === "abdominal_crunch_machine"))
      .toMatchObject({ alternatesWithExerciseId: "shoulder_press", targetSets: 2 });
    expect(expected.find((s) => s.exerciseId === "shoulder_press")?.restSeconds).toBe(195);
    await openWorkoutSession(db, "wednesday", now + 1_000);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.exerciseStates.count()).toBe(expected.length);
    expect(await db.sets.count()).toBe(0);
  });

  it.each(["incline_chest_press", "abdominal_crunch_machine"])(
    "preserves order, queue, timestamps, cooldown and history after a %s log", async (exerciseId) => {
      const db = await database();
      const started = session("started");
      const states = await seedOldPlan(db, started);
      const saved = record(started, exerciseId);
      await db.sets.add(saved);
      const draft = session("newer-empty", now);
      await seedOldPlan(db, draft);
      const allSessions = await db.sessions.toArray();
      const allStates = await db.exerciseStates.toArray();
      expect(await openWorkoutSession(db, "wednesday", now + 60_000)).toEqual(started);
      expect(await db.sessions.toArray()).toEqual(allSessions);
      expect(await db.exerciseStates.toArray()).toEqual(allStates);
      expect((await db.exerciseStates.where("sessionId").equals(started.id).toArray())
        .sort((a, b) => a.order - b.order)).toEqual(states);
      expect(await db.sets.toArray()).toEqual([saved]);
    },
  );

  it("never reuses or rewrites yesterday's, completed, or archived workouts", async () => {
    const db = await database();
    const yesterday = session("yesterday", new Date(2026, 9, 13, 8).getTime());
    const completed = { ...session("completed"), status: "completed" as const };
    const archived = { ...session("archived"), status: "archived" as const };
    for (const old of [yesterday, completed, archived]) await seedOldPlan(db, old);
    const previousStates = await db.exerciseStates.toArray();
    const opened = await openWorkoutSession(db, "wednesday", now);
    expect(opened.exerciseOrder.at(-1)).toBe("leg_press");
    expect(opened.localDate).toBe("2026-10-14");
    for (const old of [yesterday, completed, archived]) {
      expect(opened.id).not.toBe(old.id);
      expect(await db.sessions.get(old.id)).toEqual(old);
    }
    for (const state of previousStates) expect(await db.exerciseStates.get(state.id)).toEqual(state);
  });

  it("serializes simultaneous opens and keeps different days independent", async () => {
    const db = await database();
    const [first, second] = await Promise.all([
      openWorkoutSession(db, "wednesday", now), openWorkoutSession(db, "wednesday", now),
    ]);
    expect(first.id).toBe(second.id);
    expect(await db.sessions.count()).toBe(1);
    const tuesday = await openWorkoutSession(db, "tuesday", now);
    expect(tuesday.id).not.toBe(first.id);
    const saved = record(first);
    await db.sets.add(saved);
    expect(await openWorkoutSession(db, "wednesday", now + 60_000)).toEqual(first);
    expect(await db.sets.toArray()).toEqual([saved]);
    expect(await db.sessions.count()).toBe(2);
    expect(home(await db.sessions.toArray(), [saved]).match(/IN PROGRESS/g)).toHaveLength(1);
  });

  it("keeps completion visible through an empty preview and a separately logged repeat", async () => {
    const db = await database();
    const original: WorkoutSession = { ...session("completed"), status: "completed", finishTimestamp: now - 1 };
    const originalQueue = await seedOldPlan(db, original);
    const originalSet = { ...record(original), timestamp: now - 1 };
    await db.sets.add(originalSet);

    const repeat = await openWorkoutSession(db, "wednesday", now);
    expect(repeat.id).not.toBe(original.id);
    expect(repeat.status).toBe("active");
    expect(await db.sets.where("sessionId").equals(repeat.id).count()).toBe(0);
    const previewMenu = home(await db.sessions.toArray(), await db.sets.toArray());
    expect(previewMenu.match(/COMPLETED THIS WEEK/g)).toHaveLength(1);
    expect(previewMenu).not.toContain("IN PROGRESS");

    const repeatSet = record(repeat);
    await db.sets.add(repeatSet);
    expect(await openWorkoutSession(db, "wednesday", now)).toEqual(repeat);
    const repeatMenu = home(await db.sessions.toArray(), await db.sets.toArray());
    expect(repeatMenu).toContain("COMPLETED THIS WEEK · IN PROGRESS");
    expect(repeatMenu).toContain("1 set logged · tap to resume");
    expect(await db.sessions.get(original.id)).toEqual(original);
    expect(await db.sets.get(originalSet.id)).toEqual(originalSet);
    expect((await db.exerciseStates.where("sessionId").equals(original.id).toArray())
      .sort((a, b) => a.order - b.order)).toEqual(originalQueue);
    expect(await db.sessions.count()).toBe(2);
    expect(await db.sets.count()).toBe(2);
    expect(repeat.exerciseOrder.at(-1)).toBe("leg_press");
  });
});
