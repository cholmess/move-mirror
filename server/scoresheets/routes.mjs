import { createScoresheetService } from "./service.mjs";

const MAX_BODY = Number(process.env.SCORESHEET_MAX_BODY_BYTES ?? 28 * 1024 * 1024);

export function createScoresheetRouter({ gamesStore }) {
  const scoresheetStore = gamesStore.scoresheetStore;
  const service = createScoresheetService({ scoresheetStore, gamesStore });
  /** @type {Map<string, AbortController>} */
  const recognizeControllers = new Map();

  return async function handleScoresheet(req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    try {
      if (pathname === "/api/import/scoresheet" && req.method === "POST") {
        const input = await body(req);
        return respond(res, 201, await service.createFromUpload(input));
      }

      const draftMatch = pathname.match(/^\/api\/import\/scoresheet\/([a-f0-9-]+)$/);
      if (draftMatch && req.method === "GET") {
        return respond(res, 200, service.publicDraft(scoresheetStore.readDraft(draftMatch[1])));
      }
      if (draftMatch && req.method === "PATCH") {
        return respond(res, 200, service.patchDraft(draftMatch[1], await body(req)));
      }
      if (draftMatch && req.method === "DELETE") {
        return respond(res, 200, scoresheetStore.deleteDraft(draftMatch[1]));
      }

      const preprocessMatch = pathname.match(/^\/api\/import\/scoresheet\/([a-f0-9-]+)\/preprocess$/);
      if (preprocessMatch && req.method === "POST") {
        return respond(res, 200, await service.preprocessDraft(preprocessMatch[1], await body(req)));
      }
      const recognizeMatch = pathname.match(/^\/api\/import\/scoresheet\/([a-f0-9-]+)\/recognize$/);
      if (recognizeMatch && req.method === "POST") {
        const draftId = recognizeMatch[1];
        const controller = new AbortController();
        recognizeControllers.set(draftId, controller);
        let responded = false;
        req.on("close", () => {
          if (!responded) controller.abort();
        });
        try {
          const payload = await service.recognizeDraft(draftId, { signal: controller.signal });
          responded = true;
          return respond(res, 200, payload);
        } finally {
          recognizeControllers.delete(draftId);
        }
      }
      const cancelMatch = pathname.match(/^\/api\/import\/scoresheet\/([a-f0-9-]+)\/cancel-ocr$/);
      if (cancelMatch && req.method === "POST") {
        recognizeControllers.get(cancelMatch[1])?.abort();
        return respond(res, 200, service.cancelRecognize(cancelMatch[1]));
      }
      const resolveMatch = pathname.match(/^\/api\/import\/scoresheet\/([a-f0-9-]+)\/resolve$/);
      if (resolveMatch && req.method === "POST") {
        return respond(res, 200, await service.resolveDraft(resolveMatch[1], await body(req)));
      }
      const confirmMatch = pathname.match(/^\/api\/import\/scoresheet\/([a-f0-9-]+)\/confirm$/);
      if (confirmMatch && req.method === "POST") {
        return respond(res, 200, service.confirmDraft(confirmMatch[1], await body(req)));
      }
      const importMatch = pathname.match(/^\/api\/import\/scoresheet\/([a-f0-9-]+)\/import$/);
      if (importMatch && req.method === "POST") {
        return respond(res, 201, await service.importDraft(importMatch[1], await body(req)));
      }
      const originalMatch = pathname.match(/^\/api\/import\/scoresheet\/([a-f0-9-]+)\/original$/);
      if (originalMatch && req.method === "DELETE") {
        return respond(res, 200, service.publicDraft(scoresheetStore.deleteOriginal(originalMatch[1])));
      }
      const pageMatch = pathname.match(/^\/api\/import\/scoresheet\/([a-f0-9-]+)\/pages\/(\d+)\/preview$/);
      if (pageMatch && req.method === "GET") {
        return respond(res, 200, await service.pagePreview(pageMatch[1], Number(pageMatch[2])));
      }
      return false;
    } catch (error) {
      const code = String(error?.code ?? publicError(error));
      const status = code.includes("NOT_FOUND") || code.includes("not_found") ? 404
        : code.includes("too_large") || code.includes("TOO_LARGE") ? 413
          : code.includes("QUEUE_FULL") ? 503
            : code.includes("REVIEW_REQUIRED") || code.includes("confirmation") ? 409
              : code.includes("ENCRYPTED") || code.includes("CORRUPT") ? 422
                : 400;
      respond(res, status, {
        ok: false,
        error: code,
        unresolvedPlies: error.unresolvedPlies ?? undefined,
      });
      return true;
    }
  };
}

async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
}

function respond(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
  return true;
}

function publicError(error) {
  return String(error?.message ?? error).replace(/\s+/g, "_").slice(0, 120);
}
