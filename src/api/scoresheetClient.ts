import type { ScoresheetDraftPublic } from "../types/scoresheet";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error ?? "request_failed") as Error & { unresolvedPlies?: number[] };
    error.unresolvedPlies = payload.unresolvedPlies;
    throw error;
  }
  return payload as T;
}

export function uploadScoresheet(input: {
  filename: string;
  mimeType: string;
  bytes: string;
  locale?: "es" | "en" | "de";
  keepOriginal?: boolean;
  fixtureId?: string;
}) {
  return request<ScoresheetDraftPublic>("/api/import/scoresheet", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchScoresheetDraft(id: string) {
  return request<ScoresheetDraftPublic>(`/api/import/scoresheet/${id}`);
}

export function patchScoresheetDraft(id: string, patch: Record<string, unknown>) {
  return request<ScoresheetDraftPublic>(`/api/import/scoresheet/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function preprocessScoresheet(id: string, body: Record<string, unknown> = {}) {
  return request<ScoresheetDraftPublic>(`/api/import/scoresheet/${id}/preprocess`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function recognizeScoresheet(id: string) {
  return request<ScoresheetDraftPublic>(`/api/import/scoresheet/${id}/recognize`, { method: "POST" });
}

export function resolveScoresheetMove(id: string, body: Record<string, unknown>) {
  return request<ScoresheetDraftPublic>(`/api/import/scoresheet/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function confirmScoresheet(id: string, confirmed: boolean) {
  return request<ScoresheetDraftPublic>(`/api/import/scoresheet/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ confirmed }),
  });
}

export function importScoresheetDraft(id: string, body: Record<string, unknown>) {
  return request<{
    draft: ScoresheetDraftPublic;
    importJobId: string;
    canonicalGameId: string;
    duplicateDisposition: string;
  }>(`/api/import/scoresheet/${id}/import`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchScoresheetPagePreview(id: string, page: number) {
  return request<{ mimeType: string; bytes: string }>(`/api/import/scoresheet/${id}/pages/${page}/preview`);
}

function bufferToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

export async function fileToUploadPayload(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    bytes: bufferToBase64(bytes),
  };
}
