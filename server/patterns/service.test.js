import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Chess } from "chess.js";
import { createPatternStore } from "./store.mjs";
import { createPatternService, selectPersonalGames } from "./service.mjs";
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
  async function activate() {
    games=[game("g1"),game("g2"),game("g3")]; await service.update();
    const state=store.read();
    const keys=Object.keys(state.analyses);
    keys.forEach((key,index)=> { const a=state.analyses[key]; state.analyses[key]={...a,rows:a.rows.map((r,i)=>({...r,patternId:i===index?"piece-loss":null,loss:i===index?300:0}))}; });
    store.write(state,keys);expect(service.summary().patterns.find(p=>p.id==="piece-loss").status).toBe("recurrent");
  }
  it("keeps solutions private until asked and counts assisted repeats separately", async () => {
    await activate();const ex=service.startPractice("piece-loss");
    expect(service.exerciseView(ex.id).referenceSan).toBeUndefined();
    service.reveal(ex.id,"hint");const r=await service.submit(ex.id,"a2a3");
    expect(r.independent).toBe(false);const calls=evaluate.mock.calls.length;
    expect((await service.submit(ex.id,"a2a4")).id).toBe(r.id);expect(evaluate.mock.calls.length).toBe(calls);
    const retry=service.startPractice("piece-loss",ex.positionId);expect(retry.repeated).toBe(true);
    expect(service.summary().patterns.find(p=>p.id==="piece-loss").practice.independent).toBe(0);
  });
  it("revokes derived exercises and their learning evidence when a source game is deleted", async () => {
    await activate();const ex=service.startPractice("piece-loss");await service.submit(ex.id,"a2a3");
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
    await restarted.submit(next.id,"a2a3");
    expect(restarted.activePractice().id).toBe(next.id);
    expect(restarted.activePractice().decisionCount).toBe(1);
  });
  it("trains several decisions, then measures an unseen holdout without help", async () => {
    await activate();
    const guided=service.startPractice("piece-loss");
    expect(guided).toMatchObject({role:"guided",targetDecisions:3,decisionCount:0});
    for (let decision=1;decision<=3;decision++) {
      const view=service.exerciseView(guided.id); const chess=new Chess(view.fen); const legal=chess.moves({verbose:true})[0];
      let result=await service.submit(guided.id,legal.from+legal.to+(legal.promotion??""));
      expect(result.independent).toBe(false);
      if (decision===1) {
        const retried=service.retryDecision(guided.id);
        expect(retried).toMatchObject({decisionCount:0,status:"active",fen:guided.fen});
        result=await service.submit(guided.id,legal.from+legal.to+(legal.promotion??""));
        expect(result.decisionNumber).toBe(1);
      }
      if (decision<3) { expect(result.canContinue).toBe(true); service.advance(guided.id); }
    }
    expect(service.exerciseView(guided.id)).toMatchObject({status:"ready_for_holdout",canStartHoldout:true});
    const holdout=service.startHoldout(guided.id);
    expect(holdout).toMatchObject({role:"holdout",targetDecisions:1});
    expect(holdout.positionId).not.toBe(guided.positionId);
    const chess=new Chess(holdout.fen); const legal=chess.moves({verbose:true})[0];
    const result=await service.submit(holdout.id,legal.from+legal.to+(legal.promotion??""));
    expect(result).toMatchObject({independent:true,trainingStatus:"completed"});
    expect(service.activePractice()).toBeNull();
    expect(service.summary().patterns.find(p=>p.id==="piece-loss").practice.independent).toBe(1);
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
});
