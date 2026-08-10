import type { SetRecord, WeightUnit } from "./models";

const KG_PER_LB = 0.45359237;

export function toKg(value: number, unit: WeightUnit): number {
  return unit === "kg" ? value : value * KG_PER_LB;
}

export function fromKg(valueKg: number, unit: WeightUnit): number {
  return unit === "kg" ? valueKg : valueKg / KG_PER_LB;
}

export function roundDisplayWeight(value: number, unit: WeightUnit): number {
  const step = unit === "kg" ? 0.5 : 1;
  return Math.max(0, Math.round(value / step) * step);
}

export function incrementForUnit(incrementLb: number, unit: WeightUnit): number {
  return unit === "lb"
    ? incrementLb
    : Math.max(0.5, Math.round(incrementLb * KG_PER_LB * 2) / 2);
}

export function recordWeightInUnit(
  record: Pick<SetRecord, "actualWeight" | "weightUnit" | "weightKg">,
  unit: WeightUnit,
): number {
  const kg = Number.isFinite(record.weightKg)
    ? record.weightKg
    : toKg(record.actualWeight, record.weightUnit);
  return roundDisplayWeight(fromKg(kg, unit), unit);
}

export function recommendFromObservation(
  previous: Pick<SetRecord, "actualWeight" | "weightUnit" | "weightKg" | "actualReps">,
  minReps: number,
  maxReps: number,
  incrementLb: number,
  displayUnit: WeightUnit,
): number {
  const previousWeight = recordWeightInUnit(previous, displayUnit);
  const increment = incrementForUnit(incrementLb, displayUnit);
  if (previous.actualReps < minReps) {
    return roundDisplayWeight(previousWeight - increment, displayUnit);
  }
  if (previous.actualReps > maxReps) {
    return roundDisplayWeight(previousWeight + increment, displayUnit);
  }
  return previousWeight;
}

export function describeAdjustment(
  reps: number,
  minReps: number,
  maxReps: number,
): "lower" | "same" | "higher" {
  if (reps < minReps) return "lower";
  if (reps > maxReps) return "higher";
  return "same";
}
