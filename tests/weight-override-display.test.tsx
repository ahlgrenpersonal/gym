import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkoutScreen } from "../app/WorkoutApp";
import { DEFAULT_EXERCISES } from "../lib/exercises";

const noop = () => undefined;

describe("explicit weight override display", () => {
  it("labels a dated override separately from remembered workout weights", () => {
    const exercise = DEFAULT_EXERCISES.find((item) => item.id === "lat_pulldown")!;
    const markup = renderToStaticMarkup(
      <WorkoutScreen
        session={{ id: "current", workoutType: "tuesday", status: "active", startTimestamp: 0, exerciseOrder: [exercise.id] }}
        states={[{ ...exercise, id: "current:lat_pulldown", sessionId: "current", exerciseId: exercise.id, exerciseName: exercise.name, status: "current" }]}
        sets={[]}
        unit="lb"
        suggestedWeight={110}
        weightSuggestionSource="program_override"
        weightOverrideDate="2026-10-10"
        usingDefaultWeight={false}
        draftWeight="110"
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
    expect(markup).toContain("WEIGHT OVERRIDE");
    expect(markup).toContain("Program override from 2026-10-10");
    expect(markup).toContain("110 lb");
    expect(markup).toContain("your logged weights carry forward");
    expect(markup).not.toContain("Copied from set 2");
  });
});
