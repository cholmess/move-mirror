import type { Exercise } from "../data/exerciseTypes";
import type { EvaluationStatus } from "@shared/evaluation/types";
import { pedagogicalLabel } from "@shared/evaluation/classify.js";

export { pedagogicalLabel };

export function buildReflectionPrompt(
  exercise: Exercise,
  status: EvaluationStatus
): string {
  if (status === "verified_best" || status === "verified_acceptable") {
    return "¿Qué comprobación del rival te convenció de que tu candidata era segura?";
  }
  const reply =
    exercise.realLineSan?.split(/\s+/)[1] ??
    exercise.realLineUci?.[1] ??
    "la respuesta táctica del rival";
  return `Antes de jugar, ¿consideraste ${formatReplyHint(reply, exercise)}?`;
}

function formatReplyHint(reply: string, exercise: Exercise): string {
  if (reply.includes("+") || reply.endsWith("+")) {
    return `este jaque del rival (${reply})`;
  }
  if (reply.includes("x") || reply.includes("X")) {
    return `esta captura o recaptura del rival (${reply})`;
  }
  if (exercise.observableReason?.includes("forzada")) {
    return "la captura o jaque forzado más incómodo del rival";
  }
  return `la respuesta más incómoda del rival (${reply})`;
}

export function pedagogicalSummary(status: EvaluationStatus): string {
  const label = pedagogicalLabel(status);
  switch (status) {
    case "verified_best":
      return `${label}: encaja con la línea recomendada para esta posición.`;
    case "verified_acceptable":
      return `${label}: alternativa sólida dentro del margen verificado.`;
    case "playable_inexact":
      return `${label}: jugable, pero pierde algo de precisión frente a la mejor opción.`;
    case "incorrect":
      return `${label}: conviene revisar CCT y la refutación antes de confirmar.`;
    case "unverified":
      return `${label}: la jugada es legal, pero todavía no ha sido verificada.`;
    case "illegal":
      return `${label}: esa jugada no es legal en esta posición.`;
  }
}

export function opponentStrongestReply(
  exercise: Exercise,
  engineReplySan: string | null
): string | null {
  if (engineReplySan) return engineReplySan;
  const fromLine = exercise.realLineSan?.split(/\s+/)[1];
  if (fromLine) return fromLine;
  if (exercise.realLineUci?.[1] && exercise.realMoveUci) {
    return null;
  }
  return null;
}
