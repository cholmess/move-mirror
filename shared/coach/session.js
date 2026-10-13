import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import {
  COACH_LESSON_SPEC_VERSION,
  COACH_PROTOCOL_ID,
  HINT_LADDER_MAX,
  PROBE_ANSWERS,
} from "./constants.js";
import { PRACTICE_EXAMPLE, WORKED_EXAMPLE } from "./teaching-public.js";
import { fenAfterUci, sideAfterMove, uciFromSquares, uciSetHas } from "./moves.js";
import {
  isPreverifiedHoldoutCandidate,
  scoreCandidateLineAttempt,
} from "./candidate-verify.js";

export function createCoachSession({ now = new Date().toISOString() } = {}) {
  return {
    id: randomUUID(),
    protocolId: COACH_PROTOCOL_ID,
    lessonSpecVersion: COACH_LESSON_SPEC_VERSION,
    status: "in_progress",
    phase: "signal",
    createdAt: now,
    updatedAt: now,
    branch: null,
    hypothesis: null,
    hintLevel: 0,
    holdout: { started: false, firstAttemptLocked: false, revealed: false },
    retentionCompleted: false,
    retentionDueAt: null,
    events: [],
  };
}

function appendEvent(session, event) {
  const id = event.id ?? randomUUID();
  const key = event.idempotencyKey;
  if (key && session.events.some((e) => e.idempotencyKey === key)) {
    return session.events.find((e) => e.idempotencyKey === key);
  }
  const full = { ...event, id, occurredAt: event.occurredAt ?? new Date().toISOString() };
  session.events.push(full);
  return full;
}

export function publicView(session, holdoutPublic, retentionPublic) {
  const base = {
    sessionId: session.id,
    protocolId: session.protocolId,
    lessonSpecVersion: session.lessonSpecVersion,
    status: session.status,
    phase: session.phase,
    branch: session.branch,
    hypothesis: session.hypothesis,
    hintLevel: session.hintLevel,
    retentionDueAt: session.retentionDueAt,
    retentionCompleted: session.retentionCompleted,
    learningSummary: summarizeLearning(session),
    holdoutExposureNoteKey: "coach:holdoutExposureNote",
  };

  switch (session.phase) {
    case "signal":
      return {
        ...base,
        board: boardPayload(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.sideToMove),
        instructionKey: "coach:phaseSignal",
        actions: ["continue"],
      };
    case "contrast_safe":
      return {
        ...base,
        board: boardPayload(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.sideToMove),
        instructionKey: "coach:phaseContrastSafe",
        actions: ["submit_move"],
        moveRole: "candidate",
      };
    case "contrast_unsafe_intro":
      return {
        ...base,
        board: boardPayload(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.sideToMove),
        instructionKey: "coach:phaseContrastUnsafeIntro",
        actions: ["continue"],
      };
    case "worked_apply":
      return {
        ...base,
        board: boardPayload(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.sideToMove),
        instructionKey: "coach:phaseWorkedApply",
        demoMove: { san: WORKED_EXAMPLE.playedMoveSan, uci: WORKED_EXAMPLE.playedMoveUci },
        actions: ["apply_demo"],
      };
    case "worked_find_reply": {
      const fen = fenAfterUci(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.playedMoveUci);
      return {
        ...base,
        board: boardPayload(fen, sideAfterMove(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.playedMoveUci)),
        instructionKey: "coach:phaseWorkedFindReply",
        highlightSquares: hintSquaresForLevel(session.hintLevel),
        actions: ["submit_move", "request_hint"],
        moveRole: "hostile_reply",
      };
    }
    case "probe_self":
      return {
        ...base,
        board: boardPayload(
          fenAfterUci(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.playedMoveUci),
          sideAfterMove(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.playedMoveUci),
        ),
        instructionKey: "coach:phaseProbeSelf",
        probeOptions: PROBE_ANSWERS,
        actions: ["submit_probe"],
      };
    case "probe_task": {
      const fen = fenAfterUci(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.playedMoveUci);
      return {
        ...base,
        board: boardPayload(fen, sideAfterMove(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.playedMoveUci)),
        instructionKey: probeTaskInstructionKey(session.branch),
        actions: ["submit_move"],
        moveRole: "hostile_reply",
      };
    }
    case "explore":
      if (session.exploreReplyPending && session.exploreFen) {
        return {
          ...base,
          board: boardPayload(
            session.exploreFen,
            sideAfterMove(WORKED_EXAMPLE.fen, session.exploreCandidateUci),
          ),
          instructionKey: "coach:phaseExploreReply",
          actions: ["submit_move"],
          moveRole: "hostile_reply",
        };
      }
      return {
        ...base,
        board: boardPayload(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.sideToMove),
        instructionKey: "coach:phaseExplore",
        actions: ["submit_move"],
        moveRole: "candidate",
      };
    case "practice": {
      const step = session.practiceStep ?? "candidate";
      const fen =
        step === "reply" && session.practiceCandidateUci
          ? fenAfterUci(PRACTICE_EXAMPLE.fen, session.practiceCandidateUci)
          : PRACTICE_EXAMPLE.fen;
      const orient =
        step === "reply" && session.practiceCandidateUci
          ? sideAfterMove(PRACTICE_EXAMPLE.fen, session.practiceCandidateUci)
          : PRACTICE_EXAMPLE.sideToMove;
      return {
        ...base,
        board: boardPayload(fen, orient),
        instructionKey: step === "reply" ? "coach:phasePracticeReply" : "coach:phasePractice",
        practiceStep: step,
        actions: ["submit_move", "request_hint"],
        moveRole: step === "reply" ? "hostile_reply" : "candidate",
      };
    }
    case "holdout": {
      const step = session.holdoutStep ?? "candidate";
      const fen =
        step === "reply" && session.holdoutCandidateUci
          ? fenAfterUci(holdoutPublic.fen, session.holdoutCandidateUci)
          : holdoutPublic.fen;
      const orient =
        step === "reply" && session.holdoutCandidateUci
          ? sideAfterMove(holdoutPublic.fen, session.holdoutCandidateUci)
          : holdoutPublic.sideToMove;
      return {
        ...base,
        board: boardPayload(fen, orient),
        instructionKey: step === "reply" ? "coach:phaseHoldoutReply" : "coach:phaseHoldoutCandidate",
        actions: ["submit_move"],
        moveRole: step === "reply" ? "hostile_reply" : "candidate",
        holdoutContentId: holdoutPublic.contentId,
        firstAttemptLocked: session.holdout.firstAttemptLocked,
      };
    }
    case "exit_rule":
      return {
        ...base,
        instructionKey: "coach:phaseExitRule",
        ruleOptions: ["coach:exitRuleA", "coach:exitRuleB"],
        actions: ["submit_exit_rule"],
      };
    case "summary":
      return {
        ...base,
        instructionKey: "coach:phaseSummary",
        actions: ["finish"],
      };
    case "retention": {
      const step = session.retentionStep ?? "candidate";
      const fen =
        step === "reply" && session.retentionCandidateUci
          ? fenAfterUci(retentionPublic.fen, session.retentionCandidateUci)
          : retentionPublic.fen;
      const orient =
        step === "reply" && session.retentionCandidateUci
          ? sideAfterMove(retentionPublic.fen, session.retentionCandidateUci)
          : retentionPublic.sideToMove;
      return {
        ...base,
        board: boardPayload(fen, orient),
        instructionKey: step === "reply" ? "coach:phaseRetentionReply" : "coach:phaseRetentionCandidate",
        actions: ["submit_move"],
        moveRole: step === "reply" ? "hostile_reply" : "candidate",
        retentionContentId: retentionPublic.contentId,
      };
    }
    case "retention_complete":
      return {
        ...base,
        instructionKey: "coach:phaseRetentionComplete",
        actions: ["finish_retention"],
      };
    default:
      return base;
  }
}

function boardPayload(fen, orientationSide) {
  return {
    fen,
    orientation: orientationSide === "w" ? "white" : "black",
  };
}

function hintSquaresForLevel(level) {
  if (level <= 0) return [];
  if (level === 1) return WORKED_EXAMPLE.signalSquares;
  if (level === 2) return WORKED_EXAMPLE.hintSquares;
  if (level >= 3) return [...WORKED_EXAMPLE.hintSquares, "h2"];
  return [];
}

function probeTaskInstructionKey(branch) {
  if (branch === "recognition") return "coach:probeTaskRecognition";
  if (branch === "visualization") return "coach:probeTaskVisualization";
  if (branch === "evaluation") return "coach:probeTaskEvaluation";
  return "coach:probeTaskVisualization";
}

export function applyCoachAction(session, action, body, secrets) {
  const next = structuredClone(session);
  next.updatedAt = new Date().toISOString();

  switch (action) {
    case "continue":
      if (next.phase === "signal") next.phase = "contrast_safe";
      else if (next.phase === "contrast_unsafe_intro") next.phase = "worked_apply";
      break;
    case "apply_demo":
      if (next.phase === "worked_apply") {
        appendEvent(next, {
          type: "coach_content_exposure",
          contentId: WORKED_EXAMPLE.contentId,
          tier: "teaching",
          idempotencyKey: `exposure:${next.id}:worked`,
        });
        next.phase = "worked_find_reply";
        next.hintLevel = 0;
      }
      break;
    case "request_hint":
      if (next.phase === "worked_find_reply" || next.phase === "practice") {
        next.hintLevel = Math.min(HINT_LADDER_MAX, next.hintLevel + 1);
        appendEvent(next, {
          type: "coach_hint",
          phase: next.phase,
          hintLevel: next.hintLevel,
          idempotencyKey: `hint:${next.id}:${next.phase}:${next.hintLevel}`,
        });
        if (next.hintLevel >= HINT_LADDER_MAX && next.phase === "worked_find_reply") {
          next.phase = "probe_self";
        }
      }
      break;
    case "submit_probe": {
      const answer = body?.answer;
      if (!PROBE_ANSWERS.includes(answer)) throw new Error("invalid_probe_answer");
      next.branch = branchForProbe(answer);
      next.hypothesis = { branch: next.branch, selfReport: answer, status: "tentative" };
      appendEvent(next, {
        type: "coach_probe_self",
        answer,
        branch: next.branch,
        idempotencyKey: `probe:${next.id}`,
      });
      next.phase = "probe_task";
      break;
    }
    case "submit_move":
      return handleMoveSubmission(next, body, secrets);
    case "submit_exit_rule": {
      const ruleKey = body?.ruleKey;
      if (!ruleKey) throw new Error("missing_rule");
      appendEvent(next, {
        type: "coach_exit_rule",
        ruleKey,
        idempotencyKey: `exit:${next.id}`,
      });
      next.phase = "summary";
      break;
    }
    case "finish":
      break;
    case "finish_retention":
      if (next.phase !== "retention_complete") throw new Error("retention_not_complete");
      break;
    default:
      throw new Error(`unknown_action:${action}`);
  }
  return { session: next, feedback: null };
}

function branchForProbe(answer) {
  if (answer === "not_seen") return "recognition";
  if (answer === "saw_but_continued") return "evaluation";
  return "visualization";
}

function recordHypothesisEvidence(session, taskSuccess) {
  const self = session.events.find((e) => e.type === "coach_probe_self");
  const tentativeKey =
    taskSuccess
      ? "coach:hypothesis.consistent"
      : "coach:hypothesis.contradicted";
  session.hypothesis = {
    ...session.hypothesis,
    taskSuccess,
    status: "tentative",
    tentativeKey,
  };
  appendEvent(session, {
    type: "coach_hypothesis_evidence",
    branch: session.branch,
    selfReport: self?.answer ?? null,
    taskSuccess,
    tentativeKey,
    idempotencyKey: `hypothesis:${session.id}`,
  });
}

function handleMoveSubmission(session, body, secrets) {
  const next = session;
  const { from, to, promotion } = body ?? {};
  const fen = currentFenForPhase(next, secrets);
  const uci = uciFromSquares(fen, from, to, promotion ?? "q");
  if (!uci) throw new Error("illegal_move");

  const feedback = { ok: true, role: body?.moveRole ?? inferMoveRole(next), uci, messageKey: null };

  if (next.phase === "contrast_safe") {
    const safe = uciSetHas([WORKED_EXAMPLE.referenceCandidateUci], uci);
    if (!safe) {
      feedback.messageKey = "coach:feedbackContrastTrySafe";
      return { session: next, feedback };
    }
    appendEvent(next, {
      type: "coach_contrast_safe",
      candidateUci: uci,
      idempotencyKey: `contrast-safe:${next.id}`,
    });
    next.phase = "contrast_unsafe_intro";
    feedback.messageKey = "coach:feedbackContrastSafeOk";
    return { session: next, feedback };
  }

  if (next.phase === "worked_find_reply") {
    const ok = uciSetHas([WORKED_EXAMPLE.primaryRefutationUci], uci);
    appendEvent(next, {
      type: "coach_worked_reply",
      success: ok,
      hintLevel: next.hintLevel,
      uci,
      firstAttempt: !next.events.some((e) => e.type === "coach_worked_reply"),
      idempotencyKey: `worked-reply:${next.id}`,
    });
    if (ok) {
      appendEvent(next, { type: "coach_worked_completed", idempotencyKey: `worked-done:${next.id}` });
      next.phase = "probe_self";
      feedback.messageKey = "coach:feedbackFoundReply";
    } else {
      feedback.messageKey = "coach:feedbackTryAgain";
    }
    return { session: next, feedback };
  }

  if (next.phase === "probe_task") {
    const expected = WORKED_EXAMPLE.primaryRefutationUci;
    const ok = uciSetHas([expected], uci);
    appendEvent(next, {
      type: "coach_probe_task",
      branch: next.branch,
      success: ok,
      uci,
      idempotencyKey: `probe-task:${next.id}`,
    });
    recordHypothesisEvidence(next, ok);
    next.phase = "explore";
    feedback.messageKey = ok ? "coach:feedbackProbeOk" : "coach:feedbackProbePartial";
    feedback.hypothesisKey = next.hypothesis?.tentativeKey;
    return { session: next, feedback };
  }

  if (next.phase === "explore" && !next.exploreReplyPending) {
    const after = fenAfterUci(WORKED_EXAMPLE.fen, uci);
    next.exploreCandidateUci = uci;
    next.exploreFen = after;
    next.exploreReplyPending = true;
    feedback.messageKey = "coach:feedbackNowFindReply";
    return { session: next, feedback };
  }

  if (next.phase === "explore" && next.exploreReplyPending) {
    const candidateUci = next.exploreCandidateUci;
    const refutation = refutationForCandidate(candidateUci, WORKED_EXAMPLE);
    const ok = refutation ? uciSetHas([refutation], uci) : false;
    const acceptable = uciSetHas([WORKED_EXAMPLE.referenceCandidateUci], candidateUci);
    const heuristicSuccess = ok || acceptable;
    const scored = scoreCandidateLineAttempt({
      candidateUci,
      spec: WORKED_EXAMPLE,
      heuristicSuccess,
      engineEvalStatus: body?.engineEvalStatus ?? null,
    });
    appendEvent(next, {
      type: "coach_explore_attempt",
      candidateUci,
      replyUci: uci,
      success: scored.success,
      verificationStatus: scored.verificationStatus,
      countsForPracticeLearning: scored.countsForPracticeLearning,
      idempotencyKey: `explore:${next.id}`,
    });
    next.exploreReplyPending = false;
    next.phase = "practice";
    next.practiceStep = "candidate";
    next.hintLevel = 0;
    feedback.messageKey = acceptable
      ? "coach:feedbackSafeCandidate"
      : ok
        ? "coach:feedbackFoundReply"
        : "coach:feedbackExploreMixed";
    return { session: next, feedback };
  }

  if (next.phase === "practice") {
    if (next.practiceStep !== "reply") {
      next.practiceCandidateUci = uci;
      next.practiceStep = "reply";
      feedback.messageKey = "coach:feedbackNowFindReply";
      return { session: next, feedback };
    }
    const candidateUci = next.practiceCandidateUci;
    const refutation = refutationForCandidate(candidateUci, PRACTICE_EXAMPLE);
    const ok = refutation ? uciSetHas([refutation], uci) : false;
    const acceptableCandidate = uciSetHas([PRACTICE_EXAMPLE.referenceCandidateUci], candidateUci);
    const heuristicSuccess = ok || acceptableCandidate;
    const scored = scoreCandidateLineAttempt({
      candidateUci,
      spec: PRACTICE_EXAMPLE,
      heuristicSuccess,
      engineEvalStatus: body?.engineEvalStatus ?? null,
    });
    const firstAttempt = !next.events.some((e) => e.type === "coach_practice_attempt");
    appendEvent(next, {
      type: "coach_practice_attempt",
      candidateUci,
      replyUci: uci,
      success: scored.success,
      verificationStatus: scored.verificationStatus,
      countsForPracticeLearning: scored.countsForPracticeLearning,
      hintLevel: next.hintLevel,
      firstAttempt,
      idempotencyKey: `practice:${next.id}:${firstAttempt ? "first" : "retry"}`,
    });
    next.phase = "holdout";
    next.holdoutStep = "candidate";
    next.holdout.started = true;
    feedback.messageKey = "coach:feedbackPracticeDone";
    return { session: next, feedback };
  }

  if (next.phase === "holdout") {
    return handleHoldoutMove(next, uci, secrets, feedback, body?.engineEvalStatus ?? null);
  }

  if (next.phase === "retention") {
    return handleRetentionMove(next, uci, secrets, feedback);
  }

  throw new Error("move_not_expected");
}

function handleHoldoutMove(session, uci, secrets, feedback, engineEvalStatus = null) {
  const holdout = secrets.holdout;
  if (!session.holdout.firstAttemptLocked) {
    session.holdout.firstAttemptLocked = true;
    appendEvent(session, {
      type: "coach_holdout_started",
      contentId: holdout.contentId,
      idempotencyKey: `holdout-start:${session.id}`,
    });
  }
  if (session.holdoutStep !== "reply") {
    session.holdoutCandidateUci = uci;
    session.holdoutStep = "reply";
    feedback.messageKey = "coach:feedbackNowFindReply";
    return { session, feedback };
  }
  const candidateUci = session.holdoutCandidateUci;
  const expectedReplies = holdout.refutationsByCandidate[candidateUci] ?? holdout.defaultRefutations;
  const ok = expectedReplies ? uciSetHas(expectedReplies, uci) : false;
  const acceptableCandidate = uciSetHas(holdout.acceptableCandidates, candidateUci);
  const heuristicSuccess = ok || acceptableCandidate;
  const historicalExposureUncertain = true;
  let success = heuristicSuccess;
  let verificationStatus = isPreverifiedHoldoutCandidate(holdout, candidateUci) ? "preverified" : "unverified";
  if (!isPreverifiedHoldoutCandidate(holdout, candidateUci)) {
    if (!engineEvalStatus || engineEvalStatus === "unverified") {
      success = false;
      verificationStatus = "unverified";
    } else {
      verificationStatus = engineEvalStatus;
      success = heuristicSuccess && ["verified_best", "verified_acceptable"].includes(engineEvalStatus);
    }
  }
  appendEvent(session, {
    type: "coach_holdout_attempt",
    contentId: holdout.contentId,
    candidateUci,
    replyUci: uci,
    success,
    verificationStatus,
    historicalExposureUncertain,
    countsForProtectedGeneralization: false,
    firstAttempt: true,
    idempotencyKey: `holdout:${session.id}`,
  });
  session.holdout.revealed = true;
  session.phase = "exit_rule";
  feedback.messageKey = ok ? "coach:feedbackHoldoutOk" : "coach:feedbackHoldoutPartial";
  feedback.reveal = { genericKey: "coach:holdoutRevealGeneric" };
  return { session, feedback };
}

function handleRetentionMove(session, uci, secrets, feedback) {
  const retention = secrets.retention;
  if (session.retentionStep !== "reply") {
    session.retentionCandidateUci = uci;
    session.retentionStep = "reply";
    feedback.messageKey = "coach:feedbackNowFindReply";
    return { session, feedback };
  }
  const candidateUci = session.retentionCandidateUci;
  const expectedReplies = retention.refutationsByCandidate[candidateUci] ?? retention.defaultRefutations;
  const ok = expectedReplies ? uciSetHas(expectedReplies, uci) : false;
  const acceptableCandidate = uciSetHas(retention.acceptableCandidates, candidateUci);
  appendEvent(session, {
    type: "coach_retention_attempt",
    contentId: retention.contentId,
    candidateUci,
    replyUci: uci,
    success: ok || acceptableCandidate,
    hintLevel: 0,
    firstAttempt: true,
    idempotencyKey: `retention:${session.id}`,
  });
  session.phase = "retention_complete";
  feedback.messageKey = ok ? "coach:feedbackRetentionOk" : "coach:feedbackRetentionPartial";
  return { session, feedback };
}

function refutationForCandidate(candidateUci, spec) {
  if (uciSetHas([spec.playedMoveUci], candidateUci)) return spec.primaryRefutationUci;
  if (uciSetHas([spec.referenceCandidateUci], candidateUci)) return null;
  return null;
}

function inferMoveRole(session) {
  if (
    session.phase === "worked_find_reply" ||
    session.holdoutStep === "reply" ||
    session.practiceStep === "reply" ||
    session.retentionStep === "reply"
  ) {
    return "hostile_reply";
  }
  return "candidate";
}

function currentFenForPhase(session, secrets) {
  if (session.phase === "explore" && session.exploreReplyPending && session.exploreFen) {
    return session.exploreFen;
  }
  if (session.phase === "contrast_safe" || (session.phase === "explore" && !session.exploreReplyPending)) {
    return WORKED_EXAMPLE.fen;
  }
  if (session.phase === "worked_find_reply") {
    return fenAfterUci(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.playedMoveUci);
  }
  if (session.phase === "probe_task") {
    return fenAfterUci(WORKED_EXAMPLE.fen, WORKED_EXAMPLE.playedMoveUci);
  }
  if (session.phase === "practice") {
    if (session.practiceStep === "reply" && session.practiceCandidateUci) {
      return fenAfterUci(PRACTICE_EXAMPLE.fen, session.practiceCandidateUci);
    }
    return PRACTICE_EXAMPLE.fen;
  }
  if (session.phase === "holdout") {
    if (session.holdoutStep === "reply" && session.holdoutCandidateUci) {
      return fenAfterUci(secrets.holdout.fen, session.holdoutCandidateUci);
    }
    return secrets.holdout.fen;
  }
  if (session.phase === "retention") {
    if (session.retentionStep === "reply" && session.retentionCandidateUci) {
      return fenAfterUci(secrets.retention.fen, session.retentionCandidateUci);
    }
    return secrets.retention.fen;
  }
  return WORKED_EXAMPLE.fen;
}

export function summarizeLearning(session) {
  const hints = session.events.filter((e) => e.type === "coach_hint");
  const holdout = session.events.find((e) => e.type === "coach_holdout_attempt");
  const practice = session.events.find((e) => e.type === "coach_practice_attempt");
  const retention = session.events.find((e) => e.type === "coach_retention_attempt");
  return {
    maxHintLevel: hints.reduce((max, e) => Math.max(max, e.hintLevel ?? 0), 0),
    practiceFirstAttemptSuccess: practice?.firstAttempt ? Boolean(practice.success) : null,
    practiceHintLevel: practice?.hintLevel ?? null,
    holdoutFirstAttemptSuccess: holdout?.firstAttempt ? Boolean(holdout.success) : null,
    branch: session.branch,
    hypothesisKey: session.hypothesis?.tentativeKey ?? null,
    retentionDueAt: session.retentionDueAt,
    retentionCompleted: session.retentionCompleted,
    retentionFirstAttemptSuccess: retention?.firstAttempt ? Boolean(retention.success) : null,
  };
}

export function validateSessionLegal(session, secrets) {
  const errors = [];
  try {
    new Chess(WORKED_EXAMPLE.fen);
    new Chess(secrets.holdout.fen);
    new Chess(secrets.retention.fen);
  } catch {
    errors.push("invalid_fen");
  }
  return errors;
}
