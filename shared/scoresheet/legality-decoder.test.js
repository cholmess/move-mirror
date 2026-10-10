import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { decodeScoresheetSequence, recomputeFromPly, applyManualPlySelection } from "./legality-decoder.mjs";
import { normalizeToken } from "./normalizer.mjs";
import { sanToLocaleDisplay } from "./notation.mjs";
import { observationToRawMoveTokens } from "./layout.mjs";

function token(id, text, x, y, confidence = 0.9) {
  return { id, text, confidence, page: 1, boundingBox: { x, y, width: 40, height: 12 } };
}

describe("scoresheet normalizer", () => {
  it("normalizes castling zeros", () => {
    expect(normalizeToken("O-O").normalized).toBe("0-0");
    expect(normalizeToken("0-0").normalized).toBe("0-0");
  });

  it("drops move numbers", () => {
    expect(normalizeToken("12.").dropped).toBe(true);
  });
});

describe("notation locales", () => {
  it("maps spanish knight", () => {
    expect(sanToLocaleDisplay("Nf3", "es")).toBe("Cf3");
  });
  it("maps german knight", () => {
    expect(sanToLocaleDisplay("Nf3", "de")).toBe("Sf3");
  });
});

describe("legality decoder", () => {
  it("decodes a short english line deterministically", () => {
    const rows = [
      { side: "white", token: token("t1", "e4", 100, 100) },
      { side: "black", token: token("t2", "e5", 300, 100) },
      { side: "white", token: token("t3", "Nf3", 100, 130) },
    ];
    const first = decodeScoresheetSequence({ moveRows: rows, locale: "en" });
    const second = decodeScoresheetSequence({ moveRows: rows, locale: "en" });
    expect(first.plies.map((p) => p.selectedUci)).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(second.plies.map((p) => p.selectedUci)).toEqual(first.plies.map((p) => p.selectedUci));
  });

  it("marks ambiguous when two legal moves score closely", () => {
    const rows = [{ side: "white", token: token("t1", "a3", 100, 100, 0.5) }];
    const decoded = decodeScoresheetSequence({ moveRows: rows, locale: "en" });
    expect(decoded.plies[0].candidates.length).toBeGreaterThan(1);
  });

  it("recomputes tail after manual correction", () => {
    const rows = [
      { side: "white", token: token("t1", "e4", 100, 100) },
      { side: "black", token: token("t2", "e5", 300, 100) },
      { side: "white", token: token("t3", "Nf3", 100, 130) },
    ];
    const decoded = decodeScoresheetSequence({ moveRows: rows, locale: "en" });
    let plies = decoded.plies;
    plies = applyManualPlySelection(plies, 0, { uci: "d2d4", san: "d4", locale: "en" });
    plies = recomputeFromPly({
      plies,
      fromPlyIndex: 1,
      moveRows: rows.slice(1),
      locale: "en",
    });
    expect(plies[0].selectedUci).toBe("d2d4");
    const chess = new Chess();
    for (const ply of plies) {
      if (!ply.selectedUci) continue;
      chess.move({ from: ply.selectedUci.slice(0, 2), to: ply.selectedUci.slice(2, 4), promotion: ply.selectedUci[4] });
    }
    expect(chess.history().length).toBeGreaterThan(0);
  });
});

describe("layout", () => {
  it("orders two-column tokens", () => {
    const observation = {
      pages: [{
        page: 1,
        width: 800,
        height: 600,
        rawText: "",
        tokens: [
          token("a", "1.", 50, 100),
          token("b", "e4", 120, 100),
          token("c", "e5", 420, 100),
        ],
      }],
    };
    const rows = observationToRawMoveTokens(observation);
    expect(rows.map((r) => r.token.text)).toEqual(["e4", "e5"]);
  });
});
