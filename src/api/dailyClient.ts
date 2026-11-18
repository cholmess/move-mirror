export interface ExplainFacts {
  side: "white" | "black"; candidateSan: string | null;
  punish: null | { san: string[]; firstSan: string | null; firstIsCheck: boolean; firstIsMate: boolean; firstCaptures: string | null;
    firstCaptureSquare: string | null; materialSwing: number; endsInMate: boolean; attackedAfter: Array<{ piece: string; square: string }> };
  best: null | { san: string[]; firstSan: string | null; materialSwing: number; endsInMate: boolean };
}
export interface ExplainResult { facts: ExplainFacts; llm: { status: string; text: string | null; model?: string } }
export interface DrillFeedback {
  correct: boolean; revealed: boolean; alternative?: boolean; unverified?: boolean; grade: "again" | "hard" | "good" | "easy" | null;
  elapsedMs?: number; limitMs?: number; nextDue?: string; intervalDays?: number; solutionSan: string[]; startFen: string; playedSan: string | null;
}
export interface DrillItem {
  index: number; cardId: string; kind: "refutation" | "find-move"; source: "own" | "puzzle"; patternId: string | null; themes: string[];
  rating: number | null; gameId: string | null; moveNumber: number | null; puzzleId: string | null; fen: string;
  orientation: "white" | "black"; solverColor: "white" | "black"; candidateSan: string | null; lastMove: { from: string; to: string } | null;
  step: number; steps: number; limitMs: number; servedAt: string; status: "active" | "correct" | "failed"; feedback: DrillFeedback | null; reviews: number;
}
export interface DailySession {
  id: string; date: string; startedAt: string; finishedAt: string | null; minutes: number; total: number; index: number;
  answered: number; correct: number; elapsedMs: number; overTime: boolean; stats: { due: number; newOwn: number; newPuzzles: number };
  current: DrillItem | null;
}
export interface DailyOverview {
  date: string; streak: number; dueCards: number; totalCards: number; bank: { available: boolean; count: number; source: string | null };
  explain: string; session: DailySession | null; finishedToday: boolean; pendingReviews: number; analysis: { status: string; completedGames: number; totalGames: number };
}
export interface WeekRow {
  week: string; games: number; decisions: number; pieceLoss: number; errors: number; pieceLossPer100: number | null; errorsPer100: number | null;
  ratingEnd: number | null; byControl: Record<string, { games: number; decisions: number; pieceLossPer100: number | null }>;
  answers: number; accuracy: number | null; trainingMinutes: number; trainingDays: number; reports: Record<string, number>;
}
export interface Weekly { weeks: WeekRow[]; streak: number; goalPieceLossPer100: number }
export interface ReviewGameRow {
  id: string; startedAt: string; rating: number | null; opponent: string | null; opponentRating: number | null; color: "white" | "black";
  outcome: "win" | "loss" | "draw"; control: string; analysed: boolean; moments: number; reviewed: boolean; started: boolean;
}
export interface ReviewMoment {
  index: number; fen: string; moveNumber: number; color: "white" | "black"; patternId: string; answered: boolean;
  answer: null | { cause: string; trySan: string | null; tryStatus: string | null; facts: ExplainFacts };
}
export interface GameReview { game: ReviewGameRow; analysed: boolean; completedAt: string | null; moments: ReviewMoment[] }
export interface MoveResult { status: "continue" | "correct" | "failed" | "unverified"; replySan?: string | null; item: DrillItem }

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/daily${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "request_failed");
  return data as T;
}

export const fetchDailyOverview = () => request<DailyOverview>("");
export const fetchWeekly = () => request<Weekly>("/weekly");
export const syncRecentGames = () => request<{ jobs: Array<{ source: string; username: string; status: string }> }>("/sync", {});
export const startDailySession = () => request<DailySession>("/session", {});
export const fetchDailySession = (id: string) => request<DailySession>(`/session/${id}`);
export const submitDrillMove = (id: string, moveUci: string) => request<MoveResult>(`/session/${id}/move`, { moveUci });
export const revealDrill = (id: string) => request<MoveResult>(`/session/${id}/reveal`, {});
export const nextDrill = (id: string) => request<DailySession>(`/session/${id}/next`, {});
export const finishDailySession = (id: string) => request<DailySession>(`/session/${id}/finish`, {});
export const explainDrill = (id: string, index: number, locale: string) => request<ExplainResult>(`/session/${id}/explain`, { index, locale });
export const fetchReviewGames = () => request<{ games: ReviewGameRow[] }>("/reviews");
export const fetchGameReview = (gameId: string) => request<GameReview>(`/reviews/${gameId}`);
export const answerReviewMoment = (gameId: string, index: number, body: { tryUci: string | null; cause: string }) => request<GameReview>(`/reviews/${gameId}/${index}`, body);
export const explainReviewMoment = (gameId: string, index: number, locale: string) => request<ExplainResult>(`/reviews/${gameId}/${index}/explain`, { locale });
