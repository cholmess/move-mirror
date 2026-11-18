const SAFE_ERRORS = ["session_not_found", "item_not_active", "item_not_answered", "illegal_move", "invalid_request", "game_not_found",
  "moment_not_found", "moment_not_answered", "sync_unavailable"];

export function createDailyRouter(service) {
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (!p.startsWith("/api/daily")) return false;
    const respond = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); return true; };
    async function body() {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error("invalid_request"); chunks.push(chunk); }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new Error("invalid_request"); }
    }
    const locale = l => (["es", "en", "de"].includes(l) ? l : "en");
    try {
      if (p === "/api/daily" && req.method === "GET") return respond(200, service.overview());
      if (p === "/api/daily/weekly" && req.method === "GET") return respond(200, service.weekly());
      if (p === "/api/daily/sync" && req.method === "POST") return respond(202, await service.sync());
      if (p === "/api/daily/session" && req.method === "POST") return respond(201, service.startSession());
      const s = p.match(/^\/api\/daily\/session\/([A-Za-z0-9-]+)(?:\/(move|reveal|next|finish|explain))?$/);
      if (s) {
        if (!s[2] && req.method === "GET") return respond(200, service.sessionView(s[1]));
        if (req.method === "POST") {
          const input = await body();
          if (s[2] === "move") return respond(200, await service.move(s[1], String(input.moveUci ?? "")));
          if (s[2] === "reveal") return respond(200, service.reveal(s[1]));
          if (s[2] === "next") return respond(200, service.next(s[1]));
          if (s[2] === "finish") return respond(200, service.finish(s[1]));
          if (s[2] === "explain") return respond(200, await service.explainItem(s[1], Number(input.index), locale(input.locale)));
        }
      }
      if (p === "/api/daily/reviews" && req.method === "GET") return respond(200, { games: service.reviewList() });
      const r = p.match(/^\/api\/daily\/reviews\/([A-Za-z0-9-]+)(?:\/(\d+)(?:\/(explain))?)?$/);
      if (r) {
        if (!r[2] && req.method === "GET") return respond(200, service.reviewGame(r[1]));
        if (r[2] && req.method === "POST") {
          const input = await body();
          if (r[3] === "explain") return respond(200, await service.explainMoment(r[1], Number(r[2]), locale(input.locale)));
          return respond(200, await service.answerMoment(r[1], Number(r[2]), { tryUci: input.tryUci ? String(input.tryUci) : null, cause: String(input.cause ?? "") }));
        }
      }
      return respond(404, { error: "not_found" });
    } catch (error) {
      return respond(400, { error: SAFE_ERRORS.includes(error.message) ? error.message : "request_failed" });
    }
  };
}
