/**
 * Daily training loop:
 *  - today's session (≈20 min): spaced repetition of own mistakes + Lichess puzzles near the player's rating,
 *    mostly framed as refutation drills (find the opponent's punishment of a candidate move);
 *  - post-game review: the 3 costliest decisions of a fresh game, with a "what did you see?" prompt before the engine;
 *  - weekly progress: pieces lost per 100 decisions, rating, training volume.
 * This domain keeps its own evidence; it never writes pattern mastery, transfer cohorts or the validation ledger.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { cardsFromRow, cardFromPuzzle, presentCard, checkStep, describeLine, applyUci, LIMIT_MS } from "../../shared/daily/cards.js";
import { expandPuzzle, parseCsvLine, keepPuzzle } from "../../shared/daily/puzzles.js";
import { gradeAnswer, newCardState, scheduleCard } from "../../shared/daily/srs.js";
import { buildDailySession, latestRating, SESSION_DEFAULTS } from "../../shared/daily/session.js";
import { weeklyMetrics, streakDays, controlLabel, localDay } from "../../shared/daily/metrics.js";
import { buildFacts } from "../../shared/daily/explain.js";

export const REVIEW_CAUSES = ["not_seen", "seen_misjudged", "time_pressure", "no_plan", "other"];
const ACCEPTED = new Set(["verified_best", "verified_acceptable"]);
const MAX_LOG = 20_000;

export function createDailyService({ store, patterns, puzzleBankFile, evaluate, explain, syncRecent = null, now = () => Date.now() }) {
  let bank = null;

  function loadBank() {
    if (bank) return bank;
    bank = { rows: [], available: false, source: null };
    if (!puzzleBankFile || !fs.existsSync(puzzleBankFile)) return bank;
    try {
      const raw = fs.readFileSync(puzzleBankFile, "utf8");
      const rows = puzzleBankFile.endsWith(".csv")
        ? raw.split("\n").map(parseCsvLine).filter(p => keepPuzzle(p, { minPlays: 0, minRating: 0, maxRating: 4000 }))
        : JSON.parse(raw).rows.map(expandPuzzle);
      bank = { rows, available: rows.length > 0, source: puzzleBankFile.endsWith(".csv") ? "fixture" : "lichess" };
    } catch { bank = { rows: [], available: false, source: null }; }
    return bank;
  }

  function playerGames() {
    return patterns.personalGames().map(g => {
      const color = g.players.playerResolution.playerColor;
      const opp = color === "white" ? "black" : "white";
      const r = g.chess.result;
      const outcome = r === "1/2-1/2" ? "draw" : (r === "1-0") === (color === "white") ? "win" : "loss";
      return { id: g.id, startedAt: g.timing.startedAt ?? g.provenance.firstImportedAt, rating: g.players[color]?.rating ?? null,
        opponent: g.players[opp]?.name ?? null, opponentRating: g.players[opp]?.rating ?? null, color, outcome,
        control: controlLabel(g.timing.timeControl), plies: g.chess.movesUci.length };
    });
  }

  /** Adds cards for new analysed mistakes. Own cards whose source decision disappeared are skipped at session time. */
  function syncOwnCards(rows) {
    const fresh = rows.filter(r => r.patternId).flatMap(cardsFromRow);
    const known = store.read().cards;
    const missing = fresh.filter(c => !known[c.id]);
    if (missing.length) store.mutate(s => { for (const c of missing) s.cards[c.id] = c; });
    return new Set(fresh.map(c => c.id));
  }

  function patternWeights() {
    const summary = patterns.summary();
    return Object.fromEntries(summary.patterns.filter(p => p.status !== "no_evidence").map(p => [p.id, p.errors]));
  }

  function today() { return localDay(now()); }

  function activeSession() {
    const s = store.read().sessions.at(-1);
    return s && s.date === today() && !s.finishedAt ? s : null;
  }

  function startSession(options = {}) {
    const existing = activeSession();
    if (existing) return sessionView(existing.id);
    const rows = patterns.decisionRows();
    const validOwn = syncOwnCards(rows);
    const state = store.read();
    const cards = Object.values(state.cards).filter(c => c.source !== "own" || validOwn.has(c.id));
    const introduced = new Set(cards.filter(c => c.source === "puzzle").map(c => c.puzzleId));
    const rating = latestRating(playerGames());
    const target = rating ?? 1300;
    const pool = loadBank().rows.filter(p => !introduced.has(p.id) && Math.abs(p.rating - target) <= 400).slice(0, 4000).map(cardFromPuzzle);
    const plan = buildDailySession({ cards, puzzles: pool, patternWeights: patternWeights(), rating, now: now(), seed: today(), options: { ...SESSION_DEFAULTS, ...options } });
    const poolById = new Map(pool.map(c => [c.id, c]));
    const session = { id: randomUUID(), date: today(), startedAt: new Date(now()).toISOString(), finishedAt: null, minutes: plan.minutes,
      index: 0, rating, items: plan.cardIds.map(cardId => ({ cardId, step: 0, servedAt: null, status: "pending", moves: [] })),
      stats: { due: plan.dueCount, newOwn: plan.newOwn, newPuzzles: plan.newPuzzles } };
    if (session.items[0]) Object.assign(session.items[0], { servedAt: session.startedAt, status: "active" });
    store.mutate(s => { for (const id of plan.cardIds) if (poolById.has(id) && !s.cards[id]) s.cards[id] = poolById.get(id); s.sessions.push(session); s.sessions = s.sessions.slice(-120); });
    return sessionView(session.id);
  }

  function findSession(id) {
    const session = store.read().sessions.find(s => s.id === id);
    if (!session) throw new Error("session_not_found");
    return session;
  }

  function currentFen(card, step) {
    const view = presentCard(card); const chess = new Chess(view.fen);
    for (const uci of card.solution.slice(0, step * 2)) applyUci(chess, uci);
    return chess.fen();
  }

  function itemDto(session, index) {
    const item = session.items[index]; if (!item) return null;
    const card = store.read().cards[item.cardId]; if (!card) return null;
    const view = presentCard(card);
    return { index, cardId: card.id, kind: card.kind, source: card.source, patternId: card.patternId, themes: card.themes ?? [], rating: card.rating ?? null,
      gameId: card.gameId ?? null, moveNumber: card.moveNumber ?? null, puzzleId: card.puzzleId ?? null,
      fen: currentFen(card, item.step), orientation: view.orientation, solverColor: view.solverColor, candidateSan: view.candidateSan,
      lastMove: item.step === 0 ? view.lastMove : item.lastReply ?? null, step: item.step, steps: view.steps, limitMs: LIMIT_MS[card.kind],
      servedAt: item.servedAt, status: item.status, feedback: item.feedback ?? null, reviews: card.state?.reps ?? 0 };
  }

  function sessionView(id) {
    const session = findSession(id);
    const done = session.items.filter(i => ["correct", "failed"].includes(i.status));
    const elapsedMs = now() - Date.parse(session.startedAt);
    return { id: session.id, date: session.date, startedAt: session.startedAt, finishedAt: session.finishedAt, minutes: session.minutes,
      total: session.items.length, index: session.index, answered: done.length, correct: done.filter(i => i.status === "correct").length,
      elapsedMs, overTime: elapsedMs > session.minutes * 60_000, stats: session.stats,
      current: session.finishedAt ? null : itemDto(session, session.index) };
  }

  function finishItem(s, session, item, card, { correct, revealed = false, alternative = false }) {
    const elapsedMs = now() - Date.parse(item.servedAt);
    const grade = gradeAnswer({ correct, revealed, elapsedMs, limitMs: LIMIT_MS[card.kind] });
    const nextState = scheduleCard(card.state ?? newCardState(now()), grade, now());
    s.cards[card.id] = { ...card, state: nextState };
    const view = presentCard(card);
    const line = describeLine(view.fen, card.solution);
    item.status = correct ? "correct" : "failed";
    item.feedback = { correct, revealed, alternative, grade, elapsedMs, limitMs: LIMIT_MS[card.kind], nextDue: nextState.due,
      intervalDays: nextState.intervalDays, solutionSan: line.san, startFen: view.fen, playedSan: item.playedSan ?? null };
    s.log.push({ kind: "answer", at: new Date(now()).toISOString(), sessionId: session.id, cardId: card.id, source: card.source,
      cardKind: card.kind, patternId: card.patternId, correct, revealed, grade, elapsedMs });
    if (s.log.length > MAX_LOG) s.log = s.log.slice(-MAX_LOG);
  }

  async function move(id, moveUci) {
    const session = findSession(id);
    const item = session.items[session.index];
    if (!item || item.status !== "active") throw new Error("item_not_active");
    const card = store.read().cards[item.cardId];
    const fen = currentFen(card, item.step);
    const probe = new Chess(fen); const played = applyUci(probe, String(moveUci ?? ""));
    if (!played) throw new Error("illegal_move");
    let result = checkStep(fen, card.solution, item.step, moveUci);
    let alternative = false; let engineUnavailable = false;
    if (!result.ok && card.allowEngineAlternatives && card.solution.length === 1) {
      const evaluation = await evaluate({ fen, moveUci });
      if (ACCEPTED.has(evaluation?.status)) { result = { ok: true }; alternative = true; }
      else if (!evaluation?.verified) engineUnavailable = true;
    }
    return store.mutate(s => {
      const live = s.sessions.find(x => x.id === id); const it = live.items[live.index];
      it.moves.push(moveUci); it.playedSan = played.san;
      const liveCard = s.cards[it.cardId];
      if (result.ok && !alternative && !result.mate && liveCard.solution[it.step * 2 + 1]) {
        const reply = liveCard.solution[it.step * 2 + 1];
        const after = new Chess(fen); applyUci(after, moveUci); const r = applyUci(after, reply);
        // Some lines end on the opponent's forced reply; the solver has nothing left to find.
        if (!liveCard.solution[it.step * 2 + 2]) { finishItem(s, live, it, liveCard, { correct: true }); return { status: it.status, item: itemDto(live, live.index) }; }
        it.step += 1; it.lastReply = { from: reply.slice(0, 2), to: reply.slice(2, 4) };
        return { status: "continue", replySan: r?.san ?? null, item: itemDto(live, live.index) };
      }
      if (engineUnavailable && !result.ok) {
        it.status = "failed";
        it.feedback = { correct: false, revealed: false, unverified: true, grade: null, solutionSan: describeLine(presentCard(liveCard).fen, liveCard.solution).san, startFen: presentCard(liveCard).fen, playedSan: played.san };
        return { status: "unverified", item: itemDto(live, live.index) };
      }
      finishItem(s, live, it, liveCard, { correct: result.ok, alternative });
      return { status: it.status, item: itemDto(live, live.index) };
    });
  }

  function reveal(id) {
    return store.mutate(s => {
      const live = s.sessions.find(x => x.id === id); if (!live) throw new Error("session_not_found");
      const it = live.items[live.index]; if (!it || it.status !== "active") throw new Error("item_not_active");
      finishItem(s, live, it, s.cards[it.cardId], { correct: false, revealed: true });
      return { status: "failed", item: itemDto(live, live.index) };
    });
  }

  function next(id) {
    store.mutate(s => {
      const live = s.sessions.find(x => x.id === id); if (!live) throw new Error("session_not_found");
      const it = live.items[live.index];
      if (it && it.status === "active") throw new Error("item_not_answered");
      live.index += 1;
      const overTime = now() - Date.parse(live.startedAt) > live.minutes * 60_000;
      if (live.index >= live.items.length || overTime) { live.finishedAt = new Date(now()).toISOString(); return; }
      Object.assign(live.items[live.index], { status: "active", servedAt: new Date(now()).toISOString() });
    });
    return sessionView(id);
  }

  function finish(id) {
    store.mutate(s => { const live = s.sessions.find(x => x.id === id); if (live && !live.finishedAt) live.finishedAt = new Date(now()).toISOString(); });
    return sessionView(id);
  }

  async function explainItem(id, index, locale) {
    const session = findSession(id); const item = session.items[index];
    if (!item || !["correct", "failed"].includes(item.status)) throw new Error("item_not_answered");
    const card = store.read().cards[item.cardId];
    let facts;
    if (card.kind === "refutation") facts = buildFacts({ fen: card.fen, candidateUci: card.candidateUci, punishUci: card.solution, bestUci: card.context?.bestPv ?? [] });
    else if (card.source === "own") facts = buildFacts({ fen: card.fen, candidateUci: card.context?.playedUci, punishUci: card.context?.replyUci ? [card.context.replyUci] : [], bestUci: card.context?.bestPv?.length ? card.context.bestPv : card.solution });
    else facts = buildFacts({ fen: card.fen, bestUci: card.solution });
    const llm = await explain.explain({ facts, locale, kind: card.kind });
    return { facts, llm };
  }

  // ---------- post-game review ----------
  function moments(rows, gameId) {
    return rows.filter(r => r.gameId === gameId && r.patternId).sort((a, b) => (b.loss ?? 0) - (a.loss ?? 0)).slice(0, 3).sort((a, b) => a.ply - b.ply);
  }

  function reviewList() {
    const rows = patterns.decisionRows(); const reviews = store.read().reviews;
    const analysed = new Set(rows.map(r => r.gameId));
    return playerGames().slice(0, 20).map(g => ({ ...g, analysed: analysed.has(g.id), moments: moments(rows, g.id).length,
      reviewed: Boolean(reviews[g.id]?.completedAt), started: Boolean(reviews[g.id]) }));
  }

  function reviewGame(gameId) {
    const rows = patterns.decisionRows();
    const game = playerGames().find(g => g.id === gameId);
    if (!game) throw new Error("game_not_found");
    const list = moments(rows, gameId);
    const review = store.read().reviews[gameId] ?? { answers: {} };
    return { game, analysed: rows.some(r => r.gameId === gameId), completedAt: review.completedAt ?? null,
      moments: list.map((r, index) => {
        const answer = review.answers[index];
        return { index, fen: r.fen, moveNumber: r.moveNumber, color: r.fen.split(" ")[1] === "w" ? "white" : "black", patternId: r.patternId,
          answered: Boolean(answer), answer: answer ? revealMoment(r, answer) : null };
      }) };
  }

  function revealMoment(r, answer) {
    const facts = buildFacts({ fen: r.fen, candidateUci: r.moveUci, punishUci: r.replyUci ? [r.replyUci] : [], bestUci: r.referencePv ?? [r.referenceUci] });
    return { cause: answer.cause, trySan: answer.trySan ?? null, tryStatus: answer.tryStatus ?? null, facts };
  }

  async function answerMoment(gameId, index, { tryUci, cause }) {
    if (!REVIEW_CAUSES.includes(cause)) throw new Error("invalid_request");
    const list = moments(patterns.decisionRows(), gameId); const r = list[index];
    if (!r) throw new Error("moment_not_found");
    let trySan = null; let tryStatus = null;
    if (tryUci) {
      const move = applyUci(new Chess(r.fen), tryUci);
      if (!move) throw new Error("illegal_move");
      trySan = move.san;
      if (tryUci === r.referenceUci) tryStatus = "verified_best";
      else if (tryUci === r.moveUci) tryStatus = "same_as_game";
      else { const ev = await evaluate({ fen: r.fen, moveUci: tryUci }); tryStatus = ev?.verified ? ev.status : "unverified"; }
    }
    store.mutate(s => {
      const review = (s.reviews[gameId] ??= { startedAt: new Date(now()).toISOString(), answers: {} });
      review.answers[index] = { cause, tryUci: tryUci ?? null, trySan, tryStatus, at: new Date(now()).toISOString() };
      if (Object.keys(review.answers).length >= list.length) review.completedAt ??= new Date(now()).toISOString();
    });
    // The moment is already a spaced-repetition card (both framings); make sure it exists now.
    syncOwnCards([r]);
    return reviewGame(gameId);
  }

  async function explainMoment(gameId, index, locale) {
    const r = moments(patterns.decisionRows(), gameId)[index];
    if (!r) throw new Error("moment_not_found");
    if (!store.read().reviews[gameId]?.answers?.[index]) throw new Error("moment_not_answered");
    const facts = revealMoment(r, {}).facts;
    return { facts, llm: await explain.explain({ facts, locale, kind: "game-review" }) };
  }

  // ---------- overview & weekly progress ----------
  function overview() {
    const state = store.read(); const b = loadBank();
    const due = Object.values(state.cards).filter(c => c.state && Date.parse(c.state.due) <= now()).length;
    const todays = state.sessions.filter(s => s.date === today());
    const last = todays.at(-1) ?? null;
    const pendingReviews = reviewList().filter(g => g.analysed && g.moments > 0 && !g.reviewed && now() - Date.parse(g.startedAt) < 7 * 86_400_000).length;
    return { date: today(), streak: streakDays(state.log, now()), dueCards: due, totalCards: Object.keys(state.cards).length,
      bank: { available: b.available, count: b.rows.length, source: b.source }, explain: explain.status(),
      session: last ? sessionView(last.id) : null, finishedToday: todays.some(s => s.finishedAt), pendingReviews,
      analysis: patterns.summary().job };
  }

  function weekly() {
    const rows = patterns.decisionRows(); const state = store.read();
    const reports = Object.values(state.reviews).flatMap(r => Object.values(r.answers ?? {}).map(a => ({ at: a.at, cause: a.cause })));
    return { weeks: weeklyMetrics({ rows, games: playerGames(), log: state.log, reports }), streak: streakDays(state.log, now()), goalPieceLossPer100: 1.5 };
  }

  async function sync() {
    if (!syncRecent) throw new Error("sync_unavailable");
    const jobs = await syncRecent();
    patterns.schedule();
    return { jobs };
  }

  return { overview, startSession, sessionView, move, reveal, next, finish, explainItem, reviewList, reviewGame, answerMoment, explainMoment, weekly, sync };
}
