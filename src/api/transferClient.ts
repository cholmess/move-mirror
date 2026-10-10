import type { TransferState } from "../types/transfer";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.error ?? `transfer_${response.status}`);
  }
  return body;
}

export function fetchTransferState(): Promise<TransferState> {
  return request("/api/transfer/state");
}

export function startTransferSync(source: "live" | "fixtures", training: unknown) {
  return request("/api/transfer/sync", {
    method: "POST",
    body: JSON.stringify({ source, training }),
  });
}

export function resumeTransfer(training: unknown) {
  return request("/api/transfer/resume", {
    method: "POST",
    body: JSON.stringify({ training }),
  });
}

export function cancelTransfer() {
  return request("/api/transfer/cancel", { method: "POST", body: "{}" });
}

export function freezeTransfer(cohortId: string) {
  return request("/api/transfer/freeze", {
    method: "POST",
    body: JSON.stringify({ cohortId }),
  });
}

export function promoteTransfer(cohortId: string, key: string) {
  return request("/api/transfer/promote", {
    method: "POST",
    body: JSON.stringify({ cohortId, key }),
  });
}

export function postTrainingSummary(training: unknown, previousAction: string | null) {
  return request("/api/transfer/recommend", {
    method: "POST",
    body: JSON.stringify({ training, previousAction }),
  });
}

export function fetchExamples(cohortId: string) {
  return request(`/api/transfer/examples?cohortId=${encodeURIComponent(cohortId)}`);
}
