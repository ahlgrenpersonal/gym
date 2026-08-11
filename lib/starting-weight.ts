import type { WeightUnit } from "./models";
import { fromKg, roundDisplayWeight, toKg } from "./recommendation";

export const DEFAULT_STARTING_WEIGHT_LB = 100;

export function defaultStartingWeight(
  unit: WeightUnit,
  startingWeightLb = DEFAULT_STARTING_WEIGHT_LB,
): number {
  return roundDisplayWeight(
    fromKg(toKg(startingWeightLb, "lb"), unit),
    unit,
  );
}
