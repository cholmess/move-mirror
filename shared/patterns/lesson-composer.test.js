import { describe, expect, it } from "vitest";
import { composePersonalLesson } from "./lesson-composer.js";

const record = (id, gameId, patternId = "piece-loss", overrides = {}) => ({
  exerciseId: id, gameId, patternId, moveNumber: 12, loss: 220,
  opportunities: ["piece-loss"], fen: "secret", referenceSan: "secret", ...overrides,
});
const pattern = { id: "piece-loss", errors: 4, games: 3, opportunities: 30, confidence: "limited" };
const curriculum = (action) => ({ action, targetCategory: "reply_search" });

describe("personal lesson composer", () => {
  it("builds a bounded lesson from distinct personal games without leaking solutions", () => {
    const lesson = composePersonalLesson({
      pattern, curriculum: curriculum("diagnose"), hypothesis: null, at: "2026-10-22T10:00:00Z",
      records: [record("a", "g1"), record("b", "g1"), record("c", "g2"), record("d", "g3"), record("ok", "g4", null)],
      guided: [record("a", "g1")], holdout: record("d", "g3"),
    });
    expect(lesson).toMatchObject({ version: "personal-lesson-v2", method: "discriminating_probe",
      skill: { id: "material-safety", evidenceScope: "pattern:piece-loss" },
      evidence: { errors: 4, games: 3 }, sequence: { guidedPositions: 1, blindHoldout: true } });
    expect(lesson.evidence.examples.map((row) => row.gameId)).toEqual(["g1", "g2", "g3"]);
    expect(lesson.evidence.contrast).toMatchObject({ gameId: "g4", kind: "comparable_non_error" });
    expect(JSON.stringify(lesson)).not.toContain("secret");
  });

  it.each([
    ["diagnose", "discriminating_probe"],
    ["reteach", "worked_contrast"],
    ["revise_hypothesis", "alternative_probe"],
    ["bridge_transfer", "game_like_retrieval"],
    ["maintenance", "spaced_retrieval"],
  ])("maps %s to a concrete teaching method", (action, method) => {
    const lesson = composePersonalLesson({ pattern, curriculum: curriculum(action), hypothesis: null, records: [record("a", "g1")], guided: [], holdout: null, at: "now" });
    expect(lesson.method).toBe(method);
    expect(lesson.spoilerPolicy).toBe(action === "bridge_transfer" ? "game_like_hidden" : "teaching_visible");
  });

  it("reuses only an explicitly stored grounded synthesis", () => {
    const lesson = composePersonalLesson({
      pattern, curriculum: curriculum("reteach"), records: [record("a", "g1")], guided: [], holdout: null, at: "now",
      hypothesis: { id: "h1", category: "reply_search", status: "tentative", statement: "Hipótesis", synthesisSource: "llm", sourceReflectionId: "r1",
        teaching: { objective: "Objetivo", explanation: "Explicación", evidenceIds: ["current_decision"], contrast: { evidenceIds: ["contrast_1"] } },
        grounding: [{ evidenceId: "current_decision", kind: "player_decision", gameId: "g1", moveNumber: 12 },
          { evidenceId: "contrast_1", kind: "comparable_non_error", gameId: "g2", moveNumber: 20 },
          { evidenceId: "unused", kind: "similar_error", gameId: "g3", moveNumber: 7 }],
        nextTest: { instruction: "Comprueba" } },
    });
    expect(lesson.narrative).toMatchObject({ source: "llm", sourceReflectionId: "r1", explanation: "Explicación" });
    expect(lesson.narrative.citations.map((row) => row.evidenceId)).toEqual(["current_decision", "contrast_1"]);
    expect(JSON.stringify(lesson.narrative.citations)).not.toContain("fen");
  });

  it("builds the strategic second focus without borrowing positions from another skill", () => {
    const closedPattern = { ...pattern, id: "closed-center" };
    const closed = record("closed", "g5", "closed-center");
    const lesson = composePersonalLesson({
      pattern: closedPattern, curriculum: curriculum("diagnose"), hypothesis: null,
      records: [closed, record("piece", "g1")], guided: [closed], holdout: null, at: "now",
    });
    expect(lesson.skill).toMatchObject({
      id: "closed-center-planning", familyId: "strategic-planning",
      kind: "strategic_process", evidenceScope: "pattern:closed-center",
    });
    expect(lesson.evidence.examples.map((row) => row.recordId)).toEqual(["closed"]);
    expect(() => composePersonalLesson({
      pattern: closedPattern, curriculum: curriculum("diagnose"), hypothesis: null,
      records: [closed], guided: [record("foreign", "g6")], holdout: null, at: "now",
    })).toThrow("lesson_evidence_scope_mismatch");
  });
});
