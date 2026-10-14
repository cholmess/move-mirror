import { exercises, type Exercise } from "../data/exercises";
import type { AppState } from "../types/learning";
import { PATTERN_ID } from "../data/constants";
import { primaryPattern } from "../data/pattern";
import { isSuccessForAdaptive } from "@shared/evaluation/classify.js";

export interface SelectionReason {
  key: string;
  params?: Record<string, string | number>;
}

export interface SelectionResult {
  exercise: Exercise;
  reasons: SelectionReason[];
}

function attemptsForExercise(state: AppState, exerciseId: string) {
  return state.attempts.filter((a) => a.exerciseId === exerciseId);
}

function lastAttemptAt(state: AppState, exerciseId: string): number {
  const list = attemptsForExercise(state, exerciseId);
  if (list.length === 0) return 0;
  return Math.max(...list.map((a) => new Date(a.recordedAt).getTime()));
}

function successRate(state: AppState, exerciseId: string): number | null {
  const list = attemptsForExercise(state, exerciseId);
  if (list.length === 0) return null;
  const verified = list.filter((a) => !a.assisted && a.evalVerified && a.evaluationStatus !== "unverified");
  if (verified.length === 0) return null;
  const ok = verified.filter((a) => isSuccessForAdaptive(a.evaluationStatus)).length;
  return ok / verified.length;
}

/** Heurística transparente — sustituible por AdaptiveModelService en el futuro. */
export function selectNextExercise(state: AppState, excludeId?: string): SelectionResult {
  const now = Date.now();
  const reasons: SelectionReason[] = [];

  const scored = exercises.filter(ex => ex.id !== excludeId || exercises.length === 1).map((ex) => {
    let score = 0;
    const localReasons: SelectionReason[] = [];

    if (ex.patternId === PATTERN_ID) {
      score += 3;
      localReasons.push({ key: "patternPriority" });
    }

    score += ex.severity * 0.5;
    localReasons.push({ key: "severity", params: { severity: ex.severity } });

    const attempts = attemptsForExercise(state, ex.id);
    if (ex.tier === "core") {
      score += 1.5;
      localReasons.push({ key: "coreExercise" });
    }

    if (attempts.length === 0) {
      score += 4;
      localReasons.push({ key: "newPosition" });
    } else {
      const rate = successRate(state, ex.id);
      if (rate !== null && rate < 0.5) {
        score += 3;
        localReasons.push({ key: "lowPerformance" });
      }
      const last = lastAttemptAt(state, ex.id);
      const daysSince = (now - last) / (86400000);
      if (daysSince >= 1) {
        score += 2;
        localReasons.push({ key: "spacedRepetition" });
      }
    }

    const skillUncertainty = ex.skillIds.reduce((acc, sid) => {
      const st = state.skills[sid];
      if (!st) return acc;
      return acc + (1 - st.confidence);
    }, 0);
    score += skillUncertainty * 2;
    if (skillUncertainty > 0.5) {
      localReasons.push({ key: "skillUncertainty" });
    }

    const variety =
      ex.phase === "endgame" ? 1 : ex.phase === "opening" ? 0.5 : 0.8;
    score += variety;
    localReasons.push({ key: "phaseVariety", params: { phase: ex.phase } });

    return { ex, score, localReasons };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  reasons.push(...best.localReasons.slice(0, 4));
  reasons.unshift({
    key: "activePattern",
    params: { pct: primaryPattern.evidence.pctValidation },
  });

  return { exercise: best.ex, reasons };
}

export function formatSelectionExplanation(result: SelectionResult): string {
  return result.reasons.map((reason) => `${reason.key}:${JSON.stringify(reason.params ?? {})}`).join("|");
}
