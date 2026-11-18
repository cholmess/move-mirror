/**
 * Natural-language explanations, grounded in engine lines.
 * The board facts come from chess.js; Claude only words them. Any move or square in the reply that is not
 * part of the verified lines rejects the text, and the client falls back to its template explanation.
 * Disabled with MOVE_MIRROR_LLM=off; needs Anthropic credentials (ANTHROPIC_API_KEY or an `ant auth login` profile).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { verifyExplanation } from "../../shared/daily/explain.js";

export const EXPLAIN_PROMPT_VERSION = "grounded-explain-v1";
const LANG = { es: "Spanish", en: "English", de: "German" };

const SYSTEM = `You are a patient chess coach for an adult club player rated about 1200-1500 who is working on one habit:
before moving, check the opponent's checks, captures and threats (blunder check).
You receive JSON facts computed by a chess engine and a rules library. Explain them in 2-3 short sentences.
Rules:
- Use ONLY the moves listed in the facts, written exactly in the given SAN. Never mention any other move or square.
- Say concretely what the punishing reply does (captures what, gives check, attacks which pieces), then name the habit that would have caught it.
- If a best move is given, say in one clause why it is better. No engine numbers, no centipawns, no evaluations like +2.3.
- Plain language, no headings, no lists.`;

export function createExplainService({ cacheFile, enabled = process.env.MOVE_MIRROR_LLM !== "off",
  model = process.env.MOVE_MIRROR_LLM_MODEL ?? "claude-opus-5-5", clientFactory = () => new Anthropic() }) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { cache = {}; }
  let client = null; let unavailable = !enabled ? "disabled" : null;

  function persist() {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile + ".tmp", JSON.stringify(cache)); fs.renameSync(cacheFile + ".tmp", cacheFile);
  }
  function getClient() {
    if (unavailable) return null;
    try { client ??= clientFactory(); return client; } catch { unavailable = "no_credentials"; return null; }
  }

  async function explain({ facts, locale = "es", kind }) {
    const language = LANG[locale] ?? LANG.en;
    const key = createHash("sha256").update(JSON.stringify([EXPLAIN_PROMPT_VERSION, model, facts, language, kind])).digest("hex");
    if (cache[key]) return { status: "ok", text: cache[key].text, model: cache[key].model, cached: true };
    const api = getClient();
    if (!api) return { status: unavailable ?? "unavailable", text: null };
    try {
      const response = await api.beta.messages.create({
        model, max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{ role: "user", content: `Answer in ${language}. Task type: ${kind}.\nFacts:\n${JSON.stringify(facts)}` }],
      });
      if (response.stop_reason === "refusal") return { status: "refused", text: null };
      const text = response.content.filter(b => b.type === "text").map(b => b.text).join(" ").trim();
      const check = verifyExplanation(text, facts);
      if (!check.ok) return { status: "rejected", text: null, reason: check.reason };
      cache[key] = { text, model: response.model, at: new Date().toISOString() }; persist();
      return { status: "ok", text, model: response.model, cached: false };
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) { unavailable = "no_credentials"; return { status: unavailable, text: null }; }
      if (error instanceof Anthropic.RateLimitError) return { status: "rate_limited", text: null };
      if (error instanceof Anthropic.APIError) return { status: "api_error", text: null };
      // Missing credentials surface as a plain Error from the SDK before any request is made.
      if (/api[_ ]?key|auth/i.test(String(error?.message))) { unavailable = "no_credentials"; return { status: unavailable, text: null }; }
      return { status: "unavailable", text: null };
    }
  }
  return { explain, status: () => unavailable ?? "ready" };
}
