import type { TFunction } from "i18next";
import type { EvaluationStatus } from "@shared/evaluation/types";
import type { DefensiveResource, DefenseSelectionReasonPayload } from "../types/defense";
import type { ExposureValidity } from "../types/transfer";
import type { ImportJob } from "../types/games";
import type { SupportedLocale } from "./types";
import { i18n } from "./i18nInstance";

export {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPercentFrom100,
} from "./formatters";

const PIECE_SYMBOL: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
};

const PIECE_I18N_KEY: Record<string, string> = {
  K: "technical:piece.king",
  Q: "technical:piece.queen",
  R: "technical:piece.rook",
  B: "technical:piece.bishop",
  N: "technical:piece.knight",
  P: "technical:piece.pawn",
};

export function getT(locale?: SupportedLocale): TFunction {
  const lng = (locale ?? i18n.language) as SupportedLocale;
  return ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ...options, lng })) as TFunction;
}

function hasTranslation(key: string, locale?: SupportedLocale): boolean {
  return i18n.exists(key, { lng: (locale ?? i18n.language) as SupportedLocale });
}

export function formatEvaluationStatus(status: EvaluationStatus, locale?: SupportedLocale): string {
  return getT(locale)(`common:evaluationStatus.${status}`);
}

export function formatEvaluationSummary(status: EvaluationStatus, locale?: SupportedLocale): string {
  return getT(locale)(`common:evaluationSummary.${status}`);
}

export function formatExposureStatus(status: ExposureValidity, locale?: SupportedLocale): string {
  return getT(locale)(`transfer:exposure.${status}`);
}

export function formatDefensiveResource(resource: DefensiveResource | "not_sure", locale?: SupportedLocale): string {
  if (resource === "not_sure") return getT(locale)("defense:defensiveResource.not_sure");
  return getT(locale)(`defense:defensiveResource.${resource}`);
}

export function formatImportStatus(status: ImportJob["status"], locale?: SupportedLocale): string {
  return getT(locale)(`import:jobStatus.${status}`);
}

export function formatTimeControl(category: string, locale?: SupportedLocale): string {
  const key = `games:timeControl.${category}`;
  const t = getT(locale);
  return hasTranslation(key, locale) ? t(key) : category;
}

export function formatImportSource(source: ImportJob["sourceType"], locale?: SupportedLocale): string {
  return getT(locale)(`import:source.${source}`);
}

export function formatEvidenceLevel(
  level: "low" | "medium" | "high" | "baja" | "media" | "alta",
  locale?: SupportedLocale,
): string {
  const map: Record<string, string> = {
    low: "common:evidence.low",
    medium: "common:evidence.medium",
    high: "common:evidence.high",
    baja: "common:evidence.low",
    media: "common:evidence.medium",
    alta: "common:evidence.high",
  };
  return getT(locale)(map[level] ?? "common:evidence.medium");
}

export function formatPedagogyActionTitle(action: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  const key = `transfer:pedagogyAction.${action}.title`;
  return hasTranslation(key, locale) ? t(key) : action;
}

export function formatPedagogyActionExplanation(action: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  const key = `transfer:pedagogyAction.${action}.explanation`;
  return hasTranslation(key, locale) ? t(key) : "";
}

export function formatComparisonStatus(
  status: "insufficient_data" | "early_signal" | "observed_improvement" | "no_clear_reduction",
  locale?: SupportedLocale,
): { label: string; meaning: string; notMeaning: string } {
  const t = getT(locale);
  return {
    label: t(`transfer:comparison.${status}.label`),
    meaning: t(`transfer:comparison.${status}.meaning`),
    notMeaning: t(`transfer:comparison.${status}.notMeaning`),
  };
}

export function formatTransferExclusion(reason: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  const key = `transfer:exclusion.${reason}`;
  return hasTranslation(key, locale) ? t(key) : reason;
}

export function formatGameIneligibility(reason: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  const key = `games:ineligibility.${reason}`;
  return hasTranslation(key, locale) ? t(key) : reason;
}

export function formatErrorCode(code: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  const key = `errors:${code}`;
  return hasTranslation(key, locale) ? t(key) : t("errors:generic");
}

export function formatExercisePrompt(playedMoveSan: string, locale?: SupportedLocale): string {
  return getT(locale)("training:exercisePrompt", { move: formatMoveForDisplay(playedMoveSan, locale) });
}

export function formatMoveForDisplay(san: string, locale?: SupportedLocale): string {
  if (!san?.trim()) return san;
  void locale;
  let out = "";
  let i = 0;
  const s = san.trim();
  while (i < s.length) {
    const ch = s[i]!;
    if ("KQRBN".includes(ch)) {
      out += PIECE_SYMBOL[ch] ?? ch;
      i += 1;
      continue;
    }
    if (ch === "O" && s.slice(i, i + 3) === "O-O") {
      if (s.slice(i, i + 5) === "O-O-O") {
        out += "O-O-O";
        i += 5;
      } else {
        out += "O-O";
        i += 3;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function moveAriaLabel(san: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  let label = san;
  for (const [letter, key] of Object.entries(PIECE_I18N_KEY)) {
    label = label.replace(new RegExp(letter, "g"), t(key));
  }
  return label;
}

export function formatSideToMove(side: "w" | "b", locale?: SupportedLocale): string {
  return side === "w" ? getT(locale)("common:white") : getT(locale)("common:black");
}

export function formatPhase(phase: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  const key = `common:phase.${phase}`;
  return hasTranslation(key, locale) ? t(key) : phase;
}

export function formatInterventionRequirement(code: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  const key = `transfer:interventionRequirement.${code}`;
  if (hasTranslation(key, locale)) return t(key);
  const match = /^(\w+):(\d+)\/(\d+)$/.exec(code);
  if (match) {
    return t(`transfer:interventionRequirement.${match[1]}`, {
      current: match[2],
      required: match[3],
    });
  }
  return code;
}

export function formatDuplicateDisposition(disposition: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  const key = `games:duplicateDisposition.${disposition}`;
  return hasTranslation(key, locale) ? t(key) : disposition;
}

export function formatProfileHistoryEvent(event: string, locale?: SupportedLocale): string {
  if (event === "baseline_from_phase2_review") {
    return getT(locale)("profile:history.baselineReview");
  }
  const parts = event.split(":");
  if (parts.length >= 2 && parts[1]) {
    return formatEvaluationStatus(parts[1] as EvaluationStatus, locale);
  }
  return event;
}

export function formatObservableReasonFragment(fragment: string, locale?: SupportedLocale): string {
  const t = getT(locale);
  const key = `domain:observable.${hashFragmentKey(fragment)}`;
  return hasTranslation(key, locale) ? t(key) : fragment;
}

function hashFragmentKey(fragment: string): string {
  return fragment
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80)
    .toLowerCase();
}

export function formatObservableReason(reason: string | null | undefined, locale?: SupportedLocale): string {
  if (!reason) return "—";
  return reason
    .split("·")
    .map((part) => formatObservableReasonFragment(part.trim(), locale))
    .join(" · ");
}

function formatDefenseSelectionReasonObject(
  reason: { key: string; params?: Record<string, string | number> },
  locale?: SupportedLocale,
): string {
  const t = getT(locale);
  const params = { ...(reason.params ?? {}) };
  if (typeof params.resource === "string") {
    params.resource = formatDefensiveResource(params.resource as DefensiveResource, locale);
  }
  const key = `defense:selection.${reason.key}`;
  if (hasTranslation(key, locale)) return t(key, params);
  return t("defense:selection.defaultPriority");
}

export function formatDefenseSelectionReason(
  reason: DefenseSelectionReasonPayload,
  locale?: SupportedLocale,
): string {
  const t = getT(locale);
  if (reason && typeof reason === "object") {
    return formatDefenseSelectionReasonObject(reason, locale);
  }
  if (typeof reason === "string" && reason.trim().startsWith("{")) {
    try {
      return formatDefenseSelectionReason(JSON.parse(reason) as DefenseSelectionReasonPayload, locale);
    } catch {
      /* legacy string */
    }
  }
  const text = String(reason);
  if (text.includes("Poca evidencia de dominio")) return t("defense:selection.lowDomainEvidence");
  if (text.includes("Poca evidencia")) return t("defense:selection.lowEvidence");
  if (text.includes("Variedad adaptativa")) return t("defense:selection.adaptiveVariety");
  if (text.includes("Priorizaremos")) return t("defense:selection.defaultPriority");
  const selected = /Seleccionado en el puesto (\d+): calidad pedagógica (\d+) y ajuste de diversidad (\d+)/i.exec(
    text,
  );
  if (selected) {
    return t("defense:selection.rankingSelected", {
      rank: selected[1],
      quality: selected[2],
      diversity: selected[3],
    });
  }
  const notSelected = /Elegible, pero quedó en el puesto (\d+)\. No fue seleccionado por la cuota de (\d+)/i.exec(
    text,
  );
  if (notSelected) {
    const categories = /diversidad \(([^)]+)\)/i.exec(text);
    const detail = categories
      ? t("defense:selection.rankingNotSelectedDetailCategories", { categories: categories[1] })
      : t("defense:selection.rankingNotSelectedDetailCoverage");
    return t("defense:selection.rankingNotSelected", {
      rank: notSelected[1],
      limit: notSelected[2],
      detail,
    });
  }
  const rank = /puesto (\d+)/i.exec(text);
  if (rank) return t("defense:selection.ranked", { rank: rank[1] });
  if (text.includes("No hay posiciones elegibles")) return t("defense:selection.noEligible");
  const resourceReview = /defensa de ([a-z_]+) todavía necesita revisión/i.exec(text);
  if (resourceReview) {
    return formatDefenseSelectionReasonObject(
      { key: "resourceReview", params: { resource: resourceReview[1] } },
      locale,
    );
  }
  const lowEvidenceResource = /poca evidencia de dominio en ([a-z_]+)/i.exec(text);
  if (lowEvidenceResource) {
    return formatDefenseSelectionReasonObject(
      { key: "lowEvidenceResource", params: { resource: lowEvidenceResource[1] } },
      locale,
    );
  }
  return t("defense:selection.defaultPriority");
}

export function formatAdaptiveReason(key: string, params: Record<string, unknown>, locale?: SupportedLocale): string {
  return getT(locale)(`adaptive:${key}`, params);
}

export function formatSelectionReasons(
  reasons: Array<{ key: string; params?: Record<string, string | number> }>,
  locale?: SupportedLocale,
): string {
  return reasons.map((reason) => formatAdaptiveReason(reason.key, reason.params ?? {}, locale)).join(" · ");
}

export function formatDefenseProfileText(
  profile: {
    observationKey: "noAttempts" | "resourceErrors";
    observationParams: { errors?: number; attempts?: number; resource?: DefensiveResource };
    hypothesisKey: "insufficientVolume" | "resourceOmission";
    hypothesisParams: { resource?: DefensiveResource };
  },
  locale?: SupportedLocale,
): { observation: string; hypothesis: string } {
  const t = getT(locale);
  const observation =
    profile.observationKey === "noAttempts"
      ? t("domain:defenseProfile.noAttempts")
      : t("domain:defenseProfile.resourceErrors", {
          errors: profile.observationParams.errors ?? 0,
          attempts: profile.observationParams.attempts ?? 0,
          resource: formatDefensiveResource(profile.observationParams.resource ?? "unknown", locale),
        });
  const hypothesis =
    profile.hypothesisKey === "insufficientVolume"
      ? t("domain:defenseProfile.insufficientVolume")
      : t("domain:defenseProfile.resourceOmission", {
          resource: formatDefensiveResource(profile.hypothesisParams.resource ?? "unknown", locale),
        });
  return { observation, hypothesis };
}
