const MIN_ANGLE = -15;
const MAX_ANGLE = 15;

export function clampDeskewAngle(angle) {
  const value = Number(angle);
  if (Number.isNaN(value)) return 0;
  return Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, value));
}

export function normalizeDeskewSettings(input = {}) {
  const mode = input.mode === "automatic" || input.mode === "manual" ? input.mode : "none";
  const appliedAngle = clampDeskewAngle(input.appliedAngle ?? 0);
  const detectedAngle = input.detectedAngle == null ? null : clampDeskewAngle(input.detectedAngle);
  return {
    mode,
    detectedAngle,
    appliedAngle: mode === "none" ? 0 : appliedAngle,
  };
}

export function chooseAutomaticDeskewAngle(scores) {
  if (!scores?.length) return 0;
  const best = [...scores].sort((a, b) => b.score - a.score || a.angle - b.angle)[0];
  return clampDeskewAngle(best.angle);
}
