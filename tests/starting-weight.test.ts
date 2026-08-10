import { describe, expect, it } from "vitest";
import { defaultStartingWeight } from "../lib/starting-weight";

describe("default starting weight", () => {
  it("starts at 100 lb when pounds are selected", () => {
    expect(defaultStartingWeight("lb")).toBe(100);
  });

  it("uses the 100 lb equivalent when kilograms are selected", () => {
    expect(defaultStartingWeight("kg")).toBe(45.5);
  });
});
