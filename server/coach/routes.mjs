function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createCoachRouter(getService, { trainingPlan = null } = {}) {
  return async function route(req, res) {
    if (!req.url?.startsWith("/api/coach")) return false;
    const service = getService();
    const url = new URL(req.url, "http://local");
    const path = url.pathname;

    if (trainingPlan && path === "/api/coach/plan" && req.method === "GET") {
      json(res, 200, trainingPlan.plan()); return true;
    }
    if (trainingPlan && path === "/api/coach/plan/start" && req.method === "POST") {
      try {
        const body = await readBody(req);
        if (body.patternId != null && typeof body.patternId !== "string") throw new Error("invalid_request");
        json(res, 200, trainingPlan.start(body.patternId ?? null));
      } catch (error) { json(res, 400, { error: error.message }); }
      return true;
    }

    if (path === "/api/coach/home" && req.method === "GET") {
      json(res, 200, service.home());
      return true;
    }

    if (path === "/api/coach/progress" && req.method === "GET") {
      json(res, 200, service.progress());
      return true;
    }

    if (path === "/api/coach/session" && req.method === "POST") {
      json(res, 200, service.startSession());
      return true;
    }

    const sessionMatch = path.match(/^\/api\/coach\/session\/([^/]+)$/);
    if (sessionMatch && req.method === "GET") {
      const result = service.getSession(sessionMatch[1]);
      json(res, result.ok ? 200 : 404, result);
      return true;
    }

    const retentionMatch = path.match(/^\/api\/coach\/session\/([^/]+)\/retention$/);
    if (retentionMatch && req.method === "POST") {
      const result = service.startRetention(retentionMatch[1]);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }

    const actionMatch = path.match(/^\/api\/coach\/session\/([^/]+)\/action$/);
    if (actionMatch && req.method === "POST") {
      const body = await readBody(req);
      const result = await service.act(actionMatch[1], body.action, body);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }

    json(res, 404, { ok: false, error: "not_found" });
    return true;
  };
}
