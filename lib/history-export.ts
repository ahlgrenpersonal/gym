import type { SetRecord } from "./models";

const DAYS_IN_FOUR_WEEKS = 28;

export function fourFullWeeksAndCurrentWeekStart(
  timestamp = Date.now(),
): number {
  const current = new Date(timestamp);
  const daysSinceMonday = (current.getDay() + 6) % 7;
  return new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() - daysSinceMonday - DAYS_IN_FOUR_WEEKS,
  ).getTime();
}

export function setsFromFourFullWeeksAndCurrentWeek(
  sets: SetRecord[],
  timestamp = Date.now(),
): SetRecord[] {
  const startTimestamp = fourFullWeeksAndCurrentWeekStart(timestamp);
  return sets.filter(
    (set) => set.timestamp >= startTimestamp && set.timestamp <= timestamp,
  );
}
