function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function toLocalIso(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function localDateKey(timestamp = Date.now()): string {
  return toLocalIso(timestamp).slice(0, 10);
}

export function millisecondsUntilNextLocalMidnight(timestamp = Date.now()): number {
  const now = new Date(timestamp);
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  return Math.max(0, nextMidnight.getTime() - timestamp);
}
