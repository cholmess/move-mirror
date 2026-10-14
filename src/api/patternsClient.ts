export interface PersonalPattern {
  id: string; kind: "tactical" | "context"; cause: "unknown"; errors: number; games: number; opportunities: number;
  ratePer100: number | null; status: "recurrent" | "watching" | "no_evidence"; confidence: "moderate" | "limited" | "insufficient";
  exerciseCount: number; examples: Array<{ gameId: string; moveNumber: number; exerciseId: string }>;
  practice: { attempts: number; independent: number; successes: number; failures: number; estimate: number | null };
  transfer: { status: "descriptive_comparison" | "insufficient"; before: { games: number; decisions: number; ratePer100: number | null }; after: { games: number; decisions: number; ratePer100: number | null }; differencePer100: number | null; causal: false };
}
export interface PatternSummary {
  revision: number; method: "evidence_rules"; eligibleGames: number; analyzedGames: number; verifiedDecisions: number;
  updatedAt: string | null; recommended: string[]; patterns: PersonalPattern[];
  job: { status: string; error: string | null; completedGames: number; totalGames: number; completedDecisions: number; totalDecisions: number };
}
export interface PersonalExercise { id: string; positionId: string; patternId: string; fen: string; color: "white" | "black"; gameId: string; moveNumber: number; assisted: boolean; completed: boolean; repeated: boolean; feedback?: PersonalFeedback | null }
export interface PersonalFeedback { status: import("../types/learning").EvaluationStatus; chosenSan: string; replySan: string | null; resultingFen: string; referenceSan: string; independent: boolean; assisted: boolean }
async function request<T>(path = "", body?: unknown): Promise<T> {
  const response = await fetch(`/api/patterns${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "request_failed"); return data;
}
export const fetchPatterns = () => request<PatternSummary>();
export const updatePatterns = () => request<PatternSummary>("/update", {});
export const cancelPatternUpdate = () => request<PatternSummary>("/cancel", {});
export const startPersonalPractice = (patternId: string, exerciseId?: string) => request<PersonalExercise>("/practice", { patternId, exerciseId });
export const fetchPersonalExercise = (id: string) => request<PersonalExercise>(`/practice/${id}`);
export const requestPatternHint = (id: string) => request<{ assisted: true; patternId: string }>(`/practice/${id}/hint`, {});
export const revealPatternSolution = (id: string) => request<{ referenceSan: string; referenceFen: string }>(`/practice/${id}/solution`, {});
export const submitPersonalMove = (id: string, moveUci: string) => request<PersonalFeedback>(`/practice/${id}/move`, { moveUci });
