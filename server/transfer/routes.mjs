import { measureDecisions } from "../../shared/transfer/measure.js";
import { decidePedagogy, promoteExerciseCandidate } from "../../shared/transfer/pedagogy.js";
import { runSync } from "./sync.mjs";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createTransferRouter({ store, fixturesDir, enginePath, username, validation = null }) {
  let job = { running: false, progress: null, error: null, abort: null };

  function snapshot() {
    return store.publicState(job);
  }

  async function start(source, training, purpose = "post-intervention-transfer") {
    if (job.running) {
      const error = new Error("sync_in_progress");
      error.code = "sync_in_progress";
      throw error;
    }
    const abort = new AbortController();
    job = { running: true, progress: { phase: "start", done: 0, total: 0, message: "Preparando" }, error: null, abort };
    runSync({
      store,
      source,
      username,
      fixturesDir,
      enginePath,
      training,
      purpose,
      validation,
      signal: abort.signal,
      onProgress: (progress) => {
        job.progress = progress;
      },
    })
      .then(() => {
        job.running = false;
        job.progress = { phase: "done", done: job.progress?.done ?? 0, total: job.progress?.total ?? 0, message: "Listo" };
      })
      .catch((error) => {
        job.running = false;
        const message = String(error.message ?? error);
        job.error = message === "aborted" ? null : message;
        job.progress = {
          phase: message === "aborted" ? "cancelled" : "error",
          done: job.progress?.done ?? 0,
          total: job.progress?.total ?? 0,
          message: message === "aborted" ? "Análisis cancelado. Se puede reanudar." : message,
        };
        if (message !== "aborted") {
          const state = store.readState();
          state.lastError = message;
          store.writeState(state);
        }
      });
  }

  return async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/transfer")) return false;

    try {
      if (url.pathname === "/api/transfer/state" && req.method === "GET") {
        json(res, 200, snapshot());
        return true;
      }
      if (url.pathname === "/api/transfer/export" && req.method === "GET") {
        json(res, 200, store.exportBundle());
        return true;
      }
      if (url.pathname === "/api/transfer/examples" && req.method === "GET") {
        const id = url.searchParams.get("cohortId") || snapshot().currentCohortId;
        json(res, 200, { examples: store.examples(id) });
        return true;
      }
      if (url.pathname === "/api/transfer/sync" && req.method === "POST") {
        const body = await readBody(req);
        await start(body.source === "fixtures" ? "fixtures" : "live", body.training ?? null, body.purpose);
        json(res, 202, snapshot());
        return true;
      }
      if (url.pathname === "/api/transfer/resume" && req.method === "POST") {
        const body = await readBody(req);
        await start(body.source === "fixtures" || snapshot().sync.lastSource === "fixtures" ? "fixtures" : "live", body.training ?? null, body.purpose);
        json(res, 202, snapshot());
        return true;
      }
      if (url.pathname === "/api/transfer/cancel" && req.method === "POST") {
        job.abort?.abort();
        json(res, 200, snapshot());
        return true;
      }
      if (url.pathname === "/api/transfer/freeze" && req.method === "POST") {
        const body = await readBody(req);
        const id = body.cohortId || snapshot().openCohort?.id;
        const rows = store.analyzedRows(id);
        const metrics = measureDecisions(rows, { cohortId: id });
        const frozenAt = new Date().toISOString();
        store.freeze(id, metrics, frozenAt);
        if (validation?.recordCohortFrozen) {
          await validation.recordCohortFrozen(id, frozenAt);
        }
        json(res, 200, snapshot());
        return true;
      }
      if (url.pathname === "/api/transfer/promote" && req.method === "POST") {
        const body = await readBody(req);
        const id = body.cohortId;
        const meta = store.readMeta(id);
        const decision = store.analyzedRows(id).find((row) => row.key === body.key);
        const candidate = promoteExerciseCandidate({
          cohort: { ...meta, pendingDecisions: store.pendingCount(id) },
          decision,
          existing: store.readState().exerciseCandidates,
        });
        store.addCandidate(candidate);
        json(res, 200, snapshot());
        return true;
      }
      if (url.pathname === "/api/transfer/recommend" && req.method === "POST") {
        const body = await readBody(req);
        const state = store.readState();
        state.trainingSnapshot = body.training ?? state.trainingSnapshot;
        state.intervention = body.training?.interventionQualification ?? state.intervention;
        if (state.intervention) {
          for (const id of store.listCohortIds()) {
            if (store.readMeta(id)?.frozen) store.auditExposure(id, state.intervention);
          }
        }
        state.pedagogy = decidePedagogy({
          training: state.trainingSnapshot ?? {},
          comparison: snapshot().comparison,
          previousAction: body.previousAction ?? state.pedagogy?.action ?? null,
        });
        store.writeState(state);
        json(res, 200, snapshot());
        return true;
      }
      json(res, 404, { ok: false, error: "not found" });
      return true;
    } catch (error) {
      const message = String(error.message ?? error);
      const status = message === "sync_in_progress" ? 409 : message === "examples_locked" || message === "cohort_not_frozen" ? 409 : 400;
      json(res, status, { ok: false, error: message });
      return true;
    }
  };
}
