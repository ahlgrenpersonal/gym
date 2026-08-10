import type { WorkoutDatabase } from "./db";
import { localDateKey, toLocalIso } from "./local-date";
import type { WorkoutSession } from "./models";

export async function archiveStaleSessions(
  database: WorkoutDatabase,
  now = Date.now(),
): Promise<number> {
  const today = localDateKey(now);
  let archivedCount = 0;

  await database.transaction("rw", database.sessions, database.sets, async () => {
    const activeSessions = await database.sessions
      .where("status")
      .equals("active")
      .toArray();

    const staleSessions = activeSessions.filter(
      (session) =>
        (session.localDate ?? localDateKey(session.startTimestamp)) !== today,
    );

    const archivedSessions: WorkoutSession[] = [];
    for (const session of staleSessions) {
      const records = await database.sets
        .where("sessionId")
        .equals(session.id)
        .toArray();
      const finishTimestamp = records.length
        ? Math.max(...records.map((record) => record.timestamp))
        : session.startTimestamp;
      archivedSessions.push({
        ...session,
        status: "archived",
        finishTimestamp,
        finishLocalDateTime: toLocalIso(finishTimestamp),
        activeRestEndTimestamp: null,
        activeRestExerciseId: null,
      });
    }

    if (archivedSessions.length) {
      await database.sessions.bulkPut(archivedSessions);
      archivedCount = archivedSessions.length;
    }
  });

  return archivedCount;
}
