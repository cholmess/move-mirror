import type { TFunction } from "i18next";
import type { Exercise } from "../data/exerciseTypes";
import type { EvaluationStatus } from "@shared/evaluation/types";

export function buildReflectionPrompt(
  exercise: Exercise,
  status: EvaluationStatus,
  t: TFunction,
): string {
  if (status === "verified_best" || status === "verified_acceptable") {
    return t("training:reflectionVerified");
  }
  const reply =
    exercise.realLineSan?.split(/\s+/)[1] ??
    exercise.realLineUci?.[1] ??
    "rival";
  return t("training:reflectionBeforeMove", {
    hint: formatReplyHint(reply, exercise, t),
  });
}

function formatReplyHint(reply: string, exercise: Exercise, t: TFunction): string {
  if (reply.includes("+") || reply.endsWith("+")) {
    return t("training:reflectionHintCheck", { reply });
  }
  if (reply.includes("x") || reply.includes("X")) {
    return t("training:reflectionHintCapture", { reply });
  }
  if (exercise.observableReason?.includes("forzada")) {
    return t("training:reflectionHintForced");
  }
  return t("training:reflectionHintGeneric", { reply });
}

export function opponentStrongestReply(
  exercise: Exercise,
  engineReplySan: string | null,
): string | null {
  if (engineReplySan) return engineReplySan;
  const fromLine = exercise.realLineSan?.split(/\s+/)[1];
  if (fromLine) return fromLine;
  if (exercise.realLineUci?.[1] && exercise.realMoveUci) {
    return null;
  }
  return null;
}
