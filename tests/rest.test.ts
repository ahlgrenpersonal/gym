import { describe, expect, it } from "vitest";
import { restUpdateAfterSet } from "../lib/rest";

describe("rest timer transitions", () => {
  it("starts rest after a set when the athlete remains on the same exercise", () => {
    expect(
      restUpdateAfterSet({
        exerciseFinished: false,
        exerciseId: "lat_pulldown",
        restSeconds: 180,
        timestamp: 1_000,
      }),
    ).toEqual({
      activeRestEndTimestamp: 181_000,
      activeRestExerciseId: "lat_pulldown",
    });
  });

  it("also starts rest after the final set on a machine", () => {
    expect(
      restUpdateAfterSet({
        exerciseFinished: true,
        exerciseId: "lat_pulldown",
        restSeconds: 180,
        timestamp: 1_000,
      }),
    ).toEqual({
      activeRestEndTimestamp: 181_000,
      activeRestExerciseId: "lat_pulldown",
    });
  });
});
