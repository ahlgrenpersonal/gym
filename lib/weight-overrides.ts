/** Local calendar date (YYYY-MM-DD) -> exercise id -> starting weight in lb. */
export type WeightOverrides = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;

// Append new dates; keep previous entries so historical sessions stay consistent.
// This is a one-time starting suggestion per exercise, not a permanent weight lock.
export const WEIGHT_OVERRIDES: WeightOverrides = {
  "2026-10-10": {
    lat_pulldown: 110,
    preacher_or_cable_curl: 35,
  },
  // Follow the October 13 workout; this machine's next available step is 120 lb.
  "2026-10-14": {
    lat_pulldown: 120,
  },
  // Follow the October 16 workout; leg curl is a provisional calibration load.
  "2026-10-17": {
    incline_chest_press: 90,
    seated_leg_curl: 90,
  },
  // Follow the October 23 training week; leg curl remains a calibration load.
  "2026-10-24": {
    seated_leg_curl: 120,
    preacher_or_cable_curl: 40,
  },
};

export interface WeightOverride {
  effectiveLocalDate: string;
  weightLb: number;
}

export function latestWeightOverride(
  exerciseId: string,
  sessionLocalDate: string,
  overrides: WeightOverrides = WEIGHT_OVERRIDES,
): WeightOverride | undefined {
  const effectiveLocalDate = Object.keys(overrides)
    .filter(
      (date) =>
        date <= sessionLocalDate && overrides[date][exerciseId] !== undefined,
    )
    .sort()
    .at(-1);

  if (!effectiveLocalDate) return undefined;
  return {
    effectiveLocalDate,
    weightLb: overrides[effectiveLocalDate][exerciseId],
  };
}
