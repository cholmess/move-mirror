import { visibleSkills, type SkillId } from "../data/skills";
import type { AttemptRecord, SkillState } from "../types/learning";
import { getSkill } from "../data/skills";
import { affectsDomain } from "@shared/evaluation/classify.js";
import type { EvaluationStatus } from "@shared/evaluation/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function initialSkillState(skillId: SkillId): SkillState {
  const def = getSkill(skillId);
  const c = def.initialConfidence;
  const alpha = 1 + c * 4;
  const beta = 1 + (1 - c) * 4;
  return {
    skillId,
    successes: 0,
    failures: 0,
    partials: 0,
    unverifiedCount: 0,
    alpha,
    beta,
    confidence: c,
    masteryEstimate: alpha / (alpha + beta),
    lastPracticeAt: null,
    nextReviewAt: null,
    history: [
      {
        at: new Date().toISOString(),
        mastery: alpha / (alpha + beta),
        event: "baseline_from_phase2_review",
      },
    ],
  };
}

export function createInitialSkills(): Record<SkillId, SkillState> {
  const out = {} as Record<SkillId, SkillState>;
  for (const s of visibleSkills) {
    out[s.id] = initialSkillState(s.id);
  }
  return out;
}

function applyStatusToCounters(
  status: EvaluationStatus,
  counters: { successes: number; failures: number; partials: number; unverifiedCount: number }
) {
  switch (status) {
    case "verified_best":
    case "verified_acceptable":
      counters.successes += 1;
      break;
    case "playable_inexact":
      counters.partials += 1;
      break;
    case "incorrect":
      counters.failures += 1;
      break;
    case "unverified":
    case "illegal":
      counters.unverifiedCount += 1;
      break;
  }
}

function alphaBetaDelta(status: EvaluationStatus): { da: number; db: number } | null {
  if (!affectsDomain(status)) return null;
  switch (status) {
    case "verified_best":
    case "verified_acceptable":
      return { da: 1, db: 0 };
    case "playable_inexact":
      return { da: 0.5, db: 0.5 };
    case "incorrect":
      return { da: 0, db: 1 };
    default:
      return null;
  }
}

function spacedReviewDays(mastery: number, status: EvaluationStatus): number {
  const ok =
    status === "verified_best" || status === "verified_acceptable";
  if (ok && mastery > 0.7) return 3;
  if (mastery > 0.55) return 2;
  return 1;
}

export function updateSkillsFromAttempt(
  skills: Record<SkillId, SkillState>,
  attempt: AttemptRecord
): Record<SkillId, SkillState> {
  const next = { ...skills };
  const now = attempt.recordedAt;
  const delta = alphaBetaDelta(attempt.evaluationStatus);

  for (const skillId of attempt.skillIds) {
    const prev = next[skillId] ?? initialSkillState(skillId);
    let { alpha, beta, successes, failures, partials, unverifiedCount } = prev;

    const counters = { successes, failures, partials, unverifiedCount };
    applyStatusToCounters(attempt.evaluationStatus, counters);
    ({ successes, failures, partials, unverifiedCount } = counters);

    if (delta) {
      alpha += delta.da;
      beta += delta.db;
    }

    const masteryEstimate = alpha / (alpha + beta);
    const practiced =
      attempt.evaluationStatus !== "unverified" &&
      attempt.evaluationStatus !== "illegal";
    const confidence = Math.min(
      0.95,
      0.5 + (successes + failures + partials) * 0.04
    );
    const days = spacedReviewDays(masteryEstimate, attempt.evaluationStatus);
    const nextReview = practiced
      ? new Date(new Date(now).getTime() + days * DAY_MS).toISOString()
      : prev.nextReviewAt;

    next[skillId] = {
      ...prev,
      alpha,
      beta,
      successes,
      failures,
      partials,
      unverifiedCount,
      masteryEstimate,
      confidence,
      lastPracticeAt: practiced ? now : prev.lastPracticeAt,
      nextReviewAt: nextReview,
      history: [
        ...prev.history.slice(-19),
        {
          at: now,
          mastery: masteryEstimate,
          event: `${attempt.exerciseId}:${attempt.evaluationStatus}`,
        },
      ],
    };
  }

  return next;
}

/** Reconstruye α/β desde intentos (post-migración o reset de perfil). */
export function rebuildSkillsFromAttempts(
  attempts: AttemptRecord[]
): Record<SkillId, SkillState> {
  let skills = createInitialSkills();
  const sorted = [...attempts].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
  for (const attempt of sorted) {
    if (attempt.assisted) continue;
    skills = updateSkillsFromAttempt(skills, attempt);
  }
  return skills;
}

export function aggregateEvidence(skillId: SkillId, attempts: AttemptRecord[]) {
  const def = getSkill(skillId);
  const related = attempts.filter((a) => a.skillIds.includes(skillId));
  return {
    reviewEvidence: def.initialEvidence,
    practiceAttempts: related.length,
    recentVerifiedSuccess: related.filter(
      (a) =>
        !a.assisted && (a.evaluationStatus === "verified_best" ||
        a.evaluationStatus === "verified_acceptable")
    ).length,
    recentIncorrect: related.filter((a) => a.evaluationStatus === "incorrect")
      .length,
    recentUnverified: related.filter((a) => a.evaluationStatus === "unverified")
      .length,
  };
}
