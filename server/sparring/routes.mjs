import {
  assertActiveSessionDto,
  assertNoSpoilers,
} from "../../shared/sparring/dto.js";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function matchPath(url, pattern) {
  const pathOnly = url.split("?")[0];
  const parts = pattern.split("/").filter(Boolean);
  const actual = pathOnly.split("/").filter(Boolean);
  if (parts.length !== actual.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(actual[i]);
    else if (parts[i] !== actual[i]) return null;
  }
  return params;
}

function sendActiveSession(res, session) {
  const violation = assertActiveSessionDto(session);
  if (violation && session.sessionStatus !== "completed" && session.sessionStatus !== "resigned") {
    json(res, 500, { ok: false, error: "spoiler_leak", detail: violation });
    return false;
  }
  if (!assertNoSpoilers(session)) {
    json(res, 500, { ok: false, error: "spoiler_leak" });
    return false;
  }
  json(res, 200, { ok: true, session });
  return true;
}

export function createSparringRouter(getService) {
  return async function route(req, res) {
    if (!req.url?.startsWith("/api/sparring")) return false;
    const service = getService();

    const url = req.url.split("?")[0];

    if (url === "/api/sparring/sessions" && req.method === "GET") {
      json(res, 200, { ok: true, sessions: service.listSessions() });
      return true;
    }

    if (url === "/api/sparring/sessions" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const session = service.createSession(body);
        const violation = assertActiveSessionDto(session);
        if (violation) {
          json(res, 500, { ok: false, error: "spoiler_leak", detail: violation });
          return true;
        }
        json(res, 201, { ok: true, session });
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    if (url === "/api/sparring/profile" && req.method === "GET") {
      json(res, 200, { ok: true, profile: service.getProfile() });
      return true;
    }

    const sessionGet = matchPath(url, "/api/sparring/sessions/:id");
    if (sessionGet && req.method === "GET" && !url.includes("/agent-move")) {
      const session = service.getSession(sessionGet.id);
      if (!session) {
        json(res, 404, { ok: false, error: "session_not_found" });
        return true;
      }
      sendActiveSession(res, session);
      return true;
    }

    const playerMove = matchPath(url, "/api/sparring/sessions/:id/player-move");
    if (playerMove && req.method === "POST") {
      try {
        const body = await readBody(req);
        const result = await service.applyPlayerMove(playerMove.id, body);
        if (result.agentMove && !assertNoSpoilers(result.agentMove)) {
          json(res, 500, { ok: false, error: "spoiler_leak" });
          return true;
        }
        const violation = assertActiveSessionDto(result.session);
        if (violation && result.session.sessionStatus !== "completed") {
          json(res, 500, { ok: false, error: "spoiler_leak", detail: violation });
          return true;
        }
        json(res, 200, { ok: true, ...result });
      } catch (err) {
        const code = String(err.message ?? err);
        const status = code === "engine_unavailable" ? 503 : 400;
        json(res, status, { ok: false, error: code });
      }
      return true;
    }

    const agentMove = matchPath(url, "/api/sparring/sessions/:id/agent-move");
    if (agentMove && req.method === "POST") {
      try {
        const payload = await service.agentMove(agentMove.id, {});
        if (!assertNoSpoilers(payload)) {
          json(res, 500, { ok: false, error: "spoiler_leak" });
          return true;
        }
        json(res, 200, { ok: true, ...payload });
      } catch (err) {
        const code = String(err.message ?? err);
        const status = code === "engine_unavailable" ? 503 : 400;
        json(res, status, { ok: false, error: code });
      }
      return true;
    }

    const hint = matchPath(url, "/api/sparring/sessions/:id/hint");
    if (hint && req.method === "POST") {
      try {
        const payload = service.hint(hint.id);
        json(res, 200, { ok: true, ...payload });
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    const resign = matchPath(url, "/api/sparring/sessions/:id/resign");
    if (resign && req.method === "POST") {
      try {
        const session = service.resign(resign.id);
        sendActiveSession(res, session);
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    const resume = matchPath(url, "/api/sparring/sessions/:id/resume");
    if (resume && req.method === "POST") {
      try {
        const session = service.resume(resume.id);
        sendActiveSession(res, session);
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    const reviewPost = matchPath(url, "/api/sparring/sessions/:id/review");
    if (reviewPost && req.method === "POST") {
      try {
        const review = await service.runReview(reviewPost.id);
        json(res, 200, { ok: true, review });
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    if (reviewPost && req.method === "GET") {
      try {
        const review = service.getReview(reviewPost.id);
        if (!review) {
          json(res, 404, { ok: false, error: "review_not_found" });
          return true;
        }
        json(res, 200, { ok: true, review });
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    const pgn = matchPath(url, "/api/sparring/sessions/:id/pgn");
    if (pgn && req.method === "GET") {
      try {
        const text = service.exportPgn(pgn.id);
        res.writeHead(200, { "Content-Type": "application/x-chess-pgn" });
        res.end(text);
      } catch (err) {
        json(res, 404, { ok: false, error: String(err.message ?? err) });
      }
      return true;
    }

    return false;
  };
}
