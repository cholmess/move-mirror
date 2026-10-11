import { verifyValidationLedger } from "./verify.mjs";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createValidationRouter(getService) {
  return async function route(req, res) {
    if (!req.url?.startsWith("/api/validation")) return false;
    const service = getService();
    const url = req.url.split("?")[0];

    if (url === "/api/validation/status" && req.method === "GET") {
      const technical = new URL(req.url, "http://local").searchParams.get("technical") === "1";
      json(res, 200, {
        ok: true,
        status: service.publicStatus(),
        ...(technical ? { state: service.readState() } : {}),
      });
      return true;
    }

    if (url === "/api/validation/events" && req.method === "GET") {
      json(res, 200, { ok: true, events: service.listEvents() });
      return true;
    }

    if (url === "/api/validation/snapshot" && req.method === "GET") {
      const hash = new URL(req.url, "http://local").searchParams.get("hash");
      if (!hash) {
        json(res, 400, { ok: false, error: "missing_hash" });
        return true;
      }
      const snapshot = service.getSnapshot(hash);
      if (!snapshot) {
        json(res, 404, { ok: false, error: "snapshot_not_found" });
        return true;
      }
      json(res, 200, { ok: true, snapshot });
      return true;
    }

    if (url === "/api/validation/migrate" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const result = await service.migrateFromClient(body);
        json(res, 200, { ok: true, ...result, status: service.publicStatus() });
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    if (url === "/api/validation/sync" && req.method === "POST") {
      try {
        const body = await readBody(req);
        if (body.kind === "pedagogy_batch" && Array.isArray(body.pedagogyEvents)) {
          const results = await service.syncPedagogyBatch(body.pedagogyEvents);
          json(res, 200, { ok: true, synced: results.filter(Boolean).length, status: service.publicStatus() });
          return true;
        }
        if (body.kind === "defense_completed" && body.exerciseId) {
          await service.recordDefenseCompleted({
            sessionId: body.sessionId ?? body.exerciseId,
            exerciseId: body.exerciseId,
          });
          json(res, 200, { ok: true, status: service.publicStatus() });
          return true;
        }
        json(res, 400, { ok: false, error: "unsupported_sync_kind" });
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    if (url === "/api/validation/export" && req.method === "GET") {
      json(res, 200, { ok: true, bundle: service.exportBundle() });
      return true;
    }

    if (url === "/api/validation/verify" && req.method === "POST") {
      try {
        const report = verifyValidationLedger(service);
        json(res, report.ok ? 200 : 422, report);
      } catch (err) {
        json(res, 500, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    return false;
  };
}
