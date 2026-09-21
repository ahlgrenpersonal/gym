import { describe, expect, it } from "vitest";
import {
  WORKOUT_TIMER_SHORTCUT_NAME,
  workoutTimerShortcutUrl,
} from "../lib/native-timer";

describe("native workout timer Shortcut", () => {
  it("passes a cooldown duration and return callbacks to the named Shortcut", () => {
    const url = workoutTimerShortcutUrl({
      seconds: 60,
      returnUrl: "https://ahlgrenpersonal.github.io/gym/",
    });

    expect(WORKOUT_TIMER_SHORTCUT_NAME).toBe("Workout Rest Timer");
    expect(url).toContain("shortcuts://x-callback-url/run-shortcut");
    expect(url).toContain("name=Workout%20Rest%20Timer");
    expect(url).toContain("input=text&text=60");
    expect(url).toContain(
      "x-success=https%3A%2F%2Fahlgrenpersonal.github.io%2Fgym%2F",
    );
    expect(url).toContain(
      "x-cancel=https%3A%2F%2Fahlgrenpersonal.github.io%2Fgym%2F",
    );
    expect(url).toContain(
      "x-error=https%3A%2F%2Fahlgrenpersonal.github.io%2Fgym%2F",
    );
  });
});
