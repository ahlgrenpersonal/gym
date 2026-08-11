"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { createBackup, restoreBackup, setsToCsv } from "../lib/backup";
import {
  db,
  deleteWorkoutSession,
  ensureDefaults,
  resetAllData,
} from "../lib/db";
import { IMAGE_CROPS, INFOGRAPHIC_SIZE } from "../lib/exercises";
import type {
  AppSettings,
  ExerciseDefinition,
  SetRecord,
  WeightUnit,
  WorkoutExerciseState,
  WorkoutSession,
  WorkoutType,
} from "../lib/models";
import { createId } from "../lib/models";
import {
  completeCurrentExercise,
  createInitialQueue,
  deferCurrentExercise,
  jumpToExercise,
  queueIsComplete,
} from "../lib/queue";
import {
  fromKg,
  incrementForUnit,
  recommendFromObservation,
  roundDisplayWeight,
  toKg,
} from "../lib/recommendation";
import { archiveStaleSessions } from "../lib/day-rollover";
import { exerciseHistoryRows } from "../lib/history";
import { localDateKey, millisecondsUntilNextLocalMidnight, toLocalIso } from "../lib/local-date";
import { restUpdateAfterSet } from "../lib/rest";
import { defaultStartingWeight } from "../lib/starting-weight";
import { activeSessionsForLocalDay } from "../lib/today-sessions";

type Screen = "today" | "history" | "settings";

const APP_BASE_URL = import.meta.env.BASE_URL;

function appAsset(path: string): string {
  return `${APP_BASE_URL}${path.replace(/^\/+/, "")}`;
}

function formatDate(timestamp: number, includeTime = false): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(timestamp);
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ExerciseVisual({ imageKey }: { imageKey: string }) {
  const crop = IMAGE_CROPS[imageKey] ?? IMAGE_CROPS.incline_chest_press;
  const horizontal = (crop.x / (INFOGRAPHIC_SIZE.width - crop.width)) * 100;
  const vertical = (crop.y / (INFOGRAPHIC_SIZE.height - crop.height)) * 100;
  return (
    <div
      className="exercise-visual"
      role="img"
      aria-label={crop.label}
      style={{
        aspectRatio: `${crop.width} / ${crop.height}`,
        backgroundImage: `url("${appAsset("workout.png")}")`,
        backgroundSize: `${(INFOGRAPHIC_SIZE.width / crop.width) * 100}% ${(INFOGRAPHIC_SIZE.height / crop.height) * 100}%`,
        backgroundPosition: `${horizontal}% ${vertical}%`,
      }}
    />
  );
}

function StatusMark({ status }: { status: WorkoutExerciseState["status"] }) {
  return (
    <span className={`status-mark status-${status}`} aria-hidden="true">
      {status === "complete"
        ? "✓"
        : status === "current"
          ? "●"
          : status === "deferred"
            ? "↷"
            : "○"}
    </span>
  );
}

function QueueList({
  states,
  setCounts,
  onJump,
}: {
  states: WorkoutExerciseState[];
  setCounts: Map<string, number>;
  onJump: (id: string) => void;
}) {
  return (
    <div className="queue-list" aria-label="Workout exercise queue">
      {[...states]
        .sort((a, b) => a.order - b.order)
        .map((state) => (
          <button
            className={`queue-row queue-${state.status}`}
            disabled={state.status === "complete" || state.status === "current"}
            key={state.id}
            onClick={() => onJump(state.id)}
          >
            <StatusMark status={state.status} />
            <span className="queue-name">{state.exerciseName}</span>
            <span className="queue-count">
              {setCounts.get(state.exerciseId) ?? 0}/{state.targetSets}
            </span>
          </button>
        ))}
    </div>
  );
}

function RestTimer({
  endTimestamp,
  onAdjust,
  onSkip,
}: {
  endTimestamp: number;
  onAdjust: (seconds: number) => void;
  onSkip: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const announcedRef = useRef<number | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((endTimestamp - now) / 1000));
  const done = remaining === 0;
  useEffect(() => {
    if (done && announcedRef.current !== endTimestamp) {
      announcedRef.current = endTimestamp;
      navigator.vibrate?.([120, 80, 120]);
    }
  }, [done, endTimestamp]);
  return (
    <section className={`rest-card ${done ? "rest-done" : ""}`} aria-live="polite">
      <div>
        <p className="eyebrow">{done ? "REST COMPLETE" : "RESTING"}</p>
        <p className="rest-time">{done ? "READY" : formatDuration(remaining)}</p>
      </div>
      <div className="rest-actions">
        <button className="small-button" onClick={() => onAdjust(-30)} type="button">
          −30 sec
        </button>
        <button className="small-button" onClick={() => onAdjust(30)} type="button">
          +30 sec
        </button>
        <button className="small-button small-button-strong" onClick={onSkip} type="button">
          {done ? "Continue" : "Skip rest"}
        </button>
      </div>
    </section>
  );
}

function HomeScreen({
  onStart,
  latestSession,
  activeSessions,
  sets,
}: {
  onStart: (type: WorkoutType) => void;
  latestSession?: WorkoutSession;
  activeSessions: WorkoutSession[];
  sets: SetRecord[];
}) {
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
  return (
    <main className="screen today-home">
      <section className="home-hero">
        <p className="eyebrow">HYPERTROPHY · ARMS + V-TAPER</p>
        <h1>What are we training?</h1>
        <p>Start or resume either workout. Switch any time.</p>
      </section>
      <div className="workout-picker">
        {(["push", "pull"] as const).map((type, index) => {
          const active = activeSessions.find(
            (session) => session.workoutType === type,
          );
          const loggedSets = active
            ? sets.filter((record) => record.sessionId === active.id).length
            : 0;
          const description =
            type === "push"
              ? "Chest · side delts · triceps"
              : "Lats · upper back · rear delts · biceps";
          return (
            <button
              className={`workout-choice ${type}-choice`}
              key={type}
              onClick={() => onStart(type)}
            >
              <span className="choice-number">{active ? "↻" : `0${index + 1}`}</span>
              <span>{type.toUpperCase()}</span>
              <small>
                {active
                  ? `IN PROGRESS · ${loggedSets} set${loggedSets === 1 ? "" : "s"} logged · tap to resume`
                  : description}
              </small>
            </button>
          );
        })}
      </div>
      {latestSession ? (
        <p className="last-workout">
          Last workout: <strong>{latestSession.workoutType.toUpperCase()}</strong> ·{" "}
          {formatDate(latestSession.finishTimestamp ?? latestSession.startTimestamp)}
        </p>
      ) : null}
      {!standalone ? (
        <aside className="install-tip">
          <strong>Install on iPhone</strong>
          <span>
            In Safari, tap Share → Add to Home Screen for full-screen offline use.
          </span>
        </aside>
      ) : null}
    </main>
  );
}

function WorkoutScreen({
  session,
  states,
  sets,
  unit,
  suggestedWeight,
  historicalWeight,
  usingDefaultWeight,
  draftWeight,
  draftReps,
  error,
  onWeightChange,
  onRepsChange,
  onCompleteSet,
  onDefer,
  onJump,
  onRestAdjust,
  onRestSkip,
  onExit,
}: {
  session: WorkoutSession;
  states: WorkoutExerciseState[];
  sets: SetRecord[];
  unit: WeightUnit;
  suggestedWeight?: number;
  historicalWeight?: number;
  usingDefaultWeight: boolean;
  draftWeight: string;
  draftReps: string;
  error: string;
  onWeightChange: (value: string) => void;
  onRepsChange: (value: string) => void;
  onCompleteSet: () => void;
  onDefer: () => void;
  onJump: (id: string) => void;
  onRestAdjust: (seconds: number) => void;
  onRestSkip: () => void;
  onExit: () => void;
}) {
  const current = states.find((state) => state.status === "current");
  const setCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of sets) {
      counts.set(record.exerciseId, (counts.get(record.exerciseId) ?? 0) + 1);
    }
    return counts;
  }, [sets]);
  const currentSet = current ? (setCounts.get(current.exerciseId) ?? 0) + 1 : 0;
  const deferred = states.filter((state) => state.status === "deferred");
  return (
    <main className="screen workout-screen">
      <button className="back-button" onClick={onExit} type="button">
        ← MAIN MENU
      </button>
      <header className="workout-heading">
        <div>
          <p className="eyebrow">WORKOUT IN PROGRESS</p>
          <h1>{session.workoutType.toUpperCase()} DAY</h1>
        </div>
        <span className="live-pill">LIVE</span>
      </header>
      <QueueList states={states} setCounts={setCounts} onJump={onJump} />
      {current ? (
        <section className="current-card">
          <div className="exercise-title-row">
            <div>
              <p className="eyebrow">
                EXERCISE {current.order + 1} · SET {currentSet} OF {current.targetSets}
              </p>
              <h2>{current.exerciseName}</h2>
            </div>
            <span className="set-badge">
              {current.minReps}–{current.maxReps}
            </span>
          </div>
          <ExerciseVisual imageKey={current.imageKey} />
          <div className="prescription">
            <strong>
              {current.minReps}–{current.maxReps} reps × {current.targetSets} sets
            </strong>
            <span>Rest {formatDuration(current.restSeconds)}</span>
          </div>
          <div className="recommendation">
            <p className="eyebrow">
              {usingDefaultWeight ? "STARTING WEIGHT" : "RECOMMENDED"} · SET {currentSet}
            </p>
            <strong>
              {suggestedWeight === undefined
                ? "Choose a starting weight"
                : `${suggestedWeight} ${unit}`}
            </strong>
            {historicalWeight !== undefined ? (
              <span>
                Previous same-set history suggests {historicalWeight} {unit}.
              </span>
            ) : (
              <span>
                {usingDefaultWeight
                  ? unit === "lb"
                    ? "Default starting point: 100 lb. Edit freely."
                    : `Default starting point: 100 lb (${suggestedWeight} kg). Edit freely.`
                  : "No prior same-set result yet."}
              </span>
            )}
          </div>
          <div className="set-entry">
            <label>
              <span>Weight ({unit})</span>
              <input
                aria-label={`Weight in ${unit}`}
                inputMode="decimal"
                min="0"
                onChange={(event) => onWeightChange(event.target.value)}
                placeholder="—"
                step={unit === "kg" ? "0.5" : "1"}
                type="number"
                value={draftWeight}
              />
            </label>
            <label>
              <span>Reps</span>
              <input
                aria-label="Repetitions completed"
                inputMode="numeric"
                min="1"
                onChange={(event) => onRepsChange(event.target.value)}
                placeholder="—"
                type="number"
                value={draftReps}
              />
            </label>
          </div>
          <div className="rep-shortcuts" aria-label="Quick rep entry">
            {[
              current.minReps,
              Math.round((current.minReps + current.maxReps) / 2),
              current.maxReps,
            ]
              .filter((value, index, values) => values.indexOf(value) === index)
              .map((reps) => (
                <button
                  key={reps}
                  onClick={() => onRepsChange(String(reps))}
                  type="button"
                >
                  {reps} reps
                </button>
              ))}
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="primary-button complete-set"
            onClick={onCompleteSet}
            type="button"
          >
            COMPLETE SET
          </button>
          {session.activeRestEndTimestamp ? (
            <RestTimer
              endTimestamp={session.activeRestEndTimestamp}
              onAdjust={onRestAdjust}
              onSkip={onRestSkip}
            />
          ) : null}
          <button className="defer-button" onClick={onDefer} type="button">
            Machine occupied? <strong>DEFER FOR NOW</strong>
          </button>
        </section>
      ) : deferred.length ? (
        <section className="return-card">
          <p className="eyebrow">NORMAL QUEUE COMPLETE</p>
          <h2>
            {deferred.length} exercise{deferred.length === 1 ? "" : "s"} remaining
          </h2>
          <p>Return to anything you deferred when a machine was occupied.</p>
          {deferred.map((state) => (
            <button
              className="deferred-start"
              key={state.id}
              onClick={() => onJump(state.id)}
            >
              <span>{state.exerciseName}</span>
              <strong>START</strong>
            </button>
          ))}
        </section>
      ) : null}
    </main>
  );
}

function displayWeight(record: SetRecord, unit: WeightUnit): number {
  return roundDisplayWeight(fromKg(record.weightKg, unit), unit);
}

function summarizeExercise(records: SetRecord[], unit: WeightUnit): string {
  const sorted = [...records].sort((a, b) => a.setNumber - b.setNumber);
  if (!sorted.length) return "No sets recorded";
  const weights = sorted.map((record) => displayWeight(record, unit));
  const sameWeight = weights.every((weight) => weight === weights[0]);
  if (sameWeight) {
    return `${weights[0]} ${unit} → ${sorted
      .map((record) => record.actualReps)
      .join(" / ")}`;
  }
  return sorted
    .map((record, index) => `${weights[index]} ${unit} × ${record.actualReps}`)
    .join(" · ");
}

function WorkoutSummary({
  session,
  sessions,
  states,
  sets,
  unit,
  onDone,
}: {
  session: WorkoutSession;
  sessions: WorkoutSession[];
  states: WorkoutExerciseState[];
  sets: SetRecord[];
  unit: WeightUnit;
  onDone: () => void;
}) {
  const sessionSets = sets.filter((record) => record.sessionId === session.id);
  const previous = sessions
    .filter(
      (item) =>
        item.status === "completed" &&
        item.workoutType === session.workoutType &&
        item.id !== session.id &&
        item.startTimestamp < session.startTimestamp,
    )
    .sort((a, b) => b.startTimestamp - a.startTimestamp)[0];
  return (
    <main className="screen summary-screen">
      <section className="summary-hero">
        <div className="summary-check">✓</div>
        <p className="eyebrow">WORKOUT SAVED</p>
        <h1>{session.workoutType.toUpperCase()} COMPLETE</h1>
        <p>{formatDate(session.finishTimestamp ?? Date.now(), true)}</p>
      </section>
      <div className="summary-list">
        {[...states]
          .sort((a, b) => a.order - b.order)
          .map((state) => {
            const currentRecords = sessionSets.filter(
              (record) => record.exerciseId === state.exerciseId,
            );
            const priorRecords = previous
              ? sets.filter(
                  (record) =>
                    record.sessionId === previous.id &&
                    record.exerciseId === state.exerciseId,
                )
              : [];
            const currentVolume = currentRecords.reduce(
              (sum, record) => sum + record.weightKg * record.actualReps,
              0,
            );
            const previousVolume = priorRecords.reduce(
              (sum, record) => sum + record.weightKg * record.actualReps,
              0,
            );
            let comparison = "First result";
            if (previousVolume > 0) {
              const ratio = currentVolume / previousVolume;
              comparison =
                ratio > 1.03
                  ? "↑ improved"
                  : ratio < 0.97
                    ? "↓ lower"
                    : "→ similar";
            }
            return (
              <article className="summary-row" key={state.id}>
                <div>
                  <strong>{state.exerciseName}</strong>
                  <span>{summarizeExercise(currentRecords, unit)}</span>
                </div>
                <small>{comparison}</small>
              </article>
            );
          })}
      </div>
      <button className="primary-button" onClick={onDone}>
        DONE
      </button>
    </main>
  );
}

function HistoryScreen({
  exercises,
  sessions,
  states,
  sets,
  unit,
  selectedSessionId,
  selectedExerciseId,
  onSelectSession,
  onSelectExercise,
  onDeleteSession,
}: {
  exercises: ExerciseDefinition[];
  sessions: WorkoutSession[];
  states: WorkoutExerciseState[];
  sets: SetRecord[];
  unit: WeightUnit;
  selectedSessionId: string | null;
  selectedExerciseId: string | null;
  onSelectSession: (id: string | null) => void;
  onSelectExercise: (id: string | null) => void;
  onDeleteSession: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | WorkoutType>("all");
  const historicalSessions = sessions
    .filter((session) => session.status !== "active")
    .sort((a, b) => b.startTimestamp - a.startTimestamp);
  const selectedSession = historicalSessions.find(
    (session) => session.id === selectedSessionId,
  );
  const selectedExercise = exercises.find(
    (exercise) => exercise.id === selectedExerciseId,
  );
  if (selectedExercise) {
    const rows = exerciseHistoryRows(sessions, sets, selectedExercise.id);
    return (
      <main className="screen history-screen">
        <button className="back-button" onClick={() => onSelectExercise(null)}>
          ← History
        </button>
        <p className="eyebrow">EXERCISE HISTORY</p>
        <h1>{selectedExercise.name}</h1>
        {rows.length ? (
          <div className="history-detail-list">
            {rows.map(({ session, records }) => (
              <article key={session.id}>
                <time>
                  {formatDate(session.startTimestamp)}
                  {session.status === "active"
                    ? " · In progress"
                    : session.status === "archived"
                      ? " · Incomplete"
                      : ""}
                </time>
                <strong>{summarizeExercise(records, unit)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">No logged sets for this exercise yet.</div>
        )}
      </main>
    );
  }
  if (selectedSession) {
    const sessionStates = states
      .filter((state) => state.sessionId === selectedSession.id)
      .sort((a, b) => a.order - b.order);
    return (
      <main className="screen history-screen">
        <button className="back-button" onClick={() => onSelectSession(null)}>
          ← History
        </button>
        <p className="eyebrow">
          {formatDate(selectedSession.startTimestamp, true)}
        </p>
        <h1>{selectedSession.workoutType.toUpperCase()} WORKOUT</h1>
        <div className="summary-list history-summary">
          {sessionStates.map((state) => {
            const records = sets.filter(
              (record) =>
                record.sessionId === selectedSession.id &&
                record.exerciseId === state.exerciseId,
            );
            return (
              <button
                key={state.id}
                onClick={() => onSelectExercise(state.exerciseId)}
              >
                <strong>{state.exerciseName}</strong>
                <span>{summarizeExercise(records, unit)}</span>
              </button>
            );
          })}
        </div>
        <button
          className="danger-link"
          onClick={() => onDeleteSession(selectedSession.id)}
        >
          Delete this workout
        </button>
      </main>
    );
  }
  const filtered = historicalSessions.filter(
    (session) => filter === "all" || session.workoutType === filter,
  );
  return (
    <main className="screen history-screen">
      <p className="eyebrow">YOUR TRAINING LOG</p>
      <h1>History</h1>
      <div className="segmented-control history-filter">
        {(["all", "push", "pull"] as const).map((value) => (
          <button
            className={filter === value ? "active" : ""}
            key={value}
            onClick={() => setFilter(value)}
          >
            {value.toUpperCase()}
          </button>
        ))}
      </div>
      {filtered.length ? (
        <div className="session-list">
          {filtered.map((session) => {
            const sessionSetCount = sets.filter(
              (record) => record.sessionId === session.id,
            ).length;
            return (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
              >
                <span className={`session-type ${session.workoutType}`}>
                  {session.workoutType.toUpperCase()}
                </span>
                <span>
                  <strong>{formatDate(session.startTimestamp, true)}</strong>
                  <small>
                    {sessionSetCount} sets logged
                    {session.status === "archived" ? " · incomplete" : ""}
                  </small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">Your previous workouts will appear here.</div>
      )}
      <section className="exercise-history-picker">
        <p className="eyebrow">BROWSE BY EXERCISE</p>
        {(["push", "pull"] as const).map((type) => (
          <div key={type}>
            <h2>{type.toUpperCase()}</h2>
            {exercises
              .filter((exercise) => exercise.workoutType === type)
              .sort((a, b) => a.order - b.order)
              .map((exercise) => (
                <button
                  key={exercise.id}
                  onClick={() => onSelectExercise(exercise.id)}
                >
                  {exercise.name}
                  <span>›</span>
                </button>
              ))}
          </div>
        ))}
      </section>
    </main>
  );
}

function ExerciseEditor({
  exercise,
  unit,
  onSave,
}: {
  exercise: ExerciseDefinition;
  unit: WeightUnit;
  onSave: (exercise: ExerciseDefinition) => Promise<void>;
}) {
  const [draft, setDraft] = useState(exercise);
  const [saved, setSaved] = useState(false);
  const displayIncrement = incrementForUnit(draft.incrementLb, unit);
  useEffect(() => setDraft(exercise), [exercise]);
  const numberUpdate = (key: keyof ExerciseDefinition, value: string) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      setDraft((current) => ({ ...current, [key]: numeric }));
    }
  };
  const save = async () => {
    await onSave(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  };
  return (
    <details className="exercise-editor">
      <summary>
        <span className="editor-number">{exercise.order + 1}</span>
        <span>{exercise.name}</span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="editor-body">
        <label className="wide-field">
          <span>Name</span>
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <div className="editor-grid">
          <label>
            <span>Min reps</span>
            <input
              min="1"
              type="number"
              value={draft.minReps}
              onChange={(event) => numberUpdate("minReps", event.target.value)}
            />
          </label>
          <label>
            <span>Max reps</span>
            <input
              min="1"
              type="number"
              value={draft.maxReps}
              onChange={(event) => numberUpdate("maxReps", event.target.value)}
            />
          </label>
          <label>
            <span>Sets</span>
            <input
              min="1"
              type="number"
              value={draft.targetSets}
              onChange={(event) => numberUpdate("targetSets", event.target.value)}
            />
          </label>
          <label>
            <span>Rest (sec)</span>
            <input
              min="0"
              step="15"
              type="number"
              value={draft.restSeconds}
              onChange={(event) => numberUpdate("restSeconds", event.target.value)}
            />
          </label>
          <label>
            <span>Increment ({unit})</span>
            <input
              min="0.5"
              step={unit === "kg" ? "0.5" : "1"}
              type="number"
              value={displayIncrement}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                  setDraft({
                    ...draft,
                    incrementLb: unit === "lb" ? value : value / 0.45359237,
                  });
                }
              }}
            />
          </label>
          <label>
            <span>Image</span>
            <select
              value={draft.imageKey}
              onChange={(event) =>
                setDraft({ ...draft, imageKey: event.target.value })
              }
            >
              {Object.values(IMAGE_CROPS).map((crop) => (
                <option key={crop.key} value={crop.key}>
                  {crop.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="save-button" onClick={save} type="button">
          {saved ? "SAVED ✓" : "SAVE EXERCISE"}
        </button>
      </div>
    </details>
  );
}

function SettingsScreen({
  exercises,
  settings,
  persistentStorage,
  onUnitChange,
  onSaveExercise,
  onExportBackup,
  onImportBackup,
  onExportCsv,
  onReset,
}: {
  exercises: ExerciseDefinition[];
  settings: AppSettings;
  persistentStorage: boolean | null;
  onUnitChange: (unit: WeightUnit) => void;
  onSaveExercise: (exercise: ExerciseDefinition) => Promise<void>;
  onExportBackup: () => void;
  onImportBackup: (event: ChangeEvent<HTMLInputElement>) => void;
  onExportCsv: () => void;
  onReset: () => void;
}) {
  return (
    <main className="screen settings-screen">
      <p className="eyebrow">TUNE YOUR WORKOUT</p>
      <h1>Settings</h1>
      <section className="settings-card">
        <div className="setting-heading">
          <div>
            <strong>Weight units</strong>
            <span>Historical values remain unchanged.</span>
          </div>
          <div className="segmented-control unit-control">
            {(["lb", "kg"] as const).map((unit) => (
              <button
                className={settings.weightUnit === unit ? "active" : ""}
                key={unit}
                onClick={() => onUnitChange(unit)}
              >
                {unit.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <p className="eyebrow">EXERCISE SETTINGS</p>
          <p>
            Changes apply to future workouts only. Past records keep their original
            names and results.
          </p>
        </div>
        {(["push", "pull"] as const).map((type) => (
          <div className="editor-group" key={type}>
            <h2>{type.toUpperCase()}</h2>
            {exercises
              .filter((exercise) => exercise.workoutType === type)
              .sort((a, b) => a.order - b.order)
              .map((exercise) => (
                <ExerciseEditor
                  key={exercise.id}
                  exercise={exercise}
                  unit={settings.weightUnit}
                  onSave={onSaveExercise}
                />
              ))}
          </div>
        ))}
      </section>
      <section className="settings-card data-card">
        <p className="eyebrow">YOUR DATA</p>
        <h2>Backup & restore</h2>
        <p>
          Your complete database stays on this device. Export a backup before major
          phone or browser changes.
        </p>
        <div className="data-actions">
          <button className="primary-button" onClick={onExportBackup}>
            EXPORT BACKUP
          </button>
          <label className="secondary-button file-button">
            IMPORT BACKUP
            <input
              accept="application/json,.json"
              onChange={onImportBackup}
              type="file"
            />
          </label>
          <button className="secondary-button" onClick={onExportCsv}>
            EXPORT HISTORY CSV
          </button>
        </div>
        <p className="storage-note">
          Storage protection:{" "}
          {persistentStorage === true
            ? "persistent storage granted"
            : persistentStorage === false
              ? "best-effort storage"
              : "checking support"}
          .
        </p>
      </section>
      <section className="ios-note">
        <strong>About iPhone storage</strong>
        <span>
          Installed PWAs keep IndexedDB across normal app updates. iOS can still
          remove site data under storage pressure or if you delete the PWA/site data,
          so keep a recent backup.
        </span>
      </section>
      <details className="danger-zone">
        <summary>Advanced · destructive actions</summary>
        <div>
          <strong>Reset all data</strong>
          <p>
            This permanently deletes every workout, set, and custom exercise setting
            on this device.
          </p>
          <button onClick={onReset}>RESET ALL DATA</button>
        </div>
      </details>
    </main>
  );
}

export default function WorkoutApp() {
  const [screen, setScreen] = useState<Screen>("today");
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [exercises, setExercises] = useState<ExerciseDefinition[]>([]);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [states, setStates] = useState<WorkoutExerciseState[]>([]);
  const [sets, setSets] = useState<SetRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    id: "settings",
    weightUnit: "lb",
  });
  const [persistentStorage, setPersistentStorage] = useState<boolean | null>(null);
  const [online, setOnline] = useState(true);
  const [draftWeight, setDraftWeight] = useState("");
  const [draftReps, setDraftReps] = useState("");
  const [entryError, setEntryError] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [summarySessionId, setSummarySessionId] = useState<string | null>(null);
  const [activeWorkoutSessionId, setActiveWorkoutSessionId] = useState<string | null>(null);
  const draftKeyRef = useRef("");
  const startingWorkoutRef = useRef(false);

  const refresh = useCallback(async () => {
    const [nextExercises, nextSessions, nextStates, nextSets, nextSettings] =
      await Promise.all([
        db.exercises.toArray(),
        db.sessions.toArray(),
        db.exerciseStates.toArray(),
        db.sets.toArray(),
        db.settings.get("settings"),
      ]);
    setExercises(nextExercises);
    setSessions(nextSessions);
    setStates(nextStates);
    setSets(nextSets);
    if (nextSettings) setSettings(nextSettings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        await ensureDefaults();
        await archiveStaleSessions(db);
        const persisted = navigator.storage?.persist
          ? await navigator.storage.persist()
          : false;
        if (!cancelled) setPersistentStorage(persisted);
        await refresh();
        if ("serviceWorker" in navigator) {
          await navigator.serviceWorker.register(appAsset("sw.js"), { updateViaCache: "none" });
        }
        if (!cancelled) setReady(true);
      } catch (error) {
        if (!cancelled) {
          setFatalError(
            error instanceof Error
              ? error.message
              : "The workout database could not be opened.",
          );
          setReady(true);
        }
      }
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!ready || fatalError) return;
    let cancelled = false;
    let timer: number | undefined;

    const runRollover = async () => {
      try {
        await archiveStaleSessions(db);
        if (!cancelled) await refresh();
      } catch (error) {
        console.error("Daily workout rollover failed", error);
      }
    };
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await runRollover();
        if (!cancelled) schedule();
      }, millisecondsUntilNextLocalMidnight() + 50);
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void runRollover();
    };

    schedule();
    window.addEventListener("focus", runRollover);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", runRollover);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [fatalError, ready, refresh]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const todayActiveSessions = useMemo(
    () => activeSessionsForLocalDay(sessions),
    [sessions],
  );
  const activeSession = useMemo(
    () =>
      todayActiveSessions.find(
        (session) => session.id === activeWorkoutSessionId,
      ),
    [activeWorkoutSessionId, todayActiveSessions],
  );
  const activeStates = useMemo(
    () =>
      activeSession
        ? states
            .filter((state) => state.sessionId === activeSession.id)
            .sort((a, b) => a.order - b.order)
        : [],
    [activeSession, states],
  );
  const activeSets = useMemo(
    () =>
      activeSession
        ? sets.filter((record) => record.sessionId === activeSession.id)
        : [],
    [activeSession, sets],
  );
  const currentState = activeStates.find((state) => state.status === "current");
  const nextSetNumber = currentState
    ? activeSets.filter((record) => record.exerciseId === currentState.exerciseId)
        .length + 1
    : 0;
  const historicalIds = useMemo(
    () =>
      new Set(
        sessions
          .filter((session) => session.status !== "active")
          .map((session) => session.id),
      ),
    [sessions],
  );
  const historicalRecord = currentState
    ? sets
        .filter(
          (record) =>
            record.exerciseId === currentState.exerciseId &&
            record.setNumber === nextSetNumber &&
            historicalIds.has(record.sessionId),
        )
        .sort((a, b) => b.timestamp - a.timestamp)[0]
    : undefined;
  const currentPreviousSet = currentState
    ? activeSets
        .filter(
          (record) =>
            record.exerciseId === currentState.exerciseId &&
            record.setNumber === nextSetNumber - 1,
        )
        .sort((a, b) => b.timestamp - a.timestamp)[0]
    : undefined;
  const historicalWeight =
    currentState && historicalRecord
      ? recommendFromObservation(
          historicalRecord,
          currentState.minReps,
          currentState.maxReps,
          currentState.incrementLb,
          settings.weightUnit,
        )
      : undefined;
  const recommendationWeight =
    currentState && currentPreviousSet
      ? recommendFromObservation(
          currentPreviousSet,
          currentState.minReps,
          currentState.maxReps,
          currentState.incrementLb,
          settings.weightUnit,
        )
      : historicalWeight;
  const usingDefaultWeight = recommendationWeight === undefined;
  const suggestedWeight =
    recommendationWeight ?? defaultStartingWeight(settings.weightUnit);

  useEffect(() => {
    const key = currentState
      ? `${currentState.id}:${nextSetNumber}:${settings.weightUnit}`
      : "";
    if (key !== draftKeyRef.current) {
      draftKeyRef.current = key;
      setDraftWeight(suggestedWeight === undefined ? "" : String(suggestedWeight));
      setDraftReps("");
      setEntryError("");
    }
  }, [currentState, nextSetNumber, settings.weightUnit, suggestedWeight]);

  const startWorkout = async (workoutType: WorkoutType) => {
    const existingSession = todayActiveSessions.find(
      (session) => session.workoutType === workoutType,
    );
    if (existingSession) {
      setActiveWorkoutSessionId(existingSession.id);
      setScreen("today");
      return;
    }
    if (startingWorkoutRef.current) return;
    startingWorkoutRef.current = true;
    const definitions = exercises
      .filter((exercise) => exercise.workoutType === workoutType)
      .sort((a, b) => a.order - b.order);
    const sessionId = createId("session");
    const startTimestamp = Date.now();
    const session: WorkoutSession = {
      id: sessionId,
      workoutType,
      status: "active",
      startTimestamp,
      localDate: localDateKey(startTimestamp),
      startLocalDateTime: toLocalIso(startTimestamp),
      exerciseOrder: definitions.map((exercise) => exercise.id),
      activeRestEndTimestamp: null,
      activeRestExerciseId: null,
    };
    const queue = createInitialQueue(
      definitions.map((exercise) => ({
        id: `${sessionId}:${exercise.id}`,
        sessionId,
        exerciseId: exercise.id,
        order: exercise.order,
        status: "todo" as const,
        exerciseName: exercise.name,
        minReps: exercise.minReps,
        maxReps: exercise.maxReps,
        targetSets: exercise.targetSets,
        restSeconds: exercise.restSeconds,
        incrementLb: exercise.incrementLb,
        imageKey: exercise.imageKey,
      })),
    );
    try {
      await db.transaction("rw", db.sessions, db.exerciseStates, async () => {
        await db.sessions.add(session);
        await db.exerciseStates.bulkAdd(queue);
      });
      setActiveWorkoutSessionId(sessionId);
      setScreen("today");
      await refresh();
    } finally {
      startingWorkoutRef.current = false;
    }
  };

  const persistQueue = async (nextStates: WorkoutExerciseState[]) => {
    await db.exerciseStates.bulkPut(nextStates);
    await refresh();
  };

  const completeSet = async () => {
    if (!activeSession || !currentState) return;
    const weight = Number(draftWeight);
    const reps = Number(draftReps);
    if (!Number.isFinite(weight) || weight < 0 || draftWeight.trim() === "") {
      setEntryError("Enter the weight you used.");
      return;
    }
    if (!Number.isInteger(reps) || reps < 1) {
      setEntryError("Enter the reps you completed.");
      return;
    }
    setEntryError("");
    const timestamp = Date.now();
    const record: SetRecord = {
      id: createId("set"),
      sessionId: activeSession.id,
      workoutType: activeSession.workoutType,
      exerciseId: currentState.exerciseId,
      exerciseName: currentState.exerciseName,
      setNumber: nextSetNumber,
      actualWeight: weight,
      weightUnit: settings.weightUnit,
      weightKg: toKg(weight, settings.weightUnit),
      actualReps: reps,
      timestamp,
      localDateTime: toLocalIso(timestamp),
    };
    const exerciseFinished = nextSetNumber >= currentState.targetSets;
    const nextStates = exerciseFinished
      ? completeCurrentExercise(activeStates, currentState.id)
      : activeStates;
    const workoutFinished = exerciseFinished && queueIsComplete(nextStates);
    const restUpdate = restUpdateAfterSet({
      exerciseFinished,
      exerciseId: currentState.exerciseId,
      restSeconds: currentState.restSeconds,
      timestamp,
    });
    const sessionUpdate: Partial<WorkoutSession> = workoutFinished
      ? {
          status: "completed",
          finishTimestamp: timestamp,
          finishLocalDateTime: toLocalIso(timestamp),
          ...restUpdate,
        }
      : restUpdate;
    await db.transaction("rw", db.sets, db.exerciseStates, db.sessions, async () => {
      await db.sets.add(record);
      if (exerciseFinished) await db.exerciseStates.bulkPut(nextStates);
      await db.sessions.update(activeSession.id, sessionUpdate);
    });
    navigator.vibrate?.(18);
    if (workoutFinished) setSummarySessionId(activeSession.id);
    await refresh();
  };

  const adjustRest = async (seconds: number) => {
    if (!activeSession?.activeRestEndTimestamp) return;
    const next = Math.max(
      Date.now(),
      activeSession.activeRestEndTimestamp + seconds * 1000,
    );
    await db.sessions.update(activeSession.id, { activeRestEndTimestamp: next });
    await refresh();
  };

  const skipRest = async () => {
    if (!activeSession) return;
    await db.sessions.update(activeSession.id, {
      activeRestEndTimestamp: null,
      activeRestExerciseId: null,
    });
    await refresh();
  };

  const updateUnit = async (unit: WeightUnit) => {
    await db.settings.put({ id: "settings", weightUnit: unit });
    await refresh();
  };

  const saveExercise = async (exercise: ExerciseDefinition) => {
    const clean: ExerciseDefinition = {
      ...exercise,
      name: exercise.name.trim() || "Unnamed exercise",
      minReps: Math.max(1, Math.round(exercise.minReps)),
      maxReps: Math.max(
        Math.max(1, Math.round(exercise.minReps)),
        Math.round(exercise.maxReps),
      ),
      targetSets: Math.max(1, Math.round(exercise.targetSets)),
      restSeconds: Math.max(0, Math.round(exercise.restSeconds)),
      incrementLb: Math.max(0.1, exercise.incrementLb),
    };
    await db.exercises.put(clean);
    await refresh();
  };

  const exportBackupFile = async () => {
    const backup = await createBackup(db);
    downloadText(
      `workout-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      "application/json",
    );
  };

  const importBackupFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (
        !window.confirm(
          "Importing will replace the local workout database with this validated backup. Continue?",
        )
      ) {
        return;
      }
      await restoreBackup(db, parsed);
      await ensureDefaults();
      await archiveStaleSessions(db);
      await refresh();
      window.alert("Backup restored successfully.");
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "The backup could not be imported.",
      );
    }
  };

  const exportCsvFile = () => {
    downloadText(
      `workout-history-${new Date().toISOString().slice(0, 10)}.csv`,
      setsToCsv(sets),
      "text/csv;charset=utf-8",
    );
  };

  const resetData = async () => {
    if (
      !window.confirm(
        "Permanently delete every workout, set, and custom setting on this device? This cannot be undone.",
      )
    ) {
      return;
    }
    if (!window.confirm("Final confirmation: reset all workout data now?")) return;
    await resetAllData();
    setSummarySessionId(null);
    setActiveWorkoutSessionId(null);
    await refresh();
  };

  const removeSession = async (sessionId: string) => {
    if (!window.confirm("Delete this workout and every set recorded in it?")) return;
    await deleteWorkoutSession(sessionId);
    setSelectedSessionId(null);
    await refresh();
  };

  const summarySession = sessions.find(
    (session) => session.id === summarySessionId,
  );
  const latestSession = sessions
    .filter((session) => session.status === "completed")
    .sort((a, b) => b.startTimestamp - a.startTimestamp)[0];

  if (!ready) {
    return (
      <div className="boot-screen" role="status">
        <div className="boot-mark">W</div>
        <strong>Loading your workout log…</strong>
      </div>
    );
  }
  if (fatalError) {
    return (
      <div className="boot-screen error-screen">
        <div className="boot-mark">!</div>
        <h1>Your workout data could not be opened.</h1>
        <p>{fatalError}</p>
        <p>No data was reset or deleted.</p>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="brand"
          onClick={() => {
            setScreen("today");
            setSummarySessionId(null);
            setActiveWorkoutSessionId(null);
          }}
          aria-label="Go to workout main menu"
        >
          <span>W</span>
          <strong>WORKOUT</strong>
        </button>
        <span className={`network-pill ${online ? "" : "offline"}`}>
          {online ? "READY" : "OFFLINE"}
        </span>
      </header>
      {screen === "today" ? (
        summarySession ? (
          <WorkoutSummary
            session={summarySession}
            sessions={sessions}
            states={states.filter(
              (state) => state.sessionId === summarySession.id,
            )}
            sets={sets}
            unit={settings.weightUnit}
            onDone={() => setSummarySessionId(null)}
          />
        ) : activeSession ? (
          <WorkoutScreen
            session={activeSession}
            states={activeStates}
            sets={activeSets}
            unit={settings.weightUnit}
            suggestedWeight={suggestedWeight}
            historicalWeight={historicalWeight}
            usingDefaultWeight={usingDefaultWeight}
            draftWeight={draftWeight}
            draftReps={draftReps}
            error={entryError}
            onWeightChange={setDraftWeight}
            onRepsChange={setDraftReps}
            onCompleteSet={() => void completeSet()}
            onDefer={() =>
              currentState &&
              void persistQueue(
                deferCurrentExercise(activeStates, currentState.id),
              )
            }
            onJump={(id) =>
              void persistQueue(jumpToExercise(activeStates, id))
            }
            onRestAdjust={(seconds) => void adjustRest(seconds)}
            onRestSkip={() => void skipRest()}
            onExit={() => setActiveWorkoutSessionId(null)}
          />
        ) : (
          <HomeScreen
            onStart={(type) => void startWorkout(type)}
            latestSession={latestSession}
            activeSessions={todayActiveSessions}
            sets={sets}
          />
        )
      ) : null}
      {screen === "history" ? (
        <HistoryScreen
          exercises={exercises}
          sessions={sessions}
          states={states}
          sets={sets}
          unit={settings.weightUnit}
          selectedSessionId={selectedSessionId}
          selectedExerciseId={selectedExerciseId}
          onSelectSession={setSelectedSessionId}
          onSelectExercise={setSelectedExerciseId}
          onDeleteSession={(id) => void removeSession(id)}
        />
      ) : null}
      {screen === "settings" ? (
        <SettingsScreen
          exercises={exercises}
          settings={settings}
          persistentStorage={persistentStorage}
          onUnitChange={(unit) => void updateUnit(unit)}
          onSaveExercise={saveExercise}
          onExportBackup={() => void exportBackupFile()}
          onImportBackup={(event) => void importBackupFile(event)}
          onExportCsv={exportCsvFile}
          onReset={() => void resetData()}
        />
      ) : null}
      <nav className="bottom-nav" aria-label="Primary navigation">
        {(["today", "history", "settings"] as const).map((item) => (
          <button
            className={screen === item ? "active" : ""}
            key={item}
            onClick={() => {
              setScreen(item);
              if (item === "today") {
                setSummarySessionId(null);
                setActiveWorkoutSessionId(null);
              }
              if (item !== "history") {
                setSelectedSessionId(null);
                setSelectedExerciseId(null);
              }
            }}
          >
            <span aria-hidden="true">
              {item === "today" ? "●" : item === "history" ? "▤" : "⚙"}
            </span>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
    </div>
  );
}
