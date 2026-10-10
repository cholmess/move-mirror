import { PATTERN_ID } from "./constants";

export interface PatternEvidence {
  discoveryPositions: number;
  discoveryGames: number;
  validationPositions: number;
  validationGames: number;
  pctDiscovery: number;
  pctValidation: number;
  sampleGames: number;
  sampleDecisions: number;
}

export const primaryPattern = {
  id: PATTERN_ID,
  title: "CCT + comprobación de la respuesta forzada del rival",
  shortTitle: "CCT + refutación",
  plainExplanation:
    "En muchas de tus partidas, después de una jugada plausible el rival puede responder de inmediato con captura, jaque o secuencia forzada que empeora mucho la posición. No significa que «no calcules»: indica que conviene cerrar el proceso con una prueba breve desde el lado del rival antes de confirmar.",
  pedagogicalHypothesis:
    "El proceso se detiene al encontrar una jugada razonable y no siempre ejecuta la última refutación imaginando la respuesta más incómoda del rival.",
  hypothesisConfidence: "media" as const,
  patternConfidence: "alta" as const,
  evidence: {
    discoveryPositions: 262,
    discoveryGames: 116,
    validationPositions: 85,
    validationGames: 36,
    pctDiscovery: 46.6,
    pctValidation: 50.6,
    sampleGames: 200,
    sampleDecisions: 7729,
  } satisfies PatternEvidence,
  submodules: [
    "Generar jaques y capturas propios antes de planes tranquilos",
    "Verificar recaptura y continuación al capturar",
  ],
};
