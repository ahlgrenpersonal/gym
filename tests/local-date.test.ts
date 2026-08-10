import { describe, expect, it } from "vitest";
import {
  localDateKey,
  millisecondsUntilNextLocalMidnight,
  toLocalIso,
} from "../lib/local-date";

describe("local date storage", () => {
  it("formats an ISO-style datetime using local calendar fields without a timezone suffix", () => {
    const timestamp = new Date(2026, 7, 7, 23, 4, 5, 6).getTime();
    expect(toLocalIso(timestamp)).toBe("2026-08-07T23:04:05.006");
    expect(localDateKey(timestamp)).toBe("2026-08-07");
  });

  it("calculates the actual delay until the next local midnight", () => {
    const timestamp = new Date(2026, 7, 7, 23, 59, 58, 500).getTime();
    expect(millisecondsUntilNextLocalMidnight(timestamp)).toBe(1_500);
  });
});
