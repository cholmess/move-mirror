const BASE = import.meta.env.VITE_ENGINE_API ?? "";

export type SparringStyle = "instructional" | "balanced" | "strong";
export type SparringMode = "targeted_position" | "full_game";

export interface SparringMoveEntry {
  uci: string;
  san: string;
}

export interface SparringSessionDto {
  sessionId: string;
  sessionStatus: string;
  mode: SparringMode;
  userColor: "white" | "black";
  style: SparringStyle;
  fen: string;
  moveHistory: SparringMoveEntry[];
  clock: {
    mode: "untimed" | "10+0";
    whiteRemainingMs?: number | null;
    blackRemainingMs?: number | null;
    activeColor?: "white" | "black" | null;
    status?: "running" | "paused" | "expired" | "finished";
    resumeRequired?: boolean;
  };
  agentTurnNumber: number;
  reviewStatus: string;
  practicePatternId: string | null;
  result?: string | null;
  termination?: string | null;
}

export interface AgentMoveDto {
  sessionId?: string;
  moveUci: string;
  moveSan: string;
  sessionStatus: string;
  clock: SparringSessionDto["clock"];
}

async function parseJson(res: Response) {
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error ?? `http_${res.status}`);
  }
  return data;
}

export async function createSparringSession(body: Record<string, unknown>): Promise<SparringSessionDto> {
  const data = await parseJson(
    await fetch(`${BASE}/api/sparring/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return data.session;
}

export async function fetchSparringSession(id: string): Promise<SparringSessionDto> {
  const data = await parseJson(await fetch(`${BASE}/api/sparring/sessions/${id}`));
  return data.session;
}

export async function postPlayerMove(sessionId: string, moveUci: string) {
  return parseJson(
    await fetch(`${BASE}/api/sparring/sessions/${sessionId}/player-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moveUci }),
    }),
  ) as Promise<{ session: SparringSessionDto; agentMove: AgentMoveDto | null }>;
}

export async function postAgentMove(sessionId: string) {
  return parseJson(
    await fetch(`${BASE}/api/sparring/sessions/${sessionId}/agent-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  ) as Promise<AgentMoveDto>;
}

export async function postHint(sessionId: string) {
  return parseJson(
    await fetch(`${BASE}/api/sparring/sessions/${sessionId}/hint`, { method: "POST" }),
  );
}

export async function postResign(sessionId: string) {
  const data = await parseJson(
    await fetch(`${BASE}/api/sparring/sessions/${sessionId}/resign`, { method: "POST" }),
  );
  return data.session as SparringSessionDto;
}

export async function postResume(sessionId: string) {
  const data = await parseJson(
    await fetch(`${BASE}/api/sparring/sessions/${sessionId}/resume`, { method: "POST" }),
  );
  return data.session as SparringSessionDto;
}

export async function postReview(sessionId: string) {
  const data = await parseJson(
    await fetch(`${BASE}/api/sparring/sessions/${sessionId}/review`, { method: "POST" }),
  );
  return data.review;
}

export async function fetchReview(sessionId: string) {
  const data = await parseJson(await fetch(`${BASE}/api/sparring/sessions/${sessionId}/review`));
  return data.review;
}

export async function fetchSparringPgn(sessionId: string) {
  const res = await fetch(`${BASE}/api/sparring/sessions/${sessionId}/pgn`);
  if (!res.ok) throw new Error("pgn_failed");
  return res.text();
}
