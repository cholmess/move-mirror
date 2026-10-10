import { describe, it, expect } from "vitest";
import { sanitizeCreateSessionBody } from "./session-create.js";
import { hashProfileSnapshot, buildProfileSnapshot } from "./profile.js";

describe("session create validation", () => {
  it("accepts valid pattern and mode", () => {
    const body = sanitizeCreateSessionBody({
      mode: "full_game",
      patternId: "cct-opponent-refutation",
      userColor: "white",
    });
    expect(body.priorityPatternId).toBe("allowed-forcing-reply");
  });

  it("rejects unknown pattern", () => {
    expect(() => sanitizeCreateSessionBody({ mode: "full_game", patternId: "made-up" })).toThrow(
      "sparring_pattern_unknown",
    );
  });

  it("rejects client snapshot manipulation", () => {
    expect(() =>
      sanitizeCreateSessionBody({ mode: "full_game", profileSnapshot: { patternId: "hack" } }),
    ).toThrow("sparring_client_snapshot_forbidden");
  });

  it("snapshot hash stable for same canonical payload", () => {
    const a = buildProfileSnapshot({
      patternId: "allowed-forcing-reply",
      defenseResourceNeeds: { capture_attacker: 0.5 },
      uncertainty: { capture_attacker: 0.4 },
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    const b = buildProfileSnapshot({
      patternId: "allowed-forcing-reply",
      defenseResourceNeeds: { capture_attacker: 0.5 },
      uncertainty: { capture_attacker: 0.4 },
      capturedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(a.sha256).toBe(b.sha256);
    const c = buildProfileSnapshot({
      patternId: "allowed-forcing-reply",
      defenseResourceNeeds: { capture_attacker: 0.9 },
      uncertainty: { capture_attacker: 0.4 },
    });
    expect(c.sha256).not.toBe(a.sha256);
  });
});
