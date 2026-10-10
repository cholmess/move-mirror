import type {
  AnalysisScope,
  CanonicalGame,
  ImportJob,
  PlayerIdentityPublic,
  PgnPreview,
  ReconcileSummary,
} from "../types/games";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "request_failed");
  return payload as T;
}

export function fetchGames(query = "") {
  return request<{ games: CanonicalGame[] }>(`/api/games${query}`);
}

export function fetchGame(id: string) {
  return request<CanonicalGame>(`/api/games/${id}`);
}

export function fetchJobs() {
  return request<{ jobs: ImportJob[] }>("/api/import/jobs");
}

export function previewPgnText(pgn: string) {
  return request<PgnPreview>("/api/import/pgn-preview", { method: "POST", body: JSON.stringify({ pgn }) });
}

export function importPgnText(pgn: string) {
  return request<ImportJob>("/api/import/pgn-text", { method: "POST", body: JSON.stringify({ pgn }) });
}

export function importPgnFiles(files: Array<{ name: string; text?: string; bytes?: string }>) {
  return request<{ jobs: ImportJob[] }>("/api/import/pgn", { method: "POST", body: JSON.stringify({ files }) });
}

export function importPlatform(platform: "chess-com" | "lichess", input: { username: string; from?: string; to?: string }) {
  return request<ImportJob>(`/api/import/${platform}`, { method: "POST", body: JSON.stringify(input) });
}

export function importManual(input: unknown) {
  return request<ImportJob>("/api/import/manual", { method: "POST", body: JSON.stringify(input) });
}

export function cancelJob(id: string) {
  return request<ImportJob>(`/api/import/jobs/${id}/cancel`, { method: "POST" });
}

export function resumeJob(id: string) {
  return request<ImportJob>(`/api/import/jobs/${id}/resume`, { method: "POST" });
}

export function resolvePlayer(id: string, playerColor: "white" | "black") {
  return request<CanonicalGame>(`/api/games/${id}/resolve-player`, {
    method: "POST",
    body: JSON.stringify({ playerColor }),
  });
}

export function resolveConflicts(id: string, resolutions: Record<string, unknown>) {
  return request<CanonicalGame>(`/api/games/${id}/resolve-conflicts`, {
    method: "POST",
    body: JSON.stringify({ resolutions }),
  });
}

export function patchGame(id: string, patch: Record<string, unknown>) {
  return request<CanonicalGame>(`/api/games/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function archiveGame(id: string, archived = true) {
  return request<CanonicalGame>(`/api/games/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) });
}

export function deleteGame(id: string) {
  return request<{ ok: boolean; deleted?: string; protection?: string[] }>(`/api/games/${id}`, { method: "DELETE" });
}

export function deleteSource(id: string) {
  return request<{ ok: boolean }>(`/api/games/sources/${id}`, { method: "DELETE" });
}

export function deleteRaw(id: string) {
  return request<{ rawAvailable: boolean }>(`/api/games/sources/${id}/raw`, { method: "DELETE" });
}

export function fetchIdentity() {
  return request<PlayerIdentityPublic>("/api/player-identity");
}

export function updateIdentity(patch: Partial<PlayerIdentityPublic>) {
  return request<PlayerIdentityPublic>("/api/player-identity", { method: "PATCH", body: JSON.stringify(patch) });
}

export function reconcileIdentity(input: { dryRun?: boolean; confirm?: boolean }) {
  return request<ReconcileSummary>("/api/player-identity/reconcile", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchScopes() {
  return request<{ scopes: AnalysisScope[] }>("/api/games/scopes");
}
