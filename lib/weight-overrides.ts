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
