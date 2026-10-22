import { positionKey } from "./detect.js";
import { applyHypothesisEvidence, deriveHypothesisEvidenceState } from "./pedagogy.js";

export const REAL_GAME_HYPOTHESIS_VERSION = "real-game-hypothesis-v1";

const DIRECT_CATEGORIES = new Set([
  "reply_search",
  "candidate_comparison",
  "consequence_evaluation",
]);

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function signature(record) {
  const reply = record.replySan ?? "";
  const hasReply = Boolean(record.replyUci || reply);
  const forcingReply = /[+#]/.test(reply) || reply.includes("x");
  const longLine = (record.referencePv?.length ?? 0) >= 3;
  const severeLoss = (record.loss ?? 0) >= 200;
  return {
    reply_search: forcingReply,
    consequence_evaluation: hasReply && !forcingReply && severeLoss,
    candidate_comparison: hasReply && !forcingReply && !severeLoss && longLine,
    reasons: [
      hasReply && "has_reply",
      forcingReply && "forcing_reply",
      longLine && "long_line",
      severeLoss && "severe_loss",
    ].filter(Boolean),
  };
}

/**
 * Real-game evidence is eligible only after a directly measurable guided probe and
 * its blind holdout. This prevents old games or recurrence alone from confirming a cause.
 */
export function realGameEvidenceGate(hypothesis) {
  const directSupports = (hypothesis?.observations ?? []).filter((row) =>
    row.source === "practice_probe"
    && row.direction === "support"
    && row.measurability === "direct"
    && timestamp(row.at) !== null,
  );
  const latestProbe = directSupports.sort((a, b) => timestamp(b.at) - timestamp(a.at))[0] ?? null;
  const holdouts = (hypothesis?.observations ?? []).filter((row) =>
    row.source === "holdout"
    && timestamp(row.at) !== null
    && (!latestProbe || timestamp(row.at) >= timestamp(latestProbe.at)),
  );
  const latestHoldout = holdouts.sort((a, b) => timestamp(b.at) - timestamp(a.at))[0] ?? null;
  if (!DIRECT_CATEGORIES.has(hypothesis?.category)) return { eligible: false, reason: "cause_not_directly_observable", cutoffAt: null };
  if (!latestProbe) return { eligible: false, reason: "direct_probe_required", cutoffAt: null };
  if (!latestHoldout) return { eligible: false, reason: "blind_holdout_required", cutoffAt: null };
  return { eligible: true, reason: null, cutoffAt: latestHoldout.at };
}

function classifyRecord(record, hypothesis) {
  const signals = signature(record);
  const categories = [hypothesis.category, ...(hypothesis.alternatives ?? []).map((row) => row.category)]
    .filter((category, index, list) => DIRECT_CATEGORIES.has(category) && list.indexOf(category) === index);
  const matching = categories.filter((category) => signals[category]);
  const direction = matching.length !== 1
    ? "inconclusive"
    : matching[0] === hypothesis.category
      ? "support"
      : "contradict";
  return { direction, observedCategory: matching.length === 1 ? matching[0] : null, signatureReasons: signals.reasons };
}

function evidenceForHypothesis(hypothesis, records, exposures) {
  const gate = realGameEvidenceGate(hypothesis);
  if (!gate.eligible) return [];
  const cutoff = timestamp(gate.cutoffAt);
  const exposed = new Set(exposures.map((row) => row.positionKey));
  const alreadySeenGames = new Set((hypothesis.observations ?? [])
    .filter((row) => row.source === "real_game")
    .map((row) => row.gameId));
  const byGame = new Map();
  for (const record of records) {
    if (record.patternId !== hypothesis.patternId || record.datePrecision !== "exact") continue;
    const startedAt = timestamp(record.gameStartedAt);
    if (startedAt === null || startedAt <= cutoff || exposed.has(positionKey(record.fen)) || alreadySeenGames.has(record.gameId)) continue;
    const classified = classifyRecord(record, hypothesis);
    const candidate = { record, ...classified };
    const previous = byGame.get(record.gameId);
    const rank = (row) => ({ support: 3, contradict: 3, inconclusive: 1 }[row.direction] * 1000 + (row.record.loss ?? 0));
    if (!previous || rank(candidate) > rank(previous)) byGame.set(record.gameId, candidate);
  }
  return [...byGame.values()]
    .sort((a, b) => String(a.record.gameStartedAt).localeCompare(String(b.record.gameStartedAt)) || String(a.record.gameId).localeCompare(String(b.record.gameId)))
    .map(({ record, direction, observedCategory, signatureReasons }) => ({
      id: `real-game:${REAL_GAME_HYPOTHESIS_VERSION}:${hypothesis.id}:${record.gameId}`,
      source: "real_game",
      direction,
      at: record.gameEndedAt ?? record.gameStartedAt,
      gameId: record.gameId,
      recordId: record.exerciseId,
      moveNumber: record.moveNumber,
      observedCategory,
      expectedCategory: hypothesis.category,
      signatureReasons,
      engineVersion: record.engineVersion,
      engineSha256: record.engineSha256,
      evidenceVersion: REAL_GAME_HYPOTHESIS_VERSION,
    }));
}

export function reconcileRealGameHypotheses(hypotheses = [], records = [], exposures = []) {
  const latestByPattern = new Map();
  hypotheses.forEach((row, index) => latestByPattern.set(row.patternId, index));
  return hypotheses.map((hypothesis, index) => {
    if (latestByPattern.get(hypothesis.patternId) !== index) return hypothesis;
    // Real-game evidence is a projection of the currently valid analyzed corpus.
    // Rebuild that channel so deleted, reclassified, or now-ineligible games cannot
    // keep a hypothesis supported through a dangling historical reference.
    const withoutRealGames = deriveHypothesisEvidenceState({
      ...hypothesis,
      observations: (hypothesis.observations ?? []).filter((row) => row.source !== "real_game"),
    });
    return evidenceForHypothesis(withoutRealGames, records, exposures)
      .reduce((current, evidence) => applyHypothesisEvidence(current, evidence), withoutRealGames);
  });
}

export function hypothesisEvidenceSummary(hypothesis) {
  if (!hypothesis) return null;
  const observations = hypothesis.observations ?? [];
  const count = (source, direction) => observations.filter((row) => row.source === source && (!direction || row.direction === direction)).length;
  const gate = realGameEvidenceGate(hypothesis);
  return {
    status: hypothesis.status,
    confidence: hypothesis.confidence,
    directProbeSupports: observations.filter((row) => row.source === "practice_probe" && row.direction === "support" && row.measurability === "direct").length,
    realGameSupports: new Set(observations.filter((row) => row.source === "real_game" && row.direction === "support").map((row) => row.gameId)).size,
    realGameContradictions: new Set(observations.filter((row) => row.source === "real_game" && row.direction === "contradict").map((row) => row.gameId)).size,
    realGameInconclusive: count("real_game", "inconclusive"),
    gate,
  };
}
