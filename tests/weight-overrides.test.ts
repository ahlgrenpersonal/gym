import { describe, expect, it } from "vitest";
import { DEFAULT_EXERCISES } from "../lib/exercises";
import { latestWeightOverride, WEIGHT_OVERRIDES } from "../lib/weight-overrides";

describe("dated weight override map", () => {
  it("keeps legacy weight baselines unchanged: prescribe new weights in WEIGHT_OVERRIDES", () => {
    // Independent fixture: deriving expected weights from DEFAULT_EXERCISES would
    // silently accept the very edits this guardrail is meant to catch.
    const legacyWeights = {
      incline_chest_press: [80, "2026-09-10"],
      shoulder_press: [70, "2026-09-10"],
      lateral_raise: [10, "2026-09-03"],
      triceps_pushdown: [40, "2026-09-03"],
      overhead_triceps_extension: [30, "2026-09-03"],
      lat_pulldown: [90, "2026-09-03"],
      chest_supported_row: [120, "2026-09-10"],
      reverse_pec_deck: [70, "2026-09-10"],
      preacher_or_cable_curl: [30, "2026-09-03"],
      leg_press: [140, "2026-09-03"],
      single_leg_extension: [60, "2026-09-03"],
      abdominal_crunch_machine: [100, "2026-09-10"],
    } as const;
    for (const [id, [weight, date]] of Object.entries(legacyWeights)) {
      const exercise = DEFAULT_EXERCISES.find((item) => item.id === id);
      expect(
        exercise && [exercise.defaultWeightLb, exercise.defaultWeightEffectiveLocalDate],
        `${id}: preserve legacy weight defaults. Add a dated entry to WEIGHT_OVERRIDES in lib/weight-overrides.ts instead; see AGENTS.md.`,
      ).toEqual([weight, date]);
    }
  });

  it("contains valid calendar dates, known exercises, and nonnegative finite weights", () => {
    const exerciseIds = new Set(DEFAULT_EXERCISES.map((exercise) => exercise.id));
    for (const [date, weights] of Object.entries(WEIGHT_OVERRIDES)) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(date);
      expect(Object.keys(weights).length).toBeGreaterThan(0);
      for (const [id, weight] of Object.entries(weights)) {
        expect(exerciseIds.has(id)).toBe(true);
        expect(Number.isFinite(weight)).toBe(true);
        expect(weight).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("records exactly the two agreed October 10 overrides", () => {
    expect(WEIGHT_OVERRIDES["2026-10-10"]).toEqual({
      lat_pulldown: 110,
      preacher_or_cable_curl: 35,
    });
  });

  it("adds only the 120 lb pulldown override effective October 14", () => {
    expect(WEIGHT_OVERRIDES["2026-10-14"]).toEqual({ lat_pulldown: 120 });
    expect(latestWeightOverride("lat_pulldown", "2026-10-13")).toEqual({
      effectiveLocalDate: "2026-10-10", weightLb: 110,
    });
    expect(latestWeightOverride("lat_pulldown", "2026-10-14")).toEqual({
      effectiveLocalDate: "2026-10-14", weightLb: 120,
    });
    expect(latestWeightOverride("preacher_or_cable_curl", "2026-10-14")).toEqual({
      effectiveLocalDate: "2026-10-10", weightLb: 35,
    });
  });

  it("selects the newest effective entry per exercise regardless of insertion order", () => {
    const overrides = {
      "2026-11-01": { lat_pulldown: 120 },
      "2026-10-15": { preacher_or_cable_curl: 40 },
      "2026-10-10": { lat_pulldown: 110, preacher_or_cable_curl: 35 },
    };
    expect(latestWeightOverride("lat_pulldown", "2026-10-20", overrides)).toEqual({
      effectiveLocalDate: "2026-10-10", weightLb: 110,
    });
    expect(latestWeightOverride("lat_pulldown", "2026-11-01", overrides)).toEqual({
      effectiveLocalDate: "2026-11-01", weightLb: 120,
    });
    expect(latestWeightOverride("preacher_or_cable_curl", "2026-11-01", overrides)).toEqual({
      effectiveLocalDate: "2026-10-15", weightLb: 40,
    });
    expect(latestWeightOverride("lat_pulldown", "2026-10-09", overrides)).toBeUndefined();
    expect(latestWeightOverride("shoulder_press", "2026-11-01", overrides)).toBeUndefined();
  });

  it("allows an explicit zero-weight override", () => {
    expect(latestWeightOverride("leg_press", "2026-10-10", {
      "2026-10-10": { leg_press: 0 },
    })).toEqual({ effectiveLocalDate: "2026-10-10", weightLb: 0 });
  });

  it("adds only chest press and seated leg curl at 90 lb after the October 16 workout", () => {
    expect(WEIGHT_OVERRIDES["2026-10-17"]).toEqual({
      incline_chest_press: 90,
      seated_leg_curl: 90,
    });
    for (const id of ["incline_chest_press", "seated_leg_curl"]) {
      expect(latestWeightOverride(id, "2026-10-16")).toBeUndefined();
      expect(latestWeightOverride(id, "2026-10-17")).toEqual({
        effectiveLocalDate: "2026-10-17", weightLb: 90,
      });
    }
    expect(latestWeightOverride("lat_pulldown", "2026-10-17")?.weightLb).toBe(120);
    expect(latestWeightOverride("preacher_or_cable_curl", "2026-10-17")?.weightLb).toBe(35);
  });

});
