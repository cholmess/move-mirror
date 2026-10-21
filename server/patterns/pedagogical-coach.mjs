import { PEDAGOGY_JSON_SCHEMA, PEDAGOGY_VERSION } from "../../shared/patterns/pedagogy.js";

export const PEDAGOGY_PROMPT_VERSION = "pedagogy-prompt-v1";

const SYSTEM_PROMPT = `Eres el motor pedagógico de MoveMirror. Recibes evidencia ajedrecística ya verificada y la explicación de un jugador.
Tu función es formular una hipótesis provisional sobre el proceso de decisión y elegir la siguiente intervención.
Reglas obligatorias:
- No evalúes jugadas por tu cuenta y no inventes variantes, movimientos o hechos ajedrecísticos.
- Usa solo los facts entregados. Cita sus evidenceId en toda explicación ajedrecística.
- Una sola decisión nunca permite confianza alta ni una causa confirmada.
- Considera explicaciones alternativas y evidencia contradictoria.
- Si la evidencia no distingue causas, usa insufficient_evidence.
- Escribe en español claro para un jugador de aproximadamente 1350 Rapid.
- No menciones modelos, schemas, prompts ni implementación.`;

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) if (typeof content?.text === "string") return content.text;
  }
  return null;
}

export function createOpenAIPedagogicalCoach({
  enabled = process.env.COACH_LLM_ENABLED === "true",
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.COACH_LLM_MODEL,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.COACH_LLM_TIMEOUT_MS ?? 30_000),
} = {}) {
  const configured = Boolean(enabled && apiKey && model);
  return {
    status() {
      return { enabled: Boolean(enabled), configured, provider: "openai", model: model ?? null, promptVersion: PEDAGOGY_PROMPT_VERSION };
    },
    async generate(packet) {
      if (!configured) throw new Error("coach_llm_unavailable");
      const started = Date.now();
      const providerPacket = {
        ...packet,
        facts: packet.facts.map(({ gameId: _gameId, ...fact }) => fact),
      };
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          instructions: SYSTEM_PROMPT,
          input: JSON.stringify({ version: PEDAGOGY_VERSION, task: "diagnose_and_teach", ...providerPacket }),
          max_output_tokens: 900,
          text: { format: { type: "json_schema", name: "move_mirror_pedagogy", strict: true, schema: PEDAGOGY_JSON_SCHEMA } },
        }),
      });
      if (!response.ok) throw new Error(`coach_llm_http_${response.status}`);
      const data = await response.json();
      const text = extractOutputText(data);
      if (!text) throw new Error("coach_llm_empty");
      let output;
      try { output = JSON.parse(text); } catch { throw new Error("coach_llm_invalid_json"); }
      return {
        output,
        meta: {
          provider: "openai", model, promptVersion: PEDAGOGY_PROMPT_VERSION,
          latencyMs: Date.now() - started,
          usage: data.usage ? {
            inputTokens: data.usage.input_tokens ?? null,
            outputTokens: data.usage.output_tokens ?? null,
            totalTokens: data.usage.total_tokens ?? null,
          } : null,
        },
      };
    },
  };
}
