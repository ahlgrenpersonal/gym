import type { WeightUnit } from "./models";
import { fromKg, roundDisplayWeight, toKg } from "./recommendation";

export const DEFAULT_STARTING_WEIGHT_LB = 100;

export function defaultStartingWeight(unit: WeightUnit): number {
  return roundDisplayWeight(
    fromKg(toKg(DEFAULT_STARTING_WEIGHT_LB, "lb"), unit),
    unit,
  );
}
