export const WORKOUT_TYPES = ["push", "pull", "legs_abs"] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];
export type WeightUnit = "lb" | "kg";
export type ExerciseStatus = "todo" | "current" | "deferred" | "complete";

export interface ImageCrop {
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  asset?: string;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface ExerciseDefinition {
  id: string;
  workoutType: WorkoutType;
  order: number;
  name: string;
  minReps: number;
  maxReps: number;
  targetSets: number;
  restSeconds: number;
  incrementLb: number;
  imageKey: string;
  defaultWeightLb?: number;
}

export interface WorkoutSession {
  id: string;
  workoutType: WorkoutType;
  status: "active" | "completed" | "archived";
  startTimestamp: number;
  localDate?: string;
  startLocalDateTime?: string;
  finishTimestamp?: number;
  finishLocalDateTime?: string;
  exerciseOrder: string[];
  activeRestEndTimestamp?: number | null;
  activeRestExerciseId?: string | null;
}

export interface WorkoutExerciseState {
  id: string;
  sessionId: string;
  exerciseId: string;
  order: number;
  status: ExerciseStatus;
  queuedStatus?: "todo" | "deferred";
  exerciseName: string;
  minReps: number;
  maxReps: number;
  targetSets: number;
  restSeconds: number;
  incrementLb: number;
  imageKey: string;
  defaultWeightLb?: number;
}

export interface SetRecord {
  id: string;
  sessionId: string;
  workoutType: WorkoutType;
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  actualWeight: number;
  weightUnit: WeightUnit;
  weightKg: number;
  actualReps: number;
  timestamp: number;
  localDateTime?: string;
}

export interface AppSettings {
  id: "settings";
  weightUnit: WeightUnit;
}

export interface WorkoutBackup {
  format: "workout-backup";
  schemaVersion: number;
  exportedAt: string;
  exercises: ExerciseDefinition[];
  sessions: WorkoutSession[];
  exerciseStates: WorkoutExerciseState[];
  sets: SetRecord[];
  settings: AppSettings[];
}

export function createId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}
