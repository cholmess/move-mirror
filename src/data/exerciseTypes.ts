import type { SkillId } from "./skills";
import { PATTERN_ID } from "./constants";

export interface ExerciseLines {
  referenceMoveUci: string | null;
  referenceMoveSan: string | null;
  referenceLineUci: string[] | null;
  referenceLineSan: string | null;
  realMoveUci: string | null;
  realMoveSan: string | null;
  realLineUci: string[] | null;
  realLineSan: string | null;
}

export interface Exercise extends ExerciseLines {
  id: string;
  sourceKey?: string;
  tier: "core" | "pool";
  fen: string;
  sideToMove: "w" | "b";
  moveNumber: number;
  gameUrl: string;
  playedMoveSan: string;
  solutionSan: string;
  referenceLineSan: string;
  realLineSan: string;
  prompt: string;
  patternId: typeof PATTERN_ID;
  skillIds: SkillId[];
  severity: number;
  phase: "opening" | "middlegame" | "endgame";
  motifs?: string[];
  observableReason?: string | null;
  source?: string;
  analysisVersion?: string;
  block?: string | null;
}
