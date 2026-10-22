export const CURRICULUM_VERSION = "adaptive-curriculum-v1";

const ACTION_RANK = {
  revise_hypothesis: 5,
  reteach: 4,
  diagnose: 3,
  bridge_transfer: 2,
  maintenance: 1,
};

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function latestHoldout(hypothesis) {
  return [...(hypothesis?.observations ?? [])]
    .filter((row) => row.source === "holdout" && ["success", "failure"].includes(row.skillOutcome))
    .sort((a, b) => timestamp(b.at) - timestamp(a.at))[0] ?? null;
}

function contradictedAlternative(hypothesis) {
  const allowed = new Set((hypothesis?.alternatives ?? []).map((row) => row.category));
  const counts = new Map();
  for (const row of hypothesis?.observations ?? []) {
    if (row.direction !== "contradict" || !allowed.has(row.observedCategory)) continue;
    counts.set(row.observedCategory, (counts.get(row.observedCategory) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "insufficient_evidence";
}

/**
 * Selects an intervention from separated evidence channels. It never turns a
 * practice result or a descriptive before/after comparison into a causal claim.
 */
export function decideCurriculum(pattern, hypothesis = pattern?.hypothesis ?? null) {
  const holdout = latestHoldout(hypothesis);
  const transfer = pattern?.transfer ?? { status: "insufficient", differencePer100: null };
  const evidence = {
    hypothesisStatus: hypothesis?.status ?? "missing",
    holdoutOutcome: holdout?.skillOutcome ?? "missing",
    holdoutAt: holdout?.at ?? null,
    transferStatus: transfer.status,
    differencePer100: transfer.differencePer100 ?? null,
    causal: false,
  };
  if (hypothesis?.status === "contradicted") {
    return { version: CURRICULUM_VERSION, action: "revise_hypothesis", reasonKey: "contradicted_hypothesis",
      previousCategory: hypothesis.category, targetCategory: contradictedAlternative(hypothesis), evidence };
  }
  if (holdout?.skillOutcome === "failure") {
    return { version: CURRICULUM_VERSION, action: "reteach", reasonKey: "holdout_failed",
      previousCategory: hypothesis?.category ?? null, targetCategory: hypothesis?.category ?? "insufficient_evidence", evidence };
  }
  if (holdout?.skillOutcome === "success") {
    const improved = transfer.status === "descriptive_comparison"
      && Number.isFinite(transfer.differencePer100)
      && transfer.differencePer100 < 0;
    return improved
      ? { version: CURRICULUM_VERSION, action: "maintenance", reasonKey: "generalized_and_transfer_improved",
          previousCategory: hypothesis?.category ?? null, targetCategory: hypothesis?.category ?? "insufficient_evidence", evidence }
      : { version: CURRICULUM_VERSION, action: "bridge_transfer", reasonKey: transfer.status === "descriptive_comparison" ? "generalized_without_transfer" : "generalized_transfer_pending",
          previousCategory: hypothesis?.category ?? null, targetCategory: hypothesis?.category ?? "insufficient_evidence", evidence };
  }
  return { version: CURRICULUM_VERSION, action: "diagnose", reasonKey: hypothesis ? "holdout_required" : "hypothesis_required",
    previousCategory: hypothesis?.category ?? null, targetCategory: hypothesis?.category ?? "insufficient_evidence", evidence };
}

function compareEntries(a, b) {
  return ACTION_RANK[b.decision.action] - ACTION_RANK[a.decision.action]
    || (b.pattern.priority ?? 0) - (a.pattern.priority ?? 0)
    || a.pattern.id.localeCompare(b.pattern.id);
}

/** Returns at most two active learning priorities plus one maintenance item. */
export function buildCurriculumPlan(patterns) {
  const entries = patterns.filter((pattern) => pattern.status === "recurrent").map((pattern) => ({
    pattern,
    decision: pattern.curriculum ?? decideCurriculum(pattern),
  }));
  const active = entries.filter((row) => row.decision.action !== "maintenance").sort(compareEntries);
  const maintenance = entries.filter((row) => row.decision.action === "maintenance").sort(compareEntries);
  const selected = active.slice(0, maintenance.length ? 2 : 3).map((row, index) => ({ ...row, slot: index ? "support" : "primary" }));
  if (maintenance.length) selected.push({ ...maintenance[0], slot: "maintenance" });
  while (selected.length < 3 && active[selected.length]) {
    selected.push({ ...active[selected.length], slot: selected.length ? "support" : "primary" });
  }
  return selected.map(({ pattern, decision, slot }) => ({ patternId: pattern.id, slot, ...decision }));
}

/** Re-targets the next discriminating probe without rewriting stored history. */
export function hypothesisForCurriculum(hypothesis, decision) {
  if (!hypothesis || decision?.action !== "revise_hypothesis" || decision.targetCategory === "insufficient_evidence") return hypothesis;
  const target = hypothesis.alternatives?.find((row) => row.category === decision.targetCategory);
  if (!target) return hypothesis;
  const alternatives = [
    { category: hypothesis.category, statement: hypothesis.statement },
    ...(hypothesis.alternatives ?? []).filter((row) => row.category !== target.category),
  ];
  return { ...hypothesis, category: target.category, statement: target.statement, alternatives };
}

export function createHypothesisRevision(hypothesis, decision, { id, at }) {
  const retargeted = hypothesisForCurriculum(hypothesis, decision);
  if (!retargeted || retargeted === hypothesis) return null;
  return {
    ...retargeted,
    id,
    parentHypothesisId: hypothesis.id,
    revisionReason: decision.reasonKey,
    confidence: "low",
    status: "tentative",
    createdAt: at,
    updatedAt: at,
    intervention: decision.targetCategory,
    nextTest: retargeted.nextTest ? { ...retargeted.nextTest, skill: decision.targetCategory } : null,
    observations: [],
  };
}
