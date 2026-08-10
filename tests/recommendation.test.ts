import { describe, expect, it } from "vitest";
import { recommendFromObservation } from "../lib/recommendation";

const result = (reps: number) =>
  recommendFromObservation(
    {
      actualWeight: 100,
      weightUnit: "lb",
      weightKg: 45.359237,
      actualReps: reps,
    },
    8,
    12,
    5,
    "lb",
  );

describe("weight recommendation heuristic", () => {
  it("subtracts one increment below the rep range", () => {
    expect(result(7)).toBe(95);
  });

  it("keeps the same weight inside the inclusive range", () => {
    expect(result(8)).toBe(100);
    expect(result(10)).toBe(100);
    expect(result(12)).toBe(100);
  });

  it("adds one increment above the rep range", () => {
    expect(result(13)).toBe(105);
  });
});
