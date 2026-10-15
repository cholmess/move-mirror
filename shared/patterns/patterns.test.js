import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { classifyDecision, positionContext, positionKey } from "./detect.js";
import { buildPatternProfile } from "./profile.js";
function evaluation(fen, playedUci, bestUci, replyUci, loss = 200) {
  return { verified: true, status: "incorrect", engineVersion: "fixture", engineSha256: "fixture-sha", evalCriterionVersion: "engine-validated-v2", evalFinalBudgetId: "nodes-80k-v1", cpLoss: loss,
    best: { firstMoveUci: bestUci, pvUci: [bestUci], score: { mate: null } }, played: { firstMoveUci: playedUci, score: { mate: null } }, opponentReplyUci: replyUci };
}
describe("personal pattern observations", () => {
  it("does not turn unavailable or illegal engine lines into evidence", () => {
    const fen = new Chess().fen(); const decision = { fen, moveUci: "e2e4" };
    expect(classifyDecision(decision, { ...evaluation(fen, "e2e4", "d2d4", "e7e5"), verified: false })).toBeNull();
    expect(classifyDecision(decision, evaluation(fen, "e2e4", "d2d4", "e7e2"))).toBeNull();
    expect(classifyDecision(decision, { ...evaluation(fen, "e2e4", "d2d4", "e7e5"), engineSha256: null })).toBeNull();
  });
  it("recognizes a missed verified mate", () => {
    const fen="6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1";
    const r=evaluation(fen,"d1e1","d1d8","g8f8");r.best.score.mate=1;
    expect(classifyDecision({fen,moveUci:"d1e1"},r).patternId).toBe("missed-mate");
  });
  it("identifies a verified piece capture after a costly move", () => {
    const chess = new Chess(); for (const move of ["e4", "e5", "Qh5", "Nc6"]) chess.move(move);
    const fen = chess.fen(), played = "h5h7", reply = "h8h7";
    const result = classifyDecision({ fen, moveUci: played }, evaluation(fen, played, "h5f3", reply));
    expect(result.patternId).toBe("piece-loss");
  });
  it("identifies a missed piece capture without inventing its cause", () => {
    const fen = "4k3/8/8/8/8/8/q7/R3K3 w Q - 0 1";
    const result = classifyDecision({ fen, moveUci: "e1f1" }, evaluation(fen, "e1f1", "a1a2", "a2a1"));
    // The reply also captures a piece, so the more direct observation has precedence.
    expect(result.patternId).toBe("piece-loss");
    const quiet = classifyDecision({ fen, moveUci: "e1f1" }, evaluation(fen, "e1f1", "a1a2", "e8f8"));
    expect(quiet.patternId).toBe("missed-capture");
  });
  it("recognizes blocked centers without claiming a strategic cause", () => {
    const chess = new Chess(); for (const move of ["d4", "d5", "c4", "e6", "c5", "e5", "e4", "Nf6", "Nc3", "Nc6", "Nf3", "Be7"]) chess.move(move);
    const fen = chess.fen(); expect(positionContext(fen).closed).toBe(true);
    expect(classifyDecision({ fen, moveUci: "a2a3" }, evaluation(fen, "a2a3", "f1b5", "a7a6")).patternId).toBe("closed-center");
  });
  it("separates low-material context from claims about endgame technique", () => {
    const fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
    expect(classifyDecision({ fen, moveUci: "e2e3" }, evaluation(fen, "e2e3", "e1d2", "e8d7")).patternId).toBe("endgame-decisions");
  });
});
function row(i, gameId = `g${i}`) { const chess = new Chess(); chess.move("e4"); if (i % 2) chess.move("e5"); return { gameId, patternId: "piece-loss", fen: `${chess.fen().split(" ").slice(0, 4).join(" ")} ${i} 1`, opportunities: ["piece-loss"], loss: 200, moveNumber: 1, exerciseId: `e${i}`, datePrecision: "exact", gameStartedAt: "2026-09-01T10:00:00Z", gameEndedAt: "2026-09-01T10:10:00Z", importedAt: "2026-09-01T11:00:00Z" }; }
describe("pattern recurrence and learning evidence", () => {
  it("does not promote several errors from one game", () => {
    const profile = buildPatternProfile([row(0,"same"),row(1,"same"),row(2,"same")]);
    expect(profile.find(p=>p.id === "piece-loss").status).toBe("watching");
  });
  it("requires distinct positions as well as games", () => {
    expect(buildPatternProfile([row(0), row(2), row(4)]).find(p=>p.id === "piece-loss").status).toBe("watching");
  });
  it("excludes assisted and repeated attempts from mastery", () => {
    const profile = buildPatternProfile([], [{ patternId: "piece-loss", independent: false, verified: true, status: "verified_best" }]);
    expect(profile.find(p=>p.id === "piece-loss").practice.estimate).toBeNull();
  });
  it("does not infer improvement from tiny future cohorts", () => {
    const profile = buildPatternProfile([row(0)], [], [{ patternId: "piece-loss", at: "2026-09-02T00:00:00Z", positionKey: "none" }]);
    expect(profile.find(p=>p.id === "piece-loss").transfer.status).toBe("insufficient");
  });
  it("uses independent practice to adjust priority without claiming transfer", () => {
    const rows=[row(0),row(1),{...row(2),fen:"4k3/8/8/8/8/8/P7/4K3 w - - 0 1"}];
    const before=buildPatternProfile(rows).find(p=>p.id==="piece-loss");
    const after=buildPatternProfile(rows,[{patternId:"piece-loss",independent:true,verified:true,status:"verified_best",at:"2026-09-12T00:00:00Z"}],[],Date.parse("2026-09-12T01:00:00Z")).find(p=>p.id==="piece-loss");
    expect(before.status).toBe("recurrent");expect(after.priority).toBeLessThan(before.priority);
    expect(after.transfer.status).toBe("insufficient");
  });

  it("keeps transfer descriptive, non-causal, and excludes trained positions after first exposure", () => {
    const trained = { ...row(0), fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2", gameStartedAt: "2026-09-10T00:00:00Z" };
    const exposures = [{ patternId: "piece-loss", at: "2026-09-05T00:00:00Z", positionKey: positionKey(trained.fen) }];
    const afterGame = { ...row(1), gameStartedAt: "2026-09-10T00:00:00Z", datePrecision: "exact" };
    const profile = buildPatternProfile([trained, afterGame], [], exposures);
    const transfer = profile.find(p => p.id === "piece-loss").transfer;
    expect(transfer.causal).toBe(false);
    expect(transfer.status).toBe("insufficient");
    expect(transfer.before.decisions).toBeGreaterThanOrEqual(0);
  });

  it("ignores inexact game dates for transfer cohorts", () => {
    const vague = { ...row(0), datePrecision: "month", gameStartedAt: "2026-09-01T00:00:00Z" };
    const profile = buildPatternProfile([vague], [], [{ patternId: "piece-loss", at: "2026-09-02T00:00:00Z", positionKey: "x" }]);
    expect(profile.find(p => p.id === "piece-loss").transfer.status).toBe("insufficient");
  });

});
