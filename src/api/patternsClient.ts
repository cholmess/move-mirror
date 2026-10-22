export interface PersonalPattern {
  id: string; kind: "tactical" | "context"; cause: "unknown"; errors: number; games: number; opportunities: number;
  ratePer100: number | null; status: "recurrent" | "watching" | "no_evidence"; confidence: "moderate" | "limited" | "insufficient";
  exerciseCount: number; examples: Array<{ gameId: string; moveNumber: number; exerciseId: string }>;
  practice: { attempts: number; independent: number; successes: number; failures: number; estimate: number | null };
  transfer: { status: "descriptive_comparison" | "insufficient"; before: { games: number; decisions: number; ratePer100: number | null }; after: { games: number; decisions: number; ratePer100: number | null }; differencePer100: number | null; causal: false };
  hypothesis?: PersonalHypothesisSummary | null;
  curriculum?: CurriculumDecision;
}
export type CurriculumAction = "diagnose" | "reteach" | "revise_hypothesis" | "bridge_transfer" | "maintenance";
export interface CurriculumDecision {
  version: string; action: CurriculumAction; reasonKey: string; slot?: "primary" | "support" | "maintenance";
  previousCategory: string | null; targetCategory: string;
  evidence: { hypothesisStatus: string; holdoutOutcome: string; holdoutAt: string | null; transferStatus: string; differencePer100: number | null; causal: false };
}
export interface PersonalLesson {
  version: string; patternId: string; createdAt: string; action: CurriculumAction;
  method: "discriminating_probe" | "worked_contrast" | "alternative_probe" | "game_like_retrieval" | "spaced_retrieval";
  targetCategory: string;
  narrative: { hypothesisId: string; category: string; status: string; statement: string; objective: string | null; explanation: string | null;
    nextTest: { skill?: string; instruction: string; successSignal?: string } | null; source: "llm" | "rules"; sourceReflectionId: string | null;
    citations: Array<{ evidenceId: string; kind: string; gameId: string; moveNumber: number }> } | null;
  evidence: { errors: number; games: number; opportunities: number; confidence: string;
    examples: Array<{ evidenceId: string; kind: "personal_error"; gameId: string; moveNumber: number; recordId: string; severity: "low" | "medium" | "high" }>;
    contrast: { evidenceId: string; kind: "comparable_non_error"; gameId: string; moveNumber: number; recordId: string; severity: null } | null };
  sequence: { guidedPositions: number; blindHoldout: boolean; positionRecordIds: string[] };
  success: { practice: "process_observed"; generalization: "independent_blind_holdout"; transfer: "later_unexposed_games"; causal: false };
  spoilerPolicy: "game_like_hidden" | "teaching_visible";
}
export interface HypothesisEvidenceSummary {
  status: "tentative" | "supported" | "contradicted"; confidence: "low" | "medium";
  directProbeSupports: number; realGameSupports: number; realGameContradictions: number; realGameInconclusive: number;
  gate: { eligible: boolean; reason: "cause_not_directly_observable" | "direct_probe_required" | "blind_holdout_required" | null; cutoffAt: string | null };
}
export interface PersonalHypothesisSummary {
  category: string; statement: string; confidence: "low" | "medium"; status: "tentative" | "supported" | "contradicted";
  evidence: HypothesisEvidenceSummary;
}
export interface PatternSummary {
  revision: number; method: "evidence_rules"; eligibleGames: number; analyzedGames: number; verifiedDecisions: number;
  updatedAt: string | null; recommended: string[]; patterns: PersonalPattern[]; curriculum: Array<CurriculumDecision & { patternId: string }>;
  job: { status: string; error: string | null; completedGames: number; totalGames: number; completedDecisions: number; totalDecisions: number };
}
export type PersonalExerciseStatus = "active" | "training" | "ready_for_holdout" | "ready_for_next_slot" | "completed";
export interface PedagogyOutput {
  primaryHypothesis: { category: string; statement: string; confidence: "low" | "medium"; supportingEvidenceIds: string[]; contradictingEvidenceIds: string[] };
  alternativeHypotheses: Array<{ category: string; statement: string }>;
  teaching: { objective: string; explanation: string; evidenceIds: string[]; contrast: { worksWhen: string; failsWhen: string; evidenceIds: string[] } };
  nextTest: { skill: string; instruction: string; successSignal: string };
}
export interface PedagogyReflection {
  id: string; source: "llm" | "rules"; question: string; generatedAt: string; output: PedagogyOutput;
  sources: Array<{ evidenceId: string; gameId: string; moveNumber: number }>;
}
export interface PreFeedbackReasoning {
  intention: string; evaluation: string; confidence: "low" | "medium" | "high"; capturedAt?: string;
}
export interface PersonalExercise {
  id: string; positionId: string; patternId: string; fen: string; originalFen: string; color: "white" | "black"; gameId: string; moveNumber: number;
  assisted: boolean; completed: boolean; repeated: boolean; role: "guided" | "holdout" | "legacy"; status: PersonalExerciseStatus;
  decisionCount: number; targetDecisions: number; awaitingNext: boolean; canStartHoldout: boolean; canAdvanceSlot?: boolean;
  sessionId?: string | null; slotIndex?: number | null; sessionPositionTotal?: number | null; sessionPositionCurrent?: number | null; sessionShortfall?: boolean;
  coachingHistory?: Array<{ intervention: string; at: string; gameId: string }>;
  evidenceSummary?: { errors: number; games: number; opportunities: number; confidence: string } | null;
  hypothesis?: { category: string; statement: string; confidence: string; status: string; intervention: string; nextTest?: { instruction: string; successSignal: string }; evidence?: HypothesisEvidenceSummary } | null;
  probe?: {
    version: string; hypothesisId: string; targetCategory: string; comparedCategories: string[];
    selectionReasons: string[]; measurability: "direct" | "partial";
  } | null;
  curriculum?: CurriculumDecision | null;
  lesson?: PersonalLesson | null;
  diagnostic?: {
    question: string; status: string; source: string | null; reflection: PedagogyReflection | null;
    llm: { enabled: boolean; configured: boolean; provider: string | null; model: string | null };
  } | null;
  feedback?: PersonalFeedback | null;
}
export interface SessionDomainSnapshot {
  masteryEstimate: number; confidence: number; lifecycle: string; nextReviewAt: string | null;
  independentAttempts: number; independentSuccesses: number; independentFailures: number; assistedAttempts: number;
}
export interface SessionResult {
  sessionId: string; patternId: string; startedAt: string; endedAt: string | null; durationMs: number | null;
  outcomeKey: string; outcomeHeadlineKey: string; countsAsIndependentEvidence: boolean; evidenceReasonKey: string | null;
  domain: SessionDomainSnapshot; positionRecordIds: string[];
  lesson?: Pick<PersonalLesson, "version" | "action" | "method" | "targetCategory"> | null;
}
export interface NextActivity {
  kind: "pattern" | "continue_session" | "finish"; patternId: string | null; href: string | null;
  reasons: Array<{ key: string; params?: Record<string, string> }>;
}
export interface PersonalFeedback {
  status: import("../types/learning").EvaluationStatus; chosenSan: string; replySan: string | null; resultingFen: string; referenceSan: string | null;
  independent: boolean; assisted: boolean; decisionNumber: number; targetDecisions: number; canContinue: boolean; trainingStatus: PersonalExerciseStatus;
  coaching?: { intervention: string; hypothesis: string | null; predictedSan: string | null; replyVerified: boolean; rootFen: string; candidateFen: string; referenceFen: string | null } | null;
  preFeedbackReasoning?: PreFeedbackReasoning | null;
  probeObservation?: { observedCategory: string | null; expectedCategory: string; direction: "support" | "contradict" | "inconclusive"; measurability: "direct" | "partial" } | null;
  diagnostic?: PersonalExercise["diagnostic"];
  sessionResult?: SessionResult; nextActivity?: NextActivity;
}
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
export const submitPersonalMove = (id: string, moveUci: string, prediction?: { replyUci: string | null }, reasoning?: Omit<PreFeedbackReasoning, "capturedAt">) => request<PersonalFeedback>(`/practice/${id}/move`, { moveUci, prediction, reasoning });
export const submitPersonalReflection = (id: string) => request<PedagogyReflection>(`/practice/${id}/reflection`, {});
export const advancePersonalPractice = (id: string) => request<PersonalExercise>(`/practice/${id}/next`, {});
export const retryPersonalDecision = (id: string) => request<PersonalExercise>(`/practice/${id}/retry`, {});
export const startPersonalHoldout = (id: string) => request<PersonalExercise>(`/practice/${id}/holdout`, {});
export const advancePersonalSlot = (id: string) => request<PersonalExercise>(`/practice/${id}/slot`, {});
export const fetchPracticeSession = (id: string) => request<{ session: unknown; lastResult: { nextReviewAt: string | null; nextActivity: NextActivity; outcomeKey: string } | null }>(`/session/${id}`);
