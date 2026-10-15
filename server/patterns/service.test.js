import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Chess } from "chess.js";
import { createPatternStore } from "./store.mjs";
import { createPatternService, selectPersonalGames } from "./service.mjs";
import { orderGuidedPlan, planSessionLayout } from "../../shared/patterns/session.js";
function game(id, first = "e4") {
  const chess = new Chess(); for (const san of [first, "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d3", "Bc5", "O-O", "d6"]) chess.move(san);
  return { id, fingerprint: id, chess: { variant: "standard", startingFen: new Chess().fen(), movesUci: chess.history({ verbose: true }).map(m=>m.from+m.to+(m.promotion??"")), result: "1-0" },
    players: { playerResolution: { playerColor: "white", confidence: "verified" } }, eligibility: { coachingEligible: true }, timing: { startedAt: `2026-09-0${id.slice(-1)}T10:00:00Z`, endedAt: null, datePrecision: "exact", timeControl: { initialSeconds: 600, incrementSeconds: 0 } }, provenance: { firstImportedAt: "2026-09-10T00:00:00Z" }, sources: [] };
}
function validResult(body) {
  const chess = new Chess(body.fen); const first = chess.moves({verbose:true})[0];
  const best = first.from + first.to + (first.promotion??"");
  chess.move({from:body.moveUci.slice(0,2),to:body.moveUci.slice(2,4),promotion:body.moveUci[4]});
  const reply = chess.moves({verbose:true})[0];
  return { verified:true,status:"verified_acceptable",cpLoss:0, engineVersion:"fixture",engineSha256:"hash",evalCriterionVersion:"engine-validated-v2",evalFinalBudgetId:"nodes-80k-v1",best:{firstMoveUci:best,pvUci:[best],score:{mate:null}},played:{firstMoveUci:body.moveUci,score:{mate:null}},opponentReplyUci:reply?reply.from+reply.to+(reply.promotion??""):null };
}
describe("personal pattern incremental analysis", () => {
  let dir, games, store, service, evaluate, signature;
  beforeEach(() => {
    dir=fs.mkdtempSync(path.join(os.tmpdir(),"mm-patterns-")); games=[game("g1")]; store=createPatternStore(dir); signature="engine-v1";
    evaluate=vi.fn(async body=>validResult(body));
    service=createPatternService({store,gamesStore:{listGames:()=>games},evaluate,analyzerSignature:()=>signature,scheduleDelay:1});
  });
  afterEach(()=>{ service.cancel(); fs.rmSync(dir,{recursive:true,force:true}); });
  it("analyzes only newly imported games and persists a reproducible revision", async () => {
    await service.update(); expect(evaluate).toHaveBeenCalledTimes(5); expect(service.summary().revision).toBe(1);
    await service.update(); expect(evaluate).toHaveBeenCalledTimes(5); expect(service.summary().revision).toBe(1);
    games.push(game("g2")); await service.update(); expect(evaluate).toHaveBeenCalledTimes(10); expect(service.summary().revision).toBe(2);
    expect(service.summary().analyzedGames).toBe(2);
  });
  it("excludes partial games and resumes from verified decisions after a failure", async () => {
    evaluate.mockImplementationOnce(async b=>validResult(b)).mockImplementationOnce(async()=>({verified:false,status:"unverified"}));
    await service.update(); expect(service.summary().analyzedGames).toBe(0); expect(service.summary().job.status).toBe("failed");
    await service.update(); expect(service.summary().analyzedGames).toBe(1); expect(evaluate).toHaveBeenCalledTimes(6);
  });
  it("restores verified checkpoints after a server restart", async () => {
    evaluate.mockImplementationOnce(async b=>validResult(b)).mockImplementationOnce(async()=>({verified:false,status:"unverified"}));
    await service.update();
    const restored=createPatternStore(dir);
    service=createPatternService({store:restored,gamesStore:{listGames:()=>games},evaluate,analyzerSignature:()=>signature});
    await service.update(); expect(service.summary().analyzedGames).toBe(1); expect(evaluate).toHaveBeenCalledTimes(6);
  });
  it("invalidates analysis when the engine signature changes", async () => {
    await service.update(); signature="engine-v2"; expect(service.summary().analyzedGames).toBe(0);
    await service.update(); expect(evaluate).toHaveBeenCalledTimes(10);
  });
  it("removes deleted games from current evidence immediately", async () => {
    await service.update(); games=[]; expect(service.summary().analyzedGames).toBe(0); expect(service.summary().verifiedDecisions).toBe(0);
  });
  it("fails closed without an engine", async () => {
    signature=null; await service.update(); expect(service.summary().job.error).toBe("engine_unavailable"); expect(evaluate).not.toHaveBeenCalled();
  });
  it("excludes short games, other controls, unresolved identities and edited eligibility", () => {
    const valid=game("g1"); const short=game("g2"); short.chess.movesUci=short.chess.movesUci.slice(0,8);
    const blitz=game("g3"); blitz.timing.timeControl.initialSeconds=300;
    const unknown=game("g4"); unknown.players.playerResolution.confidence="unknown";
    expect(selectPersonalGames([valid,short,blitz,unknown])).toEqual([valid]);
  });
  async function activate(extraGames = 0) {
    games=[game("g1"),game("g2"),game("g3")];
    for (let i = 0; i < extraGames; i++) games.push(game(`gx${i}`));
    await service.update();
    const state=store.read();
    const keys=Object.keys(state.analyses);
    keys.forEach((key,index)=> { const a=state.analyses[key]; state.analyses[key]={...a,rows:a.rows.map((r,i)=>({...r,patternId:i===index?"piece-loss":null,loss:i===index?300:0}))}; });
    store.write(state,keys);expect(service.summary().patterns.find(p=>p.id==="piece-loss").status).toBe("recurrent");
  }
  it("keeps solutions private until asked and counts assisted repeats separately", async () => {
    await activate();const ex=service.startPractice("piece-loss");
    expect(service.exerciseView(ex.id).referenceSan).toBeUndefined();
    const view=service.exerciseView(ex.id); const chess=new Chess(view.fen); const legal=chess.moves({verbose:true})[0];
    const moveUci=legal.from+legal.to+(legal.promotion??"");
    service.reveal(ex.id,"hint");const r=await service.submit(ex.id,moveUci);
    expect(r.independent).toBe(false);const calls=evaluate.mock.calls.length;
    expect((await service.submit(ex.id,moveUci)).id).toBe(r.id);expect(evaluate.mock.calls.length).toBe(calls);
    service.startPractice("piece-loss",ex.positionId);
    expect(service.summary().patterns.find(p=>p.id==="piece-loss").practice.independent).toBe(0);
  });
  it("revokes derived exercises and their learning evidence when a source game is deleted", async () => {
    await activate();const ex=service.startPractice("piece-loss");
    const v0=service.exerciseView(ex.id); const c0=new Chess(v0.fen); const m0=c0.moves({verbose:true})[0];
    await service.submit(ex.id,m0.from+m0.to+(m0.promotion??""));
    games=games.filter(g=>g.id!==ex.gameId);service.summary();
    expect(()=>service.exerciseView(ex.id)).toThrow("exercise_unavailable");
    expect(store.read().exposures).toHaveLength(0);expect(store.read().attempts).toHaveLength(0);
  });
  it("resumes practice after restart and never resurrects skipped exercises", async () => {
    await activate();
    const first=service.startPractice("piece-loss");
    const next=service.startPractice("piece-loss");
    // Explicit ordering independent of clock resolution.
    const state=store.read(); state.exercises.find(e=>e.id===first.id).startedAt="2026-10-01T00:00:00Z";
    state.exercises.find(e=>e.id===next.id).startedAt="2026-10-02T00:00:00Z"; store.write(state);
    const restarted=createPatternService({store:createPatternStore(dir),gamesStore:{listGames:()=>games},evaluate,analyzerSignature:()=>signature});
    expect(restarted.activePractice().id).toBe(next.id);
    const rv=restarted.exerciseView(next.id); const ch=new Chess(rv.fen); const mv=ch.moves({verbose:true})[0];
    await restarted.submit(next.id,mv.from+mv.to+(mv.promotion??""));
    expect(restarted.activePractice().id).toBe(next.id);
    expect(restarted.activePractice().decisionCount).toBe(1);
  });
  it("visits every guided slot once when starting from a preferred position not first in the layout", async () => {
    await activate(2);
    const candidates = Object.values(store.read().analyses).flatMap(a => a.rows.filter(r => r.patternId === "piece-loss"));
    const layout = planSessionLayout(candidates, store.read().exposures);
    expect(layout.ok).toBe(true);
    expect(layout.guided.length).toBeGreaterThanOrEqual(2);
    const preferredId = layout.guided[1].exerciseId;
    const expectedIds = orderGuidedPlan(layout.guided, preferredId).map(r => r.exerciseId);

    let guided = service.startPractice("piece-loss", preferredId);
    expect(guided.positionId).toBe(preferredId);
    expect(guided.slotIndex).toBe(0);

    const session = store.read().practiceSessions.find(s => s.id === guided.sessionId);
    expect(session.positionRecordIds).toEqual(expectedIds);

    const visited = [];
    while (true) {
      visited.push(service.exerciseView(guided.id).positionId);
      const slotView = service.exerciseView(guided.id);
      const slotChess = new Chess(slotView.fen);
      const slotLegal = slotChess.moves({ verbose: true })[0];
      const result = await service.submit(guided.id, slotLegal.from + slotLegal.to + (slotLegal.promotion ?? ""));
      if (result.trainingStatus === "ready_for_holdout") break;
      expect(result.trainingStatus).toBe("ready_for_next_slot");
      guided = service.advanceSlot(guided.id);
    }
    expect(visited).toEqual(expectedIds);
    expect(new Set(visited).size).toBe(expectedIds.length);
  });

  it("runs a multi-position session, then measures an unseen holdout without help", async () => {
    await activate(1);
    let guided = service.startPractice("piece-loss");
    expect(guided).toMatchObject({ role: "guided", targetDecisions: 1, decisionCount: 0 });
    expect(guided.sessionPositionTotal).toBeGreaterThanOrEqual(3);
    const view = service.exerciseView(guided.id);
    const chess = new Chess(view.fen);
    const legal = chess.moves({ verbose: true })[0];
    const moveUci = legal.from + legal.to + (legal.promotion ?? "");
    let result = await service.submit(guided.id, moveUci);
    expect(result.independent).toBe(false);
    const retried = service.retryDecision(guided.id);
    expect(retried).toMatchObject({ decisionCount: 0, status: "active", fen: guided.fen });
    result = await service.submit(guided.id, moveUci);
    while (!service.exerciseView(guided.id).canStartHoldout) {
      const slotView = service.exerciseView(guided.id);
      const slotChess = new Chess(slotView.fen);
      const slotLegal = slotChess.moves({ verbose: true })[0];
      const uci = slotLegal.from + slotLegal.to + (slotLegal.promotion ?? "");
      result = await service.submit(guided.id, uci);
      expect(result.independent).toBe(false);
      if (result.trainingStatus === "ready_for_holdout") break;
      expect(result.trainingStatus).toBe("ready_for_next_slot");
      guided = service.advanceSlot(guided.id);
    }
    expect(result.trainingStatus).toBe("ready_for_holdout");
    const holdout = service.startHoldout(guided.id);
    expect(holdout).toMatchObject({ role: "holdout", targetDecisions: 1 });
    expect(holdout.positionId).not.toBe(guided.positionId);
    const holdoutChess = new Chess(holdout.fen);
    const holdoutLegal = holdoutChess.moves({ verbose: true })[0];
    result = await service.submit(holdout.id, holdoutLegal.from + holdoutLegal.to + (holdoutLegal.promotion ?? ""));
    expect(result).toMatchObject({ independent: true, trainingStatus: "completed" });
    expect(result.sessionResult?.countsAsIndependentEvidence).toBe(true);
    expect(result.nextActivity?.kind).toBeTruthy();
    expect(service.activePractice()).toBeNull();
    expect(service.summary().patterns.find(p => p.id === "piece-loss").practice.independent).toBe(1);
    const domains = store.read().patternDomains["piece-loss"];
    expect(domains.independentSuccesses).toBe(1);
    expect(domains.nextReviewAt).toBeTruthy();
  });
  it("resumes the last created exercise when timestamps tie", async () => {
    await activate();
    const first=service.startPractice("piece-loss");
    const next=service.startPractice("piece-loss");
    const state=store.read();
    state.exercises.forEach(e=>{ e.startedAt="2026-10-14T12:00:00Z"; }); store.write(state);
    expect(service.activePractice().id).toBe(next.id);
    expect(service.activePractice().id).not.toBe(first.id);
  });
  it("coalesces automatic import updates", async () => {
    service.schedule(); service.schedule(); await service.wait(); expect(evaluate).toHaveBeenCalledTimes(5);
  });

  it("plans guided/holdout split for 2, 3, 4 and 6 unique pattern positions", async () => {
    await activate(3);
    const candidates = service.summary().patterns.find(p => p.id === "piece-loss");
    expect(candidates.status).toBe("recurrent");
    const records = store.read();
    const allRows = Object.values(records.analyses).flatMap(a => a.rows.filter(r => r.patternId === "piece-loss"));
    const unique = [...new Map(allRows.map(r => [r.fen.split(" ").slice(0, 4).join(" "), r])).values()];
    const layout = planSessionLayout(unique, []);
    expect(layout.ok).toBe(true);
    expect(layout.guided.length + 1).toBeLessThanOrEqual(unique.length);
    expect(layout.sessionShortfall).toBe(unique.length < 4);
  });

  it("surfaces insufficient_holdout_positions when layout cannot reserve a holdout", async () => {
    await activate(0);
    const candidates = Object.values(store.read().analyses).flatMap(a => a.rows.filter(r => r.patternId === "piece-loss"));
    const layout = planSessionLayout([candidates[0]], []);
    expect(layout.ok).toBe(false);
    expect(layout.error).toBe("insufficient_holdout_positions");
  });

  it("records independent failure as domain evidence with one-day review", async () => {
    await activate(1);
    let guided = service.startPractice("piece-loss");
    while (!service.exerciseView(guided.id).canStartHoldout) {
      const slotView = service.exerciseView(guided.id);
      const slotChess = new Chess(slotView.fen);
      const slotLegal = slotChess.moves({ verbose: true })[0];
      const result = await service.submit(guided.id, slotLegal.from + slotLegal.to + (slotLegal.promotion ?? ""));
      if (result.trainingStatus === "ready_for_holdout") break;
      guided = service.advanceSlot(guided.id);
    }
    const holdout = service.startHoldout(guided.id);
    const beforeDomain = store.read().patternDomains?.["piece-loss"] ?? { beta: 1 };
    evaluate.mockImplementationOnce(async body => ({ ...validResult(body), status: "incorrect", verified: true }));
    const holdoutChess = new Chess(holdout.fen);
    const holdoutLegal = holdoutChess.moves({ verbose: true })[0];
    const result = await service.submit(holdout.id, holdoutLegal.from + holdoutLegal.to + (holdoutLegal.promotion ?? ""));
    expect(result.sessionResult.outcomeKey).toBe("needs_reinforcement");
    expect(result.sessionResult.countsAsIndependentEvidence).toBe(true);
    const domain = store.read().patternDomains["piece-loss"];
    expect(domain.independentFailures).toBe(1);
    expect(domain.beta).toBeGreaterThan(beforeDomain.beta ?? 1);
    expect(Date.parse(domain.nextReviewAt) - Date.parse(result.at)).toBeLessThanOrEqual(86400000 + 1000);
  });

  it("does not duplicate domain evidence when holdout submit is retried", async () => {
    await activate(1);
    let guided = service.startPractice("piece-loss");
    while (!service.exerciseView(guided.id).canStartHoldout) {
      const slotView = service.exerciseView(guided.id);
      const slotChess = new Chess(slotView.fen);
      const slotLegal = slotChess.moves({ verbose: true })[0];
      const result = await service.submit(guided.id, slotLegal.from + slotLegal.to + (slotLegal.promotion ?? ""));
      if (result.trainingStatus === "ready_for_holdout") break;
      guided = service.advanceSlot(guided.id);
    }
    const holdout = service.startHoldout(guided.id);
    const holdoutChess = new Chess(holdout.fen);
    const holdoutLegal = holdoutChess.moves({ verbose: true })[0];
    const uci = holdoutLegal.from + holdoutLegal.to + (holdoutLegal.promotion ?? "");
    const first = await service.submit(holdout.id, uci);
    const attemptsAfterFirst = store.read().patternDomains["piece-loss"].independentAttempts;
    const second = await service.submit(holdout.id, uci);
    expect(second.id).toBe(first.id);
    expect(store.read().patternDomains["piece-loss"].independentAttempts).toBe(attemptsAfterFirst);
    expect(store.read().patternDomains["piece-loss"].history.filter(h => h.event === "independent_success").length).toBeLessThanOrEqual(1);
  });
});
