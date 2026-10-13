const ENGINE_BASE = import.meta.env.VITE_ENGINE_API ?? import.meta.env.VITE_ENGINE_URL ?? "http://127.0.0.1:8787";

export interface CoachDoseStatus {
  protocolId: string;
  qualified: boolean;
  qualifiedAt: string | null;
  missingRequirements: string[];
}

export interface ValidationStatusWithCoach {
  coachDose: CoachDoseStatus | null;
  canonicalSource: "server";
}

export interface CoachBoardView {
  fen: string;
  orientation: "white" | "black";
}

export interface CoachSessionView {
  sessionId: string;
  phase: string;
  status: string;
  branch: string | null;
  hintLevel: number;
  board?: CoachBoardView;
  instructionKey?: string;
  actions?: string[];
  moveRole?: "candidate" | "hostile_reply";
  probeOptions?: string[];
  ruleOptions?: string[];
  highlightSquares?: string[];
  demoMove?: { san: string; uci: string };
  learningSummary?: Record<string, unknown>;
  holdoutExposureNoteKey?: string;
}

export interface CoachHome {
  primaryAction: "start_session" | "resume_session" | "start_retention";
  sessionId: string | null;
  phase: string;
  estimatedMinutes: number;
  focusTitleKey: string;
  whyNowKey: string;
  learnTodayKey: string;
  applyRuleKey: string;
}

async function parseJson(res: Response) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "coach_request_failed");
  return data;
}

export async function fetchCoachHome(): Promise<{ home: CoachHome }> {
  return parseJson(await fetch(`${ENGINE_BASE}/api/coach/home`));
}

export interface CoachProgressDto {
  assistedPractice?: { maxHintLevel?: number; workedExampleCompleted?: boolean };
  independentPractice?: { firstAttemptSuccess?: boolean | null; hintLevel?: number | null };
  generalization?: {
    holdoutFirstAttemptSuccess?: boolean | null;
    exposureUncertainty?: boolean;
    protectedGeneralizationEligible?: boolean | null;
    holdoutContentId?: string | null;
  };
  retention?: { dueAt?: string | null; completed?: boolean; firstAttemptSuccess?: boolean | null };
  hypotheses?: Array<{ branch?: string; tentativeKey?: string }>;
  realGames?: { noteKey?: string; qualifiedForTransfer?: boolean };
}

export async function fetchCoachProgress(): Promise<{ progress: CoachProgressDto | null }> {
  return parseJson(await fetch(`${ENGINE_BASE}/api/coach/progress`));
}

export async function fetchValidationStatus(): Promise<ValidationStatusWithCoach> {
  const data = await parseJson(await fetch(`${ENGINE_BASE}/api/validation/status`));
  return data.status as ValidationStatusWithCoach;
}

export async function startCoachRetention(sessionId: string): Promise<{ view: CoachSessionView }> {
  return parseJson(
    await fetch(`${ENGINE_BASE}/api/coach/session/${sessionId}/retention`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
}

export async function startCoachSession(): Promise<{ view: CoachSessionView }> {
  return parseJson(
    await fetch(`${ENGINE_BASE}/api/coach/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
}

export async function fetchCoachSession(sessionId: string): Promise<{ view: CoachSessionView }> {
  return parseJson(await fetch(`${ENGINE_BASE}/api/coach/session/${sessionId}`));
}

export async function coachSessionAction(
  sessionId: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<{ view: CoachSessionView; feedback?: Record<string, unknown> }> {
  return parseJson(
    await fetch(`${ENGINE_BASE}/api/coach/session/${sessionId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    }),
  );
}
