import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkoutScreen, WorkoutSummary } from "../app/WorkoutApp";
import type { WorkoutExerciseState, WorkoutSession } from "../lib/models";

function state(
  id: string,
  name: string,
  order: number,
  status: WorkoutExerciseState["status"],
): WorkoutExerciseState {
  return {
    id: `session:${id}`,
    sessionId: "session",
    exerciseId: id,
    order,
    status,
    exerciseName: name,
    minReps: 8,
    maxReps: 12,
    targetSets: 3,
    restSeconds: 180,
    incrementLb: 5,
    imageKey: id,
  };
}

const session: WorkoutSession = {
  id: "session",
  workoutType: "pull",
  status: "active",
  startTimestamp: 500,
  exerciseOrder: ["chest_supported_row", "lat_pulldown"],
  activeRestEndTimestamp: 181_000,
  activeRestExerciseId: "chest_supported_row",
};

const noop = () => undefined;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistent cooldown display", () => {
  it("shows the same countdown before and after switching machines", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const renderWorkout = (states: WorkoutExerciseState[]) =>
      renderToStaticMarkup(
        <WorkoutScreen
          session={session}
          states={states}
          sets={[]}
          unit="lb"
          suggestedWeight={80}
          weightSuggestionSource="previous_workout"
          usingDefaultWeight={false}
          draftWeight="80"
          draftReps=""
          error=""
          onWeightChange={noop}
          onRepsChange={noop}
          onCompleteSet={noop}
          onDefer={noop}
          onJump={noop}
          onRestAdjust={noop}
          onRestSkip={noop}
          onExit={noop}
        />,
      );

    const onRow = renderWorkout([
      state("chest_supported_row", "Seated Row Machine", 0, "current"),
      state("lat_pulldown", "Lat Pulldown", 1, "todo"),
    ]);
    const onPulldown = renderWorkout([
      state("chest_supported_row", "Seated Row Machine", 0, "todo"),
      state("lat_pulldown", "Lat Pulldown", 1, "current"),
    ]);

    expect(onRow).toContain("RESTING");
    expect(onRow).toContain("3:00");
    expect(onPulldown).toContain("RESTING");
    expect(onPulldown).toContain("3:00");
  });

  it("shows the final cooldown on the completed-workout summary", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const completedSession = {
      ...session,
      status: "completed" as const,
      finishTimestamp: 1_000,
    };
    const markup = renderToStaticMarkup(
      <WorkoutSummary
        session={completedSession}
        sessions={[completedSession]}
        states={[
          state("chest_supported_row", "Seated Row Machine", 0, "complete"),
          state("lat_pulldown", "Lat Pulldown", 1, "complete"),
        ]}
        sets={[]}
        unit="lb"
        onRestAdjust={noop}
        onRestSkip={noop}
        onDone={noop}
      />,
    );

    expect(markup).toContain("WORKOUT SAVED");
    expect(markup).toContain("RESTING");
    expect(markup).toContain("3:00");
  });
});
