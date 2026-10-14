export function createPatternRouter(service) {
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/patterns")) return false;
    function respond(status, value) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); return true; }
    async function body() {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error("invalid_request"); chunks.push(chunk); }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new Error("invalid_request"); }
    }
    try {
      if (url.pathname === "/api/patterns" && req.method === "GET") return respond(200, service.summary());
      if (url.pathname === "/api/patterns/update" && req.method === "POST") { void service.update(); return respond(202, service.summary()); }
      if (url.pathname === "/api/patterns/cancel" && req.method === "POST") { service.cancel(); return respond(202, service.summary()); }
      if (url.pathname === "/api/patterns/practice" && req.method === "POST") { const input = await body(); return respond(201, service.startPractice(input.patternId, input.exerciseId)); }
      const match = url.pathname.match(/^\/api\/patterns\/practice\/([A-Za-z0-9-]+)(?:\/(hint|solution|move))?$/);
      if (match) {
        if (!match[2] && req.method === "GET") return respond(200, service.exerciseView(match[1]));
        if (req.method === "POST" && match[2] === "move") return respond(200, await service.submit(match[1], (await body()).moveUci));
        if (req.method === "POST" && ["hint", "solution"].includes(match[2])) return respond(200, service.reveal(match[1], match[2]));
      }
      return respond(404, { error: "not_found" });
    } catch (error) {
      const safe = ["pattern_unknown", "pattern_not_recurrent", "exercise_unavailable", "illegal_move", "analysis_unverified", "invalid_request"];
      return respond(400, { error: safe.includes(error.message) ? error.message : "request_failed" });
    }
  };
}
