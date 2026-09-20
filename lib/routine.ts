import type { WorkoutType } from "./models";

export type StationId =
  | "lat_pulldown"
  | "shoulder_press"
  | "incline_chest_press"
  | "reverse_pec_deck"
  | "chest_supported_row"
  | "abdominal_crunch_machine"
  | "single_leg_extension"
  | "leg_press"
  | "cable_station";

export interface RoutineEntry {
  exerciseId: string;
  station: StationId;
  targetSets?: number;
  // This exercise is performed inside the named exercise's recovery window,
  // so its sets do not add their full standalone duration to the session.
  alternatesWith?: string;
}

export interface RoutineWorkout {
  description: string;
  entries: readonly RoutineEntry[];
}

export interface RoutinePreset {
  name: string;
  weeklySummary: string;
  workoutTypes: readonly WorkoutType[];
  workouts: Partial<Record<WorkoutType, RoutineWorkout>>;
}

// The old three-way split remains executable so returning to it is a one-line
// configuration change. It includes the separately agreed fourth chest set.
export const ROUTINE_PRESETS = {
  classic_split: {
    name: "Classic Push / Pull / Legs + Abs",
    weeklySummary:
      "MON PUSH · TUE PULL · WED LEGS + ABS · THU PUSH · FRI PULL",
    workoutTypes: ["push", "pull", "legs_abs"],
    workouts: {
      push: {
        description: "Chest · shoulders · lateral delts · triceps",
        entries: [
          { exerciseId: "incline_chest_press", station: "incline_chest_press" },
          { exerciseId: "shoulder_press", station: "shoulder_press" },
          { exerciseId: "lateral_raise", station: "cable_station" },
          { exerciseId: "triceps_pushdown", station: "cable_station" },
          { exerciseId: "overhead_triceps_extension", station: "cable_station" },
        ],
      },
      pull: {
        description: "Lats · upper back · rear delts · biceps",
        entries: [
          { exerciseId: "lat_pulldown", station: "lat_pulldown" },
          { exerciseId: "chest_supported_row", station: "chest_supported_row" },
          { exerciseId: "reverse_pec_deck", station: "reverse_pec_deck" },
          { exerciseId: "preacher_or_cable_curl", station: "cable_station" },
        ],
      },
      legs_abs: {
        description: "Knee support · focused abs · lateral delts",
        entries: [
          { exerciseId: "leg_press", station: "leg_press" },
          { exerciseId: "single_leg_extension", station: "single_leg_extension" },
          { exerciseId: "abdominal_crunch_machine", station: "abdominal_crunch_machine" },
          { exerciseId: "lateral_raise", station: "cable_station" },
        ],
      },
    },
  },
  weekday_balanced: {
    name: "Balanced Weekday Hypertrophy",
    weeklySummary: "11 TIMED SETS/DAY · ABS/LEG EXT ALTERNATE",
    workoutTypes: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    workouts: {
      monday: {
        description: "Chest · shoulders + abs · cable delts + triceps",
        entries: [
          {
            exerciseId: "incline_chest_press",
            station: "incline_chest_press",
            targetSets: 3,
          },
          {
            exerciseId: "shoulder_press",
            station: "shoulder_press",
            targetSets: 2,
          },
          {
            exerciseId: "abdominal_crunch_machine",
            station: "abdominal_crunch_machine",
            targetSets: 1,
            alternatesWith: "shoulder_press",
          },
          { exerciseId: "lateral_raise", station: "cable_station", targetSets: 3 },
          {
            exerciseId: "triceps_pushdown",
            station: "cable_station",
            targetSets: 2,
          },
          {
            exerciseId: "overhead_triceps_extension",
            station: "cable_station",
            targetSets: 1,
          },
        ],
      },
      tuesday: {
        description: "Lats · row · rear delts + leg extension · biceps",
        entries: [
          { exerciseId: "lat_pulldown", station: "lat_pulldown", targetSets: 3 },
          {
            exerciseId: "chest_supported_row",
            station: "chest_supported_row",
            targetSets: 3,
          },
          {
            exerciseId: "reverse_pec_deck",
            station: "reverse_pec_deck",
            targetSets: 2,
          },
          {
            exerciseId: "single_leg_extension",
            station: "single_leg_extension",
            targetSets: 1,
            alternatesWith: "reverse_pec_deck",
          },
          {
            exerciseId: "preacher_or_cable_curl",
            station: "cable_station",
            targetSets: 3,
          },
        ],
      },
      wednesday: {
        description: "Chest · shoulders + abs · leg press · cable delts + triceps",
        entries: [
          {
            exerciseId: "incline_chest_press",
            station: "incline_chest_press",
            targetSets: 2,
          },
          {
            exerciseId: "shoulder_press",
            station: "shoulder_press",
            targetSets: 2,
          },
          {
            exerciseId: "abdominal_crunch_machine",
            station: "abdominal_crunch_machine",
            targetSets: 2,
            alternatesWith: "shoulder_press",
          },
          { exerciseId: "leg_press", station: "leg_press", targetSets: 2 },
          { exerciseId: "lateral_raise", station: "cable_station", targetSets: 3 },
          {
            exerciseId: "overhead_triceps_extension",
            station: "cable_station",
            targetSets: 2,
          },
        ],
      },
      thursday: {
        description: "Lats · row · rear delts + leg extension · biceps",
        entries: [
          { exerciseId: "lat_pulldown", station: "lat_pulldown", targetSets: 3 },
          {
            exerciseId: "chest_supported_row",
            station: "chest_supported_row",
            targetSets: 3,
          },
          {
            exerciseId: "reverse_pec_deck",
            station: "reverse_pec_deck",
            targetSets: 2,
          },
          {
            exerciseId: "single_leg_extension",
            station: "single_leg_extension",
            targetSets: 1,
            alternatesWith: "reverse_pec_deck",
          },
          {
            exerciseId: "preacher_or_cable_curl",
            station: "cable_station",
            targetSets: 3,
          },
        ],
      },
      friday: {
        description: "Chest · shoulders + abs · cable delts + triceps",
        entries: [
          {
            exerciseId: "incline_chest_press",
            station: "incline_chest_press",
            targetSets: 3,
          },
          {
            exerciseId: "shoulder_press",
            station: "shoulder_press",
            targetSets: 2,
          },
          {
            exerciseId: "abdominal_crunch_machine",
            station: "abdominal_crunch_machine",
            targetSets: 1,
            alternatesWith: "shoulder_press",
          },
          { exerciseId: "lateral_raise", station: "cable_station", targetSets: 3 },
          {
            exerciseId: "triceps_pushdown",
            station: "cable_station",
            targetSets: 2,
          },
          {
            exerciseId: "overhead_triceps_extension",
            station: "cable_station",
            targetSets: 1,
          },
        ],
      },
    },
  },
} as const satisfies Record<string, RoutinePreset>;

export type RoutinePresetId = keyof typeof ROUTINE_PRESETS;

// Revert to the established split by changing only this value to
// "classic_split". The unsuccessful weekday trial remains available in Git.
export const ACTIVE_ROUTINE_ID: RoutinePresetId = "weekday_balanced";
export const ACTIVE_ROUTINE: RoutinePreset = ROUTINE_PRESETS[ACTIVE_ROUTINE_ID];
export const ACTIVE_WORKOUT_TYPES = ACTIVE_ROUTINE.workoutTypes;

export function routineWorkout(
  workoutType: WorkoutType,
): RoutineWorkout | undefined {
  for (const routine of Object.values(ROUTINE_PRESETS)) {
    const workout = routine.workouts[workoutType];
    if (workout) return workout;
  }
  return undefined;
}

export function routineEntry(
  workoutType: WorkoutType,
  exerciseId: string,
): RoutineEntry | undefined {
  return routineWorkout(workoutType)?.entries.find(
    (entry) => entry.exerciseId === exerciseId,
  );
}
