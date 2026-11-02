// Keep the historical ID so every set and weight suggestion stays connected.
// Resolve the old default label on read, including restored backups.
export function currentExerciseName(exerciseId: string, savedName: string): string {
  return exerciseId === "incline_chest_press" &&
    savedName === "Incline Chest Press Machine"
    ? "Chest Press"
    : savedName;
}
