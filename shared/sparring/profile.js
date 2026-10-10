import { createHash } from "node:crypto";
import { SPARRING_PROFILE_VERSION, SPARRING_DOSE_ELIGIBLE, SPARRING_TRANSFER_ELIGIBLE } from "./constants.js";

function sortRecord(record = {}) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/** Representación canónica para hash — inmutable durante la sesión. */
export function canonicalSnapshotPayload(snapshot) {
  return {
    patternId: snapshot.patternId,
    defenseResourceNeeds: sortRecord(snapshot.defenseResourceNeeds),
    uncertainty: sortRecord(snapshot.uncertainty),
  };
}

export function hashProfileSnapshot(snapshot) {
  return createHash("sha256").update(JSON.stringify(canonicalSnapshotPayload(snapshot))).digest("hex");
}

export function buildProfileSnapshot(input) {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const core = {
    patternId: input.patternId ?? "allowed-forcing-reply",
    defenseResourceNeeds: input.defenseResourceNeeds ?? {},
    uncertainty: input.uncertainty ?? {},
  };
  return {
    ...core,
    capturedAt,
    sha256: hashProfileSnapshot(core),
  };
}

export function emptySparringProfile() {
  return {
    version: SPARRING_PROFILE_VERSION,
    byResource: {},
    byPattern: {},
    sessions: 0,
    opportunitiesFaced: 0,
    opportunitiesResolved: 0,
    hints: 0,
    lastPracticeAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function applyReviewToProfile(profile, review, { eligible = true } = {}) {
  if (!eligible) return profile;
  const next = structuredClone(profile);
  next.updatedAt = new Date().toISOString();
  next.sessions += 1;
  next.lastPracticeAt = review.completedAt ?? next.updatedAt;

  for (const moment of review.moments ?? []) {
    if (moment.agentCreated) next.opportunitiesFaced += 1;
    if (moment.agentCreated && moment.resolved) next.opportunitiesResolved += 1;
    if (moment.hintUsed) next.hints += 1;
    const resource = moment.defensiveResource;
    if (!resource) continue;
    if (!next.byResource[resource]) {
      next.byResource[resource] = {
        faced: 0,
        resolved: 0,
        errors: 0,
        hints: 0,
        lastPracticeAt: null,
        uncertainty: 0.5,
      };
    }
    const bucket = next.byResource[resource];
    if (moment.agentCreated) bucket.faced += 1;
    if (moment.resolved) bucket.resolved += 1;
    if (moment.evaluationStatus === "incorrect") bucket.errors += 1;
    if (moment.hintUsed) bucket.hints += 1;
    bucket.lastPracticeAt = next.updatedAt;
    const total = bucket.faced || 1;
    bucket.uncertainty = Math.max(0.1, 1 - bucket.resolved / total);
  }

  return {
    ...next,
    doseEligible: SPARRING_DOSE_ELIGIBLE,
    transferEligible: SPARRING_TRANSFER_ELIGIBLE,
  };
}

export function profileNeedsFromStore(profile) {
  const needs = {};
  for (const [resource, bucket] of Object.entries(profile.byResource ?? {})) {
    if (!bucket.faced) continue;
    needs[resource] = Math.min(1, bucket.errors / Math.max(1, bucket.faced) + bucket.uncertainty * 0.35);
  }
  return needs;
}
