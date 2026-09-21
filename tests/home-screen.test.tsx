import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeScreen } from "../app/WorkoutApp";

describe("home screen", () => {
  it("shows the isolated one-minute native timer test above the workouts", () => {
    const markup = renderToStaticMarkup(
      <HomeScreen
        onStart={vi.fn()}
        activeSessions={[]}
        sets={[]}
      />,
    );

    expect(markup).toContain("Native timer test");
    expect(markup).toContain("Start 1-min timer");
    expect(markup).toContain("Workout Rest Timer");
    expect(markup).toContain("Start Timer for Shortcut Input seconds");
    expect(markup.indexOf("Start 1-min timer")).toBeLessThan(
      markup.indexOf("MONDAY"),
    );
  });
});
