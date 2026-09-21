export const WORKOUT_TIMER_SHORTCUT_NAME = "Workout Rest Timer";

export function workoutTimerShortcutUrl({
  seconds,
  returnUrl,
}: {
  seconds: number;
  returnUrl: string;
}): string {
  const callbackUrl = encodeURIComponent(returnUrl);
  return (
    "shortcuts://x-callback-url/run-shortcut" +
    `?name=${encodeURIComponent(WORKOUT_TIMER_SHORTCUT_NAME)}` +
    "&input=text" +
    `&text=${encodeURIComponent(String(seconds))}` +
    `&x-success=${callbackUrl}` +
    `&x-cancel=${callbackUrl}` +
    `&x-error=${callbackUrl}`
  );
}
