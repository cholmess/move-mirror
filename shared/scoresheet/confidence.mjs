import { CONFIDENCE_VERSION } from "./constants.mjs";

export function resolutionFromCandidates(candidates, { ocrConfidence = null, manual = false } = {}) {
  if (manual) return "manually_entered";
  if (!candidates?.length) return "unreadable";
  const [first, second] = candidates;
  const gap = second ? first.score - second.score : first.score;
  const ocr = ocrConfidence ?? 0.75;
  const combined = first.score * 0.7 + ocr * 0.3;
  if (combined >= 0.92 && gap >= 0.12) return "high_confidence";
  if (combined >= 0.75 && gap >= 0.06) return "probable";
  if (candidates.length > 1 && gap < 0.06) return "ambiguous";
  if (combined < 0.45) return "unreadable";
  return "ambiguous";
}

export function resolutionLabelKey(resolution) {
  const map = {
    high_confidence: "resolution.high",
    probable: "resolution.probable",
    ambiguous: "resolution.ambiguous",
    unreadable: "resolution.unreadable",
    manually_entered: "resolution.manual",
  };
  return map[resolution] ?? "resolution.ambiguous";
}

export { draftReviewState, humanReviewRequiredCount, plyRequiresUserAction, assertReadyForImport, unresolvedPlyNumbers } from "./review.mjs";
