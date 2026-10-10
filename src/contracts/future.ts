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

/** Implementado en v0.5 por el Import Hub (`server/games`). */
export interface GameSyncService {
  syncLatestGames(username: string, since?: string): Promise<{ imported: number }>;
}

/** Retención futura de originales. En v0.5 todo permanece local. */
export interface GameRetentionContract {
  retainRawPgn: boolean;
  cloudArchive: false;
  deleteRawWithoutDeletingCanonical: true;
}

/** Generación de ejercicios nuevos a partir del historial analizado. */
export interface ExerciseGenerationService {
  generateFromCriticalPositions(
    playerId: string,
    patternId: string,
    limit: number
  ): Promise<{ exerciseIds: string[] }>;
}

/** Implementado en v0.3: detector allowed-forcing-reply-transfer-v1. */
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
  exerciseGen: "Exercise generation into the live trainer",
  adaptiveModel: "Learned adaptive ranking",
} as const;
