import { PATTERN_ID } from "./constants";

export type SkillId =
  | typeof PATTERN_ID
  | "forced-candidate-generation"
  | "capture-recapture-check";

export interface SkillDefinition {
  id: SkillId;
  name: string;
  description: string;
  linkedPatternId: string;
  /** Prioridad para mostrar en dashboard (1 = más visible) */
  displayPriority: number;
  /** Evidencia inicial del review Fase 2 (observable, no dominio) */
  initialEvidence: {
    discoveryPositions: number;
    discoveryGames: number;
    validationPositions: number;
    validationGames: number;
    pctDiscovery: number;
    pctValidation: number;
  };
  initialConfidence: number; // 0–1, calibrado desde review
}

/** Máximo tres habilidades visibles en dashboard — estas son las del review. */
export const visibleSkills: SkillDefinition[] = [
  {
    id: PATTERN_ID,
    name: "Refutación del rival antes de mover",
    description:
      "Tras elegir un candidato, buscar la respuesta forzada más incómoda del rival (captura, jaque, secuencia corta).",
    linkedPatternId: PATTERN_ID,
    displayPriority: 1,
    initialEvidence: {
      discoveryPositions: 262,
      discoveryGames: 116,
      validationPositions: 85,
      validationGames: 36,
      pctDiscovery: 46.6,
      pctValidation: 50.6,
    },
    initialConfidence: 0.85,
  },
  {
    id: "forced-candidate-generation",
    name: "Generar candidatos forzados propios",
    description:
      "Incluir jaques y capturas fuertes en el conjunto de candidatos antes de comparar planes tranquilos.",
    linkedPatternId: PATTERN_ID,
    displayPriority: 2,
    initialEvidence: {
      discoveryPositions: 88,
      discoveryGames: 55,
      validationPositions: 34,
      validationGames: 18,
      pctDiscovery: 15.7,
      pctValidation: 20.2,
    },
    initialConfidence: 0.72,
  },
  {
    id: "capture-recapture-check",
    name: "Verificar capturas y recapturas",
    description:
      "Antes de capturar, comprobar recaptura, piezas colgadas y la primera respuesta táctica del rival.",
    linkedPatternId: PATTERN_ID,
    displayPriority: 3,
    initialEvidence: {
      discoveryPositions: 106,
      discoveryGames: 78,
      validationPositions: 22,
      validationGames: 18,
      pctDiscovery: 18.9,
      pctValidation: 13.1,
    },
    initialConfidence: 0.7,
  },
];

export function getSkill(id: SkillId): SkillDefinition {
  const s = visibleSkills.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown skill: ${id}`);
  return s;
}
