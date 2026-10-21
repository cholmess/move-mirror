import { describe, expect, it, vi } from "vitest";
import { fallbackPedagogy } from "../../shared/patterns/pedagogy.js";
import { createOpenAIPedagogicalCoach } from "./pedagogical-coach.mjs";

describe("OpenAI pedagogical coach adapter", () => {
  it("is disabled unless flag, key and model are all present", () => {
    expect(createOpenAIPedagogicalCoach({ enabled: false, apiKey: "x", model: "m" }).status().configured).toBe(false);
    expect(createOpenAIPedagogicalCoach({ enabled: true, apiKey: null, model: "m" }).status().configured).toBe(false);
  });
  it("makes one bounded structured request and returns reported usage", async () => {
    const output = fallbackPedagogy({ intervention: "search", evidenceIds: ["a", "b"] });
    const fetchImpl = vi.fn(async (_url, request) => ({ ok: true, json: async () => ({ output_text: JSON.stringify(output), usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }), request }));
    const coach = createOpenAIPedagogicalCoach({ enabled: true, apiKey: "secret", model: "test-model", fetchImpl });
    const result = await coach.generate({ facts: [{ evidenceId: "a" }, { evidenceId: "b" }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, request] = fetchImpl.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({ model: "test-model", max_output_tokens: 900, text: { format: { type: "json_schema", strict: true } } });
    expect(request.headers.Authorization).toBe("Bearer secret");
    expect(body.input).not.toContain("gameId");
    expect(result.meta.usage.totalTokens).toBe(30);
  });
});
