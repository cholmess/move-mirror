import { CONFIDENCE_VERSION, STANDARD_FEN } from "./constants.mjs";
import { Chess } from "chess.js";

export function plyRequiresUserAction(ply) {
  if (!ply?.selectedUci) return true;
  if (ply.resolution === "high_confidence") return false;
  if (ply.resolution === "manually_entered") return !ply.confirmedByUser;
  return !ply.confirmedByUser;
}

export function humanReviewRequiredCount(plies = []) {
  return plies.filter((ply) =>
    ply.resolution === "probable"
    || ply.resolution === "ambiguous"
    || ply.resolution === "unreadable"
    || ply.resolution === "manually_entered",
  ).length;
}

export function unresolvedPlyNumbers(plies = []) {
  return plies
    .map((ply, index) => (plyRequiresUserAction(ply) ? index + 1 : null))
    .filter((value) => value != null);
}

export function validatePlayableSequence(plies = [], startingFen = STANDARD_FEN) {
  const chess = new Chess(startingFen);
  for (const ply of plies) {
    if (!ply.selectedUci) return false;
    const ok = chess.move({
      from: ply.selectedUci.slice(0, 2),
      to: ply.selectedUci.slice(2, 4),
      promotion: ply.selectedUci[4],
    });
    if (!ok) return false;
  }
  return plies.length > 0;
}

export function draftReviewState(plies = [], startingFen = STANDARD_FEN) {
  const unresolvedPlies = unresolvedPlyNumbers(plies);
  return {
    version: CONFIDENCE_VERSION,
    pendingCount: unresolvedPlies.length,
    unresolvedCount: unresolvedPlies.length,
    unresolvedPlies,
    humanReviewRequired: humanReviewRequiredCount(plies),
    readyToConfirm: unresolvedPlies.length === 0 && plies.length > 0 && validatePlayableSequence(plies, startingFen),
  };
}

export function assertReadyForImport(plies, startingFen = STANDARD_FEN) {
  const unresolvedPlies = unresolvedPlyNumbers(plies);
  if (unresolvedPlies.length || !validatePlayableSequence(plies, startingFen)) {
    const error = new Error("SCORESHEET_REVIEW_REQUIRED");
    error.code = "SCORESHEET_REVIEW_REQUIRED";
    error.unresolvedPlies = unresolvedPlies.length ? unresolvedPlies : plies.map((ply, i) => (!ply.selectedUci ? i + 1 : null)).filter(Boolean);
    throw error;
  }
}
