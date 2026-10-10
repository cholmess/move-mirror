/**
 * Contratos para capacidades futuras — no implementadas en MVP.
 * MoveMirror consumirá estos interfaces cuando existan los módulos.
 */

/** Defense Lab: aperturas y estructuras que complican al jugador. */
export interface DefenseLabService {
  listProblematicStructures(playerId: string): Promise<
    { structureId: string; frequency: number; recommendedDefense: string }[]
  >;
  getCriticalPositionDrill(structureId: string): Promise<{ fen: string; goal: string }>;
}

/** Sparring Agent: líneas que exponen debilidades conocidas. */
export interface SparringAgentService {
  proposeLine(params: {
    playerId: string;
    weaknessSkillIds: string[];
    maxPlies: number;
  }): Promise<{ fen: string; narrative: string; expectedStress: number }>;
}

/** Sincronización periódica con Chess.com. */
export interface GameSyncService {
  syncLatestGames(username: string, since?: string): Promise<{ imported: number }>;
}

/** Generación de ejercicios nuevos a partir del historial analizado. */
export interface ExerciseGenerationService {
  generateFromCriticalPositions(
    playerId: string,
    patternId: string,
    limit: number
  ): Promise<{ exerciseIds: string[] }>;
}

/** Evaluación de transferencia en partidas posteriores. */
export interface TransferEvaluationService {
  measurePatternRate(
    playerId: string,
    patternId: string,
    windowGames: number
  ): Promise<{ ratePer100: number; trend: "down" | "flat" | "up" }>;
}

/** Sustitución progresiva de heurísticas por modelos aprendidos. */
export interface AdaptiveModelService {
  /** Reemplaza selectNextExercise heurístico cuando exista modelo entrenado. */
  rankExercises(
    playerId: string,
    candidateExerciseIds: string[]
  ): Promise<{ orderedIds: string[]; explanations: Record<string, string> }>;
}

export const FUTURE_MODULES = {
  defenseLab: "Defense Lab",
  sparringAgent: "Sparring Agent",
  gameSync: "Chess.com sync",
  exerciseGen: "Exercise generation",
  transferEval: "Transfer evaluation",
  adaptiveModel: "Learned adaptive ranking",
} as const;
