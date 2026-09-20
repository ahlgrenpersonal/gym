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

  it("preserves a longer active cooldown after an alternating set", () => {
    expect(
      restUpdateAfterSet({
        exerciseFinished: true,
        exerciseId: "abdominal_crunch_machine",
        restSeconds: 90,
        timestamp: 31_000,
        activeRestEndTimestamp: 181_000,
        activeRestExerciseId: "shoulder_press",
        preserveLongerRest: true,
      }),
    ).toEqual({
      activeRestEndTimestamp: 181_000,
      activeRestExerciseId: "shoulder_press",
    });
  });

  it("starts or extends cooldown when the alternating set ends later", () => {
    expect(
      restUpdateAfterSet({
        exerciseFinished: false,
        exerciseId: "abdominal_crunch_machine",
        restSeconds: 90,
        timestamp: 31_000,
        activeRestEndTimestamp: null,
        activeRestExerciseId: null,
        preserveLongerRest: true,
      }),
    ).toEqual({
      activeRestEndTimestamp: 121_000,
      activeRestExerciseId: "abdominal_crunch_machine",
    });

    expect(
      restUpdateAfterSet({
        exerciseFinished: false,
        exerciseId: "abdominal_crunch_machine",
        restSeconds: 90,
        timestamp: 31_000,
        activeRestEndTimestamp: 100_000,
        activeRestExerciseId: "shoulder_press",
        preserveLongerRest: true,
      }),
    ).toEqual({
      activeRestEndTimestamp: 121_000,
      activeRestExerciseId: "abdominal_crunch_machine",
    });
  });
});
