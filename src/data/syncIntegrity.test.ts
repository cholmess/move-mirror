import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import manifest from "./generated/manifest.json";
import core from "./generated/exercises.core.json";
import pool from "./generated/exercises.pool.json";
import type { Exercise } from "./exerciseTypes";

const CORE_SOLUTIONS = [
  { id: "ex-184070622900-m20", solution: "Qxe4" },
  { id: "ex-174256061220-m61", solution: "Rh4" },
  { id: "ex-183971526340-m42", solution: "Rb1+" },
  { id: "ex-174197859140-m29", solution: "g4" },
  { id: "ex-184215932040-m26", solution: "Qxh4" },
];

function verifySanLine(fen: string, sanLine: string | null | undefined) {
  if (!sanLine) return;
  const chess = new Chess(fen);
  for (const san of sanLine.split(/\s+/)) {
    const m = chess.move(san);
    expect(m, `illegal ${san} in ${sanLine}`).not.toBeNull();
  }
}

describe("sync:fase2 integrity", () => {
  it("manifest counts 5 core + 344 pool", () => {
    expect(manifest.counts.core).toBe(5);
    expect(manifest.counts.pool).toBe(344);
    expect(core.length).toBe(5);
    expect(pool.length).toBe(344);
  });

  it("core solutions intact", () => {
    for (const exp of CORE_SOLUTIONS) {
      const ex = (core as Exercise[]).find((e) => e.id === exp.id);
      expect(ex?.solutionSan).toBe(exp.solution);
      expect(ex?.referenceLineSan?.length).toBeGreaterThan(5);
    }
  });

  it("SAN reference lines are legal from FEN", () => {
    const sample = [...(core as Exercise[]), ...(pool as Exercise[])].slice(0, 40);
    for (const ex of sample) {
      if (ex.referenceLineSan) verifySanLine(ex.fen, ex.referenceLineSan);
      if (ex.realLineSan && ex.realLineSan.includes(" ")) {
        verifySanLine(ex.fen, ex.realLineSan);
      }
    }
  });
});
