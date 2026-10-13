import { buildCoachHome, coachDoseQualified } from "../../shared/coach/planner.js";
import { buildCoachProgressFromSession } from "../../shared/coach/progress.js";
import { COACH_DOSE_PROTOCOL_ID, COACH_PROTOCOL_ID } from "../../shared/coach/constants.js";
import { createCoachSession, applyCoachAction, publicView } from "../../shared/coach/session.js";
import { isPreverifiedCandidate, isPreverifiedHoldoutCandidate } from "../../shared/coach/candidate-verify.js";
import { PRACTICE_EXAMPLE, WORKED_EXAMPLE } from "../../shared/coach/teaching-public.js";
import {
  holdoutPublicDto,
  holdoutSecrets,
  retentionPublicDto,
  retentionSecrets,
} from "./eval-secrets.mjs";

const RETENTION_DELAY_MS = Number(process.env.COACH_RETENTION_DELAY_MS ?? 7 * 24 * 60 * 60 * 1000);

export function createCoachService(store, { validation = null, evaluateMove = null } = {}) {
  const secrets = () => ({
    holdout: holdoutSecrets(),
    retention: retentionSecrets(),
  });

  async function engineEvalStatusForCandidate({ fen, candidateUci, preverified }) {
    if (!candidateUci || preverified || !evaluateMove) return null;
    try {
      const result = await evaluateMove({ fen, moveUci: candidateUci });
      return result?.evalFinalStatus ?? result?.status ?? "unverified";
    } catch {
      return "unverified";
    }
  }

  async function enrichMoveBody(session, body) {
    const moveBody = body ?? {};
    if (session.phase === "explore" && session.exploreReplyPending && session.exploreCandidateUci) {
      const status = await engineEvalStatusForCandidate({
        fen: WORKED_EXAMPLE.fen,
        candidateUci: session.exploreCandidateUci,
        preverified: isPreverifiedCandidate(WORKED_EXAMPLE, session.exploreCandidateUci),
      });
      return { ...moveBody, engineEvalStatus: status };
    }
    if (session.phase === "practice" && session.practiceStep === "reply" && session.practiceCandidateUci) {
      const status = await engineEvalStatusForCandidate({
        fen: PRACTICE_EXAMPLE.fen,
        candidateUci: session.practiceCandidateUci,
        preverified: isPreverifiedCandidate(PRACTICE_EXAMPLE, session.practiceCandidateUci),
      });
      return { ...moveBody, engineEvalStatus: status };
    }
    if (session.phase === "holdout" && session.holdoutStep === "reply" && session.holdoutCandidateUci) {
      const holdout = secrets().holdout;
      const status = await engineEvalStatusForCandidate({
        fen: holdout.fen,
        candidateUci: session.holdoutCandidateUci,
        preverified: isPreverifiedHoldoutCandidate(holdout, session.holdoutCandidateUci),
      });
      return { ...moveBody, engineEvalStatus: status };
    }
    return moveBody;
  }

  async function syncValidation(session) {
    if (!validation) return;
    const dose = coachDoseQualified(session);
    session.coachDoseQualified = dose.qualified;
    await validation.recordDomainEvent({
      type: "coach_session_completed",
      source: "coach",
      sessionId: session.id,
      payload: {
        sessionId: session.id,
        protocolId: COACH_PROTOCOL_ID,
        contrastCompleted: session.events.some((e) => e.type === "coach_contrast_safe"),
        exitRuleRecorded: session.events.some((e) => e.type === "coach_exit_rule"),
        doseFlags: dose.flags,
      },
      idempotencyKey: `coach-session-completed:${session.id}`,
    });
    const holdout = session.events.find((e) => e.type === "coach_holdout_attempt" && e.firstAttempt);
    if (holdout) {
      await validation.recordDomainEvent({
        type: "coach_holdout_recorded",
        source: "coach",
        sessionId: session.id,
        payload: {
          sessionId: session.id,
          contentId: holdout.contentId,
          firstAttempt: true,
          success: holdout.success,
          hintLevel: 0,
          historicalExposureUncertain: holdout.historicalExposureUncertain !== false,
          countsForProtectedGeneralization: holdout.countsForProtectedGeneralization === true,
          verificationStatus: holdout.verificationStatus ?? null,
        },
        idempotencyKey: `coach-holdout:${session.id}`,
      });
    }
    const retention = session.events.find((e) => e.type === "coach_retention_attempt" && e.firstAttempt);
    if (retention) {
      await validation.recordDomainEvent({
        type: "coach_retention_recorded",
        source: "coach",
        sessionId: session.id,
        payload: {
          sessionId: session.id,
          contentId: retention.contentId,
          firstAttempt: true,
          success: retention.success,
          hintLevel: retention.hintLevel ?? 0,
        },
        idempotencyKey: `coach-retention:${session.id}`,
      });
    }
    const rebuilt = validation.readState();
    const coachQ = rebuilt?.coachInterventionQualification;
    const events = validation.listEvents();
    if (coachQ?.qualified && !events.some((e) => e.type === "coach_dose_qualified")) {
      await validation.recordDomainEvent({
        type: "coach_dose_qualified",
        source: "coach",
        payload: {
          protocolId: COACH_DOSE_PROTOCOL_ID,
          qualifiedAt: coachQ.qualifiedAt,
        },
        idempotencyKey: `coach-dose-qualified:${COACH_DOSE_PROTOCOL_ID}`,
      });
    }
  }

  return {
    home() {
      const sessions = store.listSessions();
      const now = Date.now();
      for (const session of sessions) {
        if (
          session.status === "awaiting_retention" &&
          session.retentionDueAt &&
          Date.parse(session.retentionDueAt) <= now &&
          !session.retentionCompleted
        ) {
          session.status = "retention_due";
          store.saveSession(session);
        }
      }
      return { ok: true, home: buildCoachHome({ sessions: store.listSessions() }) };
    },
    progress() {
      const sessions = store.listSessions();
      const latest = [...sessions].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      return { ok: true, progress: buildCoachProgressFromSession(latest ?? null) };
    },
    startSession() {
      const active = store.listSessions().find((s) => s.status === "in_progress" && s.phase !== "retention");
      if (active) {
        return { ok: true, view: publicView(active, holdoutPublicDto(), retentionPublicDto()) };
      }
      const session = createCoachSession();
      store.saveSession(session);
      return { ok: true, view: publicView(session, holdoutPublicDto(), retentionPublicDto()) };
    },
    getSession(id) {
      const session = store.getSession(id);
      if (!session) return { ok: false, error: "session_not_found" };
      return { ok: true, view: publicView(session, holdoutPublicDto(), retentionPublicDto()) };
    },
    startRetention(id) {
      const session = store.getSession(id);
      if (!session) return { ok: false, error: "session_not_found" };
      if (session.retentionCompleted) return { ok: false, error: "retention_already_completed" };
      const due = session.retentionDueAt ? Date.parse(session.retentionDueAt) : 0;
      if (due > Date.now() && process.env.COACH_ALLOW_EARLY_RETENTION !== "1") {
        return { ok: false, error: "retention_not_due" };
      }
      session.status = "in_progress";
      session.phase = "retention";
      session.retentionStep = "candidate";
      session.hintLevel = 0;
      session.updatedAt = new Date().toISOString();
      store.saveSession(session);
      return { ok: true, view: publicView(session, holdoutPublicDto(), retentionPublicDto()) };
    },
    async act(id, action, body) {
      const session = store.getSession(id);
      if (!session) return { ok: false, error: "session_not_found" };
      if (session.status === "closed") return { ok: false, error: "session_closed" };
      if (session.status === "awaiting_retention" && action !== "finish") {
        return { ok: false, error: "awaiting_retention" };
      }
      try {
        const moveBody = action === "submit_move" ? await enrichMoveBody(session, body) : body;
        const result = applyCoachAction(session, action, moveBody, secrets());
        let saved = result.session;
        if (saved.phase === "summary" && action === "finish") {
          saved.status = "awaiting_retention";
          saved.retentionDueAt = new Date(Date.now() + RETENTION_DELAY_MS).toISOString();
          saved.retentionCompleted = false;
        }
        if (action === "finish_retention" && saved.phase === "retention_complete") {
          saved.status = "closed";
          saved.retentionCompleted = true;
          await syncValidation(saved);
        }
        store.saveSession(saved);
        if (saved.status === "awaiting_retention" && action === "finish") {
          await syncValidation(saved);
        }
        return {
          ok: true,
          view: publicView(saved, holdoutPublicDto(), retentionPublicDto()),
          feedback: result.feedback,
        };
      } catch (err) {
        return { ok: false, error: String(err.message ?? err) };
      }
    },
  };
}
