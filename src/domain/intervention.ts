import type { InterventionQualification, PedagogyEvent } from "../types/learning";
import {
  DOSE_PROTOCOL_ID,
  EVAL_CRITERION_VERSION,
  INTERVENTION_LOG_VERSION,
  PATTERN_ID,
} from "../data/constants";

const performed = new Set(["verified_best", "verified_acceptable", "playable_inexact", "incorrect"]);
const successful = new Set(["verified_best", "verified_acceptable"]);

export function appendPedagogyEvent(events: PedagogyEvent[], event: PedagogyEvent): PedagogyEvent[] {
  if (events.some((item) => item.id === event.id)) return events;
  return [...events, event].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

function activeSession(events: PedagogyEvent[], exercise: PedagogyEvent): PedagogyEvent | null {
  const starts = events
    .filter((event) => event.eventType === "training_session_started" && event.occurredAt <= exercise.occurredAt)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const start = starts.at(-1);
  if (!start) return null;
  return events.some((event) =>
    event.eventType === "training_session_completed" &&
    event.occurredAt >= start.occurredAt &&
    event.occurredAt < exercise.occurredAt
  ) ? null : start;
}

export function calculateQualification(
  events: PedagogyEvent[],
  previous: InterventionQualification | null = null,
): InterventionQualification {
  const relevant = [...events]
    .filter((event) => event.patternId === PATTERN_ID)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  let lessonCompletedAt: string | null = null;
  let confirmedExercises = 0;
  let verifiedSuccesses = 0;
  let firstQualifiedAt: string | null = null;
  const sessions = new Map<string, PedagogyEvent>();
  const days = new Set<string>();
  const evidence = new Set<string>();

  for (const event of relevant) {
    if (event.eventType === "lesson_completed" && !lessonCompletedAt) {
      lessonCompletedAt = event.occurredAt;
      evidence.add(event.id);
    }
    if (
      event.eventType === "exercise_confirmed" &&
      event.evalCriterionVersion === EVAL_CRITERION_VERSION &&
      event.evaluationStatus !== null &&
      performed.has(event.evaluationStatus)
    ) {
      confirmedExercises += 1;
      evidence.add(event.id);
      if (successful.has(event.evaluationStatus)) verifiedSuccesses += 1;
      const session = activeSession(relevant, event);
      if (session) {
        sessions.set(session.id, session);
        days.add(session.occurredAt.slice(0, 10));
        evidence.add(session.id);
      }
    }
    if (
      !firstQualifiedAt &&
      lessonCompletedAt &&
      confirmedExercises >= 12 &&
      verifiedSuccesses >= 8 &&
      sessions.size >= 2 &&
      days.size >= 2
    ) firstQualifiedAt = event.occurredAt;
  }

  const qualifiedAt = previous?.qualifiedAt ?? firstQualifiedAt;
  const missingRequirements: string[] = [];
  if (!lessonCompletedAt) missingRequirements.push("lesson_completed");
  if (confirmedExercises < 12) missingRequirements.push(`confirmed_exercises:${confirmedExercises}/12`);
  if (verifiedSuccesses < 8) missingRequirements.push(`verified_successes:${verifiedSuccesses}/8`);
  if (sessions.size < 2) missingRequirements.push(`distinct_sessions:${sessions.size}/2`);
  if (days.size < 2) missingRequirements.push(`distinct_calendar_days:${days.size}/2`);

  return {
    protocolId: DOSE_PROTOCOL_ID,
    patternId: PATTERN_ID,
    qualified: qualifiedAt !== null,
    qualifiedAt,
    lessonCompletedAt,
    confirmedExercises,
    verifiedSuccesses,
    distinctSessions: sessions.size,
    distinctCalendarDays: days.size,
    missingRequirements: qualifiedAt ? [] : missingRequirements,
    evidenceEventIds: [...evidence],
  };
}

export function pedagogyEvent(
  input: Omit<PedagogyEvent, "patternId" | "source"> & Partial<Pick<PedagogyEvent, "patternId" | "source">>,
): PedagogyEvent {
  return {
    ...input,
    patternId: input.patternId ?? PATTERN_ID,
    source: input.source ?? "app",
  };
}

export { INTERVENTION_LOG_VERSION };
