const BASE = import.meta.env.VITE_ENGINE_API ?? "";

export interface ValidationPublicStatus {
  lessonCompleted: boolean;
  exercises: { done: number; required: number };
  verifiedSuccesses: { done: number; required: number };
  sessions: { done: number; required: number };
  days: { done: number; required: number };
  qualificationReached: boolean;
  qualificationReachedAt: string | null;
  nextAction: string | null;
  exercisesRemaining: number;
  canonicalSource: "server";
}

async function parseJson(res: Response) {
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error ?? `http_${res.status}`);
  return data;
}

export async function fetchValidationStatus(): Promise<ValidationPublicStatus> {
  const data = await parseJson(await fetch(`${BASE}/api/validation/status`));
  return data.status as ValidationPublicStatus;
}

export async function migrateValidationFromLocal(exportBody: Record<string, unknown>) {
  return parseJson(
    await fetch(`${BASE}/api/validation/migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exportBody),
    }),
  );
}

export async function syncValidationPedagogy(pedagogyEvents: unknown[]) {
  return parseJson(
    await fetch(`${BASE}/api/validation/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "pedagogy_batch", pedagogyEvents }),
    }),
  );
}
