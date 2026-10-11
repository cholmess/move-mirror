import { gameStartTime } from "../transfer/intervention.js";

export function classifyGameInterventionExposure(game, qualifiedAt) {
  if (!qualifiedAt) return "exposure_unknown";
  const start = gameStartTime(game);
  if (!start) return "exposure_unknown";
  if (start > qualifiedAt) return "post_intervention";
  return "pre_intervention";
}
