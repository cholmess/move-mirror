import { positionKey } from "./detect.js";

export const HYPOTHESIS_PROBE_VERSION = "hypothesis-probe-v1";

const DIRECTLY_OBSERVABLE = new Set(["reply_search", "candidate_comparison", "consequence_evaluation"]);

function features(row, exposures) {
  const reply = row.replySan ?? "";
  const exposed = exposures.some((item) => item.positionKey === positionKey(row.fen));
  return {
    novel: !exposed,
    hasReply: Boolean(row.replyUci || reply),
    forcingReply: /[+#]/.test(reply) || reply.includes("x"),
    longLine: (row.referencePv?.length ?? 0) >= 3,
    severeLoss: (row.loss ?? 0) >= 200,
    closed: Boolean(row.context?.closed),
    endgame: Boolean(row.context?.endgame),
  };
}

function score(category, row, signals) {
  // Novel evidence outranks a perfect but already exposed diagnostic shape.
  let value = signals.novel ? 100 : 0;
  value += Math.min(20, Math.max(0, (row.loss ?? 0) / 25));
  if (category === "reply_search") value += (signals.forcingReply ? 55 : 0) + (signals.hasReply ? 15 : 0);
  else if (category === "candidate_comparison") value += (signals.hasReply ? 30 : 0) + (signals.longLine ? 30 : 0) + (!signals.forcingReply ? 10 : 0);
  else if (category === "calculation_depth") value += (signals.longLine ? 60 : 0) + (signals.hasReply ? 10 : 0);
  else if (category === "consequence_evaluation") value += (signals.hasReply ? 35 : 0) + (signals.severeLoss ? 30 : 0) + (!signals.forcingReply ? 10 : 0);
  else if (category === "concept_recognition") value += (signals.closed || signals.endgame ? 55 : 0);
  else if (category === "strategic_planning") value += (signals.closed ? 50 : 0) + (signals.hasReply && !signals.forcingReply ? 25 : 0);
  return value;
}

function reasons(signals) {
  return Object.entries(signals).filter(([, active]) => active).map(([name]) => name);
}

/**
 * Orders already-reserved guided positions to probe the primary hypothesis and its alternatives.
 * The holdout is deliberately planned elsewhere and never receives these labels.
 */
export function planHypothesisProbe(guided, hypothesis, exposures = []) {
  if (!hypothesis || !guided.length) return { ordered: [...guided], plan: null };
  const categories = [hypothesis.category, ...(hypothesis.alternatives ?? []).map((item) => item.category)]
    .filter((category, index, list) => category && list.indexOf(category) === index)
    .slice(0, guided.length);
  const remaining = [...guided];
  const selected = [];
  for (const category of categories) {
    const ranked = remaining.map((row) => {
      const rowFeatures = features(row, exposures);
      return { row, signals: rowFeatures, score: score(category, row, rowFeatures) };
    }).sort((a, b) => b.score - a.score || String(a.row.exerciseId).localeCompare(String(b.row.exerciseId)));
    const best = ranked[0];
    if (!best) continue;
    selected.push({ ...best, category });
    remaining.splice(remaining.findIndex((row) => row.exerciseId === best.row.exerciseId), 1);
  }
  const primary = hypothesis.category;
  const fillers = remaining.map((row) => {
    const rowFeatures = features(row, exposures);
    return { row, signals: rowFeatures, score: score(primary, row, rowFeatures), category: primary };
  }).sort((a, b) => b.score - a.score || String(a.row.exerciseId).localeCompare(String(b.row.exerciseId)));
  const orderedSlots = [...selected, ...fillers];
  return {
    ordered: orderedSlots.map((item) => item.row),
    plan: {
      version: HYPOTHESIS_PROBE_VERSION,
      hypothesisId: hypothesis.id,
      primaryCategory: primary,
      alternativeCategories: categories.filter((category) => category !== primary),
      slots: orderedSlots.map((item) => ({
        recordId: item.row.exerciseId,
        targetCategory: item.category,
        score: Math.round(item.score),
        selectionReasons: reasons(item.signals),
        measurability: DIRECTLY_OBSERVABLE.has(item.category) ? "direct" : "partial",
      })),
    },
  };
}

export function classifyProbeObservation(attempt, hypothesis, slot) {
  if (!hypothesis || !slot) return null;
  const observedCategory = {
    search: "reply_search",
    compare: "candidate_comparison",
    evaluate: "consequence_evaluation",
    uncertain: "insufficient_evidence",
  }[attempt.coaching?.intervention] ?? null;
  const alternatives = new Set((hypothesis.alternatives ?? []).map((item) => item.category));
  const direction = observedCategory === hypothesis.category
    ? "support"
    : observedCategory && alternatives.has(observedCategory)
      ? "contradict"
      : "inconclusive";
  return {
    observedCategory,
    expectedCategory: slot.targetCategory,
    direction,
    measurability: slot.measurability,
  };
}
