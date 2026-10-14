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
  it("coalesces automatic import updates", async () => {
    service.schedule(); service.schedule(); await service.wait(); expect(evaluate).toHaveBeenCalledTimes(5);
  });
});
