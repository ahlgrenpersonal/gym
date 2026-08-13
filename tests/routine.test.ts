import { describe, expect, it } from "vitest";
import { DEFAULT_EXERCISES, IMAGE_CROPS } from "../lib/exercises";

describe("default workout routine", () => {
  it("keeps Pull to four complementary exercises", () => {
    const pull = DEFAULT_EXERCISES.filter(
      (exercise) => exercise.workoutType === "pull",
    );

    expect(pull.map((exercise) => exercise.id)).toEqual([
      "lat_pulldown",
      "chest_supported_row",
      "reverse_pec_deck",
      "preacher_or_cable_curl",
    ]);
  });

  it("prescribes three direct low-cable biceps sets with the correct image", () => {
    const curl = DEFAULT_EXERCISES.find(
      (exercise) => exercise.id === "preacher_or_cable_curl",
    );

    expect(curl).toMatchObject({
      name: "Low Cable Biceps Curl",
      targetSets: 3,
      minReps: 10,
      maxReps: 15,
    });
    expect(IMAGE_CROPS.preacher_or_cable_curl.asset).toBe(
      "workout-low-cable-biceps-curl.png",
    );
  });
});
